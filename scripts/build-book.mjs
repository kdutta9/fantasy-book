#!/usr/bin/env node
// One league, one week, one sheet (DESIGN.md §6.6). Reads ONLY:
//
//   config/leagues/<id>.json
//   config/variance.json                        config/season-variance.json
//   public/data/leagues/<id>/{weeks/w<W>,schedule,bracket}.json
//   public/data/projections/<season>/w<W>.json  (+ .overrides.json)
//   public/data/projections/<season>/season.json
//   public/data/players/<playersDate>.json      (named by the week file)
//
// and nothing else. No other league's data, no clock, no network. That is what
// makes check-frozen a real test rather than a ritual: rebuild, compare bytes.
//
//   npm run build-book -- --league nicks --week 1

import { readJson, readJsonIf, writeJson } from "./lib/json.mjs";
import { addWeek, registerBook } from "./lib/book-index.mjs";
import * as P from "./lib/paths.mjs";
import { seatResolver } from "./lib/seats.mjs";
import { DISCLOSURES, sourcesLine } from "./lib/disclosures.mjs";
import { seedFor } from "./lib/rng.mjs";
import { optimalLineup, projectedPoints, tallyExtremes } from "./engine.mjs";
import { simulateSeason } from "./season.mjs";
import { crossoverBlock, matchupBoard, punishmentBoard, seasonBoard } from "./markets.mjs";
import { option } from "./lib/args.mjs";

export const SIMS = 25000; // §5.5 — below ~10k the tail markets get noisy

export function buildBook({ leagueId, week, sims = SIMS }) {
  const config = readJson(P.leagueConfigPath(leagueId));
  const variance = readJson(P.configPath("variance.json"));
  const seasonVariance = readJson(P.configPath("season-variance.json"));
  const snapshot = readJson(P.leagueWeekFile(leagueId, week));
  const { season, league, users, rosters, matchups, playersDate, pulledAt } = snapshot;

  const schedule = readJson(P.leagueFile(leagueId, "schedule"));
  const bracket = readJson(P.leagueFile(leagueId, "bracket"));
  const players = readJson(P.playersFile(playersDate));
  // Overrides are folded in here, never edited into the pulled file, so the
  // patch stays auditable and the pull stays a faithful record (§4.4). Each
  // override carries its own note and prior value; only `.stats` prices.
  const overrides = readJsonIf(P.projOverridesFile(season, week), {});
  const projections = { ...readJson(P.projFile(season, week)) };
  for (const id in overrides) projections[id] = overrides[id].stats;

  // Weeks after this one are priced off the rest-of-season projection reduced to
  // a per-game rate, not off this week's. Using this week's for all fourteen
  // would bake week 1's byes and scratches into the whole season: a seat whose
  // RB1 is out on Sunday would be modelled as having no RB1 until Christmas.
  const perGame = perGameProjections(readJson(P.seasonProjFile(season)));

  const positionOf = (id) => players[id]?.p ?? null;
  const lineupsFor = (source) => {
    const cache = new Map();
    const muOf = (id) => {
      if (!cache.has(id)) cache.set(id, projectedPoints(league.scoring_settings, source[id]));
      return cache.get(id);
    };
    return new Map(
      rosters.map((r) => [
        r.roster_id,
        optimalLineup({
          playerIds: r.players,
          excluded: new Set([...r.reserve, ...r.taxi]), // §5.3 — neither is lineup-eligible
          muOf,
          positionOf,
          rosterPositions: league.roster_positions,
        }),
      ])
    );
  };
  const lineups = lineupsFor(projections);
  const restLineups = lineupsFor(perGame);

  const rosterIds = rosters.map((r) => r.roster_id).sort((a, b) => a - b);
  const seed = seedFor(leagueId, week);
  const throughWeek = Math.max(...Object.keys(schedule.weeks).map(Number));
  const { current: scores, acc } = simulateSeason({
    rosterIds,
    weekLineups: lineups,
    restLineups,
    variance,
    seasonVariance,
    schedule: schedule.weeks,
    week,
    throughWeek,
    bracket,
    playoffTeams: league.settings.playoff_teams,
    sims,
    seed,
  });
  const tally = tallyExtremes(rosterIds, scores, sims);

  const resolve = seatResolver(config, users);
  const ownerOf = new Map(rosters.map((r) => [r.roster_id, r.owner_id]));
  const seatOf = (id) => resolve(id, ownerOf.get(id));
  const projectionOf = (id) => lineups.get(id).reduce((sum, p) => sum + p.mu, 0);

  const punishment = punishmentBoard({ tally, sims, seatOf, punishment: config.punishment.weekly });

  return {
    id: leagueId,
    week,
    season,
    bookName: config.bookName,
    tagline: config.tagline,
    displayName: config.displayName,
    stakes: stakesBlock(config.stakes),
    // Authored season-preview prose (config/leagues/<id>.json → preview). Copy,
    // not numbers: it is written once at week 1 and cites that week's board, the
    // same way worldcup's posts.jsx copies figures off the sheet it cites rather
    // than joining them at runtime. `preview.week` records when it was written so
    // a later sheet can say so instead of pretending it is current.
    preview: config.preview ? { ...config.preview, writtenWeek: config.preview.writtenWeek ?? 1 } : null,
    meta: {
      seed,
      sims,
      sources: sourcesLine(sims),
      // Derived from the committed pull, never the wall clock — a `new Date()`
      // here would make every rebuild differ and check-frozen impossible.
      pulledAt,
      playersDate,
      scoringKeys: Object.keys(league.scoring_settings).length,
      throughWeek,
      mae: scoringMae(league.scoring_settings, projections),
      overrides: Object.values(overrides).map(({ player, was, pts, note }) => ({ player, was, pts, note })),
      disclosures: DISCLOSURES,
    },
    matchups: matchupBoard({ pairings: matchups, scores, sims, seatOf, projectionOf }),
    punishment: {
      weekly: punishment.low,
      paired: punishment.paired,
      joints: punishment.joints,
      season: { name: config.punishment.season.name, copy: config.punishment.season.copy },
    },
    futures: seasonBoard({
      rosterIds,
      acc,
      sims,
      seatOf,
      stakes: config.stakes,
      seasonPunishment: config.punishment.season,
    }),
    lineups: rosterIds.map((id) => ({
      ...seatOf(id),
      projected: Math.round(projectionOf(id) * 10) / 10,
      players: lineups.get(id).map((p) => ({
        slot: p.slot,
        name: p.id == null ? null : players[p.id]?.n ?? p.id,
        position: p.position,
        team: p.id == null ? null : players[p.id]?.t ?? null,
        mu: Math.round(p.mu * 10) / 10,
      })),
      // Named on the sheet: a forfeited slot is worth ~8 points and it is the
      // single biggest thing moving this seat's line.
      emptySlots: lineups.get(id).filter((p) => p.id == null).map((p) => p.slot),
    })),
    // What a typical remaining week looks like for each seat — the input the
    // futures board is priced off, printed so it can be checked rather than
    // taken on faith.
    restOfSeason: rosterIds.map((id) => ({
      ...seatOf(id),
      projected: Math.round(restLineups.get(id).reduce((sum, p) => sum + p.mu, 0) * 10) / 10,
    })),
    crossover: crossoverBlock({ rosterIds, scores, sims, seatOf, pairings: matchups, tally }),
  };
}

// The regression guard, carried on every sheet rather than run once: the dot
// product must reproduce Sleeper's own pts_ppr (CLAUDE.md trap 1). Nick's
// measured 0.024, DKEnasty 0.019; the test asserts < 0.05.
export function scoringMae(scoringSettings, projections) {
  let n = 0;
  let error = 0;
  for (const id in projections) {
    const stats = projections[id];
    if (stats.pts_ppr == null) continue;
    n++;
    error += Math.abs(projectedPoints(scoringSettings, stats) - stats.pts_ppr);
  }
  return n ? Math.round((error / n) * 1e4) / 1e4 : null;
}

const stakesBlock = (stakes) => ({
  buyIn: `$${stakes.buyIn}`,
  pot: `$${stakes.pot.toLocaleString("en-US")}`,
  structure: stakes.structure,
  payouts: stakes.payouts.map((p) => ({ place: p.place, label: p.label, note: p.note ?? null })),
  // Carried through so the view can accrue it against the reader's own clock —
  // fourth place is playing for the interest, and it should tick. The builder
  // cannot compute it: a wall-clock read here would make every rebuild differ.
  hysa: stakes.hysa ?? null,
});

// The rest-of-season projection is a season total; dividing it by the season's
// game count gives the typical week the season simulator needs.
//
// It must NOT be divided by the row's own `gp`. DEF rows carry `gp: 1` while
// every skill row carries 18, so a per-row divisor makes each defence worth
// ~95 points a week and inflates every team's season projection by 70 points —
// the same shape of trap as `pts_allow` (CLAUDE.md trap 1): a field that looks
// like the one you want and isn't. One divisor for the whole file, taken from
// the rows that report a plausible one.
function perGameProjections(seasonProjections) {
  const games = seasonGameCount(seasonProjections);
  const perGame = {};
  for (const id in seasonProjections) {
    const { gp, ...stats } = seasonProjections[id];
    perGame[id] = Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, v / games]));
  }
  return perGame;
}

function seasonGameCount(seasonProjections) {
  const tally = new Map();
  for (const id in seasonProjections) {
    const gp = seasonProjections[id].gp;
    if (gp >= 10) tally.set(gp, (tally.get(gp) ?? 0) + 1);
  }
  if (!tally.size) throw new Error("No season projection row reports a plausible game count");
  return [...tally].sort((a, b) => b[1] - a[1])[0][0];
}

export function writeBook(book) {
  const path = P.bookFile(book.id, book.week);
  writeJson(path, book);
  addWeek(book.id, book.week);
  registerBook({ id: book.id, name: book.displayName, bookName: book.bookName });
  return path;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const state = readJson(P.statePath);
  const leagueId = option("--league");
  const week = Number(option("--week", state.week));
  if (!leagueId) throw new Error("build-book needs --league <id>");
  const path = writeBook(buildBook({ leagueId, week }));
  console.log(`Wrote ${path}`);
}
