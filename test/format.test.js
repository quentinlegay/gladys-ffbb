import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatClock, formatKickoff, formatStatus, multilingual } from '../src/format.js';

const base = {
  id: '1',
  kickoff: '2026-11-01T19:00:00.000Z',
  timeKnown: true,
  homeAway: 'home',
  team: { abbreviation: 'MON', name: 'Monaco', score: 0 },
  opponent: { abbreviation: '', name: 'Paris Levallois', score: 0 },
  period: '',
  clock: '',
  statusName: '',
  completed: false,
  result: null,
};
const fr = { language: 'fr', timezone: 'Europe/Paris' };
const en = { language: 'en', timezone: 'Europe/Paris' };
const before = Date.parse('2026-10-30T10:00Z');

test('the next game, with or without its time', () => {
  const next = { ...base, state: 'pre' };
  assert.equal(
    formatStatus(next, fr, before),
    'Prochain match · dim. 1 nov., 20:00 · contre Paris Levallois',
  );
  assert.equal(formatStatus(next, en, before), 'Next · Sun 1 Nov, 20:00 · vs Paris Levallois');
  assert.equal(
    formatKickoff({ ...next, timeKnown: false }, 'fr', 'Europe/Paris'),
    'dim. 1 nov. (horaire à fixer)',
  );
  assert.equal(formatKickoff({ kickoff: '' }, 'fr', 'Europe/Paris'), '');
});

test('a live game shows the period and clock, halftime and overtime translated', () => {
  const live = { ...base, state: 'in', period: 'Q3', clock: '05:12' };
  live.team = { ...base.team, score: 56 };
  live.opponent = { ...base.opponent, score: 50 };
  assert.equal(
    formatStatus(live, fr, before),
    'En direct · Q3 05:12 · MON 56 – 50 Paris Levallois',
  );
  assert.equal(formatClock({ ...live, period: 'HT', clock: '' }, 'fr'), 'Mi-temps');
  assert.equal(formatClock({ ...live, period: 'OT1', clock: '01:30' }, 'en'), 'OT1 01:30');
  assert.equal(formatClock({ ...live, period: 'OT1', clock: '01:30' }, 'fr'), 'Prol. 1 01:30');
});

test('final, canceled, postponed, awaiting the result, no game', () => {
  const final = {
    ...base,
    state: 'post',
    completed: true,
    result: 'win',
    team: { ...base.team, score: 81 },
    opponent: { ...base.opponent, score: 77 },
  };
  assert.equal(formatStatus(final, fr, before), 'Terminé · MON 81 – 77 Paris Levallois · Victoire');
  assert.equal(
    formatStatus({ ...base, state: 'post' }, en, before),
    'Canceled · MON vs Paris Levallois',
  );
  assert.equal(
    formatStatus({ ...base, state: 'pre', statusName: 'POSTPONED', homeAway: 'away' }, fr, before),
    'Reporté · MON à Paris Levallois',
  );
  const after = Date.parse('2026-11-01T21:30Z');
  assert.equal(
    formatStatus({ ...base, state: 'pre' }, fr, after),
    'Résultat en attente · MON contre Paris Levallois',
  );
  assert.equal(formatStatus(null, en), 'No game scheduled');
});

test('multilingual builds every language', () => {
  assert.deepEqual(
    multilingual((language) => language.toUpperCase()),
    { en: 'EN', fr: 'FR' },
  );
});
