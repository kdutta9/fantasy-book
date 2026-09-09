// Sheet-over-sheet price movement. Ported from ../worldcup src/Sportsbook.jsx —
// the ▲▼ comparison, the implied-probability helper and the SVG chart are all
// solved there and the arrows already point the right way.

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

const CHART_COLORS = [
  "#E4C46A", "#7FB3FF", "#FF8A7A", "#7FE3A8", "#D9A0FF", "#FFD27F",
  "#7FE9E3", "#FF9FC6", "#B8E97F", "#9FA8FF", "#FFB37F", "#C9CDD6",
];

// The one market every seat has in every week, so it is the one line that can be
// charted across a season: the chance of being the week's low scorer. Watching a
// seat's karaoke price crater after their RB1 tears an ACL is the best thing this
// book will produce.
export function LineMovement({ weeks, sheets, cur }) {
  const latest = sheets[sheets.length - 1];
  const seats = latest.punishment.weekly.rows.map((r) => ({ id: r.rosterId, name: r.team }));
  const series = seats.map((s) =>
    sheets.map((sheet) => sheet.punishment.weekly.rows.find((r) => r.rosterId === s.id)?.pct ?? 0)
  );
  const maxY = Math.max(1, ...series.flat());
  const [W, H, padL, padR, padT, padB] = [720, 250, 42, 14, 12, 30];
  const x = (i) => (weeks.length === 1 ? padL : padL + (i * (W - padL - padR)) / (weeks.length - 1));
  const y = (v) => padT + (1 - v / maxY) * (H - padT - padB);
  const labelEvery = Math.max(1, Math.ceil(weeks.length / 9));

  return (
    <section className="bk-panel">
      <h2 className="bk-panel-title">LINE MOVEMENT — {latest.punishment.weekly.name} PRICE BY WEEK</h2>
      <p className="bk-blurb">
        Each seat's chance of being the week's low scorer, sheet over sheet. Climbing means the book has stopped
        believing in your roster.
      </p>
      <svg className="bk-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Low scorer probability by week">
        {[0, maxY / 2, maxY].map((v) => (
          <g key={v}>
            <line x1={padL} y1={y(v)} x2={W - padR} y2={y(v)} stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
            <text x={padL - 6} y={y(v) + 3} textAnchor="end" fontSize="9" fill="rgba(237,232,218,0.5)">
              {v.toFixed(0)}%
            </text>
          </g>
        ))}
        <line x1={x(cur)} y1={padT} x2={x(cur)} y2={H - padB} stroke="rgba(201,162,75,0.45)" strokeWidth="1" strokeDasharray="3 3" />
        {weeks.map((w, i) =>
          i % labelEvery === 0 || i === weeks.length - 1 ? (
            <text key={w} x={x(i)} y={H - padB + 14} textAnchor="middle" fontSize="9" fill={i === cur ? "#E4C46A" : "rgba(237,232,218,0.55)"}>
              W{w}
            </text>
          ) : null
        )}
        {series.map((values, s) => (
          <g key={seats[s].id}>
            <polyline
              points={values.map((v, i) => `${x(i)},${y(v)}`).join(" ")}
              fill="none"
              stroke={CHART_COLORS[s % CHART_COLORS.length]}
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
            {values.map((v, i) => (
              <circle key={i} cx={x(i)} cy={y(v)} r={i === cur ? 3 : 1.8} fill={CHART_COLORS[s % CHART_COLORS.length]}>
                <title>{`${seats[s].name} — week ${weeks[i]}: ${v}%`}</title>
              </circle>
            ))}
          </g>
        ))}
      </svg>
      <div className="bk-legend">
        {seats.map((s, i) => (
          <span key={s.id} className="bk-leg">
            <span className="bk-leg-swatch" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
            {s.name} <b>{sheets[cur].punishment.weekly.rows.find((r) => r.rosterId === s.id)?.price ?? "—"}</b>
          </span>
        ))}
      </div>
    </section>
  );
}
