// Every URL the view fetches, in one place — the browser-side twin of
// scripts/lib/paths.mjs. Nothing else in src/ concatenates a data path.
const DATA = `${import.meta.env?.BASE_URL ?? "/"}data/`;

const json = (url) => fetch(url).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status} ${url}`))));

export const loadBooksIndex = () => json(`${DATA}books/index.json`);
export const loadWeekIndex = (bookId) => json(`${DATA}books/${bookId}/index.json`);
export const loadSheet = (bookId, week) => json(`${DATA}books/${bookId}/w${week}.json`);

// A book's whole history, newest last. The line-movement chart and the ▲▼
// comparison both need every posted sheet, not just the current one — the same
// shape worldcup's Sportsbook.jsx loads.
export async function loadBook(bookId) {
  const { weeks } = await loadWeekIndex(bookId);
  const sheets = await Promise.all(weeks.map((w) => loadSheet(bookId, w)));
  return { weeks, sheets };
}
