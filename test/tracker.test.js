import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeConfig } from '../src/config.js';
import { TRIGGERS } from '../src/events.js';
import { createStore } from '../src/store.js';
import { Tracker } from '../src/tracker.js';
import { createFakeFfbb } from './helpers/fakeFfbb.js';
import { createFakeGladys } from './helpers/fakeGladys.js';

const POULE = '200000003010001';
const NEXT_GAME = '200000002901003'; // Monaco – Paris Levallois, 2026-11-01 20:00 Paris
const MONACO_DEVICE = 'ext:test:team:elite.10001';

function setup({
  teams = 'ELITE:Monaco, ELITE:ASVEL',
  now = '2026-10-28T10:00Z',
  store,
  ...rest
} = {}) {
  const gladys = createFakeGladys();
  const ffbb = createFakeFfbb();
  const clock = { now: Date.parse(now) };
  const timers = [];
  let changes = 0;
  const tracker = new Tracker({
    gladys,
    client: ffbb,
    store,
    now: () => clock.now,
    setTimer: (fn, ms) => {
      timers.push(ms);
      return timers.length;
    },
    clearTimer: () => {},
    onChange: () => {
      changes += 1;
    },
  });
  tracker.configure(normalizeConfig({ teams, ...rest }));
  return { gladys, ffbb, clock, tracker, timers, changes: () => changes };
}

/** Put Monaco's next game live, or over. */
function liveGame(ffbb, { status = 'LIVE', monaco = 0, levallois = 0, period = 'Q1' } = {}) {
  ffbb.liveGames = [
    {
      matchId: '2462003',
      matchStatus: status,
      currentPeriod: period,
      clock: '07:30:000',
      score_home: monaco,
      score_out: levallois,
    },
  ];
}

const statesOf = (gladys, suffix) =>
  gladys.published.filter((p) => p.featureExternalId.endsWith(suffix)).map((p) => p.state);

test('the first reading resolves the teams and publishes one device per team', async () => {
  const { gladys, ffbb, tracker } = setup();
  await tracker.refresh();

  // The competition once (with its pool), no second read of the same pool,
  // no live feed: nothing is about to start.
  assert.deepEqual(ffbb.calls, ['competitions ELITE,PROA', `poule ${POULE}`]);
  const devices = gladys.discovered.at(-1);
  assert.deepEqual(
    devices.map((d) => [d.name, d.external_id]),
    [
      ['Monaco (Betclic ELITE)', MONACO_DEVICE],
      ['ASVEL (Betclic ELITE)', 'ext:test:team:elite.10002'],
    ],
  );
  for (const device of devices) {
    for (const feature of device.features) {
      assert.equal(feature.read_only, true);
      assert.ok(Number.isFinite(feature.min) && Number.isFinite(feature.max), 'min/max NOT NULL');
    }
  }
  // Nothing created yet: no state is sent, no scene event on a baseline.
  assert.deepEqual(gladys.published, []);
  assert.deepEqual(gladys.sceneEvents, []);
  assert.deepEqual(gladys.connectionStatuses.at(-1), { connected: true, message: undefined });
  assert.deepEqual(
    gladys.transports.map((t) => t.transport),
    ['cloud', 'cloud'],
  );
  assert.equal(tracker.findByDevice(MONACO_DEVICE).match.id, NEXT_GAME);
});

test('the competition is read once a day, the pools at every reading', async () => {
  const { ffbb, tracker, clock } = setup();
  await tracker.refresh();
  ffbb.calls.length = 0;
  clock.now += 15 * 60_000;
  await tracker.refresh();
  assert.deepEqual(ffbb.calls, [`poule ${POULE}`]);
});

test('created devices get their states, in the configured language', async () => {
  const { gladys, tracker } = setup();
  await tracker.refresh();
  gladys.createAll();
  await tracker.refresh();
  assert.deepEqual(statesOf(gladys, 'elite.10001:team-score'), [0]);
  assert.deepEqual(statesOf(gladys, 'elite.10001:status'), [
    'Prochain match · dim. 1 nov., 20:00 · contre PLB',
  ]);
  // The ASVEL game is also on Nov 1, 18:00.
  assert.deepEqual(statesOf(gladys, 'elite.10002:status'), [
    'Prochain match · dim. 1 nov., 18:00 · contre PAR',
  ]);
});

test('a live game: start, points, end, one scene event per transition', async () => {
  const { gladys, ffbb, tracker, clock } = setup({
    teams: 'ELITE:Monaco',
    now: '2026-11-01T18:00Z',
    language: 'en',
  });
  await tracker.refresh();
  gladys.createAll();
  assert.ok(!ffbb.calls.includes('lives'), 'one hour before: no live feed yet');

  clock.now = Date.parse('2026-11-01T19:05Z');
  liveGame(ffbb, { monaco: 5, levallois: 2 });
  await tracker.refresh();
  assert.ok(ffbb.calls.includes('lives'));
  assert.deepEqual(
    gladys.sceneEvents.map((e) => e.key),
    [TRIGGERS.MATCH_STARTED],
  );
  assert.deepEqual(statesOf(gladys, ':team-score'), [5]);
  assert.deepEqual(statesOf(gladys, ':status'), ['Live · Q1 07:30 · MON 5 – 2 PLB']);

  clock.now += 30_000;
  liveGame(ffbb, { monaco: 9, levallois: 2, period: 'Q2' });
  await tracker.refresh();
  const scored = gladys.sceneEvents.at(-1);
  assert.equal(scored.key, TRIGGERS.TEAM_SCORED);
  assert.equal(scored.data.points, 4);
  assert.equal(scored.data.team, MONACO_DEVICE);
  assert.equal(scored.data.competition, 'Betclic ELITE');

  // The FFBB enters the final score: the game is over.
  clock.now = Date.parse('2026-11-01T21:10Z');
  Object.assign(ffbb.game(NEXT_GAME), { joue: 1, resultatEquipe1: '81', resultatEquipe2: '77' });
  ffbb.liveGames = [];
  await tracker.refresh();
  const keys = gladys.sceneEvents.map((e) => e.key);
  assert.deepEqual(keys.slice(-3), [
    TRIGGERS.TEAM_SCORED,
    TRIGGERS.OPPONENT_SCORED,
    TRIGGERS.MATCH_ENDED,
  ]);
  const ended = gladys.sceneEvents.at(-1).data;
  assert.equal(ended.result, 'win');
  assert.equal(ended.summary, 'Final · MON 81 – 77 PLB · Win');
});

test('the reminder fires once, before tip-off', async () => {
  const { gladys, tracker, clock } = setup({ teams: 'ELITE:Monaco', now: '2026-11-01T18:00Z' });
  await tracker.refresh();
  assert.deepEqual(gladys.sceneEvents, []);
  clock.now = Date.parse('2026-11-01T18:35Z');
  await tracker.refresh();
  clock.now += 60_000;
  await tracker.refresh();
  assert.deepEqual(
    gladys.sceneEvents.map((e) => [e.key, e.data.minutes]),
    [[TRIGGERS.MATCH_SOON, 25]],
  );
});

test('the pace: idle, woken at the reminder, live during the game', async () => {
  const { tracker, clock } = setup({ teams: 'ELITE:Monaco', now: '2026-10-28T10:00Z' });
  await tracker.refresh();
  assert.equal(tracker.nextDelay(), 15 * 60_000);
  clock.now = Date.parse('2026-11-01T18:20Z');
  // 10 minutes to the 30-minute reminder.
  assert.equal(tracker.nextDelay(), 10 * 60_000);
  clock.now = Date.parse('2026-11-01T19:01Z');
  assert.equal(tracker.nextDelay(), 30_000);
});

test('an unknown team, an ambiguous one and a bad entry are reported, not followed', async () => {
  const { gladys, tracker } = setup({ teams: 'ELITE:Cholet, ELITE:Paris, Monaco, XX!:Foo' });
  await tracker.refresh();
  const [cholet, paris] = tracker.list();
  assert.equal(cholet.resolveError, 'not_found');
  assert.equal(paris.resolveError, 'ambiguous');
  assert.deepEqual(
    tracker.parseErrors.map((e) => e.reason),
    ['format', 'competition'],
  );
  const status = gladys.connectionStatuses.at(-1);
  assert.equal(status.connected, false);
  for (const entry of ['ELITE:Cholet', 'ELITE:Paris', 'Monaco', 'XX!:Foo']) {
    assert.ok(status.message.fr.includes(entry), entry);
  }
});

test('a competition the FFBB does not know this season', async () => {
  const { tracker, ffbb } = setup({ teams: 'NM1:Rouen' });
  await tracker.refresh();
  assert.equal(tracker.list()[0].resolveError, 'competition_not_found');
  // Searched by code, then by name.
  assert.deepEqual(ffbb.calls, ['competitions NM1', 'search nationale', 'search nm1']);
});

test('a competition under another code is found by its name', async () => {
  const { tracker, ffbb, gladys } = setup({ teams: 'ELITE:Monaco' });
  const [current, previous] = ffbb.competitionsByCode.ELITE;
  ffbb.competitionsByCode = {};
  ffbb.otherCompetitions = [
    { ...current, nom: 'BETCLIC ELITE', code: 'LNBM' },
    { ...previous, nom: 'BETCLIC ELITE', code: 'LNBM' },
    {
      id: 1,
      nom: 'ESPOIRS BETCLIC ELITE',
      code: 'ESP',
      saison: current.saison,
      poules: [{ id: 99 }],
    },
  ];
  await tracker.refresh();
  assert.equal(tracker.list()[0].info?.name, 'Monaco');
  assert.ok(!ffbb.calls.includes('poule 99'), 'the youth competition is left aside');
  assert.equal(gladys.discovered.at(-1)[0].external_id, MONACO_DEVICE);
});

test('a competition not found is looked for again after an hour, not a day', async () => {
  const { tracker, ffbb, clock } = setup({ teams: 'NM1:Rouen' });
  await tracker.refresh();
  ffbb.calls.length = 0;
  clock.now += 30 * 60_000;
  await tracker.refresh();
  assert.deepEqual(ffbb.calls, []);
  clock.now += 31 * 60_000;
  await tracker.refresh();
  assert.equal(ffbb.calls[0], 'competitions NM1');
});

test('an outage keeps the last game and flags the device unreachable', async () => {
  const { gladys, ffbb, tracker, clock } = setup({ teams: 'ELITE:Monaco' });
  await tracker.refresh();
  ffbb.down = true;
  clock.now += 15 * 60_000;
  await tracker.refresh();
  const monaco = tracker.list()[0];
  assert.equal(monaco.match.id, NEXT_GAME);
  assert.equal(monaco.reachable, false);
  assert.equal(gladys.transports.at(-1).transport, 'unreachable');
  assert.equal(gladys.connectionStatuses.at(-1).connected, false);
});

test('a restart neither replays nor misses an event', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ffbb-'));
  try {
    const store = createStore(join(dir, 'ffbb.json'));
    const first = setup({ teams: 'ELITE:Monaco', now: '2026-11-01T19:05Z', store });
    liveGame(first.ffbb, { monaco: 10, levallois: 8 });
    await first.tracker.refresh();
    assert.deepEqual(first.gladys.sceneEvents, []);

    // A new process, the game went on meanwhile.
    const second = setup({ teams: 'ELITE:Monaco', now: '2026-11-01T19:20Z', store });
    await second.tracker.load();
    second.tracker.configure(second.tracker.config);
    liveGame(second.ffbb, { monaco: 12, levallois: 8 });
    await second.tracker.refresh();
    assert.deepEqual(
      second.gladys.sceneEvents.map((e) => [e.key, e.data.points]),
      [[TRIGGERS.TEAM_SCORED, 2]],
    );
    // The resolved team was saved: no need to wait for the FFBB to know it.
    assert.equal(second.tracker.list()[0].info.id, '10001');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the same club written twice only makes one device', async () => {
  const { gladys, tracker } = setup({ teams: 'ELITE:Monaco, ELITE:MON' });
  await tracker.refresh();
  assert.equal(gladys.discovered.at(-1).length, 1);
});

test('the next game stays on the device while the last result is shown', async () => {
  // The day after Monaco lost in Paris: the status tells the result, the
  // next-match feature the game of Nov 1.
  const { gladys, tracker } = setup({ teams: 'ELITE:Monaco', now: '2026-10-26T08:00Z' });
  await tracker.refresh();
  gladys.createAll();
  await tracker.refresh();
  assert.deepEqual(statesOf(gladys, ':status'), ['Terminé · MON 88 – 90 PAR · Défaite']);
  assert.deepEqual(statesOf(gladys, ':next-match'), ['dim. 1 nov., 20:00 · contre PLB']);
  assert.deepEqual(
    tracker.list()[0].upcoming.map((m) => m.id),
    [NEXT_GAME],
  );
  assert.deepEqual(tracker.list()[0].stats, { games: 3, upcoming: 1, undated: 0, sampleDate: '' });
});

test('no game to come: the next-match feature says so', async () => {
  const { gladys, tracker } = setup({ teams: 'ELITE:Monaco', now: '2026-11-05T08:00Z' });
  await tracker.refresh();
  gladys.createAll();
  await tracker.refresh();
  assert.deepEqual(statesOf(gladys, ':next-match'), ['Aucun match prévu']);
});
