import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig } from '../src/config.js';
import { buildTrips, isCounted, localDay, priceOn, summarize } from '../src/stats.js';
import { parseActivities } from '../src/strava/parse.js';
import { co2PerKm, tripSavings } from '../src/vehicle.js';
import { fixture } from './helpers/fakeFetch.js';

const activities = parseActivities(fixture('activities.json'));
const ids = (trips) => trips.map((trip) => trip.id).sort();

test('Strava activities keep the few fields needed', () => {
  const [first] = activities;
  assert.deepEqual(first, {
    id: '1001',
    name: 'Vélotaf du matin',
    sport: 'Ride',
    km: 7.215,
    start: '2026-10-27T06:52:11.000Z',
    day: '2026-10-27',
    commute: true,
    indoor: false,
  });
  assert.equal(parseActivities([{ id: 1, start_date: 'nope' }, null]).length, 0);
});

test('by default only the bike commutes count, never the home trainer', () => {
  const config = normalizeConfig();
  assert.deepEqual(ids(activities.filter((a) => isCounted(a, config))), ['1001', '1002', '1006']);
});

test('every ride, walks and runs, and a start date can be chosen', () => {
  const all = normalizeConfig({ activities: 'all' });
  assert.deepEqual(ids(activities.filter((a) => isCounted(a, all))), [
    '1001',
    '1002',
    '1003',
    '1006',
  ]);
  const feet = normalizeConfig({ sports: 'bike_foot' });
  assert.deepEqual(ids(activities.filter((a) => isCounted(a, feet))), [
    '1001',
    '1002',
    '1005',
    '1006',
  ]);
  const october = normalizeConfig({ start_date: '2026-10-01' });
  assert.deepEqual(ids(activities.filter((a) => isCounted(a, october))), ['1001', '1002']);
});

test('the CO2 per km comes from the consumption, or from the configured figure', () => {
  // 6.5 L/100 km of diesel at 3.16 kg/L.
  assert.ok(Math.abs(co2PerKm(normalizeConfig()) - 0.2054) < 1e-9);
  assert.equal(co2PerKm(normalizeConfig({ co2_per_km: 120 })), 0.12);
  // An electric car: 17 kWh/100 km at 0.052 kg/kWh.
  const ev = normalizeConfig({ fuel_type: 'electric', consumption: 17 });
  assert.ok(Math.abs(co2PerKm(ev) - 0.00884) < 1e-9);
});

test('a trip saves its fuel and the other costs per km', () => {
  const config = normalizeConfig({ consumption: 5, extra_cost_per_km: 0.1 });
  const savings = tripSavings(10, 2, config);
  // 0.5 L at 2 € + 10 km at 0.10 €.
  assert.ok(Math.abs(savings.money - 2) < 1e-9);
  assert.ok(Math.abs(savings.energy - 0.5) < 1e-9);
});

test('a trip is valued at the price of its day', () => {
  const history = { '2026-10-01': 1.7, '2026-10-20': 1.8 };
  assert.equal(priceOn(history, '2026-09-01', 9), 1.7, 'before the first price: the first one');
  assert.equal(priceOn(history, '2026-10-19', 9), 1.7);
  assert.equal(priceOn(history, '2026-10-20', 9), 1.8);
  assert.equal(priceOn(history, '2026-12-01', 9), 1.8);
  assert.equal(priceOn({}, '2026-12-01', 9), 9, 'no price read: the fallback');
});

test('trips use the station prices, the fixed price or the default one', () => {
  const prices = { gazole: { '2026-10-01': 1.7, '2026-10-27': 1.8 } };
  const stations = buildTrips(activities, prices, normalizeConfig());
  assert.deepEqual(
    stations.map((trip) => [trip.id, trip.price]),
    [
      ['1002', 1.8],
      ['1001', 1.8],
      ['1006', 1.7],
    ],
    'newest first',
  );
  const fixed = buildTrips(activities, prices, normalizeConfig({ fuel_price: 1.5 }));
  assert.ok(fixed.every((trip) => trip.price === 1.5));
  const ev = buildTrips(activities, prices, normalizeConfig({ fuel_type: 'electric' }));
  assert.ok(ev.every((trip) => trip.price === 0.2));
});

test('totals per period, in the configured time zone, and the last 12 months', () => {
  const trips = buildTrips(activities, {}, normalizeConfig());
  // Sunday 1 November 2026, 00:30 in Paris (still 31 October in UTC).
  const summary = summarize(trips, new Date('2026-10-31T23:30:00Z'), 'Europe/Paris');
  assert.equal(summary.total.trips, 3);
  assert.equal(summary.year.trips, 3);
  assert.equal(summary.month.trips, 0, 'November has just started in Paris');
  assert.equal(summary.week.trips, 2, 'the week started on Monday 26 October');
  assert.equal(summary.months.length, 12);
  assert.equal(summary.months.at(-1).month, '2026-11');
  assert.equal(summary.months.at(-2).trips, 2);
  assert.equal(summary.months.at(-3).trips, 1);
  assert.equal(summary.last.id, '1002');
  assert.ok(Math.abs(summary.total.km - (7.215 + 7.48 + 7)) < 1e-9);
  assert.equal(localDay(new Date('2026-10-31T23:30:00Z'), 'UTC'), '2026-10-31');
});
