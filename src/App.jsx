import Sportsbook from "./Sportsbook";
import { css } from "./styles";

// Query-param routing (no router dep, refresh-safe on static hosting), the same
// pattern as ../worldcup src/App.jsx:
//   ?book=<id>        → that league's newest sheet, the week card
//   ?book=<id>&view=season → the season preview / futures board for that league
//   ?book=<id>&w=6    → a specific week
//   ?book=crossover   → the cross-league sheet (§6.7)
//   ?book | (none)    → the lobby
export default function App() {
  const params = new URLSearchParams(window.location.search);
  const bookId = params.get("book") || null;
  const week = params.has("w") ? Number(params.get("w")) : null;
  // The card and the season board are separate pages. Crossover has one page and
  // ignores this entirely.
  const view = params.get("view") === "season" ? "season" : "week";
  return (
    <>
      <style>{css}</style>
      <Sportsbook bookId={bookId} week={week} view={view} />
    </>
  );
}
