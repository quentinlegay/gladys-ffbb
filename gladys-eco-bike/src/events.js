// -----------------------------------------------------------------------------
// Two readings -> the scene events between them. Pure.
//
// - `trip_recorded`: a trip counted now that was not counted at the previous
//   reading, started within the last 7 days (an old activity tagged as a
//   commute today is history, not news), 10 at most per reading.
// - `co2_milestone`: the total CO2 avoided crossed a multiple of the
//   configured step (one event, for the highest multiple crossed).
//
// The first reading, and the first one after a change of which activities
// count, is a baseline: no event.
// -----------------------------------------------------------------------------

export const TRIGGERS = {
  TRIP_RECORDED: 'trip_recorded',
  CO2_MILESTONE: 'co2_milestone',
};

const RECENT_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_TRIP_EVENTS = 10;

const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;

/**
 * @param {{ countedIds: string[], co2Kg: number } | null} previous null = baseline
 * @param {{ trips: object[], summary: object }} current
 */
export function diffEvents(previous, current, config, now) {
  if (!previous) {
    return [];
  }
  const events = [];
  const known = new Set(previous.countedIds);
  const total = current.summary.total;
  const fresh = current.trips
    .filter((trip) => !known.has(trip.id) && now.getTime() - Date.parse(trip.start) <= RECENT_MS)
    .slice(0, MAX_TRIP_EVENTS)
    // Oldest first: the scenes hear them in the order they happened.
    .reverse();
  for (const trip of fresh) {
    events.push({
      key: TRIGGERS.TRIP_RECORDED,
      data: {
        name: trip.name,
        sport: trip.sport,
        date: trip.start,
        distance_km: round(trip.km, 2),
        co2_kg: round(trip.co2Kg, 3),
        money: round(trip.money, 2),
        total_co2_kg: round(total.co2Kg, 1),
        total_money: round(total.money, 2),
        total_distance_km: round(total.km, 1),
      },
    });
  }
  const step = config.milestone_kg;
  if (step > 0) {
    const before = Math.floor(previous.co2Kg / step);
    const after = Math.floor(total.co2Kg / step);
    if (after > before && after > 0) {
      events.push({
        key: TRIGGERS.CO2_MILESTONE,
        data: {
          milestone_kg: after * step,
          total_co2_kg: round(total.co2Kg, 1),
          total_money: round(total.money, 2),
          total_distance_km: round(total.km, 1),
          trips: total.trips,
        },
      });
    }
  }
  return events;
}
