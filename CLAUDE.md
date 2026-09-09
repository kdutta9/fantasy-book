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

5. **A sheet never inherits last week's copy.** Worldcup's documented failure mode is
   "prices reprice themselves, the words do not" — a missing specials board silently
   ships stale lines with fresh prices. Here, if a config timeline has no entry for the
   current week, the builder **generates** a board. It must never fall back to a previous
   week's. This inverts worldcup's behaviour on purpose (DESIGN.md §2.2).

6. **The two leagues are independent — no league's sheet may read another league's data.**
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

## The two leagues are not the same book

Nick's pays places 1–4; DKEnasty is winner-take-all. That is not cosmetic — it means
Nick's gets a four-deep place ladder and DKEnasty's championship board *is* the entire
financial book. Do not build one sheet and parameterize the name. See DESIGN.md §6.2.

## Sanity check on any line you produce

Fantasy is a coin-flip sport. Weekly moneylines belong in **−110 to −210**; totals around
**245–290** for these two 12-team full-PPR leagues. If you ever produce a −400 weekly
moneyline, the variance model is broken — most likely `config/variance.json` isn't being
applied, or you've summed the wrong number of starters (both leagues start 10: QB, RB, RB,
WR, WR, TE, FLEX, FLEX, K, DEF).

## Kunal's working style

He wants the strongest objection to an approach stated in one sentence before you build
it, trade-offs named rather than hidden, and honest reporting on what you did and didn't
verify. Don't commit or push unless he asks.
