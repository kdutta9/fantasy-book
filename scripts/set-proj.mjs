#!/usr/bin/env node
// The manual override hatch (DESIGN.md §4.4), for late scratches Sleeper has not
// reflected. Writes projections/<season>/w<W>.overrides.json — committed and
// auditable, never an edit to the pulled file.
//
//   npm run set-proj -- --week 6 --player "Bijan Robinson" --pts 0 --note "ruled out Sat"
//
// --pts sets the projection by scaling every component stat on Sleeper's own
// pts_ppr, so one override survives both leagues' scoring maps: halving a
// projection halves the yards, the catches and the touchdowns together. --pts 0
// zeroes the row, which is how you say "does not play" — the engine treats a
// zero projection as lineup-ineligible (§5.3).

import { readJson, readJsonIf, writeJson } from "./lib/json.mjs";
import * as P from "./lib/paths.mjs";
import { allLeagueIds } from "./pull.mjs";
import { option } from "./lib/args.mjs";


const state = readJson(P.statePath);
const week = Number(option("--week", state.week));
const season = option("--season", state.season);
const query = option("--player", null);
const pts = Number(option("--pts", NaN));
const note = option("--note", null);

if (!query || !Number.isFinite(pts)) {
  console.error('Usage: npm run set-proj -- --week 6 --player "Name" --pts 0 --note "why"');
  process.exit(1);
}

// The players file a sheet uses is named by its week file, not by today's date —
// same lookup the builder does, so the name you match is the name that ships.
const players = readJson(P.playersFile(readJson(P.leagueWeekFile(allLeagueIds()[0], week)).playersDate));
const projections = readJson(P.projFile(season, week));

const matches = Object.entries(players).filter(
  ([id, p]) => p.n?.toLowerCase().includes(query.toLowerCase()) && projections[id]
);
if (matches.length !== 1) {
  console.error(
    matches.length
      ? `"${query}" matched ${matches.length} projected players:\n  ${matches.map(([id, p]) => `${p.n} (${p.p} ${p.t}) — ${id}`).join("\n  ")}`
      : `"${query}" matched no projected player in week ${week}.`
  );
  process.exit(1);
}

const [id, player] = matches[0];
const stats = projections[id];
const base = stats.pts_ppr ?? 0;
if (pts !== 0 && base <= 0) {
  console.error(`${player.n} has no pts_ppr baseline to scale from; only --pts 0 is meaningful here.`);
  process.exit(1);
}
const scale = pts === 0 ? 0 : pts / base;

const path = P.projOverridesFile(season, week);
const overrides = readJsonIf(path, {});
overrides[id] = {
  player: player.n,
  was: Math.round(base * 10) / 10,
  pts,
  note,
  stats: Object.fromEntries(Object.keys(stats).map((k) => [k, Math.round(stats[k] * scale * 1e4) / 1e4])),
};
writeJson(path, Object.fromEntries(Object.keys(overrides).sort().map((k) => [k, overrides[k]])));

console.log(`${player.n} (${player.p} ${player.t}) week ${week}: ${base.toFixed(1)} → ${pts.toFixed(1)}${note ? ` — ${note}` : ""}`);
console.log(`Wrote ${path}\nRebuild with: npm run refresh -- --no-pull --week ${week}`);
