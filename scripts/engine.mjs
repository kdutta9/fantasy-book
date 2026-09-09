// The model (DESIGN.md §5), lifted from reference/spike.mjs. Pure functions: no
// fetching, no filesystem, no clock. Everything here is a function of its
// arguments, which is what makes a sheet reproducible from committed inputs.

import { drawScore, gaussian, mulberry32 } from "./lib/rng.mjs";

// Sleeper's lineup slots. Non-bench slots not listed here are a loud failure
// rather than a silent drop: a league using SUPER_FLEX whose extra starter
// vanished would post lines that are wrong in a way nobody would notice.
const BENCH_SLOTS = new Set(["BN", "IR", "TAXI"]);
const FLEX_SLOTS = {
  FLEX: ["RB", "WR", "TE"],
  "W/R/T": ["RB", "WR", "TE"],
  WRRB_FLEX: ["RB", "WR"],
  REC_FLEX: ["WR", "TE"],
  SUPER_FLEX: ["QB", "RB", "WR", "TE"],
  IDP_FLEX: ["DL", "LB", "DB"],
};
const POSITIONS = new Set(["QB", "RB", "WR", "TE", "K", "DEF", "DL", "LB", "DB"]);
const eligibleFor = (slot) => new Set(FLEX_SLOTS[slot] ?? [slot]);

// --- Mean (§5.1) -------------------------------------------------------------
// Iterate the SCORING SETTINGS and look up in the projection, never the reverse.
// DEF projections carry `pts_allow: 16.0` — a raw value that is not a scoring
// key — beside `pts_allow_14_20: 1.0`, which is. ~40 projection keys have no
// scoring rule; iterating the projection multiplies garbage (CLAUDE.md trap 1).
export function projectedPoints(scoringSettings, stats) {
  if (!stats) return 0;
  let total = 0;
  for (const key in scoringSettings) if (key in stats) total += scoringSettings[key] * stats[key];
  return total;
}

// --- Spread (§5.2) -----------------------------------------------------------
export const sigmaFor = (variance, position, mu) => {
  const fit = variance.positions[position];
  if (!fit) throw new Error(`No fitted variance for position ${position} — config/variance.json`);
  return Math.max(variance.sigma_floor, fit.a + fit.b * mu);
};

// --- Lineups (§5.4) ----------------------------------------------------------
// Optimal by PROJECTED points against roster_positions. Set on what a manager
// knows Sunday morning; scored on the simulated draw. Setting lineups on the
// draw would be lookahead bias.
//
// Fixed slots are filled before flex slots regardless of the order Sleeper lists
// them in. That ordering is what makes the greedy optimal: every valid lineup
// must meet the fixed-slot minimums, so taking the best player for each and
// letting flex take the best of what remains cannot be beaten.
export function optimalLineup({ playerIds, excluded, muOf, positionOf, rosterPositions }) {
  const pool = playerIds
    .filter((id) => !excluded.has(id) && muOf(id) > 0) // no projection ⇒ does not play (§5.3)
    .map((id) => ({ id, mu: muOf(id), position: positionOf(id) }))
    .sort((a, b) => b.mu - a.mu || (a.id < b.id ? -1 : 1)); // id breaks exact ties for determinism

  const slots = rosterPositions.filter((s) => !BENCH_SLOTS.has(s));
  const unknown = slots.find((s) => !FLEX_SLOTS[s] && !POSITIONS.has(s));
  if (unknown) throw new Error(`Unknown lineup slot "${unknown}" — teach engine.mjs FLEX_SLOTS about it`);

  // Fill order is fixed-slots-first (that is what makes the greedy optimal);
  // the returned lineup is put back into the league's own slot order, because
  // a sheet printing K and DEF above FLEX reads like a bug.
  const fillOrder = slots.map((slot, at) => ({ slot, at })).sort((a, b) => Number(!!FLEX_SLOTS[a.slot]) - Number(!!FLEX_SLOTS[b.slot]) || a.at - b.at);
  const used = new Set();
  const lineup = [];
  for (const { slot, at } of fillOrder) {
    const eligible = eligibleFor(slot);
    const pick = pool.find((p) => !used.has(p.id) && eligible.has(p.position));
    // A slot with nobody eligible is emitted empty rather than dropped. Nick's
    // roster 5 carries no kicker at all, and a lineup that quietly returned nine
    // players would hide the eight points that makes him the karaoke favourite.
    if (!pick) {
      lineup.push({ id: null, mu: 0, position: null, slot, at });
      continue;
    }
    used.add(pick.id);
    lineup.push({ ...pick, slot, at });
  }
  return lineup.sort((a, b) => a.at - b.at);
}

// --- Drawing a team's week (§5.3) --------------------------------------------
// A lineup is compiled once into (mu, sigma) pairs so the hot loop does no
// lookups. Empty slots are dropped here rather than drawn as zero: they carry no
// position, so there is no fitted sigma for them, and they contribute nothing.
//
// `seasonVariance` is optional and only the season simulator passes it. When it
// is present each player also carries the log-normal parameters of a season
// multiplier — the uncertainty in the player's MEAN, which config/variance.json
// deliberately does not contain (see scripts/calibrate-season.mjs).
export const compileLineup = (lineup, variance, seasonVariance = null) =>
  lineup
    .filter((p) => p.mu > 0)
    .map(({ mu, position }) => ({
      mu,
      position,
      sigma: sigmaFor(variance, position, mu),
      logSigma: seasonVariance ? logSigmaFor(seasonVariance, position) : 0,
    }));

// A multiplier with median-adjusted mean 1 and the fitted coefficient of
// variation: m = exp(N(-s^2/2, s)), s = sqrt(ln(1 + cv^2)).
function logSigmaFor(seasonVariance, position) {
  const fit = seasonVariance.positions[position];
  if (!fit) throw new Error(`No fitted season variance for position ${position} — config/season-variance.json`);
  return Math.sqrt(Math.log(1 + fit.cv ** 2));
}

export function drawTeam(spec, rng) {
  let total = 0;
  for (const { mu, sigma } of spec) total += drawScore(mu, sigma, rng);
  return total;
}

// One draw per player per simulated season: how good this player turns out to
// actually be. Applied to every remaining week, which is what makes fourteen
// weeks of football uncertain about a roster rather than merely noisy about it.
export function drawSeasonForm(spec, variance, rng, out) {
  for (let i = 0; i < spec.length; i++) {
    const p = spec[i];
    const mu = p.mu * Math.exp(p.logSigma * gaussian(rng) - (p.logSigma * p.logSigma) / 2);
    out[i].mu = mu;
    out[i].sigma = sigmaFor(variance, p.position, mu);
  }
  return out;
}

// --- Accumulators ------------------------------------------------------------
// Both leagues punish the weekly LOW scorer and Nick's pairs it with the HIGH
// scorer, so one pass counts extremes and the joint (§6.4). The joint is
// "X sings a song picked by Y" — counted inside the loop, not multiplied after,
// because low and high are emphatically not independent.
export function tallyExtremes(rosterIds, scores, sims) {
  const low = new Map(rosterIds.map((id) => [id, 0]));
  const high = new Map(rosterIds.map((id) => [id, 0]));
  const joint = new Map();
  const cols = rosterIds.map((id) => scores.get(id));
  for (let s = 0; s < sims; s++) {
    let lo = 0;
    let hi = 0;
    for (let t = 1; t < cols.length; t++) {
      if (cols[t][s] < cols[lo][s]) lo = t;
      if (cols[t][s] > cols[hi][s]) hi = t;
    }
    const loId = rosterIds[lo];
    const hiId = rosterIds[hi];
    low.set(loId, low.get(loId) + 1);
    high.set(hiId, high.get(hiId) + 1);
    const key = `${loId}|${hiId}`;
    joint.set(key, (joint.get(key) ?? 0) + 1);
  }
  return { low, high, joint };
}

// --- Sample statistics -------------------------------------------------------
export const median = (values) => {
  const sorted = Float64Array.from(values).sort();
  return sorted[sorted.length >> 1];
};

export const mean = (values) => {
  let total = 0;
  for (const v of values) total += v;
  return total / values.length;
};

// P(a > b), with ties split as a half-win each side (§6.1). Exact ties are
// vanishingly rare with continuous draws, but Sleeper scores in tenths and the
// h2h board on worldcup priced them, so the rule is stated rather than assumed.
export function probBeats(a, b, sims) {
  let wins = 0;
  for (let s = 0; s < sims; s++) wins += a[s] > b[s] ? 1 : a[s] === b[s] ? 0.5 : 0;
  return wins / sims;
}

export function probOver(values, line, sims) {
  let over = 0;
  for (let s = 0; s < sims; s++) over += values[s] > line ? 1 : values[s] === line ? 0.5 : 0;
  return over / sims;
}

// Elementwise combination of two score columns, so callers can build the
// difference (spread) and sum (total) distributions without a second sim.
export function combine(a, b, fn, sims) {
  const out = new Float64Array(sims);
  for (let s = 0; s < sims; s++) out[s] = fn(a[s], b[s]);
  return out;
}
