// -----------------------------------------------------------------------------
// The tracker: reads the FFBB for every followed team, publishes the devices
// and their states, fires the scene events, and decides when to read again.
//
// One reading ("cycle") per wake-up:
//   1. the competitions of the followed teams, once a day: their pools and
//      the teams playing in them (this is how "ELITE:Monaco" becomes a FFBB
//      club id, and how a new season's pools are found);
//   2. the pools of the followed teams: every game, with its final score;
//   3. the live feed, only when a followed team's game is about to start or
//      under way: the score, period and clock while it is played.
//
// The pace follows the games, not a fixed poll: `live_refresh` seconds while
// a game is live (or its tip-off has passed), otherwise `idle_refresh`
// minutes — shortened to wake exactly at the tip-off reminder and at the
// tip-off. Gladys' own polling is not used: its frequencies are a fixed enum.
//
// Readings never overlap: a manual refresh (widget button, Test action)
// during a cycle joins it instead of starting another one.
// -----------------------------------------------------------------------------

import { createLogger, DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';
import { parseTeams } from './config.js';
import {
  currentCompetitions,
  findTeam,
  indexLives,
  matchFromRencontre,
  parseFfbbDate,
  pickMatch,
  poulesOf,
  teamsFromPoules,
} from './ffbb/parse.js';
import { detectEvents, eventData } from './events.js';
import { formatStatus } from './format.js';
import { buildTeamDevice, teamExternalIds, teamStates } from './devices/team.js';

const logger = createLogger({ name: 'tracker' });

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
// The teams and pools of a competition change a few times a season (a new
// phase, the playoffs): one read a day is plenty.
const COMPETITION_TTL = 24 * HOUR;
// A game is worth live polling from shortly before its tip-off until this
// long after it (overtimes, late starts, the FFBB entering the result).
const LIVE_BEFORE = 15 * MINUTE;
const LIVE_AFTER = 4 * HOUR;
// Gladys marks a value older than 48 h as outdated: republish the unchanged
// ones well before.
const REPUBLISH_AFTER = 6 * HOUR;
const MIN_DELAY = 15_000;
const MAX_ENTRIES_PER_REQUEST = 100;

function entryKey(spec) {
  return `${spec.code}:${spec.team.toLowerCase()}`;
}

/** Is this game in its live window (about to start, under way, or just played)? */
function inLiveWindow(kickoff, timeKnown, now) {
  if (!timeKnown) {
    return false;
  }
  const untilKickoff = Date.parse(kickoff) - now;
  return untilKickoff <= LIVE_BEFORE && untilKickoff > -LIVE_AFTER;
}

export class Tracker {
  /**
   * @param {object} deps
   * @param {object} deps.gladys   the SDK instance (or a fake)
   * @param {object} deps.client   FFBB client (src/ffbb/client.js)
   * @param {object} [deps.store]  persistence (src/store.js)
   * @param {() => number} [deps.now]
   * @param {(fn: Function, ms: number) => unknown} [deps.setTimer]
   * @param {(handle: unknown) => void} [deps.clearTimer]
   * @param {() => void} [deps.onChange] something shown changed (widgets)
   */
  constructor({ gladys, client, store, now, setTimer, clearTimer, onChange }) {
    this.gladys = gladys;
    this.client = client;
    this.store = store;
    this.now = now ?? Date.now;
    this.setTimer = setTimer ?? setTimeout;
    this.clearTimer = clearTimer ?? clearTimeout;
    this.onChange = onChange ?? (() => {});

    this.config = null;
    this.parseErrors = [];
    /** @type {Map<string, object>} followed teams, keyed by entryKey() */
    this.tracked = new Map();
    /** @type {Map<string, { teams: object[], poules: Map<string, object>, fetchedAt: number }>} */
    this.competitionCache = new Map();
    /** @type {Map<string, string>} */
    this.transports = new Map();
    this.devicesSignature = null;
    this.saved = {};
    this.inflight = null;
    this.timer = null;
    this.running = false;
  }

  /** Read what the previous run remembered. Call once, at startup. */
  async load() {
    this.saved = (await this.store?.load()) ?? {};
    // Teams configured before the load: fill what they do not know yet.
    for (const tracked of this.tracked.values()) {
      const saved = this.saved[tracked.key];
      if (!saved) {
        continue;
      }
      tracked.info ??= saved.info ?? null;
      if (tracked.match === undefined && 'match' in saved) {
        tracked.match = saved.match;
      }
      tracked.remindedFor ??= saved.remindedFor ?? null;
    }
  }

  /** Apply a (new) configuration. The next refresh() reads with it. */
  configure(config) {
    this.config = config;
    const { teams, errors } = parseTeams(config.teams);
    this.parseErrors = errors;
    const next = new Map();
    for (const spec of teams) {
      const key = entryKey(spec);
      const kept = this.tracked.get(key);
      const saved = this.saved[key];
      next.set(
        key,
        kept
          ? { ...kept, spec }
          : {
              key,
              spec,
              info: saved?.info ?? null,
              // `undefined` = never read: the first reading is a baseline.
              match: saved && 'match' in saved ? saved.match : undefined,
              remindedFor: saved?.remindedFor ?? null,
              resolveError: null,
              candidates: [],
              reachable: null,
            },
      );
    }
    this.tracked = next;
    for (const err of errors) {
      logger.warn(`Ignored team entry "${err.entry}": ${err.reason}`);
    }
  }

  /** Followed teams, in configuration order. */
  list() {
    return [...this.tracked.values()];
  }

  /** The followed team behind a device external id, or undefined. */
  findByDevice(externalId) {
    return this.list().find((t) => t.info && this.deviceId(t) === externalId);
  }

  deviceId(tracked) {
    return teamExternalIds(this.gladys, tracked.spec, tracked.info.id).device;
  }

  /** Discovery payload: the resolved teams (one device per club and competition). */
  buildDevices() {
    const devices = new Map();
    for (const t of this.list().filter((t) => t.info)) {
      const device = buildTeamDevice(this.gladys, t, this.config);
      devices.set(device.external_id, device);
    }
    return [...devices.values()];
  }

  start() {
    this.running = true;
    return this.refresh();
  }

  stop() {
    this.running = false;
    if (this.timer) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
  }

  /**
   * Forget what was published: after a reconnection Gladys may have missed
   * states, and a device created meanwhile has none yet.
   */
  resetPublished() {
    this.gladys.forgetPublishedStates();
    this.transports.clear();
    this.devicesSignature = null;
  }

  /**
   * Read now, then plan the next one. A reading in progress is joined; with
   * `fresh`, another one follows it (the configuration or the created devices
   * changed while it ran, so its result is already stale).
   */
  refresh({ fresh = false } = {}) {
    if (this.inflight && fresh) {
      return this.inflight.then(() => this.refresh());
    }
    if (!this.inflight) {
      this.inflight = this.cycle()
        .catch((err) => logger.error('Reading failed', err))
        .finally(() => {
          this.inflight = null;
          this.schedule();
        });
    }
    return this.inflight;
  }

  schedule() {
    if (this.timer) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
    if (!this.running) {
      return;
    }
    const delay = this.nextDelay();
    logger.debug(`Next reading in ${Math.round(delay / 1000)} s`);
    this.timer = this.setTimer(() => {
      this.timer = null;
      this.refresh();
    }, delay);
  }

  /** Milliseconds until the next reading. */
  nextDelay() {
    const now = this.now();
    const {
      live_refresh: liveSeconds,
      idle_refresh: idleMinutes,
      reminder_minutes: reminder,
    } = this.config;
    const live = liveSeconds * 1000;
    let delay = idleMinutes * MINUTE;
    for (const { match } of this.tracked.values()) {
      if (!match || match.state === 'post' || match.statusName === 'POSTPONED') {
        continue;
      }
      if (match.state === 'in') {
        return Math.max(MIN_DELAY, live);
      }
      if (!match.timeKnown) {
        continue;
      }
      const untilKickoff = Date.parse(match.kickoff) - now;
      if (untilKickoff <= 0 && untilKickoff > -LIVE_AFTER) {
        return Math.max(MIN_DELAY, live);
      }
      if (untilKickoff > 0) {
        delay = Math.min(delay, untilKickoff);
        const untilReminder = untilKickoff - reminder * MINUTE;
        if (reminder > 0 && untilReminder > 0) {
          delay = Math.min(delay, untilReminder);
        }
      }
    }
    return Math.max(MIN_DELAY, delay);
  }

  async cycle() {
    if (!this.config) {
      return;
    }
    const now = this.now();
    const before = this.snapshot();
    const byCompetition = new Map();
    for (const tracked of this.tracked.values()) {
      const { code } = tracked.spec;
      byCompetition.set(code, [...(byCompetition.get(code) ?? []), tracked]);
    }

    // 1) Resolve the teams; collect the pools to read.
    const freshPoules = new Map();
    for (const group of byCompetition.values()) {
      const competition = await this.competition(group[0].spec, now);
      for (const [id, poule] of competition?.freshPoules ?? []) {
        freshPoules.set(id, poule);
      }
      this.resolve(group, competition);
    }

    // 2) The pools of the followed teams, each read once.
    const pouleIds = new Set(this.list().flatMap((t) => t.info?.pouleIds ?? []));
    const poules = new Map();
    for (const pouleId of pouleIds) {
      if (freshPoules.has(pouleId)) {
        poules.set(pouleId, freshPoules.get(pouleId));
        continue;
      }
      try {
        poules.set(pouleId, await this.client.poule(pouleId));
      } catch (err) {
        logger.warn(`Pool ${pouleId} unavailable (${err.message})`);
      }
    }

    // 3) The live feed, only when a followed team's game may be under way.
    const gamesOf = (tracked) =>
      tracked.info.pouleIds
        .flatMap((id) => poules.get(id)?.rencontres ?? [])
        .filter((rencontre) => matchFromRencontre(rencontre, tracked.info.id) !== null);
    const resolved = this.list().filter((t) => t.info);
    const someLive = resolved.some((t) =>
      gamesOf(t).some((rencontre) => {
        const { iso, timeKnown } = parseFfbbDate(rencontre.date_rencontre);
        const played = rencontre.joue === true || Number(rencontre.joue) === 1;
        return !played && inLiveWindow(iso, timeKnown, now);
      }),
    );
    let liveOf = () => undefined;
    if (someLive) {
      try {
        liveOf = indexLives(await this.client.lives());
      } catch (err) {
        logger.warn(`Live feed unavailable (${err.message})`);
      }
    }

    // 4) Each team's game, and what happened since the previous reading.
    const events = [];
    for (const tracked of resolved) {
      const readable = tracked.info.pouleIds.filter((id) => poules.has(id));
      if (readable.length === 0) {
        // Keep the last known game: an outage must not read as "no game".
        tracked.reachable = false;
        continue;
      }
      tracked.reachable = true;
      const match = pickMatch(gamesOf(tracked), tracked.info.id, liveOf, now);
      events.push(...this.apply(tracked, match, now));
    }

    await this.publishDevices();
    await this.publishAllStates();
    await this.publishTransports();
    await this.fireEvents(events);
    await this.reportStatus();

    const after = this.snapshot();
    if (after !== before) {
      await this.save();
      this.onChange();
    }
  }

  /**
   * The current season of a competition: its teams and pools, read once a
   * day. `freshPoules` holds the pools read for it during this call (none
   * when served from the cache). Null when the FFBB cannot be read and
   * nothing is cached.
   */
  async competition(spec, now) {
    const cached = this.competitionCache.get(spec.code);
    if (cached && now - cached.fetchedAt < COMPETITION_TTL) {
      return { ...cached, freshPoules: new Map() };
    }
    try {
      const competitions = currentCompetitions(await this.client.competitions(spec.ffbbCodes));
      const pouleIds = poulesOf(competitions);
      const poules = new Map();
      for (const pouleId of pouleIds) {
        poules.set(pouleId, await this.client.poule(pouleId));
      }
      const entry = {
        found: competitions.length > 0,
        teams: teamsFromPoules([...poules.values()]),
        fetchedAt: now,
      };
      this.competitionCache.set(spec.code, entry);
      if (!entry.found) {
        logger.warn(
          `${spec.competitionName}: no competition with code ${spec.ffbbCodes.join('/')}`,
        );
      }
      return { ...entry, freshPoules: poules };
    } catch (err) {
      logger.warn(`${spec.competitionName}: competition unavailable (${err.message})`);
      return cached ? { ...cached, freshPoules: new Map() } : null;
    }
  }

  /** Turn what the user typed into FFBB teams; keep known teams' pools current. */
  resolve(group, competition) {
    for (const tracked of group) {
      if (!competition) {
        if (!tracked.info) {
          tracked.resolveError = 'unreachable';
        }
        continue;
      }
      if (tracked.info) {
        // A new season or phase: the same club, in new pools.
        const current = competition.teams.find((team) => team.id === tracked.info.id);
        if (current && current.pouleIds.join() !== tracked.info.pouleIds.join()) {
          tracked.info = { ...tracked.info, pouleIds: current.pouleIds };
        }
        continue;
      }
      const found = competition.found
        ? findTeam(competition.teams, tracked.spec.team)
        : { error: 'competition_not_found' };
      const before = tracked.resolveError;
      tracked.resolveError = found.error ?? null;
      tracked.candidates = found.candidates ?? [];
      if (found.team) {
        const { id, name, abbreviation, pouleIds } = found.team;
        tracked.info = { id, name, abbreviation, pouleIds };
        logger.info(`${tracked.spec.entry} is ${name} (FFBB club ${id})`);
      } else if (found.error !== before) {
        // Once per problem, not at every reading.
        logger.warn(`${tracked.spec.entry}: ${found.error} in ${tracked.spec.competitionName}`);
      }
    }
  }

  apply(tracked, match, now) {
    const { events, remindedFor } = detectEvents({
      previous: tracked.match,
      current: match,
      remindedFor: tracked.remindedFor,
      now,
      reminderMinutes: this.config.reminder_minutes,
    });
    tracked.match = match;
    tracked.remindedFor = remindedFor;
    return events.map((event) => ({ event, tracked }));
  }

  async publishDevices() {
    const devices = this.buildDevices();
    const signature = JSON.stringify(devices);
    if (signature === this.devicesSignature) {
      return;
    }
    await this.gladys.publishDiscoveredDevices(devices);
    this.devicesSignature = signature;
  }

  async publishAllStates() {
    // States of a device the user has not created yet are refused: only send
    // those of created devices (the list the SDK keeps up to date).
    const created = new Set((this.gladys.devices ?? []).map((device) => device.external_id));
    const now = this.now();
    const states = this.list()
      .filter((t) => t.info && t.match !== undefined && created.has(this.deviceId(t)))
      .flatMap((t) => teamStates(this.gladys, t, this.config, now));
    // The SDK only sends what changed (plus the heartbeat) and splits the
    // batch by 100.
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: REPUBLISH_AFTER });
    } catch (err) {
      logger.error('Gladys refused the states', err);
    }
  }

  async publishTransports() {
    const entries = this.list()
      .filter((t) => t.info && t.reachable !== null)
      .map((t) => ({
        external_id: this.deviceId(t),
        transport: t.reachable ? DEVICE_TRANSPORTS.CLOUD : DEVICE_TRANSPORTS.UNREACHABLE,
      }))
      .filter((entry) => this.transports.get(entry.external_id) !== entry.transport);
    if (entries.length === 0) {
      return;
    }
    try {
      for (let i = 0; i < entries.length; i += MAX_ENTRIES_PER_REQUEST) {
        await this.gladys.publishTransports(entries.slice(i, i + MAX_ENTRIES_PER_REQUEST));
      }
      for (const entry of entries) {
        this.transports.set(entry.external_id, entry.transport);
      }
    } catch (err) {
      logger.warn(`Gladys refused the transport badges: ${err.message}`);
    }
  }

  async fireEvents(events) {
    for (const { event, tracked } of events) {
      const data = eventData(
        event,
        this.deviceId(tracked),
        tracked.spec.competitionName,
        formatStatus(event.match, this.config, this.now()),
      );
      logger.info(`Scene event ${event.key} <- ${tracked.spec.entry}: ${data.summary}`);
      try {
        await this.gladys.publishSceneEvent(event.key, data);
      } catch (err) {
        logger.warn(`Scene event ${event.key} refused: ${err.message}`);
      }
    }
  }

  /** The connection status of the Configuration screen. */
  async reportStatus() {
    const teams = this.list();
    const working = teams.filter((t) => t.info && t.reachable !== false);
    const problems = [
      ...this.parseErrors.map((err) => err.entry),
      ...teams.filter((t) => !t.info || t.reachable === false).map((t) => t.spec.entry),
    ];
    let message;
    if (teams.length === 0 && problems.length === 0) {
      message = {
        en: 'Add at least one team in the configuration, e.g. ELITE:Monaco.',
        fr: 'Ajoutez au moins une équipe dans la configuration, par ex. ELITE:Monaco.',
      };
    } else if (problems.length > 0) {
      const list = problems.join(', ');
      message = {
        en: `Not followed: ${list}. Use "Test the teams" to see why.`,
        fr: `Non suivies : ${list}. Utilisez « Tester les équipes » pour savoir pourquoi.`,
      };
    }
    try {
      await this.gladys.setConnectionStatus(working.length > 0, message);
    } catch (err) {
      logger.warn(`Cannot report the connection status: ${err.message}`);
    }
  }

  snapshot() {
    return JSON.stringify(
      this.list().map((t) => [t.key, t.info, t.match, t.remindedFor, t.reachable, t.resolveError]),
    );
  }

  async save() {
    if (!this.store) {
      return;
    }
    const teams = {};
    for (const t of this.tracked.values()) {
      teams[t.key] = {
        info: t.info,
        ...(t.match !== undefined && { match: t.match }),
        remindedFor: t.remindedFor,
      };
    }
    // Teams no longer followed are forgotten.
    this.saved = teams;
    await this.store.save(teams);
  }
}
