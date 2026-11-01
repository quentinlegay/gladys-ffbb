// -----------------------------------------------------------------------------
// Configuration: defaults (mirroring the manifest), normalization.
//
// Gladys hands the integration the raw values of the Configuration screen,
// plus the keys this integration stored itself through `setConfig` (the
// Strava tokens, never shown in the UI). Everything the rest of the code reads
// goes through `normalizeConfig`, so an empty or out-of-range field never
// reaches the computations.
// -----------------------------------------------------------------------------

import { FUELS } from './vehicle.js';

/** Defaults of the `config_schema` fields: `test/manifest.test.js` keeps them equal. */
export const DEFAULT_CONFIG = {
  client_id: '',
  client_secret: '',
  activities: 'commute',
  sports: 'bike',
  start_date: '',
  vehicle_name: '',
  fuel_type: 'gazole',
  consumption: 6.5,
  co2_per_km: 0,
  extra_cost_per_km: 0,
  fuel_price: 0,
  station_choice: 'nearest',
  search_radius: 10,
  house: '',
  milestone_kg: 50,
  refresh_minutes: 60,
  language: 'fr',
  timezone: 'Europe/Paris',
};

/** Keys stored by the integration itself (outside the config_schema). */
export const TOKEN_KEYS = {
  ACCESS: 'strava_access_token',
  REFRESH: 'strava_refresh_token',
  EXPIRES_AT: 'strava_expires_at',
  ATHLETE_ID: 'strava_athlete_id',
  ATHLETE_NAME: 'strava_athlete_name',
};

const RANGES = {
  consumption: [0.1, 100],
  co2_per_km: [0, 1000],
  extra_cost_per_km: [0, 10],
  fuel_price: [0, 10],
  search_radius: [1, 50],
  milestone_kg: [0, 100000],
  refresh_minutes: [15, 1440],
};

const CHOICES = {
  activities: ['commute', 'all'],
  sports: ['bike', 'bike_foot'],
  fuel_type: Object.keys(FUELS),
  station_choice: ['nearest', 'cheapest'],
  language: ['en', 'fr'],
};

function number(value, key) {
  const parsed = typeof value === 'string' ? Number(value.replace(',', '.')) : Number(value);
  if (value === '' || value === null || value === undefined || !Number.isFinite(parsed)) {
    return DEFAULT_CONFIG[key];
  }
  const [min, max] = RANGES[key];
  return Math.min(max, Math.max(min, parsed));
}

function choice(value, key) {
  return CHOICES[key].includes(value) ? value : DEFAULT_CONFIG[key];
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/** A YYYY-MM-DD date, or '' (no lower bound). */
export function parseStartDate(value) {
  const match = text(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return '';
  }
  const date = new Date(`${match[0]}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== match[0]
    ? ''
    : match[0];
}

function validTimeZone(value) {
  const zone = text(value);
  if (!zone) {
    return DEFAULT_CONFIG.timezone;
  }
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return zone;
  } catch {
    return DEFAULT_CONFIG.timezone;
  }
}

/**
 * @param {Record<string, unknown>} [raw] what Gladys sent
 */
export function normalizeConfig(raw = {}) {
  const config = {
    client_id: text(raw.client_id),
    client_secret: text(raw.client_secret),
    activities: choice(raw.activities, 'activities'),
    sports: choice(raw.sports, 'sports'),
    start_date: parseStartDate(raw.start_date),
    vehicle_name: text(raw.vehicle_name).slice(0, 40),
    fuel_type: choice(raw.fuel_type, 'fuel_type'),
    consumption: number(raw.consumption, 'consumption'),
    co2_per_km: number(raw.co2_per_km, 'co2_per_km'),
    extra_cost_per_km: number(raw.extra_cost_per_km, 'extra_cost_per_km'),
    fuel_price: number(raw.fuel_price, 'fuel_price'),
    station_choice: choice(raw.station_choice, 'station_choice'),
    search_radius: number(raw.search_radius, 'search_radius'),
    house: text(raw.house),
    milestone_kg: number(raw.milestone_kg, 'milestone_kg'),
    refresh_minutes: number(raw.refresh_minutes, 'refresh_minutes'),
    language: choice(raw.language, 'language'),
    timezone: validTimeZone(raw.timezone),
  };
  const expiresAt = Number(raw[TOKEN_KEYS.EXPIRES_AT]);
  config.tokens = text(raw[TOKEN_KEYS.REFRESH])
    ? {
        accessToken: text(raw[TOKEN_KEYS.ACCESS]),
        refreshToken: text(raw[TOKEN_KEYS.REFRESH]),
        expiresAt: Number.isFinite(expiresAt) ? expiresAt : 0,
        athleteId: text(String(raw[TOKEN_KEYS.ATHLETE_ID] ?? '')),
        athleteName: text(raw[TOKEN_KEYS.ATHLETE_NAME]),
      }
    : null;
  return config;
}

/**
 * The settings that decide WHICH activities count. When one of them changes,
 * the set of counted trips is rebuilt from the stored activities: that is a
 * new baseline, not a burst of "trip recorded" events.
 */
export function filterSignature(config) {
  return [config.activities, config.sports, config.start_date].join('|');
}
