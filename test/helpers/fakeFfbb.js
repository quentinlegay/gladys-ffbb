// -----------------------------------------------------------------------------
// In-memory FFBB client for the tracker tests: the same three methods as
// src/ffbb/client.js, answering from fixtures the test can edit, and the log
// of the calls (`calls`) so a test can count the requests.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

export function fixture(name) {
  return JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8'));
}

const clone = (value) => JSON.parse(JSON.stringify(value));

export function createFakeFfbb() {
  const elitePoule = fixture('elite-poule').data;
  return {
    calls: [],
    /** FFBB code -> competitions, as the API returns them (every season). */
    competitionsByCode: { ELITE: fixture('elite-competitions').data },
    /** pool id -> pool with its games. */
    poules: { [String(elitePoule.id)]: elitePoule },
    /** Competitions only found by name (any code). */
    otherCompetitions: [],
    liveGames: [],
    /** Set to make every call fail, like an outage. */
    down: false,

    async competitions(codes) {
      this.calls.push(`competitions ${codes.join(',')}`);
      if (this.down) throw new Error('FFBB unreachable: test outage');
      return clone(codes.flatMap((code) => this.competitionsByCode[code] ?? []));
    },

    /** Every competition known to the fake whose name contains `term`. */
    async searchCompetitions(term) {
      this.calls.push(`search ${term}`);
      if (this.down) throw new Error('FFBB unreachable: test outage');
      const all = [...Object.values(this.competitionsByCode).flat(), ...this.otherCompetitions];
      return clone(all.filter((c) => c.nom.toLowerCase().includes(term.toLowerCase())));
    },

    async poule(id) {
      this.calls.push(`poule ${id}`);
      if (this.down) throw new Error('FFBB unreachable: test outage');
      const poule = this.poules[String(id)];
      if (!poule) throw new Error('FFBB HTTP 404');
      return clone(poule);
    },

    async lives() {
      this.calls.push('lives');
      if (this.down) throw new Error('FFBB unreachable: test outage');
      return clone(this.liveGames);
    },

    /** A game of the ELITE pool, by its rencontre id, to edit in place. */
    game(id) {
      return this.poules[String(elitePoule.id)].rencontres.find((r) => String(r.id) === String(id));
    },
  };
}
