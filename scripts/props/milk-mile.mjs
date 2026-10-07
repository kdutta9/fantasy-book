// DKEnasty week 5: the season punishment, finally. Tal (last in 2024) and Burnes
// (last in 2025) run a milk mile in Costa Rica, and the house prices it.
//
// This is NOT a builder input. It prints a Markdown board that is pasted into
// content/dkenasty/w5.md, because the event is a one-off and the prose is the
// layer that may change after posting. It lives in the repo rather than a
// scratch file so the numbers on the page can be reproduced and argued with:
// every assumption is in INPUTS, and the seed is fixed.
//
//   node scripts/props/milk-mile.mjs
//
// Format (standard milk mile): four quarter-mile laps, 16 oz of whole milk
// before each. A throw-up costs the time to do it plus a penalty lap.
import { mulberry32, gaussian } from "../lib/rng.mjs";
import { price } from "../lib/pricing.mjs";

const SEED = 0x6d11c;
const SIMS = 200_000;
const LAPS = 4;

const INPUTS = {
  // Kunal, 2026-10-07: sober mile 7:00 and 8:00; Burnes is heavier and "can tank
  // through the milk"; both are likely to throw up.
  runners: {
    Burnes: { soberMile: 420, chug: 18, pukeAtLeastOnce: 0.6 },
    Tal: { soberMile: 480, chug: 26, pukeAtLeastOnce: 0.7 },
  },
  // House assumptions, not Kunal's: Guanacaste heat and a week of "getting
  // heinous" cost 12% on pace, and each 16 oz already down costs another 6% a lap.
  conditions: 1.12,
  milkDrag: 0.06,
  form: 0.06, //       day-to-day sd on pace, per runner
  lapNoise: 0.03, //   lap-to-lap sd on pace
  chugGrowth: 5, //    seconds slower per chug, each lap
  chugSd: 0.25,
  pukeCost: 12, //     seconds bent over, before the penalty lap
  pukeShape: [0.1, 0.25, 0.4, 0.6], // relative hazard by lap: the milk accumulates
  quitPerPuke: 0.03, // chance a throw-up ends the run
};

// Solve the per-lap hazard scale so P(at least one throw-up) matches the input.
// A lap can only produce one throw-up; the penalty lap is run on an emptied stomach.
function hazardScale(target) {
  let lo = 0;
  let hi = 1 / Math.max(...INPUTS.pukeShape);
  for (let i = 0; i < 60; i++) {
    const h = (lo + hi) / 2;
    const clean = INPUTS.pukeShape.reduce((p, w) => p * (1 - h * w), 1);
    if (1 - clean < target) lo = h;
    else hi = h;
  }
  return lo;
}

function run(rng, r, h) {
  const form = Math.exp(INPUTS.form * gaussian(rng));
  const basePace = (r.soberMile / LAPS) * INPUTS.conditions * form;
  let time = 0;
  let pukes = 0;
  let firstPuke = Infinity;
  for (let lap = 0; lap < LAPS; lap++) {
    const chug = Math.max(5, (r.chug + INPUTS.chugGrowth * lap) * (1 + INPUTS.chugSd * gaussian(rng)));
    time += chug;
    const pace = basePace * (1 + INPUTS.milkDrag * (lap + 1)) * Math.exp(INPUTS.lapNoise * gaussian(rng));
    // Throw-ups land somewhere inside the lap; record when, for "first to puke".
    if (rng() < h * INPUTS.pukeShape[lap]) {
      const at = time + rng() * pace;
      firstPuke = Math.min(firstPuke, at);
      pukes++;
      if (rng() < INPUTS.quitPerPuke) return { finished: false, time: Infinity, pukes, firstPuke };
      time += INPUTS.pukeCost + basePace * Math.exp(INPUTS.lapNoise * gaussian(rng)); // penalty lap
    }
    time += pace;
  }
  return { finished: true, time, pukes, firstPuke };
}

const names = Object.keys(INPUTS.runners);
const hazards = Object.fromEntries(names.map((n) => [n, hazardScale(INPUTS.runners[n].pukeAtLeastOnce)]));
const rng = mulberry32(SEED);
const draws = [];
for (let i = 0; i < SIMS; i++) {
  draws.push(Object.fromEntries(names.map((n) => [n, run(rng, INPUTS.runners[n], hazards[n])])));
}

const share = (pred) => draws.filter((d, i) => pred(d, i)).length / SIMS;
const quantile = (xs, q) => [...xs].sort((a, b) => a - b)[Math.floor(q * (xs.length - 1))];
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
const twoWay = (label, p, yes = "Yes", no = "No") => `- ${label}: **${yes} ${price(p)}** · **${no} ${price(1 - p)}**`;

const [A, B] = names; // Burnes, Tal
const finishedBoth = draws.filter((d) => d[A].finished && d[B].finished);
const pA = share((d) => d[A].time < d[B].time);
const margins = finishedBoth.map((d) => d[B].time - d[A].time);
const spread = Math.round(quantile(margins, 0.5) / 5) * 5 + 0.5;
const pCover = share((d) => d[A].finished && d[B].time - d[A].time > spread) / share((d) => d[A].finished || d[B].finished);
const totalPukes = draws.map((d) => d[A].pukes + d[B].pukes);
// The half-point line nearest a coin flip: a count this small has no useful median.
const pukeLine = [0.5, 1.5, 2.5, 3.5].reduce((best, l) =>
  Math.abs(share((d, i) => totalPukes[i] > l) - 0.5) < Math.abs(share((d, i) => totalPukes[i] > best) - 0.5) ? l : best
);

const out = [];
out.push("### The line");
out.push(`- Winner: **${A} ${price(pA)}** · **${B} ${price(1 - pA)}**`);
out.push(`- Spread: **${A} −${spread}s ${price(pCover)}** · **${B} +${spread}s ${price(1 - pCover)}**`);
out.push("");
out.push("### Throw-ups");
out.push(twoWay(`Total, over/under ${pukeLine}`, share((d) => d[A].pukes + d[B].pukes > pukeLine), "Over", "Under"));
for (const n of names) out.push(twoWay(`${n}, over/under 0.5`, share((d) => d[n].pukes > 0), "Over", "Under"));
out.push("");
out.push("### Finishing times");
out.push("- A runner who doesn't finish grades as over.");
for (const n of names) {
  const times = draws.filter((d) => d[n].finished).map((d) => d[n].time);
  const line = Math.round(quantile(times, 0.5) / 5) * 5;
  out.push(twoWay(`${n}, over/under ${clock(line)}`, share((d) => d[n].time > line), "Over", "Under"));
}
out.push("");
out.push("### Specials");
const firstA = share((d) => d[A].firstPuke < d[B].firstPuke);
const firstB = share((d) => d[B].firstPuke < d[A].firstPuke);
out.push(`- First to throw up: **${A} ${price(firstA)}** · **${B} ${price(firstB)}** · **Nobody ${price(1 - firstA - firstB)}**`);
out.push(twoWay("Both throw up", share((d) => d[A].pukes > 0 && d[B].pukes > 0)));
out.push(twoWay("Somebody doesn't finish", share((d) => !d[A].finished || !d[B].finished)));
out.push(twoWay("Winning margin under 30 seconds", share((d) => Math.abs(d[A].time - d[B].time) < 30)));

console.log(out.join("\n"));
console.error(
  `\nfair: ${A} wins ${(pA * 100).toFixed(1)}% · median margin ${quantile(margins, 0.5).toFixed(0)}s · ` +
    `P(puke) ${names.map((n) => `${n} ${(share((d) => d[n].pukes > 0) * 100).toFixed(0)}%`).join(", ")} · ` +
    `median times ${names.map((n) => `${n} ${clock(quantile(draws.filter((d) => d[n].finished).map((d) => d[n].time), 0.5))}`).join(", ")}`
);
