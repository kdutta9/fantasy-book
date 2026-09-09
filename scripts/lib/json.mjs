// Canonical JSON I/O. Every artifact this repo commits is written through
// `writeJson`, so "rebuild and compare bytes" (check-frozen) is a valid test:
// one formatter, one trailing newline, no incidental whitespace drift.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";

export const serialize = (value) => JSON.stringify(value, null, 2) + "\n";

export const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
export const readJsonIf = (path, fallback = null) => (existsSync(path) ? readJson(path) : fallback);

export function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serialize(value));
  return path;
}
