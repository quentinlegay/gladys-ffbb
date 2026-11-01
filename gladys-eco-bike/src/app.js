// -----------------------------------------------------------------------------
// The SDK handlers, registered on a Gladys client (the real one in index.js,
// the SDK's fake Gladys in the tests). Everything must be registered before
// connect().
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import { createFuelClient } from './fuel/client.js';
import { createStore } from './store.js';
import { StravaAuth } from './strava/auth.js';
import { createStravaClient } from './strava/client.js';
import { Tracker } from './tracker.js';
import { resync, testConnection } from './actions.js';
import { createSceneActions } from './scenes.js';
import { createWidgets, refreshWidgets } from './widgets.js';

const logger = createLogger({ name: 'app' });

/**
 * @param {object} options
 * @param {import('@gladysassistant/integration-sdk').GladysIntegration} options.gladys
 * @param {typeof fetch} [options.fetch] for Strava and the fuel prices
 * @param {object} [options.store]
 * @param {() => Date} [options.now]
 */
export function createApp({ gladys, fetch: fetchFn = globalThis.fetch, store, now }) {
  const auth = new StravaAuth({
    gladys,
    fetch: fetchFn,
    now: now ? () => now().getTime() : undefined,
  });
  const tracker = new Tracker({
    gladys,
    auth,
    strava: createStravaClient({ fetch: fetchFn, accessToken: () => auth.accessToken() }),
    fuel: createFuelClient({ fetch: fetchFn }),
    store: store ?? createStore(),
    now,
    // Something a widget shows changed: nudge the open dashboards.
    onChange: () => refreshWidgets(gladys),
  });
  tracker.configure(normalizeConfig());

  let started = false;

  // --- Discovery: Gladys asks for the list of devices ------------------------
  gladys.onScanRequest(async () => {
    await gladys.publishDiscoveredDevices(tracker.buildDevices());
  });

  // --- A device was created: give it its states at once ---------------------
  gladys.onDeviceCreated(async (device) => {
    logger.info(`Device created: ${device.external_id}`);
    tracker.resetPublished();
    await tracker.refresh();
  });

  // --- Strava OAuth2 (the `strava` field of the configuration) ---------------
  gladys.onOAuthAuthorizeUrl((_key, redirectUri) => auth.authorizeUrl(redirectUri));
  gladys.onOAuthCallback(async (_key, params) => {
    await auth.callback(params);
    tracker.resetPublished();
    await tracker.refresh();
  });

  // --- Manifest actions: buttons in the Configuration screen -----------------
  gladys.onAction('test_connection', () => testConnection(tracker));
  gladys.onAction('resync', () => resync(tracker));

  // --- Scene actions ----------------------------------------------------------
  // Scene TRIGGERS need no handler: the tracker fires them (src/events.js).
  for (const [key, handler] of Object.entries(createSceneActions(tracker))) {
    gladys.onSceneAction(key, handler);
  }

  // --- Dashboard widgets -----------------------------------------------------
  for (const [key, widget] of Object.entries(createWidgets(tracker))) {
    gladys.onWidgetGet(key, (request) => widget.get(request));
    gladys.onWidgetAction(key, (actionKey, params) => widget.action(actionKey, params));
  }

  // --- Configuration updated by the user (or the tokens we stored) -----------
  gladys.onConfigUpdated(async (raw) => {
    const config = normalizeConfig(raw);
    const before = JSON.stringify({ ...tracker.config, tokens: null });
    tracker.configure(config);
    if (JSON.stringify({ ...config, tokens: null }) === before) {
      // Only the tokens changed (our own setConfig echoed back).
      return;
    }
    logger.info('Configuration updated');
    // The device names follow the language.
    await gladys.publishDiscoveredDevices(tracker.buildDevices());
    tracker.resetPublished();
    if (started) {
      await tracker.refresh();
    }
    refreshWidgets(gladys);
  });

  // --- Connection lifecycle --------------------------------------------------
  gladys.on('connected', async () => {
    try {
      tracker.configure(normalizeConfig(await gladys.getConfig()));
      if (!tracker.state) {
        await tracker.load();
      }
      await gladys.publishDiscoveredDevices(tracker.buildDevices());
      // Gladys may have missed states while the socket was down.
      tracker.resetPublished();
      started = true;
      await tracker.start();
      refreshWidgets(gladys);
    } catch (err) {
      logger.error('Post-connection initialization failed', err);
      await gladys
        .setConnectionStatus(false, {
          en: 'Initialization failed, check the integration logs.',
          fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
        })
        .catch(() => {});
    }
  });

  gladys.on('disconnected', () => {
    // Nothing can be published while Gladys is away.
    tracker.stop();
  });

  return { tracker, auth };
}
