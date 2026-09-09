// Season futures have their own failure mode, and it is not the weekly one.
// Fourteen weeks of Gamma draws around a FIXED mean makes the best roster a
// near-certainty before a snap is played — the first build of this board priced
// "make the playoffs" at −1300 in week 1, in a league where six of twelve make
// it. The season multiplier from config/season-variance.json is what fixes that,
// and these assertions are what stop it being removed or misapplied.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, existsSync } from "node:fs";
import { basename } from "node:path";
import { readJson } from "../scripts/lib/json.mjs";
import * as P from "../scripts/lib/paths.mjs";
import { allLeagueIds } from "../scripts/pull.mjs";

const weeksOf = (id) =>
  existsSync(P.bookDir(id))
    ? readdirSync(P.bookDir(id))
        .filter((f) => /^w\d+\.json$/.test(f))
        .map((f) => Number(basename(f, ".json").slice(1)))
    : [];

for (const leagueId of allLeagueIds()) {
  for (const week of weeksOf(leagueId)) {
    const book = readJson(P.bookFile(leagueId, week));
    const market = (key) => book.futures.markets.find((m) => m.key === key);
    const seats = book.lineups.length;

    test(`${leagueId} w${week}: every futures market is a complete, coherent field`, () => {
      for (const m of book.futures.markets) {
        assert.equal(m.rows.length, seats, `${m.name} prices ${m.rows.length} of ${seats} seats`);
        const total = m.rows.reduce((sum, r) => sum + r.pct, 0);
        const expected = m.key === "top2" ? 200 : m.key === "top3" ? 300 : m.key === "playoffs" ? 600 : m.key === "bye" ? 200 : 100;
        assert.ok(Math.abs(total - expected) < 1, `${m.name} probabilities sum to ${total}%, expected ${expected}%`);
      }
    });

    test(`${leagueId} w${week}: nobody is a lock to make the playoffs in week ${week}`, () => {
      // 6 of 12 make it. A preseason favourite belongs in the 55-75% range; the
      // model that produced 96% was treating a projection as fact for 14 weeks.
      // Lives on the standings table now that the playoffs ladder was folded in
      // — it was the same ranking as the championship board (rho 0.97).
      const odds = book.futures.standings.map((r) => r.playoffs).sort((a, b) => b - a);
      assert.ok(odds[0] < 85, `favourite is ${odds[0]}% to make the playoffs`);
      assert.ok(odds.at(-1) > 10, `longshot is ${odds.at(-1)}% to make the playoffs`);
    });

    test(`${leagueId} w${week}: the title board is a twelve-horse race`, () => {
      const rows = market("championship").rows;
      assert.ok(rows[0].pct < 25, `favourite is ${rows[0].pct}% to win it — too confident for week ${week}`);
      assert.ok(rows.at(-1).pct > 1, `longshot is ${rows.at(-1).pct}% — effectively off the board`);
    });

    test(`${leagueId} w${week}: expected wins average out over the schedule`, () => {
      // Every game has exactly one win in it, so the mean must be half the
      // remaining schedule plus what is already banked. A drift here means the
      // schedule pairings or the tie rule are wrong.
      const mean = book.futures.winTotals.reduce((s, w) => s + w.expected, 0) / seats;
      const games = book.meta.throughWeek - week + 1;
      assert.ok(Math.abs(mean - games / 2) < 0.15, `mean expected wins ${mean} over ${games} games`);
    });

    test(`${leagueId} w${week}: rest-of-season lineups project a plausible week`, () => {
      // The guard for the `gp` trap: DEF rows in Sleeper's season projection
      // report gp:1 against the skill positions' 18, so a per-row divisor makes
      // every defence worth ~95 points a week and every team ~210.
      for (const seat of book.futures.winTotals) {
        assert.ok(seat.expected >= 0 && seat.expected <= book.meta.throughWeek, `${seat.team} expects ${seat.expected} wins`);
      }
      for (const seat of book.restOfSeason) {
        assert.ok(
          seat.projected > 90 && seat.projected < 170,
          `${seat.team} projects ${seat.projected} in a typical week — outside a believable full-PPR range`
        );
      }
    });

    test(`${leagueId} w${week}: every seat's finish distribution is a distribution`, () => {
      for (const row of book.futures.standings) {
        const total = row.dist.reduce((a, b) => a + b, 0);
        assert.ok(Math.abs(total - 100) < 0.6, `${row.team} finish probabilities sum to ${total}%`);
        assert.equal(row.dist.length, seats, `${row.team} has ${row.dist.length} possible finishes, expected ${seats}`);
      }
    });

    test(`${leagueId} w${week}: projected finish is consistent with the distribution`, () => {
      // PROJ is the mean of the distribution. If they disagree the table is
      // showing two different seasons in one row.
      for (const row of book.futures.standings) {
        const mean = row.dist.reduce((sum, p, i) => sum + (p / 100) * (i + 1), 0);
        assert.ok(Math.abs(mean - row.projFinish) < 0.15, `${row.team}: PROJ ${row.projFinish} vs distribution mean ${mean.toFixed(2)}`);
      }
      const order = book.futures.standings.map((r) => r.projFinish);
      assert.deepEqual(order, [...order].sort((a, b) => a - b), "standings are not sorted by projected finish");
    });

    test(`${leagueId} w${week}: the money column matches the paying places`, () => {
      const paying = book.futures.payingPlaces;
      for (const row of book.futures.standings) {
        assert.equal(row.money.length, paying.length, `${row.team} has ${row.money.length} money rows for ${paying.length} paying places`);
        const fromDist = paying.reduce((t, place) => t + row.dist[place - 1], 0);
        const fromMoney = row.money.reduce((t, m) => t + m.pct, 0);
        assert.ok(Math.abs(fromDist - fromMoney) < 0.3, `${row.team}: money ${fromMoney}% vs distribution ${fromDist}%`);
      }
    });
  }
}
