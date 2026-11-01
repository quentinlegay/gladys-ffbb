// -----------------------------------------------------------------------------
// Texts shown to the user (device text features, action results, scenes,
// widgets), in English and French.
// -----------------------------------------------------------------------------

import { FUELS, vehicleName } from './vehicle.js';

const LOCALES = { en: 'en-GB', fr: 'fr-FR' };

export function locale(language) {
  return LOCALES[language] ?? LOCALES.en;
}

export function formatNumber(value, language, digits = 1) {
  return new Intl.NumberFormat(locale(language), {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(value);
}

export function formatMoney(value, language) {
  return new Intl.NumberFormat(locale(language), {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatCo2(kg, language) {
  return kg < 1
    ? `${formatNumber(kg * 1000, language, 0)} g CO₂`
    : `${formatNumber(kg, language, 1)} kg CO₂`;
}

export function formatKm(km, language) {
  return `${formatNumber(km, language, 1)} km`;
}

export function formatDay(day, language) {
  return new Intl.DateTimeFormat(locale(language), {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${day}T12:00:00Z`));
}

export function formatPrice(price, config) {
  const unit = FUELS[config.fuel_type].unit;
  return `${formatNumber(price, config.language, 3)} €/${unit}`;
}

/** "Mon 3 Nov · 7.2 km · 1.4 kg CO₂ · 1.05 € saved" */
export function formatTrip(trip, language) {
  if (!trip) {
    return language === 'fr' ? 'Aucun trajet pour le moment' : 'No trip yet';
  }
  const saved = language === 'fr' ? 'économisés' : 'saved';
  return [
    formatDay(trip.day, language),
    formatKm(trip.km, language),
    formatCo2(trip.co2Kg, language),
    `${formatMoney(trip.money, language)} ${saved}`,
  ].join(' · ');
}

/** One line for a period: "42 trips · 312 km · 61.8 kg CO₂ · 47.10 €" */
export function formatTotals(totals, language) {
  const trips =
    language === 'fr'
      ? `${totals.trips} trajet${totals.trips > 1 ? 's' : ''}`
      : `${totals.trips} trip${totals.trips === 1 ? '' : 's'}`;
  return [
    trips,
    formatKm(totals.km, language),
    formatCo2(totals.co2Kg, language),
    formatMoney(totals.money, language),
  ].join(' · ');
}

export const PERIOD_LABELS = {
  total: { en: 'Since the start', fr: 'Depuis le début' },
  year: { en: 'This year', fr: 'Cette année' },
  month: { en: 'This month', fr: 'Ce mois-ci' },
  week: { en: 'This week', fr: 'Cette semaine' },
};

/**
 * Where the fuel price comes from, for the Station text feature.
 * @param {{ station: object | null, price: number, source: string }} fuel
 */
export function formatStation(fuel, config) {
  const { language } = config;
  const fuelLabel = FUELS[config.fuel_type].label[language] ?? FUELS[config.fuel_type].label.en;
  const price = formatPrice(fuel.price, config);
  if (fuel.source === 'station' && fuel.station) {
    const away = `${formatNumber(fuel.station.distanceKm, language, 1)} km`;
    const from = language === 'fr' ? 'de chez vous' : 'from home';
    return `${fuelLabel} ${price} · ${fuel.station.address} (${away} ${from})`;
  }
  if (fuel.source === 'config') {
    return `${fuelLabel} ${price} · ${language === 'fr' ? 'prix saisi' : 'price from the configuration'}`;
  }
  return `${fuelLabel} ${price} · ${language === 'fr' ? 'prix moyen estimé (aucune station lue)' : 'estimated average price (no station read)'}`;
}

/** "Car (Diesel, 6.5 L/100 km, 168 g CO₂/km)" */
export function formatVehicle(config, co2PerKmKg) {
  const fuel = FUELS[config.fuel_type];
  const fuelLabel = fuel.label[config.language] ?? fuel.label.en;
  const consumption = `${formatNumber(config.consumption, config.language, 1)} ${fuel.unit}/100 km`;
  const co2 = `${formatNumber(co2PerKmKg * 1000, config.language, 0)} g CO₂/km`;
  return `${vehicleName(config)} (${fuelLabel}, ${consumption}, ${co2})`;
}
