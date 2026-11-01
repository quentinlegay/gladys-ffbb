// -----------------------------------------------------------------------------
// Dashboard widgets (manifest `widgets`):
//   - savings:      CO2, money, distance and trips of a period, the last 12
//                   months as bars, the fuel price and the compared vehicle;
//   - recent_trips: the last trips counted, each with what it saved.
//
// Both read the tracker's last reading (no request). The tracker nudges the
// open dashboards when what they show changed (refreshWidgets).
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import {
  formatCo2,
  formatDay,
  formatKm,
  formatMoney,
  formatNumber,
  formatPrice,
  PERIOD_LABELS,
} from './format.js';
import { PERIODS } from './stats.js';
import { FUELS, vehicleName } from './vehicle.js';

export const WIDGET_KEYS = ['savings', 'recent_trips'];

const TTL_SECONDS = 900;

const SPORT_LABELS = {
  Ride: { en: 'Bike', fr: 'Vélo' },
  EBikeRide: { en: 'E-bike', fr: 'Vélo électrique' },
  GravelRide: { en: 'Gravel', fr: 'Gravel' },
  EMountainBikeRide: { en: 'E-MTB', fr: 'VTT électrique' },
  Velomobile: { en: 'Velomobile', fr: 'Vélomobile' },
  Handcycle: { en: 'Handcycle', fr: 'Handbike' },
  Run: { en: 'Run', fr: 'Course' },
  Walk: { en: 'Walk', fr: 'Marche' },
  Hike: { en: 'Hike', fr: 'Randonnée' },
  Wheelchair: { en: 'Wheelchair', fr: 'Fauteuil' },
};

const METRICS = {
  co2: { key: 'co2Kg', unit: 'kg', name: { en: 'CO₂ avoided', fr: 'CO₂ évité' }, digits: 1 },
  money: { key: 'money', unit: '€', name: { en: 'Money saved', fr: 'Économies' }, digits: 2 },
  distance: { key: 'km', unit: 'km', name: { en: 'Distance', fr: 'Distance' }, digits: 1 },
};

const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;

function lang(language, config) {
  return language === 'fr' || language === 'en' ? language : config.language;
}

const waiting = (language) => ({
  ttl_seconds: 60,
  components: [
    {
      type: 'text',
      variant: 'body',
      text:
        language === 'fr'
          ? 'Pas encore de lecture Strava : connectez Strava dans la configuration de l’intégration.'
          : 'No Strava reading yet: connect Strava in the configuration of the integration.',
    },
  ],
});

export function savingsContent(tracker, { settings = {}, language } = {}) {
  const config = tracker.config;
  const lg = lang(language, config);
  const reading = tracker.reading;
  if (!reading?.syncedAt) {
    return waiting(lg);
  }
  const period = PERIODS.includes(settings.period) ? settings.period : 'year';
  const metric = METRICS[settings.chart] ?? METRICS.co2;
  const totals = reading.summary[period];
  const fuel = FUELS[config.fuel_type];
  const stationLabel =
    reading.fuel.source === 'station' && reading.fuel.station
      ? `${fuel.label[lg]} · ${formatKm(reading.fuel.station.distanceKm, lg)}`
      : fuel.label[lg];
  return {
    ttl_seconds: TTL_SECONDS,
    components: [
      { type: 'text', variant: 'heading', text: PERIOD_LABELS[period][lg] },
      {
        type: 'value',
        value: round(totals.co2Kg, 1),
        unit: 'kg',
        label: lg === 'fr' ? 'CO₂ évité' : 'CO₂ avoided',
        icon: 'cloud-off',
        color: WIDGET_COLORS.SUCCESS,
      },
      {
        type: 'value',
        value: round(totals.money, 2),
        unit: '€',
        label: lg === 'fr' ? 'Économisé' : 'Saved',
        icon: 'dollar-sign',
        color: WIDGET_COLORS.PRIMARY,
      },
      {
        type: 'value',
        value: round(totals.km, 1),
        unit: 'km',
        label: lg === 'fr' ? 'Distance' : 'Distance',
        icon: 'map',
      },
      {
        type: 'value',
        value: totals.trips,
        label: lg === 'fr' ? 'Trajets' : 'Trips',
        icon: 'repeat',
      },
      {
        type: 'chart',
        chart_type: 'bar',
        title: `${metric.name[lg]} · ${lg === 'fr' ? '12 derniers mois' : 'last 12 months'}`,
        unit: metric.unit,
        series: [
          {
            name: metric.name[lg],
            points: reading.summary.months.map((month) => ({
              t: `${month.month}-01T00:00:00.000Z`,
              v: round(month[metric.key], metric.digits),
            })),
          },
        ],
      },
      {
        type: 'status',
        items: [
          {
            label: stationLabel,
            value: formatPrice(reading.fuel.price, config),
            icon: 'droplet',
            color: reading.fuel.source === 'station' ? WIDGET_COLORS.INFO : WIDGET_COLORS.WARNING,
          },
          {
            label: vehicleName(config),
            value: `${formatNumber(reading.co2PerKm * 1000, lg, 0)} g CO₂/km`,
            icon: 'truck',
            color: WIDGET_COLORS.NEUTRAL,
          },
        ],
      },
      {
        type: 'button',
        label: lg === 'fr' ? 'Actualiser' : 'Refresh',
        icon: 'refresh-cw',
        style: 'secondary',
        action: { key: 'refresh' },
      },
    ],
  };
}

export function recentTripsContent(tracker, { settings = {}, language } = {}) {
  const config = tracker.config;
  const lg = lang(language, config);
  const reading = tracker.reading;
  if (!reading?.syncedAt) {
    return waiting(lg);
  }
  const count = Math.min(8, Math.max(1, Number(settings.count) || 5));
  const trips = reading.trips.slice(0, count);
  if (trips.length === 0) {
    return {
      ttl_seconds: TTL_SECONDS,
      components: [
        {
          type: 'text',
          variant: 'body',
          text:
            lg === 'fr'
              ? 'Aucun trajet compté. Marquez vos trajets « Trajet domicile-travail » dans Strava, ou comptez toutes les sorties dans la configuration.'
              : 'No trip counted. Tag your trips as "Commute" in Strava, or count every ride in the configuration.',
        },
      ],
    };
  }
  return {
    ttl_seconds: TTL_SECONDS,
    components: [
      {
        type: 'card-list',
        display: 'list',
        items: trips.map((trip) => {
          const sport = SPORT_LABELS[trip.sport]?.[lg] ?? trip.sport;
          const saved = lg === 'fr' ? 'Économisé' : 'Saved';
          const at = lg === 'fr' ? 'carburant à' : 'fuel at';
          return {
            title: trip.name || sport,
            subtitle: `${formatDay(trip.day, lg)} · ${sport} · ${formatKm(trip.km, lg)}`,
            date: trip.start,
            badge: { text: `-${formatCo2(trip.co2Kg, lg)}`, color: WIDGET_COLORS.SUCCESS },
            description: `${saved}${lg === 'fr' ? ' : ' : ': '}${formatMoney(trip.money, lg)} (${at} ${formatPrice(trip.price, config)})`,
          };
        }),
      },
    ],
  };
}

/** Handlers keyed by the manifest `widgets` keys. */
export function createWidgets(tracker) {
  const refresh = {
    async action(actionKey) {
      if (actionKey !== 'refresh') {
        return undefined;
      }
      await tracker.refresh();
      return { en: 'Updated', fr: 'Actualisé' };
    },
  };
  return {
    savings: { get: (request) => savingsContent(tracker, request), ...refresh },
    recent_trips: { get: (request) => recentTripsContent(tracker, request), ...refresh },
  };
}

/** Ask the open dashboards to pull the widgets again. */
export function refreshWidgets(gladys) {
  for (const key of WIDGET_KEYS) {
    gladys.requestWidgetRefresh(key);
  }
}
