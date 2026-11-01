// -----------------------------------------------------------------------------
// A `fetch` that answers like Strava and the fuel price open data, from the
// fixtures, and records every request. Tests never touch the network.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

export function fixture(name) {
  return JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/**
 * @param {object} [options]
 * @param {object[]} [options.activities] what Strava holds
 * @param {object} [options.stations] the fuel open data answer
 * @param {object} [options.token] the token endpoint answer
 */
export function createFakeFetch({
  activities = fixture('activities.json'),
  stations = fixture('stations.json'),
  token = fixture('token.json'),
} = {}) {
  const fake = {
    activities,
    stations,
    token,
    requests: [],
    // Per route, a status to answer instead of the data: { strava: 401, ... }
    failures: {},
    // Access tokens Strava accepts (null: any).
    validTokens: null,

    fetch: async (input, init = {}) => {
      const url = new URL(String(input));
      const request = {
        url,
        method: init.method ?? 'GET',
        headers: init.headers ?? {},
        body: init.body,
      };
      fake.requests.push(request);
      if (url.hostname === 'data.economie.gouv.fr') {
        if (fake.failures.fuel === 'network') {
          throw new TypeError('fetch failed');
        }
        return fake.failures.fuel ? json({}, fake.failures.fuel) : json(fake.stations);
      }
      if (url.href.startsWith('https://www.strava.com/oauth/token')) {
        if (fake.failures.token) {
          return json({ message: 'Bad Request' }, fake.failures.token);
        }
        return json(fake.token);
      }
      if (url.href.startsWith('https://www.strava.com/api/v3/')) {
        if (fake.failures.strava === 'network') {
          throw new TypeError('fetch failed');
        }
        if (fake.failures.strava) {
          return json({ message: 'error' }, fake.failures.strava);
        }
        const bearer = (request.headers.authorization ?? '').replace('Bearer ', '');
        if (fake.validTokens && !fake.validTokens.includes(bearer)) {
          return json({ message: 'Authorization Error' }, 401);
        }
        if (url.pathname === '/api/v3/athlete/activities') {
          const after = Number(url.searchParams.get('after') ?? 0);
          const page = Number(url.searchParams.get('page') ?? 1);
          const perPage = Number(url.searchParams.get('per_page') ?? 30);
          const matching = fake.activities
            .filter((activity) => Date.parse(activity.start_date) / 1000 > after)
            .sort((a, b) => Date.parse(a.start_date) - Date.parse(b.start_date));
          return json(matching.slice((page - 1) * perPage, page * perPage));
        }
        if (url.pathname === '/api/v3/athlete') {
          return json({ id: 4242, firstname: 'Camille', lastname: 'Martin' });
        }
      }
      return json({ message: 'Not Found' }, 404);
    },

    /** Requests to a route: 'strava', 'token' or 'fuel'. */
    calls(route) {
      return fake.requests.filter(({ url }) => {
        if (route === 'fuel') return url.hostname === 'data.economie.gouv.fr';
        if (route === 'token') return url.pathname === '/oauth/token';
        return url.pathname.startsWith('/api/v3/');
      });
    },
  };
  return fake;
}
