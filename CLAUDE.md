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

## The traps

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

8. **`projections/<season>/season.json` is frozen; week 2+ reads `season-w<W>.json`.**
   Every other input learned the freeze in trap 5 and this one did not, because it has no
   week in its name. It is the rest-of-season projection that prices every futures board,
   `pull` used to overwrite it unconditionally, and a week into the season **26 of its
   3,304 rows had already moved** — so the first `npm run pull` of week 2 would have
   repriced all three leagues' week-1 futures and turned `check-frozen` red. `pull` now
   writes `season-w<W>.json`; `build-book` prefers it and falls back to the un-versioned
   file, which is the copy week 1 was posted against and must never be written again.

9. **A results file is written once and carries no timestamp.** `leagues/<id>/results/w<N>.json`
   holds the final scores that sheet W+1 settles against, so it is an ordinary frozen
   input. `pull` only fetches weeks strictly before the current one (a week in progress has
   live points), only fetches a file that does not exist, and `--force-inputs` deliberately
   does not reopen it. A settled week has nothing a second pull could legitimately change.

10. **The bench board's pool is `players_points`, not the Tuesday roster.** "Points left on
    the bench" takes the optimal lineup over the roster Sleeper *scored* that week. Take it
    over the pre-week snapshot instead and a manager who starts a mid-week waiver pickup
    reports a **negative** figure — bmilgram started a Steelers defence he claimed on
    Thursday and came out 14.5 points above his own "best available" lineup.
    `test/lines.test.mjs` asserts `left >= 0`.

11. **Prose is not an input to the builder, and it never inherits.** `content/<league>/w<N>.md`
    is loaded by the view, not by `build-book.mjs`, which is what keeps a posted sheet frozen
    while a typo is still fixable. No file for a week means no prose — never last week's.
    `npm run notes` scaffolds a week with every figure already in an HTML comment; the
    renderer strips comments, so an unfinished file still publishes. See README, *Writing a
    week*.

12. **An override is a joke about a week, so gate it.** A seat's displayed name resolves
    override → `teamName` → `display_name`, and the override comes in two forms: flat
    `nameOverride`, or a `nameOverrides` timeline read through `latestSince` where
    `name: null` lifts it. Nick's roster 5 is why: the house named the seat after Cal's
    week-1 loss because Chris had never set a team name, then in week 2 he set one
    (`Need TE HMU`). Rewriting week 1 would make a posted sheet lie about what it said at
    the time — the freeze rule applied to words. The timeline keeps week 1 byte-identical
    and prints the real name from week 2.

    An upstream rename with no override attached is different and is simply rebuilt:
    `pull --refresh-names` picks it up, and CLAUDE.md's own §4.3b position holds — names
    are display-only, and LoOG roster 4's rename diffed to exactly eighteen `team` fields
    in a committed week-1 sheet and nothing else. Check the diff; if it is not only names,
    something else moved.

## Two pages per league

`?book=<id>` is the week card; `?book=<id>&view=season` is the season/futures page and
carries the authored preview prose from each league config.
Preview prose is written once against the week it cites (`preview.writtenWeek`) and then
left alone — it is editorial, not a generated market. A `## season` section in that week's
`content/<league>/w<N>.md` overrides it for that week only; the config block stays the
default, and week 1's committed sheets still carry their own copy.

From week 2 the card opens with **HOW WEEK N−1 SETTLED** — the scores, the favourites'
record straight up and against the spread, the totals, a Brier score against the 0.250 a
coin flip scores, the punishment markets settled by name, and points left on the bench.
`scripts/settle.mjs` builds it from three committed artifacts belonging to that league
alone: its own previous sheet, that week's results file, and that week's roster snapshot.
It is the only place the pipeline reads a book's own prior output, and §6.6 still holds.

## The Crossover is retired

DESIGN.md §6.7 specified a third pass building a cross-league sheet from the two
committed league sheets, and it shipped for week 1. It was removed in week 2 and the whole
thing is deleted: `build-crossover.mjs`, `config/cross-league.json`,
`public/data/books/crossover/`, the lobby entry, the `kind` sort key and the view.

The reason is the one already written into the LoOG note above. Six managers overlapped
Nick's and DKEnasty, which was a board; only Kunal overlaps LoOG, and one shared seat is
not. A surface that covers two of three leagues, lags them both because it can only build
once every league has posted, and needs its own pass in `refresh` is not carrying its
weight. **Do not rebuild it without a real reason** — a fourth league with genuine overlap
would be one.

One fragment survives on purpose. Week 1's sheets were posted carrying a `crossover`
block of per-seat probabilities, so `markets.mjs` still exports `crossoverBlock` and
`build-book.mjs` emits it for weeks ≤ `CROSSOVER_THROUGH_WEEK` (= 1). Removing a key from
a frozen artifact is still rewriting it. Delete the two together, and rebuild week 1, if it
is ever genuinely in the way.

## Never reprice a posted sheet

Once `public/data/books/<league>/w<N>.json` is committed it is frozen. Anything that
changes what a market *means* is gated on a week number via `latestSince`, never switched
on globally. `npm run check-frozen` rebuilds every committed sheet and asserts
byte-identical output; it must stay green. Do not re-fit `config/variance.json`
mid-season — that would silently change the inputs to every historic sheet, the same class
of error as worldcup's `--backfill --force`.

The corollary, learned the hard way in week 2: **when a new field or behaviour would change
an already-posted sheet's bytes, gate it.** `settled` is spread in conditionally rather than
written as `settled: null`, so week 1 is untouched. Banking played results into the season
sim needed no gate only because every seat's record is genuinely 0-0 in week 1 — check, do
not assume.

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
the Crossover — and as of week 2 neither is anything else, because the Crossover is
gone. See below.

## Sanity check on any line you produce

Fantasy is a coin-flip sport, but the band is a property of the league, not a constant.
What generalises across all three books is **points per starter (12.3–14.4)**, and
`test/lines.test.mjs` derives that per league; do not reintroduce a fixed total band.

**The price ceiling was a constant too, and it broke in week 2.** "Fair win probability
never above ~68%" was measured off week 1, which happened to contain no genuinely lopsided
matchup. Week 2 produced a real 24-point projected edge in DKEnasty (145.8 vs 122.1) and
another in LoOG, priced at 76.7% and 77.8% — with both lineups verified optimal, bench
included, and the empirical team σ measured at 21.2 against the model's 23.2 across 34
real week-1 scores. The model was right and the constant was wrong, exactly the way every
"both leagues" constant was wrong the moment LoOG arrived.

So the guard now asserts the thing the ceiling was only ever a proxy for: **the sim's own
win probability must match the closed form** computed from the sheet's projections and
`config/variance.json` (a sum of ~10 independent draws a side is very nearly Normal).
Measured agreement across all six committed sheets is **0.75 points at worst** against a
3-point tolerance; halving the fitted sigmas moves it to 15.7 and fails. A loose 90%
backstop remains, because nothing in this sport is a lock.

If a price ever disagrees with its own closed form, the variance model is not being
applied as priced — most likely `config/variance.json` isn't loaded, or you summed the
wrong number of starters. A −400 moneyline on its own is no longer evidence of anything;
check the delta, not the price.

## Kunal's working style

He wants the strongest objection to an approach stated in one sentence before you build
it, trade-offs named rather than hidden, and honest reporting on what you did and didn't
verify. Don't commit or push unless he asks.
