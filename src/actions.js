// -----------------------------------------------------------------------------
// Buttons of the Configuration screen (manifest `actions`).
//
//   - test_teams  read the FFBB now and say, team by team, what is followed
//                 and why an entry is not;
//   - find_team   list the teams of a competition with the exact text to
//                 paste ("ELITE:AS Monaco"), filtered by a search word.
//
// The resolved message (multi-language object) is shown under the button.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { formatStatus, multilingual } from './format.js';
import { COMPETITIONS, parseCompetition } from './competitions.js';
import { normalize } from './ffbb/parse.js';

const logger = createLogger({ name: 'actions' });

// A message under a button stays readable up to a few dozen lines.
const MAX_FOUND = 40;

const REASONS = {
  format: {
    en: 'write it COMPETITION:TEAM, e.g. ELITE:Monaco',
    fr: 'écrivez-la COMPÉTITION:ÉQUIPE, par ex. ELITE:Monaco',
  },
  competition: {
    en: 'unknown competition code (see the documentation)',
    fr: 'code de compétition inconnu (voir la documentation)',
  },
  competition_not_found: {
    en: 'competition not found at the FFBB this season, "Find a team" lists the FFBB codes',
    fr: 'compétition introuvable à la FFBB cette saison, « Trouver une équipe » liste les codes FFBB',
  },
  duplicate: {
    en: 'written twice',
    fr: 'écrite deux fois',
  },
  limit: {
    en: 'too many teams (20 at most)',
    fr: "trop d'équipes (20 au plus)",
  },
  not_found: {
    en: 'no such team in this competition, use "Find a team"',
    fr: 'équipe absente de cette compétition, utilisez « Trouver une équipe »',
  },
  unreachable: {
    en: 'the FFBB did not answer, try again later',
    fr: "la FFBB n'a pas répondu, réessayez plus tard",
  },
};

// "Paris: several teams match, write ELITE:Paris Basketball or … instead".
const AMBIGUOUS = {
  en: (entry, choices) => `${entry}: several teams match, write ${choices.join(' or ')} instead`,
  fr: (entry, choices) =>
    `${entry} : plusieurs équipes correspondent, écrivez plutôt ${choices.join(' ou ')}`,
};

const FOUND = {
  en: (count, name) => `${count} team(s) in ${name}, to copy into the Teams field:`,
  fr: (count, name) => `${count} équipe(s) en ${name}, à copier dans le champ Équipes :`,
};

const MORE = {
  en: (more) => `… and ${more} more, narrow the search.`,
  fr: (more) => `… et ${more} autres, affinez la recherche.`,
};

// The competition is missing: show what the FFBB has, with the codes to write.
const NOT_FOUND = {
  en: (name, count) =>
    count > 0
      ? `${name} not found at the FFBB this season. Competitions found, write CODE:TEAM with their code:`
      : `${name} not found at the FFBB this season, and no competition with a close name.`,
  fr: (name, count) =>
    count > 0
      ? `${name} introuvable à la FFBB cette saison. Compétitions trouvées, écrivez CODE:ÉQUIPE avec leur code :`
      : `${name} introuvable à la FFBB cette saison, ni aucune compétition au nom proche.`,
};

function notFound(competition, suggestions) {
  const lines = suggestions.map((c) => `${c.code || '?'} — ${c.name}`);
  return multilingual((language) =>
    [NOT_FOUND[language](competition.name, lines.length), ...lines].join('\n'),
  );
}

/** What to write to follow `team`: its name, or its id when the name cannot be written. */
function entryFor(code, team) {
  return /[,;:\n]/.test(team.name) ? `${code}:${team.id}` : `${code}:${team.name}`;
}

function describeTeam(tracked, config, language, now) {
  const { spec } = tracked;
  if (!tracked.info) {
    if (tracked.resolveError === 'ambiguous') {
      const choices = tracked.candidates.map((c) => entryFor(spec.code, c));
      return AMBIGUOUS[language](spec.entry, choices);
    }
    const reason = REASONS[tracked.resolveError ?? 'unreachable'][language];
    return `${spec.entry}: ${reason}`;
  }
  const status =
    tracked.reachable === false
      ? REASONS.unreachable[language]
      : formatStatus(tracked.match ?? null, { ...config, language }, now);
  return `${tracked.info.name} (${spec.competitionName}): ${status}`;
}

/** Handler of `test_teams`. */
export async function testTeams(tracker) {
  logger.info('Action test_teams -> reading the FFBB now');
  await tracker.refresh();
  const teams = tracker.list();
  if (teams.length === 0 && tracker.parseErrors.length === 0) {
    return {
      en: 'No team to follow yet: write one in the Teams field, e.g. ELITE:Monaco, NM1:Saint-Quentin.',
      fr: 'Aucune équipe à suivre : écrivez-en une dans le champ Équipes, par ex. ELITE:Monaco, NM1:Saint-Quentin.',
    };
  }
  const now = tracker.now();
  const build = (language) =>
    [
      ...teams.map((t) => describeTeam(t, tracker.config, language, now)),
      ...tracker.parseErrors.map((err) => `${err.entry}: ${REASONS[err.reason][language]}`),
    ].join('\n');
  return multilingual(build);
}

/** Handler of `find_team`. */
export async function findTeams(tracker, fields) {
  const competition = parseCompetition(fields.competition);
  if (!competition) {
    const codes = Object.keys(COMPETITIONS).join(', ');
    return {
      en: `Unknown competition "${fields.competition}". Known codes: ${codes}.`,
      fr: `Compétition « ${fields.competition} » inconnue. Codes connus : ${codes}.`,
    };
  }
  logger.info(`Action find_team <- ${competition.code} "${fields.search ?? ''}"`);
  const found = await tracker.competition(
    { ...competition, competitionName: competition.name },
    tracker.now(),
  );
  if (!found) {
    return { ...REASONS.unreachable };
  }
  if (!found.found) {
    return notFound(competition, found.suggestions ?? []);
  }
  const search = normalize(fields.search);
  const teams = found.teams.filter(
    (team) =>
      !search ||
      [team.name, team.officialName, team.abbreviation, team.id].some((value) =>
        normalize(value).includes(search),
      ),
  );
  if (teams.length === 0) {
    return {
      en: `No team of ${competition.name} matches "${fields.search}".`,
      fr: `Aucune équipe de ${competition.name} ne correspond à « ${fields.search} ».`,
    };
  }
  const lines = teams.slice(0, MAX_FOUND).map((team) => entryFor(competition.code, team));
  const more = teams.length - lines.length;
  return multilingual((language) =>
    [
      FOUND[language](teams.length, competition.name),
      ...lines,
      ...(more > 0 ? [MORE[language](more)] : []),
    ].join('\n'),
  );
}
