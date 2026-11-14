// -----------------------------------------------------------------------------
// The LNB championships (Betclic ELITE, ELITE 2), read from TheSportsDB and
// handed to the tracker in the FFBB shape it already reads.
//
// The tracker knows competitions made of pools ("poules") of games
// ("rencontres"). Here a pool is one round of the championship, with the id
// `tsdb:<league>:<season>:<round>`, and each TheSportsDB event becomes a
// rencontre: home team first (equipe 1), the team id as both entry and club,
// `joue` once the game is final. Everything downstream — finding a team,
// picking its game, the games to come, the scene events — is shared.
//
// A followed team's pools are the rounds from the one before the current one
// to MAX_UPCOMING rounds after it: enough for the "Next games" widget.
// -----------------------------------------------------------------------------

import { MAX_UPCOMING } from '../ffbb/parse.js';

export const POULE_PREFIX = 'tsdb:';

const FINISHED = /^(FT|AOT|AET|AP|FINISHED|MATCH FINISHED)$/i;
const CANCELED = /^(CANC|ABD|AWD|WO|CANCELLED|ABANDONED)$/i;
const POSTPONED = /^(PST|POST|POSTPONED|SUSP|INT)$/i;
const LIVE = /^(Q[1-4]|OT\d?|HT|BT|LIVE|IN PLAY|1H|2H)$/i;

function text(value) {
  return value == null ? '' : String(value).trim();
}

/** A TheSportsDB date as an ISO instant: its timestamps are UTC without an offset. */
function instant(event) {
  const raw =
    text(event.strTimestamp) || `${text(event.dateEvent)}T${text(event.strTime) || '00:00:00'}`;
  const withZone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(raw) ? raw : `${raw}Z`;
  const parsed = Date.parse(withZone);
  return Number.isNaN(parsed) ? '' : new Date(parsed).toISOString();
}

/** One TheSportsDB event as a FFBB rencontre. */
export function eventToRencontre(event) {
  const status = text(event.strStatus);
  const home = text(event.intHomeScore);
  const away = text(event.intAwayScore);
  const final = FINISHED.test(status) && home !== '' && away !== '';
  const side = (n, prefix) => ({
    [`idEngagementEquipe${n}`]: {
      id: text(event[`id${prefix}Team`]),
      nom: text(event[`str${prefix}Team`]),
      nomUsuel: text(event[`str${prefix}Team`]),
      codeAbrege: '',
    },
    [`idOrganismeEquipe${n}`]: { id: text(event[`id${prefix}Team`]) },
    [`nomEquipe${n}`]: text(event[`str${prefix}Team`]),
  });
  const rencontre = {
    id: `tsdb-${text(event.idEvent)}`,
    numeroJournee: text(event.intRound),
    date_rencontre: instant(event),
    joue: final ? 1 : 0,
    resultatEquipe1: final ? home : null,
    resultatEquipe2: final ? away : null,
    remise: POSTPONED.test(status) || text(event.strPostponed).toLowerCase() === 'yes',
    salle: { libelle: text(event.strVenue) },
    ...side(1, 'Home'),
    ...side(2, 'Away'),
  };
  if (CANCELED.test(status)) {
    rencontre.gsId = { currentStatus: 'CANCELED' };
  } else if (LIVE.test(status) && home !== '' && away !== '') {
    // Only with a paid key: the score so far, as the FFBB live-stats game.
    rencontre.gsId = {
      currentStatus: 'LIVE',
      currentPeriod: status.toUpperCase(),
      score_q1_home: home,
      score_q1_out: away,
    };
  }
  return rencontre;
}

export function pouleId(leagueId, season, round) {
  return `${POULE_PREFIX}${leagueId}:${season}:${round}`;
}

function parsePouleId(id) {
  const [leagueId, season, round] = String(id).slice(POULE_PREFIX.length).split(':');
  return { leagueId, season, round: Number(round) };
}

/**
 * @param {ReturnType<import('./client.js').createTsdbClient>} client
 */
export function createLnbSource(client) {
  async function poule(id) {
    const { leagueId, season, round } = parsePouleId(id);
    const events = await client.round(leagueId, season, round);
    return { id, nom: `Journée ${round}`, rencontres: events.map(eventToRencontre) };
  }

  return {
    poule,

    /**
     * The current window of a championship: the rounds from the previous one
     * to MAX_UPCOMING after the current one, as pools, and a competition entry
     * for the logs. `competitions` is empty when the league has no game.
     */
    async competition(spec) {
      const league = await client.league(spec.tsdbLeague);
      const event =
        (await client.nextEvent(spec.tsdbLeague)) ?? (await client.pastEvent(spec.tsdbLeague));
      const season = text(event?.strSeason) || text(league?.strCurrentSeason);
      const current = Number.parseInt(event?.intRound, 10);
      if (!season || !Number.isFinite(current)) {
        return { competitions: [], poules: new Map() };
      }
      const poules = new Map();
      for (let round = Math.max(1, current - 1); round <= current + MAX_UPCOMING; round += 1) {
        const id = pouleId(spec.tsdbLeague, season, round);
        const read = await poule(id);
        if (read.rencontres.length === 0 && round > current) {
          // Past the last round of the season.
          break;
        }
        poules.set(id, read);
      }
      const name = text(league?.strLeague) || spec.competitionName;
      return {
        competitions: [
          { id: `tsdb-${spec.tsdbLeague}`, nom: `${name} ${season}`, code: 'TheSportsDB' },
        ],
        poules,
      };
    },
  };
}
