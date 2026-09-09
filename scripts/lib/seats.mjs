// roster_id → the names a sheet prints. config/leagues/<id>.json is the only
// human-edited file, so it is the ONLY source of team names: nameOverride first,
// then the teamName add-league seeded from Sleeper at onboarding. The committed
// pull deliberately carries no team_name (see pull.mjs), so an upstream rename —
// or an upstream name a human has overruled — cannot leak back onto a sheet.
// A team name really can be absent (Nick's roster 5 has none), so display_name
// is the last resort.
export function seatResolver(config, users) {
  const byUser = new Map(users.map((u) => [u.user_id, u]));
  const byRoster = new Map(config.seats.map((s) => [s.rosterId, s]));
  return (rosterId, ownerId) => {
    const seat = byRoster.get(rosterId) ?? {};
    const user = byUser.get(ownerId) ?? {};
    return {
      rosterId,
      manager: seat.manager ?? user.display_name ?? "?",
      team: seat.nameOverride ?? seat.teamName ?? user.display_name ?? `Roster ${rosterId}`,
    };
  };
}

// Sleeper team names change mid-season and add-league only seeds them once, so
// without a refresh every rename is a hand edit of the config. This re-reads what
// Sleeper currently says for each seat and reports what moved.
//
// It never touches `nameOverride`. That field exists precisely to overrule
// Sleeper — a slur the book refuses to print, a joke the house made — and a
// refresh that clobbered it would silently undo a deliberate decision. When an
// overridden seat is renamed upstream the new upstream name is still recorded in
// `teamName`, so the override can be dropped later without another fetch.
//
// Pure: takes the current seats and Sleeper's answer, returns new seats plus a
// human-readable change list. The caller decides whether to write.
export function mergeSeatNames(seats, users, rosters) {
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
    if (teamName !== seat.teamName) {
      changes.push({
        rosterId: seat.rosterId,
        kind: "team",
        from: seat.teamName,
        to: teamName,
        overridden: seat.nameOverride ?? null,
      });
      next.teamName = teamName;
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
