import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from '../src/config.js';
import { Tracker } from '../src/tracker.js';
import {
  createWidgets,
  MY_TEAMS_WIDGET,
  TEAM_MATCH_WIDGET,
  UPCOMING_WIDGET,
  DEFAULT_UPCOMING_COUNT,
} from '../src/widgets.js';
import { createFakeFfbb } from './helpers/fakeFfbb.js';
import { createFakeGladys } from './helpers/fakeGladys.js';

const MONACO = 'ext:test:team:nm1.10001';

async function setup({ now = '2026-11-01T19:30Z', live = true } = {}) {
  const gladys = createFakeGladys();
  const ffbb = createFakeFfbb();
  if (live) {
    ffbb.liveGames = [
      {
        matchId: '2462003',
        matchStatus: 'LIVE',
        currentPeriod: 'Q2',
        clock: '03:00:000',
        score_home: 40,
        score_out: 38,
      },
    ];
  }
  const tracker = new Tracker({
    gladys,
    client: ffbb,
    now: () => Date.parse(now),
    setTimer: () => 0,
    clearTimer: () => {},
  });
  const config = normalizeConfig({ teams: 'NM1:Monaco, NM1:ASVEL' });
  tracker.configure(config);
  await tracker.refresh();
  return { gladys, tracker, config, widgets: createWidgets(tracker) };
}

test('team_match renders exactly as sent, live tiles once the device exists', async () => {
  const { gladys, config, widgets } = await setup();
  const before = await widgets[TEAM_MATCH_WIDGET].get(gladys, {
    settings: { team: MONACO },
    config,
  });
  assert.deepEqual(validateWidgetContent(before), []);
  assert.equal(before.ttl_seconds, 30);
  assert.equal(before.components[0].text, 'MON 40 – 38 PLB');
  assert.equal(before.components[2].value, 40);

  gladys.createAll();
  const after = await widgets[TEAM_MATCH_WIDGET].get(gladys, {
    settings: { team: MONACO },
    config,
  });
  assert.deepEqual(validateWidgetContent(after), []);
  assert.equal(after.components[2].device_feature, `${MONACO}:team-score`);
});

test('team_match without a chosen team, and before any game', async () => {
  const { gladys, config, widgets } = await setup({ now: '2026-10-28T10:00Z', live: false });
  const empty = await widgets[TEAM_MATCH_WIDGET].get(gladys, { settings: {}, config });
  assert.deepEqual(validateWidgetContent(empty), []);
  const next = await widgets[TEAM_MATCH_WIDGET].get(gladys, { settings: { team: MONACO }, config });
  assert.deepEqual(validateWidgetContent(next), []);
  assert.equal(next.components[0].text, 'MON – PLB');
});

test('my_teams lists the live games first', async () => {
  const { gladys, config, widgets } = await setup();
  const content = await widgets[MY_TEAMS_WIDGET].get(gladys, { config });
  assert.deepEqual(validateWidgetContent(content), []);
  const items = content.components[0].items;
  assert.deepEqual(
    items.map((i) => i.title),
    ['Monaco', 'ASVEL'],
  );
  assert.deepEqual(items[0].badge.text, { en: 'LIVE', fr: 'DIRECT' });
});

test('the refresh button reads again; an unknown action fails', async () => {
  const { gladys, config, widgets } = await setup();
  const message = await widgets[MY_TEAMS_WIDGET].action(gladys, { actionKey: 'refresh', config });
  assert.deepEqual(message, { en: 'Scores refreshed', fr: 'Scores actualisés' });
  await assert.rejects(widgets[MY_TEAMS_WIDGET].action(gladys, { actionKey: 'nope', config }));
});

test('upcoming_matches lists the next games of every team, soonest first', async () => {
  const { gladys, config, widgets } = await setup({ now: '2026-10-28T10:00Z', live: false });
  const content = await widgets[UPCOMING_WIDGET].get(gladys, { config });
  assert.deepEqual(validateWidgetContent(content), []);
  const items = content.components[0].items;
  assert.deepEqual(
    items.map((i) => i.title),
    ['ASVEL – Paris Basketball', 'Monaco – Paris Levallois'],
  );
  assert.deepEqual(items[0].subtitle, {
    en: 'Sun 1 Nov, 18:00 · Nationale 1',
    fr: 'dim. 1 nov., 18:00 · Nationale 1',
  });
  assert.deepEqual(items[0].badge.text, { en: 'home', fr: 'domicile' });
});

test('upcoming_matches without any game to come', async () => {
  const { gladys, config, widgets } = await setup({ now: '2026-11-05T10:00Z', live: false });
  const content = await widgets[UPCOMING_WIDGET].get(gladys, { config });
  assert.deepEqual(validateWidgetContent(content), []);
  assert.match(content.components[0].text.fr, /Aucun match à venir/);
});

test('upcoming_matches shows as many games as its count setting, 8 at most', async () => {
  const { gladys, config, widgets, tracker } = await setup({
    now: '2026-10-28T10:00Z',
    live: false,
  });
  // Ten games to come, spread over the teams.
  for (const [index, t] of tracker.list().entries()) {
    t.upcoming = Array.from({ length: 5 }, (_, i) => ({
      ...t.upcoming[0],
      id: `g${index}-${i}`,
      kickoff: new Date(
        Date.parse('2026-11-01T19:00Z') + (i * 2 + index) * 86_400_000,
      ).toISOString(),
    }));
  }
  const items = async (settings) =>
    (await widgets[UPCOMING_WIDGET].get(gladys, { settings, config })).components[0].items;
  assert.equal((await items({})).length, DEFAULT_UPCOMING_COUNT);
  assert.equal((await items({ count: 3 })).length, 3);
  assert.equal((await items({ count: '7' })).length, 7);
  assert.equal((await items({ count: 50 })).length, 8);
  assert.equal((await items({ count: 0 })).length, DEFAULT_UPCOMING_COUNT);
  const content = await widgets[UPCOMING_WIDGET].get(gladys, { settings: { count: 8 }, config });
  assert.deepEqual(validateWidgetContent(content), []);
  // Soonest first, whatever the team.
  const dates = content.components[0].items.map((i) => i.subtitle.en);
  assert.equal(dates[0].startsWith('Sun 1 Nov'), true);
});

test('upcoming_matches count matches the manifest setting', async () => {
  const { readFile } = await import('node:fs/promises');
  const manifest = JSON.parse(
    await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
  );
  const field = manifest.widgets
    .find((w) => w.key === UPCOMING_WIDGET)
    .settings.find((s) => s.key === 'count');
  assert.deepEqual(
    [field.type, field.default, field.min, field.max],
    ['number', DEFAULT_UPCOMING_COUNT, 1, 8],
  );
});
