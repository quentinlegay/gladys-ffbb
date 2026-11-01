// -----------------------------------------------------------------------------
// Strava activity (SummaryActivity) -> the few fields the integration keeps.
//
// All activities are kept, counted or not: when the user changes which ones
// count (commutes only, sports, start date), the totals are rebuilt from the
// store without reading the whole history again.
// -----------------------------------------------------------------------------

/**
 * @typedef {object} Activity
 * @property {string} id
 * @property {string} name
 * @property {string} sport     `sport_type`, or the legacy `type`
 * @property {number} km
 * @property {string} start     ISO instant (UTC)
 * @property {string} day       local date of the start, YYYY-MM-DD
 * @property {boolean} commute
 * @property {boolean} indoor   home trainer: no distance travelled
 */

/** @returns {Activity | null} */
export function parseActivity(raw) {
  if (!raw || raw.id === undefined || raw.id === null) {
    return null;
  }
  const start = new Date(raw.start_date);
  if (Number.isNaN(start.getTime())) {
    return null;
  }
  const meters = Number(raw.distance);
  // start_date_local is the local wall clock written with a "Z": its date part
  // is the local day, whatever the time zone of the server.
  const local = typeof raw.start_date_local === 'string' ? raw.start_date_local : '';
  const day = /^\d{4}-\d{2}-\d{2}/.test(local)
    ? local.slice(0, 10)
    : start.toISOString().slice(0, 10);
  return {
    id: String(raw.id),
    name: typeof raw.name === 'string' ? raw.name.slice(0, 100) : '',
    sport: String(raw.sport_type || raw.type || ''),
    km: Number.isFinite(meters) && meters > 0 ? Math.round(meters) / 1000 : 0,
    start: start.toISOString(),
    day,
    commute: raw.commute === true,
    indoor: raw.trainer === true,
  };
}

export function parseActivities(list) {
  return (Array.isArray(list) ? list : []).map(parseActivity).filter(Boolean);
}
