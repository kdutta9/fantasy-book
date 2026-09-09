#!/usr/bin/env node
// THE CROSSOVER (DESIGN.md §6.7). Six managers hold a seat in both leagues, and
// "kdutta wins in both this week" or "the same manager is low scorer in both" —
// karaoke AND the parlay window in one weekend — is the best material either
// league has. It cannot live on a league sheet without breaking §6.6, so it gets
// its own surface built by a third pass.
//
// This pass reads ONLY the committed league sheets and config/cross-league.json.
// It runs no simulation and touches no league's inputs, so the dependency is
// explicit, one-directional, and covered by check-frozen for free.

import { readJson, readJsonIf, writeJson } from "./lib/json.mjs";
import { addWeek, registerBook } from "./lib/book-index.mjs";
import * as P from "./lib/paths.mjs";
import { MARGIN, price } from "./lib/pricing.mjs";
import { option } from "./lib/args.mjs";

const pct = (x) => Math.round(x * 1000) / 10;
const both = (a, b) => (a / 100) * (b / 100);

export function buildCrossover({ week }) {
  const { sharedManagers } = readJson(P.configPath("cross-league.json"));
  const leagueIds = [...new Set(sharedManagers.flatMap((m) => Object.keys(m).filter((k) => k.endsWith("RosterId")).map((k) => k.replace("RosterId", ""))))];

  const sheets = {};
  for (const id of leagueIds) {
    const sheet = readJsonIf(P.bookFile(id, week));
    if (!sheet) return null; // a missing league sheet skips the week, never blocks one
    sheets[id] = sheet;
  }

  const seatOf = (leagueId, rosterId) => sheets[leagueId].crossover.find((s) => s.rosterId === rosterId);

  const managers = sharedManagers
    .map((m) => {
      const seats = leagueIds.map((id) => ({ league: id, seat: seatOf(id, m[`${id}RosterId`]) }));
      if (seats.some((s) => !s.seat)) return null;
      return { manager: m.manager, seats: seats.map((s) => ({ league: s.league, ...s.seat })) };
    })
    .filter(Boolean);

  const slip = (label, copy, p) => ({ label, copy, pct: pct(p), price: price(p, MARGIN.twoWay) });

  return {
    id: "crossover",
    week,
    season: sheets[leagueIds[0]].season,
    bookName: "THE CROSSOVER",
    tagline: `${managers.length} managers, two leagues, one weekend`,
    leagues: leagueIds.map((id) => ({ id, bookName: sheets[id].bookName, displayName: sheets[id].displayName })),
    meta: {
      sources: "THE TWO COMMITTED LEAGUE SHEETS",
      sims: sheets[leagueIds[0]].meta.sims,
      pulledAt: sheets[leagueIds[0]].meta.pulledAt,
      disclosures: [
        "Built from each league's own posted probabilities, multiplied. The two leagues are treated as independent.",
        "A manager who rosters the same player in both leagues is more correlated than that — these prices are conservative on the doubles and long on the splits.",
        ...sheets[leagueIds[0]].meta.disclosures,
      ],
    },
    managers: managers.map((m) => ({
      manager: m.manager,
      seats: m.seats,
      slips: [
        slip("Wins in both", "Sweeps the weekend.", both(m.seats[0].pWin ?? 0, m.seats[1].pWin ?? 0)),
        slip("Loses both", "Swept.", both(100 - (m.seats[0].pWin ?? 0), 100 - (m.seats[1].pWin ?? 0))),
        slip(
          "Low scorer in BOTH",
          "Karaoke at Silver Clouds and the eleven-leg parlay, same weekend.",
          both(m.seats[0].pLow, m.seats[1].pLow)
        ),
        slip("High scorer in BOTH", "Picks the song and watches the parlay.", both(m.seats[0].pHigh, m.seats[1].pHigh)),
      ],
    })),
    // The headline: it does not matter which of the six it is, only that one of
    // them draws both punishments. 1 − ∏(1 − p) over the shared managers.
    headline: (() => {
      const p = 1 - managers.reduce((acc, m) => acc * (1 - both(m.seats[0].pLow, m.seats[1].pLow)), 1);
      return slip(
        "ANY shared manager is low scorer in both leagues",
        "Someone sings for their supper and files an eleven-leg parlay in the same weekend.",
        p
      );
    })(),
  };
}

export function writeCrossover(crossover) {
  const path = writeJson(P.bookFile("crossover", crossover.week), crossover);
  addWeek("crossover", crossover.week);
  registerBook({ id: "crossover", name: "The Crossover", bookName: crossover.bookName, kind: "crossover" });
  return path;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const week = Number(option("--week", readJson(P.statePath).week));
  const crossover = buildCrossover({ week });
  console.log(crossover ? `Wrote ${writeCrossover(crossover)}` : `Skipped week ${week} — a league sheet is missing.`);
}
