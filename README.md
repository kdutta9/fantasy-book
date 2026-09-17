# The Fantasy Book

A weekly sportsbook for Kunal's three Sleeper leagues, built the same way
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
- `?book=nicks` · `?book=dkenasty` · `?book=loog` — a league's newest sheet
- `?book=nicks&w=6` — a specific week; the week dropdown walks every posted sheet
- every panel is anchorable: `?book=nicks#the-joint-who-sings-what`

Rebuild the sheets from the committed inputs without touching Sleeper:

```bash
npm run refresh -- --no-pull
```

## Writing a week

Prose lives in `content/<league>/w<N>.md` and is **not** an input to the builder. A sheet is
frozen once posted, so copy inside it would make every typo fix a reprice; keeping the two
apart means the numbers are immutable and the words are not. Vite loads the files straight
into the bundle, so `npm run dev` hot-reloads a save with no rebuild.

```bash
npm run notes -- --week 2                 # scaffold all three leagues off the built sheets
npm run notes -- --league nicks --week 2 --force
npm run notes -- --check                  # which posted weeks have no prose
```

The scaffold writes every section with the relevant figures already in an HTML comment —
prices, last week's scores, who left what on the bench — so writing is voice, never lookup.
Comments are stripped by the renderer, which means a half-written file is publishable: an
empty section is dropped and the board under it ships as it is.

A file is frontmatter plus `##` headings. **A lowercase heading is a slot** and lands in a
specific panel; anything else becomes its own panel, titled as you wrote it.

| Slot | Where it lands |
|---|---|
| `lede` | its own block above everything, under `headline` / `byline` |
| `settled` | the HOW WEEK N SETTLED panel |
| `bench` | POINTS LEFT ON THE BENCH |
| `card` | replaces the default blurb under THE CARD |
| `matchup:8-10` | attached to that row, by **roster id**, either order |
| `punishment` · `punishment-paired` · `joint` · `lineups` | those panels |
| `season` | replaces the config `preview` on `&view=season` |
| `## Anything Else` | a new panel titled ANYTHING ELSE |

Roster ids and not team names, because names are display-only and change mid-season.

**A week never inherits the previous week's prose.** No file, no words — the same rule the
generated boards follow, and the reason worldcup's "prices reprice themselves, the words do
not" cannot happen here.

## The weekly operation

Tuesday or Wednesday morning ET. **Sheet W settles week W−1 and previews week W.**

```bash
npm run refresh          # pull Sleeper, build every league
npm run notes -- --week <W>   # scaffold the week's prose, then write it
npm run publish          # guards, commit, build, deploy to kdutta.com/fantasy
```

The settling half is automatic. `pull` fetches the final scores for every week already
played into `leagues/<id>/results/w<N>.json` — written once, never re-fetched, and carrying
no timestamp, because a settled week is immutable — and `settle.mjs` grades the previous
sheet against them: final scores, favourites' record straight up and against the spread,
totals, a Brier score against the 0.250 a coin flip scores, the punishment markets settled
by name, and points left on the bench per seat.

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
npm test                 # 101 assertions across scoring, lines, futures, independence
```

`publish` runs both and refuses to ship if either is red.

| Guard | What it catches |
|---|---|
| `check-frozen` | A posted sheet repricing itself. The only causes are an overwritten input, a changed model constant, or something reading the wall clock. |
| `scoring.test` | Iterating the projection's stat keys instead of the league's `scoring_settings` — MAE against Sleeper's own `pts_ppr` must stay under 0.05 (measured 0.024 / 0.020). |
| `lines.test` | A broken variance model. Each matchup's simulated win probability must match the closed form implied by the sheet's own projections and `config/variance.json` to within 3 points — measured 0.75 at worst, and 15.7 if the fitted sigmas are halved. Plus points per starter, lineup size, and a rule that nobody outscores their own best available lineup. |
| `futures.test` | A season board that treats a projection as fact — nobody is a lock to make the playoffs *in week 1*, where that statement means something — the `gp` trap that made every defence worth 95 points a week, and that banked results and simulated ones are the same currency (mean win total is always half the schedule). |
| `independence.test` | §6.6. Each league builds with every other league's files `chmod 000`, byte-for-byte identically. |
| `seat-names.test` | Two names for one seat on one sheet. Nothing reprices, so `check-frozen` cannot see it — a mid-season rename did exactly this to the settlement board. |

## Layout

```
config/            THE ONLY HUMAN-EDITED FILES
  leagues/*.json     seats, stakes, punishments, lore, name overrides
  variance.json      weekly sigma(mu) per position, fitted on 2025 residuals
  season-variance.json  per-player season-form cv — what makes futures priceable

scripts/
  lib/               paths, json, pricing, rng, args, sleeper, slim, seats, book-index
  engine.mjs         mu, sigma, optimal lineups, draws, tallies — pure, no I/O
  season.mjs         the season simulator: schedule, standings, brackets
  markets.mjs        draws → priced markets — pure
  pull.mjs           Sleeper → committed inputs
  build-book.mjs     one league, one week, one sheet
  settle.mjs         grades a posted sheet against what happened — pure
  notes.mjs          scaffolds content/<league>/w<N>.md off a built sheet
  refresh.mjs  publish.mjs  check-frozen.mjs  set-proj.mjs  add-league.mjs
  calibrate.mjs  calibrate-season.mjs        # between seasons only

content/           the editorial layer — one .md per league per week, hot-reloaded
public/data/       committed inputs and every posted sheet
src/               the view, ported from ../worldcup
```

The rule that shapes everything: **a sheet is a pure function of committed inputs, its own
league's config, and a fixed seed.** Nothing fetches at build time, nothing reads the clock,
and once `books/<league>/w<N>.json` is committed it is frozen.

## Adding a league

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
