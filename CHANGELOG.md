# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- The games to come: a "Next game" feature on each device, the next three
  games in the "Team game" widget, a "Next games" widget for every followed
  team, and the list in "Test the teams" — which also tells, when no game is
  to come, how many games were read and whether some dates were unreadable.

### Fixed

- The tip-off time is read from `horaire` when the FFBB keeps the date alone,
  postponed games are flagged, and a game whose club is not filled in is
  still recognized by the team entry.

## [0.1.2] - 2026-10-27

## [0.1.1] - 2026-10-27

### Added

- Follow French basketball teams written `COMPETITION:TEAM`: Betclic ELITE,
  ELITE 2, Nationale 1/2/3, LFB, LF2, women's Nationale 1/2/3, or any FFBB
  competition code. Data from the public FFBB API, no account needed.
- One device per team: team score, opponent score and a game status text
  (live period and clock, final result or next game), in French or English.
- Scene triggers: game starting soon, game started, my team scored, opponent
  scored, game ended. Scene action: get the game of a team.
- Dashboard widgets: one team's game, and all followed teams.
- Configuration buttons: test the teams, find a team of a competition.
- A competition the FFBB files under another code than expected is found by
  its name; when it is not found at all, "Find a team" lists the FFBB
  competitions of the season with the codes to write, and the search is
  retried after an hour instead of a day.

[Unreleased]: https://github.com/quentinlegay/gladys-ffbb/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/quentinlegay/gladys-ffbb/compare/v0.1.1...v0.1.2
