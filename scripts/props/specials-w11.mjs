// Week 11 specials, both lore books. Kunal asked for worldcup-style props on the
// main page (2026-11-20): Big Game parlays, Burnes's "ploffs", the Leafs, and
// then more parlays.
//
// Same shape as parlay-w7.mjs: NOT a builder input. It prints one block per
// league to paste into content/<league>/w11.md, and every assumption is in
// INPUTS. Outside lines are the Odds API quotes pulled 2026-11-20 ~2 PM PT,
// copied here verbatim so the prices reproduce without a key or a network. Each
// league's block reads only that league's own sheet (prose-no-cross-league).
// Legs are treated as independent. Two fantasy legs from the same league are
// different games, so that holds; a fantasy leg and the NFL team of a player in
// it are mildly correlated, and the house ignores it.
//
//   node scripts/props/specials-w11.mjs

import { readJson } from "../lib/json.mjs";
import * as P from "../lib/paths.mjs";
import { price } from "../lib/pricing.mjs";

const INPUTS = {
  // the-odds-api.com v4, 2026-11-20. American moneylines per book. Kickoffs PT.
  lines: {
    // NCAAF, Sat 11/21 4:30 PM, at Berkeley
    cal: { side: "cal", books: {
      fanduel: { cal: 112, stanford: -134 },
      lowvig: { cal: 115, stanford: -135 },
      betonlineag: { cal: 115, stanford: -135 },
      betrivers: { cal: 110, stanford: -136 },
    } },
    // NHL, Sat 11/21 4 PM, at Toronto
    leafs: { side: "leafs", books: {
      betrivers: { leafs: -121, jackets: 102 },
      draftkings: { leafs: -122, jackets: 102 },
      lowvig: { leafs: -110, jackets: -104 },
      betonlineag: { leafs: -110, jackets: -104 },
    } },
    // Ligue 1, Sat 11/21 8:15 AM, at Nice. Three-way, so a draw loses the leg.
    psg: { side: "psg", books: {
      betrivers: { nice: 550, psg: -250, draw: 390 },
      fanduel: { nice: 490, psg: -240, draw: 410 },
      draftkings: { nice: 500, psg: -215, draw: 400 },
      lowvig: { nice: 516, psg: -215, draw: 425 },
    } },
    // NFL, Sun 11/22 1:25 PM, at Denver. Mendoza's Raiders.
    raiders: { side: "raiders", books: {
      draftkings: { broncos: -598, raiders: 445 },
      fanduel: { broncos: -600, raiders: 450 },
      lowvig: { broncos: -550, raiders: 415 },
      betrivers: { broncos: -590, raiders: 410 },
    } },
    // NFL, Sun 11/22 10 AM, at Carolina. Lane's new defence.
    panthers: { side: "panthers", books: {
      draftkings: { ravens: 127, panthers: -150 },
      fanduel: { ravens: 124, panthers: -146 },
      lowvig: { ravens: 133, panthers: -153 },
      betrivers: { ravens: 130, panthers: -162 },
    } },
    // NFL, Mon 11/23 5:15 PM, at Washington. Jayden Daniels's Commanders.
    commanders: { side: "commanders", books: {
      draftkings: { bengals: -294, commanders: 240 },
      fanduel: { bengals: -280, commanders: 230 },
      lowvig: { bengals: -290, commanders: 237 },
      betrivers: { bengals: -295, commanders: 235 },
    } },
  },
  // One team's weekly score σ, the model's own figure (CLAUDE.md: 23.2, against
  // 21.2 measured on week-1 scores). Used only for the week-13 game, two weeks
  // past the sheet, where no lineup exists yet.
  teamSigma: 23.2,
  // House judgment, not data.
  // Chris was the week-10 low and owes the parlay; he sat the CPA on Friday and
  // has not placed it. He has placed before (wk3), and missed under the Laneocracy.
  chrisPlacesBeforeKickoff: 0.45,
  // Fonck missed Nov 12 for a date and now owes "Or Nah (Remix)". No second night
  // is on the calendar, and it took the league nine weeks to book the first one.
  fonckSingsBeforePlayoffs: 0.3,
  // Two French women at Silver Clouds on Nov 12. Nick's sent nobody over.
  someoneTalksToThem: 0.08,
};

const imp = (o) => (o < 0 ? -o / (100 - o) : 100 / (o + 100));
const devig = ({ side, books }) => {
  const ps = Object.values(books).map((q) => imp(q[side]) / Object.values(q).reduce((s, o) => s + imp(o), 0));
  return ps.reduce((a, b) => a + b, 0) / ps.length;
};
const L = Object.fromEntries(Object.entries(INPUTS.lines).map(([k, v]) => [k, devig(v)]));
const normalCdf = (z) => 0.5 * (1 + Math.tanh(Math.sqrt(2 / Math.PI) * (z + 0.044715 * z ** 3)));
const all = (...ps) => ps.reduce((a, b) => a * b, 1);

const sheet = (id) => readJson(P.bookFile(id, 11));
const win = (s, rosterId) => {
  const m = s.matchups.find((x) => x.a.rosterId === rosterId || x.b.rosterId === rosterId);
  return (m.a.rosterId === rosterId ? m.moneyline.pA : 100 - m.moneyline.pA) / 100;
};
const seat = (s, rosterId) => s.futures.standings.find((x) => x.rosterId === rosterId);
const ros = (s, rosterId) => s.restOfSeason.find((x) => x.rosterId === rosterId).projected;

function print(league, s, markets, notes = []) {
  console.log(`\n##### ${league}\n<!-- printed by scripts/props/specials-w11.mjs`);
  console.log(`     outside legs, de-vigged: ${Object.entries(L).map(([k, p]) => `${k} ${(p * 100).toFixed(1)}%`).join(" · ")}`);
  for (const m of s.matchups) {
    console.log(`     ${m.a.manager} ${m.moneyline.pA}% vs ${m.b.manager} ${(100 - m.moneyline.pA).toFixed(1)}%`);
  }
  for (const [name, p] of markets) console.log(`     ${name}: fair ${(p * 100).toFixed(1)}%`);
  for (const n of notes) console.log(`     ${n}`);
  console.log("-->\n");
  for (const [name, p] of markets) console.log(`- ${name}: **Yes ${price(p)}** · **No ${price(1 - p)}**`);
}

// --- DKEnasty ----------------------------------------------------------------
{
  const s = sheet("dkenasty");
  const LANE = 1, BURNES = 4, KUNAL = 5, JACOB = 6, CHRIS = 9;
  const burnesPlayoffs = seat(s, BURNES).playoffs / 100;
  const gap = ros(s, BURNES) - ros(s, LANE);
  print("dkenasty", s, [
    ["The Big Game: Cal beats Stanford and Chris beats Garrett", all(L.cal, win(s, CHRIS))],
    ["The Cal Legend: Cal beats Stanford and Mendoza's Raiders win at Denver", all(L.cal, L.raiders)],
    ["Mr. PF's parlay: Burnes makes the playoffs and the Leafs beat Columbus", all(burnesPlayoffs, L.leafs)],
    // Both 5-6 if it hits, and Burnes leads on points: he'd pass Lane this week.
    ["Mr. PF passes The Excuse: Burnes beats Jacob and Lane loses to Tal", all(win(s, BURNES), 1 - win(s, LANE))],
    ["The Lightning Rod: Jacob beats Burnes and Lane beats Tal", all(win(s, JACOB), win(s, LANE))],
    ["The Commissioner's Special: Lane beats Tal and his new Panthers defence beats Baltimore", all(win(s, LANE), L.panthers)],
    ["The Nob Hill: the house and Chris both win", all(win(s, KUNAL), win(s, CHRIS))],
    ["Burnes makes ploffs", burnesPlayoffs],
    ["Week 13, Mr. PF vs The Excuse: Burnes beats Lane", normalCdf(gap / (INPUTS.teamSigma * Math.SQRT2))],
    ["Chris places the week-10 parlay before Sunday's first kickoff", INPUTS.chrisPlacesBeforeKickoff],
  ], [`wk13: rest-of-season weekly projections Burnes ${ros(s, BURNES)} vs Lane ${ros(s, LANE)}, σ ${INPUTS.teamSigma} a side`]);
}

// --- Nick's ------------------------------------------------------------------
{
  const s = sheet("nicks");
  const ROHAN = 2, CHRIS = 5, PROZAN = 7, KOBE = 8, OANTA = 9, FONCK = 11;
  const fav = s.punishment.weekly.rows[0];
  print("nicks", s, [
    ["The Big Game: Cal beats Stanford and Chris beats Oanta", all(L.cal, win(s, CHRIS))],
    ["Paris: Rohan beats Kobe and PSG wins at Nice", all(win(s, ROHAN), L.psg)],
    ["The Loan III: Oanta beats Chris and Kobe loses to Rohan", all(win(s, OANTA), 1 - win(s, KOBE))],
    ["Daniels' Revenge: Oanta beats Chris and the Commanders beat Cincinnati on Monday night", all(win(s, OANTA), L.commanders)],
    ["Date Night: Fonck beats Hunter and Cal beats Stanford", all(win(s, FONCK), L.cal)],
    // Both 8-2 today. If it hits, Prozan is alone in first at 9-2.
    ["The Bye-Week Heist: Prozan beats Keeyan and Kobe loses to Rohan", all(win(s, PROZAN), 1 - win(s, KOBE))],
    [`The karaoke curse holds: Prozan, the favourite, doesn't sing`, 1 - fav.pct / 100],
    ["Fonck sings \"Or Nah (Remix)\" before the playoffs", INPUTS.fonckSingsBeforePlayoffs],
    ["Someone from Nick's talks to the French girls next time", INPUTS.someoneTalksToThem],
  ]);
}
