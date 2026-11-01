import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { TOKEN_KEYS } from '../src/config.js';
import { connect, setup } from './helpers/setup.js';

test('Connect: the authorization URL, then the callback reads Strava at once', async () => {
  const context = await connect(setup({ config: { client_id: '123', client_secret: 'secret' } }));
  const { gladys, fake } = context;
  const ack = await gladys.fake.oauthAuthorizeUrl('strava', 'https://gladys.example/oauth/cb');
  assert.equal(ack.success, true);
  const url = new URL(ack.data.authorize_url);
  assert.equal(url.hostname, 'www.strava.com');
  const callback = await gladys.fake.oauthCallback('strava', {
    code: 'code',
    state: url.searchParams.get('state'),
    redirectUri: 'https://gladys.example/oauth/cb',
  });
  context.tracker.stop();
  assert.equal(callback.success, true);
  assert.equal(gladys.fake.config[TOKEN_KEYS.ACCESS], 'access-1');
  assert.equal(fake.calls('strava').length, 1);
  assert.equal(context.tracker.reading.summary.total.trips, 3);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('Connect without the client id says what to do', async () => {
  const { gladys } = await connect(setup({ config: {} }));
  const ack = await gladys.fake.oauthAuthorizeUrl('strava', 'https://gladys.example/oauth/cb');
  assert.equal(ack.success, false);
});

test('the Test button tells what is counted', async () => {
  const context = await connect(setup());
  const ack = await context.gladys.fake.action('test_connection', {});
  context.tracker.stop();
  assert.equal(ack.success, true);
  const text = JSON.stringify(ack.data);
  assert.match(text, /Camille Martin/);
  assert.match(text, /3 trajets/);
  assert.match(text, /Voiture \(Gazole, 6,5 L\/100 km, 205 g CO₂\/km\)/);
});

test('the Test button before Connect', async () => {
  const context = await connect(setup({ config: { client_id: '1', client_secret: '2' } }));
  const ack = await context.gladys.fake.action('test_connection', {});
  assert.match(JSON.stringify(ack.data), /Connect/);
});

test('reading the whole history again', async () => {
  const context = await connect(setup());
  const ack = await context.gladys.fake.action('resync', {});
  context.tracker.stop();
  assert.equal(ack.success, true);
  assert.equal(context.fake.calls('strava').at(-1).url.searchParams.get('after'), '0');
  assert.match(JSON.stringify(ack.data), /6 activités, 3 trajets/);
});

test('the scene action returns the totals of a period', async () => {
  const context = await connect(setup());
  const ack = await context.gladys.fake.sceneAction('get_savings', { period: 'year' });
  assert.equal(ack.success, true);
  const { outputs } = ack.data;
  assert.equal(outputs.trips, 3);
  assert.equal(outputs.distance_km, 21.7);
  assert.equal(outputs.co2_kg, 4.46);
  assert.equal(outputs.fuel_price, 1.729);
  assert.match(outputs.summary, /^Cette année : 3 trajets/);
  // Reading the cache: no request.
  const before = context.fake.requests.length;
  await context.gladys.fake.sceneAction('get_savings', { period: 'month' });
  assert.equal(context.fake.requests.length, before);
});

test('the widgets fit the vocabulary and the budget', async () => {
  const context = await connect(setup());
  const { gladys } = context;
  for (const [key, settings] of [
    ['savings', { period: 'year', chart: 'money' }],
    ['savings', {}],
    ['recent_trips', { count: 8 }],
  ]) {
    for (const language of ['en', 'fr']) {
      const ack = await gladys.fake.widgetGet(key, { settings, language, units: 'metric' });
      assert.equal(ack.success, true, key);
      assert.deepEqual(validateWidgetContent(ack.data.content), [], `${key} ${language}`);
    }
  }
  const ack = await gladys.fake.widgetGet('recent_trips', { settings: {}, language: 'en' });
  const items = ack.data.content.components[0].items;
  assert.equal(items.length, 3);
  assert.equal(items[0].title, 'Retour du boulot');
  assert.match(items[0].badge.text, /^-1\.5 kg CO₂$/);
});

test('the widgets before any Strava reading', async () => {
  const { gladys } = await connect(setup({ config: {} }));
  const ack = await gladys.fake.widgetGet('savings', { settings: {}, language: 'fr' });
  assert.deepEqual(validateWidgetContent(ack.data.content), []);
  assert.match(ack.data.content.components[0].text, /connectez Strava/);
});

test('the refresh button of a widget reads again', async () => {
  const context = await connect(setup());
  const before = context.fake.calls('strava').length;
  const ack = await context.gladys.fake.widgetAction('savings', 'refresh', {}, { settings: {} });
  context.tracker.stop();
  assert.equal(ack.success, true);
  assert.equal(context.fake.calls('strava').length, before + 1);
});

test('the tokens echoed back by Gladys do not trigger a reading', async () => {
  const context = await connect(setup());
  const before = context.fake.requests.length;
  await context.gladys.fake.configUpdated({
    ...context.gladys.fake.config,
    [TOKEN_KEYS.ACCESS]: 'access-9',
  });
  assert.equal(context.fake.requests.length, before);
});
