// -----------------------------------------------------------------------------
// The Strava API v3: OAuth2 and the athlete's activities.
//
// Strava has no shared app for self-hosted software: the user creates their
// own API application (https://www.strava.com/settings/api) and pastes its
// client id and secret. Gladys relays the browser authorization (`oauth2`
// config field) and the integration exchanges the code for tokens here.
//
// Access tokens live 6 hours; the refresh token may change at every refresh,
// so the caller stores the new one each time (see src/strava/auth.js).
//
// `fetch` is injected: the tests never touch the network.
// -----------------------------------------------------------------------------

export const AUTHORIZE_URL = 'https://www.strava.com/oauth/authorize';
export const TOKEN_URL = 'https://www.strava.com/oauth/token';
export const API_URL = 'https://www.strava.com/api/v3';
// activity:read_all: commutes are often private activities.
export const SCOPE = 'read,activity:read_all';

const PAGE_SIZE = 200;
// 50 pages of 200: 10,000 activities, far beyond a commuting history, and a
// bound on the requests of one reading (Strava allows 100 per 15 minutes).
const MAX_PAGES = 50;
const TIMEOUT_MS = 20_000;

export class StravaError extends Error {
  /**
   * @param {'unauthorized' | 'rate_limited' | 'http' | 'network'} code
   */
  constructor(code, message, status = null) {
    super(message);
    this.name = 'StravaError';
    this.code = code;
    this.status = status;
  }
}

async function call(fetchFn, url, init = {}) {
  let response;
  try {
    response = await fetchFn(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    throw new StravaError('network', `Strava unreachable: ${err.message}`);
  }
  if (response.status === 401 || response.status === 403) {
    throw new StravaError('unauthorized', `Strava refused the token (${response.status})`, 401);
  }
  if (response.status === 429) {
    throw new StravaError('rate_limited', 'Strava rate limit reached', 429);
  }
  if (!response.ok) {
    throw new StravaError('http', `Strava answered ${response.status}`, response.status);
  }
  return response.json();
}

/** The URL the user's browser opens to authorize the integration. */
export function authorizeUrl({ clientId, redirectUri, state }) {
  const query = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    approval_prompt: 'auto',
    scope: SCOPE,
    state,
  });
  return `${AUTHORIZE_URL}?${query}`;
}

function toTokens(json, previous = {}) {
  if (!json?.access_token || !json?.refresh_token) {
    throw new StravaError('http', 'Strava returned no token');
  }
  const athlete = json.athlete ?? null;
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: Number(json.expires_at) || 0,
    // A refresh does not return the athlete: keep the known one.
    athleteId: athlete?.id !== undefined ? String(athlete.id) : (previous.athleteId ?? ''),
    athleteName: athlete
      ? [athlete.firstname, athlete.lastname].filter(Boolean).join(' ')
      : (previous.athleteName ?? ''),
  };
}

async function tokenRequest(fetchFn, params) {
  try {
    return await call(fetchFn, TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    });
  } catch (err) {
    // A 400 on the token endpoint is a revoked or unknown grant.
    if (err instanceof StravaError && err.status === 400) {
      throw new StravaError('unauthorized', 'Strava refused the authorization', 400);
    }
    throw err;
  }
}

/** Exchange the authorization code for the first tokens. */
export async function exchangeCode({
  fetch: fetchFn = globalThis.fetch,
  clientId,
  clientSecret,
  code,
}) {
  const json = await tokenRequest(fetchFn, {
    client_id: clientId,
    client_secret: clientSecret,
    code,
    grant_type: 'authorization_code',
  });
  return toTokens(json);
}

/** Get a fresh access token (and maybe a new refresh token). */
export async function refreshTokens({
  fetch: fetchFn = globalThis.fetch,
  clientId,
  clientSecret,
  tokens,
}) {
  const json = await tokenRequest(fetchFn, {
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: tokens.refreshToken,
    grant_type: 'refresh_token',
  });
  return toTokens(json, tokens);
}

/**
 * @param {{ fetch?: typeof fetch, accessToken: () => Promise<string> }} options
 */
export function createStravaClient({ fetch: fetchFn = globalThis.fetch, accessToken }) {
  async function get(path, query = {}) {
    const url = new URL(`${API_URL}${path}`);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }
    const token = await accessToken();
    return call(fetchFn, url, { headers: { authorization: `Bearer ${token}` } });
  }

  return {
    /** The authenticated athlete. */
    athlete() {
      return get('/athlete');
    },

    /**
     * Every activity started after `after` (epoch seconds), oldest pages
     * first as Strava returns them.
     * @returns {Promise<{ activities: object[], complete: boolean }>}
     */
    async activities({ after = 0 } = {}) {
      const activities = [];
      for (let page = 1; page <= MAX_PAGES; page += 1) {
        const batch = await get('/athlete/activities', { after, page, per_page: PAGE_SIZE });
        if (!Array.isArray(batch)) {
          throw new StravaError('http', 'Strava returned no activity list');
        }
        activities.push(...batch);
        if (batch.length < PAGE_SIZE) {
          return { activities, complete: true };
        }
      }
      return { activities, complete: false };
    },
  };
}
