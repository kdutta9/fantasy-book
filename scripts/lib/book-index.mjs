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

// Every book in the lobby is a league now, so the entries sort by id and carry
// no `kind`. That field only ever existed to keep the Crossover last.
export function registerBook({ id, name, bookName }) {
  const books = readJsonIf(P.booksIndexFile, []).filter((b) => b.id !== id);
  books.push({ id, name, bookName });
  books.sort((a, b) => a.id.localeCompare(b.id));
  writeJson(P.booksIndexFile, books);
}
