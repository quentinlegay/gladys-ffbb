import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, filterSignature, normalizeConfig, parseStartDate } from '../src/config.js';
import { tokensToConfig } from '../src/strava/auth.js';

test('an empty configuration gives the defaults and no tokens', () => {
  const config = normalizeConfig();
  for (const [key, value] of Object.entries(DEFAULT_CONFIG)) {
    assert.equal(config[key], value, key);
  }
  assert.equal(config.tokens, null);
});

test('numbers are parsed, French decimals included, and clamped', () => {
  const config = normalizeConfig({
    consumption: '5,8',
    refresh_minutes: 1,
    search_radius: 500,
    fuel_price: 'abc',
  });
  assert.equal(config.consumption, 5.8);
  assert.equal(config.refresh_minutes, 15);
  assert.equal(config.search_radius, 50);
  assert.equal(config.fuel_price, 0);
});

test('unknown choices fall back to the defaults', () => {
  const config = normalizeConfig({ fuel_type: 'kerosene', activities: 'x', language: 'de' });
  assert.equal(config.fuel_type, 'gazole');
  assert.equal(config.activities, 'commute');
  assert.equal(config.language, 'fr');
});

test('the start date must be a real YYYY-MM-DD date', () => {
  assert.equal(parseStartDate('2026-01-15'), '2026-01-15');
  assert.equal(parseStartDate(' 2026-01-15 '), '2026-01-15');
  assert.equal(parseStartDate('2026-02-30'), '');
  assert.equal(parseStartDate('15/01/2026'), '');
});

test('an unknown time zone falls back to Europe/Paris', () => {
  assert.equal(normalizeConfig({ timezone: 'Mars/Olympus' }).timezone, 'Europe/Paris');
  assert.equal(normalizeConfig({ timezone: 'America/Montreal' }).timezone, 'America/Montreal');
});

test('the tokens stored by the integration are read back', () => {
  const stored = tokensToConfig({
    accessToken: 'a',
    refreshToken: 'r',
    expiresAt: 123,
    athleteId: '42',
    athleteName: 'Camille',
  });
  assert.deepEqual(normalizeConfig(stored).tokens, {
    accessToken: 'a',
    refreshToken: 'r',
    expiresAt: 123,
    athleteId: '42',
    athleteName: 'Camille',
  });
  // Forgotten tokens (empty strings) mean "not connected".
  assert.equal(normalizeConfig(tokensToConfig(null)).tokens, null);
});

test('the filter signature follows what decides which activities count', () => {
  const base = normalizeConfig();
  assert.notEqual(filterSignature(base), filterSignature(normalizeConfig({ activities: 'all' })));
  assert.equal(filterSignature(base), filterSignature(normalizeConfig({ consumption: 9 })));
});
