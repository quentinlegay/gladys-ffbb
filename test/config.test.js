import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, MAX_TEAMS, normalizeConfig, parseTeams } from '../src/config.js';
import { isSeniorName, matchesName, parseCompetition } from '../src/competitions.js';

test('normalizeConfig fills the defaults and clamps the numbers', () => {
  assert.deepEqual(normalizeConfig(), DEFAULT_CONFIG);
  const config = normalizeConfig({
    language: 'de',
    timezone: 'Mars/Olympus',
    live_refresh: '5',
    idle_refresh: '999',
    reminder_minutes: 'soon',
  });
  assert.equal(config.language, 'fr');
  assert.equal(config.timezone, 'Europe/Paris');
  assert.equal(config.live_refresh, 15);
  assert.equal(config.idle_refresh, 120);
  assert.equal(config.reminder_minutes, 30);
  assert.equal(normalizeConfig({ timezone: 'America/Guadeloupe' }).timezone, 'America/Guadeloupe');
});

test('competition codes, aliases and raw FFBB codes', () => {
  assert.equal(parseCompetition('elite').code, 'ELITE');
  assert.equal(parseCompetition('Pro A').code, 'ELITE');
  assert.equal(parseCompetition('pro-b').code, 'ELITE2');
  assert.equal(parseCompetition('ELIT2').code, 'ELITE2');
  assert.equal(parseCompetition('n1').code, 'NM1');
  assert.deepEqual(parseCompetition('PNM'), {
    code: 'PNM',
    ffbbCodes: ['PNM'],
    name: 'PNM',
    searchTerms: [],
    pattern: null,
  });
  assert.equal(parseCompetition('nmu15  elite').code, 'NMU15 ELITE');
  assert.equal(parseCompetition('a/b'), null);
  assert.equal(parseCompetition(''), null);
});

test('the senior competitions are recognized by their FFBB names', () => {
  const is = (code, name) => matchesName(parseCompetition(code), name);
  assert.ok(is('ELITE', 'BETCLIC ELITE'));
  assert.ok(is('ELITE', 'Betclic ÉLITE'));
  assert.ok(is('ELITE', 'ELITE'));
  assert.ok(!is('ELITE', 'ELITE 2'));
  assert.ok(!is('ELITE', 'ESPOIRS BETCLIC ELITE'));
  // The friendlies the FFBB publishes for the LNB championships.
  assert.ok(!is('ELITE', 'AMICALE BETCLIC ELITE'));
  assert.ok(!is('ELITE', 'RENCONTRE AMICALE BETCLIC ELITE'));
  assert.ok(!is('ELITE', 'M. AMICAUX SM - BETCLIC Elite - ELITE 2 - NM1'));
  assert.ok(!is('ELITE', 'AMICAL BETCLIC ELITE'));
  assert.ok(!is('ELITE2', 'AMICALES ELITE 2'));
  assert.ok(!is('LFB', 'AMICALES LA BOULANGERE WONDERLIGUE'));
  assert.ok(is('LFB', 'La Boulangère Wonderligue'));
  assert.equal(parseCompetition('LBWL').code, 'LFB');
  assert.ok(is('ELITE2', 'ÉLITE 2'));
  assert.ok(is('ELITE2', 'PRO B'));
  assert.ok(is('NM1', 'NATIONALE MASCULINE 1'));
  assert.ok(is('NM1', 'Championnat de France NM1'));
  assert.ok(!is('NM1', 'NATIONALE MASCULINE U15'));
  // "U13F", "U18M": the sex glued to the age.
  assert.ok(!isSeniorName('Playoff Elite U13F'));
  assert.ok(!isSeniorName('U18M ELITE BRASSAGES 2'));
  assert.ok(!isSeniorName('U15 ELITE'));
  assert.ok(isSeniorName('ELITE NATIONALE'));
  assert.ok(!is('NM1', 'NATIONALE FEMININE 1'));
  assert.ok(is('NF1', 'NATIONALE FEMININE 1'));
  assert.ok(is('NF2', 'Nationale 2 Féminine'));
  assert.ok(is('LFB', 'LA BOULANGERE WONDERLIGUE'));
  assert.ok(is('LFB', 'LIGUE FEMININE DE BASKET'));
  assert.ok(!is('LFB', 'LIGUE FEMININE 2'));
  assert.ok(is('LF2', 'LIGUE FEMININE 2'));
  assert.ok(!matchesName(parseCompetition('PNM'), 'PRE NATIONALE MASCULINE'));
});

test('parseTeams reads COMPETITION:TEAM entries and reports the bad ones', () => {
  const { teams, errors } = parseTeams(
    'ELITE:Monaco, pro b : Nancy;NM1:Saint-Quentin\nELITE:monaco, Monaco, ??:X, ELITE:',
  );
  assert.deepEqual(
    teams.map((t) => [t.code, t.team, t.competitionName]),
    [
      ['ELITE', 'Monaco', 'Betclic ELITE'],
      ['ELITE2', 'Nancy', 'ELITE 2'],
      ['NM1', 'Saint-Quentin', 'Nationale 1'],
    ],
  );
  assert.deepEqual(
    errors.map((e) => [e.entry, e.reason]),
    [
      ['ELITE:monaco', 'duplicate'],
      ['Monaco', 'format'],
      ['??:X', 'competition'],
      ['ELITE:', 'format'],
    ],
  );
});

test(`parseTeams follows ${MAX_TEAMS} teams at most`, () => {
  const text = Array.from({ length: MAX_TEAMS + 2 }, (_, i) => `NM1:Team ${i}`).join(',');
  const { teams, errors } = parseTeams(text);
  assert.equal(teams.length, MAX_TEAMS);
  assert.deepEqual(
    errors.map((e) => e.reason),
    ['limit', 'limit'],
  );
});
