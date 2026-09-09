// Calibration hits ~60 requests per season against undocumented endpoints. Cache
// them under .cache/ (gitignored) so a fit can be re-run and reproduced without
// hammering Sleeper. Never used by a build — builds read committed inputs only.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./paths.mjs";

const DIR = join(ROOT, ".cache", "calibrate");

export async function cached(key, fetcher) {
  mkdirSync(DIR, { recursive: true });
  const path = join(DIR, `${key}.json`);
  if (existsSync(path)) return JSON.parse(readFileSync(path, "utf8"));
  const value = await fetcher();
  writeFileSync(path, JSON.stringify(value));
  return value;
}

export const POSITION_GROUPS = [
  ["QB", "RB", "WR", "TE"],
  ["K", "DEF"],
];
