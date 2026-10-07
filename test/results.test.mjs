// The results files are the only record of what happened, and every settled
// board, every banked win and every futures price downstream reads them. The
// matchups endpoint they come from can disagree with the league's own standings
// — a commissioner-reversed trade did exactly that in Nick's week 4 — so each
// results file is reconciled against the standings Sleeper reported one week
// later, which the next snapshot already carries in `settings`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readJson } from "../scripts/lib/json.mjs";
import * as P from "../scripts/lib/paths.mjs";
import { allLeagueIds, repairReversedTrades } from "../scripts/pull.mjs";

test("a starter scored on another roster is rescored where he started", () => {
  // Nick's week 4 in miniature: each side's starters were rewritten to the
  // pre-trade player, whose points stayed on the other side's row.
  const rows = [
    { roster_id: 8, matchup_id: 1, points: 10, starters: ["purdy", "gibbs"], players_points: { goff: 20.48, gibbs: 10 } },
    { roster_id: 9, matchup_id: 2, points: 5, starters: ["goff", "kyren"], players_points: { purdy: 19.62, kyren: 5 } },
    { roster_id: 4, matchup_id: 1, points: 12, starters: ["lamb"], players_points: { lamb: 12 } },
  ];
  const { rosters, repairs } = repairReversedTrades(rows);
  const [arnst, kobe, oanta] = rosters;
  assert.equal(kobe.points, 29.62);
  assert.equal(oanta.points, 25.48);
  assert.deepEqual(kobe.playerPoints, { gibbs: 10, purdy: 19.62 }, "goff belongs to the roster that started him");
  assert.deepEqual(arnst, { rosterId: 4, matchupId: 1, points: 12, starters: ["lamb"], playerPoints: { lamb: 12 } });
  assert.deepEqual(repairs.map((r) => r.rosterId), [8, 9]);
});

test("an empty slot or an unscored starter is not a reversal", () => {
  const rows = [{ roster_id: 1, matchup_id: 1, points: 7, starters: ["0", "bye"], players_points: { bench: 3 } }];
  const { rosters, repairs } = repairReversedTrades(rows);
  assert.equal(repairs.length, 0);
  assert.equal(rosters[0].points, 7);
});

for (const leagueId of allLeagueIds()) {
  for (let week = 2; existsSync(P.leagueWeekFile(leagueId, week)); week++) {
    if (!existsSync(P.leagueResultsFile(leagueId, week - 1))) continue;
    test(`${leagueId}: results through week ${week - 1} reconcile with Sleeper's standings`, () => {
      // W-L exactly. Points to within a point rather than a cent: a Sleeper stat
      // correction can land after an earlier results file was frozen, and that
      // is disclosed, not a bug. A misattributed starter is ten-plus points.
      const totals = new Map();
      for (let w = 1; w < week; w++) {
        const byMatchup = new Map();
        for (const r of readJson(P.leagueResultsFile(leagueId, w)).rosters) {
          const t = totals.get(r.rosterId) ?? { wins: 0, losses: 0, ties: 0, points: 0 };
          t.points += r.points;
          totals.set(r.rosterId, t);
          if (r.matchupId == null) continue;
          byMatchup.set(r.matchupId, [...(byMatchup.get(r.matchupId) ?? []), r]);
        }
        for (const [a, b] of byMatchup.values()) {
          const [ta, tb] = [totals.get(a.rosterId), totals.get(b.rosterId)];
          if (a.points === b.points) (ta.ties++, tb.ties++);
          else if (a.points > b.points) (ta.wins++, tb.losses++);
          else (ta.losses++, tb.wins++);
        }
      }
      for (const roster of readJson(P.leagueWeekFile(leagueId, week)).rosters) {
        const s = roster.settings;
        const ours = totals.get(roster.roster_id);
        const official = s.fpts + (s.fpts_decimal ?? 0) / 100;
        assert.deepEqual(
          [ours.wins, ours.losses, ours.ties],
          [s.wins, s.losses, s.ties ?? 0],
          `roster ${roster.roster_id}: results say ${ours.wins}-${ours.losses}, Sleeper says ${s.wins}-${s.losses}`
        );
        assert.ok(
          Math.abs(ours.points - official) < 1,
          `roster ${roster.roster_id}: results sum to ${ours.points.toFixed(2)}, Sleeper says ${official.toFixed(2)}`
        );
      }
    });
  }
}
