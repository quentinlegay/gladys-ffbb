import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findTeams, testTeams } from '../src/actions.js';
import { normalizeConfig } from '../src/config.js';
import { Tracker } from '../src/tracker.js';
import { createFakeFfbb } from './helpers/fakeFfbb.js';
import { createFakeGladys } from './helpers/fakeGladys.js';

function setup(teams) {
  const ffbb = createFakeFfbb();
  const tracker = new Tracker({
    gladys: createFakeGladys(),
    client: ffbb,
    now: () => Date.parse('2026-10-28T10:00Z'),
    setTimer: () => 0,
    clearTimer: () => {},
  });
  tracker.configure(normalizeConfig({ teams }));
  return { tracker, ffbb };
}

test('test_teams says, team by team, what is followed and why not', async () => {
  const { tracker } = setup('ELITE:Monaco, ELITE:Paris, ELITE:Cholet, Oops');
  const message = await testTeams(tracker);
  assert.deepEqual(message.fr.split('\n'), [
    'Monaco (Betclic ELITE): Prochain match · dim. 1 nov., 20:00 · contre PLB',
    'ELITE:Paris : plusieurs équipes correspondent, écrivez plutôt ELITE:Paris Basketball ou ELITE:Paris Levallois',
    'ELITE:Cholet: équipe absente de cette compétition, utilisez « Trouver une équipe »',
    'Oops: écrivez-la COMPÉTITION:ÉQUIPE, par ex. ELITE:Monaco',
  ]);
  assert.ok(message.en.startsWith('Monaco (Betclic ELITE): Next'));
});

test('test_teams with nothing configured explains what to write', async () => {
  const { tracker } = setup('');
  const message = await testTeams(tracker);
  assert.match(message.en, /ELITE:Monaco/);
});

test('find_team lists the teams of a competition with the text to paste', async () => {
  const { tracker } = setup('');
  const all = await findTeams(tracker, { competition: 'ELITE' });
  assert.deepEqual(all.fr.split('\n'), [
    '4 équipe(s) en Betclic ELITE, à copier dans le champ Équipes :',
    'ELITE:ASVEL',
    'ELITE:Monaco',
    'ELITE:Paris Basketball',
    'ELITE:Paris Levallois',
  ]);
  const paris = await findTeams(tracker, { competition: 'ELITE', search: 'parís' });
  assert.equal(paris.en.split('\n').length, 3);
  const none = await findTeams(tracker, { competition: 'ELITE', search: 'Cholet' });
  assert.match(none.fr, /Aucune équipe/);
});

test('find_team lists the FFBB competitions and their codes when ours is missing', async () => {
  const { tracker, ffbb } = setup('');
  const saison = { actif: true, debut: '2026-07-01' };
  ffbb.otherCompetitions = [
    { id: 1, nom: 'CHAMPIONNAT NATIONALE MASCULINE U18', code: 'NMU18', saison },
    { id: 2, nom: 'COUPE DE FRANCE NATIONALE', code: 'CDFN', saison },
  ];
  const message = await findTeams(tracker, { competition: 'NM1' });
  assert.deepEqual(message.fr.split('\n'), [
    'Nationale 1 introuvable à la FFBB cette saison. Compétitions trouvées, écrivez CODE:ÉQUIPE avec leur code :',
    'CDFN — COUPE DE FRANCE NATIONALE',
  ]);
});

test('find_team: unknown code, competition absent, FFBB down', async () => {
  const { tracker, ffbb } = setup('');
  assert.match((await findTeams(tracker, { competition: '??' })).en, /Unknown competition/);
  assert.match((await findTeams(tracker, { competition: 'NM1' })).fr, /introuvable à la FFBB/);
  ffbb.down = true;
  assert.match((await findTeams(tracker, { competition: 'LFB' })).fr, /n'a pas répondu/);
});

test('test_teams lists the games to come, or says what was read when there is none', async () => {
  const { tracker, ffbb } = setup('ELITE:ASVEL');
  ffbb.game('200000002901004').date_rencontre = 'prochainement';
  const message = await testTeams(tracker);
  assert.deepEqual(message.fr.split('\n'), [
    'ASVEL (Betclic ELITE): Terminé · ASV 72 – 85 MON · Défaite',
    '  aucun match à venir parmi les 2 match(s) lus, dont 1 à la date illisible (ex. « prochainement »)',
  ]);
});

test('find_team on an LNB championship the FFBB does not publish', async () => {
  const { tracker, ffbb } = setup('');
  ffbb.competitionsByCode = {};
  const message = await findTeams(tracker, { competition: 'ELITE2' });
  assert.equal(
    message.fr,
    "ELITE 2: ce championnat est géré par la LNB, la FFBB n'en publie que les matchs amicaux",
  );
});
