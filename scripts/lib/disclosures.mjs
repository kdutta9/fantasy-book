// DESIGN.md §10. Worldcup could cite four sportsbooks; this book cannot, so it
// earns trust by being explicit. Every line is a known, bounded limitation —
// publishing them is cheaper than having someone in the group chat find one.
export const DISCLOSURES = [
  "Rosters frozen as of the Tuesday pull — waivers and trades after it are not priced.",
  "Lineups simulated as optimal; real managers are not, so totals run a touch high.",
  "Player scores drawn independently, so stacked rosters are slightly under-varianced and moneylines run slightly long.",
  // Everything after the previewed week runs on the rest-of-season projection
  // plus a fitted per-player season multiplier. Without that multiplier the
  // futures board treats a preseason projection as fact for fourteen weeks and
  // prices a week-1 playoff spot at −1300; with it, the board still cannot see
  // an injury coming, a trade, or a manager who stops setting a lineup.
  "Season futures assume this week's rosters play out the year. Injuries, trades and the waiver wire are not forecast — only the historical size of that error is.",
  "Playoff seeding is simulated on wins then points-for, and playoff games are simulated as games, not decided by season totals.",
  "Not real betting.",
];

export const sourcesLine = (sims) =>
  `SLEEPER PROJECTIONS · ${(sims / 1000).toFixed(0)}K SIMS · VARIANCE FIT ON 2025 RESIDUALS`;
