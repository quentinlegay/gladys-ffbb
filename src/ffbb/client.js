// -----------------------------------------------------------------------------
// Client of the public FFBB API, the one behind the official FFBB app.
//
// A Directus server at https://api.ffbb.app/ :
//   - items/configuration            public: hands out the read token (key_dh);
//   - items/ffbbserver_competitions  competitions, filtered by code or name:
//                                    their season and pools ("poules");
//   - items/ffbbserver_poules/<id>   a pool with all its games ("rencontres"):
//                                    teams, date, final scores;
//   - json/lives.json                the games being played right now, with
//                                    the live score, period and clock.
//
// No account: the app reads its token from the configuration endpoint, and so
// does this client. The token is cached, read again when the API refuses it,
// and never logged. The API is undocumented: every call has a timeout and the
// caller keeps the last known data when one fails. `fetch` is injected so the
// tests never touch the network.
// -----------------------------------------------------------------------------

const BASE_URL = 'https://api.ffbb.app/';
const TIMEOUT_MS = 15_000;
// The configuration endpoint answers the app's HTTP client.
const USER_AGENT = 'okhttp/4.12.0';

// What the tracker reads of a pool's games. Directus returns only the fields
// asked for, which keeps a season of games (240 in Betclic ELITE) small.
export const RENCONTRE_FIELDS = [
  'id',
  'numeroJournee',
  'date_rencontre',
  'joue',
  'resultatEquipe1',
  'resultatEquipe2',
  'nomEquipe1',
  'nomEquipe2',
  'idEngagementEquipe1.id',
  'idEngagementEquipe1.nom',
  'idEngagementEquipe1.nomUsuel',
  'idEngagementEquipe1.codeAbrege',
  'idEngagementEquipe2.id',
  'idEngagementEquipe2.nom',
  'idEngagementEquipe2.nomUsuel',
  'idEngagementEquipe2.codeAbrege',
  'idOrganismeEquipe1.id',
  'idOrganismeEquipe2.id',
  'salle.libelle',
  'salle.commune.libelle',
  'gsId.matchId',
  'gsId.currentStatus',
  'gsId.currentPeriod',
  ...['q1', 'q2', 'q3', 'q4', 'ot1', 'ot2'].flatMap((period) => [
    `gsId.score_${period}_home`,
    `gsId.score_${period}_out`,
  ]),
];

// Fields read when the FFBB allows them: it restricts fields now and then,
// and Directus refuses the whole request (403) when one is forbidden. A
// pool refused with them is read again without them.
//   - horaire  the tip-off time, when `date_rencontre` holds only the day;
//   - remise   the game is postponed.
export const OPTIONAL_RENCONTRE_FIELDS = ['horaire', 'remise'];

const COMPETITION_FIELDS = [
  'id',
  'nom',
  'code',
  'sexe',
  'saison.id',
  'saison.actif',
  'saison.debut',
  'saison.libelle',
  'poules.id',
  'poules.nom',
  'phases.poules.id',
  'phases.poules.nom',
];

export class FfbbError extends Error {
  constructor(message, { status, url } = {}) {
    super(message);
    this.name = 'FfbbError';
    this.status = status;
    this.url = url;
  }
}

function withParams(path, params) {
  const search = new URLSearchParams();
  for (const [key, value] of params) {
    search.append(key, value);
  }
  return `${BASE_URL}${path}?${search}`;
}

/**
 * @param {{ fetch?: typeof fetch, timeoutMs?: number }} [options]
 */
export function createFfbbClient({ fetch = globalThis.fetch, timeoutMs = TIMEOUT_MS } = {}) {
  let token = null;
  // Cleared for good once the FFBB refuses the optional fields.
  let optionalAllowed = true;

  async function request(url, headers) {
    let response;
    try {
      response = await fetch(url, {
        headers: { accept: 'application/json', 'user-agent': USER_AGENT, ...headers },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new FfbbError(`FFBB unreachable: ${err.message}`, { url });
    }
    if (!response.ok) {
      throw new FfbbError(`FFBB HTTP ${response.status}`, { status: response.status, url });
    }
    try {
      return await response.json();
    } catch {
      throw new FfbbError('FFBB answered something that is not JSON', { url });
    }
  }

  async function readToken() {
    const json = await request(`${BASE_URL}items/configuration`, {});
    const key = (json?.data ?? json)?.key_dh;
    if (typeof key !== 'string' || !key) {
      throw new FfbbError('FFBB configuration without a token', { url: 'items/configuration' });
    }
    return key;
  }

  async function getJson(url) {
    token ??= await readToken();
    try {
      return await request(url, { authorization: `Bearer ${token}` });
    } catch (err) {
      // The app rotates its token now and then: read it again, once.
      if (err.status !== 401 && err.status !== 403) {
        throw err;
      }
      token = await readToken();
      return request(url, { authorization: `Bearer ${token}` });
    }
  }

  return {
    /** Every competition carrying one of `codes`, all seasons mixed. */
    async competitions(codes) {
      const url = withParams('items/ffbbserver_competitions', [
        ['filter[code][_in]', codes.join(',')],
        ['limit', '100'],
        ...COMPETITION_FIELDS.map((field) => ['fields[]', field]),
      ]);
      const json = await getJson(url);
      return Array.isArray(json?.data) ? json.data : [];
    },

    /**
     * Every competition whose name contains `term` (case and accents as the
     * server compares them), all seasons mixed: the fallback when the code of
     * a competition is not the one expected.
     */
    async searchCompetitions(term) {
      const url = withParams('items/ffbbserver_competitions', [
        ['filter[nom][_icontains]', term],
        ['limit', '500'],
        ...COMPETITION_FIELDS.map((field) => ['fields[]', field]),
      ]);
      const json = await getJson(url);
      return Array.isArray(json?.data) ? json.data : [];
    },

    /** A pool and all its games. */
    async poule(pouleId) {
      const url = (fields) =>
        withParams(`items/ffbbserver_poules/${encodeURIComponent(pouleId)}`, [
          ['deep[rencontres][_limit]', '1000'],
          ['fields[]', 'id'],
          ['fields[]', 'nom'],
          ...fields.map((field) => ['fields[]', `rencontres.${field}`]),
        ]);
      if (optionalAllowed) {
        try {
          const json = await getJson(url([...RENCONTRE_FIELDS, ...OPTIONAL_RENCONTRE_FIELDS]));
          return json?.data ?? null;
        } catch (err) {
          if (err.status !== 403) {
            throw err;
          }
          optionalAllowed = false;
        }
      }
      const json = await getJson(url(RENCONTRE_FIELDS));
      return json?.data ?? null;
    },

    /** The games being played right now, every competition of France. */
    async lives() {
      const json = await getJson(`${BASE_URL}json/lives.json`);
      return Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : [];
    },
  };
}
