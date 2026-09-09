// Reference implementation — the whole model in one file, no deps.
//
//   node reference/spike.mjs nicks 1
//   node reference/spike.mjs dkenasty 1
//
// Fetches live from Sleeper, prices one week, prints the board. This is NOT the
// architecture (see DESIGN.md §4 — the real pipeline commits its inputs so builds are
// hermetic). It exists to prove the model end to end and to be lifted into engine.mjs.
//
// Verified against both leagues 2026-09-09.

import { readFileSync } from "node:fs";

const [, , LEAGUE_KEY = "nicks", WEEK_ARG] = process.argv;
const cfg = JSON.parse(readFileSync(new URL(`../config/leagues/${LEAGUE_KEY}.json`, import.meta.url)));
const VAR = JSON.parse(readFileSync(new URL("../config/variance.json", import.meta.url))).positions;
const SIMS = 25000;
const POS = ["QB", "RB", "WR", "TE", "K", "DEF"];
const FLEX = new Set(["RB", "WR", "TE"]);

// --- seeded RNG (worldcup engine.mjs) ---------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let spare = null;
function gauss(rng) {
  if (spare !== null) { const s = spare; spare = null; return s; }
  let u, v, s2;
  do { u = rng() * 2 - 1; v = rng() * 2 - 1; s2 = u * u + v * v; } while (s2 >= 1 || s2 === 0);
  const m = Math.sqrt((-2 * Math.log(s2)) / s2);
  spare = v * m;
  return u * m;
}
// Marsaglia–Tsang
function gammaK(k, rng) {
  if (k < 1) return gammaK(k + 1, rng) * Math.pow(rng(), 1 / k);
  const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) {
    const x = gauss(rng), v = (1 + c * x) ** 3;
    if (v <= 0) continue;
    const u = rng();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}
function drawScore(mu, sigma, rng) {
  if (mu <= 0) return 0;
  const k = (mu / sigma) ** 2, theta = (sigma * sigma) / mu;
  return gammaK(k, rng) * theta;
}

// --- pricing (worldcup build-books.mjs) -------------------------------------
const MARGIN_TWO_WAY = 1.075, MARGIN_PLACE = 1.25;
const american = (p) => { const q = Math.min(p, 0.96); return q >= 0.5 ? -(100 * q) / (1 - q) : (100 * (1 - q)) / q; };
function roundOdds(o) {
  const m = Math.abs(o), step = m < 200 ? 5 : m < 1000 ? 10 : m < 3000 ? 50 : 100;
  const r = Math.round(m / step) * step;
  return o < 0 ? -Math.max(r, 100) : Math.max(r, 100);
}
const fmt = (o) => (o < 0 ? `−${Math.abs(o)}` : `+${o}`);
const price = (p, margin = MARGIN_TWO_WAY) => (p <= 0 ? "OFF" : fmt(roundOdds(american(Math.min(p * margin, 0.985)))));

// --- fetch -------------------------------------------------------------------
const get = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(`${r.status} ${u}`); return r.json(); };
const L = cfg.sleeperLeagueId;
const state = await get("https://api.sleeper.app/v1/state/nfl");
const WEEK = Number(WEEK_ARG ?? state.week);
const SEASON = state.season;
const posQ = POS.map((p) => `position[]=${p}`).join("&");

const [league, users, rosters, matchups, projSkill, projKD, players] = await Promise.all([
  get(`https://api.sleeper.app/v1/league/${L}`),
  get(`https://api.sleeper.app/v1/league/${L}/users`),
  get(`https://api.sleeper.app/v1/league/${L}/rosters`),
  get(`https://api.sleeper.app/v1/league/${L}/matchups/${WEEK}`),
  get(`https://api.sleeper.com/projections/nfl/${SEASON}/${WEEK}?season_type=regular&order_by=pts_ppr&position[]=QB&position[]=RB&position[]=WR&position[]=TE`),
  get(`https://api.sleeper.com/projections/nfl/${SEASON}/${WEEK}?season_type=regular&order_by=pts_ppr&position[]=K&position[]=DEF`),
  get("https://api.sleeper.app/v1/players/nfl"),
]);
const proj = new Map();
for (const r of [...projSkill, ...projKD]) proj.set(r.player_id, r);

// --- mu: iterate SCORING SETTINGS, look up in the projection (DESIGN.md §5.1) ---
const SC = league.scoring_settings;
const muOf = (pid) => {
  const s = proj.get(pid)?.stats;
  if (!s) return 0;
  let t = 0;
  for (const k in SC) if (k in s) t += SC[k] * s[k];
  return t;
};

// regression test: reproduce Sleeper's own pts_ppr
let n = 0, err = 0;
for (const [pid, r] of proj) if (r.stats.pts_ppr != null) { n++; err += Math.abs(muOf(pid) - r.stats.pts_ppr); }
const mae = err / n;

// --- lineups (optimal by projection) ----------------------------------------
const uById = new Map(users.map((u) => [u.user_id, u]));
const seatName = (r) => {
  const u = uById.get(r.owner_id) ?? {};
  const over = cfg.seats.find((s) => s.rosterId === r.roster_id)?.nameOverride;
  return { team: over ?? u.metadata?.team_name ?? u.display_name ?? `Roster ${r.roster_id}`, mgr: u.display_name ?? "?" };
};
const lineups = new Map();
for (const r of rosters) {
  const excl = new Set([...(r.reserve ?? []), ...(r.taxi ?? [])]);            // §5.3
  const pool = (r.players ?? [])
    .filter((p) => !excl.has(p) && muOf(p) > 0)                              // no projection ⇒ does not play
    .map((p) => ({ p, mu: muOf(p), pos: players[p]?.position }))
    .sort((a, b) => b.mu - a.mu);
  const used = new Set(), pick = [];
  for (const slot of league.roster_positions) {
    if (slot === "BN" || slot === "IR" || slot === "TAXI") continue;
    const want = slot === "FLEX" || slot === "W/R/T" ? FLEX : new Set([slot]);
    const hit = pool.find((x) => !used.has(x.p) && want.has(x.pos));
    if (hit) { used.add(hit.p); pick.push(hit); }
  }
  lineups.set(r.roster_id, pick);
}

// --- simulate ----------------------------------------------------------------
const rng = mulberry32(0x5eed0000 ^ (WEEK * 7919) ^ [...LEAGUE_KEY].reduce((a, c) => a + c.charCodeAt(0), 0));
const ids = rosters.map((r) => r.roster_id);
const scores = new Map(ids.map((id) => [id, new Float64Array(SIMS)]));
for (let s = 0; s < SIMS; s++) {
  for (const id of ids) {
    let t = 0;
    for (const { mu, pos } of lineups.get(id)) {
      const v = VAR[pos] ?? { a: 3, b: 0.35 };
      t += drawScore(mu, Math.max(1.5, v.a + v.b * mu), rng);
    }
    scores.get(id)[s] = t;
  }
}

// --- board -------------------------------------------------------------------
const R = new Map(rosters.map((r) => [r.roster_id, r]));
const nm = (id) => seatName(R.get(id));
const pad = (s, w) => (s.length > w ? s.slice(0, w - 1) + "…" : s.padEnd(w));
const med = (a) => { const b = Float64Array.from(a).sort(); return b[b.length >> 1]; };

console.log("=".repeat(78));
console.log(`${cfg.bookName}  —  WEEK ${WEEK} LINE   (${SIMS.toLocaleString()} sims)`);
console.log(`${cfg.stakes.structure === "winner-take-all" ? "WINNER TAKE ALL · $" + cfg.stakes.pot : "$" + cfg.stakes.pot + " POT"}   ·   scoring dot-product MAE vs Sleeper pts_ppr = ${mae.toFixed(3)}`);
console.log("=".repeat(78));

const pairs = new Map();
for (const m of matchups) { if (m.matchup_id == null) continue; (pairs.get(m.matchup_id) ?? pairs.set(m.matchup_id, []).get(m.matchup_id)).push(m.roster_id); }
console.log(`\n${pad("MATCHUP", 46)}${"ML".padStart(8)}${"SPREAD".padStart(9)}${"TOTAL".padStart(9)}`);
console.log("-".repeat(78));
for (const [, ab] of [...pairs].sort((x, y) => x[0] - y[0])) {
  let [a, b] = ab;
  const A = scores.get(a), B = scores.get(b);
  let pa = 0; for (let s = 0; s < SIMS; s++) if (A[s] > B[s]) pa++;
  pa /= SIMS;
  if (pa < 0.5) { [a, b] = [b, a]; pa = 1 - pa; }
  const X = scores.get(a), Y = scores.get(b);
  const d = new Float64Array(SIMS), t = new Float64Array(SIMS);
  for (let s = 0; s < SIMS; s++) { d[s] = X[s] - Y[s]; t[s] = X[s] + Y[s]; }
  const sp = Math.round(med(d) * 2) / 2, tl = Math.round(med(t) * 2) / 2;
  console.log(`${pad(nm(a).team, 22)}vs ${pad(nm(b).team, 22)}${price(pa).padStart(8)}${("−" + sp.toFixed(1)).padStart(9)}${tl.toFixed(1).padStart(9)}`);
  console.log(`${pad("  " + nm(a).mgr, 22)}   ${pad(nm(b).mgr, 22)}${price(1 - pa).padStart(8)}${("+" + sp.toFixed(1)).padStart(9)}${"o/u −110".padStart(9)}`);
}

// weekly low / high scorer — the punishment markets
const low = new Map(ids.map((i) => [i, 0])), high = new Map(ids.map((i) => [i, 0]));
for (let s = 0; s < SIMS; s++) {
  let lo = ids[0], hi = ids[0];
  for (const id of ids) {
    if (scores.get(id)[s] < scores.get(lo)[s]) lo = id;
    if (scores.get(id)[s] > scores.get(hi)[s]) hi = id;
  }
  low.set(lo, low.get(lo) + 1); high.set(hi, high.get(hi) + 1);
}
for (const [key, tally, mkt] of [["weekly", low, cfg.punishment.weekly], ["high", high, null]]) {
  const title = mkt ? `${mkt.name}  —  low scorer of the week` : `${cfg.punishment.weekly.pairedName ?? "HIGH SCORER"}  —  high scorer of the week`;
  console.log(`\n${title}`);
  if (mkt) console.log(`  ${mkt.copy}`);
  console.log("-".repeat(78));
  [...tally].sort((a, b) => b[1] - a[1]).slice(0, 6).forEach(([id, c]) => {
    console.log(`  ${pad(nm(id).team, 30)}${pad(nm(id).mgr, 18)}${price(c / SIMS, MARGIN_PLACE).padStart(8)}${((c / SIMS) * 100).toFixed(1).padStart(8)}%`);
  });
}
console.log();
