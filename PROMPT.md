# One-shot build prompt

Paste this as the first message in a fresh Claude Code session with
`~/Desktop/projects/fantasy-book` as the working directory.

---

Build the fantasy sportsbook described in `DESIGN.md`.

`CLAUDE.md` and `DESIGN.md` are authoritative and the spec is closed — every endpoint,
shape, model parameter, stake, punishment and market in them was verified against the two
live Sleeper leagues on 2026-09-09. You should not need to ask me anything to build this.
Read both in full before writing code.

Three things already exist and are correct — build on them, don't re-derive them:

- `reference/spike.mjs` — the whole model working end to end. Run it first
  (`node reference/spike.mjs nicks 1`) to see a real priced board, then lift it into
  `scripts/engine.mjs`.
- `config/leagues/*.json`, `config/variance.json`, `config/cross-league.json` — real seats,
  stakes, punishments, and a variance model fitted on 2025 residuals.
- `../worldcup` — a finished sportsbook with the same shape. Port its pricing helpers and
  its entire view layer rather than writing new ones. Do not modify anything in it.

**Done means:** both leagues have a week-1 sheet live at `kdutta.com/fantasy`, showing
weekly matchup lines (moneyline, spread, total) and the weekly punishment markets — Nick's
KARAOKE / SONG SELECT, DKEnasty's THE PARLAY WINDOW. That's Phase 1 in §9. If you get there
with room left, keep going into Phase 2; if you run short, ship Phase 1 complete rather
than Phase 2 half-done.

**Guards that must be green before you call it done:**

- Your computed projected points match Sleeper's own `pts_ppr` to a mean absolute error
  < 0.05 in both leagues. Keep this as a test, not a one-time check.
- `npm run check-frozen` exists and passes.
- Weekly moneylines land in −110 to −210 and totals in 245–290. Anything outside that means
  the variance model isn't being applied — stop and find out why rather than shipping it.
- Each league builds independently. `npm run refresh -- --league nicks` works alone, and a
  DKEnasty failure still leaves Nick's sheet publishable. No league's sheet may read another
  league's data (§6.6).
- Ensure the user can build this site locally and spot-check. Needed before a publish.

Design decisions inside the spec are yours — file layout, how you structure the engine, how
the sheet is laid out beyond what the worldcup view already gives you. Where DESIGN.md
states a fact it was verified; where it suggests an approach, use your judgment and tell me
if you'd do it differently.

Before you start, give me the strongest objection to the plan in one or two sentences — if
you don't have one, say "no objection." Then build. Don't commit or push; show me the
running sheets and I'll decide.
