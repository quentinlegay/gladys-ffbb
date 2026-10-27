// -----------------------------------------------------------------------------
// Human texts about a game, in French or English.
//
// A device `text` feature holds ONE string, so the status published on the
// devices follows the `language` of the configuration. The widgets and the
// action messages are multi-language objects ({ en, fr }) the core picks from
// (English when the reader's language is neither).
// -----------------------------------------------------------------------------

/** Every language this integration writes, English first (the fallback). */
export const LANGUAGES = ['en', 'fr'];

const LOCALES = { en: 'en-GB', fr: 'fr-FR' };

const WORDS = {
  en: {
    live: 'Live',
    final: 'Final',
    next: 'Next',
    postponed: 'Postponed',
    canceled: 'Canceled',
    pending: 'Result pending',
    noMatch: 'No game scheduled',
    vs: 'vs',
    at: 'at',
    win: 'Win',
    loss: 'Loss',
    draw: 'Draw',
    halftime: 'Halftime',
    overtime: 'OT',
    timeTbd: 'time TBD',
  },
  fr: {
    live: 'En direct',
    final: 'Terminé',
    next: 'Prochain match',
    postponed: 'Reporté',
    canceled: 'Annulé',
    pending: 'Résultat en attente',
    noMatch: 'Aucun match prévu',
    vs: 'contre',
    at: 'à',
    win: 'Victoire',
    loss: 'Défaite',
    draw: 'Égalité',
    halftime: 'Mi-temps',
    overtime: 'Prol. ',
    timeTbd: 'horaire à fixer',
  },
};

export function words(language) {
  return WORDS[language] ?? WORDS.en;
}

/**
 * "Sat 18 Oct, 20:00" / "sam. 18 oct., 20:00", in the configured time zone;
 * the date alone when the FFBB has not set the time yet.
 */
export function formatKickoff(match, language, timezone) {
  const date = new Date(match?.kickoff);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const options = { weekday: 'short', day: 'numeric', month: 'short', timeZone: timezone };
  if (match.timeKnown === false) {
    const day = new Intl.DateTimeFormat(LOCALES[language] ?? LOCALES.en, options).format(date);
    return `${day} (${words(language).timeTbd})`;
  }
  return new Intl.DateTimeFormat(LOCALES[language] ?? LOCALES.en, {
    ...options,
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/** The short name of a side: its abbreviation, else its name. */
export function shortName(side) {
  return side.abbreviation || side.name;
}

/** "Monaco 85 – 72 ASVEL", always the followed team first. */
export function formatScore(match) {
  return `${shortName(match.team)} ${match.team.score} – ${match.opponent.score} ${shortName(match.opponent)}`;
}

/** "vs ASVEL" at home, "at ASVEL" away. */
export function formatOpponent(match, language) {
  const w = words(language);
  return `${match.homeAway === 'away' ? w.at : w.vs} ${shortName(match.opponent)}`;
}

/** "Q3 05:12", "Halftime", "OT1 01:30". */
export function formatClock(match, language) {
  const period = String(match.period ?? '').toUpperCase();
  if (/^(HT|HALF.?TIME|MI.?TEMPS)$/.test(period) || /HALF.?TIME/.test(match.statusName ?? '')) {
    return words(language).halftime;
  }
  const label = period.replace(/^OT/, words(language).overtime);
  return [label, match.clock].filter(Boolean).join(' ');
}

export function formatResult(result, language) {
  return result ? words(language)[result] : '';
}

/**
 * One line telling where the team stands: the status text feature of the
 * device, the summary of the scene events and of the `get_match` action.
 */
export function formatStatus(match, { language, timezone }, now = Date.now()) {
  const w = words(language);
  if (!match) {
    return w.noMatch;
  }
  if (match.state === 'in') {
    const clock = formatClock(match, language);
    return [w.live, clock, formatScore(match)].filter(Boolean).join(' · ');
  }
  if (match.state === 'post') {
    if (match.completed) {
      return `${w.final} · ${formatScore(match)} · ${formatResult(match.result, language)}`;
    }
    return `${w.canceled} · ${shortName(match.team)} ${formatOpponent(match, language)}`;
  }
  if (match.statusName === 'POSTPONED') {
    return `${w.postponed} · ${shortName(match.team)} ${formatOpponent(match, language)}`;
  }
  if (match.timeKnown && Date.parse(match.kickoff) < now) {
    // Tip-off passed, no live score: the FFBB enters the result after the game.
    return `${w.pending} · ${shortName(match.team)} ${formatOpponent(match, language)}`;
  }
  return `${w.next} · ${formatKickoff(match, language, timezone)} · ${formatOpponent(match, language)}`;
}

/** Every language at once, for the widgets and the action messages. */
export function multilingual(build) {
  return Object.fromEntries(LANGUAGES.map((language) => [language, build(language)]));
}
