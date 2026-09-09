// Command-line parsing for the scripts. Every one of them wants the same two
// things, and hand-rolling `argv.indexOf(name) + 1` a fourth time is how
// `--season` silently became `--write`.
const argv = process.argv.slice(2);

export const flag = (name) => argv.includes(name);

export function option(name, fallback = undefined) {
  const at = argv.indexOf(name);
  if (at < 0) return fallback;
  const value = argv[at + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`${name} needs a value`);
  return value;
}
