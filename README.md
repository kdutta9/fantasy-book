# The Fantasy Book

A weekly sportsbook for Kunal's two Sleeper leagues, built the same way
[`../worldcup`](../worldcup) is: committed inputs, a seeded Monte Carlo engine, American-odds
pricing with a scaled overround, and a static React sheet at `kdutta.com/fantasy`.

Read [DESIGN.md](DESIGN.md) for the spec and [CLAUDE.md](CLAUDE.md) for the traps.

---

## Run it locally

```bash
npm install
npm run dev
```

Then open **http://localhost:5173/fantasy/?book=nicks**. The committed sheets are in
`public/data/books/`, so the site runs with no network and no build step beyond Vite.

- `?book` — the lobby
- `?book=nicks` · `?book=dkenasty` — a league's newest sheet
- `?book=nicks&w=6` — a specific week
- `?book=crossover` — the cross-league sheet
- every panel is anchorable: `?book=nicks#the-joint-who-sings-what`

Rebuild the sheets from the committed inputs without touching Sleeper:

```bash
npm run refresh -- --no-pull
```

## The weekly operation

Tuesday or Wednesday morning ET. **Sheet W settles week W−1 and previews week W.**

```bash
npm run refresh          # pull Sleeper, build both leagues, then the crossover
npm run publish          # guards, commit, build, deploy to kdutta.com/fantasy
```

`refresh` builds each league in its own try. A DKEnasty failure still leaves Nick's sheet
written and publishable, and `npm run refresh -- --league nicks` works on its own.

For a late scratch Sleeper has not reflected yet:

```bash
npm run set-proj -- --week 6 --player "Bijan Robinson" --pts 0 --note "ruled out Sat"
npm run refresh -- --no-pull --week 6
```

That writes `projections/2026/w6.overrides.json` — committed, auditable, and printed in the
sheet's fine print. It never edits the pulled file.

## The guards

```bash
npm run check-frozen     # every committed sheet rebuilds byte-identical
npm test                 # 29 assertions across scoring, lines, futures, independence
```

`publish` runs both and refuses to ship if either is red.

| Guard | What it catches |
|---|---|
| `check-frozen` | A posted sheet repricing itself. The only causes are an overwritten input, a changed model constant, or something reading the wall clock. |
| `scoring.test` | Iterating the projection's stat keys instead of the league's `scoring_settings` — MAE against Sleeper's own `pts_ppr` must stay under 0.05 (measured 0.024 / 0.020). |
| `lines.test` | A broken variance model. Fair win probability must stay under 68%, totals in 245–290, every seat starting ten. |
| `futures.test` | A season board that treats a projection as fact — nobody is a lock to make the playoffs in week 1 — and the `gp` trap that made every defence worth 95 points a week. |
| `independence.test` | §6.6. Each league builds with every other league's files `chmod 000`, byte-for-byte identically. |

## Layout

```
config/            THE ONLY HUMAN-EDITED FILES
  leagues/*.json     seats, stakes, punishments, lore
  variance.json      weekly sigma(mu) per position, fitted on 2025 residuals
  season-variance.json  per-player season-form cv — what makes futures priceable
  cross-league.json  the six managers with a seat in both leagues

scripts/
  lib/               paths, json, pricing, rng, args, sleeper, slim, seats, book-index
  engine.mjs         mu, sigma, optimal lineups, draws, tallies — pure, no I/O
  season.mjs         the season simulator: schedule, standings, brackets
  markets.mjs        draws → priced markets — pure
  pull.mjs           Sleeper → committed inputs
  build-book.mjs     one league, one week, one sheet
  build-crossover.mjs  runs last, reads only the two committed sheets
  refresh.mjs  publish.mjs  check-frozen.mjs  set-proj.mjs  add-league.mjs
  calibrate.mjs  calibrate-season.mjs        # between seasons only

public/data/       committed inputs and every posted sheet
src/               the view, ported from ../worldcup
```

The rule that shapes everything: **a sheet is a pure function of committed inputs, its own
league's config, and a fixed seed.** Nothing fetches at build time, nothing reads the clock,
and once `books/<league>/w<N>.json` is committed it is frozen.

## Adding a third league

```bash
npm run add-league -- --user kdutta            # list league ids for a handle
npm run add-league -- --id bigleague --league-id 1234567890
```

That writes `config/leagues/bigleague.json` with real roster ids, handles and team names.
Fill in stakes, punishment and lore, then `npm run refresh -- --league bigleague`.

## Refitting the variance models

Between seasons only. Both files are inputs to every sheet ever posted; changing one changes
what every historic sheet would rebuild as.

```bash
node scripts/calibrate.mjs               # weekly sigma(mu), prints a comparison
node scripts/calibrate-season.mjs        # season-form cv
```

Neither writes without `--write`, and neither is wired to an npm script on purpose.
