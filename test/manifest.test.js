// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_CONFIG } from '../src/config.js';
import { TRIGGERS } from '../src/events.js';
import { COMPETITIONS } from '../src/competitions.js';
import { LANGUAGES as WRITTEN } from '../src/format.js';
import { createSceneActions } from '../src/scenes.js';
import { createWidgets, WIDGET_KEYS } from '../src/widgets.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const indexJs = await readFile(new URL('../index.js', import.meta.url), 'utf8');

// Every list of form fields the manifest declares (same field grammar).
const allFields = [
  ...manifest.config_schema,
  ...[...manifest.actions, ...manifest.scene_triggers, ...manifest.scene_actions].flatMap(
    (item) => item.fields ?? [],
  ),
  ...manifest.widgets.flatMap((widget) => widget.settings ?? []),
];

const keysOf = (list) => (list ?? []).map((entry) => entry.key);

function minGladysVersion() {
  const match = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  return match.slice(1).map(Number);
}

function isAtLeast(version, required) {
  for (let i = 0; i < required.length; i += 1) {
    if (version[i] !== required[i]) {
      return version[i] > required[i];
    }
  }
  return true;
}

test('every manifest action is registered in index.js', () => {
  for (const { key } of manifest.actions) {
    assert.ok(indexJs.includes(`gladys.onAction('${key}'`), `action "${key}" has no handler`);
  }
});

test('the integration reaches the FFBB over the internet: cloud transport only', () => {
  assert.deepEqual(manifest.transports, ['cloud']);
  assert.equal(manifest.type, 'device');
});

test('scene triggers, scene actions, widgets and categories require Gladys >= 5.1.0', () => {
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
  assert.ok(
    isAtLeast(minGladysVersion(), [5, 1, 0]),
    `got "${manifest.gladys_version}", scene and widget declarations need >=5.1.0`,
  );
});

test('keywords, countries and music require Gladys >= 5.3.0', () => {
  if (['keywords', 'countries', 'music'].some((field) => manifest[field] !== undefined)) {
    assert.ok(
      isAtLeast(minGladysVersion(), [5, 3, 0]),
      `got "${manifest.gladys_version}", keywords / countries / music need >=5.3.0`,
    );
  }
});

test('the categories stay inside the vocabulary the store indexes', () => {
  const vocabulary = [
    'climate',
    'lighting',
    'energy',
    'security',
    'multimedia',
    'appliances',
    'environment',
    'protocols',
    'network',
    'notifications',
    'assistants',
    'services',
    // Added to the vocabulary in 2026-10.
    'transport',
    'vehicles',
    'servers',
    'leisure',
  ];
  assert.equal(new Set(manifest.categories).size, manifest.categories.length);
  for (const category of manifest.categories) {
    assert.ok(vocabulary.includes(category), `unknown category "${category}"`);
  }
  // Following basketball teams is a pastime: the shelf the store proposes for it.
  assert.ok(manifest.categories.includes('leisure'));
});

test('the search keywords follow the store rules', () => {
  // 1 to 10 unique terms of 2 to 30 characters, compared trimmed and
  // lowercased. Never displayed: only the catalog search reads them.
  const { keywords } = manifest;
  assert.ok(Array.isArray(keywords) && keywords.length >= 1 && keywords.length <= 10);
  for (const keyword of keywords) {
    assert.equal(typeof keyword, 'string');
    const { length } = keyword.trim();
    assert.ok(length >= 2 && length <= 30, `keyword "${keyword}": ${length} characters`);
  }
  const normalized = keywords.map((keyword) => keyword.trim().toLowerCase());
  assert.equal(new Set(normalized).size, normalized.length, 'keywords must be unique');
});

test('no countries restriction: French basketball has fans abroad too', () => {
  // Declaring `countries` would hide the integration from the shelves of
  // every instance located outside France.
  assert.equal(manifest.countries, undefined);
});

test('every scene trigger the code fires is declared, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.scene_triggers).sort(), Object.values(TRIGGERS).sort());
});

test('every scene_actions key has a handler, and vice versa', () => {
  const handlers = createSceneActions({});
  assert.deepEqual(keysOf(manifest.scene_actions).sort(), Object.keys(handlers).sort());
});

test('every widgets key has a content handler, and vice versa', () => {
  const widgets = createWidgets({});
  assert.deepEqual(keysOf(manifest.widgets).sort(), [...WIDGET_KEYS].sort());
  for (const key of WIDGET_KEYS) {
    assert.equal(typeof widgets[key].get, 'function');
    assert.equal(typeof widgets[key].action, 'function');
  }
});

test('the competition picker of "Find a team" lists every known competition', () => {
  const field = manifest.actions
    .find((action) => action.key === 'find_team')
    .fields.find((f) => f.key === 'competition');
  assert.deepEqual(
    field.options.map((option) => option.value),
    Object.keys(COMPETITIONS),
  );
});

test('config_schema defaults stay consistent with DEFAULT_CONFIG', () => {
  for (const field of manifest.config_schema) {
    if (field.type === 'section') {
      assert.ok(!(field.key in DEFAULT_CONFIG), `section "${field.key}" stores no value`);
      continue;
    }
    assert.ok(field.key in DEFAULT_CONFIG, `DEFAULT_CONFIG.${field.key} is missing`);
    if (field.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[field.key], field.default, `default of ${field.key}`);
    }
  }
});

test('dynamic selects declare a source and no static options', () => {
  for (const field of allFields.filter((f) => f.source !== undefined)) {
    assert.equal(field.source, 'devices');
    assert.equal(field.options, undefined, `field "${field.key}"`);
  }
});

// Every text the user reads carries English and French.
const LANGUAGES = ['en', 'fr'];

test('the integration writes English and French', () => {
  assert.deepEqual(WRITTEN, LANGUAGES);
});

test('every text is a multi-language object in English and French', () => {
  const texts = [
    manifest.description,
    ...allFields.flatMap((f) => [f.label, f.description, f.placeholder]),
    ...allFields.flatMap((f) => (f.options ?? []).map((o) => o.label)),
    ...[...manifest.actions, ...manifest.scene_triggers, ...manifest.scene_actions].flatMap(
      (item) => [item.label, item.description],
    ),
    ...manifest.scene_triggers.flatMap((t) => t.variables.map((v) => v.label)),
    ...manifest.scene_actions.flatMap((a) => a.outputs.map((o) => o.label)),
    ...manifest.widgets.flatMap((w) => [w.label, w.description]),
    ...manifest.config_schema.flatMap((f) => (f.links ?? []).map((link) => link.label)),
  ].filter((text) => text !== undefined);
  for (const text of texts) {
    assert.equal(typeof text, 'object', JSON.stringify(text));
    for (const language of LANGUAGES) {
      assert.ok(text[language], `missing "${language}" in ${JSON.stringify(text)}`);
    }
  }
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  assert.equal(manifest.version, pkg.version);
  assert.ok(manifest.docker_image.endsWith(`:${manifest.version}`));
});

test('the language picker offers every language the integration writes', () => {
  const field = manifest.config_schema.find((f) => f.key === 'language');
  assert.deepEqual(
    field.options.map((option) => option.value),
    LANGUAGES,
  );
});

test('section texts hold 1000 characters at most per language', () => {
  for (const section of manifest.config_schema.filter((f) => f.type === 'section')) {
    for (const text of [section.label, section.description].flatMap((t) => Object.values(t))) {
      assert.ok(text.length <= 1000, `${section.key}: ${text.length}`);
    }
  }
});

test('the catalog description holds 10 to 100 characters per language', () => {
  assert.deepEqual(Object.keys(manifest.description), LANGUAGES);
  for (const [lang, text] of Object.entries(manifest.description)) {
    assert.ok(text.length >= 10 && text.length <= 100, `description.${lang}: ${text.length}`);
  }
});

test('widget labels hold 3 to 30 characters, descriptions 100 at most', () => {
  for (const widget of manifest.widgets) {
    for (const text of Object.values(widget.label)) {
      assert.ok(text.length >= 3 && text.length <= 30, text);
    }
    for (const text of Object.values(widget.description)) {
      assert.ok(text.length <= 100, text);
    }
  }
});
