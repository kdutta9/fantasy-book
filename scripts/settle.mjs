// Sheet W settles week W−1 (DESIGN.md §8.1). This module grades a posted sheet
// against what actually happened, and it is the one place in the pipeline that
// reads a book's own previous artifact.
//
// It reads, for league L building week W:
//
//   public/data/books/<L>/w<W-1>.json            the lines that were posted
//   public/data/leagues/<L>/results/w<W-1>.json  the final scores
//   public/data/leagues/<L>/weeks/w<W-1>.json    the rosters as they stood
//
// All three are committed, frozen and belong to L alone, so the settlement block
// is hermetic on exactly the same terms as the rest of the sheet, and §6.6 holds:
// no other league's data is touched.
//
// Pure functions. No fetching, no filesystem, no clock.

import { optimalLineup } from "./engine.mjs";

// The book grades itself in public. Three records and a Brier score is the
// whole of it: a sheet that only ever prints forward-looking prices can never
// be caught being wrong, which is exactly why nobody would believe it.
export function settleWeek({ week, sheet, results, snapshot, players, seatOf }) {
  // Every seat copied out of last week's sheet is re-resolved through THIS
  // sheet's names. Without it a settled board prints whatever a seat was called
  // last week while the boards under it print what it is called now — which is
  // exactly what happened when Nick's roster 5 renamed itself between sheets and
  // one panel ended up carrying both names for one seat. A settled result is a
  // fact about a roster id; the name beside it is just how this sheet spells it.
  const rename = (seat) => (seat?.rosterId == null ? seat : { ...seat, ...seatOf(seat.rosterId) });

  const pointsOf = new Map(results.rosters.map((r) => [r.rosterId, r.points]));
  const projectedOf = new Map(sheet.lineups.map((l) => [l.rosterId, l.projected]));

  const matchups = sheet.matchups.map((m) => settleMatchup(m, pointsOf, rename));
  const scored = [...pointsOf].map(([rosterId, points]) => ({ ...seatOf(rosterId), points }));
  const ranked = [...scored].sort((a, b) => b.points - a.points);

  return {
    week,
    matchups,
    reportCard: reportCard(matchups),
    high: ranked[0],
    low: ranked[ranked.length - 1],
    // Did the market's own favourite actually take the forfeit? The punishment
    // boards are the most-read thing on the sheet; whether they were right is
    // the most-read thing about last week's.
    punishment: {
      low: settleRunners(sheet.punishment.weekly, ranked[ranked.length - 1], rename),
      high: sheet.punishment.paired ? settleRunners(sheet.punishment.paired, ranked[0], rename) : null,
      joint: settleJoint(sheet.punishment.joints, ranked[0], ranked[ranked.length - 1], rename),
    },
    // §5.4's measured bias, finally measurable: every line on the sheet assumed
    // an optimal lineup, and nobody sets one.
    bench: benchBoard({ results, snapshot, players, seatOf }),
    // A seat's own projection was its line's whole input, so beating it or
    // missing it explains the week better than the final score does.
    versus: scored
      .map((s) => ({ ...s, projected: projectedOf.get(s.rosterId) ?? null }))
      .filter((s) => s.projected != null)
      .map((s) => ({ ...s, diff: round(s.points - s.projected) }))
      .sort((a, b) => b.diff - a.diff),
  };
}

// A posted row plus two final scores. `pA` is the pre-vig probability the sheet
// priced off, not the −170 it printed, so the Brier score grades the model
// rather than the margin.
function settleMatchup(m, pointsOf, rename) {
  const a = pointsOf.get(m.a.rosterId) ?? null;
  const b = pointsOf.get(m.b.rosterId) ?? null;
  if (a == null || b == null) return { ...m, a: rename(m.a), b: rename(m.b), played: false };
  const margin = round(a - b);
  const total = round(a + b);
  return {
    a: { ...rename(m.a), points: a },
    b: { ...rename(m.b), points: b },
    played: true,
    posted: { moneyline: m.moneyline, spread: m.spread, total: m.total },
    margin,
    total,
    // `spread.line` is A's number and is negative when A is favoured, so A covers
    // when its margin beats the line it was giving.
    winner: sign(margin),
    ats: sign(round(margin + m.spread.line)),
    ou: sign(round(total - m.total.line)),
    // A tie is a real outcome here — Sleeper scores to two decimals but two
    // seats did tie at 144.6 in week 1 — so it is scored as the half-win both
    // sides were priced at, not swept under a rounding rule.
    brier: round2((m.moneyline.pA / 100 - outcomeValue(sign(margin))) ** 2),
  };
}

// The favourite's record straight up, against the spread, and the total's — the
// three numbers a bettor would use to decide whether this book knows anything.
function reportCard(matchups) {
  const played = matchups.filter((m) => m.played);
  const tally = (pick) => {
    const record = { w: 0, l: 0, p: 0 };
    for (const m of played) record[pick(m)]++;
    return record;
  };
  return {
    games: played.length,
    // The sheet always prints the favourite as side A, so A's record IS the
    // chalk's record.
    straightUp: tally((m) => (m.winner === "a" ? "w" : m.winner === "b" ? "l" : "p")),
    ats: tally((m) => (m.ats === "a" ? "w" : m.ats === "b" ? "l" : "p")),
    total: tally((m) => (m.ou === "a" ? "w" : m.ou === "b" ? "l" : "p")),
    // Mean squared error on the moneyline probabilities. 0.25 is what you score
    // by calling every game a coin flip, which is the only benchmark that
    // matters in a sport this random.
    brier: played.length ? round2(played.reduce((s, m) => s + m.brier, 0) / played.length) : null,
    coinFlip: 0.25,
    // What the sheet said would happen, in the same units as what did: sum the
    // favourites' win probabilities and you get the number of favourites that
    // should have won.
    expectedChalkWins: round(played.reduce((s, m) => s + m.posted.moneyline.pA / 100, 0)),
  };
}

// Where the settled seat finished on the board that priced it. A +630 shot
// landing is the best thing that can happen to a punishment market and it should
// be printed as loudly as the price was.
function settleRunners(board, actual, rename) {
  if (!board?.rows?.length) return null;
  const rows = board.rows.map(rename).sort((a, b) => b.pct - a.pct);
  const at = rows.findIndex((r) => r.rosterId === actual.rosterId);
  const row = at >= 0 ? rows[at] : null;
  return {
    name: board.name,
    ...actual,
    price: row?.price ?? null,
    pct: row?.pct ?? null,
    rank: at >= 0 ? at + 1 : null,
    of: rows.length,
    favourite: rows[0],
    hitFavourite: rows[0].rosterId === actual.rosterId,
  };
}

// The joint is the best slip on the sheet, so whether it came in is worth a line
// of its own — including the near-misses, which are the funnier outcome.
function settleJoint(joints, high, low, rename) {
  if (!joints?.length) return null;
  const at = joints.find((j) => j.low.rosterId === low.rosterId && j.high.rosterId === high.rosterId) ?? null;
  const hit = at && { ...at, low: rename(at.low), high: rename(at.high) };
  return { hit: hit ?? null, offered: joints.length, low, high };
}

// The gap between the lineup a manager set and the one the model assumed they
// would set. Scored on ACTUAL points, so it is the real cost of the decision and
// not a projection argument — and it is the honest measure of §5.4's bias, which
// the sheet has been disclosing all season without ever quantifying.
function benchBoard({ results, snapshot, players, seatOf }) {
  const rosters = new Map(snapshot.rosters.map((r) => [r.roster_id, r]));
  const rows = [];
  for (const result of results.rosters) {
    const roster = rosters.get(result.rosterId);
    if (!roster || !result.playerPoints) continue;
    const scoredOf = (id) => result.playerPoints[id] ?? 0;
    // The pool is the roster Sleeper scored that week, NOT the Tuesday snapshot.
    // A mid-week pickup is on the first and not the second, and starting one
    // made this board report a NEGATIVE points-left figure — bmilgram started
    // the Steelers defence for 19 after claiming it on Thursday, so the "best
    // available lineup" came out 14.5 points below the lineup he actually
    // played. The question this panel asks is what was startable at lock, which
    // is exactly the set `players_points` is keyed by.
    const best = optimalLineup({
      playerIds: Object.keys(result.playerPoints),
      excluded: new Set([...roster.reserve, ...roster.taxi]),
      muOf: scoredOf,
      positionOf: (id) => players[id]?.p ?? null,
      rosterPositions: snapshot.league.roster_positions,
    });
    const bestPoints = best.reduce((sum, p) => sum + p.mu, 0);
    const started = new Set(result.starters);
    const missed = best
      .filter((p) => p.id && !started.has(p.id))
      .map((p) => ({ name: players[p.id]?.n ?? p.id, position: p.position, points: round(p.mu) }))
      .sort((a, b) => b.points - a.points);
    rows.push({
      ...seatOf(result.rosterId),
      points: result.points,
      best: round(bestPoints),
      left: round(bestPoints - result.points),
      missed: missed.slice(0, 3),
    });
  }
  return rows.sort((a, b) => b.left - a.left);
}

// "a" | "b" | "push" — one convention for every binary this module settles, so
// the view never has to remember three of them.
const sign = (delta) => (delta > 0 ? "a" : delta < 0 ? "b" : "push");
const outcomeValue = (result) => (result === "a" ? 1 : result === "b" ? 0 : 0.5);
const round = (n) => Math.round(n * 100) / 100;
const round2 = (n) => Math.round(n * 1000) / 1000;
