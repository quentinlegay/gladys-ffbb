# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) and to human contributors
working on this repository.

## What this is

A Gladys Assistant **external integration** (Node 22+, ESM, no build step, one runtime
dependency: `@gladysassistant/integration-sdk`) that shows the CO₂ avoided and the money
saved by riding instead of driving. It started from the official JavaScript template
([GladysAssistant/integration-template-js](https://github.com/GladysAssistant/integration-template-js)).

Trips come from Strava (OAuth2 relayed by Gladys, the user's own Strava API
application), are compared with a vehicle described in the configuration, and valued at
the fuel price of the station nearest to the Gladys house (French open data). Two
devices (`savings:me`, `fuel:home`), two scene triggers (`trip_recorded`,
`co2_milestone`), one scene action (`get_savings`), two widgets (`savings`,
`recent_trips`), two configuration buttons (`test_connection`, `resync`). Gladys 5.3+.
Manifest `location: true` (for `getHouses()`), `transports: ["cloud"]`.

## Commands

```bash
npm install
npm test                                    # node --test (built-in runner)
node --test test/tracker.test.js            # one file
node --test --test-name-pattern "milestone" # one test by name
npm run lint                                # eslint .
npm run format:check                        # prettier --check . (CI gate)
npm run format                              # prettier --write .
npx github:GladysAssistant/integration-store .   # store admission checks
```

CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on Node 22 and 24,
and builds the Docker image. Run the three commands before pushing.

## Architecture

```
index.js                SDK instance, shutdown, connect()
src/app.js              every SDK handler (OAuth, actions, scenes, widgets, lifecycle)
src/config.js           DEFAULT_CONFIG (mirrors the manifest defaults), normalization, token keys
src/strava/client.js    Strava API v3: authorize URL, token exchange/refresh, activities (paged)
src/strava/auth.js      OAuth state, token storage via setConfig, refresh before expiry
src/strava/parse.js     SummaryActivity -> the few fields stored
src/fuel/client.js      fuel price open data: stations around home, nearest/cheapest
src/vehicle.js          fuels (CO2 factors, default prices), per-trip savings
src/stats.js            activities + price history -> trips, totals per period, 12 months (pure)
src/events.js           two readings -> scene events (pure)
src/format.js           texts, English and French
src/tracker.js          the loop: read Strava and fuel, compute, publish, fire events, pace
src/store.js            activities, price per day and previous reading, in /data
src/devices/savings.js  the two devices (features, states)
src/actions.js          Configuration buttons
src/scenes.js           scene action get_savings (reads the cache, never Strava)
src/widgets.js          widgets savings and recent_trips
test/fixtures/          Strava and open data answers — tests never touch the network
test/helpers/           fake fetch, the app wired to the SDK's fake Gladys
```

### External APIs

- **Strava** (`https://www.strava.com/api/v3`): `GET /athlete/activities?after=&page=&per_page=200`.
  Fields used: `id`, `name`, `sport_type` (or `type`), `distance` (m), `start_date`,
  `start_date_local` (local wall clock written with a `Z`), `commute`, `trainer`. Tokens:
  `POST /oauth/token` (`authorization_code`, `refresh_token`); access tokens live 6 h and
  the refresh token may rotate. Rate limit: 100 requests / 15 min, 1,000 / day per app.
- **Fuel prices** (`data.economie.gouv.fr`, dataset
  `prix-des-carburants-en-france-flux-instantane-v2`): ODSQL `where=within_distance(geom, geom'POINT(lon lat)', Rkm)`,
  `order_by=distance(...)`. Fields: `<fuel>_prix`, `<fuel>_maj`, `geom {lon, lat}`,
  `adresse`, `cp`, `ville`, with fuel in `gazole sp95 e10 sp98 e85 gplc`.

The fixtures were written from the published field lists, not recorded from the live
APIs: when a real answer differs, trim it into `test/fixtures/` and fix the parser.

### Invariants worth knowing

- **External ids and keys are forever.** Devices are `savings:me` and `fuel:home`.
  Trigger, action, widget, feature, config and fuel keys are stored by users: never
  rename them.
- **Every activity is stored, counted or not**: changing which ones count recomputes
  from the store, without reading Strava again.
- **A trip is valued at the price of its day** (`prices[fuel][YYYY-MM-DD]`), so a later
  price never rewrites the past.
- **Requests stay light**: the whole history once, then `after = latest start - 7 days`
  (catches late commute tags and deletions); fuel at most every 6 h or when its settings
  change.
- **One event per transition, the first reading is a baseline.** So is the first reading
  after a change of filters, vehicle or athlete. Only trips started within 7 days are
  announced, 10 at most per reading. `store.js` keeps the previous reading across
  restarts.
- **No event as a consequence of a scene action**: `get_savings` reads the cache.
- **An outage is not "nothing saved"**: totals and last price are kept, the badge
  changes.
- **Never log a token.** Tokens are config keys outside the `config_schema`
  (`strava_*`), written with `setConfig`.
- **Every feature declares `min`/`max`** (NOT NULL in Gladys), text features included.
- **The rootfs is read-only**: write only under `/data` (`DATA_DIR` overrides it).

## Rules

- **Versions belong to the Release workflow.** Never edit `version` in `package.json` or
  the manifest, nor the `docker_image` tag, by hand. `test/manifest.test.js` checks they
  agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]` in
  `CHANGELOG.md`. Never write a version heading: the Release workflow moves the section.
- **Manifest.** Texts are multi-language objects `{ "en", "fr" }`. The catalog
  `description` holds 10 to 100 characters per language. `test/manifest.test.js` ties the
  manifest to the code: change both sides together.
- **User-facing text** is `{ en, fr }`; `docs/en.md` and `docs/fr.md` stay in sync.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why, in English.
