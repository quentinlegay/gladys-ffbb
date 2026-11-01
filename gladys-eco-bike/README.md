# Eco Bike for Gladys Assistant

A [Gladys Assistant](https://gladysassistant.com) external integration that shows the
**CO₂ avoided** and the **money saved** by riding instead of driving:

- your trips come from **Strava** (activities tagged _Commute_, or all of them);
- each kilometre is compared with **your car** (energy, consumption, CO₂ per km, other
  costs);
- and valued at the **fuel price of the station nearest to your home** (French
  government open data), at the price of the trip's day.

It publishes an **Eco Bike** device (CO₂, money, distance and trips: total, year,
month), a **Fuel price** device, two scene triggers (_Eco trip recorded_, _CO₂
milestone_), a scene action (_Get the savings_) and two dashboard widgets.

Gladys 5.3 or later. User documentation: [English](docs/en.md) · [Français](docs/fr.md).

## Setup in short

1. Create your Strava API application at
   [strava.com/settings/api](https://www.strava.com/settings/api), with the domain of
   your Gladys as _Authorization Callback Domain_.
2. Paste its client ID and secret in the configuration of the integration, save, click
   **Connect**.
3. Describe your car, locate your house in Gladys (for the fuel stations), and create
   the devices from the Discover tab.

## Development

Built from the official
[JavaScript template](https://github.com/GladysAssistant/integration-template-js):
Node 22+, ESM, no build step, one runtime dependency
(`@gladysassistant/integration-sdk`).

```bash
npm install
npm test
npm run lint
npm run format:check
npx github:GladysAssistant/integration-store .
```

Releases are cut from GitHub: Actions → Release → Run workflow. See
[CLAUDE.md](CLAUDE.md) for the architecture and the rules.

## License

Apache-2.0
