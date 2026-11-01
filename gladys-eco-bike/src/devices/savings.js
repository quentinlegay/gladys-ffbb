// -----------------------------------------------------------------------------
// The two devices of the integration.
//
// "Eco Bike" (savings): what the counted trips saved, read-only sensors
//   - total, this year and this month for CO2 (kg), money (€) and distance
//     (km), the number of trips, and the last trip as text.
// "Fuel price" (fuel): the price the trips are valued at, and where it comes
//   from (station near home, configured price, or estimated average).
//
// Both have fixed external ids (`savings:me`, `fuel:home`): one Strava
// account per integration, and a device that survives a reconnection or a
// change of vehicle. Feature keys are stored by users: never rename them.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import { formatStation, formatTrip } from '../format.js';

export const FEATURE = {
  CO2_TOTAL: 'co2-total',
  MONEY_TOTAL: 'money-total',
  DISTANCE_TOTAL: 'distance-total',
  TRIPS_TOTAL: 'trips-total',
  CO2_YEAR: 'co2-year',
  MONEY_YEAR: 'money-year',
  DISTANCE_YEAR: 'distance-year',
  CO2_MONTH: 'co2-month',
  MONEY_MONTH: 'money-month',
  DISTANCE_MONTH: 'distance-month',
  LAST_TRIP: 'last-trip',
  FUEL_PRICE: 'price',
  STATION: 'station',
};

const NAMES = {
  en: {
    device: 'Eco Bike',
    fuelDevice: 'Fuel price',
    [FEATURE.CO2_TOTAL]: 'CO₂ avoided (kg)',
    [FEATURE.MONEY_TOTAL]: 'Money saved',
    [FEATURE.DISTANCE_TOTAL]: 'Distance',
    [FEATURE.TRIPS_TOTAL]: 'Trips',
    [FEATURE.CO2_YEAR]: 'CO₂ avoided this year (kg)',
    [FEATURE.MONEY_YEAR]: 'Money saved this year',
    [FEATURE.DISTANCE_YEAR]: 'Distance this year',
    [FEATURE.CO2_MONTH]: 'CO₂ avoided this month (kg)',
    [FEATURE.MONEY_MONTH]: 'Money saved this month',
    [FEATURE.DISTANCE_MONTH]: 'Distance this month',
    [FEATURE.LAST_TRIP]: 'Last trip',
    [FEATURE.FUEL_PRICE]: 'Fuel price',
    [FEATURE.STATION]: 'Station',
  },
  fr: {
    device: 'Éco Vélo',
    fuelDevice: 'Prix du carburant',
    [FEATURE.CO2_TOTAL]: 'CO₂ évité (kg)',
    [FEATURE.MONEY_TOTAL]: 'Argent économisé',
    [FEATURE.DISTANCE_TOTAL]: 'Distance',
    [FEATURE.TRIPS_TOTAL]: 'Trajets',
    [FEATURE.CO2_YEAR]: 'CO₂ évité cette année (kg)',
    [FEATURE.MONEY_YEAR]: 'Économisé cette année',
    [FEATURE.DISTANCE_YEAR]: 'Distance cette année',
    [FEATURE.CO2_MONTH]: 'CO₂ évité ce mois-ci (kg)',
    [FEATURE.MONEY_MONTH]: 'Économisé ce mois-ci',
    [FEATURE.DISTANCE_MONTH]: 'Distance ce mois-ci',
    [FEATURE.LAST_TRIP]: 'Dernier trajet',
    [FEATURE.FUEL_PRICE]: 'Prix du carburant',
    [FEATURE.STATION]: 'Station',
  },
};

// Bounds Gladys stores with every feature (NOT NULL): far beyond a lifetime.
const MAX = { co2: 1_000_000, money: 10_000_000, km: 10_000_000, trips: 1_000_000 };

export function savingsIds(gladys) {
  return gladys.externalIds('savings', 'me');
}

export function fuelIds(gladys) {
  return gladys.externalIds('fuel', 'home');
}

function sensor(ids, names, key, { category, type, unit, max }) {
  return {
    name: names[key],
    external_id: ids.feature(key),
    category,
    type,
    ...(unit ? { unit } : {}),
    min: 0,
    max,
    read_only: true,
    has_feedback: false,
    keep_history: true,
  };
}

function textFeature(ids, names, key) {
  return {
    name: names[key],
    external_id: ids.feature(key),
    category: DEVICE_FEATURE_CATEGORIES.TEXT,
    type: DEVICE_FEATURE_TYPES.TEXT.TEXT,
    // Gladys stores min/max as NOT NULL, text features included.
    min: 0,
    max: 0,
    read_only: true,
    has_feedback: false,
    keep_history: false,
  };
}

const CO2 = {
  // No mass unit in Gladys: a plain counter, the unit is in the name.
  category: DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR,
  type: DEVICE_FEATURE_TYPES.SENSOR.DECIMAL,
  max: MAX.co2,
};
const MONEY = {
  category: DEVICE_FEATURE_CATEGORIES.CURRENCY,
  type: DEVICE_FEATURE_TYPES.CURRENCY.DECIMAL,
  unit: DEVICE_FEATURE_UNITS.EURO,
  max: MAX.money,
};
const DISTANCE = {
  category: DEVICE_FEATURE_CATEGORIES.DISTANCE_SENSOR,
  type: DEVICE_FEATURE_TYPES.SENSOR.DECIMAL,
  unit: DEVICE_FEATURE_UNITS.KM,
  max: MAX.km,
};
const COUNT = {
  category: DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR,
  type: DEVICE_FEATURE_TYPES.SENSOR.INTEGER,
  max: MAX.trips,
};

/** Discovery payloads of both devices. */
export function buildDevices(gladys, config) {
  const names = NAMES[config.language] ?? NAMES.en;
  const ids = savingsIds(gladys);
  const fuel = fuelIds(gladys);
  return [
    {
      name: names.device,
      external_id: ids.device,
      features: [
        sensor(ids, names, FEATURE.CO2_TOTAL, CO2),
        sensor(ids, names, FEATURE.MONEY_TOTAL, MONEY),
        sensor(ids, names, FEATURE.DISTANCE_TOTAL, DISTANCE),
        sensor(ids, names, FEATURE.TRIPS_TOTAL, COUNT),
        sensor(ids, names, FEATURE.CO2_YEAR, CO2),
        sensor(ids, names, FEATURE.MONEY_YEAR, MONEY),
        sensor(ids, names, FEATURE.DISTANCE_YEAR, DISTANCE),
        sensor(ids, names, FEATURE.CO2_MONTH, CO2),
        sensor(ids, names, FEATURE.MONEY_MONTH, MONEY),
        sensor(ids, names, FEATURE.DISTANCE_MONTH, DISTANCE),
        textFeature(ids, names, FEATURE.LAST_TRIP),
      ],
    },
    {
      name: names.fuelDevice,
      external_id: fuel.device,
      features: [
        sensor(fuel, names, FEATURE.FUEL_PRICE, { ...MONEY, max: 100 }),
        textFeature(fuel, names, FEATURE.STATION),
      ],
    },
  ];
}

const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;

/**
 * States of both devices, in the `publishStates` shape.
 * @param {{ summary: object, fuel: object }} reading
 */
export function buildStates(gladys, reading, config) {
  const ids = savingsIds(gladys);
  const fuel = fuelIds(gladys);
  const { summary } = reading;
  const state = (id, value) => ({ device_feature_external_id: id, state: value });
  const periods = [
    ['total', FEATURE.CO2_TOTAL, FEATURE.MONEY_TOTAL, FEATURE.DISTANCE_TOTAL],
    ['year', FEATURE.CO2_YEAR, FEATURE.MONEY_YEAR, FEATURE.DISTANCE_YEAR],
    ['month', FEATURE.CO2_MONTH, FEATURE.MONEY_MONTH, FEATURE.DISTANCE_MONTH],
  ];
  const states = [];
  for (const [period, co2, money, km] of periods) {
    states.push(
      state(ids.feature(co2), round(summary[period].co2Kg, 2)),
      state(ids.feature(money), round(summary[period].money, 2)),
      state(ids.feature(km), round(summary[period].km, 1)),
    );
  }
  states.push(state(ids.feature(FEATURE.TRIPS_TOTAL), summary.total.trips));
  states.push({
    device_feature_external_id: ids.feature(FEATURE.LAST_TRIP),
    text: formatTrip(summary.last, config.language),
  });
  states.push(state(fuel.feature(FEATURE.FUEL_PRICE), round(reading.fuel.price, 3)));
  states.push({
    device_feature_external_id: fuel.feature(FEATURE.STATION),
    text: formatStation(reading.fuel, config),
  });
  return states;
}
