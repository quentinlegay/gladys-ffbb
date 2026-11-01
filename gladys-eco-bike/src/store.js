// -----------------------------------------------------------------------------
// What the integration remembers across restarts, in /data.
//
// The container rootfs is read-only: /data is the one writable volume. The
// file holds the Strava activities read so far (a few fields each), the fuel
// price read each day, and the previous reading (counted trip ids, total CO2)
// so that a restart does not turn the next reading into a baseline.
//
// Losing the file costs one full read of the Strava history and the past
// price days (trips are then valued at the first price read again): every
// error is logged and swallowed.
// -----------------------------------------------------------------------------

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'store' });

const FILE_VERSION = 1;

export const DEFAULT_STORE_PATH = join(process.env.DATA_DIR || '/data', 'eco-bike.json');

export function emptyState() {
  return {
    athleteId: '',
    activities: {},
    syncedAt: null,
    prices: {},
    station: null,
    fuelReadAt: null,
    fuelKey: '',
    previous: null,
    filters: '',
  };
}

export function createStore(path = DEFAULT_STORE_PATH) {
  return {
    path,

    async load() {
      try {
        const content = JSON.parse(await readFile(path, 'utf8'));
        if (content?.version !== FILE_VERSION || typeof content.state !== 'object') {
          return emptyState();
        }
        return { ...emptyState(), ...content.state };
      } catch (err) {
        if (err.code !== 'ENOENT') {
          logger.warn(`Cannot read ${path}, starting from scratch: ${err.message}`);
        }
        return emptyState();
      }
    },

    async save(state) {
      try {
        await mkdir(dirname(path), { recursive: true });
        // Write then rename: a crash mid-write never leaves half a file.
        const temporary = `${path}.tmp`;
        await writeFile(temporary, JSON.stringify({ version: FILE_VERSION, state }));
        await rename(temporary, path);
      } catch (err) {
        logger.warn(`Cannot write ${path}: ${err.message}`);
      }
    },
  };
}

/** A store that keeps everything in memory (tests). */
export function createMemoryStore(initial = null) {
  let saved = initial ? structuredClone(initial) : null;
  return {
    path: ':memory:',
    async load() {
      return saved ? { ...emptyState(), ...structuredClone(saved) } : emptyState();
    },
    async save(state) {
      saved = structuredClone(state);
    },
    get saved() {
      return saved;
    },
  };
}
