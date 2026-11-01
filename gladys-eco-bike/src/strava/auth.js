// -----------------------------------------------------------------------------
// Strava OAuth2 through Gladys, and the token lifecycle.
//
// 1. The user clicks "Connect" (the `strava` oauth2 field): Gladys asks for
//    the authorization URL, built with the user's client id and an anti-CSRF
//    `state` remembered here.
// 2. Strava redirects back through Gladys: the code is exchanged for tokens,
//    stored as config keys outside the config_schema (never shown, never sent
//    to the browser).
// 3. Before every reading the access token is refreshed when it expires
//    within 5 minutes; the new tokens are stored again (Strava may rotate the
//    refresh token).
//
// Never log a token.
// -----------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';
import { createLogger } from '@gladysassistant/integration-sdk';
import { TOKEN_KEYS } from '../config.js';
import { authorizeUrl, exchangeCode, refreshTokens, StravaError } from './client.js';

const logger = createLogger({ name: 'strava-auth' });

const EARLY_REFRESH_SECONDS = 300;
// A state is good for the time it takes to click through Strava's page.
const STATE_TTL_MS = 15 * 60 * 1000;

export function tokensToConfig(tokens) {
  return {
    [TOKEN_KEYS.ACCESS]: tokens?.accessToken ?? '',
    [TOKEN_KEYS.REFRESH]: tokens?.refreshToken ?? '',
    [TOKEN_KEYS.EXPIRES_AT]: tokens?.expiresAt ?? 0,
    [TOKEN_KEYS.ATHLETE_ID]: tokens?.athleteId ?? '',
    [TOKEN_KEYS.ATHLETE_NAME]: tokens?.athleteName ?? '',
  };
}

export class StravaAuth {
  /**
   * @param {object} options
   * @param {{ setConfig: Function }} options.gladys
   * @param {typeof fetch} [options.fetch]
   * @param {() => number} [options.now] epoch milliseconds
   */
  constructor({ gladys, fetch: fetchFn = globalThis.fetch, now = () => Date.now() }) {
    this.gladys = gladys;
    this.fetch = fetchFn;
    this.now = now;
    this.config = { client_id: '', client_secret: '' };
    this.tokens = null;
    this.pending = new Map();
    this.redirectHost = '';
    this.refreshing = null;
  }

  /** Called with every normalized configuration. */
  configure(config) {
    this.config = config;
    // The stored tokens win over the ones in memory only when they are newer:
    // the config echoed back after our own setConfig may be the older one.
    const stored = config.tokens;
    if (!stored) {
      this.tokens = null;
    } else if (!this.tokens || stored.refreshToken !== this.tokens.refreshToken) {
      if (!this.tokens || stored.expiresAt >= this.tokens.expiresAt) {
        this.tokens = stored;
      }
    }
  }

  get connected() {
    return Boolean(this.tokens?.refreshToken);
  }

  get athleteId() {
    return this.tokens?.athleteId ?? '';
  }

  get athleteName() {
    return this.tokens?.athleteName ?? '';
  }

  /** onOAuthAuthorizeUrl: the URL of Strava's consent page. */
  authorizeUrl(redirectUri) {
    if (!this.config.client_id || !this.config.client_secret) {
      throw new Error(
        'Fill in the Strava client ID and client secret, save, then click Connect again.',
      );
    }
    const state = randomUUID();
    const now = this.now();
    for (const [key, createdAt] of this.pending) {
      if (now - createdAt > STATE_TTL_MS) {
        this.pending.delete(key);
      }
    }
    this.pending.set(state, now);
    try {
      this.redirectHost = new URL(redirectUri).hostname;
      logger.info(`Strava "Authorization Callback Domain" must be: ${this.redirectHost}`);
    } catch {
      this.redirectHost = '';
    }
    return authorizeUrl({ clientId: this.config.client_id, redirectUri, state });
  }

  /** onOAuthCallback: exchange the code, store the tokens. */
  async callback({ code, state }) {
    if (!state || !this.pending.has(state)) {
      throw new Error('Unknown or expired authorization state, click Connect again.');
    }
    this.pending.delete(state);
    if (!code) {
      throw new Error('Strava returned no authorization code.');
    }
    const tokens = await exchangeCode({
      fetch: this.fetch,
      clientId: this.config.client_id,
      clientSecret: this.config.client_secret,
      code,
    });
    await this.store(tokens);
    logger.info(`Strava connected (athlete ${tokens.athleteId})`);
    return tokens;
  }

  async store(tokens) {
    this.tokens = tokens;
    try {
      await this.gladys.setConfig(tokensToConfig(tokens));
    } catch (err) {
      // The tokens in memory still work; the next refresh stores them again.
      logger.warn(`Cannot store the Strava tokens: ${err.message}`);
    }
  }

  /** Forget the tokens (revoked on Strava's side). */
  async forget() {
    this.tokens = null;
    await this.gladys.setConfig(tokensToConfig(null)).catch(() => {});
  }

  /**
   * A valid access token, refreshed when needed.
   * @param {{ force?: boolean }} [options] force: refresh even if not expired
   */
  async accessToken({ force = false } = {}) {
    if (!this.tokens) {
      throw new StravaError('unauthorized', 'Strava is not connected');
    }
    const fresh = this.tokens.expiresAt - EARLY_REFRESH_SECONDS > this.now() / 1000;
    if (fresh && !force && this.tokens.accessToken) {
      return this.tokens.accessToken;
    }
    // One refresh at a time: Strava invalidates the previous refresh token.
    if (!this.refreshing) {
      this.refreshing = refreshTokens({
        fetch: this.fetch,
        clientId: this.config.client_id,
        clientSecret: this.config.client_secret,
        tokens: this.tokens,
      })
        .then((tokens) => this.store(tokens).then(() => tokens))
        .finally(() => {
          this.refreshing = null;
        });
    }
    return (await this.refreshing).accessToken;
  }
}
