import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOKEN_KEYS } from '../src/config.js';
import { FEATURE } from '../src/devices/savings.js';
import { TRIGGERS } from '../src/events.js';
import { connect, setup, BASE_CONFIG } from './helpers/setup.js';

const SAVINGS = 'ext:test-integration:savings:me';
const FUEL = 'ext:test-integration:fuel:home';
const state = (gladys, device, feature) => gladys.fake.lastState(`${device}:${feature}`);

/** Create the devices in the fake Gladys, as the user would from the Discover tab. */
async function createDevices(context) {
  for (const device of context.gladys.fake.discoveredDevices) {
    await context.gladys.fake.deviceCreated(device);
  }
  context.tracker.stop();
}

test('the first connection publishes both devices', async () => {
  const context = await connect(setup());
  const devices = context.gladys.fake.discoveredDevices;
  assert.deepEqual(
    devices.map((device) => device.external_id),
    [SAVINGS, FUEL],
  );
  assert.equal(devices[0].name, 'Éco Vélo');
  for (const feature of devices.flatMap((device) => device.features)) {
    assert.equal(typeof feature.min, 'number', `${feature.external_id} min`);
    assert.equal(typeof feature.max, 'number', `${feature.external_id} max`);
  }
});

test('the whole history is read, the commutes valued at the nearest station', async () => {
  const context = await connect(setup());
  await createDevices(context);
  const { gladys, fake } = context;
  // Three bike commutes: 7.215 + 7.48 + 7 km.
  assert.equal(state(gladys, SAVINGS, FEATURE.TRIPS_TOTAL), 3);
  assert.equal(state(gladys, SAVINGS, FEATURE.DISTANCE_TOTAL), 21.7);
  // 21.695 km x 6.5 L/100 km x 3.16 kg/L.
  assert.equal(state(gladys, SAVINGS, FEATURE.CO2_TOTAL), 4.46);
  // 21.695 km x 6.5 L/100 km x 1.729 €/L.
  assert.equal(state(gladys, SAVINGS, FEATURE.MONEY_TOTAL), 2.44);
  assert.equal(state(gladys, SAVINGS, FEATURE.TRIPS_TOTAL), 3);
  assert.equal(state(gladys, SAVINGS, FEATURE.CO2_MONTH), 0, 'nothing yet in November');
  assert.equal(state(gladys, FUEL, FEATURE.FUEL_PRICE), 1.729);
  assert.match(state(gladys, FUEL, FEATURE.STATION), /^Gazole 1,729 €\/L · 12 rue de Vaugirard/);
  assert.match(state(gladys, SAVINGS, FEATURE.LAST_TRIP), /^mar\. 27 oct\. · 7,5 km/);
  // One fuel request, one Strava page.
  assert.equal(fake.calls('fuel').length, 1);
  assert.equal(fake.calls('strava')[0].url.searchParams.get('after'), '0');
  assert.deepEqual(gladys.fake.sceneEvents, [], 'the first reading is a baseline');
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('a new commute fires one event, the next reading only reads the last week', async () => {
  const context = await connect(setup());
  const { gladys, fake, tracker, clock } = context;
  fake.activities.push({
    id: 2001,
    name: 'Vélotaf du lundi',
    distance: 7200,
    sport_type: 'Ride',
    start_date: '2026-11-02T06:50:00Z',
    start_date_local: '2026-11-02T07:50:00Z',
    commute: true,
  });
  clock.now = new Date('2026-11-02T09:00:00Z');
  await tracker.refresh();
  const after = Number(fake.calls('strava').at(-1).url.searchParams.get('after'));
  // The latest activity known started on 29 October, 07:10 UTC.
  assert.equal(after, Date.parse('2026-10-22T07:10:00Z') / 1000);
  const events = gladys.fake.sceneEvents;
  assert.equal(events.length, 1);
  assert.equal(events[0].key, TRIGGERS.TRIP_RECORDED);
  assert.equal(events[0].data.name, 'Vélotaf du lundi');
  assert.equal(events[0].data.distance_km, 7.2);
  // Same reading again: nothing new.
  await tracker.refresh();
  assert.equal(gladys.fake.sceneEvents.length, 1);
  // The fuel price is read every 6 hours at most: again 21 hours later, not twice.
  assert.equal(fake.calls('fuel').length, 2);
});

test('an activity deleted on Strava within the window is removed', async () => {
  const context = await connect(setup());
  const { fake, tracker } = context;
  fake.activities = fake.activities.filter((activity) => activity.id !== 1002);
  await tracker.refresh();
  assert.equal(tracker.reading.summary.total.trips, 2);
});

test('a restart is not a baseline: the store remembers the previous reading', async () => {
  const first = await connect(setup());
  first.fake.activities.push({
    id: 2002,
    name: 'Vélotaf',
    distance: 5000,
    sport_type: 'Ride',
    start_date: '2026-11-01T10:00:00Z',
    commute: true,
  });
  // The integration restarts with the same /data.
  const second = await connect(setup({ store: first.store, fetch: first.fake }));
  assert.deepEqual(
    second.gladys.fake.sceneEvents.map((event) => event.key),
    [TRIGGERS.TRIP_RECORDED],
  );
});

test('changing what counts rebuilds the totals without events', async () => {
  const context = await connect(setup());
  const { gladys, tracker } = context;
  await gladys.fake.configUpdated({ ...BASE_CONFIG, activities: 'all' });
  assert.equal(tracker.reading.summary.total.trips, 4);
  assert.deepEqual(gladys.fake.sceneEvents, []);
});

test('crossing a CO2 milestone fires the trigger', async () => {
  const context = await connect(setup({ config: { ...BASE_CONFIG, milestone_kg: 5 } }));
  const { gladys, fake, tracker } = context;
  fake.activities.push({
    id: 2003,
    name: 'Long vélotaf',
    distance: 15000,
    sport_type: 'Ride',
    start_date: '2026-11-01T10:00:00Z',
    commute: true,
  });
  await tracker.refresh();
  const milestone = gladys.fake.sceneEvents.find((event) => event.key === TRIGGERS.CO2_MILESTONE);
  assert.equal(milestone.data.milestone_kg, 5);
});

test('Strava down: the totals are kept and the badge says it', async () => {
  const context = await connect(setup());
  const { gladys, fake, tracker } = context;
  fake.failures.strava = 'network';
  await tracker.refresh();
  assert.equal(tracker.reading.summary.total.trips, 3);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  fake.failures.strava = null;
  await tracker.refresh();
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('a token Strava refuses is refreshed once, then the reading goes on', async () => {
  const context = await connect(setup());
  const { fake, tracker } = context;
  fake.validTokens = ['access-1'];
  await tracker.refresh();
  assert.equal(fake.calls('token').length, 1);
  assert.equal(tracker.status, 'ok');
});

test('not connected: the badge asks to connect, nothing is read', async () => {
  const context = await connect(setup({ config: { client_id: '123', client_secret: 's' } }));
  const { gladys, fake } = context;
  assert.equal(fake.calls('strava').length, 0);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /Connect/);
});

test('without a located house, the price is the estimated average', async () => {
  const context = await connect(setup({ houses: [] }));
  assert.equal(context.tracker.reading.fuel.source, 'default');
  assert.equal(context.tracker.reading.fuel.price, 1.65);
  assert.equal(context.fake.calls('fuel').length, 0);
});

test('a fixed price and an electric car need no station', async () => {
  const context = await connect(
    setup({ config: { ...BASE_CONFIG, fuel_type: 'electric', consumption: 17, fuel_price: 0.25 } }),
  );
  assert.equal(context.fake.calls('fuel').length, 0);
  assert.equal(context.tracker.reading.fuel.source, 'config');
  // 21.695 km x 17 kWh/100 km x 0.25 €.
  assert.equal(Math.round(context.tracker.reading.summary.total.money * 100) / 100, 0.92);
});

test('another athlete connected starts from scratch', async () => {
  const context = await connect(setup());
  const { gladys, tracker } = context;
  await gladys.fake.configUpdated({
    ...BASE_CONFIG,
    [TOKEN_KEYS.REFRESH]: 'refresh-9',
    [TOKEN_KEYS.ATHLETE_ID]: '9999',
  });
  await tracker.refresh();
  assert.equal(context.fake.calls('strava').at(-1).url.searchParams.get('after'), '0');
  assert.equal(tracker.state.athleteId, '9999');
  assert.deepEqual(gladys.fake.sceneEvents, []);
});
