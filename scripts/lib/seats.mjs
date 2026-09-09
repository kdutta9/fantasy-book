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
