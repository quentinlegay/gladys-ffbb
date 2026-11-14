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
// The free key is rate-limited harder than documented: measured in Nov. 2026,
// the 11th request within a minute gets a 429 with `Retry-After: 120`. So at
// most RATE_LIMIT requests a minute leave, a 429 pauses every request for its
// Retry-After, and answers are cached: a round for two minutes when one of its
// games is close (its scores move), six hours otherwise. A call that cannot
// leave now waits for its turn, or, with `{ wait: false }`, returns the last
// answer however old (TsdbBusyError when there is none). `fetch` is injected
// so the tests never touch the network.
// -----------------------------------------------------------------------------

const BASE_URL = 'https://www.thesportsdb.com/api/v1/json';
// The public key TheSportsDB documents for free use.
export const FREE_KEY = '123';
const TIMEOUT_MS = 15_000;
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
// Requests a minute, under the ~10 measured.
const RATE_LIMIT = 8;
const DEFAULT_RETRY_AFTER_MS = 2 * MINUTE;
// A round with a game within a day: read again soon, its scores move.
const ROUND_TTL_ACTIVE = 2 * MINUTE;
const ROUND_TTL_IDLE = 6 * HOUR;
const LEAGUE_TTL = 6 * HOUR;
const NEXT_TTL = 30 * MINUTE;

export class TsdbError extends Error {
  constructor(message, { status, url } = {}) {
    super(message);
    this.name = 'TsdbError';
    this.status = status;
    this.url = url;
  }
}

/** No request can leave now and nothing was read before. */
export class TsdbBusyError extends TsdbError {
  constructor(url) {
    super('TheSportsDB request quota used, try again in a minute', { status: 'busy', url });
    this.name = 'TsdbBusyError';
  }
}

/**
 * @param {{ fetch?: typeof fetch, key?: string, timeoutMs?: number,
 *   rateLimit?: number, now?: () => number,
 *   sleep?: (ms: number) => Promise<void> }} [options]
 */
export function createTsdbClient({
  fetch = globalThis.fetch,
  key = FREE_KEY,
  timeoutMs = TIMEOUT_MS,
  rateLimit = RATE_LIMIT,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  /** @type {number[]} when the requests of the last minute left */
  const sent = [];
  let blockedUntil = 0;
  let queue = Promise.resolve();
  /** @type {Map<string, { value: unknown, expires: number }>} */
  const cache = new Map();

  /** Milliseconds before a request may leave (0: now). */
  function delay() {
    const t = now();
    while (sent.length > 0 && t - sent[0] >= MINUTE) {
      sent.shift();
    }
    const quota = sent.length < rateLimit ? 0 : sent[0] + MINUTE - t;
    return Math.max(quota, blockedUntil - t, 0);
  }

  async function request(path) {
    sent.push(now());
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
    if (response.status === 429) {
      const seconds = Number(response.headers?.get?.('retry-after'));
      blockedUntil = now() + (Number.isFinite(seconds) ? seconds * 1000 : DEFAULT_RETRY_AFTER_MS);
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
  }

  /**
   * An answer: from the cache while fresh, else a request — awaited in turn,
   * or, without `wait`, only if one may leave now (else the stale answer).
   */
  async function get(path, ttl, { wait = true } = {}) {
    const cached = cache.get(path);
    if (cached && now() < cached.expires) {
      return cached.value;
    }
    if (!wait && delay() > 0) {
      if (cached) {
        return cached.value;
      }
      throw new TsdbBusyError(path);
    }
    // One request at a time, so the quota check and the send stay together.
    const run = queue.then(async () => {
      const again = cache.get(path);
      if (again && now() < again.expires) {
        return again.value;
      }
      const wait = delay();
      if (wait > 0) {
        await sleep(wait);
      }
      const value = await request(path);
      cache.set(path, { value, expires: now() + ttl(value) });
      return value;
    });
    queue = run.catch(() => {});
    return run;
  }

  const id = (value) => encodeURIComponent(String(value));

  return {
    /** The league, with its current season (`strCurrentSeason`). */
    async league(leagueId, options) {
      const json = await get(`lookupleague.php?id=${id(leagueId)}`, () => LEAGUE_TTL, options);
      return json?.leagues?.[0] ?? null;
    },

    /** The next game of the league, or null. */
    async nextEvent(leagueId, options) {
      const json = await get(`eventsnextleague.php?id=${id(leagueId)}`, () => NEXT_TTL, options);
      return json?.events?.[0] ?? null;
    },

    /** The last game of the league, or null. */
    async pastEvent(leagueId, options) {
      const json = await get(`eventspastleague.php?id=${id(leagueId)}`, () => NEXT_TTL, options);
      return json?.events?.[0] ?? null;
    },

    /** Every game of one round ([] past the end of the season). */
    async round(leagueId, season, round, options) {
      const json = await get(
        `eventsround.php?id=${id(leagueId)}&r=${id(round)}&s=${id(season)}`,
        (value) => {
          const events = Array.isArray(value?.events) ? value.events : [];
          const active = events.some((event) => {
            const kickoff = Date.parse(`${event.strTimestamp ?? ''}Z`);
            return Number.isFinite(kickoff) && Math.abs(kickoff - now()) < DAY;
          });
          return active ? ROUND_TTL_ACTIVE : ROUND_TTL_IDLE;
        },
        options,
      );
      return Array.isArray(json?.events) ? json.events : [];
    },
  };
}
