// §6.6, the hard invariant: no league's sheet may read another league's data.
// This is not stylistic. If a DKEnasty waiver claim could move a price on Nick's
// sheet, a sheet stops being reproducible from its own league's log, check-frozen
// has to reason about two event streams at once, and build order becomes
// load-bearing in a way nobody will remember in week 11.
//
// The test enforces it the only way that survives refactoring: build a league
// with every other league's committed inputs made unreadable, and require the
// bytes to come out identical.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync } from "node:fs";
import { readJson, serialize } from "../scripts/lib/json.mjs";
import * as P from "../scripts/lib/paths.mjs";
import { buildBook } from "../scripts/build-book.mjs";
import { allLeagueIds } from "../scripts/pull.mjs";

const state = readJson(P.statePath);
const leagues = allLeagueIds();

for (const leagueId of leagues) {
  test(`${leagueId} w${state.week} builds with every other league's data unreadable`, () => {
    const others = leagues.filter((id) => id !== leagueId).map((id) => P.leagueWeekFile(id, state.week)).filter((f) => existsSync(f));
    const before = serialize(buildBook({ leagueId, week: state.week }));
    others.forEach((f) => chmodSync(f, 0o000));
    try {
      assert.equal(serialize(buildBook({ leagueId, week: state.week })), before);
    } finally {
      others.forEach((f) => chmodSync(f, 0o644));
    }
  });
}

test("a failing league does not stop the others from being publishable", () => {
  // refresh.mjs builds each league in its own try. The unit under test here is
  // the promise that a build throws rather than corrupting a neighbour: ask for
  // a week that was never pulled and confirm it fails loudly and locally.
  assert.throws(() => buildBook({ leagueId: leagues[0], week: 99 }));
  for (const leagueId of leagues) assert.ok(buildBook({ leagueId, week: state.week }).matchups.length > 0);
});
