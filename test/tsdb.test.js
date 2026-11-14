import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeConfig } from '../src/config.js';
import { TRIGGERS } from '../src/events.js';
import { Tracker } from '../src/tracker.js';
import { createTsdbClient, TsdbBusyError, TsdbError } from '../src/tsdb/client.js';
import { MAX_UPCOMING } from '../src/ffbb/parse.js';
import { createLnbSource, eventToRencontre, pouleId } from '../src/tsdb/source.js';
import { createFakeFfbb } from './helpers/fakeFfbb.js';
import { createFakeGladys } from './helpers/fakeGladys.js';

// Real TheSportsDB answers for Betclic ELITE, Nov. 2026, trimmed to the fields read.
const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
const ROUNDS = {
  7: fixture('tsdb-elite-round-7').events,
  8: fixture('tsdb-elite-round-8').events,
  9: fixture('tsdb-elite-round-9').events,
};
const NEXT = fixture('tsdb-elite-next').events[0];
const LEAGUE = fixture('tsdb-elite-league').leagues[0];

/** The client methods the LNB source calls, answering from the fixtures. */
function fakeTsdbClient() {
  return {
    calls: [],
    rounds: ROUNDS,
    down: false,
    async league(id) {
      this.calls.push(`league ${id}`);
      if (this.down) throw new TsdbError('TheSportsDB unreachable: test outage');
      return LEAGUE;
    },
    async nextEvent(id) {
      this.calls.push(`next ${id}`);
      if (this.down) throw new TsdbError('TheSportsDB unreachable: test outage');
      return NEXT;
    },
    async pastEvent(id) {
      this.calls.push(`past ${id}`);
      return null;
    },
    async round(id, season, round) {
      this.calls.push(`round ${round}`);
      if (this.down) throw new TsdbError('TheSportsDB unreachable: test outage');
      return JSON.parse(JSON.stringify(this.rounds[round] ?? []));
    },
  };
}

const find = (round, team) =>
  ROUNDS[round].find((e) => e.strHomeTeam === team || e.strAwayTeam === team);

test('a final game, a scheduled one and a postponed one, as FFBB rencontres', () => {
  const final = eventToRencontre(find(8, 'Paris Basketball'));
  assert.deepEqual(
    {
      joue: final.joue,
      home: [final.nomEquipe1, final.resultatEquipe1],
      away: [final.nomEquipe2, final.resultatEquipe2],
      date: final.date_rencontre,
      round: final.numeroJournee,
    },
    {
      joue: 1,
      home: ['Limoges', '82'],
      away: ['Paris Basketball', '97'],
      date: '2026-11-14T19:30:00.000Z',
      round: '8',
    },
  );
  assert.equal(final.idOrganismeEquipe2.id, final.idEngagementEquipe2.id);

  const scheduled = eventToRencontre(find(9, 'Lyon-Villeurbanne'));
  assert.equal(scheduled.joue, 0);
  assert.equal(scheduled.resultatEquipe1, null);
  assert.equal(scheduled.remise, false);

  const postponed = eventToRencontre({ ...find(9, 'Dijon'), strStatus: 'PST' });
  assert.equal(postponed.remise, true);
  const canceled = eventToRencontre({ ...find(9, 'Dijon'), strStatus: 'CANC' });
  assert.equal(canceled.gsId.currentStatus, 'CANCELED');
});

test('the window of rounds: the previous one to MAX_UPCOMING after the current one', async () => {
  const client = fakeTsdbClient();
  const source = createLnbSource(client);
  const { competitions, poules, window } = await source.competition({
    tsdbLeague: '4423',
    competitionName: 'Betclic ELITE',
  });
  // Round 8 is current: from 7 to 8 + MAX_UPCOMING.
  assert.deepEqual(
    window,
    Array.from({ length: MAX_UPCOMING + 2 }, (_, i) => pouleId('4423', '2026-2027', 7 + i)),
  );
  // Only what finding the teams needs is read now.
  assert.deepEqual([...poules.keys()], window.slice(0, 2));
  assert.deepEqual(client.calls, ['league 4423', 'next 4423', 'round 7', 'round 8']);
  assert.equal(competitions[0].nom, 'French LNB 2026-2027');
  assert.equal(poules.get(window[1]).rencontres.length, 8);
});

test('a round the quota does not allow yet holds no game and is pending', async () => {
  const client = fakeTsdbClient();
  client.round = async () => {
    throw new TsdbBusyError('eventsround.php');
  };
  const source = createLnbSource(client);
  const id = pouleId('4423', '2026-2027', 12);
  assert.deepEqual((await source.poule(id)).rencontres, []);
  assert.equal(source.pending(), 1);
  client.round = async () => ROUNDS[9];
  assert.equal((await source.poule(id)).rencontres.length, 8);
  assert.equal(source.pending(), 0);
});

function setup({ teams, now }) {
  const gladys = createFakeGladys();
  const ffbb = createFakeFfbb();
  const tsdb = fakeTsdbClient();
  const clock = { now: Date.parse(now) };
  const tracker = new Tracker({
    gladys,
    client: ffbb,
    lnb: createLnbSource(tsdb),
    now: () => clock.now,
    setTimer: () => 0,
    clearTimer: () => {},
  });
  tracker.configure(normalizeConfig({ teams }));
  return { gladys, ffbb, tsdb, tracker, clock };
}

test('ASVEL and Paris in Betclic ELITE: nicknames, next games, last result', async () => {
  const { gladys, ffbb, tracker } = setup({
    teams: 'ELITE:ASVEL, ELITE:Paris',
    now: '2026-11-15T08:00Z',
  });
  await tracker.refresh();
  assert.deepEqual(ffbb.calls, [], 'the FFBB is not asked for the LNB championships');

  const [asvel, paris] = tracker.list();
  assert.equal(asvel.info.name, 'Lyon-Villeurbanne');
  assert.equal(paris.info.name, 'Paris Basketball');
  assert.deepEqual(
    gladys.discovered.at(-1).map((d) => [d.name, d.external_id]),
    [
      ['Lyon-Villeurbanne (Betclic ELITE)', `ext:test:team:elite.${asvel.info.id}`],
      ['Paris Basketball (Betclic ELITE)', `ext:test:team:elite.${paris.info.id}`],
    ],
  );
  // ASVEL plays in Le Mans tonight, then hosts Bourg.
  assert.deepEqual(
    asvel.upcoming.map((m) => [m.opponent.name, m.homeAway, m.kickoff]),
    [
      ['Le Mans Sarthe Basket', 'away', '2026-11-15T18:00:00.000Z'],
      ['Bourg-en-Bresse', 'home', '2026-11-22T18:00:00.000Z'],
    ],
  );
  // Paris won in Limoges last night: the result is shown, the next game kept.
  assert.deepEqual(
    [paris.match.state, paris.match.result, paris.match.team.score, paris.match.opponent.score],
    ['post', 'win', 97, 82],
  );
  assert.equal(paris.upcoming[0].opponent.name, 'Gravelines-Dunkerque');

  gladys.createAll();
  await tracker.refresh();
  const states = (suffix) =>
    gladys.published.filter((p) => p.featureExternalId.endsWith(suffix)).map((p) => p.state);
  assert.deepEqual(states(`elite.${paris.info.id}:next-match`), [
    'dim. 22 nov., 16:30 · contre Gravelines-Dunkerque',
  ]);
});

test('the end of a game read from TheSportsDB fires "game ended", no live feed asked', async () => {
  const { gladys, ffbb, tsdb, tracker, clock } = setup({
    teams: 'ELITE:ASVEL',
    now: '2026-11-15T17:00Z',
  });
  await tracker.refresh();
  // The game is over: TheSportsDB has the final score.
  clock.now = Date.parse('2026-11-15T20:30Z');
  const game = tsdb.rounds[8].find((e) => e.strAwayTeam === 'Lyon-Villeurbanne');
  Object.assign(game, { strStatus: 'FT', intHomeScore: '80', intAwayScore: '88' });
  await tracker.refresh();
  assert.deepEqual(
    gladys.sceneEvents.map((e) => [e.key, e.data.result]),
    [[TRIGGERS.MATCH_ENDED, 'win']],
  );
  assert.ok(!ffbb.calls.includes('lives'));
});

test('TheSportsDB down: the last game is kept and the badge says unreachable', async () => {
  const { gladys, tsdb, tracker, clock } = setup({
    teams: 'ELITE:ASVEL',
    now: '2026-11-15T08:00Z',
  });
  await tracker.refresh();
  tsdb.down = true;
  clock.now += 15 * 60_000;
  await tracker.refresh();
  assert.equal(tracker.list()[0].reachable, false);
  assert.equal(tracker.list()[0].match.opponent.name, 'Le Mans Sarthe Basket');
  assert.equal(gladys.transports.at(-1).transport, 'unreachable');
});

test('the client: free key in the path, rounds cached, errors typed', async () => {
  const calls = [];
  let clock = Date.parse('2026-11-15T08:00Z');
  const fetch = async (url) => {
    calls.push(url);
    if (url.includes('eventsround')) {
      return { ok: true, status: 200, json: async () => ({ events: ROUNDS[8] }) };
    }
    return { ok: false, status: 429, json: async () => ({}) };
  };
  const client = createTsdbClient({ fetch, now: () => clock, sleep: async () => {} });
  assert.equal((await client.round('4423', '2026-2027', 8)).length, 8);
  await client.round('4423', '2026-2027', 8);
  assert.deepEqual(calls, [
    'https://www.thesportsdb.com/api/v1/json/123/eventsround.php?id=4423&r=8&s=2026-2027',
  ]);
  // A game of round 8 is today: the round is read again after two minutes.
  clock += 3 * 60_000;
  await client.round('4423', '2026-2027', 8);
  assert.equal(calls.length, 2);
  await assert.rejects(
    client.nextEvent('4423'),
    (err) => err instanceof TsdbError && err.status === 429,
  );
});

test('the client keeps under the quota, waits out a 429, serves stale answers', async () => {
  let clock = Date.parse('2026-11-15T08:00Z');
  const slept = [];
  const calls = [];
  let refuse = false;
  const fetch = async (url) => {
    calls.push(url);
    if (refuse) {
      return {
        ok: false,
        status: 429,
        headers: new Headers({ 'retry-after': '120' }),
        json: async () => ({}),
      };
    }
    return {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ events: ROUNDS[7] }),
    };
  };
  const client = createTsdbClient({
    fetch,
    rateLimit: 2,
    now: () => clock,
    sleep: async (ms) => {
      slept.push(ms);
      clock += ms;
    },
  });
  // Rounds 20, 21: in quota. Round 22 waits for the oldest to be a minute old.
  await client.round('4423', '2026-2027', 20);
  await client.round('4423', '2026-2027', 21);
  await client.round('4423', '2026-2027', 22);
  assert.deepEqual(slept, [60_000]);
  // A minute later: one slot again (round 23), then none.
  await client.round('4423', '2026-2027', 23);
  assert.deepEqual(slept, [60_000]);
  // Without waiting: no quota left, nothing read before → busy.
  await assert.rejects(client.round('4423', '2026-2027', 26, { wait: false }), TsdbBusyError);

  // A 429 pauses every request for its Retry-After.
  clock += 61_000;
  refuse = true;
  await assert.rejects(client.nextEvent('4423'), (err) => err.status === 429);
  refuse = false;
  slept.length = 0;
  await client.nextEvent('4423');
  assert.ok(slept[0] >= 119_000, `waited ${slept[0]} ms`);

  // Round 20 expired (6 h) but the quota is used: its last answer comes back.
  clock += 7 * 60 * 60 * 1000;
  await client.round('4423', '2026-2027', 30);
  await client.round('4423', '2026-2027', 31);
  const before = calls.length;
  assert.equal((await client.round('4423', '2026-2027', 20, { wait: false })).length, 8);
  assert.equal(calls.length, before);
});

test('test_teams says the games to come are still being read, not that there are none', async () => {
  const { testTeams } = await import('../src/actions.js');
  const { tsdb, tracker } = setup({ teams: 'ELITE:Paris', now: '2026-11-15T08:00Z' });
  // The quota lets the previous and current rounds through, not the later ones.
  const round = tsdb.round.bind(tsdb);
  tsdb.round = async (id, season, r, options) => {
    if (r > 8) throw new TsdbBusyError('eventsround.php');
    return round(id, season, r, options);
  };
  const message = await testTeams(tracker);
  assert.match(message.fr, /encore en cours de lecture chez TheSportsDB/);
  assert.doesNotMatch(message.fr, /aucun match à venir/);
});
