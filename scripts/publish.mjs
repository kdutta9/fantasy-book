#!/usr/bin/env node
// One-command ship (DESIGN.md §8.1). Run after `npm run refresh`:
//
//   npm run publish
//
// 1. Refuses to ship if check-frozen is red or the tests fail. A sheet that has
//    repriced itself must never reach the site — that is the whole point of the
//    guard, and this is the one place it can actually stop something.
// 2. Commits and pushes the source repo. The committed inputs and every derived
//    sheet ARE the record; they must be versioned, not left in the working tree.
// 3. Runs `npm run deploy`, which builds and rsyncs into ../kdutta9.github.io.
//
// Ported in shape from ../worldcup scripts/publish.mjs; the commit message here
// lists the sheets that actually changed rather than the results that landed.

import { execFileSync, execSync } from "node:child_process";
import { ROOT } from "./lib/paths.mjs";

const run = (cmd) => execSync(cmd, { cwd: ROOT, stdio: "inherit" });
const capture = (cmd) => execSync(cmd, { cwd: ROOT, encoding: "utf8" }).trim();

console.log("→ Guards");
run("npm run check-frozen");
run("npm test");

// Worldcup's documented failure mode is "prices reprice themselves, the words do
// not", and the defence here is that prose lives outside the sheet entirely — a
// week with no file simply has no prose rather than inheriting last week's. That
// makes forgetting silent, so publish says so. It is a NOTICE, never a gate: the
// boards are the product and they ship complete without a word written.
console.log("\n→ Editorial");
run("npm run notes -- --check");

const status = capture("git status --porcelain");
if (status) {
  // "nicks w2, dkenasty w2, loog w2" — the sheets this publish is posting.
  const sheets = status
    .split("\n")
    .map((line) => line.slice(3).match(/public\/data\/books\/([^/]+)\/w(\d+)\.json$/))
    .filter(Boolean)
    .map(([, id, week]) => `${id} w${week}`);
  const subject = sheets.length ? `Post ${sheets.join(", ")}` : "Update fantasy book data";
  console.log(`\n→ Committing: "${subject}"`);
  run("git add -A");
  execFileSync("git", ["commit", "-m", subject], { cwd: ROOT, stdio: "inherit" });
  run("git push");
} else {
  console.log("\n→ Source repo clean — nothing to commit.");
}

console.log("\n→ Building and deploying the live site…");
run("npm run deploy");
console.log("\n✓ Published — source committed and site deployed to kdutta.com/fantasy.");
