import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseStation, createFuelClient, distanceKm, parseStations } from '../src/fuel/client.js';
import { createFakeFetch, fixture } from './helpers/fakeFetch.js';

const HOME = { latitude: 48.8566, longitude: 2.3522 };

test('distances are great-circle kilometres', () => {
  // Paris - Lyon, about 392 km.
  const lyon = { latitude: 45.764, longitude: 4.8357 };
  assert.ok(Math.abs(distanceKm(HOME, lyon) - 392) < 3);
});

test('only the stations selling the fuel are kept, nearest first', () => {
  const stations = parseStations(fixture('stations.json'), 'gazole', HOME);
  assert.deepEqual(
    stations.map((station) => [station.id, station.price]),
    [
      ['75015001', 1.729],
      ['92100002', 1.659],
    ],
  );
  assert.equal(stations[0].address, '12 rue de Vaugirard, 75015 Paris');
  assert.equal(stations[1].address, '45 avenue Victor Hugo, 92100 Boulogne-Billancourt');
  assert.equal(stations[0].updatedAt, '2026-11-01T08:12:00+00:00');
  assert.ok(stations[0].distanceKm < stations[1].distanceKm);
});

test('prices in thousandths or with a comma are read as euros', () => {
  const json = {
    results: [
      { id: 1, geom: { lon: 2.35, lat: 48.85 }, gazole_prix: 1789 },
      { id: 2, geom: { lon: 2.36, lat: 48.85 }, gazole_prix: '1,659' },
      { id: 3, geom: { lon: 2.36, lat: 48.86 }, gazole_prix: 0 },
    ],
  };
  assert.deepEqual(
    parseStations(json, 'gazole', HOME).map((station) => station.price),
    [1.789, 1.659],
  );
  assert.deepEqual(parseStations({}, 'gazole', HOME), []);
});

test('the nearest or the cheapest station', () => {
  const stations = parseStations(fixture('stations.json'), 'gazole', HOME);
  assert.equal(chooseStation(stations, 'nearest').id, '75015001');
  assert.equal(chooseStation(stations, 'cheapest').id, '92100002');
  assert.equal(chooseStation([], 'nearest'), null);
});

test('the request asks for the stations around home, by distance', async () => {
  const fake = createFakeFetch();
  const client = createFuelClient({ fetch: fake.fetch });
  const stations = await client.stations({ ...HOME, radiusKm: 10, fuel: 'e10' });
  assert.equal(stations.length, 3);
  const [request] = fake.calls('fuel');
  assert.equal(
    request.url.searchParams.get('where'),
    "within_distance(geom, geom'POINT(2.3522 48.8566)', 10km)",
  );
  assert.equal(
    request.url.searchParams.get('order_by'),
    "distance(geom, geom'POINT(2.3522 48.8566)')",
  );
});

test('an error of the open data is reported', async () => {
  const fake = createFakeFetch();
  fake.failures.fuel = 503;
  const client = createFuelClient({ fetch: fake.fetch });
  await assert.rejects(client.stations({ ...HOME, radiusKm: 10, fuel: 'gazole' }), /503/);
});
