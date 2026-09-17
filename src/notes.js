// The editorial layer. Prose lives in `content/<league>/w<N>.md` and is loaded
// straight into the bundle by Vite, which means `npm run dev` hot-reloads a save
// with no build step and no generated artifact.
//
// It is deliberately NOT an input to scripts/build-book.mjs. A sheet is frozen
// once posted (`npm run check-frozen` rebuilds it and compares bytes), so prose
// living inside the sheet would make every typo fix a reprice of a posted week —
// worldcup's documented failure mode read backwards. Splitting them means the
// numbers are immutable and the words are not, which is the correct asymmetry:
// nobody ever needed a comma to be reproducible.
//
// The one coupling that remains is intentional: a note addresses a matchup by
// ROSTER ID (`## matchup:8-10`), not by team name, because names are display-only
// and change mid-season while roster ids never do.

const FILES = import.meta.glob("../content/**/*.md", { query: "?raw", import: "default", eager: true });

// Slots the page knows where to put. Anything else becomes a panel of its own,
// titled with the heading as written — so adding a one-off section is just
// typing a heading, and never a code change.
export const SLOTS = new Set([
  "lede",
  "settled",
  "card",
  "punishment",
  "punishment-paired",
  "joint",
  "bench",
  "lineups",
  "season",
]);

const SLOT_SHAPE = /^[a-z][a-z0-9-]*(:\d+-\d+)?$/;

// Parsed once, at module load — which has to happen AFTER SLOT_SHAPE exists, or
// the const is still in its temporal dead zone when the first file is parsed.
// "../content/nicks/w2.md" → "nicks/w2".
const KEY = /\/content\/([^/]+)\/w(\d+)\.md$/;
const notes = new Map();
for (const path in FILES) {
  const at = path.match(KEY);
  if (at) notes.set(`${at[1]}/w${at[2]}`, parseNote(FILES[path]));
}

export const loadNote = (league, week) => notes.get(`${league}/w${week}`) ?? null;

// A note is frontmatter plus `## <slot>` sections. Anything before the first
// heading is the lede, because that is what everyone writes first anyway.
export function parseNote(raw) {
  const { meta, body } = splitFrontmatter(raw.replace(/\r\n/g, "\n"));
  // `npm run notes` scaffolds every section with the relevant figures in an HTML
  // comment, so an unwritten section is still a publishable one: the comment is
  // stripped here and the section then has no text, which drops it entirely.
  // That is what makes a half-finished file safe to commit.
  const clean = body.replace(/<!--[\s\S]*?-->/g, "");
  const sections = [];
  let current = { id: "lede", title: null, lines: [] };
  for (const line of clean.split("\n")) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (!heading) {
      current.lines.push(line);
      continue;
    }
    sections.push(current);
    const label = heading[1];
    const id = label.toLowerCase();
    // A lowercase identifier is a slot; anything else is a headline, and gets a
    // panel under that headline.
    current = SLOT_SHAPE.test(id) ? { id, title: null, lines: [] } : { id: null, title: label, lines: [] };
  }
  sections.push(current);

  const slots = new Map();
  const panels = [];
  for (const section of sections) {
    const text = section.lines.join("\n").trim();
    if (!text) continue;
    if (section.id) slots.set(section.id, text);
    else panels.push({ title: section.title, text });
  }
  return { meta, slots, panels };
}

// `## matchup:8-10` addresses the same row whichever way round the sheet printed
// the seats this week — the favourite is side A and the favourite can flip.
export const matchupNote = (note, a, b) =>
  note?.slots.get(`matchup:${a}-${b}`) ?? note?.slots.get(`matchup:${b}-${a}`) ?? null;

export const slot = (note, id) => note?.slots.get(id) ?? null;

function splitFrontmatter(raw) {
  const at = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!at) return { meta: {}, body: raw };
  const meta = {};
  for (const line of at[1].split("\n")) {
    const pair = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (pair) meta[pair[1]] = pair[2].replace(/^["']|["']$/g, "").trim();
  }
  return { meta, body: raw.slice(at[0].length) };
}
