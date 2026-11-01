// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The store validator checks the manifest grammar; nothing there can know
// which handlers the code registers: these tests keep both sides in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { DEFAULT_CONFIG } from '../src/config.js';
import { TRIGGERS } from '../src/events.js';
import { createApp } from '../src/app.js';
import { createSceneActions } from '../src/scenes.js';
import { PERIODS } from '../src/stats.js';
import { FUELS } from '../src/vehicle.js';
import { createMemoryStore } from '../src/store.js';
import { WIDGET_KEYS } from '../src/widgets.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

const keysOf = (list) => (list ?? []).map((entry) => entry.key);
const field = (key) => manifest.config_schema.find((entry) => entry.key === key);

const allFields = [
  ...manifest.config_schema,
  ...[...manifest.actions, ...manifest.scene_triggers, ...manifest.scene_actions].flatMap(
    (item) => item.fields ?? [],
  ),
  ...manifest.widgets.flatMap((widget) => widget.settings ?? []),
];

test('every manifest action has a handler', async () => {
  const gladys = createFakeGladys({ config: {} });
  createApp({ gladys, store: createMemoryStore(), fetch: async () => new Response('[]') });
  for (const key of keysOf(manifest.actions)) {
    const ack = await gladys.fake.action(key, {});
    assert.notEqual(ack.error?.code, 'NO_HANDLER', `action "${key}" has no handler`);
    assert.equal(ack.success, true, `action "${key}": ${JSON.stringify(ack.error)}`);
  }
});

test('scene triggers fired = scene triggers declared', () => {
  assert.deepEqual(keysOf(manifest.scene_triggers).sort(), Object.values(TRIGGERS).sort());
});

test('scene actions handled = scene actions declared', () => {
  assert.deepEqual(keysOf(manifest.scene_actions).sort(), Object.keys(createSceneActions()).sort());
});

test('widgets handled = widgets declared', () => {
  assert.deepEqual(keysOf(manifest.widgets).sort(), [...WIDGET_KEYS].sort());
});

test('config_schema defaults are DEFAULT_CONFIG, and every value field has one', () => {
  for (const entry of manifest.config_schema) {
    if (['section', 'oauth2'].includes(entry.type) || entry.source) {
      assert.ok(!(entry.key in DEFAULT_CONFIG) || entry.source, `${entry.key} stores no value`);
      continue;
    }
    assert.ok(entry.key in DEFAULT_CONFIG, `${entry.key} is missing from DEFAULT_CONFIG`);
    if (entry.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[entry.key], entry.default, `default of ${entry.key}`);
    }
  }
});

test('the select options are the values the code knows', () => {
  assert.deepEqual(
    field('fuel_type').options.map((option) => option.value),
    Object.keys(FUELS),
  );
  for (const declaration of [manifest.scene_actions[0], manifest.widgets[0]]) {
    const period = [...(declaration.fields ?? []), ...(declaration.settings ?? [])].find(
      (entry) => entry.key === 'period',
    );
    assert.deepEqual(
      period.options.map((option) => option.value),
      PERIODS,
    );
  }
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  assert.equal(manifest.version, pkg.version);
  assert.ok(manifest.docker_image.endsWith(`:${manifest.version}`));
});

test('texts are multi-language objects, the catalog description 10 to 100 characters', () => {
  for (const [lang, text] of Object.entries(manifest.description)) {
    assert.ok(text.length >= 10 && text.length <= 100, `description.${lang}: ${text.length}`);
  }
  for (const entry of allFields) {
    for (const key of ['label', 'description', 'placeholder']) {
      if (entry[key] !== undefined) {
        assert.equal(typeof entry[key], 'object', `${entry.key}.${key}`);
        assert.ok(entry[key].en && entry[key].fr, `${entry.key}.${key} needs en and fr`);
      }
    }
  }
});

test('section fields store nothing', () => {
  for (const section of manifest.config_schema.filter((entry) => entry.type === 'section')) {
    assert.equal(section.required, undefined);
    assert.equal(section.default, undefined);
    assert.equal(section.placeholder, undefined);
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//);
    }
  }
});

test('the integration reads the house location and declares it', () => {
  // getHouses() is a 403 without it.
  assert.equal(manifest.location, true);
  assert.equal(field('house').source, 'houses');
  assert.equal(field('strava').type, 'oauth2');
  assert.equal(field('client_secret').type, 'secret');
});

test('scene triggers, actions, widgets and keywords require Gladys >= 5.3.0', () => {
  const [major, minor] = manifest.gladys_version
    .match(/>=\s*(\d+)\.(\d+)/)
    .slice(1)
    .map(Number);
  assert.ok(major > 5 || (major === 5 && minor >= 3), manifest.gladys_version);
});
