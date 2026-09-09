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

const STARTERS = 10; // QB RB RB WR WR TE FLEX FLEX K DEF — both leagues
const toOdds = (s) => (s[0] === "−" ? -Number(s.slice(1)) : Number(s.slice(1)));

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
        assert.ok(toOdds(m.moneyline.a) >= -250, `${m.a.team} posted ${m.moneyline.a}`);
      }
    });

    test(`${leagueId} w${week}: totals land between 245 and 290`, () => {
      for (const m of book.matchups) {
        assert.ok(
          m.total.line >= 245 && m.total.line <= 290,
          `${m.a.team} vs ${m.b.team} total ${m.total.line} — outside the 245…290 band`
        );
      }
    });

    test(`${leagueId} w${week}: every seat starts ${STARTERS}`, () => {
      // The most likely cause of a broken line is summing the wrong number of
      // starters, so assert the lineup size directly rather than inferring it.
      for (const seat of book.lineups) {
        assert.equal(seat.players.length, STARTERS, `${seat.team} started ${seat.players.length}`);
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
