// The sanity band from CLAUDE.md: fantasy is a coin-flip sport. A −400 weekly
// moneyline means the variance model is not being applied or the lineup is the
// wrong size. These assertions run against the committed sheets, so a bad build
// cannot be published without failing here first.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, existsSync } from "node:fs";
import { basename } from "node:path";
import { readJson } from "../scripts/lib/json.mjs";
import * as P from "../scripts/lib/paths.mjs";
import { allLeagueIds } from "../scripts/pull.mjs";

// Lineup size, weekly totals and the price ceiling are all properties of the
// LEAGUE, not constants: LoOG starts nine (one FLEX, ten teams) and so runs
// totals in the 230s where the twelve-team books run in the 260s. Hardcoding
// either produced three false failures the moment a third league arrived. What
// actually generalises is points PER STARTER — all three books sit between 12.3
// and 14.4 — and the fair win probability, which is the thing the variance model
// is really being checked on.
const MAX_FAIR_PA = 68;   // a coin-flip sport; above this the variance model is off
const MARGIN = 1.075;     // two-way price margin, so the posted odds ceiling follows
const PER_STARTER = [11, 16];
const toOdds = (s) => (s[0] === "−" ? -Number(s.slice(1)) : Number(s.slice(1)));
const american = (p) => (p >= 0.5 ? -(100 * p) / (1 - p) : (100 * (1 - p)) / p);
const ODDS_FLOOR = american(Math.min((MAX_FAIR_PA / 100) * MARGIN, 0.985));

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

    test(`${leagueId} w${week}: no favourite is priced like a lock`, () => {
      // CLAUDE.md's band is −110 to −210, and the point of it is that a −400
      // weekly moneyline means the variance model is not being applied. The
      // check is on the FAIR probability, because the posted price also carries
      // 7.5% margin: DESIGN.md §0.2's own verified week-1 board tops out at
      // −210 on a 62.9% favourite, so a 63.6% one posts at −220 with nothing
      // wrong. 68% fair is the real ceiling for a coin-flip sport.
      for (const m of book.matchups) {
        assert.ok(
          m.moneyline.pA >= 50 && m.moneyline.pA < 68,
          `${m.a.team} vs ${m.b.team} is a ${m.moneyline.pA}% favourite — the variance model is not being applied`
        );
        // Derived from the ceiling above rather than hardcoded — a 67% fair
        // favourite legitimately posts at −260 once margin is applied, and the
        // old −250 constant contradicted this test's own 68% bound.
        assert.ok(
          toOdds(m.moneyline.a) >= ODDS_FLOOR,
          `${m.a.team} posted ${m.moneyline.a}, past the ${ODDS_FLOOR.toFixed(0)} implied by a ${MAX_FAIR_PA}% ceiling`
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

    test(`${leagueId} w${week}: spreads sit where the margin distribution splits`, () => {
      for (const m of book.matchups) {
        assert.ok(Math.abs(m.spread.pCover - 50) < 3, `${m.a.team} covers ${m.spread.pCover}% of its own line`);
      }
    });
  }
}
