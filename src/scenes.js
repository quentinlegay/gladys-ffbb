// -----------------------------------------------------------------------------
// Scene actions (SDK v0.14+, Gladys 5.1+).
//
// `get_match` gives a scene the game of a followed team as outputs, for the
// following actions: "say the score", "if my team leads, turn the lights
// green", a notification with `{{summary}}`.
//
// It reads what the tracker already knows and never calls the FFBB: a
// reading could fire a scene event (a basket) as a consequence of the
// action, and a scene bound to that event would loop through the
// integration. The tracker reads every `live_refresh` seconds during a game,
// so the cache is fresh.
//
// The scene TRIGGERS (match_soon, match_started, team_scored,
// opponent_scored, match_ended) need no handler: the tracker fires them, see
// src/events.js.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { formatStatus } from './format.js';

const logger = createLogger({ name: 'scenes' });

export const GET_MATCH = 'get_match';

/**
 * Outputs of `get_match`, every key the manifest declares, always present.
 * @param {object | undefined} tracked
 */
export function matchOutputs(tracked, config, now = Date.now()) {
  const match = tracked?.match ?? null;
  return {
    state: match ? match.state : 'none',
    is_live: match?.state === 'in',
    team_score: match && match.state !== 'pre' ? match.team.score : 0,
    opponent_score: match && match.state !== 'pre' ? match.opponent.score : 0,
    opponent: match ? match.opponent.name : '',
    kickoff: match ? match.kickoff : '',
    result: match?.result ?? '',
    summary: formatStatus(match, config, now),
  };
}

export function createSceneActions(tracker) {
  return {
    async [GET_MATCH](_gladys, { fields, config }) {
      logger.info(`Scene action get_match <- ${fields.team}`);
      const tracked = tracker.findByDevice(fields.team);
      if (!tracked) {
        // A device removed from the followed teams: an error the scene logs,
        // the following actions still run.
        throw new Error(`${fields.team} is not a followed team any more`);
      }
      return matchOutputs(tracked, config, tracker.now());
    },
  };
}
