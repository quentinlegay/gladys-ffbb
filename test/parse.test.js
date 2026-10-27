import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  currentCompetitions,
  findTeam,
  indexLives,
  matchFromRencontre,
  parseFfbbDate,
  parseHoraire,
  pickMatch,
  poulesOf,
  teamGameStats,
  teamsFromPoules,
  upcomingMatches,
} from '../src/ffbb/parse.js';
import { fixture } from './helpers/fakeFfbb.js';

const poule = fixture('elite-poule').data;
const games = poule.rencontres;
const MONACO = '10001';
const noLive = () => undefined;

test('a FFBB date without offset is French local time, summer and winter', () => {
  assert.deepEqual(parseFfbbDate('2026-10-18 20:00:00'), {
    iso: '2026-10-18T18:00:00.000Z',
    timeKnown: true,
  });
  // After the switch to winter time (last Sunday of October).
  assert.deepEqual(parseFfbbDate('2026-11-01T20:00:00'), {
    iso: '2026-11-01T19:00:00.000Z',
    timeKnown: true,
  });
  assert.equal(parseFfbbDate('2026-10-03T14:00:00+02:00').iso, '2026-10-03T12:00:00.000Z');
  assert.equal(parseFfbbDate('2026-09-27T14:00:00Z').iso, '2026-09-27T14:00:00.000Z');
});

test('midnight or a bare date means the time is not set yet', () => {
  assert.equal(parseFfbbDate('2026-09-20 00:00:00').timeKnown, false);
  assert.equal(parseFfbbDate('2026-09-20').timeKnown, false);
  assert.deepEqual(parseFfbbDate('not a date'), { iso: '', timeKnown: false });
  assert.deepEqual(parseFfbbDate(null), { iso: '', timeKnown: false });
});

test('the teams of a competition come from the games of its pools', () => {
  const teams = teamsFromPoules([poule]);
  assert.deepEqual(
    teams.map((t) => [t.id, t.name, t.abbreviation]),
    [
      ['10002', 'ASVEL', 'ASV'],
      ['10001', 'Monaco', 'MON'],
      ['10003', 'Paris Basketball', 'PAR'],
      ['10004', 'Paris Levallois', 'PLB'],
    ],
  );
  assert.deepEqual(teams[1].pouleIds, [String(poule.id)]);
  assert.deepEqual(teams[1].engagementIds, ['9001']);
});

test('a team is found by id, name, abbreviation or words, accents and case ignored', () => {
  const teams = teamsFromPoules([poule]);
  assert.equal(findTeam(teams, '10001').team.name, 'Monaco');
  assert.equal(findTeam(teams, '9001').team.name, 'Monaco');
  assert.equal(findTeam(teams, 'monaco').team.name, 'Monaco');
  assert.equal(findTeam(teams, 'AS Monaco Basket').team.name, 'Monaco');
  assert.equal(findTeam(teams, 'asv').team.name, 'ASVEL');
  assert.equal(findTeam(teams, 'Levallois').team.name, 'Paris Levallois');
  // The exact name wins over the other teams containing it.
  assert.equal(findTeam(teams, 'Paris Basketball').team.name, 'Paris Basketball');
  const paris = findTeam(teams, 'paris');
  assert.equal(paris.error, 'ambiguous');
  assert.equal(paris.candidates.length, 2);
  assert.deepEqual(findTeam(teams, 'Cholet'), { error: 'not_found', candidates: [] });
});

test('the current season is the active one, else the latest', () => {
  const { data } = fixture('elite-competitions');
  assert.deepEqual(
    currentCompetitions(data).map((c) => c.id),
    [200000002800001],
  );
  const inactive = data.map((c) => ({ ...c, saison: { ...c.saison, actif: false } }));
  assert.deepEqual(
    currentCompetitions(inactive).map((c) => c.id),
    [200000002800001],
  );
  assert.deepEqual(poulesOf(currentCompetitions(data)), ['200000003010001']);
});

test('a played game gives the final score and the result, from either side', () => {
  const home = matchFromRencontre(games[0], MONACO, undefined);
  assert.equal(home.state, 'post');
  assert.equal(home.completed, true);
  assert.equal(home.homeAway, 'home');
  assert.deepEqual([home.team.score, home.opponent.score, home.result], [85, 72, 'win']);
  assert.equal(home.opponent.name, 'ASVEL');
  assert.equal(home.venue, 'Salle Gaston Médecin, Monaco');
  assert.equal(home.round, 5);

  const away = matchFromRencontre(games[1], MONACO, undefined);
  assert.equal(away.homeAway, 'away');
  assert.deepEqual([away.team.score, away.opponent.score, away.result], [88, 90, 'loss']);
  assert.equal(matchFromRencontre(games[3], MONACO, undefined), null);
});

test('the live feed turns a scheduled game into a live one, with period and clock', () => {
  const live = {
    matchId: 2462003,
    matchStatus: 'IN_PROGRESS',
    currentStatus: 'LIVE',
    currentPeriod: 'Q3',
    clock: '05:12:000',
    score_home: 56,
    score_out: 50,
  };
  const match = matchFromRencontre(games[2], MONACO, live);
  assert.equal(match.state, 'in');
  assert.equal(match.period, 'Q3');
  assert.equal(match.clock, '05:12');
  assert.deepEqual([match.team.score, match.opponent.score], [56, 50]);
});

test('without score totals, the live score is the sum of the periods', () => {
  const live = {
    matchId: '2462003',
    matchStatus: 'QUARTER_2',
    score_q1_home: 22,
    score_q2_home: 10,
    score_q1_out: 18,
    score_q2_out: 12,
  };
  const match = matchFromRencontre(games[2], MONACO, live);
  assert.equal(match.state, 'in');
  assert.deepEqual([match.team.score, match.opponent.score], [32, 30]);
});

test('a scheduled live entry, a postponed or a finished one', () => {
  const scheduled = matchFromRencontre(games[2], MONACO, { matchStatus: 'SCHEDULED' });
  assert.equal(scheduled.state, 'pre');
  const postponed = matchFromRencontre(games[2], MONACO, { matchStatus: 'POSTPONED' });
  assert.deepEqual([postponed.state, postponed.statusName], ['pre', 'POSTPONED']);
  const finished = matchFromRencontre(games[2], MONACO, {
    matchStatus: 'COMPLETE',
    score_home: 70,
    score_out: 80,
  });
  assert.deepEqual([finished.state, finished.completed, finished.result], ['post', true, 'loss']);
});

test('the game shown: live first, then just played, then the next one', () => {
  // The day after the Paris game: it is still the one shown.
  const dayAfter = Date.parse('2026-10-26T08:00:00Z');
  assert.equal(pickMatch(games, MONACO, noLive, dayAfter).id, '200000002901002');
  // Two days later, the next game takes its place.
  const later = Date.parse('2026-10-28T08:00:00Z');
  const next = pickMatch(games, MONACO, noLive, later);
  assert.deepEqual([next.id, next.state, next.timeKnown], ['200000002901003', 'pre', true]);
  assert.equal(next.kickoff, '2026-11-01T19:00:00.000Z');

  const liveOf = indexLives([{ matchId: '2462003', matchStatus: 'LIVE', score_home: 3 }]);
  assert.equal(pickMatch(games, MONACO, liveOf, later).state, 'in');
  assert.equal(pickMatch([], MONACO, noLive, later), null);
});

test('the time kept apart in horaire completes a date at midnight', () => {
  assert.deepEqual(parseHoraire(2030), { hours: 20, minutes: 30 });
  assert.deepEqual(parseHoraire('20:30'), { hours: 20, minutes: 30 });
  assert.deepEqual(parseHoraire('20h30'), { hours: 20, minutes: 30 });
  assert.deepEqual(parseHoraire('930'), { hours: 9, minutes: 30 });
  assert.equal(parseHoraire(0), null);
  assert.equal(parseHoraire('2575'), null);
  assert.equal(parseHoraire(null), null);
  assert.deepEqual(parseFfbbDate('2026-11-08T00:00:00', 2000), {
    iso: '2026-11-08T19:00:00.000Z',
    timeKnown: true,
  });
  assert.deepEqual(parseFfbbDate('2026-11-08', '18:30'), {
    iso: '2026-11-08T17:30:00.000Z',
    timeKnown: true,
  });
  // A time in the date wins over horaire.
  assert.equal(parseFfbbDate('2026-11-08 20:00:00', 1800).iso, '2026-11-08T19:00:00.000Z');
});

test('a game without its club is still recognized by the team entry', () => {
  const team = teamsFromPoules([poule]).find((t) => t.id === MONACO);
  const orphan = { ...games[2], idOrganismeEquipe1: null };
  assert.equal(matchFromRencontre(orphan, MONACO), null, 'the bare club id is not enough');
  assert.equal(matchFromRencontre(orphan, team).homeAway, 'home');
});

test('the games to come, soonest first, and the reading stats', () => {
  const later = Date.parse('2026-10-28T08:00:00Z');
  const extra = {
    ...games[2],
    id: 'later',
    date_rencontre: '2026-11-08',
    horaire: 2000,
    gsId: null,
  };
  const all = [...games, extra];
  const upcoming = upcomingMatches(all, MONACO, noLive, later);
  assert.deepEqual(
    upcoming.map((m) => [m.id, m.kickoff]),
    [
      ['200000002901003', '2026-11-01T19:00:00.000Z'],
      ['later', '2026-11-08T19:00:00.000Z'],
    ],
  );
  assert.deepEqual(upcomingMatches(all, MONACO, noLive, later, 1).length, 1);
  // A postponed game is still to come, flagged.
  const postponed = upcomingMatches([{ ...extra, remise: true }], MONACO, noLive, later);
  assert.equal(postponed[0].statusName, 'POSTPONED');

  const undated = { ...extra, id: 'undated', date_rencontre: 'bientôt' };
  assert.deepEqual(teamGameStats([...all, undated], MONACO, later), {
    games: 5,
    upcoming: 2,
    undated: 1,
    sampleDate: 'bientôt',
  });
});
