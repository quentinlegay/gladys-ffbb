# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) and to human contributors
working on this repository.

## What this is

A Gladys Assistant **external integration** (Node 22+, ESM, no build step, one runtime
dependency: `@gladysassistant/integration-sdk`) that follows French basketball teams
(Betclic ELITE, ELITE 2, Nationale, LFB…) through the public FFBB API, the one behind the
federation's official app. It started from the official JavaScript template
([GladysAssistant/integration-template-js](https://github.com/GladysAssistant/integration-template-js))
and follows the design of [prohand/gladys-teamtracker](https://github.com/prohand/gladys-teamtracker).

The user writes `COMPETITION:TEAM` entries (`ELITE:Monaco, NM1:Saint-Quentin`). Each team
becomes a device (team score, opponent score, a "Match" status text), plus five scene
triggers (match soon, started, team scored, opponent scored, ended), one scene action
(`get_match`) and two widgets (`team_match`, `my_teams`). Gladys 5.3+ is required (the
manifest `keywords` need it). Manifest `transports: ["cloud"]`.

## Commands

```bash
npm install
npm test                                    # node --test (built-in runner)
node --test test/tracker.test.js            # one file
node --test --test-name-pattern "restart"   # one test by name
npm run lint                                # eslint .
npm run format:check                        # prettier --check . (CI gate)
npm run format                              # prettier --write .
npx github:GladysAssistant/integration-store .   # store admission checks
```

CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on Node 22 and 24,
and builds the Docker image. Run the three commands before pushing.

## Architecture

```
index.js                SDK wiring only: handlers registered before connect(), tracker start/stop
src/config.js           DEFAULT_CONFIG (mirrors the manifest defaults), normalization, parseTeams()
src/competitions.js     our competition codes -> FFBB codes (codes are stored by users)
src/ffbb/client.js      the FFBB endpoints (token from items/configuration, fetch injected)
src/ffbb/parse.js       FFBB JSON -> teams, Match (the team's side: scores, state, result), dates
src/events.js           two readings -> the scene events between them (pure)
src/format.js           status lines and dates, English and French
src/tracker.js          the loop: read the FFBB, publish devices/states/badges, fire events, pace
src/store.js            last reading per team, in /data (restart-safe events)
src/devices/team.js     the device of a followed team (external ids, features, states)
src/actions.js          Configuration buttons: test_teams, find_team
src/scenes.js           scene action get_match (reads the cache, never the FFBB)
src/widgets.js          widgets team_match and my_teams
test/fixtures/          FFBB answers shaped after the API fields — tests never touch the network
```

### The FFBB API

Directus at `https://api.ffbb.app/`. `items/configuration` is public and returns the read
token (`key_dh`), sent as `Bearer` on every other call and read again on a 401/403. A
competition (`items/ffbbserver_competitions`, filtered by `code`) has a `saison` and pools
(`poules`, also under `phases`); a pool (`items/ffbbserver_poules/<id>`) holds its games
(`rencontres`): `idEngagementEquipe1/2` (team entries: `nom`, `nomUsuel`, `codeAbrege`),
`idOrganismeEquipe1/2` (clubs), `date_rencontre`, `joue`, `resultatEquipe1/2`, and `gsId`
(the live-stats game: `matchId`, `currentStatus`, period scores). `json/lives.json` lists
the games being played, joined on `gsId.matchId`. Equipe 1 is the home team.

The fixtures were written from the field lists of the
[`ffbb-api-client-v2`](https://pypi.org/project/ffbb-api-client-v2/) Python client, not
recorded from the live API: when a real answer differs, trim it into `test/fixtures/` and
fix `src/ffbb/parse.js`.

### Invariants worth knowing

- **External ids are forever.** A device is `team:<our competition code>.<FFBB club id>`,
  never what the user typed: `ELITE:Monaco` and `ELITE:AS Monaco` are the same device, and
  it survives a new season. Trigger, action, widget, feature, config and competition keys
  are stored by users: never rename them.
- **Dates without offset are Paris time**; midnight or a bare date means "time not set"
  (`timeKnown: false`: no reminder, no live polling).
- **Requests stay light**: the competition (and all its pools) once a day, the followed
  teams' pools at every reading, `lives.json` only when a followed team's game is in its
  live window (15 min before to 4 h after tip-off) and not played.
- **The pace follows the games**: `live_refresh` seconds while a game is live or its
  tip-off has passed (for 4 h), else `idle_refresh` minutes, shortened to wake at the
  reminder and at the tip-off. Gladys' own polling is not used.
- **One event per transition, the first reading is a baseline.** Points are the score
  going up between two readings (one event, their total). `store.js` keeps the previous
  reading across restarts. A lowered score fires nothing.
- **No event as a consequence of a scene action**: `get_match` reads the tracker's cache.
- **An outage is not "no game"**: the last game is kept, the badge turns `unreachable`.
- **States only for created devices**, deduplicated, republished every 6 h, and all again
  after a reconnection or a device creation (`resetPublished()`).
- **Every feature declares `min`/`max`** (NOT NULL in Gladys), text features included.
- **The rootfs is read-only**: write only under `/data` (`DATA_DIR` overrides it).

## Rules

- **Versions belong to the Release workflow.** Never edit `version` in `package.json` or
  the manifest, nor the `docker_image` tag, by hand. `test/manifest.test.js` checks they
  agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]` in
  `CHANGELOG.md`. Never write a version heading: the Release workflow moves the section.
- **Manifest.** Texts are multi-language objects `{ "en", "fr" }`, never a plain string.
  The catalog `description` holds 10 to 100 characters per language. `test/manifest.test.js`
  ties the manifest to the code: change both sides together. A new competition goes in
  `src/competitions.js` AND in the `find_team` competition options.
- **User-facing text** is `{ en, fr }`; `docs/en.md` and `docs/fr.md` stay in sync.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why, in English.
  Never log the FFBB token.
