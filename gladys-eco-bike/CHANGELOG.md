# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- First version, from the official JavaScript template.
- Strava connection through Gladys (OAuth2, your own Strava API application):
  the whole history is read once, then the last week at every reading.
- Trips counted: activities tagged "Commute" (or every activity), bike only or
  bike, walk and run, from an optional start date. Home trainer sessions never
  count.
- Compared vehicle: energy (diesel, petrol, E85, LPG or electric), consumption,
  CO₂ per km (estimated from ADEME factors when left at 0) and other costs per
  km.
- Fuel price of the station nearest to the house located in Gladys (or the
  cheapest within a radius), from the French government open data, read every
  6 hours; each trip is valued at the price of its day. A fixed price can be
  set instead (abroad, electric car).
- Devices: "Eco Bike" (CO₂ avoided, money saved and distance in total, this
  year and this month, trips, last trip) and "Fuel price" (price and station).
- Scene triggers "Eco trip recorded" and "CO₂ milestone", scene action "Get
  the savings", widgets "Eco Bike savings" and "Recent eco trips".
- Configuration buttons "Test" and "Read the whole history again".

[Unreleased]: https://github.com/quentinlegay/gladys-eco-bike/commits/main
