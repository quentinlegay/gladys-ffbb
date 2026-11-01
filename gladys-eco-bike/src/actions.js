// -----------------------------------------------------------------------------
// Buttons of the Configuration screen (manifest `actions`).
//
// - test_connection: read Strava and the fuel price now, and say what is
//   counted, with the vehicle and the station the trips are valued with.
// - resync: read the whole Strava history again (an activity edited more
//   than 7 days after it was recorded is only seen this way).
// -----------------------------------------------------------------------------

import { formatPrice, formatStation, formatTotals, formatVehicle } from './format.js';
import { STATUS } from './tracker.js';

const NOT_CONNECTED = {
  en: 'Strava is not connected yet: fill in the client ID and secret, save, then click Connect.',
  fr: "Strava n'est pas encore connecté : renseignez l'ID client et le secret, enregistrez, puis cliquez sur Connecter.",
};

const STATUS_TEXT = {
  [STATUS.UNAUTHORIZED]: {
    en: 'Strava refused the authorization: click Connect again.',
    fr: "Strava a refusé l'autorisation : cliquez à nouveau sur Connecter.",
  },
  [STATUS.UNREACHABLE]: {
    en: 'Strava cannot be reached right now: the totals below are the last ones read.',
    fr: 'Strava est injoignable pour le moment : les totaux ci-dessous sont les derniers lus.',
  },
  [STATUS.RATE_LIMITED]: {
    en: 'Strava rate limit reached: try again in 15 minutes.',
    fr: 'Limite de requêtes Strava atteinte : réessayez dans 15 minutes.',
  },
};

function report(tracker, language) {
  const { reading, config } = tracker;
  const fr = language === 'fr';
  // French puts a space before the colon.
  const line = (label, value) => `${label}${fr ? ' : ' : ': '}${value}`;
  const lines = [];
  const status = STATUS_TEXT[tracker.status];
  if (status) {
    lines.push(status[language]);
  }
  if (reading.athleteName) {
    lines.push(line(fr ? 'Compte Strava' : 'Strava account', reading.athleteName));
  }
  lines.push(
    line(fr ? 'Depuis le début' : 'Since the start', formatTotals(reading.summary.total, language)),
    line(fr ? 'Cette année' : 'This year', formatTotals(reading.summary.year, language)),
    line(fr ? 'Véhicule comparé' : 'Compared vehicle', formatVehicle(config, reading.co2PerKm)),
    line(fr ? 'Carburant' : 'Fuel', formatStation(reading.fuel, config)),
  );
  if (tracker.auth.redirectHost) {
    lines.push(
      line(fr ? 'Domaine de rappel Strava' : 'Strava callback domain', tracker.auth.redirectHost),
    );
  }
  return lines.join('\n');
}

export async function testConnection(tracker) {
  const language = tracker.config.language;
  if (!tracker.auth.connected) {
    return NOT_CONNECTED;
  }
  await tracker.refresh();
  const text = report(tracker, language);
  return { en: text, fr: text };
}

export async function resync(tracker) {
  const language = tracker.config.language;
  if (!tracker.auth.connected) {
    return NOT_CONNECTED;
  }
  // Let a reading in progress finish, then read everything.
  await tracker.inFlight;
  await tracker.refresh({ full: true });
  const count = Object.keys(tracker.state.activities).length;
  const trips = tracker.reading.summary.total.trips;
  const text =
    language === 'fr'
      ? `Historique relu : ${count} activités, ${trips} trajets comptés. Prix : ${formatPrice(tracker.reading.fuel.price, tracker.config)}.`
      : `History read again: ${count} activities, ${trips} trips counted. Price: ${formatPrice(tracker.reading.fuel.price, tracker.config)}.`;
  return { en: text, fr: text };
}
