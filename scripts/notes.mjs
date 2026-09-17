#!/usr/bin/env node
// Scaffold a week's editorial file from the sheet that was just built.
//
//   npm run notes -- --week 2                    # every league
//   npm run notes -- --league nicks --week 2
//   npm run notes -- --week 2 --force            # overwrite an existing file
//   npm run notes -- --week 2 --check            # which weeks have no prose
//
// The content treadmill is the thing most likely to kill this book (DESIGN.md
// §2.2): eighteen weeks times three leagues is fifty-four columns, and the boards
// ship whether or not anyone writes one. So the pipeline's job is not to write
// the prose — it is to make sure that sitting down to write never requires
// looking a number up.
//
// Every section arrives with the relevant figures already in an HTML comment.
// Comments are stripped by the renderer, so an unfinished file is a file you can
// publish: delete the comment, keep the section, or delete the section entirely.
// The sheet is never modified. This writes to content/ and nothing else.

import { existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { readJson } from "./lib/json.mjs";
import * as P from "./lib/paths.mjs";
import { allLeagueIds } from "./pull.mjs";
import { flag, option } from "./lib/args.mjs";

const contentFile = (league, week) => join(P.ROOT, "content", league, `w${week}.md`);

export function scaffold({ leagueId, week }) {
  const sheet = readJson(P.bookFile(leagueId, week));
  const settled = sheet.settled;
  const out = [];

  out.push("---");
  out.push(`league: ${leagueId}`);
  out.push(`week: ${week}`);
  out.push(`headline: WEEK ${week}`);
  out.push("byline: The House");
  out.push("---");
  out.push("");
  out.push(`<!-- ${sheet.bookName} · week ${week} · seed ${sheet.meta.seed}`);
  out.push(`     Sections with lowercase names are SLOTS and land in a specific panel.`);
  out.push(`     Any other heading becomes a panel of its own, titled as you wrote it.`);
  out.push(`     Delete anything you do not want. An empty section is dropped. -->`);
  out.push("");

  section(out, "lede", ledeFacts(sheet, settled));

  if (settled) {
    section(out, "settled", settledFacts(settled));
    section(out, "bench", benchFacts(settled));
  }

  section(out, "card", [
    `the board spans ${fmt(Math.min(...sheet.matchups.map((m) => m.total.line)))} to ${fmt(Math.max(...sheet.matchups.map((m) => m.total.line)))} on totals`,
    `replaces the default blurb under THE CARD — leave it out to keep the default`,
  ]);

  for (const m of sheet.matchups) {
    section(out, `matchup:${m.a.rosterId}-${m.b.rosterId}`, matchupFacts(m, settled), `${m.a.team} vs ${m.b.team}`);
  }

  section(out, "punishment", runnerFacts(sheet.punishment.weekly), `${sheet.punishment.weekly.name} — low scorer`);
  if (sheet.punishment.paired) {
    section(out, "punishment-paired", runnerFacts(sheet.punishment.paired), `${sheet.punishment.paired.name} — high scorer`);
  }
  if (sheet.punishment.joints.length) {
    section(out, "joint", sheet.punishment.joints.map((j) => `${j.low.team} sings for ${j.high.team} — ${j.price} (${j.pct}%)`));
  }
  section(out, "lineups", [
    `highest projected: ${[...sheet.lineups].sort((a, b) => b.projected - a.projected)[0].team}`,
    `forfeited slots: ${sheet.lineups.filter((l) => l.emptySlots.length).map((l) => `${l.team} (${l.emptySlots.join(", ")})`).join("; ") || "none"}`,
  ]);

  out.push("## The Film Room");
  out.push("");
  out.push("<!-- Not a slot, so this becomes its own panel titled THE FILM ROOM.");
  out.push("     Rename it, duplicate it, or delete it. -->");
  out.push("");

  return out.join("\n");
}

function section(out, id, facts, label) {
  out.push(`## ${id}`);
  out.push("");
  if (label) out.push(`<!-- ${label}`);
  else out.push("<!--");
  for (const fact of facts) out.push(`     ${fact}`);
  out.push("-->");
  out.push("");
}

const ledeFacts = (sheet, settled) => {
  const chalk = [...sheet.matchups].sort((a, b) => b.moneyline.pA - a.moneyline.pA)[0];
  const coin = [...sheet.matchups].sort((a, b) => a.moneyline.pA - b.moneyline.pA)[0];
  return [
    `biggest edge: ${chalk.a.team} ${chalk.moneyline.a} over ${chalk.b.team} (${chalk.moneyline.pA}%, ${chalk.spread.a})`,
    `closest game: ${coin.a.team} vs ${coin.b.team} at ${coin.moneyline.a} (${coin.moneyline.pA}%)`,
    `highest total: ${fmt(Math.max(...sheet.matchups.map((m) => m.total.line)))}`,
    settled ? `last week: ${settled.high.team} ${fmt(settled.high.points)} high, ${settled.low.team} ${fmt(settled.low.points)} low` : "no prior week",
    settled ? `the book went ${settled.reportCard.straightUp.w}-${settled.reportCard.straightUp.l} on favourites, Brier ${settled.reportCard.brier}` : "",
  ].filter(Boolean);
};

const settledFacts = (settled) => [
  `favourites ${settled.reportCard.straightUp.w}-${settled.reportCard.straightUp.l} SU, ${settled.reportCard.ats.w}-${settled.reportCard.ats.l} ATS, totals ${settled.reportCard.total.w}-${settled.reportCard.total.l} over`,
  `Brier ${settled.reportCard.brier} vs ${settled.reportCard.coinFlip} for a coin flip; expected ${fmt(settled.reportCard.expectedChalkWins)} chalk wins, got ${settled.reportCard.straightUp.w}`,
  `low scorer ${settled.low.team} ${fmt(settled.low.points)} — priced ${settled.punishment.low.price}, ${settled.punishment.low.rank} of ${settled.punishment.low.of}`,
  `high scorer ${settled.high.team} ${fmt(settled.high.points)}`,
  `joint: ${settled.punishment.joint?.hit ? `HIT at ${settled.punishment.joint.hit.price}` : "did not hit"}`,
  `biggest beat: ${settled.versus[0].team} ${fmt(settled.versus[0].points)} vs ${fmt(settled.versus[0].projected)} projected (+${fmt(settled.versus[0].diff)})`,
  `biggest miss: ${settled.versus.at(-1).team} ${fmt(settled.versus.at(-1).points)} vs ${fmt(settled.versus.at(-1).projected)} projected (${fmt(settled.versus.at(-1).diff)})`,
];

const benchFacts = (settled) =>
  settled.bench.slice(0, 3).map((b) => `${b.team} left ${fmt(b.left)} — ${b.missed.map((p) => `${p.name} ${fmt(p.points)}`).join(", ")}`);

const matchupFacts = (m, settled) => {
  const facts = [
    `${m.moneyline.a} / ${m.moneyline.b} — ${m.moneyline.pA}% fair`,
    `spread ${m.spread.a}, total ${fmt(m.total.line)}`,
    `projected ${fmt(m.projected.a)} vs ${fmt(m.projected.b)}`,
  ];
  if (settled) {
    for (const seat of [m.a, m.b]) {
      const last = settled.versus.find((v) => v.rosterId === seat.rosterId);
      if (last) facts.push(`last week ${seat.team}: ${fmt(last.points)} (projected ${fmt(last.projected)}, ${last.diff > 0 ? "+" : ""}${fmt(last.diff)})`);
    }
  }
  return facts;
};

const runnerFacts = (board) => board.rows.slice(0, 3).map((r) => `${r.team} ${r.price} (${r.pct}%)`);

const fmt = (n) => (n == null ? "—" : Number(n).toFixed(n % 1 === 0 ? 0 : 1));

const weeksOf = (id) =>
  existsSync(P.bookDir(id))
    ? readdirSync(P.bookDir(id)).filter((f) => /^w\d+\.json$/.test(f)).map((f) => Number(basename(f, ".json").slice(1))).sort((a, b) => a - b)
    : [];

if (import.meta.url === `file://${process.argv[1]}`) {
  const only = option("--league", null);
  const leagueIds = only ? only.split(",") : allLeagueIds();
  const force = flag("--force");

  if (flag("--check")) {
    // Which posted weeks have no prose. The boards ship without it, so this is a
    // reading list, not an error — hence the zero exit.
    for (const id of leagueIds) {
      const missing = weeksOf(id).filter((w) => !existsSync(contentFile(id, w)));
      console.log(`${id.padEnd(10)} ${missing.length ? `no prose for week(s) ${missing.join(", ")}` : "every posted week has prose"}`);
    }
    process.exit(0);
  }

  const week = Number(option("--week", readJson(P.statePath).week));
  for (const id of leagueIds) {
    const path = contentFile(id, week);
    if (existsSync(path) && !force) {
      console.log(`· ${id} w${week} — ${path.replace(P.ROOT + "/", "")} already exists (--force to overwrite)`);
      continue;
    }
    if (!existsSync(P.bookFile(id, week))) {
      console.log(`· ${id} w${week} — no sheet built yet, nothing to scaffold from`);
      continue;
    }
    mkdirSync(join(P.ROOT, "content", id), { recursive: true });
    writeFileSync(path, scaffold({ leagueId: id, week }));
    console.log(`✓ ${path.replace(P.ROOT + "/", "")}`);
  }
  console.log(`\nEdit them, then \`npm run dev\` — saves hot-reload straight onto the page.`);
}
