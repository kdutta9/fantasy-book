# CLAUDE.md — agent notes

**Read [DESIGN.md](DESIGN.md) in full before writing any code.** It is a closed spec:
every endpoint, shape, model parameter and market was verified against the two live
leagues on 2026-09-09, and every open question has been answered by Kunal. You should not
need to ask him anything to build Phase 1.

This file is only the things most likely to trip you up.

## Start here

```bash
node reference/spike.mjs nicks 1        # the entire model, working, in one file
node reference/spike.mjs dkenasty 1
```

That prints a real priced board off live Sleeper data. It is the reference
implementation — lift it into `scripts/engine.mjs` rather than starting from scratch. It
is deliberately *not* the architecture (it fetches at runtime; the real pipeline commits
its inputs — DESIGN.md §4.2).

## The prior art is a sibling repo, and it is worth copying

`../worldcup` is a finished sportsbook with the same shape: a Monte Carlo engine, dated
immutable sheets, American-odds pricing with a scaled overround, and a React view that
already looks right. Read its `README.md` (Sportsbook + Live line movement) and its
`CLAUDE.md`. Port `american()` / `roundOdds()` / `price()` / `fieldMargin()` /
`latestSince()` and the whole `src/` view layer. Do not reinvent them.

Do not modify anything in `../worldcup`. It is frozen and its build guards must stay green.

## The five traps

1. **Iterate `scoring_settings`, never the projection's stat keys.** DEF projections carry
   `pts_allow: 16.0` — a raw value that is *not* a scoring key — right next to
   `pts_allow_14_20: 1.0`, which is. ~40 of the projection's keys have no scoring rule.
   Iterating the projection multiplies garbage. The spike has this right; keep it right.
   Regression test: your computed points must match Sleeper's own `pts_ppr` to a mean
   absolute error < 0.05. Measured 0.024 (Nick's) and 0.019 (DKEnasty).

2. **`api.sleeper.com` ≠ `api.sleeper.app`.** Projections and stats live on `.com`;
   everything else on `.app`. Getting this wrong 404s.

3. **Commit the projections.** Sleeper's projections mutate continuously. If the builder
   fetches them at build time, no sheet ever rebuilds identically and `check-frozen`
   cannot exist. `public/data/projections/2026/w<W>.json` is the exact analog of
   worldcup's `consensus/<date>.json`. This is the single most important architectural
   rule in the project.

4. **Never use the machine clock for the week number.** `/v1/state/nfl` is the authority.
   Worldcup has a whole section of scar tissue about UTC dates minting sheets a day early;
   don't re-earn it.

5. **Every input to a posted week is frozen — projections AND the league snapshot.**
   `pull.mjs` re-fetches neither once any book has a sheet for that week. Sleeper's numbers
   move continuously, and the snapshot carries a fresh `pulledAt` on every fetch, so a
   re-pull reprices a live sheet on nothing but a timestamp — which is exactly what
   `--refresh-names` did to all three leagues before this guard covered both doors.
   `--force-inputs` opens them, and you then owe a rebuild and re-publish of every sheet it
   touched. Onboarding a league mid-season instead *widens* the projections file
   additively — new scoring keys only, never a changed value.

6. **A sheet never inherits last week's copy.** Worldcup's documented failure mode is
   "prices reprice themselves, the words do not" — a missing specials board silently
   ships stale lines with fresh prices. Here, if a config timeline has no entry for the
   current week, the builder **generates** a board. It must never fall back to a previous
   week's. This inverts worldcup's behaviour on purpose (DESIGN.md §2.2).

7. **The leagues are independent — no league's sheet may read another league's data.**
   `books/nicks/w6.json` is a pure function of Nick's own inputs, config and seed. Cross-league
   slips are real and wanted, but they live on their own sheet built by a third pass that
   reads only the two committed league sheets (DESIGN.md §6.6–6.7). Build each league
   independently; `npm run refresh -- --league nicks` must work on its own, and a DKEnasty
   failure must still leave Nick's sheet publishable.

## Two pages per league, one for the crossover

`?book=<id>` is the week card; `?book=<id>&view=season` is the season/futures page and
carries the authored preview prose from each league config. The crossover ignores `view`.
Preview prose is written once against the week it cites (`preview.writtenWeek`) and then
left alone — it is editorial, not a generated market.

## Never reprice a posted sheet

Once `public/data/books/<league>/w<N>.json` is committed it is frozen. Anything that
changes what a market *means* is gated on a week number via `latestSince`, never switched
on globally. `npm run check-frozen` rebuilds every committed sheet and asserts
byte-identical output; it must stay green. Do not re-fit `config/variance.json`
mid-season — that would silently change the inputs to every historic sheet, the same class
of error as worldcup's `--backfill --force`.

## Three leagues, and none of them is the same book

| | Nick's | DKEnasty | LoOG |
|---|---|---|---|
| teams / starters | 12 / 10 | 12 / 10 | **10 / 9** |
| pays | places 1–4 | winner-take-all | places 1–3 |
| scoring keys | 48 (PPR preset) | 42 (PPR preset) | **147, custom** |
| consolation seats | 6 | 6 | **4** |
| lore | full | full | **none — deliberately** |

Nothing here may be hardcoded. Lineup size comes from `roster_positions`, field size from
the roster count, consolation shape from `rosterIds.length - playoffTeams`, and paying
places from `stakes.payouts`. Every constant that described "both leagues" produced a
false failure the moment the third arrived.

**LoOG's scoring is not Sleeper's PPR preset** (`pass_int` −2, custom FG distance tiers, a
full yards-allowed ladder), so its computed points legitimately do not match `pts_ppr` —
MAE 0.14 against 0.024 and 0.020 for the other two. `_verified.scoringMatchesSleeperPPR`
records which leagues the strict check applies to. The real guard for trap 1 is the direct
unit test in `test/scoring.test.mjs`, which needs no league data at all.

**LoOG gets no lore.** Empty `lore`, flat punishment copy, a two-paragraph factual
preview. It is not missing content — it is the boring book on purpose. It is also not on
the Crossover: only kdutta overlaps with the other two, and one shared seat is not a
cross-league board.

## Sanity check on any line you produce

Fantasy is a coin-flip sport, but the band is a property of the league, not a constant.
What generalises across all three books is **points per starter (12.3–14.4)** and the
**fair win probability (never above ~68%)** — so a 10-team league starting nine runs
totals in the 230s and can legitimately post −260 on a genuinely lopsided week, while a
12-team league starting ten runs in the 260s and tops out near −210. `test/lines.test.mjs`
derives all of this per league; do not reintroduce a fixed total band.

If you produce a −400 weekly moneyline the variance model is broken — most likely
`config/variance.json` isn't being applied, or you summed the wrong number of starters.

## Kunal's working style

He wants the strongest objection to an approach stated in one sentence before you build
it, trade-offs named rather than hidden, and honest reporting on what you did and didn't
verify. Don't commit or push unless he asks.
