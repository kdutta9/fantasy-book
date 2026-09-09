#!/usr/bin/env node
// Onboard a league (DESIGN.md §4). Both current leagues are already written;
// this exists for a third. It writes config/leagues/<id>.json with real roster
// ids, handles and team names pulled from Sleeper — roster data is never entered
// by hand — leaving stakes, punishments and lore for Kunal to fill in.
//
//   npm run add-league -- --id bigleague --league-id 1234567890
//   npm run add-league -- --user kdutta --season 2026     # list a handle's leagues

import { existsSync } from "node:fs";
import { writeJson } from "./lib/json.mjs";
import * as P from "./lib/paths.mjs";
import { fetchLeague, fetchRosters, fetchState, fetchUsers } from "./lib/sleeper.mjs";
import { option } from "./lib/args.mjs";


const user = option("--user", null);
if (user) {
  const season = option("--season", null) ?? (await fetchState()).season;
  const res = await fetch(`https://api.sleeper.app/v1/user/${user}/leagues/nfl/${season}`);
  if (!res.ok) throw new Error(`Sleeper ${res.status} for user ${user}`);
  for (const l of await res.json()) console.log(`${l.league_id}  ${l.total_rosters} teams  ${l.name}`);
  process.exit(0);
}

const id = option("--id", null);
const sleeperLeagueId = option("--league-id", null);
if (!id || !sleeperLeagueId) {
  console.error("Usage: npm run add-league -- --id <config-id> --league-id <sleeper-id>");
  console.error("   or: npm run add-league -- --user <handle>   to list league ids");
  process.exit(1);
}
if (existsSync(P.leagueConfigPath(id))) throw new Error(`config/leagues/${id}.json already exists — edit it, do not overwrite`);

const [league, users, rosters] = await Promise.all([
  fetchLeague(sleeperLeagueId),
  fetchUsers(sleeperLeagueId),
  fetchRosters(sleeperLeagueId),
]);
const byUser = new Map(users.map((u) => [u.user_id, u]));

const path = writeJson(P.leagueConfigPath(id), {
  id,
  sleeperLeagueId,
  displayName: league.name,
  bookName: `${league.name.toUpperCase()} SPORTSBOOK`,
  tagline: `Official betting partner of ${league.name}`,
  leagueType: league.settings?.type === 2 ? "dynasty" : league.settings?.max_keepers > 0 ? "keeper" : "redraft",
  maxKeepers: league.settings?.max_keepers ?? 0,
  _verified: {
    date: new Date().toISOString().slice(0, 10),
    teams: league.total_rosters,
    scoringKeys: Object.keys(league.scoring_settings).length,
    rosterPositions: league.roster_positions,
    playoffWeekStart: league.settings?.playoff_week_start,
    playoffTeams: league.settings?.playoff_teams,
    tradeDeadline: league.settings?.trade_deadline,
  },
  // Everything below is Kunal's to fill in. The sheet builds without it; the
  // punishment markets simply carry placeholder names until he writes them.
  stakes: { buyIn: 0, teams: league.total_rosters, pot: 0, structure: "TBD", payouts: [] },
  punishment: {
    season: { name: "TBD", market: "lastPlace", copy: "" },
    weekly: { name: "LOW SCORER", market: "weeklyLowScorer", copy: "" },
  },
  lore: { rivalries: [], runningBits: [], notes: "" },
  seats: rosters
    .sort((a, b) => a.roster_id - b.roster_id)
    .map((r) => ({
      rosterId: r.roster_id,
      manager: byUser.get(r.owner_id)?.display_name ?? null,
      teamName: byUser.get(r.owner_id)?.metadata?.team_name ?? null,
      nameOverride: null,
    })),
});
console.log(`Wrote ${path}\nFill in stakes, punishment and lore, then: npm run refresh -- --league ${id}`);
