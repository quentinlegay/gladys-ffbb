// -----------------------------------------------------------------------------
// Device type: FOLLOWED TEAM
//
// One Gladys device per followed team, four read-only features:
//   - team-score      the team's score in the current (or last) game;
//   - opponent-score  the opponent's score;
//   - status          one line: "En direct · Q3 05:12 · Monaco 56 – 50 ASVEL";
//   - next-match      the next game, even while the last result is shown:
//                     "sam. 8 nov., 20:00 · contre ASVEL".
//
// Scores are `counter-sensor` integers, so scene conditions can compare them
// ("if my team leads"). The status is a `text` feature: Gladys shows it as is
// and never marks it as outdated.
//
// The external id is built from the competition and the FFBB club id, never
// from what the user typed: "ELITE:Monaco" and "ELITE:AS Monaco" are the
// same device, and the device survives a change of name or season.
// -----------------------------------------------------------------------------

import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';
import { formatNext, formatStatus } from '../format.js';
import { competitionKey } from '../competitions.js';

export const DEVICE_TYPE = 'team';

export const FEATURE = {
  TEAM_SCORE: 'team-score',
  OPPONENT_SCORE: 'opponent-score',
  STATUS: 'status',
  NEXT_MATCH: 'next-match',
};

const FEATURE_NAMES = {
  en: {
    [FEATURE.TEAM_SCORE]: 'Score',
    [FEATURE.OPPONENT_SCORE]: 'Opponent score',
    [FEATURE.STATUS]: 'Game',
    [FEATURE.NEXT_MATCH]: 'Next game',
  },
  fr: {
    [FEATURE.TEAM_SCORE]: 'Score',
    [FEATURE.OPPONENT_SCORE]: 'Score adverse',
    [FEATURE.STATUS]: 'Match',
    [FEATURE.NEXT_MATCH]: 'Prochain match',
  },
};

// Highest score a feature accepts: nothing in basketball goes past 999.
const MAX_SCORE = 999;

/**
 * Ids of a followed team's device and features.
 * @param {{ code: string }} competition
 * @param {string} teamId FFBB club id
 */
export function teamExternalIds(gladys, competition, teamId) {
  return gladys.externalIds(DEVICE_TYPE, `${competitionKey(competition)}.${teamId}`);
}

/**
 * Discovery payload of a followed team.
 * @param {{ spec: object, info: { id: string, name: string } }} tracked
 */
export function buildTeamDevice(gladys, tracked, config) {
  const ids = teamExternalIds(gladys, tracked.spec, tracked.info.id);
  const names = FEATURE_NAMES[config.language] ?? FEATURE_NAMES.en;
  const score = (key) => ({
    name: names[key],
    external_id: ids.feature(key),
    category: DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR,
    type: DEVICE_FEATURE_TYPES.SENSOR.INTEGER,
    min: 0,
    max: MAX_SCORE,
    read_only: true,
    has_feedback: false,
    keep_history: true,
  });
  const textFeature = (key) => ({
    name: names[key],
    external_id: ids.feature(key),
    category: DEVICE_FEATURE_CATEGORIES.TEXT,
    type: DEVICE_FEATURE_TYPES.TEXT.TEXT,
    // Gladys stores min/max as NOT NULL, text features included.
    min: 0,
    max: 0,
    read_only: true,
    has_feedback: false,
    keep_history: false,
  });
  return {
    name: `${tracked.info.name} (${tracked.spec.competitionName})`,
    external_id: ids.device,
    features: [
      score(FEATURE.TEAM_SCORE),
      score(FEATURE.OPPONENT_SCORE),
      textFeature(FEATURE.STATUS),
      textFeature(FEATURE.NEXT_MATCH),
    ],
  };
}

/**
 * States of a followed team, in the `publishStates` shape. Before a game
 * (`pre`) the scores read 0: a condition "my team leads" must not hold on the
 * score of the previous game.
 */
export function teamStates(gladys, tracked, config, now) {
  const ids = teamExternalIds(gladys, tracked.spec, tracked.info.id);
  const { match } = tracked;
  const states = [];
  if (match) {
    const started = match.state !== 'pre';
    states.push(
      {
        device_feature_external_id: ids.feature(FEATURE.TEAM_SCORE),
        state: started ? match.team.score : 0,
      },
      {
        device_feature_external_id: ids.feature(FEATURE.OPPONENT_SCORE),
        state: started ? match.opponent.score : 0,
      },
    );
  }
  states.push({
    device_feature_external_id: ids.feature(FEATURE.STATUS),
    text: formatStatus(match, config, now),
  });
  states.push({
    device_feature_external_id: ids.feature(FEATURE.NEXT_MATCH),
    text: formatNext(tracked.upcoming?.[0] ?? null, config),
  });
  return states;
}
