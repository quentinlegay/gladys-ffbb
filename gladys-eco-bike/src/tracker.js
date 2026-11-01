// -----------------------------------------------------------------------------
// The loop: read Strava and the fuel price, compute the savings, publish the
// states, fire the scene events, then sleep `refresh_minutes`.
//
// Requests stay light:
//   - Strava: the whole history once (pages of 200), then only the activities
//     started after the latest one known minus 7 days, which also catches a
//     commute tag added or an activity deleted afterwards. Strava allows 100
//     requests per 15 minutes and 1,000 per day per application.
//   - Fuel: one request every 6 hours at most, and again when the fuel type,
//     the house, the radius or the station choice changes.
//
// An outage is not "nothing saved": the activities and the last price are
// kept, only the connection badge changes.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { filterSignature } from './config.js';
import { buildDevices, buildStates } from './devices/savings.js';
import { diffEvents } from './events.js';
import { chooseStation } from './fuel/client.js';
import { buildTrips, fallbackPrice, localDay, priceOn, summarize } from './stats.js';
import { parseActivities } from './strava/parse.js';
import { StravaError } from './strava/client.js';
import { co2PerKm, readsStations } from './vehicle.js';

const logger = createLogger({ name: 'tracker' });

const DAY_MS = 24 * 60 * 60 * 1000;
const OVERLAP_MS = 7 * DAY_MS;
const FUEL_EVERY_MS = 6 * 60 * 60 * 1000;
const RATE_LIMIT_PAUSE_MS = 15 * 60 * 1000;
const HEARTBEAT_MS = 6 * 60 * 60 * 1000;

export const STATUS = {
  OK: 'ok',
  NOT_CONNECTED: 'not_connected',
  UNAUTHORIZED: 'unauthorized',
  UNREACHABLE: 'unreachable',
  RATE_LIMITED: 'rate_limited',
};

const STATUS_MESSAGES = {
  [STATUS.NOT_CONNECTED]: {
    en: 'Strava is not connected: fill in the client ID and secret, then click Connect.',
    fr: "Strava n'est pas connecté : renseignez l'ID client et le secret, puis cliquez sur Connecter.",
  },
  [STATUS.UNAUTHORIZED]: {
    en: 'Strava refused the authorization: click Connect again.',
    fr: "Strava a refusé l'autorisation : cliquez à nouveau sur Connecter.",
  },
  [STATUS.UNREACHABLE]: {
    en: 'Strava cannot be reached, the totals are the last ones read.',
    fr: 'Strava est injoignable, les totaux sont les derniers lus.',
  },
  [STATUS.RATE_LIMITED]: {
    en: 'Strava rate limit reached, the next reading is delayed.',
    fr: 'Limite de requêtes Strava atteinte, la prochaine lecture est retardée.',
  },
};

export class Tracker {
  /**
   * @param {object} options
   * @param {import('@gladysassistant/integration-sdk').GladysIntegration} options.gladys
   * @param {import('./strava/auth.js').StravaAuth} options.auth
   * @param {ReturnType<typeof import('./strava/client.js').createStravaClient>} options.strava
   * @param {ReturnType<typeof import('./fuel/client.js').createFuelClient>} options.fuel
   * @param {ReturnType<typeof import('./store.js').createStore>} options.store
   * @param {() => Date} [options.now]
   * @param {() => void} [options.onChange] something the widgets show changed
   */
  constructor({ gladys, auth, strava, fuel, store, now = () => new Date(), onChange = () => {} }) {
    this.gladys = gladys;
    this.auth = auth;
    this.strava = strava;
    this.fuel = fuel;
    this.store = store;
    this.now = now;
    this.onChange = onChange;
    this.state = null;
    this.config = null;
    this.timer = null;
    this.running = false;
    this.inFlight = null;
    this.status = null;
    this.reading = null;
    this.lastShown = '';
  }

  async load() {
    this.state = await this.store.load();
  }

  configure(config) {
    this.config = config;
    this.auth.configure(config);
  }

  buildDevices() {
    return buildDevices(this.gladys, this.config);
  }

  /** Forget what was published: everything goes again at the next reading. */
  resetPublished() {
    this.gladys.forgetPublishedStates();
    this.status = null;
  }

  async start() {
    this.running = true;
    await this.refresh();
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
    this.timer = null;
  }

  schedule(delayMs) {
    clearTimeout(this.timer);
    if (!this.running) {
      return;
    }
    this.timer = setTimeout(() => {
      this.refresh().catch((err) => logger.error('Reading failed', err));
    }, delayMs);
    this.timer.unref?.();
  }

  /**
   * One reading. Concurrent calls share the reading in progress.
   * @param {{ full?: boolean }} [options] full: read the whole Strava history again
   */
  refresh(options = {}) {
    if (!this.inFlight) {
      this.inFlight = this.read(options).finally(() => {
        this.inFlight = null;
      });
    }
    return this.inFlight;
  }

  async read({ full = false } = {}) {
    if (!this.state) {
      await this.load();
    }
    let delay = this.config.refresh_minutes * 60 * 1000;
    const status = await this.syncStrava(full);
    if (status === STATUS.RATE_LIMITED) {
      delay = Math.max(delay, RATE_LIMIT_PAUSE_MS);
    }
    await this.syncFuel();
    const events = this.evaluate();
    await this.store.save(this.state);
    await this.publish(events);
    await this.report(status);
    this.schedule(delay);
    return this.reading;
  }

  async syncStrava(full) {
    if (!this.auth.connected) {
      return STATUS.NOT_CONNECTED;
    }
    const state = this.state;
    if (state.athleteId && this.auth.athleteId && state.athleteId !== this.auth.athleteId) {
      logger.info('Another Strava athlete is connected: starting from scratch');
      Object.assign(state, { activities: {}, syncedAt: null, previous: null });
    }
    if (this.auth.athleteId) {
      state.athleteId = this.auth.athleteId;
    }
    const known = Object.values(state.activities);
    const wholeHistory = full || !state.syncedAt || known.length === 0;
    let after = 0;
    if (!wholeHistory) {
      const latest = known.reduce(
        (max, activity) => (activity.start > max ? activity.start : max),
        '',
      );
      after = Math.max(0, Math.floor((Date.parse(latest) - OVERLAP_MS) / 1000));
    }
    let result;
    try {
      result = await this.fetchActivities(after);
    } catch (err) {
      if (err instanceof StravaError) {
        logger.warn(`Strava reading failed: ${err.message}`);
        if (err.code === 'unauthorized') {
          return STATUS.UNAUTHORIZED;
        }
        return err.code === 'rate_limited' ? STATUS.RATE_LIMITED : STATUS.UNREACHABLE;
      }
      throw err;
    }
    const activities = parseActivities(result.activities);
    if (wholeHistory && result.complete) {
      state.activities = {};
    } else if (result.complete) {
      // Deleted on Strava: the stored activities of the window not returned.
      const returned = new Set(activities.map((activity) => activity.id));
      const from = after * 1000;
      for (const activity of known) {
        if (Date.parse(activity.start) >= from && !returned.has(activity.id)) {
          delete state.activities[activity.id];
        }
      }
    }
    for (const activity of activities) {
      state.activities[activity.id] = activity;
    }
    state.syncedAt = this.now().toISOString();
    logger.info(
      `Strava read: ${activities.length} activit${activities.length === 1 ? 'y' : 'ies'} (${Object.keys(state.activities).length} known)`,
    );
    return STATUS.OK;
  }

  /** Read the activities, refreshing the token once if Strava refuses it. */
  async fetchActivities(after) {
    try {
      return await this.strava.activities({ after });
    } catch (err) {
      if (!(err instanceof StravaError) || err.code !== 'unauthorized') {
        throw err;
      }
      await this.auth.accessToken({ force: true });
      return this.strava.activities({ after });
    }
  }

  /** The house whose coordinates locate the stations. */
  async home() {
    const houses = await this.gladys.getHouses();
    const located = houses.filter(
      (house) => Number.isFinite(house.latitude) && Number.isFinite(house.longitude),
    );
    return located.find((house) => house.selector === this.config.house) ?? located[0] ?? null;
  }

  async syncFuel() {
    const { config, state } = this;
    if (!readsStations(config)) {
      return;
    }
    const key = [config.fuel_type, config.house, config.search_radius, config.station_choice].join(
      '|',
    );
    const now = this.now();
    const fresh =
      state.fuelKey === key &&
      state.fuelReadAt &&
      now.getTime() - Date.parse(state.fuelReadAt) < FUEL_EVERY_MS;
    if (fresh) {
      return;
    }
    try {
      const home = await this.home();
      if (!home) {
        logger.warn('No house located in Gladys: the fuel price is an estimated average');
        state.station = null;
        state.fuelKey = key;
        state.fuelReadAt = now.toISOString();
        return;
      }
      const stations = await this.fuel.stations({
        latitude: home.latitude,
        longitude: home.longitude,
        radiusKm: config.search_radius,
        fuel: config.fuel_type,
      });
      const station = chooseStation(stations, config.station_choice);
      state.fuelKey = key;
      state.fuelReadAt = now.toISOString();
      if (!station) {
        logger.warn(`No station sells ${config.fuel_type} within ${config.search_radius} km`);
        state.station = null;
        return;
      }
      state.station = { ...station, fuel: config.fuel_type };
      const day = localDay(now, config.timezone);
      state.prices[config.fuel_type] = { ...state.prices[config.fuel_type], [day]: station.price };
    } catch (err) {
      // Keep the previous station and price; try again at the next reading.
      logger.warn(`Fuel price reading failed: ${err.message}`);
    }
  }

  /** The price shown on the Fuel price device, and where it comes from. */
  currentFuel() {
    const { config, state } = this;
    if (!readsStations(config)) {
      return {
        price: fallbackPrice(config),
        source: config.fuel_price > 0 ? 'config' : 'default',
        station: null,
      };
    }
    const today = localDay(this.now(), config.timezone);
    const history = state.prices[config.fuel_type];
    const station = state.station?.fuel === config.fuel_type ? state.station : null;
    return {
      price: priceOn(history, today, fallbackPrice(config)),
      source: station ? 'station' : 'default',
      station,
    };
  }

  /** Trips, totals and the events since the previous reading. */
  evaluate() {
    const { config, state } = this;
    const now = this.now();
    const trips = buildTrips(Object.values(state.activities), state.prices, config);
    const summary = summarize(trips, now, config.timezone);
    this.reading = {
      trips,
      summary,
      fuel: this.currentFuel(),
      co2PerKm: co2PerKm(config),
      athleteName: this.auth.athleteName,
      syncedAt: state.syncedAt,
    };
    if (!state.syncedAt) {
      // Strava never read: nothing to compare yet.
      return [];
    }
    // A change of what counts, of the vehicle or of the athlete rebuilds the
    // totals: a new baseline, not a burst of events.
    const signature = [
      filterSignature(config),
      config.fuel_type,
      config.consumption,
      config.co2_per_km,
      state.athleteId,
    ].join('|');
    const previous = state.filters === signature ? state.previous : null;
    const events = diffEvents(previous, { trips, summary }, config, now);
    state.previous = { countedIds: trips.map((trip) => trip.id), co2Kg: summary.total.co2Kg };
    state.filters = signature;
    return events;
  }

  async publish(events) {
    const states = buildStates(this.gladys, this.reading, this.config);
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: HEARTBEAT_MS });
    } catch (err) {
      logger.warn(`Publishing the states failed: ${err.message}`);
    }
    for (const event of events) {
      try {
        await this.gladys.publishSceneEvent(event.key, event.data);
      } catch (err) {
        logger.warn(`Scene event ${event.key} failed: ${err.message}`);
      }
    }
    const shown = JSON.stringify([this.reading.summary, this.reading.fuel]);
    if (shown !== this.lastShown) {
      this.lastShown = shown;
      this.onChange();
    }
  }

  async report(status) {
    if (status === this.status) {
      return;
    }
    this.status = status;
    try {
      await this.gladys.setConnectionStatus(status === STATUS.OK, STATUS_MESSAGES[status]);
    } catch (err) {
      logger.warn(`Cannot report the connection status: ${err.message}`);
    }
  }
}
