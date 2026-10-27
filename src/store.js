// -----------------------------------------------------------------------------
// What the integration remembers across restarts, in /data.
//
// The container rootfs is read-only: /data is the one writable volume. The
// file holds, per followed team, the last game read and the game whose
// tip-off reminder was already sent, plus the resolved FFBB team (so the
// devices exist at startup even when the FFBB does not answer). Without it,
// an update of the integration during a game would make the next reading a
// baseline: the baskets scored meanwhile would never fire.
//
// Losing the file is harmless (one baseline reading), so every error is
// logged and swallowed.
// -----------------------------------------------------------------------------

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'store' });

const FILE_VERSION = 1;

export const DEFAULT_STORE_PATH = join(process.env.DATA_DIR || '/data', 'ffbb.json');

export function createStore(path = DEFAULT_STORE_PATH) {
  return {
    path,

    /** @returns {Promise<Record<string, object>>} the saved teams, keyed by entry */
    async load() {
      try {
        const content = JSON.parse(await readFile(path, 'utf8'));
        return content?.version === FILE_VERSION && content.teams ? content.teams : {};
      } catch (err) {
        if (err.code !== 'ENOENT') {
          logger.warn(`Cannot read ${path}, starting from scratch: ${err.message}`);
        }
        return {};
      }
    },

    async save(teams) {
      try {
        await mkdir(dirname(path), { recursive: true });
        // Write then rename: a crash mid-write never leaves half a file.
        const temporary = `${path}.tmp`;
        await writeFile(temporary, JSON.stringify({ version: FILE_VERSION, teams }));
        await rename(temporary, path);
      } catch (err) {
        logger.warn(`Cannot write ${path}: ${err.message}`);
      }
    },
  };
}
