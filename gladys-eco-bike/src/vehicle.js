// -----------------------------------------------------------------------------
// The comparison vehicle: what each kilometre ridden would have cost, in money
// and in CO2, had it been driven instead.
//
// The CO2 factors are "well to wheel" (extraction, refining, transport and
// combustion), rounded from the French ADEME Base Empreinte. They are
// estimates: a user who knows their car's figure writes it in "CO2 per km",
// which then wins. The default prices are only used before any price could be
// read (no station found, outside France): rough French averages.
// -----------------------------------------------------------------------------

/**
 * Keys are stored by users (`fuel_type`) and match the field names of the
 * French fuel price open data (`<key>_prix`): never rename them.
 */
export const FUELS = {
  gazole: {
    unit: 'L',
    co2PerUnit: 3.16,
    defaultPrice: 1.65,
    label: { en: 'Diesel', fr: 'Gazole' },
  },
  sp95: {
    unit: 'L',
    co2PerUnit: 2.8,
    defaultPrice: 1.78,
    label: { en: 'Unleaded 95', fr: 'SP95' },
  },
  e10: {
    unit: 'L',
    co2PerUnit: 2.7,
    defaultPrice: 1.73,
    label: { en: 'Unleaded 95-E10', fr: 'SP95-E10' },
  },
  sp98: {
    unit: 'L',
    co2PerUnit: 2.8,
    defaultPrice: 1.85,
    label: { en: 'Unleaded 98', fr: 'SP98' },
  },
  e85: {
    unit: 'L',
    co2PerUnit: 1.5,
    defaultPrice: 0.8,
    label: { en: 'E85 bioethanol', fr: 'Superéthanol E85' },
  },
  gplc: {
    unit: 'L',
    co2PerUnit: 1.86,
    defaultPrice: 1.0,
    label: { en: 'LPG', fr: 'GPL' },
  },
  electric: {
    unit: 'kWh',
    // French electricity mix, life cycle.
    co2PerUnit: 0.052,
    defaultPrice: 0.2,
    label: { en: 'Electricity', fr: 'Électricité' },
    // No station to read: the price is the one of the configuration.
    noStation: true,
  },
};

/** Whether the fuel price comes from a station near home. */
export function readsStations(config) {
  return config.fuel_price <= 0 && !FUELS[config.fuel_type].noStation;
}

/** The vehicle name shown to the user. */
export function vehicleName(config) {
  if (config.vehicle_name) {
    return config.vehicle_name;
  }
  return config.language === 'fr' ? 'Voiture' : 'Car';
}

/** kg of CO2 the vehicle emits per km. */
export function co2PerKm(config) {
  if (config.co2_per_km > 0) {
    return config.co2_per_km / 1000;
  }
  return (config.consumption / 100) * FUELS[config.fuel_type].co2PerUnit;
}

/**
 * What one trip would have cost by car.
 * @param {number} km
 * @param {number} price fuel price (per litre or per kWh)
 */
export function tripSavings(km, price, config) {
  const energy = (km * config.consumption) / 100;
  return {
    co2Kg: km * co2PerKm(config),
    money: energy * price + km * config.extra_cost_per_km,
    energy,
  };
}
