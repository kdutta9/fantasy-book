// Sheet-over-sheet price movement. Ported from ../worldcup src/Sportsbook.jsx —
// the ▲▼ comparison and the implied-probability helper are solved there and the
// arrows already point the right way.
//
// The LINE MOVEMENT chart that used to live here is gone. It plotted every
// seat's low-scorer probability by week, which is a twelve-line spaghetti chart
// carrying two data points in week 2 and saying nothing the ▲▼ arrows beside
// each price do not already say. DESIGN.md §6.8 still wants a movement chart and
// it may well be worth rebuilding once there is a season of sheets behind it —
// but it should earn the space then, not hold it now.

// American-odds string ("−160" / "+115") → implied probability, for markets that
// carry a price but no stored percentage.
export function impliedProb(s) {
  if (!s) return null;
  const neg = s[0] === "−" || s[0] === "-";
  const n = Number(s.slice(1));
  if (!Number.isFinite(n)) return null;
  return neg ? n / (n + 100) : 100 / (n + 100);
}

// Movement of a single price between sheets. `was` is omitted when the prior
// line is not comparable (the favourite flipped sides), so nothing renders.
export function PriceMove({ now, was, prefix = "" }) {
  if (!now || !was || now === was) return null;
  const before = impliedProb(was);
  const after = impliedProb(now);
  if (before == null || after == null) return null;
  const up = after > before; // probability up = price shortening
  return (
    <span className={`bk-move ${up ? "up" : "down"}`}>
      {up ? "▲" : "▼"} {prefix}
      {was} → {now}
    </span>
  );
}
