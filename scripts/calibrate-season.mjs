#!/usr/bin/env node
// Fit config/season-variance.json — the uncertainty in a player's rest-of-season
// MEAN, which config/variance.json does not contain and the futures board cannot
// be priced without.
//
//   node scripts/calibrate-season.mjs              # fit and print
//   node scripts/calibrate-season.mjs --write
//
// Why this file has to exist. config/variance.json is week-to-week noise around
// a KNOWN mean, and it is exactly right for the weekly card. Run a season off it
// and every player's fourteen-week total varies by only sigma·sqrt(14) — about
// 16% for a mid-tier receiver — so the strongest roster makes the playoffs with
// near-certainty before a snap is played. Measured against 2025, a preseason
// season projection actually missed a player's fourteen-week total by about 40%.
// The gap is uncertainty in the mean itself: injuries, breakouts, busts and the
// waiver wire that DESIGN.md §3.3 lists as unmodelled.
//
// Model: a per-player season multiplier m ~ LogNormal, median 1, drawn once per
// simulated season and applied to every remaining week. cv is fitted per position
// by removing the weekly-noise share from the observed season-total dispersion:
//
//   cv_season^2 = cv_observed^2 - cv_weekly^2
//
// This is a dispersion fit only. No bias term is taken from it — preseason
// projections are optimistic about health in a way weekly projections are not
// (§5.2 verified the weekly ones unbiased), and importing that bias would
// depress every futures price for the wrong reason.

import { readJsonIf, writeJson } from "./lib/json.mjs";
import * as P from "./lib/paths.mjs";
import { POSITION_GROUPS, cached } from "./lib/sleeper-cache.mjs";
import { SCORING_POSITIONS, fetchSeasonProjections, fetchStats } from "./lib/sleeper.mjs";
import { sigmaFor } from "./engine.mjs";
import { flag, option } from "./lib/args.mjs";

const WRITE = flag("--write");
const SEASON = option("--season", "2025");
const WEEKS = 14;
// Only roster-relevant players. A projection for the 90th receiver is noise
// about a player nobody starts, and it would dominate a raw fit.
const DEPTH = { QB: 40, RB: 60, WR: 72, TE: 36, K: 32, DEF: 32 };

const variance = JSON.parse(JSON.stringify(readJsonIf(P.configPath("variance.json"))));

const rows = (fetcher, key) =>
  Promise.all(POSITION_GROUPS.map((group) => cached(`${key}-${group[0]}`, () => fetcher(group)))).then((s) => s.flat());

const projected = await rows((group) => fetchSeasonProjections(SEASON, group), `seasonproj-${SEASON}`);
const actual = new Map();
for (let week = 1; week <= WEEKS; week++) {
  const stats = await rows((group) => fetchStats(SEASON, week, group), `stat-${SEASON}-${week}`);
  for (const row of stats) {
    if (row.stats?.pts_ppr != null) actual.set(row.player_id, (actual.get(row.player_id) ?? 0) + row.stats.pts_ppr);
  }
}

// The season projection is a season total; `gp` is unreliable (DEF rows report
// 1), so one divisor is taken from the rows that report a plausible one.
const games = (() => {
  const tally = new Map();
  for (const row of projected) if (row.stats?.gp >= 10) tally.set(row.stats.gp, (tally.get(row.stats.gp) ?? 0) + 1);
  return [...tally].sort((a, b) => b[1] - a[1])[0][0];
})();

const samples = new Map(SCORING_POSITIONS.map((p) => [p, []]));
for (const row of projected) {
  const position = row.player?.position;
  const total = row.stats?.pts_ppr;
  if (!samples.has(position) || !(total > 0)) continue;
  samples.get(position).push({ over14: (total / games) * WEEKS, got: actual.get(row.player_id) ?? 0 });
}

const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d;
const positions = {};
console.log(`pos    n   proj/wk   cv observed   cv weekly   cv season`);
for (const [position, all] of samples) {
  const top = all.sort((a, b) => b.over14 - a.over14).slice(0, DEPTH[position]);
  if (top.length < 20) continue;
  const mean = top.reduce((t, r) => t + r.over14, 0) / top.length;
  // Dispersion is taken about the projection, not about the sample mean: the
  // question is how wrong the projection is, not how spread the players are.
  const observed = Math.sqrt(top.reduce((t, r) => t + (r.got - r.over14) ** 2, 0) / top.length) / mean;
  // What fourteen weeks of the committed weekly model alone would produce for a
  // player at this projection: sigma(mu)·sqrt(14) over the 14-week total.
  const perWeek = mean / WEEKS;
  const weekly = (sigmaFor(variance, position, perWeek) * Math.sqrt(WEEKS)) / mean;
  const cv = Math.sqrt(Math.max(0, observed ** 2 - weekly ** 2));
  positions[position] = { cv: round(cv, 3), n: top.length };
  console.log(
    `${position.padEnd(4)}${String(top.length).padStart(4)}  ${perWeek.toFixed(1).padStart(7)}` +
      `${observed.toFixed(3).padStart(14)}${weekly.toFixed(3).padStart(12)}${cv.toFixed(3).padStart(12)}`
  );
}

const fitted = {
  _comment:
    "cv of a per-player season multiplier m ~ LogNormal(median 1), drawn once per simulated season and applied to every week after the one being previewed. Fitted by removing the weekly-noise share from observed season-total dispersion. Regenerate with scripts/calibrate-season.mjs --write; re-fit at most once per season, never mid-season.",
  _fitted: new Date().toISOString().slice(0, 10),
  _source: `api.sleeper.com season projections vs summed weekly stats, ${SEASON} weeks 1-${WEEKS}, top ${JSON.stringify(DEPTH)} by projection`,
  positions,
};

if (WRITE) {
  console.log(`\nWrote ${writeJson(P.configPath("season-variance.json"), fitted)}`);
  console.log("Every committed sheet now rebuilds differently. Run `npm run check-frozen` and expect it to fail.");
} else {
  console.log(`\nNot written. Pass --write only between seasons.`);
}
