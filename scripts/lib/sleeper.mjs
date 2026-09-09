// The only module that knows Sleeper's URLs. Two hosts, and getting them wrong
// 404s (CLAUDE.md trap 2): projections and stats live on api.sleeper.COM,
// everything else on api.sleeper.APP.
//
// These .com endpoints are undocumented and carry no stability promise, so every
// response goes through a shape assertion that throws at pull time. A failed
// cron is far better than a silently wrong sheet (DESIGN.md §3.3).

const APP = "https://api.sleeper.app/v1";
const COM = "https://api.sleeper.com";

export const SCORING_POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"];
const posQuery = (positions) => positions.map((p) => `position[]=${p}`).join("&");

async function get(url, assert) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Sleeper ${res.status} ${res.statusText} — ${url}`);
  const body = await res.json();
  const problem = assert?.(body);
  if (problem) throw new Error(`Sleeper response shape changed — ${url}\n  ${problem}`);
  return body;
}

const isArrayOf = (label, fields) => (body) => {
  if (!Array.isArray(body)) return `expected an array of ${label}, got ${typeof body}`;
  if (!body.length) return `expected at least one ${label}, got an empty array`;
  const missing = fields.filter((f) => !(f in body[0]));
  return missing.length ? `${label}[0] is missing ${missing.join(", ")}` : null;
};

const hasFields = (label, fields) => (body) => {
  if (!body || typeof body !== "object") return `expected a ${label} object`;
  const missing = fields.filter((f) => !(f in body));
  return missing.length ? `${label} is missing ${missing.join(", ")}` : null;
};

// THE authority for the current week. Never use the machine clock (trap 4).
export const fetchState = () =>
  get(`${APP}/state/nfl`, hasFields("state", ["week", "season", "season_type"]));

export const fetchLeague = (id) =>
  get(`${APP}/league/${id}`, hasFields("league", ["name", "scoring_settings", "roster_positions", "settings"]));

export const fetchUsers = (id) => get(`${APP}/league/${id}/users`, isArrayOf("user", ["user_id", "display_name"]));

export const fetchRosters = (id) => get(`${APP}/league/${id}/rosters`, isArrayOf("roster", ["roster_id", "players"]));

export const fetchMatchups = (id, week) =>
  get(`${APP}/league/${id}/matchups/${week}`, isArrayOf("matchup", ["roster_id", "matchup_id"]));

export const fetchBracket = (id, kind) =>
  get(`${APP}/league/${id}/${kind}_bracket`, isArrayOf("bracket match", ["m", "r"]));

// 14.6 MB. Pull at most daily, commit slimmed. Never re-download per build.
export const fetchPlayers = () =>
  get(`${APP}/players/nfl`, (b) =>
    b && typeof b === "object" && Object.keys(b).length > 1000 ? null : "expected a large player_id → player map"
  );

const projAssert = isArrayOf("projection", ["player_id", "stats"]);

// K and DEF are REQUIRED — both leagues start both — and Sleeper serves them on
// a separate call from the skill positions.
export const fetchProjections = (season, week, positions) =>
  get(
    `${COM}/projections/nfl/${season}/${week}?season_type=regular&order_by=pts_ppr&${posQuery(positions)}`,
    projAssert
  );

// Rest-of-season shape (week: null, gp ~ 18) — fallback for unpublished weeks.
export const fetchSeasonProjections = (season, positions) =>
  get(`${COM}/projections/nfl/${season}?season_type=regular&${posQuery(positions)}`, projAssert);

export const fetchStats = (season, week, positions) =>
  get(`${COM}/stats/nfl/${season}/${week}?season_type=regular&${posQuery(positions)}`, projAssert);
