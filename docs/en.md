# FFBB Basket — documentation

Follow French basketball teams in Gladys: live score, next game, result, and
scenes that fire when your team plays, scores or wins.

The data comes from the public API of the French basketball federation
(FFBB), the one behind its official app. It covers the professional leagues
(Betclic ELITE, ELITE 2, LFB…) as well as the national championships
(Nationale 1, 2, 3…). No account, no API key.

> The FFBB does not document this API publicly: it can change without notice.
> The integration then keeps the last known game and shows it as unreachable
> rather than inventing a score.

## Configuration

1. Install the integration from the Gladys catalog.
2. In the **Teams** field, write the teams to follow as `COMPETITION:TEAM`,
   separated by commas, for example:

   ```
   ELITE:Monaco, ELITE2:Nancy, NM1:Saint-Quentin, LFB:Bourges
   ```

   The team is its name, a word of its name (accents and case ignored), its
   abbreviation, or its FFBB club id. When several teams match
   (`ELITE:Paris`), the integration asks you to be more precise.

3. Not sure of the name? The **Find a team** button lists the teams of a
   competition with the exact text to copy.
4. The **Test the teams** button reads the FFBB and tells, team by team, what
   is followed or why an entry is not.
5. Each team becomes a device in the **Discover** tab: create it.

| Setting                    | Default        | Purpose                                                 |
| -------------------------- | -------------- | ------------------------------------------------------- |
| Language of the game texts | French         | Language of the "Game" text of the devices and scenes.  |
| Time zone                  | `Europe/Paris` | Time zone the tip-off times are written in.             |
| Tip-off reminder           | 30 min         | Delay of the "Game starting soon" trigger (0 = off).    |
| Refresh during a game      | 30 s           | How often the live score is read.                       |
| Refresh between games      | 15 min         | How often the schedule is checked when nothing is live. |

## Competitions

> **Betclic ELITE and ELITE 2 are not available yet.** These championships are
> run by the LNB, and the FFBB only publishes their friendly games. Their
> teams cannot be followed yet: that needs an LNB data source.

| Code     | Competition                                 | Also accepted     |
| -------- | ------------------------------------------- | ----------------- |
| `ELITE`  | Betclic ELITE (formerly Pro A / Jeep ÉLITE) | `PROA`, `BETCLIC` |
| `ELITE2` | ELITE 2 (formerly Pro B)                    | `PROB`, `ELIT2`   |
| `NM1`    | Men's Nationale 1                           | `N1`              |
| `NM2`    | Men's Nationale 2                           | `N2`              |
| `NM3`    | Men's Nationale 3                           | `N3`              |
| `LFB`    | La Boulangère Wonderligue (LFB)             | `LF1`             |
| `LF2`    | Ligue Féminine 2                            |                   |
| `NF1`    | Women's Nationale 1                         |                   |
| `NF2`    | Women's Nationale 2                         |                   |
| `NF3`    | Women's Nationale 3                         |                   |

Any other FFBB competition can be followed by writing its FFBB code (letters
and digits) instead, e.g. `PNM:My Club`. The current season is picked
automatically: nothing to change from one season to the next.

## Devices

Each followed team is a device with four read-only features:

- **Score**: the team's points in the current (or last) game;
- **Opponent score**: the opponent's points;
- **Game**: one line of text, e.g. `Live · Q3 05:12 · MON 56 – 50 PLB`,
  `Final · MON 81 – 77 PLB · Win` or `Next · Sun 1 Nov, 20:00 · vs PLB`;
- **Next game**: the next game to come, even while a result is shown, e.g.
  `Sun 8 Nov, 20:00 · at ASV`.

Before a game the scores read 0: a condition "my team leads" does not stay
true on the score of the previous game.

## Scenes

Triggers, filterable by team and by home/away:

| Trigger            | When                                                 | Extra variables      |
| ------------------ | ---------------------------------------------------- | -------------------- |
| Game starting soon | The reminder delay before tip-off is reached.        | `kickoff`, `minutes` |
| Game started       | The game goes live.                                  |                      |
| My team scored     | The team's score went up since the previous reading. | `points`             |
| Opponent scored    | The opponent's score went up.                        | `points`             |
| Game ended         | The game is over (filterable by win/loss).           | `result`             |

All of them carry `team_name`, `opponent`, `home_away`, `competition`,
`team_score`, `opponent_score` and `summary`. Points come fast in
basketball: "scored" fires at most once per reading (every 30 s by default)
with the total of the points scored between two readings.

Scene action **Get the game of a team**: gives the following actions the
state (`pre`, `in`, `post`, `none`), the scores, the opponent, the tip-off,
the result and the summary of the current or next game.

## Widgets

- **Team game**: live score, period and clock, tip-off, opponent, the next
  three games, Refresh button.
- **My teams**: every followed team, live games first.
- **Next games**: the next games of every followed team, soonest first.

## How it works

- The teams and pools of each competition are read once a day; the games of
  the followed teams' pools at every reading; the FFBB live feed only when a
  followed team's game is about to start or under way.
- The live score comes from the FFBB live feed (competitions with an
  electronic score sheet and live statistics). Without a live feed, the
  device shows "Result pending" until the FFBB enters the final score.
- Times are the ones the FFBB enters (Paris time). A game whose time is not
  set yet shows "time TBD" and fires no reminder.

## Troubleshooting

- **"no such team in this competition"**: use **Find a team** and copy the
  suggested line.
- **"several teams match"**: write the full name suggested.
- **"competition not found at the FFBB this season"**: the integration
  looked for it by code, then by name, without success. The **Find a team**
  button then lists the FFBB competitions of the season with their codes:
  write that code instead of ours, e.g. `CODE:Paris`.
- **Device unreachable**: the FFBB does not answer; the last known game is
  kept and reading resumes on its own.
