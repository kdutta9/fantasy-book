// Nick's week 6: the karaoke backlog. Five songs owed, none sung, and Oanta is
// trying to rally a session for tonight (Thu 2026-10-15).
//
// Like milk-mile.mjs this is NOT a builder input: it prints a Markdown block that
// is pasted into content/nicks/w6.md. Every assumption is in INPUTS so the prices
// can be argued with. The state space is tiny, so outcomes are enumerated exactly
// rather than simulated — no seed, no noise.
//
//   node scripts/props/karaoke.mjs

import { price } from "../lib/pricing.mjs";

// The ledger, from settled.low / settled.high on sheets w2–w6.
const DEBTS = [
  { week: 1, singer: "Kunal", picker: "Kobe", song: "Vamp Anthem" },
  { week: 2, singer: "Burnes", picker: "Prozan", song: null },
  { week: 3, singer: "Hunter", picker: "Prozan", song: null },
  { week: 4, singer: "Rohan", picker: "Oanta", song: "Or Nah (Remix)" },
  { week: 5, singer: "Hunter", picker: "Kobe", song: null },
];

const INPUTS = {
  // House judgment, not data: a Thursday, TNF on, one man rallying, and a
  // league that is 0 for 5 on songs owed.
  session: 0.35,
  // P(shows up | there is a session). Burnes is in Canada (Kunal, 2026-10-15).
  attends: { Kunal: 0.85, Rohan: 0.6, Hunter: 0.55, Burnes: 0 },
  // P(sings a given owed song | he is there). Hunter's second song is conditional
  // on the first; "Or Nah (Remix)" carries its own reluctance.
  sings: { Kunal: 0.9, Rohan: 0.7, Hunter: [0.8, 0.6] },
  // Season-long and separate from tonight: he has to come back from Canada first.
  burnesThisSeason: 0.4,
};

// Distribution over who sings what tonight, conditional on a session.
function tonight() {
  const singers = ["Kunal", "Rohan", "Hunter"];
  let outcomes = [{ p: 1, songs: {} }];
  for (const who of singers) {
    const next = [];
    const owed = DEBTS.filter((d) => d.singer === who).length;
    const chain = Array.isArray(INPUTS.sings[who]) ? INPUTS.sings[who] : Array(owed).fill(INPUTS.sings[who]);
    // Not there: sings nothing.
    for (const o of outcomes) next.push({ p: o.p * (1 - INPUTS.attends[who]), songs: { ...o.songs, [who]: 0 } });
    // There: sings k of his owed songs, each conditional on the one before.
    for (const o of outcomes) {
      let reach = INPUTS.attends[who];
      for (let k = 0; k <= owed; k++) {
        const stop = k < owed ? 1 - chain[k] : 1;
        next.push({ p: o.p * reach * stop, songs: { ...o.songs, [who]: k } });
        if (k < owed) reach *= chain[k];
      }
    }
    outcomes = next;
  }
  return outcomes;
}

const given = tonight();
const P = (pred) => INPUTS.session * given.filter((o) => pred(o.songs)).reduce((s, o) => s + o.p, 0);
const total = (s) => Object.values(s).reduce((a, b) => a + b, 0);

const markets = [
  ["Karaoke happens tonight (any owed song sung)", P((s) => total(s) >= 1)],
  ["Songs sung tonight, over 1.5", P((s) => total(s) >= 2)],
  ["Kunal sings \"Vamp Anthem\" tonight", P((s) => s.Kunal >= 1)],
  ["Rohan sings \"Or Nah (Remix)\" tonight", P((s) => s.Rohan >= 1)],
  ["Hunter clears both debts tonight", P((s) => s.Hunter >= 2)],
  ["Burnes sings at all this season", INPUTS.burnesThisSeason],
];

console.log("<!-- printed by scripts/props/karaoke.mjs");
for (const [name, p] of markets) console.log(`     ${name}: fair ${(p * 100).toFixed(1)}%`);
console.log("-->\n");
for (const [name, p] of markets) console.log(`- ${name}: **Yes ${price(p)}** · **No ${price(1 - p)}**`);
