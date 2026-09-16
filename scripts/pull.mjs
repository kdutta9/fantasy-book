#!/usr/bin/env node
// Snapshot Sleeper into committed inputs (DESIGN.md §4.2). Sleeper's projections
// mutate continuously, so a builder that fetched at build time would mean no
// sheet ever rebuilds identically and check-frozen could not exist. This is the
// single most important architectural rule in the project (CLAUDE.md trap 3).
//
//   npm run pull                       # current week from /v1/state/nfl, all leagues
//   npm run pull -- --week 6           # a specific week
//   npm run pull -- --league nicks     # one league (projections are still shared)
//   npm run pull -- --refresh-names    # re-read team names from Sleeper into config
//   npm run pull -- --force-inputs     # re-pull a week that already has a posted sheet
//   npm run pull -- --refresh-schedule # re-pull the season-long schedule/bracket

import { existsSync, readdirSync } from "node:fs";
import { basename } from "node:path";
import { readJson, writeJson } from "./lib/json.mjs";
import { mergeSeatNames, describeChange } from "./lib/seats.mjs";
import * as P from "./lib/paths.mjs";
import * as sleeper from "./lib/sleeper.mjs";
import { scoringKeyUnion, slimPlayers, slimProjections } from "./lib/slim.mjs";
import { flag, option } from "./lib/args.mjs";

const REGULAR_SEASON_WEEKS = 14; // weeks 15-17 return rows but are NOT the bracket (§3.2)


export const allLeagueIds = () =>
  readdirSync(P.configPath("leagues"))
    .filter((f) => f.endsWith(".json"))
    .map((f) => basename(f, ".json"))
    .sort();

// Refresh each seat's manager and teamName from Sleeper. Names are display-only —
// a rename provably moves no price — but a committed sheet rebuilds from config,
// so a refresh does make already-posted sheets stale until they are rebuilt. That
// is why this is opt-in rather than part of every pull: `npm run refresh --
// --refresh-names` refreshes and rebuilds in one go, which is the intended path.
async function refreshLeagueNames({ leagueIds, configs, log }) {
  let total = 0;
  for (const id of leagueIds) {
    const config = configs[id];
    const [users, rosters] = await Promise.all([
      sleeper.fetchUsers(config.sleeperLeagueId),
      sleeper.fetchRosters(config.sleeperLeagueId),
    ]);
    const { seats, changes } = mergeSeatNames(config.seats, users, rosters);
    if (!changes.length) {
      log(`${id}: names already current`);
      continue;
    }
    config.seats = seats;
    writeJson(P.leagueConfigPath(id), config);
    log(`${id}: ${changes.length} name change(s)`);
    for (const c of changes) log(`    ${describeChange(c)}`);
    total += changes.length;
  }
  if (total) log(`\n${total} name(s) changed — rebuild the affected sheets so they match config.`);
  return total;
}

export async function pull({ leagueIds, week, season, refreshSchedule = false, forceInputs = false, refreshNames = false, log = console.log }) {
  const pulledAt = new Date().toISOString();

  // Every league's settings are fetched, not just the ones being pulled: the
  // projection slim keeps the UNION of all leagues' scoring keys, and that union
  // must not depend on which leagues you happened to pull. Otherwise
  // `--league nicks` would write a narrower projections file and DKEnasty's
  // committed weeks would stop rebuilding.
  const everyId = allLeagueIds();
  const configs = Object.fromEntries(everyId.map((id) => [id, readJson(P.leagueConfigPath(id))]));
  const settings = {};
  for (const id of everyId) settings[id] = await sleeper.fetchLeague(configs[id].sleeperLeagueId);

  if (refreshNames) await refreshLeagueNames({ leagueIds, configs, log });

  const projected = await pullProjections({ season, week, keys: scoringKeyUnion(Object.values(settings)), forceInputs, log });
  const playersDate = await pullPlayers({ leagueIds: everyId, configs, projected, log });

  for (const id of leagueIds) {
    await pullLeagueWeek({ id, config: configs[id], league: settings[id], week, season, playersDate, pulledAt, refreshSchedule, forceInputs, log });
    await pullLeagueResults({ id, config: configs[id], week, season, log });
  }

  writeJson(P.statePath, { season, week, pulledAt, leagues: leagueIds });
  return { season, week, playersDate, pulledAt };
}

// EVERY input to a posted week is frozen, not just the projections. Sleeper's
// numbers move continuously and the league snapshot carries a fresh `pulledAt` on
// every fetch, so re-pulling a week that already has a sheet rewrites the inputs
// underneath it and check-frozen correctly starts failing. That is not
// hypothetical: running --refresh-names across three posted leagues repriced all
// three on nothing but a new timestamp.
//
// Two doors, one rule. --force-inputs opens both, and you then owe a rebuild and
// a re-publish of every sheet it touched.
const weekIsPosted = (week) =>
  existsSync(P.booksRoot) && readdirSync(P.booksRoot).some((id) => existsSync(P.bookFile(id, week)));

async function pullProjections({ season, week, keys, forceInputs, log }) {
  // K and DEF come on their own call and are REQUIRED — both leagues start both.
  if (!forceInputs && existsSync(P.projFile(season, week)) && weekIsPosted(week)) {
    log(`projections ${season} w${week}: week already posted — left untouched (--force-inputs to override)`);
    return Object.keys(readJson(P.projFile(season, week)));
  }
  const [skill, kicking] = await Promise.all([
    sleeper.fetchProjections(season, week, ["QB", "RB", "WR", "TE"]),
    sleeper.fetchProjections(season, week, ["K", "DEF"]),
  ]);
  // The K/DEF call includes punters; a league scores what it scores, but a P has
  // no lineup slot and would only ever be dead weight in the file.
  const rows = [...skill, ...kicking.filter((r) => r.player?.position !== "P")];
  const slim = slimProjections(rows, keys);
  log(`projections ${season} w${week}: ${rows.length} rows → ${Object.keys(slim).length} players, ${keys.length} scoring keys`);
  writeJson(P.projFile(season, week), slim);

  // Week-scoped, and never written back to the un-versioned season.json. That
  // file is an input to every already-posted sheet's futures board, and 26 of
  // its 3,304 rows had already moved a week into the season — overwriting it
  // reprices frozen history on nothing but Sleeper's own drift.
  const seasonRows = await sleeper.fetchSeasonProjections(season, sleeper.SCORING_POSITIONS);
  writeJson(P.seasonProjWeekFile(season, week), slimProjections(seasonRows, keys));
  return Object.keys(slim);
}

async function pullPlayers({ leagueIds, configs, projected, log }) {
  const date = new Date().toISOString().slice(0, 10);
  if (existsSync(P.playersFile(date))) {
    log(`players ${date}: cached`);
    return date;
  }
  const [players, ...rosterSets] = await Promise.all([
    sleeper.fetchPlayers(),
    ...leagueIds.map((id) => sleeper.fetchRosters(configs[id].sleeperLeagueId)),
  ]);
  // Rostered players plus anyone carrying a projection this week, so a waiver
  // pickup still renders and the projection file never points at a missing name.
  const wanted = new Set([...rosterSets.flatMap((rs) => rs.flatMap((r) => r.players ?? [])), ...projected]);
  const slim = slimPlayers(players, wanted);
  log(`players ${date}: ${Object.keys(players).length} → ${Object.keys(slim).length}`);
  writeJson(P.playersFile(date), slim);
  return date;
}

async function pullLeagueWeek({ id, config, league, week, season, playersDate, pulledAt, refreshSchedule, forceInputs, log }) {
  // The other half of the freeze. `pulledAt` alone is enough to reprice a posted
  // sheet, so a posted week's snapshot is not re-fetched at all.
  if (!forceInputs && existsSync(P.leagueWeekFile(id, week)) && weekIsPosted(week)) {
    log(`${id}: week ${week} already posted — snapshot left untouched (--force-inputs to override)`);
    return;
  }
  const sleeperId = config.sleeperLeagueId;

  // The schedule and bracket are season-long constants. Re-pulling them every
  // week would put a committed input under a live endpoint's control, and a
  // silent change there would break every already-posted sheet's rebuild.
  if (refreshSchedule || !existsSync(P.leagueFile(id, "schedule"))) {
    const weeks = await Promise.all(
      Array.from({ length: REGULAR_SEASON_WEEKS }, (_, i) => sleeper.fetchMatchups(sleeperId, i + 1))
    );
    writeJson(P.leagueFile(id, "schedule"), {
      season,
      weeks: Object.fromEntries(weeks.map((rows, i) => [i + 1, pairings(rows)])),
    });
    const [winners, losers] = await Promise.all([
      sleeper.fetchBracket(sleeperId, "winners"),
      sleeper.fetchBracket(sleeperId, "losers"),
    ]);
    // STRUCTURE only. At week 1 these are already populated with seeds that
    // cannot be real; seed from simulated standings instead (§3.2).
    const structure = (b) => b.map(({ m, r, t1_from, t2_from, p }) => ({ m, r, t1_from, t2_from, p }));
    writeJson(P.leagueFile(id, "bracket"), { winners: structure(winners), losers: structure(losers) });
    log(`${id}: schedule (weeks 1-${REGULAR_SEASON_WEEKS}) + bracket structure`);
  }

  const [users, rosters, matchups] = await Promise.all([
    sleeper.fetchUsers(sleeperId),
    sleeper.fetchRosters(sleeperId),
    sleeper.fetchMatchups(sleeperId, week),
  ]);

  // One file is the complete league-side input for one sheet — league settings
  // included, so a mid-season scoring change cannot retroactively reprice an
  // already-posted week.
  writeJson(P.leagueWeekFile(id, week), {
    id,
    season,
    week,
    pulledAt,
    playersDate,
    league: {
      name: league.name,
      scoring_settings: league.scoring_settings,
      roster_positions: league.roster_positions,
      settings: league.settings,
    },
    users: users
      // Deliberately NOT carrying metadata.team_name. Display names live in
      // config/leagues/<id>.json — the only human-edited file — where they can be
      // overridden; add-league.mjs seeds them from Sleeper at onboarding. Mirroring
      // them here re-imported the upstream string into a committed file on every
      // weekly pull, which is how a name a human had already overruled kept coming
      // back. The pull carries rosters, points and schedule; not names.
      .map((u) => ({ user_id: u.user_id, display_name: u.display_name }))
      .sort((a, b) => a.user_id.localeCompare(b.user_id)),
    rosters: rosters
      .map((r) => ({
        roster_id: r.roster_id,
        owner_id: r.owner_id,
        players: [...(r.players ?? [])].sort(),
        starters: r.starters ?? [],
        reserve: [...(r.reserve ?? [])].sort(),
        taxi: [...(r.taxi ?? [])].sort(),
        settings: r.settings,
      }))
      .sort((a, b) => a.roster_id - b.roster_id),
    matchups: pairings(matchups),
  });
  log(`${id}: week ${week} rosters + matchups`);
}

// Final scores for every week already played, so that sheet W can settle week
// W−1 (DESIGN.md §8.1). Deliberately unlike every other pull:
//
//   * only weeks strictly before the current one are fetched — a week in
//     progress has live points that would move under a sheet that cited them;
//   * a results file is written ONCE and never re-fetched, and carries no
//     `pulledAt`. A settled week is immutable, so its file has nothing a second
//     pull could legitimately change, and --force-inputs deliberately does not
//     reopen it. (Sleeper stat corrections land within a day or two; the sheet
//     says the scores are as they stood at the Tuesday pull.)
//
// That is what lets the settlement block be an ordinary frozen input rather than
// a live read, and it backfills on its own if a week is ever skipped.
async function pullLeagueResults({ id, config, week, season, log }) {
  const wanted = [];
  for (let w = 1; w < week; w++) if (!existsSync(P.leagueResultsFile(id, w))) wanted.push(w);
  if (!wanted.length) return;
  for (const w of wanted) {
    const rows = await sleeper.fetchMatchups(config.sleeperLeagueId, w);
    writeJson(P.leagueResultsFile(id, w), {
      id,
      season,
      week: w,
      rosters: rows
        .map((r) => ({
          rosterId: r.roster_id,
          matchupId: r.matchup_id,
          points: r.points ?? 0,
          starters: r.starters ?? [],
          playerPoints: sortedByKey(r.players_points ?? {}),
        }))
        .sort((a, b) => a.rosterId - b.rosterId),
    });
  }
  log(`${id}: final scores for week${wanted.length > 1 ? "s" : ""} ${wanted.join(", ")}`);
}

const sortedByKey = (obj) => Object.fromEntries(Object.keys(obj).sort().map((k) => [k, obj[k]]));

// [{roster_id, matchup_id}] → [[a, b], ...], sorted, so the committed schedule
// does not depend on Sleeper's row order.
const pairings = (rows) => {
  const byMatchup = new Map();
  for (const row of rows) {
    if (row.matchup_id == null) continue;
    if (!byMatchup.has(row.matchup_id)) byMatchup.set(row.matchup_id, []);
    byMatchup.get(row.matchup_id).push(row.roster_id);
  }
  return [...byMatchup]
    .sort((a, b) => a[0] - b[0])
    .map(([, ids]) => [...ids].sort((a, b) => a - b));
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const state = await sleeper.fetchState();
  const week = Number(option("--week", state.week));
  const season = option("--season", state.season);
  const only = option("--league", null);
  const leagueIds = only ? only.split(",") : allLeagueIds();
  await pull({
    leagueIds,
    week,
    season,
    refreshSchedule: flag("--refresh-schedule"),
    forceInputs: flag("--force-inputs"),
    refreshNames: flag("--refresh-names"),
  });
  console.log(`\nPulled ${season} week ${week} for ${leagueIds.join(", ")}.`);
}
