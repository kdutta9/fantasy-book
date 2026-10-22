// DKEnasty week 7: Chris's parlay. He was the week-6 low scorer, so he places the
// slip: ten dollars, one leg from each of the other eleven managers. The legs came
// from Kunal on 2026-10-22; the slip had not been placed and no book's price was
// known, so this is the house's price on it.
//
// Same shape as laneocracy.mjs: not a builder input, prints a block to paste into
// content/dkenasty/w7.md, every assumption in INPUTS.
//
//   node scripts/props/parlay-w7.mjs

import { readJson } from "../lib/json.mjs";
import * as P from "../lib/paths.mjs";
import { price } from "../lib/pricing.mjs";

const proj = readJson(P.projFile("2026", 7));
const tds = (id) => (proj[id].rush_td ?? 0) + (proj[id].rec_td ?? 0);
// P(at least one TD) from Sleeper's projected TD count, as a Poisson mean.
const anytime = (id) => 1 - Math.exp(-tds(id));

const INPUTS = {
  // A yardage prop's line is set near the player's median, so with no line posted
  // yet each over/under is a coin flip. The projection can't help without a line.
  yardage: 0.5,
  // Moneylines as posted 2026-10-19 to 10-21, de-vigged. Jets −225 to −245 over
  // Miami (ESPN FPI 66%); 49ers −155 to −230 at Atlanta.
  jetsML: 0.66,
  ninersML: 0.62,
  stake: 10,
  // House judgment on Chris. Under the Laneocracy, not placing it or placing it
  // short a leg each cost a pick. He has placed before (wk3); leaving a leg off an
  // eleven-leg slip is the likelier failure than not placing at all.
  chrisPlaces: 0.85,
  chrisAllLegsIfPlaced: 0.6,
};

// Order as Kunal listed them. Loveland's Bears play TNF, so that leg settles first.
const LEGS = [
  ["Colston Loveland under receiving yards", INPUTS.yardage],
  ["Jets moneyline", INPUTS.jetsML],
  ["Justin Jefferson over receiving yards", INPUTS.yardage],
  ["Kenneth Walker over rushing yards", INPUTS.yardage],
  ["Jonathan Taylor anytime TD", anytime("6813")],
  ["George Pickens anytime TD", anytime("8137")],
  ["Saquon Barkley over rushing yards", INPUTS.yardage],
  ["Jakobi Lane over receiving yards", INPUTS.yardage],
  ["Cam Skattebo over rushing yards", INPUTS.yardage],
  ["49ers moneyline", INPUTS.ninersML],
  ["Matthew Golden over receiving yards", INPUTS.yardage],
];

// Exact distribution of legs hit (independent legs, Poisson-binomial).
let dist = [1];
for (const [, p] of LEGS) {
  const next = Array(dist.length + 1).fill(0);
  dist.forEach((q, k) => { next[k] += q * (1 - p); next[k + 1] += q * p; });
  dist = next;
}
const atLeast = (k) => dist.slice(k).reduce((a, b) => a + b, 0);
const all = dist[LEGS.length];
const weakest = LEGS.reduce((a, b) => (b[1] < a[1] ? b : a));

// If a leg goes missing, any of the eleven is equally likely to be the one.
const shortOne = LEGS.reduce((s, [, p]) => s + all / p, 0) / LEGS.length;
const placed = INPUTS.chrisPlaces;
const complete = placed * INPUTS.chrisAllLegsIfPlaced;

const chris = [
  ["Chris places the parlay", placed],
  // The complement of "places it with all eleven legs", so that one is off the board.
  ["Chris loses a pick under the Laneocracy", 1 - complete],
];

// Trimmed to what the settled panel can hold beside the bench list. The others
// are printed in the comment so they can be argued with.
const markets = [
  ...chris,
  ["All eleven hit", all],
  ["The slip Chris actually places hits", complete * all + (placed - complete) * shortOne],
  [`${weakest[0].replace(" anytime TD", " scores")}`, weakest[1]],
];
const offBoard = [
  ["Chris places it with all eleven legs", complete],
  ["Chris places it with a leg missing", placed - complete],
  ["Ten or more hit", atLeast(10)],
  ["Legs hit, over 5.5", atLeast(6)],
];

console.log("<!-- printed by scripts/props/parlay-w7.mjs");
for (const [name, p] of LEGS) console.log(`     leg: ${name}: ${(p * 100).toFixed(1)}%`);
console.log(`     expected legs hit: ${LEGS.reduce((s, [, p]) => s + p, 0).toFixed(2)}`);
console.log(`     all eleven: 1 in ${Math.round(1 / all).toLocaleString()} — $${INPUTS.stake} at fair pays $${Math.round(INPUTS.stake / all).toLocaleString()}`);
for (const [name, p] of markets) console.log(`     ${name}: fair ${(p * 100).toFixed(2)}%`);
for (const [name, p] of offBoard) console.log(`     (off the board) ${name}: fair ${(p * 100).toFixed(2)}% · ${price(p)}`);
console.log("-->\n");
for (const [name, p] of markets) console.log(`- ${name}: **Yes ${price(p)}** · **No ${price(1 - p)}**`);
