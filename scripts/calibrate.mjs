#!/usr/bin/env node
// Refit config/variance.json (DESIGN.md §5.2).
//
//   node scripts/calibrate.mjs                 # fit and print, comparing to the committed file
//   node scripts/calibrate.mjs --write         # actually overwrite config/variance.json
//   node scripts/calibrate.mjs --season 2025 --season 2024
//
// RE-FIT AT MOST ONCE A SEASON, NEVER MID-SEASON. variance.json is an input to
// every sheet ever posted; changing it silently changes what every historic
// sheet would rebuild as, which is the same class of error as worldcup's
// `--backfill --force`. --write is deliberately not wired to an npm script.
//
// Method: pair Sleeper's own weekly projection against its own weekly actual,
// both as pts_ppr, for every player projected for a point or more. Under a
// normal error the mean absolute residual is σ·√(2/π), so |resid|·√(π/2) is an
// unbiased estimate of σ for that observation; regress it on the projection to
// get sigma(mu) = a + b·mu per position.

import { readJsonIf, writeJson } from "./lib/json.mjs";
import * as P from "./lib/paths.mjs";
import { POSITION_GROUPS, cached } from "./lib/sleeper-cache.mjs";
import { SCORING_POSITIONS, fetchProjections, fetchStats } from "./lib/sleeper.mjs";
import { flag, option } from "./lib/args.mjs";

const WRITE = flag("--write");
const SEASONS = option("--seasons", "2025").split(",");
const WEEKS = 14; // regular season only
const MIN_MU = 1; // below a point the ratio estimate is all noise

const rowsFor = (season, week, kind) =>
  Promise.all(
    POSITION_GROUPS.map((group) =>
      cached(`${kind}-${season}-${week}-${group[0]}`, () =>
        (kind === "proj" ? fetchProjections : fetchStats)(season, week, group)
      )
    )
  ).then((sets) => sets.flat());

const samples = new Map(SCORING_POSITIONS.map((p) => [p, []]));
for (const season of SEASONS) {
  for (let week = 1; week <= WEEKS; week++) {
    const [projected, actual] = await Promise.all([rowsFor(season, week, "proj"), rowsFor(season, week, "stat")]);
    const actualBy = new Map(actual.map((r) => [r.player_id, r]));
    for (const row of projected) {
      const position = row.player?.position;
      const mu = row.stats?.pts_ppr;
      const result = actualBy.get(row.player_id)?.stats;
      const got = result?.pts_ppr;
      // A player who did not appear is a DNP, not a bad projection — §5.3 already
      // handles non-play by refusing to start an unprojected player.
      if (!samples.has(position) || !(mu >= MIN_MU) || got == null || !(result.gp >= 1)) continue;
      samples.get(position).push([mu, got - mu]);
    }
    process.stderr.write(`\r${season} week ${week}…`);
  }
}
process.stderr.write("\r");

// Ordinary least squares of y on x.
function fit(pairs) {
  const n = pairs.length;
  const sx = pairs.reduce((t, [x]) => t + x, 0);
  const sy = pairs.reduce((t, [, y]) => t + y, 0);
  const sxx = pairs.reduce((t, [x]) => t + x * x, 0);
  const sxy = pairs.reduce((t, [x, y]) => t + x * y, 0);
  const b = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  return { a: (sy - b * sx) / n, b };
}

const SIGMA_FROM_MAD = Math.sqrt(Math.PI / 2);
const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d;

const positions = {};
for (const [position, pairs] of samples) {
  if (pairs.length < 100) continue;
  const { a, b } = fit(pairs.map(([mu, resid]) => [mu, Math.abs(resid) * SIGMA_FROM_MAD]));
  positions[position] = {
    a: round(a, 3),
    b: round(b, 4),
    n: pairs.length,
    bias: round(pairs.reduce((t, [, r]) => t + r, 0) / pairs.length, 2),
  };
}

const fitted = {
  _comment:
    "sigma(mu) = a + b*mu, fitted on Sleeper projection-vs-actual residuals under full PPR. Regenerate with scripts/calibrate.mjs --write; do not hand-edit. Re-fit at most once per season, never mid-season.",
  _fitted: new Date().toISOString().slice(0, 10),
  _source: `api.sleeper.com projections vs stats, ${SEASONS.join("+")} weeks 1-${WEEKS}, mu>=${MIN_MU}`,
  positions,
  sigma_floor: 1.5,
};

const committed = readJsonIf(P.configPath("variance.json"));
console.log(`pos    n       a        b     bias      committed a / b`);
for (const [position, f] of Object.entries(positions)) {
  const c = committed?.positions?.[position];
  console.log(
    `${position.padEnd(4)} ${String(f.n).padStart(5)} ${f.a.toFixed(3).padStart(8)} ${f.b.toFixed(4).padStart(8)} ${f.bias
      .toFixed(2)
      .padStart(7)}      ${c ? `${c.a.toFixed(3)} / ${c.b.toFixed(4)}` : "—"}`
  );
}

// A refit that disagrees materially with the committed file is a finding, not a
// green light: this script scores residuals on Sleeper's own pts_ppr, and a fit
// taken under a different scoring map will land somewhere else. Reconcile the
// method before overwriting an input that every posted sheet depends on.
const drift = Object.entries(positions)
  .filter(([p, f]) => committed?.positions?.[p] && Math.abs(f.b - committed.positions[p].b) > 0.05)
  .map(([p]) => p);
if (drift.length) console.log(`\n! ${drift.join(", ")} differ from the committed fit by more than 0.05 in b.`);

if (!WRITE) {
  console.log(`\nNot written. config/variance.json is an input to every posted sheet — pass --write only between seasons.`);
} else {
  console.log(`\nWrote ${writeJson(P.configPath("variance.json"), fitted)}`);
  console.log("Every committed sheet now rebuilds differently. Run `npm run check-frozen` and expect it to fail.");
}
