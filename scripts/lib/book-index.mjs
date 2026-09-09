// The two index files the view reads: which books exist, and which weeks each
// has posted. Both are append-only — rebuilding an old sheet never removes an
// entry, so the week dropdown cannot lose history.
import { readJsonIf, writeJson } from "./json.mjs";
import * as P from "./paths.mjs";

export function addWeek(bookId, week) {
  const path = P.bookIndexFile(bookId);
  const index = readJsonIf(path, { weeks: [] });
  if (!index.weeks.includes(week)) index.weeks = [...index.weeks, week].sort((a, b) => a - b);
  writeJson(path, index);
}

// `kind` orders the lobby: leagues first, the crossover last. It is a sort key,
// not a type switch — the view renders every entry the same way.
export function registerBook({ id, name, bookName, kind = "league" }) {
  const books = readJsonIf(P.booksIndexFile, []).filter((b) => b.id !== id);
  books.push({ id, name, bookName, kind });
  books.sort((a, b) => (a.kind === b.kind ? a.id.localeCompare(b.id) : a.kind === "league" ? -1 : 1));
  writeJson(P.booksIndexFile, books);
}
