// -----------------------------------------------------------------------------
// Client of TheSportsDB, the source of the LNB championships.
//
// The LNB runs Betclic ELITE and ELITE 2 itself: the FFBB only publishes their
// friendly games, and the LNB's own API is private. TheSportsDB is a public,
// documented API (https://www.thesportsdb.com/docs/api) that lists them, with
// the free key "123":
//   - lookupleague.php?id=<league>      the current season;
//   - eventsnextleague.php?id=<league>  the next game, to know the round;
//   - eventspastleague.php?id=<league>  the last game, once the season is over;
//   - eventsround.php?id=&r=&s=         every game of one round, final scores.
// The free key gives no live score: a game goes from scheduled to final.
//
// The free key allows 30 requests a minute: requests are spaced, and a round
// is kept in cache (briefly when one of its games is close, an hour
// otherwise). `fetch` is injected so the tests never touch the network.
// -----------------------------------------------------------------------------

const BASE_URL = 'https://www.thesportsdb.com/api/v1/json';
// The public key TheSportsDB documents for free use.
export const FREE_KEY = '123';
const TIMEOUT_MS = 15_000;
// 30 requests a minute at most.
const MIN_INTERVAL_MS = 2_100;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
// A round with a game within a day: read again soon, its scores move.
const ROUND_TTL_ACTIVE = 2 * 60 * 1000;
const ROUND_TTL_IDLE = HOUR;

export class TsdbError extends Error {
  constructor(message, { status, url } = {}) {
    super(message);
    this.name = 'TsdbError';
    this.status = status;
    this.url = url;
  }
}

/**
 * @param {{ fetch?: typeof fetch, key?: string, timeoutMs?: number,
 *   minIntervalMs?: number, now?: () => number }} [options]
 */
export function createTsdbClient({
  fetch = globalThis.fetch,
  key = FREE_KEY,
  timeoutMs = TIMEOUT_MS,
  minIntervalMs = MIN_INTERVAL_MS,
  now = Date.now,
} = {}) {
  let queue = Promise.resolve();
  let last = 0;
  const rounds = new Map();

  // One request at a time, spaced by minIntervalMs.
  function getJson(path) {
    const run = queue.then(async () => {
      const wait = last + minIntervalMs - Date.now();
      if (wait > 0) {
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
      last = Date.now();
      const url = `${BASE_URL}/${encodeURIComponent(key)}/${path}`;
      let response;
      try {
        response = await fetch(url, {
          headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        throw new TsdbError(`TheSportsDB unreachable: ${err.message}`, { url: path });
      }
      if (!response.ok) {
        throw new TsdbError(`TheSportsDB HTTP ${response.status}`, {
          status: response.status,
          url: path,
        });
      }
      try {
        return await response.json();
      } catch {
        throw new TsdbError('TheSportsDB answered something that is not JSON', { url: path });
      }
    });
    queue = run.catch(() => {});
    return run;
  }

  const id = (value) => encodeURIComponent(String(value));

  return {
    /** The league, with its current season (`strCurrentSeason`). */
    async league(leagueId) {
      const json = await getJson(`lookupleague.php?id=${id(leagueId)}`);
      return json?.leagues?.[0] ?? null;
    },

    /** The next game of the league, or null. */
    async nextEvent(leagueId) {
      const json = await getJson(`eventsnextleague.php?id=${id(leagueId)}`);
      return json?.events?.[0] ?? null;
    },

    /** The last game of the league, or null. */
    async pastEvent(leagueId) {
      const json = await getJson(`eventspastleague.php?id=${id(leagueId)}`);
      return json?.events?.[0] ?? null;
    },

    /** Every game of one round ([] past the end of the season). */
    async round(leagueId, season, round) {
      const cacheKey = `${leagueId}/${season}/${round}`;
      const cached = rounds.get(cacheKey);
      if (cached && now() < cached.expires) {
        return cached.events;
      }
      const json = await getJson(
        `eventsround.php?id=${id(leagueId)}&r=${id(round)}&s=${id(season)}`,
      );
      const events = Array.isArray(json?.events) ? json.events : [];
      const active = events.some((event) => {
        const kickoff = Date.parse(`${event.strTimestamp ?? ''}Z`);
        return Number.isFinite(kickoff) && Math.abs(kickoff - now()) < DAY;
      });
      rounds.set(cacheKey, {
        events,
        expires: now() + (active ? ROUND_TTL_ACTIVE : ROUND_TTL_IDLE),
      });
      return events;
    },
  };
}
