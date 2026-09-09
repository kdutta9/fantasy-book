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

// The direct test of CLAUDE.md trap 1, independent of any league's data: the dot
// product must iterate the SCORING map and ignore everything else. The pts_ppr
// comparison below is only a proxy for this, and it is a proxy that stops working
// the moment a league uses custom scoring.
test("projectedPoints scores only keys the league actually scores", () => {
  const scoring = { rec: 1, rec_yd: 0.1, pass_td: 4 };
  const stats = { rec: 5, rec_yd: 60, pass_td: 2, pts_allow: 1e6, rec_tgt: 1e6, cmp_pct: 1e6, gp: 1 };
  assert.equal(projectedPoints(scoring, stats), 5 + 6 + 8);
});

test("projectedPoints ignores scoring rules the projection has no stat for", () => {
  assert.equal(projectedPoints({ rec: 1, fgm_60p: 6 }, { rec: 4 }), 4);
});

const state = readJson(P.statePath);

for (const leagueId of allLeagueIds()) {
  const snapshot = readJson(P.leagueWeekFile(leagueId, state.week));
  const projections = readJson(P.projFile(snapshot.season, snapshot.week));

  // Matching pts_ppr is only an invariant for a league whose scoring IS Sleeper's
  // PPR preset. Nick's and DKEnasty happen to be; LoOG is not — it scores
  // pass_int at −2, custom FG distance tiers and a full yards-allowed ladder, so
  // its points legitimately differ from pts_ppr and asserting equality would be
  // asserting a false premise. The flag records which is which; the direct test
  // of the actual trap is below and applies to every league.
  const config = readJson(P.leagueConfigPath(leagueId));
  const isPreset = config._verified?.scoringMatchesSleeperPPR === true;

  test(`${leagueId}: computed points ${isPreset ? "match Sleeper pts_ppr to MAE < 0.05" : "track pts_ppr without diverging"}`, () => {
    const mae = scoringMae(snapshot.league.scoring_settings, projections);
    assert.ok(mae != null, "no projections carried a pts_ppr to check against");
    if (isPreset) {
      assert.ok(mae < 0.05, `MAE ${mae} — the scoring dot product has drifted`);
    } else {
      // A custom map should still land near pts_ppr in aggregate. Multiplying
      // the ~40 non-scoring keys would blow this up by orders of magnitude.
      assert.ok(mae < 3, `MAE ${mae} vs pts_ppr — too far apart for a custom scoring map`);
    }
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
