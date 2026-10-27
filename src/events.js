// -----------------------------------------------------------------------------
// From two readings of a team's game to the scene events they mean.
//
// Pure functions: the tracker reads the FFBB for every followed team, keeps
// the previous reading (persisted in /data, so a restart neither replays nor
// misses an event) and asks this module what happened in between.
//
// One event per transition, never one per reading: points are the score
// going up between two readings (several baskets between two readings make
// ONE event with their total), the start is `pre` turning into `in`, the end
// is a completed `post`. The very first reading of a team is a baseline and
// fires nothing (a fresh install during a game must not announce a basket).
// -----------------------------------------------------------------------------

export const TRIGGERS = {
  MATCH_SOON: 'match_soon',
  MATCH_STARTED: 'match_started',
  TEAM_SCORED: 'team_scored',
  OPPONENT_SCORED: 'opponent_scored',
  MATCH_ENDED: 'match_ended',
};

/**
 * The `data` of a scene event: flat scalars only, the keys the manifest
 * declares in the trigger's `fields` (`team`, `home_away`, `result`) and
 * `variables`.
 * @param {{ key: string, match: object, points?: number, minutes?: number }} event
 * @param {string} deviceExternalId the followed team's device (the `team` filter)
 * @param {string} competitionName
 * @param {string} summary formatted status line
 */
export function eventData(event, deviceExternalId, competitionName, summary) {
  const { match } = event;
  const data = {
    team: deviceExternalId,
    team_name: match.team.name,
    opponent: match.opponent.name,
    home_away: match.homeAway,
    competition: competitionName,
    team_score: match.team.score,
    opponent_score: match.opponent.score,
    summary,
  };
  if (event.key === TRIGGERS.MATCH_SOON) {
    data.kickoff = match.kickoff;
    data.minutes = event.minutes;
  }
  if (event.key === TRIGGERS.TEAM_SCORED || event.key === TRIGGERS.OPPONENT_SCORED) {
    data.points = event.points;
  }
  if (event.key === TRIGGERS.MATCH_ENDED) {
    data.result = match.result;
  }
  return data;
}

// A tip-off reminder older than this is not sent any more (the integration
// was down when it was due).
const REMINDER_GRACE_MS = 5 * 60 * 1000;

/**
 * @param {object} args
 * @param {import('./ffbb/parse.js').Match | null | undefined} args.previous last reading (undefined: never read)
 * @param {import('./ffbb/parse.js').Match | null} args.current
 * @param {string | null} args.remindedFor id of the game the reminder was already sent for
 * @param {number} args.now
 * @param {number} args.reminderMinutes 0 disables the reminder
 * @returns {{ events: Array<{ key: string, match: object, points?: number, minutes?: number }>,
 *   remindedFor: string | null }}
 */
export function detectEvents({ previous, current, remindedFor = null, now, reminderMinutes }) {
  const events = [];
  let reminded = remindedFor;
  if (!current) {
    return { events, remindedFor: reminded };
  }

  // No reminder for a game whose time the FFBB has not set, nor a postponed one.
  if (
    current.state === 'pre' &&
    current.timeKnown &&
    current.statusName !== 'POSTPONED' &&
    reminderMinutes > 0 &&
    reminded !== current.id
  ) {
    const untilKickoff = Date.parse(current.kickoff) - now;
    if (untilKickoff <= reminderMinutes * 60_000 && untilKickoff > -REMINDER_GRACE_MS) {
      events.push({
        key: TRIGGERS.MATCH_SOON,
        match: current,
        minutes: Math.max(0, Math.round(untilKickoff / 60_000)),
      });
      reminded = current.id;
    }
  }

  // Baseline: nothing to compare with.
  if (previous === undefined) {
    return { events, remindedFor: reminded };
  }

  const sameMatch = previous !== null && previous.id === current.id;

  if (!sameMatch) {
    // Another game took the place of the previous one. Seen already under
    // way, it still started; seen already finished, it is not news.
    if (current.state === 'in') {
      events.push({ key: TRIGGERS.MATCH_STARTED, match: current });
    }
    return { events, remindedFor: reminded };
  }

  if (previous.state === 'pre' && current.state === 'in') {
    events.push({ key: TRIGGERS.MATCH_STARTED, match: current });
  }

  // Points only count once the game is under way (or just ended): a `pre`
  // reading carries no score worth comparing.
  if (previous.state === 'in' && (current.state === 'in' || current.state === 'post')) {
    const teamPoints = current.team.score - previous.team.score;
    const opponentPoints = current.opponent.score - previous.opponent.score;
    // A basket cancelled by the officials lowers the score: no event for that.
    if (teamPoints > 0) {
      events.push({ key: TRIGGERS.TEAM_SCORED, match: current, points: teamPoints });
    }
    if (opponentPoints > 0) {
      events.push({ key: TRIGGERS.OPPONENT_SCORED, match: current, points: opponentPoints });
    }
  }

  if (previous.state !== 'post' && current.state === 'post' && current.completed) {
    events.push({ key: TRIGGERS.MATCH_ENDED, match: current });
  }

  return { events, remindedFor: reminded };
}
