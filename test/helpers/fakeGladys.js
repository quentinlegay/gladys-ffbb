// -----------------------------------------------------------------------------
// Minimal in-memory stand-in for the Gladys SDK object, for unit tests.
//
// It reproduces the surface the integration relies on and records every call
// so the tests can assert them:
//   - externalIds(type, platformId) -> { device, feature(key) }
//   - devices                        -> the devices the user created
//   - publishDiscoveredDevices / publishStates / publishTransports
//   - publishChangedStates / forgetPublishedStates (the SDK 0.15 dedupe)
//   - setConnectionStatus / publishSceneEvent / requestWidgetRefresh
// No running Gladys server, no WebSocket.
// -----------------------------------------------------------------------------

export function createFakeGladys() {
  const discovered = [];
  const published = [];
  const transports = [];
  const connectionStatuses = [];
  const sceneEvents = [];
  const widgetRefreshes = [];
  // publishChangedStates memory: feature external_id -> { state, text, at }.
  const accepted = new Map();
  let changedQueue = Promise.resolve();

  return {
    devices: [],
    discovered,
    published,
    transports,
    connectionStatuses,
    sceneEvents,
    widgetRefreshes,

    externalIds(type, platformId) {
      const device = `ext:test:${type}:${platformId}`;
      return {
        device,
        feature: (key) => `${device}:${key}`,
      };
    },

    /** Pretend the user created every discovered device. */
    createAll() {
      this.devices = (discovered.at(-1) ?? []).map((device) => ({ ...device }));
    },

    async publishDiscoveredDevices(devices) {
      discovered.push(devices);
    },

    async publishStates(states) {
      for (const s of states) {
        published.push({
          featureExternalId: s.device_feature_external_id,
          state: s.state ?? s.text,
        });
      }
    },

    // Same contract as SDK 0.15: skip an entry equal to the last value Gladys
    // accepted (earlier entries of the same call included), re-send an
    // unchanged one older than `heartbeat` (Date.now, like the SDK), 100
    // states per request, calls run one after the other, a failed batch is
    // forgotten and its error thrown.
    publishChangedStates(states, { heartbeat } = {}) {
      const run = changedQueue.then(async () => {
        const now = Date.now();
        const previous = new Map();
        const changed = states.filter((s) => {
          const id = s.device_feature_external_id;
          const last = previous.has(id) ? previous.get(id) : accepted.get(id);
          previous.set(id, { state: s.state, text: s.text, at: now });
          return (
            last === undefined ||
            last.state !== s.state ||
            last.text !== s.text ||
            (heartbeat !== undefined && now - last.at >= heartbeat)
          );
        });
        for (let start = 0; start < changed.length; start += 100) {
          const batch = changed.slice(start, start + 100);
          batch.forEach((s) => {
            accepted.set(s.device_feature_external_id, { state: s.state, text: s.text, at: now });
          });
          try {
            await this.publishStates(batch);
          } catch (err) {
            batch.forEach((s) => accepted.delete(s.device_feature_external_id));
            throw err;
          }
        }
        return { success: true, count: changed.length };
      });
      changedQueue = run.catch(() => {});
      return run;
    },

    forgetPublishedStates(externalId) {
      for (const id of [...accepted.keys()]) {
        if (externalId === undefined || id === externalId || id.startsWith(`${externalId}:`)) {
          accepted.delete(id);
        }
      }
    },

    async publishTransports(entries) {
      transports.push(...entries);
    },

    async setConnectionStatus(connected, message) {
      connectionStatuses.push({ connected, message });
    },

    async publishSceneEvent(key, data = {}) {
      sceneEvents.push({ key, data });
      return { success: true };
    },

    // Fire-and-forget in the SDK too: synchronous, resolves nothing.
    requestWidgetRefresh(key) {
      widgetRefreshes.push(key);
    },
  };
}
