import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeConfig } from '../src/config.js';
import { eventData } from '../src/events.js';
import { createSceneActions, GET_MATCH } from '../src/scenes.js';
import { Tracker } from '../src/tracker.js';
import { createFakeFfbb } from './helpers/fakeFfbb.js';
import { createFakeGladys } from './helpers/fakeGladys.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

async function setup() {
  const ffbb = createFakeFfbb();
  const tracker = new Tracker({
    gladys: createFakeGladys(),
    client: ffbb,
    now: () => Date.parse('2026-10-26T08:00Z'),
    setTimer: () => 0,
    clearTimer: () => {},
  });
  const config = normalizeConfig({ teams: 'ELITE:Monaco', language: 'en' });
  tracker.configure(config);
  await tracker.refresh();
  return { tracker, ffbb, config };
}

test('get_match gives the outputs the manifest declares, from the cache', async () => {
  const { tracker, ffbb, config } = await setup();
  ffbb.calls.length = 0;
  const outputs = await createSceneActions(tracker)[GET_MATCH](null, {
    fields: { team: 'ext:test:team:elite.10001' },
    config,
  });
  assert.deepEqual(ffbb.calls, [], 'never reads the FFBB');
  const declared = manifest.scene_actions.find((a) => a.key === GET_MATCH).outputs;
  assert.deepEqual(Object.keys(outputs).sort(), declared.map((o) => o.key).sort());
  assert.deepEqual(outputs, {
    state: 'post',
    is_live: false,
    team_score: 88,
    opponent_score: 90,
    opponent: 'Paris Basketball',
    kickoff: '2026-10-25T17:30:00.000Z',
    result: 'loss',
    summary: 'Final · MON 88 – 90 PAR · Loss',
  });
});

test('every trigger event carries only declared keys, and every declared variable', async () => {
  const { tracker } = await setup();
  const { match } = tracker.list()[0];
  for (const trigger of manifest.scene_triggers) {
    const data = eventData(
      { key: trigger.key, match, points: 2, minutes: 30 },
      'device',
      'ELITE',
      'x',
    );
    const fields = trigger.fields.map((f) => f.key);
    const variables = trigger.variables.map((v) => v.key);
    for (const key of Object.keys(data)) {
      assert.ok(fields.includes(key) || variables.includes(key), `${trigger.key}: ${key}`);
    }
    for (const key of variables) {
      assert.ok(key in data, `${trigger.key} never sends ${key}`);
    }
  }
});

test('get_match on a team no longer followed throws', async () => {
  const { tracker, config } = await setup();
  await assert.rejects(
    createSceneActions(tracker)[GET_MATCH](null, { fields: { team: 'nope' }, config }),
    /not a followed team/,
  );
});
