#!/usr/bin/env node
// Once public/data/books/<league>/w<N>.json is committed it is frozen. This is
// the analog of worldcup's --check-open: rebuild every committed sheet from its
// committed inputs and assert the bytes are identical.
//
// A failure here means a sheet has repriced itself. The cause is always one of:
// an input file was overwritten, a model constant changed, or something read the
// wall clock. Find it — do not re-commit the new bytes.
//
//   npm run check-frozen

import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { basename } from "node:path";
import { serialize } from "./lib/json.mjs";
import * as P from "./lib/paths.mjs";
import { buildBook } from "./build-book.mjs";
import { buildCrossover } from "./build-crossover.mjs";

const committedWeeks = (leagueId) =>
  existsSync(P.bookDir(leagueId))
    ? readdirSync(P.bookDir(leagueId))
        .filter((f) => /^w\d+\.json$/.test(f))
        .map((f) => Number(basename(f, ".json").slice(1)))
        .sort((a, b) => a - b)
    : [];

const bookIds = existsSync(P.booksRoot)
  ? readdirSync(P.booksRoot).filter((f) => statSync(P.bookDir(f)).isDirectory())
  : [];

let failures = 0;
let checked = 0;

for (const id of bookIds.filter((b) => b !== "crossover")) {
  for (const week of committedWeeks(id)) {
    checked++;
    const rebuilt = serialize(buildBook({ leagueId: id, week }));
    const committed = readFileSync(P.bookFile(id, week), "utf8");
    const ok = rebuilt === committed;
    if (!ok) failures++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${id} w${week}`);
  }
}

// The crossover is rebuilt from the two frozen sheets, so it is covered by the
// same guard without needing a sim of its own (§6.7).
for (const week of committedWeeks("crossover")) {
  checked++;
  const rebuilt = buildCrossover({ week });
  const committed = readFileSync(P.bookFile("crossover", week), "utf8");
  const ok = rebuilt != null && serialize(rebuilt) === committed;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  crossover w${week}`);
}

console.log(`\n${checked - failures}/${checked} sheets rebuild byte-identical.`);
process.exit(failures ? 1 : 0);
