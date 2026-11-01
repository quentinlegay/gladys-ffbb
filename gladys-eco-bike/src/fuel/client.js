// -----------------------------------------------------------------------------
// Fuel prices near home: the French government open data, updated every few
// minutes from what the stations declare ("prix des carburants en France,
// flux instantané v2"), served by data.economie.gouv.fr. Public, no key.
//
// One request: the stations within the search radius of the house, ordered
// by distance. Each record carries `<fuel>_prix` (euros per litre) and
// `<fuel>_maj` (when the station last declared it) for gazole, sp95, e10,
// sp98, e85 and gplc, plus `geom` { lon, lat }, `adresse`, `cp`, `ville`.
//
// The fixture (test/fixtures/stations.json) follows the published field list.
// When a real answer differs, trim it into the fixture and fix `parseStations`.
// -----------------------------------------------------------------------------

export const STATIONS_URL =
  'https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records';

const TIMEOUT_MS = 20_000;
const LIMIT = 100;

export class FuelError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FuelError';
  }
}

/** Great-circle distance in km. */
export function distanceKm(a, b) {
  const rad = (deg) => (deg * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function price(value) {
  const parsed = typeof value === 'string' ? Number(value.replace(',', '.')) : Number(value);
  if (value === null || value === undefined || value === '' || !Number.isFinite(parsed)) {
    return null;
  }
  // The historical feed wrote thousandths of euros (1789 for 1.789 €).
  const euros = parsed > 20 ? parsed / 1000 : parsed;
  return euros > 0 ? Math.round(euros * 1000) / 1000 : null;
}

function title(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

/**
 * @returns {{ id: string, address: string, price: number, updatedAt: string | null, distanceKm: number }[]}
 *          the stations selling `fuel`, nearest first
 */
export function parseStations(json, fuel, home) {
  const records = Array.isArray(json?.results) ? json.results : [];
  const stations = [];
  for (const record of records) {
    const value = price(record?.[`${fuel}_prix`]);
    const lat = Number(record?.geom?.lat ?? record?.latitude);
    const lon = Number(record?.geom?.lon ?? record?.longitude);
    if (value === null || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      continue;
    }
    const town = [title(record.cp), title(record.ville)].filter(Boolean).join(' ');
    const updated = record[`${fuel}_maj`];
    stations.push({
      id: String(record.id ?? `${lat},${lon}`),
      address: [title(record.adresse), town].filter(Boolean).join(', '),
      price: value,
      updatedAt: updated && !Number.isNaN(new Date(updated).getTime()) ? updated : null,
      distanceKm: Math.round(distanceKm(home, { latitude: lat, longitude: lon }) * 10) / 10,
    });
  }
  return stations.sort((a, b) => a.distanceKm - b.distanceKm);
}

/** The station to read: the nearest, or the cheapest within the radius. */
export function chooseStation(stations, choice) {
  if (stations.length === 0) {
    return null;
  }
  if (choice === 'cheapest') {
    return stations.reduce((best, station) => (station.price < best.price ? station : best));
  }
  return stations[0];
}

/**
 * @param {{ fetch?: typeof fetch }} [options]
 */
export function createFuelClient({ fetch: fetchFn = globalThis.fetch } = {}) {
  return {
    /**
     * @param {{ latitude: number, longitude: number, radiusKm: number, fuel: string }} query
     */
    async stations({ latitude, longitude, radiusKm, fuel }) {
      const point = `geom'POINT(${longitude} ${latitude})'`;
      const url = new URL(STATIONS_URL);
      url.searchParams.set('where', `within_distance(geom, ${point}, ${radiusKm}km)`);
      url.searchParams.set('order_by', `distance(geom, ${point})`);
      url.searchParams.set('limit', String(LIMIT));
      let response;
      try {
        response = await fetchFn(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      } catch (err) {
        throw new FuelError(`Fuel prices unreachable: ${err.message}`);
      }
      if (!response.ok) {
        throw new FuelError(`Fuel prices answered ${response.status}`);
      }
      return parseStations(await response.json(), fuel, { latitude, longitude });
    },
  };
}
