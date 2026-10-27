import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectEvents, eventData, TRIGGERS } from '../src/events.js';

const NOW = Date.parse('2026-11-01T18:40:00Z');
const game = (state, team = 0, opponent = 0, extra = {}) => ({
  id: 'g1',
  state,
  completed: state === 'post',
  statusName: '',
  kickoff: '2026-11-01T19:00:00.000Z',
  timeKnown: true,
  homeAway: 'home',
  team: { name: 'Monaco', score: team },
  opponent: { name: 'ASVEL', score: opponent },
  result: state === 'post' ? (team > opponent ? 'win' : 'loss') : null,
  ...extra,
});
const keys = (result) => result.events.map((e) => e.key);
const detect = (previous, current, extra = {}) =>
  detectEvents({ previous, current, now: NOW, reminderMinutes: 30, ...extra });

test('the first reading is a baseline, except for the reminder', () => {
  assert.deepEqual(keys(detect(undefined, game('in', 10, 2))), []);
  const soon = detect(undefined, game('pre'));
  assert.deepEqual(keys(soon), [TRIGGERS.MATCH_SOON]);
  assert.equal(soon.events[0].minutes, 20);
  assert.equal(soon.remindedFor, 'g1');
  // Already reminded, unknown time, postponed or reminder off: nothing.
  assert.deepEqual(keys(detect(undefined, game('pre'), { remindedFor: 'g1' })), []);
  assert.deepEqual(keys(detect(undefined, game('pre', 0, 0, { timeKnown: false }))), []);
  assert.deepEqual(keys(detect(undefined, game('pre', 0, 0, { statusName: 'POSTPONED' }))), []);
  assert.deepEqual(keys(detect(undefined, game('pre'), { reminderMinutes: 0 })), []);
});

test('start, points of both sides, end', () => {
  assert.deepEqual(keys(detect(game('pre'), game('in', 2, 0))), [TRIGGERS.MATCH_STARTED]);
  const points = detect(game('in', 2, 0), game('in', 7, 3));
  assert.deepEqual(keys(points), [TRIGGERS.TEAM_SCORED, TRIGGERS.OPPONENT_SCORED]);
  assert.deepEqual(
    points.events.map((e) => e.points),
    [5, 3],
  );
  assert.deepEqual(keys(detect(game('in', 80, 70), game('post', 80, 70))), [TRIGGERS.MATCH_ENDED]);
  // A basket cancelled: nothing.
  assert.deepEqual(keys(detect(game('in', 10, 8), game('in', 8, 8))), []);
  // Seen finished at once: not news.
  assert.deepEqual(keys(detect(game('pre'), game('post', 80, 70))), [TRIGGERS.MATCH_ENDED]);
});

test('another game in its place: started only if seen under way', () => {
  const other = (state) => ({ ...game(state, 4, 0), id: 'g2' });
  assert.deepEqual(keys(detect(game('post', 80, 70), other('in'))), [TRIGGERS.MATCH_STARTED]);
  assert.deepEqual(keys(detect(game('post', 80, 70), other('post'))), []);
  assert.deepEqual(keys(detect(null, other('in'))), [TRIGGERS.MATCH_STARTED]);
});

test('event data: flat, the declared keys only', () => {
  const data = eventData(
    { key: TRIGGERS.MATCH_ENDED, match: game('post', 81, 77) },
    'ext:test:team:elite.10001',
    'Betclic ELITE',
    'Terminé',
  );
  assert.deepEqual(data, {
    team: 'ext:test:team:elite.10001',
    team_name: 'Monaco',
    opponent: 'ASVEL',
    home_away: 'home',
    competition: 'Betclic ELITE',
    team_score: 81,
    opponent_score: 77,
    summary: 'Terminé',
    result: 'win',
  });
});
