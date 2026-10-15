---
name: weekly-book
description: Post the week's Fantasy Book — pull Sleeper after waivers, build every league's sheet, run the guards, then write the week's prose in content/<league>/w<N>.md in a Bill Simmons / Cousin Sal voice. Use when Kunal says the week is done, waivers have processed, or asks for the new week's lines/page/prose. Takes optional lore notes as args.
---

# Weekly book

The commands live in README ("The weekly operation", "Writing a week") and the rules in
CLAUDE.md. This skill is the parts that were only ever in the weekly prompt: the order, the
voice, and what to ask. Don't restate the README here; if a command changes, change it there.

## 1. Numbers

1. `npm run refresh`. The week comes from `/v1/state/nfl`, never the clock (trap 4).
2. `npm run check-frozen` and `npm test`. A red test from a fixed constant is the recurring
   failure mode of this repo (moneyline ceiling, title ceiling, price backstop). Check whether
   the model is right before touching anything, then **ask** before you change a guard. Never
   add a per-sheet exemption silently.
3. Ask the ship cadence. Kunal picks per week (memory: weekly-prose-workflow). TNF is the
   hard deadline for numbers.

## 2. Receipts before prose

`npm run notes -- --week <W>` scaffolds every figure. Then gather what the scaffold doesn't
have, from this league's files only (memory: prose-no-cross-league):

- last week's `content/<league>/w<W-1>.md`, especially the receipts comment at the top, for
  running bits: debts owed, songs, parlays, renames, grudges
- records and PF from `leagues/<id>/weeks/w<W>.json`, and futures movement w<W-1> → w<W>
  (title, playoffs, `restOfSeason`)
- the Sleeper transactions endpoint (read-only GET) for trades and move counts, plus the draft
  picks when someone's roster is the story
- `settled.punishment` history: who keeps being the favourite, who keeps paying

Put the receipts in an HTML comment at the top of each file, the way w5 and w6 did. Next week
reads them.

## 3. Ask, then write

Use AskUserQuestion with at most four questions. Cover any design decision the build raised,
the ship cadence, any discrepancy between Kunal's lore and the data (verify it and offer the
accurate framing), and how far each lore item can go on the page (names, quotes). Map real
names to handles with the manager-names memory.

Voice: Simmons and Cousin Sal. The house is a character with a grudge and a spreadsheet: short
declaratives, a number in bold as the punchline, the receipt that turns a quote against
whoever said it. Callbacks to last week beat new jokes. LoOG gets no lore: two or three flat,
factual sentences per section.

Rules:
- Every number has to trace to a sheet, results file or transaction. Re-derive margins,
  records and "first time since" claims; week 4's draft had several slips.
- Anything you can't know (a quote you weren't given, whether a punishment happened) goes in
  as a visible `[TODO(kunal): …]` plus a note in the comment. Never invent it.
- `src/markdown.jsx` needs every line of a list to start with `- `, so keep each list item on one
  line. A wrapped item turns the whole list into a paragraph. There are no tables.
- One-off prop boards (milk mile, karaoke) go in `scripts/props/<name>.mjs` with every assumption
  in INPUTS, priced through `price()`, printing a block to paste. Never make them a builder input.
- Matchup slots use roster ids. Delete the scaffold's "Film Room" placeholder unless it's used.
- No other league, ever.

## 4. Verify and hand over

Start the `dev` preview, load `?book=<id>` for each league, check for console errors, and
confirm the lede and a matchup blurb render. Then list the open TODO(kunal) items. Don't
publish or commit until Kunal says so; `npm run publish` commits straight to main.
