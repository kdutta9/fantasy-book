# Fantasy Sportsbook — technical design

A weekly sportsbook sheet for Kunal's two Sleeper leagues, deployed as a static site at
`kdutta.com/fantasy`, built the same way `kdutta.com/worldcup` is.

**This is a closed spec.** Every endpoint, shape and model parameter below was executed
against the two live leagues on 2026-09-09. Every design question has an answer. Build
Phase 1 (§9) without asking anything.

**Run `node reference/spike.mjs nicks 1` first** — the whole model in one file, printing a
real board off live data.

---

## 0. The leagues (verified 2026-09-09; LoOG added week 1)

A third league — **League of Ordinary Gentlemen** (`loog`, `1391548738874413056`) — was
onboarded on 2026-09-09. It is 10 teams / 9 starters / 147 custom scoring keys, pays three
places off a $50 buy-in, has a **4-seat consolation bracket** rather than 6, and carries no
lore by request. Adding it forced three generalisations that should have been there from
the start: `season.mjs` now implements both consolation shapes, `test/lines.test.mjs`
derives its bands per league instead of hardcoding a 12-team/10-starter one, and
`pull.mjs` refuses to overwrite a posted week's projections. It is not on the Crossover —
only kdutta overlaps the other two.

## 0a. The original two leagues

Season 2026, week 1, `season_start_date: 2026-09-09`.

| | **Nick's** | **DKEnasty** |
|---|---|---|
| config id | `nicks` | `dkenasty` |
| league_id | `1389753891322593280` | `1312065600469606400` |
| Sleeper name | "Nick's" | "Dynasty" |
| type | `0` — redraft, `max_keepers: 1` | `2` — **dynasty** |
| teams | 12 | 12 |
| starters (10) | QB RB RB WR WR TE **FLEX FLEX** K DEF | identical |
| bench | 4 | 7 |
| scoring | full PPR, **48** keys | full PPR, **42** keys |
| regular season | weeks 1–14 | weeks 1–14 |
| playoffs | wks 15/16/17, 6 teams, top-2 bye | identical |
| trade deadline | week 11 | week 11 |
| roster size | 15–16 | 17–19 |
| **buy-in** | **$50** (pot $600) | **$100** (pot $1,200) |
| **payout** | **1st $450 · 2nd $100 · 3rd $50 (money back) · 4th the HYSA interest** | **winner take all — $1,200, nobody else gets a cent** |
| season punishment | **THE BUS STOP** | TBD (Lane hasn't picked one) |
| weekly punishment | **KARAOKE** at Silver Clouds | **THE PARLAY WINDOW** |

Seats, stakes, punishments and lore are already written into
`config/leagues/nicks.json` and `config/leagues/dkenasty.json` with real roster IDs,
manager handles and team names. `config/cross-league.json` records the **six managers who
play in both leagues** — kdutta, Keeyan99, jc199, Christopheryu21, MBurnes, rnath499 —
which drives the cross-league specials in §6.5.

### 0.1 Proven working

- ✅ **The full-season schedule is available.** `/matchups/<w>` returns distinct, valid
  6-pair round-robins for every week 1–17, checked by MD5 and pairing map. *(All weeks
  return exactly 6243 bytes — coincidence, from identical roster counts and zeroed points.
  Do not mistake equal length for equal content.)*
- ✅ **The scoring dot product reproduces Sleeper exactly** — mean absolute error **0.024**
  (Nick's, 48 keys) and **0.019** (DKEnasty, 42 keys) vs Sleeper's own `pts_ppr`, across
  462 players. One implementation, two different scoring maps.
- ✅ **Variance is fitted and heteroskedastic** — `config/variance.json`, from 2025 weeks
  1–14 (§5.2).
- ✅ **Projection coverage 97.8% / 98.0%** of active rostered players; every miss was
  genuinely inactive.
- ✅ **25,000 sims produce sane lines** in seconds — `reference/spike.mjs`, both leagues.

### 0.2 The output, so you know what "right" looks like

```
NICK'S SPORTSBOOK — WEEK 1                      DKENASTY — WEEK 1
Comet club?     vs Christopheryu21  −170 −7.0   Tal top Smitty bottom vs 3 AM afters  −210 −11.0
Beriousbeast    vs Garbers mirror   −185 −8.5   The DNs               vs Yan Dynasty  −190 −10.0
George Droyd    vs Return of Menace −120 −1.0   Rat                   vs ETN SZN      −120  −0.5
```

Read the shape: **the biggest edge in Nick's is −185.** Beriousbeast projects 18 points
clear of the field and is still only a 64% favourite. Fantasy is a coin-flip sport and
this book prices it honestly. A −400 weekly moneyline means the model is broken.

---

## 1. Relationship to the World Cup book

`../worldcup` is the prior art and most of the view layer. **Do not modify it** — its
`--check-open` guard must stay green.

| Port from worldcup | For |
|---|---|
| `build-books.mjs`: `american()`, `roundOdds()`, `fmt()`, `price()`, `fieldMargin()`, `MARGIN`, `latestSince()` | Pricing + config timelines. Do not reinvent American odds rounding or the overround schedule. |
| `engine.mjs`: `mulberry32` | Seeded RNG. |
| `src/Sportsbook.jsx`, `styles.js`, `Masthead.jsx`, `App.jsx` | The whole view layer + query-param router. The chrome already looks right. |
| `src/Post.jsx`, `posts.jsx` | House organ, optional. |
| `scripts/publish.mjs`, `deploy` script | Publish flow; rsync target → `../kdutta9.github.io/fantasy/`. |
| Vite config, `base: '/fantasy/'` | Static hosting under a subpath. |

**Three non-negotiables, inherited unchanged:**

1. **Never reprice a posted sheet.** A committed `w<N>.json` is frozen. Anything that
   changes what a market *means* is gated on a week number via `latestSince`.
2. **Builds are hermetic.** A sheet is a pure function of committed inputs and a fixed
   seed. Nothing reads the wall clock; nothing fetches at build time.
3. **A guard proves it.** `npm run check-frozen` rebuilds every committed sheet and
   asserts byte-identical output — the analog of `--check-open`.

---

## 2. The two ways this is *not* the World Cup book

### 2.1 There is no market to calibrate against

Worldcup's credibility came from `fetch-consensus.mjs`: Kalshi, Polymarket and three
sportsbooks priced the same events, and `calibrate.mjs` fit ratings until the sim
reproduced their prices. **Nothing prices "who wins Nick's league."**

- The anchor is **Sleeper projections** (means, verified unbiased) plus a
  **residual-fitted variance model** (spread, §5.2).
- The sheet is therefore **honest on its face** — ship the methodology note in §10.
  `meta.sources` reads `SLEEPER PROJECTIONS · 25K SIMS` and claims nothing more.
- No `set-line` equivalent; the override hatch is a per-player projection patch (§4.4).

### 2.2 The content treadmill is 5–10× worse

18 weeks × 2 leagues. Worldcup's documented failure mode — *"prices reprice themselves,
the words do not"* — becomes a certainty at that length.

**Rule: a week must produce a complete, publishable sheet with zero hand-authoring.**

- Specials are **generated by default** (§6.5); authored slips are an override.
- **A sheet never inherits last week's copy.** No entry for the current week ⇒ the builder
  *generates*. It must not fall back. This inverts worldcup on purpose.
- One command, then a cron (§8.2).

---

## 3. Data layer — Sleeper. Free, no key, no OAuth.

~40 calls/week against a service that asks for < 1000/min.

### 3.1 Player / projection endpoints

```
GET https://api.sleeper.app/v1/state/nfl
  → {"week":1,"season":"2026","season_type":"regular","season_start_date":"2026-09-09"}
  THE authority for the current week. Never use the machine clock.

GET https://api.sleeper.app/v1/players/nfl                                   [14.6 MB]
  → 12,226 players by player_id. Used: full_name, position, team, status,
    injury_status, depth_chart_order, active.
  CACHE — pull at most daily, commit slimmed (§4.3). Never re-download per build.

GET https://api.sleeper.com/projections/nfl/<season>/<week>
      ?season_type=regular&order_by=pts_ppr
      &position[]=QB&position[]=RB&position[]=WR&position[]=TE&position[]=K&position[]=DEF
  ** Host is api.sleeper.COM. **   ** K and DEF are REQUIRED — both leagues start both. **
  QB/RB/WR/TE → 3,115 rows (1.9 MB).  K/DEF → 189 rows (130 KB, includes 4 punters; filter
  on player.position).
  stats holds COMPONENT keys — rec, rec_yd, rush_td, pass_yd, fgm_40_49, xpm, sack, int,
  pts_allow_14_20 … — plus precomputed pts_ppr / pts_half_ppr / pts_std.
  ** Use component stats, never pts_ppr (§5.1). **
  Historical weeks work (/projections/nfl/2025/5) — that is what makes §5.2 possible.

GET https://api.sleeper.com/projections/nfl/<season>?season_type=regular&position[]=...
  → same shape, week:null, gp≈18. Rest-of-season fallback for unpublished weeks.

GET https://api.sleeper.com/stats/nfl/<season>/<week>?...
  → actuals, same component shape, plus off_snp / tm_off_snp. Calibration + settlement.
```

### 3.2 League endpoints — confirmed against both leagues

```
GET /v1/league/<id>
  {name, season, status, total_rosters:12, scoring_settings{48|42 keys},
   roster_positions[QB,RB,RB,WR,WR,TE,FLEX,FLEX,K,DEF,BN…],
   settings{playoff_week_start:15, playoff_teams:6, playoff_type:0, playoff_seed_type:0,
            trade_deadline:11, max_keepers:1, type:0|2, start_week:1},
   previous_league_id, draft_id}

GET /v1/league/<id>/users
  [{user_id, display_name, metadata:{team_name, avatar}}]
  ** team_name can be absent ** — Nick's roster 5 (Christopheryu21) has none. Fall back
  to display_name. Already handled in config/leagues/*.json.

GET /v1/league/<id>/rosters
  [{roster_id, owner_id, players[], starters[], reserve[], taxi[], keepers, co_owners,
    player_map, settings{wins, losses, ties, fpts, fpts_decimal, fpts_against}}]
  ** Exclude reserve + taxi from lineup eligibility ** — that is why dynasty rosters carry
  19 players against 17 slots.

GET /v1/league/<id>/matchups/<week>          ✅ FULL-SEASON SCHEDULE
  [{roster_id, matchup_id, points, starters[], players[], players_points{}, starters_points[]}]
  Two rows share a matchup_id. Future weeks return valid pairings with points 0.
  ** Use weeks 1–14 only. ** Weeks 15–17 also return rows; those are NOT the bracket.

GET /v1/league/<id>/winners_bracket   (and /losers_bracket)
  [{m, r, t1, t2, w, l, t1_from{w|l}, t2_from{w|l}, p}]
  6-team / 3-round / top-2-bye; p:1 championship, p:3 third, p:5 fifth.
  ** Take the STRUCTURE only. ** At week 1 it is already populated (t1:12, t2:3…), which
  cannot be real seeding. Seed it from simulated standings instead.
  losers_bracket is the consolation ladder — it decides last place (§6.3).
```

### 3.3 What is still missing

| Missing | Consequence | Mitigation |
|---|---|---|
| Projection **variance** | The most important input is unpublished. | **Fitted — `config/variance.json`** (§5.2). |
| Player **correlation** (QB↔WR1 stacks) | Team-score variance understated for stacked rosters; totals run tight. | Phase 3. Disclose until then (§10). |
| **Waiver / trade** forecasting | Futures drift. Milder in DKEnasty; deadline is week 11 in both. | Don't model. Disclose. Weekly re-pull resets drift. |
| An **external market** | Nothing corrects a wrong line. | §2.1 + the §4.4 override. |

The `api.sleeper.com` projections/stats endpoints are **undocumented** and carry no
stability promise. Wrap every fetch in a shape assertion that fails loudly at pull time —
a failed cron is far better than a silently wrong sheet.

---

## 4. Data flow

Both leagues are already onboarded — `config/leagues/*.json` exist and are populated. An
`add-league.mjs` (analog of worldcup's `add-group.mjs`) should still exist for a third
league; `/v1/user/<username>/leagues/nfl/<season>` enumerates them from a handle.

### 4.1 What Kunal touches

**`config/leagues/*.json` and nothing else.** Roster data is never entered by hand.

### 4.2 Weekly pull — the event log

Sleeper *is* the event log, but reproducibility demands committed inputs, so the pull
**snapshots and commits** rather than fetching at build time:

```
public/data/leagues/<id>/
  league.json  users.json  schedule.json      # schedule = matchup_id pairings, weeks 1-14
  bracket.json                                # winners+losers STRUCTURE
  weeks/<W>.json                              # rosters + matchups + players_points at W
public/data/projections/2026/
  w<W>.json   w<W>.overrides.json   season.json                    ← THE ANCHOR
public/data/players/<date>.json
```

`projections/2026/w<W>.json` is the **direct analog of worldcup's `consensus/<date>.json`**.
Sleeper's projections mutate continuously; fetching at build time means no sheet ever
rebuilds identically and `check-frozen` cannot exist. **Commit the projections.**

The projection layer is **shared across both leagues** — one pull, two scoring maps applied
to it. Only the dot product differs.

### 4.3 Slimming

Raw pulls are 14.6 MB (players) + ~2 MB/week (projections). Never commit raw:

- players → `{pid:{n,p,t,s,i,d}}` for rostered players plus anyone with a non-trivial
  projection. < 400 KB.
- projections → `{pid:{k:v}}` keeping only stat keys in the **union of both leagues'
  `scoring_settings`** (~55 of ~90). < 200 KB/week.

One module owns the field list.

### 4.3b Refreshing names, and the input freeze

Managers rename teams mid-season and `add-league` seeds names only once, so without
a refresh every rename is a hand edit. `npm run refresh -- --refresh-names` (or
`npm run pull -- --refresh-names`) re-reads each seat's `manager` and `teamName`
from Sleeper into config and prints what moved.

It never touches **`nameOverride`**. That field is how the book deliberately
overrules Sleeper — a name it refuses to print, a joke the house made — and a
refresh that clobbered one would silently undo a human decision. The upstream name
is still recorded in `teamName`, so an override can be dropped later without
another fetch, and the change log says so explicitly:

```
dkenasty: 1 name change(s)
    roster 2: (no team name) → Downsyndrome Njigbas  [still displayed as "The DNs" — nameOverride untouched]
```

**Names are display-only and provably move no price** — a rename diffs to exactly
the `team` fields and nothing else — but a committed sheet rebuilds from config,
so refreshing names does make posted sheets stale until rebuilt. That is why
`refresh` runs the rebuild in the same command.

**The input freeze.** Once any book has a sheet for week W, `pull` re-fetches
neither that week's projections nor any league's week-W snapshot. Sleeper's numbers
move continuously and the snapshot carries a fresh `pulledAt` on every fetch, so a
re-pull reprices a live sheet on nothing but a timestamp — which is precisely what
`--refresh-names` did to all three leagues the first time it ran, before the guard
covered both doors. `--force-inputs` opens them and obliges you to rebuild and
re-publish whatever it touched. `state.json` is exempt: it is the latest-pull
pointer, not a sheet input.

### 4.4 Manual override hatch

```bash
npm run set-proj -- --week 6 --player "Bijan Robinson" --pts 0 --note "ruled out Sat"
```

Writes `projections/2026/w6.overrides.json`, folded in before pricing. For late scratches
Sleeper hasn't reflected. Committed and auditable — never an edit to the pulled file.

---

## 5. The model

### 5.1 Mean ✅ verified to 0.02 points

```
mu(p,w) = Σ over k in league.scoring_settings :  scoring_settings[k] × proj_stats[p][k]
                                                 (skip k absent from proj_stats)
```

**Iterate the scoring settings, look up in the projection — never the reverse.** DEF
projections carry `pts_allow: 16.0`, a raw value that is not a scoring key, beside
`pts_allow_14_20: 1.0`, which is. ~40 projection keys have no scoring rule (`rec_tgt`,
`pass_att`, `yds_allow`, `fga`, `cmp_pct`…). Iterating the projection multiplies garbage.

This absorbs PPR/half/standard, TE premium, superflex, bonuses, K distance buckets and DEF
points-allowed tiers **for free** — which is why both leagues run one implementation.

**Keep the MAE check as a regression test** (the spike prints it): must stay < 0.05.

### 5.2 Variance ✅ fitted — `config/variance.json`

`sigma(mu) = a + b·mu` per position, fitted on Sleeper 2025 weeks 1–14:

| pos | n | bias | σ @ proj<8 | σ @ proj≥14 | a | b |
|---|---|---|---|---|---|---|
| QB | 416 | −0.55 | — | 7.48 | 7.265 | 0.0205 |
| RB | 1016 | −0.34 | 4.47 | 8.38 | 2.548 | 0.3440 |
| WR | 1672 | −0.34 | 4.81 | 8.51 | 2.823 | 0.3726 |
| TE | 880 | +0.07 | 4.10 | — | 2.279 | 0.3914 |
| K | 409 | −0.09 | 4.48 | — | 4.068 | 0.0735 |
| DEF | 416 | +0.26 | 5.73 | — | 3.912 | 0.2838 |

- **Projections are unbiased** (|bias| ≤ 0.55). No bias correction.
- **Heteroskedasticity is strong** — RB/WR σ nearly doubles from low to high projections.
  A pooled SD would misprice the top and bottom of every lineup in opposite directions.
- **QB and K are flat** (b ≈ 0.02, 0.07) — they play every snap. RB/WR/TE/DEF are not.

`calibrate.mjs` regenerates it: pull `(projection, actual)` pairs for 2024–25 (~56
requests, cached), regress `|resid|·√(π/2)` on `mu` per position, write the file.
**Re-fit at most once a season, never mid-season** — that would silently change the inputs
to every historic sheet.

### 5.3 Distribution — Gamma, and a one-line zero rule

Not a Normal: weekly points are non-negative and right-skewed, and ceiling games decide
matchups.

```
score(p,w) = Gamma(k, θ),  k = (mu/σ)²,  θ = σ²/mu,  σ = max(1.5, a_pos + b_pos·mu)
```

Marsaglia–Tsang (with the `k<1` boost), seeded off `mulberry32`.

**Zero-inflation is not modelled, deliberately.** Sleeper does not publish a projection for
a player who will not play:

> **No projection for (player, week) ⇒ does not play. Ineligible for the lineup.**

97.8% / 98.0% of active rostered players have a week-1 projection, and every miss was
genuinely out (Josh Jacobs `NA`, TreVeyon Henderson `Out`, Zach Charbonnet `PUP`, Jordyn
Tyson `IR`). Sleeper has already done the injury modelling; an `injury_status → P(zero)`
table on top would double-count it and depress every projection.

Also exclude `roster.reserve` and `roster.taxi`.

### 5.4 Lineups — and a bias to correct in Phase 2

Phase 1: **optimal lineup by projected points** against `roster_positions` — fill fixed
slots greedily by `mu`, then FLEX (RB/WR/TE). Both leagues run **two** FLEX slots, so this
matters more than in a standard league.

Set lineups on **projected** points (what a manager knows Sunday morning); score on the
**simulated** draw. Setting lineups on the draw is lookahead bias.

**The bias is measured, not theoretical.** The spike's optimal lineups produce totals of
247–288 (~124–144/team), which runs high for 12-team PPR. It largely cancels in head-to-head
but inflates **totals**, which you are posting.

Phase 2 fix: a per-manager efficiency factor = (actual starters' points) / (optimal
lineup's points), measured weekly — Sleeper gives you both `starters` and `players_points`
in every `matchups/<w>` response. It becomes its own market: **"most points left on the
bench."**

### 5.5 The season simulator

```
for sim in 1..25,000:
  for week w in current..14:
    draw score(p,w) for every eligible rostered player
    set each team's lineup by mu; sum drawn scores → team_score
    resolve schedule.json pairings → W/L, points-for
  seed the 6-team bracket from simulated standings (wins, then points-for)
  play wks 15/16/17 through bracket.json's STRUCTURE
  play the losers bracket too — it decides last place (§6.3)
  accumulate: champion, playoffs, seed, last place, season points, wins,
              weekly high scorer, weekly low scorer, and the joints in §6.4
```

Accumulators mirror worldcup's (`winsPool`, `cashes`, `overPts`, `joint`) so pricing ports
directly.

**N = 25,000, not 400,000.** 25k × 14 weeks × 12 teams × 10 starters ≈ 42M Gamma draws per
league — seconds in Node (the spike proves it). If it ever isn't, draw into a preallocated
`Float64Array` per (week, player). Do not drop below ~10k, where tail markets get noisy.

Seed per `(league, week)`, fixed, recorded in `meta.seed`.

---

## 6. Markets

Price through the ported `price(p, margin)` / `fieldMargin()`. That machinery already
solved "the field collapses to two runners and the vig goes absurd" — it will happen here
in week 13.

### 6.1 Weekly matchup lines — the core product

- **Moneyline** — `P(A > B)`, `MARGIN.twoWay` = 1.075 each side.
- **Spread** — the `s` where `P(A−B > s) ≈ 0.5`, to the half point, −110 both sides.
- **Total** — median of `A+B`, over/under −110.

Ties are possible; price as a half-win both sides, as worldcup's h2h board did. Expect
moneylines in **−110 to −210** and totals in **245–290**.

### 6.2 Season futures — and the two books diverge here

**This is the one place you must not build one sheet and parameterize the name.** The
payout structures are opposites.

**Lead with PROJECTED STANDINGS, not a stack of ladders.** Every cumulative board —
top 2, top 3, make the playoffs, first-round bye, most points — is monotone in team
strength, so each one prints the *same ranking*. Measured on the week-1 sheets, Spearman
rho against the championship board was +0.99 (top 2, top 3, points title), +0.97
(playoffs, bye) and −0.99 (last place). Eight ladders, ninety-six rows, one fact.

So the season page opens with one table: rank, projected finish, projected record,
projected points, the seat's **full exact-finish distribution** as a bar, its chance of
finishing in the money, and its chance of finishing last. The distribution strip is the
thing no ladder can show — whether a seat's season is a slope or a plateau — and the
paying places are highlighted in it, which makes the two leagues' opposite payout
structures visible at a glance rather than a footnote.

Use **exact** finishes for the money columns, not cumulative ones. That is what the payout
ladder actually is (finishing exactly 2nd in Nick's pays $100), and unlike the nested
markets they are not redundant by construction: a seat's twelve exact-finish probabilities
sum to 1 and describe a shape.

Only three boards survive as boards, because only these say something the table cannot:
**CHAMPIONSHIP** (the money, and a different question from finishing high — three playoff
weeks are three more coin flips), **LAST PLACE** (inverted, and named after the
punishment), and **WIN TOTALS** (a line per seat, not a ranking).

**Nick's — places 1 through 4 all pay, so the table carries four money columns:**

| Market | Pays | Notes |
|---|---|---|
| **Championship** | $450 | Its own board. The headline. |
| 2nd exactly | $100 | Money column. |
| 3rd exactly | $50 | Money column — the buy-in back. |
| **4th exactly — "THE INTEREST"** | ≈ **$8.75** | Money column, plus its own live-ticking panel. The funniest line on either sheet: you are playing for the interest. |
| Make playoffs, bye, points title | — | Columns in the table. Never their own ladders. |
| Season win totals | — | Its own board — a line, not a ranking. |

**"THE INTEREST" must be computed, not hardcoded.** From
`config/leagues/nicks.json → stakes.hysa`:

```
prize = principal × ((1 + apy)^(days_elapsed / 365) − 1)
      = 600 × (1.045^(120/365) − 1) = $8.75   for 2026-09-01 → 2026-12-30
```

Render it live and let it tick up week over week. It is a genuinely great running joke and
it costs four lines of code.

**DKEnasty — winner take all, so the championship board *is* the financial book:**

| Market | Pays | Notes |
|---|---|---|
| **Championship** | **$1,200** | The entire book, and the only gold block in the whole table. |
| Make playoffs, seed, points title | — | Pride only. Columns in the table, never ladders. |
| Season win totals | — | Its own board. |

Do not post a "to cash" market in DKEnasty. There is no cash but first.

### 6.3 Last place — the punishment markets

Decided by the **losers bracket**, not by record, so simulate the consolation ladder too.

- **Nick's — "THE BUS STOP".** Last place spends a day at Bus Stop, open to close; every
  beer he drinks takes an hour off, every ten the league drinks puts an hour back on.
  Name the market that and print the mechanic as market copy. (The hours themselves are
  not simulable — they depend on beers, not football. An "hours served" O/U is a fun
  novelty to post *after* it settles; do not fake a line for it during the season.)
- **DKEnasty — "TBD".** Lane has not invented one, on account of proposing dogshit trades
  all offseason. Post the market titled `TBD` with that as the copy — the joke is that it
  is unnamed, and it will pressure him.

### 6.4 The weekly punishment markets — the best thing on the sheet

Both leagues punish the **weekly low scorer**, which is directly priceable off the same
weekly draws the matchup lines already use. This costs nothing extra and is the most
readable market either league has. The spike already implements both.

- **Nick's — "KARAOKE"**: low scorer sings at Silver Clouds, song picked by the week's
  high scorer. So post **two paired markets**: `KARAOKE` (low scorer) and **`SONG SELECT`**
  (high scorer).
  Then post the **joint**: `P(X is low AND Y is high)` — "X sings a song picked by Y."
  That is a joint accumulator exactly like worldcup's `joints`, counted inside the sim
  loop, and it is the single best slip on either sheet. Feature the top 3 pairings.
- **DKEnasty — "THE PARLAY WINDOW"**: low scorer places a $10 eleven-leg parlay, one leg
  picked by each other manager, winnings split league-wide. **It has never hit.** Print
  the lifetime record (`lifetimeHits: 0` in config) next to the market.

Verified output, week 1:

```
KARAOKE — low scorer               THE PARLAY WINDOW — low scorer
Christopheryu21   +380  16.6%      Trust the Process (Christopheryu21)  +420  15.3%
Perc Thuggins     +630  11.0%      Little St. Lane's (MBurnes)          +490  13.5%
```

Use `MARGIN.place` (1.25) for these — they are 12-runner place markets, not two-way.

### 6.5 Specials — generated first, authored second

Kunal chose **cross-league + rivalries he'll name later**. So: the builder generates a
board every week from the sim accumulators, and `config/leagues/<id>.json → lore` is an
empty block he fills whenever he feels like it. **Generated slips ship regardless — an
empty lore block never blocks a sheet.**

Generators:

- Highest / lowest scoring team of the week (§6.4 — already the punishment markets).
- Any team over 150 / under 70.
- A named player outscores an opponent's entire position group.
- Both sides of the marquee matchup clear the total.
- Seat X sweeps the next three weeks; seat X loses out.
- The current 1-seed misses the playoffs.

Cross-league slips do **not** appear here. They live on their own sheet — §6.7.

Authored slips live under a `specials` timeline keyed by **week** (`since: 6`), read via
the ported `latestSince`. Authored slips lead, generated ones fill. **A sheet never
inherits a previous week's specials** — no entry for this week ⇒ generate.

Same rule for the watch panel: auto-select the seat (most volatile title odds, or the
marquee matchup). Worldcup's lesson — *a dead seat breaks the watch* — applies directly.

### 6.6 Leagues are independent — the hard invariant

> **No league's sheet may read another league's data. Ever.**
> `books/nicks/w6.json` is a pure function of Nick's committed inputs, its config, and its
> seed — and nothing else.

This is not stylistic. If a DKEnasty waiver claim could move a price printed on Nick's
sheet, then a sheet is no longer reproducible from its own league's log, `check-frozen`
has to reason about two event streams at once, and build order becomes load-bearing in a
way nobody will remember in week 11. Keep them separate and each league stays a small,
verifiable thing.

What is legitimately shared, and why it is not coupling:

| Shared | Why it's fine |
|---|---|
| `public/data/projections/` | An **input**, like a price feed. Both leagues read the same projections and apply their own `scoring_settings`. Neither can affect the other through it. |
| `config/variance.json` | A fitted constant. |
| `scripts/engine.mjs`, the view layer | Code, not data. |
| `npm run refresh` building both | A convenience loop. It must work correctly when run for one league alone. |

Slimming keeps the **union** of both leagues' scoring keys (§4.3). The extra keys are inert
for the league that doesn't score them — a dot product over `scoring_settings` never reads
them — so this does not couple the sheets. It does mean adding a third league later grows
future projection files; already-committed weeks are untouched, so no sheet moves.

### 6.7 The Crossover — cross-league slips, on their own sheet

> **RETIRED in week 2.** This shipped for week 1 and was then deleted in full. The
> premise was six managers overlapping the two original leagues; LoOG arrived with only
> Kunal in common, leaving a surface that covered two books out of three, lagged both
> because it could only build after every league had posted, and cost a third pass in
> `refresh`. The section is kept because it records why the dependency ran one way and
> what §6.6 was protecting — not because the sheet exists. See CLAUDE.md, *The Crossover
> is retired*.

Six managers play in both leagues (`config/cross-league.json`), and slips like *"kdutta
wins in both leagues this week"* or *"the same manager is low scorer in both"* — karaoke
**and** the parlay window in one weekend — are the best material either league has. They
just cannot live on a league sheet without breaking §6.6.

So they get their own surface, built by a **third pass that runs after both leagues**:

```
build-book.mjs nicks     → books/nicks/w<N>.json        (reads only Nick's inputs)
build-book.mjs dkenasty  → books/dkenasty/w<N>.json     (reads only DKEnasty's inputs)
build-crossover.mjs      → books/crossover/w<N>.json    (reads ONLY the two committed
                                                         sheets above + cross-league.json)
```

The crossover pass reads **committed artifacts, not live sims**, so it is hermetic on the
same terms as everything else, the dependency is explicit and one-directional, and
`check-frozen` covers it by rebuilding it from the two frozen sheets. If either league's
sheet for that week is missing, the crossover pass **skips that week** and says so — it
never blocks a league sheet from publishing.

For that to work, each league's weekly sheet must carry the handful of per-seat
probabilities the crossover needs — win-this-week, low-scorer, high-scorer, championship —
in a small `crossover` block in its JSON. That block is derived from the league's own sim
and changes nothing about how the league's own markets price.

Route: `/fantasy/?book=crossover`. Link it from both league sheets. Phase 2 — it is the
last thing built, and neither league needs it to ship.

### 6.7b Season preview prose

The season page carries authored prose from `config/leagues/<id>.json → preview`
(`standfirst` + `paragraphs`), copied onto the sheet by the builder as `sheet.preview`.

It follows worldcup's `posts.jsx` convention rather than the specials convention: **written
once, citing the numbers on the sheet it was written against, and then left alone.** A
preview is a point-in-time editorial — it is *supposed* to read as week-1 opinion in week
9, so `preview.writtenWeek` is recorded and the page says so from week 2 onward rather than
pretending the prose is current. Do not regenerate it weekly, and do not interpolate live
numbers into it; the boards directly beneath it are the live version.

This is the one place on either sheet where copy is required rather than optional. A league
with no `preview` block renders the futures boards alone — nothing breaks.

### 6.8 Line movement

Sheet-over-sheet ▲▼ and the LINE MOVEMENT chart come free from `Sportsbook.jsx` once the
week index exists. Watching a seat's title odds crater after their RB1 tears an ACL is the
best thing this book will produce.

---

## 7. Repo layout

```
fantasy-book/
  CLAUDE.md  DESIGN.md
  config/
    leagues/nicks.json  leagues/dkenasty.json   # THE ONLY HUMAN-EDITED FILES ✅ written
    variance.json                               # ✅ fitted
    cross-league.json                           # ✅ the six shared managers
  reference/spike.mjs                           # ✅ working model, lift into engine.mjs
  scripts/
    add-league.mjs  pull.mjs  slim.mjs  calibrate.mjs  set-proj.mjs
    engine.mjs      build-book.mjs      build-crossover.mjs      publish.mjs
  public/data/
    leagues/<id>/{league,users,schedule,bracket}.json  leagues/<id>/weeks/<W>.json
    projections/2026/w<W>.json  w<W>.overrides.json  season.json
    players/<date>.json
    books/<id>/w<N>.json  books/<id>/index.json  books/index.json
    books/crossover/w<N>.json                      # §6.7 — built last, from the two above
  src/                                          # ported from worldcup, base '/fantasy/'
```

Routing — same query-param pattern, refresh-safe on static hosting:

- `/fantasy/?book=nicks` — **the week card**: matchups, the punishment markets, the joint,
  line movement, lineups. Everything that settles this Sunday.
- `/fantasy/?book=nicks&view=season` — **the season page**: authored preview prose, then the
  futures boards and win totals. Titled SEASON PREVIEW at week 1; THE FUTURES BOARD from
  week 2, where the prose is labelled with the week it was written.
- `/fantasy/?book=nicks&w=6` — a specific week (combines with `&view=season`)
- `/fantasy/?book` — league list
- `/fantasy/?post=<id>` — house organ, optional

---

## 8. Weekly operation

### 8.1 The command

```bash
npm run refresh          # pull + build both leagues' sheets for the upcoming week
npm run publish          # commit data + source, build, deploy to kdutta.com/fantasy
```

`refresh` = `pull.mjs` (week from `/v1/state/nfl`), then `build-book.mjs` **once per
league, independently**, then `build-crossover.mjs` last. Each league build must succeed or
fail on its own — a DKEnasty failure must still leave Nick's sheet publishable, and
`npm run refresh -- --league nicks` must work. Editorial happens *after* a valid sheet
exists, never as a precondition for one.

Run Tuesday or Wednesday morning ET. The mental model, straight from worldcup's
sheet-dating rule: **sheet W settles week W−1 and previews week W.**

### 8.2 Automate it

GitHub Action on cron, Tuesdays 13:00 UTC: `refresh`, commit changed data, build, push to
the host repo. **No secrets needed** — every Sleeper endpoint is public and
unauthenticated, which is the quiet superpower of this design. The sheet posts itself.
Guard the action with `check-frozen` so a bad week cannot rewrite history unattended.

---

## 9. Phasing

**Phase 1 — end to end, this week.** Both leagues. Pull → `mu` → Gamma with
`config/variance.json` → optimal lineups → 25k sims → **weekly matchup ML/spread/total
plus the §6.4 punishment markets** (they are free off the same draws and they are the
hook) → ported `Sportsbook.jsx` → live at `kdutta.com/fantasy`.

**Phase 2 — the book.** Season futures, with Nick's four-deep ladder and THE INTEREST
computed live, and DKEnasty's winner-take-all board. Losers-bracket last place. Line
movement. Generated specials, then the Crossover sheet (§6.7) last.
Manager-efficiency correction (§5.4).
`check-frozen`. The Tuesday cron.

**Phase 3 — sharp edges.** Player correlation (a shared per-game factor lifting
QB↔pass-catcher covariance — the most defensible criticism of the model). Authored specials
timeline and the house organ. Dynasty-specific markets for DKEnasty (rookie pick value,
contending vs rebuilding). Re-fit `calibrate.mjs` on 2024+2025 combined.

**On whether the two books should differ:** structurally identical everywhere *except*
where the payout structure forces divergence (§6.2) and where the punishments differ
(§6.3–6.4). Dynasty-specific markets wait for Phase 3 — a dynasty league still plays a
normal season, and nothing about `type: 2` changes the weekly model.

---

## 10. State these on the sheet

Worldcup could cite four sportsbooks. This cannot, so it earns trust by being explicit.
In `meta` and rendered:

> `SLEEPER PROJECTIONS · 25,000 SIMS · VARIANCE FIT ON 2025 RESIDUALS`
> Rosters frozen as of the Tuesday pull — waivers and trades after it are not priced.
> Lineups simulated as optimal; real managers are not, so totals run a touch high.
> Player scores drawn independently, so stacked rosters are slightly under-varianced.
> Not real betting.

Every one is a known, bounded limitation. Publishing them is cheaper than having someone
in the group chat discover one.
