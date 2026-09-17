// Simulated draws → priced markets (DESIGN.md §6). Pure: takes score columns and
// config, returns the JSON a sheet renders. Knows nothing about files, fetching,
// or how the draws were produced.

import { MARGIN, fieldMargin, price } from "./lib/pricing.mjs";
import { combine, median, probBeats, probOver } from "./engine.mjs";

const half = (x) => Math.round(x * 2) / 2;
// A dead-even matchup is a pick'em, not "−0.0". The sign is computed rather than
// hardcoded because a fat right tail can make the sim's favourite the side with
// the smaller median margin, and "−-0.5" is not a line.
const layLine = (v) => (v === 0 ? "PK" : v > 0 ? `+${v.toFixed(1)}` : `−${Math.abs(v).toFixed(1)}`);
const round1 = (x) => Math.round(x * 10) / 10;
const pct = (x) => Math.round(x * 1000) / 10;

// --- §6.1 Weekly matchup lines — the core product ---------------------------
// The favourite is whichever side the sim likes, not whichever Sleeper listed
// first, so the spread always reads as a negative number beside a name.
export function matchupBoard({ pairings, scores, sims, seatOf, projectionOf }) {
  return pairings.map(([x, y]) => {
    const pX = probBeats(scores.get(x), scores.get(y), sims);
    const [a, b] = pX >= 0.5 ? [x, y] : [y, x];
    const pA = pX >= 0.5 ? pX : 1 - pX;
    const A = scores.get(a);
    const B = scores.get(b);
    const margin = combine(A, B, (u, v) => u - v, sims);
    const total = combine(A, B, (u, v) => u + v, sims);

    // The spread is the half-point where the margin distribution splits evenly,
    // and the total is the median of the sum. Both are posted at −110 a side:
    // the line, not the price, is what moves week to week (§6.1).
    const edge = half(median(margin)); // the favourite's median margin of victory
    const totalLine = half(median(total));

    return {
      a: seatOf(a),
      b: seatOf(b),
      moneyline: { pA: pct(pA), a: price(pA, MARGIN.twoWay), b: price(1 - pA, MARGIN.twoWay) },
      spread: {
        line: -edge, // what the favourite lays, by convention
        a: layLine(-edge),
        b: layLine(edge),
        price: "−110",
        pCover: pct(probOver(margin, edge, sims)),
      },
      total: {
        line: totalLine,
        over: "−110",
        under: "−110",
        pOver: pct(probOver(total, totalLine, sims)),
      },
      projected: { a: round1(projectionOf(a)), b: round1(projectionOf(b)) },
      simMedian: { a: round1(median(A)), b: round1(median(B)) },
    };
  });
}

// --- §6.4 The weekly punishment markets --------------------------------------
// Both leagues punish the weekly low scorer, priced straight off the same draws
// the matchup lines use. Twelve-runner place markets, so MARGIN.place.
export function punishmentBoard({ tally, sims, seatOf, punishment }) {
  const { low, high, joint } = tally;
  const runners = (tally) =>
    [...tally]
      .map(([id, count]) => ({ ...seatOf(id), pct: pct(count / sims), price: price(count / sims, MARGIN.place) }))
      .sort((x, y) => y.pct - x.pct || x.team.localeCompare(y.team));

  const board = {
    name: punishment.name,
    copy: punishment.copy,
    rows: runners(low),
  };
  if (punishment.legs) board.parlay = { legs: punishment.legs, stake: punishment.stake, lifetimeHits: punishment.lifetimeHits };

  if (!punishment.pairedMarket) return { low: board, paired: null, joints: [] };

  // "X sings a song picked by Y" — the joint, counted inside the sim loop rather
  // than multiplied after, because low and high are emphatically not independent
  // (a 145-point week makes you the high scorer AND makes someone else low).
  const joints = [...joint]
    .map(([key, count]) => {
      const [lowId, highId] = key.split("|").map(Number);
      return {
        low: seatOf(lowId),
        high: seatOf(highId),
        pct: pct(count / sims),
        price: price(count / sims, MARGIN.twoWay),
      };
    })
    .sort((x, y) => y.pct - x.pct)
    .slice(0, 6);

  return {
    low: board,
    paired: { name: punishment.pairedName, copy: `Sets the song. ${punishment.copy}`, rows: runners(high) },
    joints,
  };
}

// --- §6.7 The block the crossover pass read ----------------------------------
// RETIRED. The Crossover sheet is gone; only Kunal held a seat in more than one
// of the three leagues once LoOG arrived, and one shared manager is not a
// cross-league board. This survives for one reason: week 1's sheets were posted
// carrying this block, and check-frozen rebuilds them. It is dead everywhere
// else and build-book.mjs gates it on CROSSOVER_THROUGH_WEEK.
export function crossoverBlock({ rosterIds, scores, sims, seatOf, pairings, tally }) {
  const { low, high } = tally;
  const opponent = new Map(pairings.flatMap(([x, y]) => [[x, y], [y, x]]));
  return rosterIds.map((id) => {
    const foe = opponent.get(id);
    return {
      ...seatOf(id),
      pWin: foe == null ? null : pct(probBeats(scores.get(id), scores.get(foe), sims)),
      pLow: pct(low.get(id) / sims),
      pHigh: pct(high.get(id) / sims),
    };
  });
}

// --- §6.2 Season futures -----------------------------------------------------
// The one place the two books must NOT be one sheet with the name swapped.
// Nick's pays places 1 through 4, so it gets a four-deep ladder; DKEnasty is
// winner-take-all, so its championship board IS the financial book and a
// "to cash" market would be a lie — there is no cash but first.
export function seasonBoard({ rosterIds, acc, sims, seatOf, stakes, seasonPunishment }) {
  const n = rosterIds.length;
  const share = (counts) => rosterIds.map((id, i) => ({ seat: seatOf(id), p: counts[i] / sims }));

  // Overround scales with how many runners are actually live. A full field
  // reproduces the book's own constant exactly; by week 13, when four seats are
  // mathematically out, it stops charging 35% vig on a coin flip (worldcup's
  // fieldMargin, ported).
  const board = (counts, full) => {
    const rows = share(counts);
    const live = rows.filter((r) => r.p > 0).length;
    const margin = fieldMargin(full, live, n);
    return rows
      .map(({ seat, p }) => ({ ...seat, pct: pct(p), price: price(p, margin) }))
      .sort((a, b) => b.pct - a.pct || a.team.localeCompare(b.team));
  };

  const placeAtMost = (k) => {
    const counts = new Float64Array(n);
    for (let i = 0; i < n; i++) for (let p = 1; p <= k; p++) counts[i] += acc.place[i][p];
    return counts;
  };
  const placeExactly = (k) => Float64Array.from(rosterIds, (_, i) => acc.place[i][k]);

  const winnerTakeAll = stakes.structure === "winner-take-all";

  // --- Projected standings ---------------------------------------------------
  // Every cumulative board (top 2, top 3, make the playoffs, first-round bye,
  // most points) is monotone in team strength, so each one prints the SAME
  // ranking — measured at rho >= 0.94 against the championship ladder on the
  // week-1 sheets. Eight ladders, ninety-six rows, one piece of information.
  //
  // So the season page leads with the ranking itself, once, and the boards that
  // survive as boards are only the ones that say something it cannot: the
  // championship (the money), last place (inverted), and win totals (a line, not
  // a rank).
  //
  // The money columns here are EXACT finishes, not cumulative ones. That is what
  // the payout ladder actually is — finishing exactly 2nd in Nick's pays $100 —
  // and unlike the nested markets they are not redundant by construction: a
  // seat's twelve exact-finish probabilities sum to 1 and describe a shape.
  const games = acc.winsHist[0].length - 1;
  const payingPlaces = stakes.payouts.map((x) => x.place);
  const exactRows = new Map(
    payingPlaces.map((k) => {
      const counts = placeExactly(k);
      const rows = share(counts);
      const live = rows.filter((r) => r.p > 0).length;
      const margin = fieldMargin(MARGIN.place, live, n);
      return [k, rows.map(({ p }) => ({ pct: pct(p), price: price(p, margin) }))];
    })
  );

  const standings = rosterIds
    .map((id, i) => {
      const dist = [];
      let expected = 0;
      let cum = 0;
      let med = n;
      for (let placeNo = 1; placeNo <= n; placeNo++) {
        const p = acc.place[i][placeNo] / sims;
        dist.push(pct(p));
        expected += placeNo * p;
        cum += p;
        if (cum < 0.5) med = placeNo + 1;
      }
      const wins = acc.winsTotal[i] / sims;
      return {
        ...seatOf(id),
        projFinish: round1(expected),
        medianFinish: Math.min(med, n),
        projWins: round1(wins),
        projLosses: round1(games - wins),
        projPoints: Math.round(acc.pointsTotal[i] / sims),
        dist,
        money: payingPlaces.map((k) => ({
          place: k,
          label: payoutFor(stakes, k),
          ...exactRows.get(k)[i],
        })),
        inTheMoney: pct(payingPlaces.reduce((t, k) => t + acc.place[i][k] / sims, 0)),
        playoffs: pct(acc.playoffs[i] / sims),
        bye: pct(acc.bye[i] / sims),
        pointsTitle: pct(acc.pointsTitle[i] / sims),
        last: pct(acc.place[i][n] / sims),
      };
    })
    .sort((a, b) => a.projFinish - b.projFinish || a.team.localeCompare(b.team))
    .map((row, i) => ({ ...row, rank: i + 1 }));

  // Only two ladders survive. Everything else is a column above.
  const markets = [
    { key: "championship", name: "CHAMPIONSHIP", pays: payoutFor(stakes, 1), rows: board(placeAtMost(1), MARGIN.outright) },
    {
      key: "lastPlace",
      name: seasonPunishment.name,
      copy: seasonPunishment.copy,
      pays: null,
      rows: board(placeExactly(n), MARGIN.place),
    },
  ];

  return {
    structure: stakes.structure,
    payingPlaces,
    standings,
    markets,
    winTotals: rosterIds.map((id, i) => winTotal(seatOf(id), acc.winsHist[i], acc.winsTotal[i], sims)),
  };
}

const payoutFor = (stakes, place) => stakes.payouts.find((p) => p.place === place)?.label ?? null;

// The half-win line where the season-wins distribution splits closest to even,
// priced off the actual probability rather than posted flat: unlike a weekly
// total, wins are integers, so a half-win line can sit a long way from 50/50.
function winTotal(seat, hist, total, sims) {
  const cumulative = (line) => {
    let over = 0;
    for (let w = Math.ceil(line); w < hist.length; w++) over += hist[w];
    return over / sims;
  };
  let line = 0.5;
  for (let candidate = 0.5; candidate < hist.length; candidate += 1) {
    if (Math.abs(cumulative(candidate) - 0.5) < Math.abs(cumulative(line) - 0.5)) line = candidate;
  }
  const over = cumulative(line);
  return {
    ...seat,
    line,
    expected: Math.round((total / sims) * 10) / 10,
    over: price(over, MARGIN.twoWay),
    under: price(1 - over, MARGIN.twoWay),
    pOver: pct(over),
  };
}
