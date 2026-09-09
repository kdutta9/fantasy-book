// --refresh-names re-reads what Sleeper says into config. The property that
// matters is what it must NOT do: nameOverride is how the book deliberately
// overrules Sleeper (a slur it refuses to print, a joke the house made), so a
// refresh that clobbered one would silently undo a decision a human made.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeSeatNames, seatResolver } from "../scripts/lib/seats.mjs";

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
  const resolve = seatResolver({ seats: out }, [{ user_id: "u2", display_name: "tal262000" }]);
  assert.equal(resolve(2, "u2").team, "The DNs", "an overridden seat must still print the override");
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
