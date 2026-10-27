// -----------------------------------------------------------------------------
// French basketball competitions the integration knows by a short code.
//
// Every senior national competition is run in the FFBB information system,
// professional leagues included (the LNB's Betclic ELITE and ELITE 2, the
// LFB): the public API behind the official FFBB app serves their fixtures and
// live scores. A competition is found by its FFBB `code` for the current
// season; `ffbbCodes` lists the codes it has been seen under (Pro A became
// Betclic ELITE, Pro B became ELITE 2).
//
// Any other competition can still be followed by writing its FFBB code
// instead of one of ours (`PNM:…`), see parseCompetition().
//
// The codes are stored in the users' configuration: never rename one.
// -----------------------------------------------------------------------------

export const COMPETITIONS = {
  // Men — professional (LNB).
  ELITE: { ffbbCodes: ['ELITE', 'PROA'], name: 'Betclic ELITE', sex: 'M' },
  ELITE2: { ffbbCodes: ['ELIT2', 'ELITE2', 'PROB'], name: 'ELITE 2', sex: 'M' },
  // Men — national (FFBB).
  NM1: { ffbbCodes: ['NM1'], name: 'Nationale 1', sex: 'M' },
  NM2: { ffbbCodes: ['NM2'], name: 'Nationale 2', sex: 'M' },
  NM3: { ffbbCodes: ['NM3'], name: 'Nationale 3', sex: 'M' },
  // Women.
  LFB: { ffbbCodes: ['LFB', 'LF1'], name: 'La Boulangère Wonderligue', sex: 'F' },
  LF2: { ffbbCodes: ['LF2'], name: 'Ligue Féminine 2', sex: 'F' },
  NF1: { ffbbCodes: ['NF1'], name: 'Nationale 1 Féminine', sex: 'F' },
  NF2: { ffbbCodes: ['NF2'], name: 'Nationale 2 Féminine', sex: 'F' },
  NF3: { ffbbCodes: ['NF3'], name: 'Nationale 3 Féminine', sex: 'F' },
};

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

// A free-form FFBB code: letters and digits only, it ends up in a URL.
const FFBB_CODE = /^[A-Z0-9]{2,12}$/;

/**
 * Resolve a competition as written by the user: one of our codes or aliases
 * (any case, spaces and dashes ignored), or a raw FFBB code.
 * @param {string} text
 * @returns {{ code: string, ffbbCodes: string[], name: string } | null}
 */
export function parseCompetition(text) {
  const raw = String(text ?? '')
    .toUpperCase()
    .replace(/[\s_-]/g, '');
  const code = COMPETITIONS[raw] ? raw : ALIASES[raw];
  if (code) {
    const { ffbbCodes, name } = COMPETITIONS[code];
    return { code, ffbbCodes, name };
  }
  if (FFBB_CODE.test(raw)) {
    const known = Object.entries(COMPETITIONS).find(([, entry]) => entry.ffbbCodes.includes(raw));
    if (known) {
      return { code: known[0], ffbbCodes: known[1].ffbbCodes, name: known[1].name };
    }
    return { code: raw, ffbbCodes: [raw], name: raw };
  }
  return null;
}

/** Stable identifier of a competition, used in the device external ids. */
export function competitionKey({ code }) {
  return code.toLowerCase();
}
