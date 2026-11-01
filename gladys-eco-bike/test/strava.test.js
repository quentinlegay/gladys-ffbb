import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { normalizeConfig, TOKEN_KEYS } from '../src/config.js';
import { StravaAuth } from '../src/strava/auth.js';
import { authorizeUrl, createStravaClient, StravaError } from '../src/strava/client.js';
import { createFakeFetch } from './helpers/fakeFetch.js';
import { CONNECTED } from './helpers/setup.js';

test('the authorization URL asks to read the activities, private ones included', () => {
  const url = new URL(
    authorizeUrl({ clientId: '123', redirectUri: 'https://gladys.example/oauth', state: 's' }),
  );
  assert.equal(url.origin + url.pathname, 'https://www.strava.com/oauth/authorize');
  assert.equal(url.searchParams.get('client_id'), '123');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://gladys.example/oauth');
  assert.equal(url.searchParams.get('scope'), 'read,activity:read_all');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('state'), 's');
});

test('the activities are read page by page', async () => {
  const fake = createFakeFetch();
  fake.activities = Array.from({ length: 450 }, (_, i) => ({
    id: i + 1,
    start_date: new Date(Date.UTC(2025, 0, 1) + i * 3600_000).toISOString(),
    distance: 1000,
    sport_type: 'Ride',
  }));
  const client = createStravaClient({ fetch: fake.fetch, accessToken: async () => 'token' });
  const { activities, complete } = await client.activities({ after: 0 });
  assert.equal(activities.length, 450);
  assert.equal(complete, true);
  assert.equal(fake.calls('strava').length, 3);
  assert.equal(fake.calls('strava')[0].headers.authorization, 'Bearer token');
});

test('Strava errors are typed', async () => {
  const fake = createFakeFetch();
  const client = createStravaClient({ fetch: fake.fetch, accessToken: async () => 'token' });
  for (const [failure, code] of [
    [401, 'unauthorized'],
    [429, 'rate_limited'],
    [500, 'http'],
    ['network', 'network'],
  ]) {
    fake.failures.strava = failure;
    await assert.rejects(
      client.activities(),
      (err) => err instanceof StravaError && err.code === code,
    );
  }
});

function makeAuth({ config = {}, now = Date.parse('2026-11-01T12:00:00Z') } = {}) {
  const gladys = createFakeGladys({ config: {} });
  const fake = createFakeFetch();
  const auth = new StravaAuth({ gladys, fetch: fake.fetch, now: () => now });
  auth.configure(normalizeConfig({ client_id: '123', client_secret: 'secret', ...config }));
  return { gladys, fake, auth };
}

test('Connect needs the client id and secret', () => {
  const { auth } = makeAuth({ config: { client_secret: '' } });
  assert.throws(() => auth.authorizeUrl('https://gladys.example/cb'), /client ID/);
});

test('the OAuth callback checks the state, exchanges the code and stores the tokens', async () => {
  const { gladys, fake, auth } = makeAuth();
  const url = new URL(auth.authorizeUrl('https://gladys.example/oauth/callback'));
  assert.equal(auth.redirectHost, 'gladys.example');
  await assert.rejects(auth.callback({ code: 'c', state: 'forged' }), /state/);
  await auth.callback({ code: 'the-code', state: url.searchParams.get('state') });
  const [request] = fake.calls('token');
  const body = new URLSearchParams(request.body);
  assert.equal(body.get('grant_type'), 'authorization_code');
  assert.equal(body.get('code'), 'the-code');
  assert.equal(body.get('client_secret'), 'secret');
  assert.equal(gladys.fake.config[TOKEN_KEYS.REFRESH], 'refresh-1');
  assert.equal(gladys.fake.config[TOKEN_KEYS.ATHLETE_ID], '4242');
  assert.equal(gladys.fake.config[TOKEN_KEYS.ATHLETE_NAME], 'Camille Martin');
  assert.equal(auth.connected, true);
  // A state is used once.
  await assert.rejects(auth.callback({ code: 'c', state: url.searchParams.get('state') }), /state/);
});

test('an expiring access token is refreshed once, and the new tokens stored', async () => {
  const { gladys, fake, auth } = makeAuth({
    config: { ...CONNECTED, [TOKEN_KEYS.EXPIRES_AT]: Date.parse('2026-11-01T12:03:00Z') / 1000 },
  });
  fake.token = { access_token: 'access-2', refresh_token: 'refresh-2', expires_at: 1793700000 };
  const [a, b] = await Promise.all([auth.accessToken(), auth.accessToken()]);
  assert.equal(a, 'access-2');
  assert.equal(b, 'access-2');
  assert.equal(fake.calls('token').length, 1);
  const body = new URLSearchParams(fake.calls('token')[0].body);
  assert.equal(body.get('grant_type'), 'refresh_token');
  assert.equal(body.get('refresh_token'), 'refresh-0');
  assert.equal(gladys.fake.config[TOKEN_KEYS.REFRESH], 'refresh-2');
  // A refresh returns no athlete: the known one is kept.
  assert.equal(gladys.fake.config[TOKEN_KEYS.ATHLETE_ID], '4242');
  // Valid now: no other request.
  assert.equal(await auth.accessToken(), 'access-2');
  assert.equal(fake.calls('token').length, 1);
});

test('a revoked refresh token is an authorization error', async () => {
  const { fake, auth } = makeAuth({ config: { ...CONNECTED, [TOKEN_KEYS.EXPIRES_AT]: 1 } });
  fake.failures.token = 400;
  await assert.rejects(auth.accessToken(), (err) => err.code === 'unauthorized');
});

test('the config echoed back after our own refresh does not bring the old tokens back', async () => {
  const { auth, fake } = makeAuth({ config: { ...CONNECTED, [TOKEN_KEYS.EXPIRES_AT]: 1 } });
  fake.token = { access_token: 'access-2', refresh_token: 'refresh-2', expires_at: 1793700000 };
  await auth.accessToken();
  auth.configure(
    normalizeConfig({
      client_id: '123',
      client_secret: 'secret',
      ...CONNECTED,
      [TOKEN_KEYS.EXPIRES_AT]: 1,
    }),
  );
  assert.equal(auth.tokens.refreshToken, 'refresh-2');
});
