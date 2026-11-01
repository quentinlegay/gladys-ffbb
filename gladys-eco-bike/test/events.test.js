import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig } from '../src/config.js';
import { diffEvents, TRIGGERS } from '../src/events.js';

const config = normalizeConfig({ milestone_kg: 10 });
const now = new Date('2026-11-01T12:00:00Z');

const trip = (id, start, co2Kg = 1) => ({
  id,
  name: `Trip ${id}`,
  sport: 'Ride',
  day: start.slice(0, 10),
  start,
  km: 5,
  co2Kg,
  money: 0.6,
  price: 1.7,
});

const reading = (trips) => ({
  trips,
  summary: {
    total: {
      trips: trips.length,
      km: trips.length * 5,
      co2Kg: trips.reduce((sum, t) => sum + t.co2Kg, 0),
      money: trips.length * 0.6,
    },
  },
});

test('the first reading is a baseline', () => {
  assert.deepEqual(diffEvents(null, reading([trip('1', '2026-11-01T07:00:00Z')]), config, now), []);
});

test('one event per new recent trip, oldest first, with the totals', () => {
  const previous = { countedIds: ['1'], co2Kg: 1 };
  const current = reading([
    trip('3', '2026-11-01T08:00:00Z'),
    trip('2', '2026-10-31T08:00:00Z'),
    trip('1', '2026-10-30T08:00:00Z'),
  ]);
  const events = diffEvents(previous, current, config, now);
  assert.deepEqual(
    events.map((event) => [event.key, event.data.name]),
    [
      [TRIGGERS.TRIP_RECORDED, 'Trip 2'],
      [TRIGGERS.TRIP_RECORDED, 'Trip 3'],
    ],
  );
  assert.equal(events[0].data.total_co2_kg, 3);
  assert.equal(events[0].data.distance_km, 5);
});

test('an old activity counted today is history, not news', () => {
  const previous = { countedIds: [], co2Kg: 0 };
  const events = diffEvents(previous, reading([trip('1', '2026-09-01T08:00:00Z')]), config, now);
  assert.deepEqual(events, []);
});

test('the CO2 milestone fires once, for the highest multiple crossed', () => {
  const previous = { countedIds: ['1'], co2Kg: 9 };
  const current = reading([
    trip('1', '2026-09-01T08:00:00Z', 9),
    trip('2', '2026-11-01T08:00:00Z', 12),
  ]);
  const milestones = diffEvents(previous, current, config, now).filter(
    (event) => event.key === TRIGGERS.CO2_MILESTONE,
  );
  assert.equal(milestones.length, 1);
  assert.equal(milestones[0].data.milestone_kg, 20);
  assert.equal(milestones[0].data.trips, 2);
  // Turned off with 0.
  const off = diffEvents(previous, current, normalizeConfig({ milestone_kg: 0 }), now);
  assert.ok(off.every((event) => event.key !== TRIGGERS.CO2_MILESTONE));
});
