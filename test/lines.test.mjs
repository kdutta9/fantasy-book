// The sanity band from CLAUDE.md: fantasy is a coin-flip sport, and a −400
// weekly moneyline means the variance model is not being applied or the lineup
// is the wrong size. These assertions run against the committed sheets, so a bad
// build cannot be published without failing here first.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, existsSync } from "node:fs";
import { basename } from "node:path";
import { readJson } from "../scripts/lib/json.mjs";
import * as P from "../scripts/lib/paths.mjs";
import { allLeagueIds } from "../scripts/pull.mjs";
import { sigmaFor } from "../scripts/engine.mjs";

// Lineup size, weekly totals and the price ceiling are all properties of the
// LEAGUE, not constants: LoOG starts nine (one FLEX, ten teams) and so runs
// totals in the 230s where the twelve-team books run in the 260s. Hardcoding
// either produced three false failures the moment a third league arrived. What
// actually generalises is points PER STARTER — all three books sit between 12.3
// and 14.4.
const PER_STARTER = [11, 16];

// The price ceiling used to be a constant too, and it broke for the same reason
// in week 2: 68% fair was measured off week 1, where no matchup was genuinely
// lopsided, and DKEnasty then produced a real 24-point projected mismatch that
// priced at 76.7%. Both lineups were verified optimal, bench included.
//
// So this checks the thing the ceiling was only ever a proxy for. Every price on
// the sheet is a sum of ~10 independent draws on each side, which the CLT makes
// very nearly Normal, so the sim's own win probability must agree with the
// closed form computed from the sheet's projections and config/variance.json. A
// dropped variance file, an unapplied sigma or a mis-summed lineup moves the two
// apart immediately; a legitimately one-sided week moves them together.
const SIM_VS_CLOSED_FORM = 3; // points of probability
const ABSURD_PA = 90;         // a backstop, not a band — nothing in this sport is a lock

// Abramowitz & Stegun 7.1.26. Accurate to 1.5e-7, which is four orders of
// magnitude tighter than the tolerance above.
function normalCdf(z) {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  return 0.5 * (1 + sign * (1 - poly * Math.exp(-x * x)));
}

// The sheet prints every input this needs: each seat's optimal lineup, each
// player's mu and position. Nothing here re-derives a projection.
const teamSigma = (variance, seat) =>
  Math.sqrt(seat.players.reduce((sum, p) => (p.name ? sum + sigmaFor(variance, p.position, p.mu) ** 2 : sum), 0));

const weeksOf = (id) =>
  existsSync(P.bookDir(id))
    ? readdirSync(P.bookDir(id))
        .filter((f) => /^w\d+\.json$/.test(f))
        .map((f) => Number(basename(f, ".json").slice(1)))
    : [];

for (const leagueId of allLeagueIds()) {
  const weeks = weeksOf(leagueId);
  test(`${leagueId}: has at least one committed sheet`, () => assert.ok(weeks.length > 0));

  for (const week of weeks) {
    const book = readJson(P.bookFile(leagueId, week));

    test(`${leagueId} w${week}: every price is the one its own variance implies`, () => {
      const variance = readJson(P.configPath("variance.json"));
      const sigmaOf = new Map(book.lineups.map((seat) => [seat.rosterId, teamSigma(variance, seat)]));
      for (const m of book.matchups) {
        const gap = m.projected.a - m.projected.b;
        const sigma = Math.hypot(sigmaOf.get(m.a.rosterId), sigmaOf.get(m.b.rosterId));
        const closed = normalCdf(gap / sigma) * 100;
        assert.ok(
          Math.abs(m.moneyline.pA - closed) < SIM_VS_CLOSED_FORM,
          `${m.a.team} vs ${m.b.team}: sim says ${m.moneyline.pA}%, a ${gap.toFixed(1)}-point edge over sigma ${sigma.toFixed(1)} says ${closed.toFixed(1)}% — the variance model is not being applied as priced`
        );
        // The sheet always prints the favourite as side A, so this also asserts
        // the board is oriented the way every other panel assumes.
        assert.ok(
          m.moneyline.pA >= 50 && m.moneyline.pA < ABSURD_PA,
          `${m.a.team} vs ${m.b.team} is a ${m.moneyline.pA}% favourite`
        );
      }
    });

    const starters = book.lineups[0].players.length;

    test(`${leagueId} w${week}: totals imply a plausible score per starter`, () => {
      for (const m of book.matchups) {
        const perStarter = m.total.line / (2 * starters);
        assert.ok(
          perStarter >= PER_STARTER[0] && perStarter <= PER_STARTER[1],
          `${m.a.team} vs ${m.b.team} total ${m.total.line} is ${perStarter.toFixed(2)}/starter over ${starters} starters`
        );
      }
    });

    test(`${leagueId} w${week}: every seat starts the same lineup the league does`, () => {
      // Summing the wrong number of starters is the likeliest cause of a broken
      // line, so assert against the league's own roster_positions rather than a
      // constant that only described the first two leagues.
      const expected = readJson(P.leagueWeekFile(leagueId, week)).league.roster_positions.filter(
        (slot) => !["BN", "IR", "TAXI"].includes(slot)
      ).length;
      for (const seat of book.lineups) {
        assert.equal(seat.players.length, expected, `${seat.team} started ${seat.players.length} of ${expected}`);
      }
    });

    test(`${leagueId} w${week}: the punishment market is a complete field`, () => {
      const rows = book.punishment.weekly.rows;
      assert.equal(rows.length, book.lineups.length, "every seat must be a runner for low scorer");
      const total = rows.reduce((sum, r) => sum + r.pct, 0);
      assert.ok(Math.abs(total - 100) < 0.5, `low-scorer probabilities sum to ${total}%`);
    });

    if (readJson(P.bookFile(leagueId, week)).settled) {
      test(`${leagueId} w${week}: nobody outscores their own best available lineup`, () => {
        // A negative "points left on the bench" is arithmetically impossible and
        // means the pool the optimum was taken over is smaller than the lineup
        // that was actually played — which is what a mid-week waiver pickup did
        // the first time this board ran.
        for (const row of book.settled.bench) {
          assert.ok(
            row.left >= 0,
            `${row.team} scored ${row.points} against a "best available" of ${row.best} — the bench pool is missing a player who started`
          );
        }
      });
    }

    test(`${leagueId} w${week}: spreads sit where the margin distribution splits`, () => {
      for (const m of book.matchups) {
        assert.ok(Math.abs(m.spread.pCover - 50) < 3, `${m.a.team} covers ${m.spread.pCover}% of its own line`);
      }
    });
  }
}
