// Ported verbatim from ../worldcup scripts/sportsbook/build-books.mjs.
// American-odds rounding and the overround schedule are solved problems there;
// this file is a port, not a rewrite. Do not "improve" it — the worldcup sheets
// are priced with these exact functions and the two books should agree.

// Margins (total book): place markets ~125% per place, two-way sides ~107.5%
// each (≈115% book). These describe a FULL field; see fieldMargin.
export const MARGIN = { outright: 1.35, place: 1.25, twoWay: 1.075 };

// A book's overround is a function of how many runners it is actually pricing.
// Interpolate on the live runner count so a full field reproduces the constant
// exactly and two live runners give the two-way price. Worldcup earned this the
// hard way when its field collapsed and the board charged 35% vig on a coin flip.
export const fieldMargin = (full, live, np) =>
  live <= 2 || np <= 2 ? MARGIN.twoWay : MARGIN.twoWay + ((live - 2) / (np - 2)) * (full - MARGIN.twoWay);

export function american(p) {
  const q = Math.min(p, 0.96); // cap so prices stop at ~-2400
  return q >= 0.5 ? -(100 * q) / (1 - q) : (100 * (1 - q)) / q;
}

export function roundOdds(o) {
  const m = Math.abs(o);
  const step = m < 200 ? 5 : m < 1000 ? 10 : m < 3000 ? 50 : m < 10000 ? 100 : 1000;
  const r = Math.round(m / step) * step;
  return o < 0 ? -Math.max(r, 100) : Math.max(r, 100);
}

export const fmt = (o) => (o < 0 ? `−${Math.abs(o)}` : `+${o}`);

export function price(p, margin = MARGIN.twoWay) {
  if (p <= 0) return null; // off the board
  return fmt(roundOdds(american(Math.min(p * margin, 0.985))));
}

// Config timelines all read the same way: an entry carries the first week it
// applies, an entry with no `since` is the opening one, and a sheet gets the
// latest entry on or before its own week. That is what lets a new board in week
// 6 leave weeks 1-5 reproducing exactly as committed.
//
// Worldcup keyed these on a date; here the sheet's identity IS its week number,
// so `since` is a week. Same semantics, numeric compare.
export const latestSince = (entries, week) =>
  (entries ?? [])
    .filter((e) => week >= (e.since ?? 0))
    .sort((x, y) => (x.since ?? 0) - (y.since ?? 0))
    .at(-1) ?? null;
