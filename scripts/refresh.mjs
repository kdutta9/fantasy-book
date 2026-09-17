#!/usr/bin/env node
// The weekly command (DESIGN.md §8.1): pull, then build each league's sheet
// independently.
//
//   npm run refresh                     # every league, current week
//   npm run refresh -- --league nicks   # one league, on its own
//   npm run refresh -- --week 6
//   npm run refresh -- --no-pull        # rebuild from committed inputs only
//   npm run refresh -- --refresh-names  # re-read team names from Sleeper, then rebuild
//
// Each league is built inside its own try. A DKEnasty failure must still leave
// Nick's sheet publishable (§6.6) — so a failed league is reported and the exit
// code is non-zero, but it never prevents the others from being written.

import { readJson } from "./lib/json.mjs";
import * as P from "./lib/paths.mjs";
import { fetchState } from "./lib/sleeper.mjs";
import { allLeagueIds, pull } from "./pull.mjs";
import { buildBook, writeBook } from "./build-book.mjs";
import { flag, option } from "./lib/args.mjs";


const only = option("--league", null);
const leagueIds = only ? only.split(",") : allLeagueIds();
const skipPull = flag("--no-pull");

let season;
let week;
if (skipPull) {
  const state = readJson(P.statePath);
  season = option("--season", state.season);
  week = Number(option("--week", state.week));
} else {
  // /v1/state/nfl is THE authority for the current week. Never the machine
  // clock (CLAUDE.md trap 4).
  const state = await fetchState();
  season = option("--season", state.season);
  week = Number(option("--week", state.week));
  await pull({
    leagueIds,
    week,
    season,
    refreshSchedule: flag("--refresh-schedule"),
    refreshNames: flag("--refresh-names"),
  });
  console.log();
}

const failed = [];
for (const leagueId of leagueIds) {
  try {
    const path = writeBook(buildBook({ leagueId, week }));
    console.log(`✓ ${leagueId} w${week} → ${path.replace(P.ROOT + "/", "")}`);
  } catch (err) {
    failed.push(leagueId);
    console.error(`✗ ${leagueId} w${week} — ${err.message}`);
  }
}

if (failed.length) {
  console.error(`\n${failed.length} league(s) failed: ${failed.join(", ")}. The rest are written and publishable.`);
  process.exit(1);
}
console.log(`\nSeason ${season}, week ${week}: ${leagueIds.length} sheet(s) built.`);
