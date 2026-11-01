// -----------------------------------------------------------------------------
// Activities + fuel price history + vehicle -> trips and totals. Pure.
//
// A trip is valued at the fuel price of ITS day (the last price read on or
// before that day), so a later price change does not rewrite what a past trip
// saved. Trips older than the first price read use that first price; with no
// price read at all, the configured price or the fuel's default.
// -----------------------------------------------------------------------------

import { FUELS, readsStations, tripSavings } from './vehicle.js';

/** Strava sport types counted as transport, per `sports` setting. */
export const SPORTS = {
  bike: ['Ride', 'EBikeRide', 'GravelRide', 'Velomobile', 'Handcycle', 'EMountainBikeRide'],
  bike_foot: [
    'Ride',
    'EBikeRide',
    'GravelRide',
    'Velomobile',
    'Handcycle',
    'EMountainBikeRide',
    'Run',
    'Walk',
    'Hike',
    'Wheelchair',
  ],
};

/** Whether an activity counts as a trip that replaced the car. */
export function isCounted(activity, config) {
  if (activity.indoor || activity.km <= 0) {
    return false;
  }
  if (!SPORTS[config.sports].includes(activity.sport)) {
    return false;
  }
  if (config.activities === 'commute' && !activity.commute) {
    return false;
  }
  return !config.start_date || activity.day >= config.start_date;
}

/**
 * The fuel price of a day.
 * @param {Record<string, number>} history day (YYYY-MM-DD) -> price
 */
export function priceOn(history, day, fallback) {
  const days = Object.keys(history ?? {}).sort();
  if (days.length === 0) {
    return fallback;
  }
  let chosen = history[days[0]];
  for (const known of days) {
    if (known > day) {
      break;
    }
    chosen = history[known];
  }
  return chosen;
}

/** The price used when no station price applies. */
export function fallbackPrice(config) {
  return config.fuel_price > 0 ? config.fuel_price : FUELS[config.fuel_type].defaultPrice;
}

/**
 * @param {import('./strava/parse.js').Activity[]} activities
 * @param {Record<string, Record<string, number>>} prices fuel -> day -> price
 */
export function buildTrips(activities, prices, config) {
  const history = readsStations(config) ? prices?.[config.fuel_type] : null;
  const fallback = fallbackPrice(config);
  return activities
    .filter((activity) => isCounted(activity, config))
    .map((activity) => {
      const price = history ? priceOn(history, activity.day, fallback) : fallback;
      const savings = tripSavings(activity.km, price, config);
      return {
        id: activity.id,
        name: activity.name,
        sport: activity.sport,
        day: activity.day,
        start: activity.start,
        km: activity.km,
        price,
        co2Kg: savings.co2Kg,
        money: savings.money,
      };
    })
    .sort((a, b) => (a.start < b.start ? 1 : a.start > b.start ? -1 : 0));
}

/** The local date (YYYY-MM-DD) of an instant in a time zone. */
export function localDay(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Monday of the week of a day, YYYY-MM-DD. */
function weekStart(day) {
  const date = new Date(`${day}T00:00:00Z`);
  const shift = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - shift);
  return date.toISOString().slice(0, 10);
}

function emptyTotals() {
  return { trips: 0, km: 0, co2Kg: 0, money: 0 };
}

function add(totals, trip) {
  totals.trips += 1;
  totals.km += trip.km;
  totals.co2Kg += trip.co2Kg;
  totals.money += trip.money;
}

export const PERIODS = ['total', 'year', 'month', 'week'];

/**
 * Totals per period, and the last 12 months (oldest first) for the charts.
 * @param {ReturnType<typeof buildTrips>} trips newest first
 */
export function summarize(trips, now, timeZone) {
  const today = localDay(now, timeZone);
  const year = today.slice(0, 4);
  const month = today.slice(0, 7);
  const week = weekStart(today);
  const totals = {
    total: emptyTotals(),
    year: emptyTotals(),
    month: emptyTotals(),
    week: emptyTotals(),
  };
  const months = [];
  const cursor = new Date(`${month}-01T00:00:00Z`);
  for (let i = 0; i < 12; i += 1) {
    months.unshift({ month: cursor.toISOString().slice(0, 7), ...emptyTotals() });
    cursor.setUTCMonth(cursor.getUTCMonth() - 1);
  }
  const byMonth = new Map(months.map((entry) => [entry.month, entry]));
  for (const trip of trips) {
    add(totals.total, trip);
    if (trip.day.startsWith(year)) {
      add(totals.year, trip);
    }
    if (trip.day.startsWith(month)) {
      add(totals.month, trip);
    }
    if (trip.day >= week && trip.day <= today) {
      add(totals.week, trip);
    }
    const bucket = byMonth.get(trip.day.slice(0, 7));
    if (bucket) {
      add(bucket, trip);
    }
  }
  return { ...totals, months, last: trips[0] ?? null };
}
