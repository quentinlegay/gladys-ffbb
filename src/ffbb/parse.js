// -----------------------------------------------------------------------------
// Read the FFBB answers into the few values the integration uses.
//
// The API mixes formats: an id is a number or a string, a date is
// "2026-10-11 20:00:00" (French local time, no offset), "2026-10-11T20:00:00"
// or a full ISO date, a final score is a string ("85"). The live feed has its
// own vocabulary (matchStatus, currentStatus). Everything is read
// defensively: a missing field gives a neutral value, never an exception.
// -----------------------------------------------------------------------------

/**
 * A game, seen from the followed team.
 * @typedef {object} Match
 * @property {string} id             FFBB rencontre id
 * @property {'pre' | 'in' | 'post'} state
 * @property {boolean} completed     played to the end (false when postponed or canceled)
 * @property {string} statusName     raw status of the live feed, e.g. LIVE, COMPLETE, POSTPONED
 * @property {string} period         "Q3", "OT1", "HT"… while live
 * @property {string} clock          "05:12" while live
 * @property {string} kickoff        ISO date (UTC)
 * @property {boolean} timeKnown     false when the FFBB has not set the time yet
 * @property {'home' | 'away'} homeAway
 * @property {{ id: string, abbreviation: string, name: string, score: number }} team
 * @property {{ id: string, abbreviation: string, name: string, score: number }} opponent
 * @property {'win' | 'loss' | 'draw' | null} result
 * @property {string} venue
 * @property {number | null} round   "journée"
 */

// Games are scheduled in French local time.
export const FFBB_TIMEZONE = 'Europe/Paris';

const FINISHED = /^(COMPLETE|COMPLETED|FINISHED|FINAL|ENDED|OVER|TERMINEE?|JOUE)$/;
const CANCELED = /CANCEL|ANNUL|ABANDON|FORFAIT|FORFEIT/;
const POSTPONED = /POSTPON|REPORT|DELAY|SUSPEND/;
const LIVE =
  /^(LIVE|IN_PROGRESS|EN_COURS|LIVE_STREAMING|STARTED|PLAYING|HALFTIME|HALF_TIME|BREAK)$/;
const SCHEDULED = /^(SCHEDULED|NOT_STARTED|PROGRAMME|PREVU|UPCOMING|PENDING|)$/;

function text(value) {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value);
}

function upper(value) {
  return text(value).toUpperCase().replace(/\s+/g, '_');
}

function readScore(value) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function id(value) {
  return value && typeof value === 'object' ? text(value.id) : text(value);
}

/** Milliseconds `zone` is ahead of UTC at the instant `timestamp`. */
function zoneOffset(timestamp, zone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(new Date(timestamp))
      .map((part) => [part.type, Number(part.value)]),
  );
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return asUtc - Math.floor(timestamp / 1000) * 1000;
}

/**
 * A FFBB date as an ISO instant. A date without an offset is French local
 * time; midnight, or no time at all, means "time not set yet".
 * @returns {{ iso: string, timeKnown: boolean }}
 */
export function parseFfbbDate(raw) {
  const value = text(raw);
  const local = value.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?$/,
  );
  if (local) {
    const [, y, mo, d, h = '0', mi = '0', s = '0'] = local;
    const wall = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
    // The offset at the wall time, corrected once for the DST switch.
    let instant = wall - zoneOffset(wall, FFBB_TIMEZONE);
    instant = wall - zoneOffset(instant, FFBB_TIMEZONE);
    return { iso: new Date(instant).toISOString(), timeKnown: +h !== 0 || +mi !== 0 };
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return { iso: '', timeKnown: false };
  }
  return { iso: new Date(parsed).toISOString(), timeKnown: true };
}

/** The two sides of a game: engagement (team entry) and club. */
function sides(rencontre) {
  return [1, 2].map((n) => {
    const engagement = rencontre[`idEngagementEquipe${n}`];
    const engaged = engagement && typeof engagement === 'object' ? engagement : {};
    const name = text(engaged.nomUsuel || engaged.nom || rencontre[`nomEquipe${n}`]);
    return {
      engagementId: id(engagement),
      organismeId: id(rencontre[`idOrganismeEquipe${n}`]),
      name,
      officialName: text(rencontre[`nomEquipe${n}`] || engaged.nom),
      abbreviation: text(engaged.codeAbrege),
    };
  });
}

/** The identity of a team in its competition: the club, else the entry. */
function teamId(side) {
  return side.organismeId || side.engagementId;
}

/**
 * The teams of a competition, from the games of its pools.
 * @param {object[]} poules answers of the `poule` endpoint
 * @returns {Array<{ id: string, name: string, officialName: string,
 *   abbreviation: string, engagementIds: string[], pouleIds: string[] }>}
 */
export function teamsFromPoules(poules) {
  const teams = new Map();
  for (const poule of poules) {
    for (const rencontre of poule?.rencontres ?? []) {
      for (const side of sides(rencontre)) {
        const key = teamId(side);
        if (!key) {
          continue;
        }
        const team = teams.get(key) ?? {
          id: key,
          name: side.name,
          officialName: side.officialName,
          abbreviation: side.abbreviation,
          engagementIds: [],
          pouleIds: [],
        };
        if (side.engagementId && !team.engagementIds.includes(side.engagementId)) {
          team.engagementIds.push(side.engagementId);
        }
        const pouleId = text(poule.id);
        if (pouleId && !team.pouleIds.includes(pouleId)) {
          team.pouleIds.push(pouleId);
        }
        teams.set(key, team);
      }
    }
  }
  return [...teams.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

/** Lowercase, no accents, words separated by single spaces. */
export function normalize(value) {
  return text(value)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Find the team the user wrote: its FFBB club or entry id, its exact name or
 * abbreviation, else the only team whose name contains the words.
 * @returns {{ team?: object, error?: 'not_found' | 'ambiguous', candidates?: object[] }}
 */
export function findTeam(teams, query) {
  const raw = text(query);
  const byId = teams.find((team) => team.id === raw || team.engagementIds.includes(raw));
  if (byId) {
    return { team: byId };
  }
  const wanted = normalize(raw);
  if (!wanted) {
    return { error: 'not_found', candidates: [] };
  }
  const names = (team) => [team.name, team.officialName, team.abbreviation].map(normalize);
  const exact = teams.filter((team) => names(team).includes(wanted));
  if (exact.length === 1) {
    return { team: exact[0] };
  }
  const partial =
    exact.length > 1
      ? exact
      : teams.filter((team) =>
          names(team).some((name) => ` ${name} `.includes(` ${wanted} `) || name.includes(wanted)),
        );
  if (partial.length === 1) {
    return { team: partial[0] };
  }
  if (partial.length > 1) {
    return { error: 'ambiguous', candidates: partial };
  }
  return { error: 'not_found', candidates: [] };
}

/**
 * The competitions of the current season among those the API returned for a
 * code: the active season, else the most recent one.
 */
export function currentCompetitions(competitions) {
  const list = (competitions ?? []).filter((c) => c && c.id != null);
  const season = (c) => (c.saison && typeof c.saison === 'object' ? c.saison : {});
  const active = list.filter((c) => season(c).actif === true);
  if (active.length > 0) {
    return active;
  }
  const latest = list.reduce(
    (max, c) => (text(season(c).debut) > max ? text(season(c).debut) : max),
    '',
  );
  return latest ? list.filter((c) => text(season(c).debut) === latest) : list;
}

/** Every pool of the competitions, phases included, without duplicates. */
export function poulesOf(competitions) {
  const ids = new Set();
  for (const competition of competitions) {
    const poules = [
      ...(competition.poules ?? []),
      ...(competition.phases ?? []).flatMap((phase) => phase?.poules ?? []),
    ];
    for (const poule of poules) {
      const pouleId = id(poule);
      if (pouleId) {
        ids.add(pouleId);
      }
    }
  }
  return [...ids];
}

function sumPeriods(gs, side) {
  let total = null;
  for (const period of ['q1', 'q2', 'q3', 'q4', 'ot1', 'ot2']) {
    const score = readScore(gs?.[`score_${period}_${side}`]);
    if (score !== null) {
      total = (total ?? 0) + score;
    }
  }
  return total;
}

function clockText(raw) {
  // The feed writes "MM:SS:mmm".
  const match = text(raw).match(/^(\d{1,2}):(\d{2})/);
  return match ? `${match[1].padStart(2, '0')}:${match[2]}` : '';
}

/**
 * State and scores of a game, from its pool entry and the live feed. The
 * pool says when it is over (`joue` + final scores); the live feed, when it
 * is being played.
 * @returns {{ state: 'pre' | 'in' | 'post', completed: boolean, statusName: string,
 *   period: string, clock: string, home: number, away: number }}
 */
function gameState(rencontre, live) {
  const finalHome = readScore(rencontre.resultatEquipe1);
  const finalAway = readScore(rencontre.resultatEquipe2);
  const played = rencontre.joue === true || Number(rencontre.joue) === 1;
  if (played && finalHome !== null && finalAway !== null) {
    return {
      state: 'post',
      completed: true,
      statusName: 'FINISHED',
      period: '',
      clock: '',
      home: finalHome,
      away: finalAway,
    };
  }

  const gs = rencontre.gsId && typeof rencontre.gsId === 'object' ? rencontre.gsId : {};
  const status = upper(live?.matchStatus ?? live?.match_status);
  const current = upper(live?.currentStatus ?? gs.currentStatus);
  const period = text(live?.currentPeriod ?? gs.currentPeriod);
  const home =
    readScore(live?.score_home) ?? sumPeriods(live ?? gs, 'home') ?? sumPeriods(gs, 'home') ?? 0;
  const away =
    readScore(live?.score_out) ?? sumPeriods(live ?? gs, 'out') ?? sumPeriods(gs, 'out') ?? 0;
  const base = { period, clock: clockText(live?.clock), home, away };

  if (CANCELED.test(status) || CANCELED.test(current)) {
    return { ...base, state: 'post', completed: false, statusName: 'CANCELED' };
  }
  if (POSTPONED.test(status) || POSTPONED.test(current)) {
    return { ...base, state: 'pre', completed: false, statusName: 'POSTPONED' };
  }
  if (FINISHED.test(status) || FINISHED.test(current)) {
    return { ...base, state: 'post', completed: true, statusName: 'FINISHED' };
  }
  const running =
    LIVE.test(status) ||
    LIVE.test(current) ||
    /^(QUARTER|PERIOD|OVERTIME|Q\d|OT\d)/.test(status) ||
    (live && !SCHEDULED.test(status) && Boolean(period));
  if (running) {
    return { ...base, state: 'in', completed: false, statusName: status || current || 'LIVE' };
  }
  return { ...base, state: 'pre', completed: false, statusName: '', home: 0, away: 0 };
}

/**
 * The game of a pool entry as seen from `teamKey` (club or entry id), or
 * null when the team does not play it.
 * @param {object} rencontre
 * @param {string} teamKey
 * @param {object} [live] the entry of the live feed for this game
 * @returns {Match | null}
 */
export function matchFromRencontre(rencontre, teamKey, live) {
  const [home, away] = sides(rencontre ?? {});
  const isHome = teamId(home) === teamKey || home.engagementId === teamKey;
  const isAway = teamId(away) === teamKey || away.engagementId === teamKey;
  if (!isHome && !isAway) {
    return null;
  }
  const mine = isHome ? home : away;
  const other = isHome ? away : home;
  const game = gameState(rencontre, live);
  const myScore = isHome ? game.home : game.away;
  const otherScore = isHome ? game.away : game.home;
  const { iso, timeKnown } = parseFfbbDate(rencontre.date_rencontre);

  let result = null;
  if (game.state === 'post' && game.completed) {
    result = myScore > otherScore ? 'win' : myScore < otherScore ? 'loss' : 'draw';
  }
  const salle = rencontre.salle && typeof rencontre.salle === 'object' ? rencontre.salle : {};
  const round = Number.parseInt(rencontre.numeroJournee, 10);

  return {
    id: text(rencontre.id),
    state: game.state,
    completed: game.completed,
    statusName: game.statusName,
    period: game.period,
    clock: game.clock,
    kickoff: iso,
    timeKnown,
    homeAway: isHome ? 'home' : 'away',
    team: { id: teamId(mine), abbreviation: mine.abbreviation, name: mine.name, score: myScore },
    opponent: {
      id: teamId(other),
      abbreviation: other.abbreviation,
      name: other.name,
      score: otherScore,
    },
    result,
    venue: [text(salle.libelle), text(salle.commune?.libelle)].filter(Boolean).join(', '),
    round: Number.isFinite(round) ? round : null,
  };
}

// A finished game stays on display this long after its tip-off, before the
// next one takes its place.
const RECENT_POST_MS = 18 * 60 * 60 * 1000;

/**
 * Pick the game of `teamKey` to show: a live one wins, then one finished in
 * the last hours, then the next one to come, else the last one played.
 * @param {object[]} rencontres every game of the team's pools
 * @param {(rencontre: object) => object | undefined} liveOf
 * @returns {Match | null}
 */
export function pickMatch(rencontres, teamKey, liveOf, now = Date.now()) {
  const matches = rencontres
    .map((rencontre) => matchFromRencontre(rencontre, teamKey, liveOf(rencontre)))
    .filter((match) => match && match.kickoff)
    .sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff));
  if (matches.length === 0) {
    return null;
  }
  const live = matches.find((match) => match.state === 'in');
  if (live) {
    return live;
  }
  const recent = matches
    .filter((match) => match.state === 'post' && now - Date.parse(match.kickoff) < RECENT_POST_MS)
    .at(-1);
  if (recent) {
    return recent;
  }
  // A game left `pre` long after its tip-off has a result the FFBB has not
  // entered yet: it is still the one to show, until the next day.
  const next = matches.find(
    (match) => match.state === 'pre' && Date.parse(match.kickoff) > now - RECENT_POST_MS,
  );
  return next ?? matches.filter((match) => match.state === 'post').at(-1) ?? null;
}

/** The live feed indexed by its game id, for liveOf(). */
export function indexLives(lives) {
  const byId = new Map();
  for (const live of lives ?? []) {
    const key = text(live?.matchId ?? live?.match_id);
    if (key) {
      byId.set(key, live);
    }
  }
  return (rencontre) => {
    const gs = rencontre?.gsId;
    const key = text(gs && typeof gs === 'object' ? gs.matchId : gs);
    return key ? byId.get(key) : undefined;
  };
}
