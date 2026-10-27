# FFBB Basket — Gladys Assistant integration

External integration for [Gladys Assistant](https://gladysassistant.com) that
follows **French basketball teams**: Betclic ELITE (ex-Pro A), ELITE 2
(ex-Pro B), Nationale 1/2/3, LFB, LF2, women's Nationale… Live score, next
game, results, scene triggers and dashboard widgets.

Data comes from the public API of the French basketball federation (FFBB),
the one behind its official app: no account, no API key.

- User documentation: [English](docs/en.md) · [Français](docs/fr.md)
- Built from the official
  [JavaScript template](https://github.com/GladysAssistant/integration-template-js),
  on the model of [gladys-teamtracker](https://github.com/prohand/gladys-teamtracker)
  (which follows teams through ESPN, without the French leagues).

## What it does

The user writes `COMPETITION:TEAM` entries (`ELITE:Monaco, NM1:Saint-Quentin`).
Each team becomes a device:

| Feature          | Type                     | Content                                       |
| ---------------- | ------------------------ | --------------------------------------------- |
| `team-score`     | counter sensor (integer) | the team's points in the current or last game |
| `opponent-score` | counter sensor (integer) | the opponent's points                         |
| `status`         | text                     | `En direct · Q3 05:12 · MON 56 – 50 PLB`      |
| `next-match`     | text                     | `dim. 8 nov., 20:00 · à ASV`                  |

On top of the devices (Gladys ≥ 5.3.0):

| Capability     | Keys                                                                           |
| -------------- | ------------------------------------------------------------------------------ |
| Scene triggers | `match_soon`, `match_started`, `team_scored`, `opponent_scored`, `match_ended` |
| Scene action   | `get_match`                                                                    |
| Widgets        | `team_match`, `my_teams`, `upcoming_matches`                                   |
| Config buttons | `test_teams`, `find_team`                                                      |

## Data source

The FFBB app talks to a Directus server at `https://api.ffbb.app/`:

| Endpoint                                     | Used for                                       |
| -------------------------------------------- | ---------------------------------------------- |
| `items/configuration`                        | public: hands out the read token               |
| `items/ffbbserver_competitions?filter[code]` | the competition of the season, its pools       |
| `items/ffbbserver_poules/<id>`               | every game of a pool: teams, date, final score |
| `json/lives.json`                            | games being played: live score, period, clock  |

The API is undocumented and may change: the integration keeps the last known
game on any error and flags the device `unreachable`. Requests stay light:
the competition once a day, the followed teams' pools at every reading (every
15 min by default, 30 s during a game), the live feed only around a followed
game.

## Development

```bash
npm install
npm test                 # node --test, never touches the network
npm run lint
npm run format:check
```

Run against a Gladys instance:

```bash
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="gladys-ffbb" \
DATA_DIR=./data LOG_LEVEL=debug \
npm start
```

See [CLAUDE.md](CLAUDE.md) for the architecture and the project rules.

## Publish

1. Add the GitHub topic `gladys-assistant-integration` to the repository.
2. Describe the changes under `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md).
3. **Actions → Release → Run workflow** (`patch`, `minor` or `major`): it bumps
   the versions, tags, builds the multi-arch image to
   `ghcr.io/quentinlegay/gladys-ffbb` and publishes the GitHub Release.
4. Check with the store validator: `npx github:GladysAssistant/integration-store .`

Replace `cover.png` (still the template placeholder) with your own
800×534 px image (≤ 150 KB) before publishing.

## License

Apache-2.0. Not affiliated with the FFBB or the LNB.
