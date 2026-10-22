// Nick's week 7: the karaoke backlog gets a date. Six songs owed, none sung, and
// the league has agreed to clear them all at once on Thu 2026-11-12 (Kunal,
// 2026-10-22). Weeks 7–9 will settle before then and add three more debts; the
// singing markets below cover only the six on the books today, so they can be
// graded against a ledger that already exists.
//
// Like karaoke.mjs this is NOT a builder input: it prints a Markdown block that
// is pasted into content/nicks/w7.md. Every assumption is in INPUTS. Outcomes are
// enumerated exactly — no seed, no noise.
//
//   node scripts/props/karaoke-nov12.mjs

import { price } from "../lib/pricing.mjs";

// The ledger, from settled.low / settled.high on sheets w2–w7.
const DEBTS = [
  { week: 1, singer: "Kunal", picker: "Kobe", song: "Vamp Anthem" },
  { week: 2, singer: "Burnes", picker: "Prozan", song: null },
  { week: 3, singer: "Hunter", picker: "Prozan", song: null },
  { week: 4, singer: "Rohan", picker: "Oanta", song: "Or Nah (Remix)" },
  { week: 5, singer: "Hunter", picker: "Kobe", song: null },
  { week: 6, singer: "Burnes", picker: "Keeyan", song: null },
];

const INPUTS = {
  // House judgment, not data. Better than the Oct 15 rally (0.35): it has a date
  // three weeks out and the whole league agreed to it. Worse than a coin flip
  // would deserve: the league is 0 for 6 on songs owed.
  session: 0.6,
  // P(shows up | there is a session). Burnes was last reported in Canada.
  attends: { Kunal: 0.85, Rohan: 0.7, Hunter: 0.65, Burnes: 0.35 },
  // P(sings his k-th owed song | he is there and sang the ones before).
  sings: { Kunal: [0.9], Rohan: [0.7], Hunter: [0.8, 0.6], Burnes: [0.8, 0.6] },
  // P(low scorer) for one week, from the w7 sheet's KARAOKE board, applied to each
  // of weeks 7–9 independently. Rosters and byes will move it; this is a floor
  // for argument, not a forecast.
  weeklyLow: { Hunter: 0.131, Burnes: 0.091, Kobe: 0.009 },
  weeksBeforeNov12: 3,
};

// Distribution over how many owed songs each debtor sings, conditional on a session.
function night() {
  let outcomes = [{ p: 1, songs: {} }];
  for (const who of Object.keys(INPUTS.attends)) {
    const chain = INPUTS.sings[who];
    const owed = DEBTS.filter((d) => d.singer === who).length;
    const next = [];
    for (const o of outcomes) {
      next.push({ p: o.p * (1 - INPUTS.attends[who]), songs: { ...o.songs, [who]: 0 } });
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

const given = night();
const P = (pred) => INPUTS.session * given.filter((o) => pred(o.songs)).reduce((s, o) => s + o.p, 0);
const total = (s) => Object.values(s).reduce((a, b) => a + b, 0);
const owesAgain = (who) => 1 - (1 - INPUTS.weeklyLow[who]) ** INPUTS.weeksBeforeNov12;

const markets = [
  ["Karaoke happens on Nov 12 (any owed song sung)", P((s) => total(s) >= 1)],
  ["Of the six songs owed today, over 3.5 sung", P((s) => total(s) >= 4)],
  ["All six cleared on Nov 12", P((s) => total(s) === DEBTS.length)],
  ["Kunal sings \"Vamp Anthem\" on Nov 12", P((s) => s.Kunal >= 1)],
  ["Burnes clears both of his", P((s) => s.Burnes >= 2)],
  ["Hunter owes a third song by Nov 12", owesAgain("Hunter")],
  ["Kobe owes a song by Nov 12", owesAgain("Kobe")],
];

console.log("<!-- printed by scripts/props/karaoke-nov12.mjs");
for (const [name, p] of markets) console.log(`     ${name}: fair ${(p * 100).toFixed(1)}%`);
console.log("-->\n");
for (const [name, p] of markets) console.log(`- ${name}: **Yes ${price(p)}** · **No ${price(1 - p)}**`);
