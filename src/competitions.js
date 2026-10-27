// -----------------------------------------------------------------------------
// French basketball competitions the integration knows by a short code.
//
// Senior national competitions are run in the FFBB information system, and
// the public API behind the official FFBB app serves their fixtures and live
// scores. A competition of the current season is found:
//   1. by its FFBB `code`, among `ffbbCodes` (the codes it has been seen
//      under: Pro A became Betclic ELITE, Pro B became ELITE 2);
//   2. else by its name: the API is searched for each of `searchTerms`, and
//      the competitions whose normalized name (lowercase, no accents) passes
//      `pattern` are kept. The FFBB does not document its codes; the names are
//      what its app shows.
//
// Any other competition can still be followed by writing its FFBB code
// instead of one of ours (`PNM:…`), see parseCompetition(). When ours fails,
// the "Find a team" button lists the FFBB competitions found and their codes.
//
// The codes are stored in the users' configuration: never rename one.
// -----------------------------------------------------------------------------

/** A men's or women's "Nationale N": "NATIONALE MASCULINE 1", "NM1", "NATIONALE 1". */
function nationale(sex, level) {
  const gender = sex === 'M' ? 'masculine' : 'feminine';
  const short = `n${sex.toLowerCase()}${level}`;
  const plain = sex === 'M' ? `^nationale ${level}$` : `\\bnationale ${level} ${gender}\\b`;
  return {
    searchTerms: ['nationale', short],
    pattern: new RegExp(`\\bnationale ${gender} ${level}\\b|\\b${short}\\b|${plain}`),
  };
}

export const COMPETITIONS = {
  // Men — professional (LNB).
  ELITE: {
    ffbbCodes: ['ELITE', 'PROA'],
    name: 'Betclic ELITE',
    searchTerms: ['elite', 'pro a'],
    pattern: /\bbetclic\b|^(lnb )?(jeep )?elite( masculine)?$|\bpro a\b/,
  },
  ELITE2: {
    ffbbCodes: ['ELIT2', 'ELITE2', 'PROB'],
    name: 'ELITE 2',
    searchTerms: ['elite', 'pro b'],
    pattern: /\belite 2\b|\bpro b\b/,
  },
  // Men — national (FFBB).
  NM1: { ffbbCodes: ['NM1'], name: 'Nationale 1', ...nationale('M', 1) },
  NM2: { ffbbCodes: ['NM2'], name: 'Nationale 2', ...nationale('M', 2) },
  NM3: { ffbbCodes: ['NM3'], name: 'Nationale 3', ...nationale('M', 3) },
  // Women.
  LFB: {
    ffbbCodes: ['LFB', 'LF1'],
    name: 'La Boulangère Wonderligue',
    searchTerms: ['ligue', 'lfb', 'wonderligue'],
    pattern: /\bwonderligue\b|\bboulangere\b|^(lfb|ligue feminine( de basket( ?ball)?)?)$/,
  },
  LF2: {
    ffbbCodes: ['LF2'],
    name: 'Ligue Féminine 2',
    searchTerms: ['ligue', 'lf2'],
    pattern: /\blf2\b|\bligue feminine 2\b/,
  },
  NF1: { ffbbCodes: ['NF1'], name: 'Nationale 1 Féminine', ...nationale('F', 1) },
  NF2: { ffbbCodes: ['NF2'], name: 'Nationale 2 Féminine', ...nationale('F', 2) },
  NF3: { ffbbCodes: ['NF3'], name: 'Nationale 3 Féminine', ...nationale('F', 3) },
};

// Youth and reserve competitions share words with the senior ones.
const NOT_SENIOR = /\b(u ?\d{2}|espoirs?|jeunes?|cadet(te)?s?|juniors?|minimes?|benjamin(e)?s?)\b/;

// What users write instead of our codes: the former names of the leagues.
const ALIASES = {
  PROA: 'ELITE',
  BETCLIC: 'ELITE',
  BETCLICELITE: 'ELITE',
  JEEP: 'ELITE',
  PROB: 'ELITE2',
  ELIT2: 'ELITE2',
  N1: 'NM1',
  N2: 'NM2',
  N3: 'NM3',
  LF1: 'LFB',
};

// A free-form FFBB code: letters, digits and inner spaces ("NMU15 ELITE").
const FFBB_CODE = /^[A-Z0-9][A-Z0-9 ]{0,19}$/;

/** Lowercase, no accents, words separated by single spaces. */
export function normalizeName(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Resolve a competition as written by the user: one of our codes or aliases
 * (any case, spaces and dashes ignored), or a raw FFBB code.
 * @param {string} text
 * @returns {{ code: string, ffbbCodes: string[], name: string,
 *   searchTerms: string[], pattern: RegExp | null } | null}
 */
export function parseCompetition(text) {
  const written = String(text ?? '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
  const compact = written.replace(/[\s_-]/g, '');
  const code = COMPETITIONS[compact] ? compact : ALIASES[compact];
  if (code) {
    return { code, ...COMPETITIONS[code] };
  }
  if (FFBB_CODE.test(written)) {
    const known = Object.entries(COMPETITIONS).find(([, entry]) =>
      entry.ffbbCodes.includes(written),
    );
    if (known) {
      return { code: known[0], ...known[1] };
    }
    return { code: written, ffbbCodes: [written], name: written, searchTerms: [], pattern: null };
  }
  return null;
}

/** Is this FFBB competition name a senior one (no youth, no reserve)? */
export function isSeniorName(ffbbName) {
  return !NOT_SENIOR.test(normalizeName(ffbbName));
}

/** Is this FFBB competition (by its name) the senior competition `competition`? */
export function matchesName(competition, ffbbName) {
  return Boolean(competition.pattern?.test(normalizeName(ffbbName))) && isSeniorName(ffbbName);
}

/** Stable identifier of a competition, used in the device external ids. */
export function competitionKey({ code }) {
  return code.toLowerCase().replace(/\s+/g, '-');
}
