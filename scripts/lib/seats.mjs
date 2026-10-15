import { latestSince } from "./pricing.mjs";

// roster_id → the names a sheet prints. config/leagues/<id>.json is the only
// human-edited file, so it is the ONLY source of team names: an override first,
// then the seat's team name AS OF THE SHEET'S WEEK. The committed
// pull deliberately carries no team_name (see pull.mjs), so an upstream rename —
// or an upstream name a human has overruled — cannot leak back onto a sheet.
// A team name really can be absent, so display_name is the last resort.
//
// Overrides come in two forms. `nameOverride` is the simple always-on one. A
// `nameOverrides` TIMELINE is the gated one, read through the same `latestSince`
// every other config timeline uses: an entry carries the first week it applies
// and `name: null` ends the override without deleting the history of it.
//
// The timeline exists because an override is usually a joke about a particular
// week, and a joke about week 1 should still be on the week-1 sheet in November.
// Nick's roster 5 is the case that forced it: the house named the seat after Cal
// losing in week 1 because Chris had never set a team name, and then he set one.
// Rewriting week 1 to say "Need TE HMU" would make a posted sheet lie about what
// it said at the time, which is the freeze rule applied to words instead of
// prices.
//
// Upstream renames get the same treatment, for the same reason. `teamName` is the
// name the seat opened the season with, and `renames` is a timeline of what
// Sleeper said from each week on, so week 3 keeps printing week 3's name after the
// manager has changed it twice. Renaming is part of fantasy football; a posted
// sheet should record what the seat was called that week, not what it's called
// now. Before this, `teamName` was overwritten in place, and every rebuild of
// a past week quietly put today's name on it.
export function seatResolver(config, users, week) {
  const byUser = new Map(users.map((u) => [u.user_id, u]));
  const byRoster = new Map(config.seats.map((s) => [s.rosterId, s]));
  return (rosterId, ownerId) => {
    const seat = byRoster.get(rosterId) ?? {};
    const user = byUser.get(ownerId) ?? {};
    return {
      rosterId,
      manager: seat.manager ?? user.display_name ?? "?",
      team: overrideFor(seat, week) ?? teamNameFor(seat, week) ?? user.display_name ?? `Roster ${rosterId}`,
    };
  };
}

// A timeline wins where one exists; otherwise the flat field. `week` is optional
// so a caller with no week in hand still gets the flat override rather than
// silently dropping it.
const overrideFor = (seat, week) =>
  seat.nameOverrides ? (week == null ? null : latestSince(seat.nameOverrides, week)?.name ?? null) : seat.nameOverride ?? null;

// The upstream name in effect for `week`: the latest rename on or before it, or
// the opening `teamName`. A rename to null (a manager clearing his team name) is
// honoured, not skipped. No week means the current name.
export const teamNameFor = (seat, week) => {
  const rename = latestSince(seat.renames, week ?? Infinity);
  return rename ? rename.name : seat.teamName ?? null;
};

// Neither form of override is ever touched by a refresh — see below.

// Sleeper team names change mid-season and add-league only seeds them once, so
// without a refresh every rename is a hand edit of the config. This re-reads what
// Sleeper currently says for each seat and reports what moved. A rename is
// recorded as taking effect from `week`, the week being pulled, and never
// rewrites the name an earlier week printed.
//
// It never touches `nameOverride` or `nameOverrides`. They exist precisely to overrule
// Sleeper — a slur the book refuses to print, a joke the house made — and a
// refresh that clobbered it would silently undo a deliberate decision. When an
// overridden seat is renamed upstream the new upstream name is still recorded in
// `teamName`, so the override can be dropped later without another fetch.
//
// Pure: takes the current seats and Sleeper's answer, returns new seats plus a
// human-readable change list. The caller decides whether to write.
export function mergeSeatNames(seats, users, rosters, week) {
  if (!Number.isInteger(week)) throw new Error("mergeSeatNames needs the week a rename takes effect from");
  const byUser = new Map(users.map((u) => [u.user_id, u]));
  const ownerOf = new Map(rosters.map((r) => [r.roster_id, r.owner_id]));
  const changes = [];

  const merged = seats.map((seat) => {
    const user = byUser.get(ownerOf.get(seat.rosterId));
    // A roster with no owner (a seat abandoned mid-season) leaves the config as
    // it is rather than blanking a name to null.
    if (!user) {
      changes.push({ rosterId: seat.rosterId, kind: "unowned", note: "roster has no owner on Sleeper — left as is" });
      return seat;
    }
    const next = { ...seat };
    const teamName = user.metadata?.team_name ?? null;

    if (user.display_name && user.display_name !== seat.manager) {
      changes.push({ rosterId: seat.rosterId, kind: "manager", from: seat.manager, to: user.display_name });
      next.manager = user.display_name;
    }
    const current = teamNameFor(seat);
    if (teamName !== current) {
      changes.push({
        rosterId: seat.rosterId,
        kind: "team",
        from: current,
        to: teamName,
        overridden: overrideFor(seat, Infinity),
      });
      // Renamed twice before one sheet is posted: the later name wins that week.
      next.renames = [...(seat.renames ?? []).filter((r) => r.since !== week), { since: week, name: teamName }];
    }
    return next;
  });

  return { seats: merged, changes };
}

export const describeChange = (c) =>
  c.kind === "unowned"
    ? `roster ${c.rosterId}: ${c.note}`
    : c.kind === "manager"
      ? `roster ${c.rosterId}: manager ${c.from} → ${c.to}`
      : `roster ${c.rosterId}: ${c.from ?? "(no team name)"} → ${c.to ?? "(no team name)"}` +
        (c.overridden ? `  [still displayed as "${c.overridden}" — nameOverride untouched]` : "");
