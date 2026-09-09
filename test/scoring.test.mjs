// The scoring dot product must reproduce Sleeper's own pts_ppr. This is the
// regression test CLAUDE.md trap 1 asks for, not a one-time check: iterating the
// projection's stat keys instead of the league's scoring_settings multiplies ~40
// keys that have no scoring rule (`pts_allow: 16.0`, `rec_tgt`, `cmp_pct`…) and
// this is what catches it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readJson } from "../scripts/lib/json.mjs";
import * as P from "../scripts/lib/paths.mjs";
import { projectedPoints } from "../scripts/engine.mjs";
import { scoringMae } from "../scripts/build-book.mjs";
import { allLeagueIds } from "../scripts/pull.mjs";

const state = readJson(P.statePath);

for (const leagueId of allLeagueIds()) {
  const snapshot = readJson(P.leagueWeekFile(leagueId, state.week));
  const projections = readJson(P.projFile(snapshot.season, snapshot.week));

  test(`${leagueId}: computed points match Sleeper pts_ppr to MAE < 0.05`, () => {
    const mae = scoringMae(snapshot.league.scoring_settings, projections);
    assert.ok(mae != null, "no projections carried a pts_ppr to check against");
    assert.ok(mae < 0.05, `MAE ${mae} — the scoring dot product has drifted`);
  });

  test(`${leagueId}: DEF projections do not multiply the raw pts_allow key`, () => {
    // pts_allow: 16.0 is a raw value sitting beside pts_allow_14_20: 1.0, which
    // IS a scoring key. A defence that scored ~16x its tier bonus would be the
    // symptom; assert instead that no defence outscores a plausible ceiling.
    const defences = Object.entries(projections).filter(([, s]) => "pts_allow_14_20" in s || "pts_allow_21_27" in s);
    assert.ok(defences.length > 0, "no DEF rows in the projection file — K and DEF were not pulled");
    for (const [id, stats] of defences) {
      const mu = projectedPoints(snapshot.league.scoring_settings, stats);
      assert.ok(mu < 25, `DEF ${id} projects ${mu.toFixed(1)} — a raw stat key is being scored`);
    }
  });
}
