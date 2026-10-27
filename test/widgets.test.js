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
} from '../src/widgets.js';
import { createFakeFfbb } from './helpers/fakeFfbb.js';
import { createFakeGladys } from './helpers/fakeGladys.js';

const MONACO = 'ext:test:team:elite.10001';

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
  const config = normalizeConfig({ teams: 'ELITE:Monaco, ELITE:ASVEL' });
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
    en: 'Sun 1 Nov, 18:00 · Betclic ELITE',
    fr: 'dim. 1 nov., 18:00 · Betclic ELITE',
  });
  assert.deepEqual(items[0].badge.text, { en: 'home', fr: 'domicile' });
});

test('upcoming_matches without any game to come', async () => {
  const { gladys, config, widgets } = await setup({ now: '2026-11-05T10:00Z', live: false });
  const content = await widgets[UPCOMING_WIDGET].get(gladys, { config });
  assert.deepEqual(validateWidgetContent(content), []);
  assert.match(content.components[0].text.fr, /Aucun match à venir/);
});
