// -----------------------------------------------------------------------------
// The integration wired to the SDK's fake Gladys, a fake fetch and a memory
// store, with a clock the test moves.
// -----------------------------------------------------------------------------

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { createApp } from '../../src/app.js';
import { tokensToConfig } from '../../src/strava/auth.js';
import { createMemoryStore } from '../../src/store.js';
import { createFakeFetch } from './fakeFetch.js';

export const HOME = {
  id: 'house-1',
  name: 'Maison',
  selector: 'maison',
  latitude: 48.8566,
  longitude: 2.3522,
};

export const CONNECTED = tokensToConfig({
  accessToken: 'access-0',
  refreshToken: 'refresh-0',
  // Far in the future: no refresh unless a test wants one.
  expiresAt: 4_000_000_000,
  athleteId: '4242',
  athleteName: 'Camille Martin',
});

export const BASE_CONFIG = { client_id: '123', client_secret: 'secret', ...CONNECTED };

/**
 * @param {object} [options]
 * @param {object} [options.config] the stored configuration
 * @param {string} [options.now] ISO instant of the clock
 */
export function setup({
  config = BASE_CONFIG,
  now = '2026-11-01T12:00:00Z',
  houses = [HOME],
  store,
  fetch,
} = {}) {
  const clock = { now: new Date(now) };
  const gladys = createFakeGladys({ config: structuredClone(config), houses });
  const fake = fetch ?? createFakeFetch();
  const memory = store ?? createMemoryStore();
  const app = createApp({ gladys, fetch: fake.fetch, store: memory, now: () => clock.now });
  return { gladys, fake, store: memory, clock, ...app };
}

/** Connect, then stop the loop timer so the test process can exit. */
export async function connect(context) {
  await context.gladys.connect();
  context.tracker.stop();
  return context;
}
