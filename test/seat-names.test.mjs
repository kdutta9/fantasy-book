// --refresh-names re-reads what Sleeper says into config. The property that
// matters is what it must NOT do: nameOverride is how the book deliberately
// overrules Sleeper (a slur it refuses to print, a joke the house made), so a
// refresh that clobbered one would silently undo a decision a human made.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeSeatNames, seatResolver } from "../scripts/lib/seats.mjs";
import { readdirSync, existsSync } from "node:fs";
import { basename } from "node:path";
import { readJson } from "../scripts/lib/json.mjs";
import * as P from "../scripts/lib/paths.mjs";
import { allLeagueIds } from "../scripts/pull.mjs";

const rosters = [
  { roster_id: 1, owner_id: "u1" },
  { roster_id: 2, owner_id: "u2" },
  { roster_id: 3, owner_id: null },
];
const users = [
  { user_id: "u1", display_name: "kdutta", metadata: { team_name: "T-Posers" } },
  { user_id: "u2", display_name: "tal262000", metadata: { team_name: "Downsyndrome Njigbas" } },
];

test("picks up an upstream rename into teamName", () => {
  const seats = [{ rosterId: 1, manager: "kdutta", teamName: null, nameOverride: null }];
  const { seats: out, changes } = mergeSeatNames(seats, users, rosters);
  assert.equal(out[0].teamName, "T-Posers");
  assert.equal(changes.length, 1);
  assert.equal(changes[0].kind, "team");
});

test("NEVER touches nameOverride, and the sheet keeps printing the override", () => {
  const seats = [{ rosterId: 2, manager: "tal262000", teamName: null, nameOverride: "The DNs" }];
  const { seats: out, changes } = mergeSeatNames(seats, users, rosters);
  assert.equal(out[0].nameOverride, "The DNs", "the override was modified");
  // The upstream name IS recorded, so the override can be dropped later without
  // another fetch — but it must not reach the sheet.
  assert.equal(out[0].teamName, "Downsyndrome Njigbas");
  assert.equal(changes[0].overridden, "The DNs");
  const resolve = seatResolver({ seats: out }, [{ user_id: "u2", display_name: "tal262000" }], 1);
  assert.equal(resolve(2, "u2").team, "The DNs", "an overridden seat must still print the override");
});

test("a gated override applies to its own weeks and no others", () => {
  // The freeze rule applied to words: an override is usually a joke about one
  // particular week, and the sheet that posted it must keep saying so.
  const seats = [
    {
      rosterId: 2,
      manager: "tal262000",
      teamName: "Downsyndrome Njigbas",
      nameOverrides: [
        { since: 1, name: "The DNs" },
        { since: 3, name: null },
      ],
    },
  ];
  const resolve = seatResolver({ seats }, [{ user_id: "u2", display_name: "tal262000" }], 1);
  const at = (week) => seatResolver({ seats }, [{ user_id: "u2", display_name: "tal262000" }], week)(2, "u2").team;
  assert.equal(resolve(2, "u2").team, "The DNs");
  assert.equal(at(2), "The DNs", "the override still stands the week before it is lifted");
  assert.equal(at(3), "Downsyndrome Njigbas", "name: null falls through to the upstream name");
  assert.equal(at(9), "Downsyndrome Njigbas");
});

test("a refresh never touches a gated override either", () => {
  const seats = [
    { rosterId: 2, manager: "tal262000", teamName: null, nameOverrides: [{ since: 1, name: "The DNs" }] },
  ];
  const { seats: out, changes } = mergeSeatNames(seats, users, rosters);
  assert.deepEqual(out[0].nameOverrides, [{ since: 1, name: "The DNs" }], "the timeline was modified");
  assert.equal(out[0].teamName, "Downsyndrome Njigbas");
  assert.equal(changes[0].overridden, "The DNs", "the change log must say what is still being displayed");
});

test("a manager change is reported separately from a team rename", () => {
  const seats = [{ rosterId: 1, manager: "old-handle", teamName: "T-Posers", nameOverride: null }];
  const { seats: out, changes } = mergeSeatNames(seats, users, rosters);
  assert.equal(out[0].manager, "kdutta");
  assert.deepEqual(changes.map((c) => c.kind), ["manager"]);
});

test("an unowned roster is left alone rather than blanked", () => {
  const seats = [{ rosterId: 3, manager: "departed", teamName: "Some Team", nameOverride: null }];
  const { seats: out, changes } = mergeSeatNames(seats, users, rosters);
  assert.equal(out[0].teamName, "Some Team");
  assert.equal(changes[0].kind, "unowned");
});

test("no upstream change means no change list and no rewrite", () => {
  const seats = [{ rosterId: 1, manager: "kdutta", teamName: "T-Posers", nameOverride: null }];
  const { changes } = mergeSeatNames(seats, users, rosters);
  assert.equal(changes.length, 0);
});


// A sheet spells each seat exactly one way. The settlement block copies seats out
// of the PREVIOUS week's sheet, so a mid-season rename put both names for Nick's
// roster 5 on the same page — the settled board still said "Cal's Disappointing
// Week 1 Performance" while the card, the futures table and the bench board all
// said "Need TE HMU". Nothing about that is a pricing error, which is precisely
// why check-frozen could never catch it.
for (const leagueId of allLeagueIds()) {
  const dir = P.bookDir(leagueId);
  if (!existsSync(dir)) continue;
  for (const file of readdirSync(dir).filter((f) => /^w\d+\.json$/.test(f))) {
    const week = Number(basename(file, ".json").slice(1));
    test(`${leagueId} w${week}: one seat, one name across the whole sheet`, () => {
      const names = new Map();
      (function walk(node) {
        if (Array.isArray(node)) return node.forEach(walk);
        if (!node || typeof node !== "object") return;
        if (typeof node.rosterId === "number" && typeof node.team === "string") {
          const seen = names.get(node.rosterId);
          assert.ok(
            seen === undefined || seen === node.team,
            `roster ${node.rosterId} is called both "${seen}" and "${node.team}" on the same sheet`
          );
          names.set(node.rosterId, node.team);
        }
        Object.values(node).forEach(walk);
      })(readJson(P.bookFile(leagueId, week)));
    });
  }
}
