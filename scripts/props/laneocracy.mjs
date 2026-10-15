// DKEnasty week 6: the Laneocracy. On Thu 2026-10-15 the commissioner announced
// that a manager loses his least valuable pick for (a) failing to send his parlay
// leg by TNF three times, (b) placing the parlay without every leg sent to him,
// or (c) not placing it at all. Strikes already on the books: Rohan 2, Keeyan 2,
// Laur 1.
//
// Same shape as milk-mile.mjs and karaoke.mjs: not a builder input, prints a
// block to paste into content/dkenasty/w6.md, every assumption in INPUTS.
//
//   node scripts/props/laneocracy.mjs

import { readJson } from "../lib/json.mjs";
import * as P from "../lib/paths.mjs";
import { price } from "../lib/pricing.mjs";

const book = readJson(P.bookFile("dkenasty", 6));
const laneLow = book.punishment.weekly.rows.find((r) => r.rosterId === 1).pct / 100;

const INPUTS = {
  // P(a manager on two strikes misses tonight's TNF deadline). The historical rate
  // for these two is 2 misses in 5 weeks; a warning issued this morning cuts it.
  missTonight: 0.25,
  // P(the low scorer places a complete eleven-leg slip | it's Lane). The rule's
  // author has never placed one, but he has never been watched this closely either.
  laneCompliesIfLow: 0.6,
  // P(anyone actually forfeits a pick under the rule this season). The strikes
  // will come; the question is whether the Laneocracy enforces its own law.
  enforced: 0.5,
};

const markets = [
  ["Rohan or Keeyan reaches strike three tonight", 1 - (1 - INPUTS.missTonight) ** 2],
  ["Lane is the low scorer and places all eleven legs", laneLow * INPUTS.laneCompliesIfLow],
  ["Lane is the low scorer and does not", laneLow * (1 - INPUTS.laneCompliesIfLow)],
  ["Somebody actually loses a pick this season", INPUTS.enforced],
];

console.log("<!-- printed by scripts/props/laneocracy.mjs");
console.log(`     Lane low scorer: ${(laneLow * 100).toFixed(1)}% (w6 sheet)`);
for (const [name, p] of markets) console.log(`     ${name}: fair ${(p * 100).toFixed(1)}%`);
console.log("-->\n");
for (const [name, p] of markets) console.log(`- ${name}: **Yes ${price(p)}** · **No ${price(1 - p)}**`);
