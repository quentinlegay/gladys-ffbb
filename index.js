// -----------------------------------------------------------------------------
// Entry point of the FFBB basketball integration for Gladys Assistant.
//
// Role of this file: wire the SDK to the tracker (src/tracker.js). It holds
// no basketball logic. It only:
//   1. instantiates the SDK (connection, auth, reconnection: handled for you);
//   2. registers the event handlers BEFORE connect();
//   3. connects, then starts the tracker, which reads the FFBB at its own pace.
//
// Environment variables provided by the Gladys supervisor to the container:
//   - GLADYS_HOST_API_URL         (host API URL)
//   - GLADYS_INTEGRATION_TOKEN    (integration-scoped JWT)
//   - GLADYS_INTEGRATION_SELECTOR (integration identifier)
// The SDK reads them automatically: `new GladysIntegration()` is enough.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './src/config.js';
import { createFfbbClient } from './src/ffbb/client.js';
import { createStore } from './src/store.js';
import { Tracker } from './src/tracker.js';
import { findTeams, testTeams } from './src/actions.js';
import { createSceneActions } from './src/scenes.js';
import { createWidgets, refreshWidgets } from './src/widgets.js';

const gladys = new GladysIntegration();
const tracker = new Tracker({
  gladys,
  client: createFfbbClient(),
  store: createStore(),
  // Something a widget shows changed: nudge the open dashboards.
  onChange: () => refreshWidgets(gladys),
});

let config = normalizeConfig();
let loaded = false;

// --- Discovery: Gladys asks for the list of devices --------------------------
gladys.onScanRequest(async () => {
  logger.info('onScanRequest -> publishing the followed teams');
  await gladys.publishDiscoveredDevices(tracker.buildDevices());
});

// --- A device was created: give it its states at once -----------------------
gladys.onDeviceCreated(async (device) => {
  logger.info(`Device created: ${device.external_id}`);
  tracker.resetPublished();
  await tracker.refresh({ fresh: true });
});

// --- Manifest actions: buttons in the Configuration screen -------------------
gladys.onAction('test_teams', () => testTeams(tracker));
gladys.onAction('find_team', (fields) => findTeams(tracker, fields));

// --- Scene actions (Gladys 5.1+) ---------------------------------------------
// Scene TRIGGERS need no handler: the tracker fires them (src/events.js).
for (const [actionKey, handler] of Object.entries(createSceneActions(tracker))) {
  gladys.onSceneAction(actionKey, (fields) => handler(gladys, { fields, config }));
}

// --- Dashboard widgets (Gladys 5.1+) -----------------------------------------
for (const [widgetKey, widget] of Object.entries(createWidgets(tracker))) {
  gladys.onWidgetGet(widgetKey, (request) => widget.get(gladys, { ...request, config }));
  gladys.onWidgetAction(widgetKey, (actionKey, params, { settings }) =>
    widget.action(gladys, { actionKey, params, settings, config }),
  );
}

// --- Configuration updated by the user ---------------------------------------
gladys.onConfigUpdated(async (newConfig) => {
  logger.info('onConfigUpdated -> new configuration received');
  config = normalizeConfig(newConfig);
  tracker.configure(config);
  // The device names follow the language: publish everything again.
  tracker.resetPublished();
  await tracker.refresh({ fresh: true });
  refreshWidgets(gladys);
});

// --- Connection lifecycle ----------------------------------------------------
gladys.on('connected', async () => {
  try {
    if (!loaded) {
      await tracker.load();
      loaded = true;
    }
    config = normalizeConfig(await gladys.getConfig());
    tracker.configure(config);
    // Gladys may have missed states while the socket was down.
    tracker.resetPublished();
    await tracker.start();
    // The nudges sent while the socket was down were dropped.
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
  // Nothing can be published while Gladys is away: stop reading the FFBB too.
  tracker.stop();
});

// --- Graceful shutdown -------------------------------------------------------
gladys.handleShutdown(async (signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
  tracker.stop();
});

// --- Startup -----------------------------------------------------------------
logger.info('Starting the FFBB basketball integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
