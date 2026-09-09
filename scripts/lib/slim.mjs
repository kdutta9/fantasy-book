// Raw Sleeper pulls are 14.6 MB (players) + ~2 MB/week (projections). None of
// that is committed. This module owns the field list for both slimmed shapes —
// DESIGN.md §4.3, "one module owns the field list".

// Projections keep only stat keys that some league actually scores. The union is
// inert for the league that does not score a key (the dot product iterates
// scoring_settings, never the projection) so sharing the file couples nothing —
// DESIGN.md §6.6.
export const scoringKeyUnion = (leagues) =>
  [...new Set(leagues.flatMap((l) => Object.keys(l.scoring_settings)))].sort();

// Neither of these is a scoring key and neither is ever used to price (trap 1).
// pts_ppr is kept so the MAE regression test has Sleeper's own number to check
// against; gp is what turns the rest-of-season projection into a per-game one.
const BOOKKEEPING_KEYS = ["pts_ppr", "gp"];

export function slimProjections(rows, keys) {
  const keep = new Set([...keys, ...BOOKKEEPING_KEYS]);
  const out = {};
  for (const row of rows) {
    const stats = row.stats ?? {};
    const kept = {};
    for (const k in stats) if (keep.has(k)) kept[k] = stats[k];
    if (Object.keys(kept).length) out[row.player_id] = kept;
  }
  return sortedByKey(out);
}

// n name · p position · t team · s status · i injury_status · d depth_chart_order.
// Kept for rostered players plus anyone carrying a projection, so a mid-week
// waiver pickup still renders.
export function slimPlayers(players, playerIds) {
  const out = {};
  for (const id of [...playerIds].sort()) {
    const p = players[id];
    if (!p) continue;
    out[id] = {
      n: p.full_name ?? [p.first_name, p.last_name].filter(Boolean).join(" ") ?? id,
      p: p.position ?? null,
      t: p.team ?? null,
      s: p.status ?? null,
      i: p.injury_status ?? null,
      d: p.depth_chart_order ?? null,
    };
  }
  return out;
}

// Committed JSON must not depend on Sleeper's response ordering, or two pulls of
// identical data would produce different bytes and check-frozen would be noise.
const sortedByKey = (obj) =>
  Object.fromEntries(Object.keys(obj).sort().map((k) => [k, obj[k]]));
