# Eco Bike

Every trip ridden instead of driven saves CO₂ and money. This integration reads your
activities on **Strava**, compares each kilometre with **the car you would have taken**,
and values it at the **fuel price of the station nearest to your home**.

## What you get

- An **Eco Bike** device: CO₂ avoided (kg), money saved (€) and distance (km) in total,
  this year and this month, the number of trips and the last trip.
- A **Fuel price** device: the price the trips are valued at, and the station it comes
  from.
- Two scene triggers: **Eco trip recorded** (one event per new trip) and **CO₂
  milestone** (every 50 kg avoided by default).
- A scene action, **Get the savings**, for a period (total, year, month, week): send
  yourself a weekly summary, for example.
- Two dashboard widgets: **Eco Bike savings** (totals and the last 12 months) and
  **Recent eco trips**.

## Create a Strava application

Strava has no shared application for self-hosted software: each user creates their
own, for free, in two minutes.

1. Open [strava.com/settings/api](https://www.strava.com/settings/api), signed in to
   your Strava account.
2. Fill in the form: any name ("Gladys"), any website, and in **Authorization Callback
   Domain** the domain of the address you use to open Gladys (for example
   `gladys.example.com`, or `localhost` if Gladys is opened on this computer). If you
   use Gladys Plus, it is the Gladys Plus domain. If Strava answers
   "redirect_uri invalid" when you connect, the domain to write is shown, after that first attempt, by the
   **Test** button of the integration and in its logs.
3. Copy the **Client ID** and the **Client Secret** into the configuration of the
   integration, and save.
4. Click **Connect** and accept on Strava's page. The integration asks to read your
   activities, private ones included (commutes often are).

## Which trips count

A trip counts when it replaced a car journey:

- **Activities counted**: by default only those tagged **Commute** in Strava (a
  checkbox in the activity, which can also be ticked by default for a bike in your gear
  settings). Choose **Every activity** to count all your rides.
- **Sports**: bike (e-bike included), or bike, walk and run.
- **Count from**: a start date (YYYY-MM-DD), or empty for the whole Strava history.

Home trainer and virtual rides never count. Changing these settings recomputes the
totals at once, without reading Strava again.

## The compared vehicle

- **Energy**: diesel, unleaded 95, E10, 98, E85, LPG or electric.
- **Consumption**: litres per 100 km (kWh per 100 km for an electric car).
- **CO₂ per km**: leave 0 to estimate it from the consumption with well-to-wheel ADEME
  factors (diesel 3.16 kg/L, petrol 2.80 kg/L, E10 2.70, E85 1.50, LPG 1.86, French
  electricity 0.052 kg/kWh), or write the figure of your car.
- **Other costs per km**: wear, tyres, servicing, parking… added for each kilometre
  (0: fuel only). The French tax mileage scale gives an idea of the full cost of a car.

## The fuel price

The integration reads the prices declared by the stations (French government open data,
[prix-carburants.gouv.fr](https://www.prix-carburants.gouv.fr)) around the house located
in Gladys (Settings → Houses), every 6 hours:

- **Station**: the nearest one selling your fuel, or the cheapest within the **search
  radius**.
- Each trip is valued at the price of **its day**: a later price change does not rewrite
  what a past trip saved. Trips older than the first price read use that first price.
- **Fixed price**: when set, it is used instead of the stations. Use it abroad (the
  open data covers France only) and for an electric car (your price per kWh). With an
  electric car and no fixed price, 0.20 €/kWh is used.

Without a located house or a station within the radius, an average French price is
used and the **Station** text says so.

## Requests and privacy

- Strava: the whole history once (pages of 200 activities), then only the last week at
  every reading (every 60 minutes by default). Strava allows 100 requests per 15 minutes
  per application: one reading uses one or two.
- Fuel prices: one request every 6 hours.
- Only the id, name, sport, distance, date and commute tag of each activity are kept,
  in the integration's own volume. Nothing is sent anywhere else.

## Buttons

- **Test**: reads Strava and the fuel price now and shows what is counted.
- **Read the whole history again**: needed only after editing activities older than a
  week on Strava (the regular readings re-read the last 7 days).

## Scenes

**Eco trip recorded** provides `name`, `sport`, `date`, `distance_km`, `co2_kg`,
`money` and the totals `total_co2_kg`, `total_money`, `total_distance_km`. A trip is
announced when it appears within 7 days of its start; the first reading after Connect,
or after a change of settings, announces nothing.

**CO₂ milestone** provides `milestone_kg`, the totals and `trips`.

**Get the savings** returns `co2_kg`, `money`, `distance_km`, `trips`, `fuel_price` and
a ready-made `summary` sentence.

## Troubleshooting

- _Strava is not connected_: fill in the client ID and secret, save, then click
  Connect.
- _redirect_uri invalid_ on Strava's page: the Authorization Callback Domain of your
  Strava application is not the domain of Gladys (see above).
- _No trip counted_: tag your trips as Commute in Strava, or choose Every activity.
