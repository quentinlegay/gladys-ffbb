// -----------------------------------------------------------------------------
// Scene action `get_savings`: the totals of a period, for the following
// actions of the scene ("send me every Sunday what my bike saved this week").
//
// It reads the tracker's last reading, never Strava: a scene firing often
// costs no request, and no scene event is ever fired from here (a scene bound
// to an event would loop through the integration).
// -----------------------------------------------------------------------------

import { formatTotals, PERIOD_LABELS } from './format.js';
import { PERIODS } from './stats.js';

const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;

export function getSavings(tracker, fields = {}) {
  const period = PERIODS.includes(fields.period) ? fields.period : 'total';
  const reading = tracker.reading;
  if (!reading) {
    throw new Error('No reading yet: the integration is starting.');
  }
  const totals = reading.summary[period];
  const language = tracker.config.language;
  const label = PERIOD_LABELS[period][language] ?? PERIOD_LABELS[period].en;
  return {
    co2_kg: round(totals.co2Kg, 2),
    money: round(totals.money, 2),
    distance_km: round(totals.km, 1),
    trips: totals.trips,
    fuel_price: round(reading.fuel.price, 3),
    summary: `${label}${language === 'fr' ? ' : ' : ': '}${formatTotals(totals, language)}`,
  };
}

/** Handlers keyed by the manifest `scene_actions` keys. */
export function createSceneActions(tracker) {
  return {
    get_savings: (fields) => getSavings(tracker, fields),
  };
}
