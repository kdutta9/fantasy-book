// PROJECTED STANDINGS — the primary object of the season page.
//
// It replaces six ladders. Top 2, money back, make the playoffs, first-round bye
// and most points are all monotone in team strength, so each printed the same
// ranking: measured at rho ≥ 0.94 against the championship board. Ninety-six
// rows of one fact. This is that fact, once, plus the thing no ladder could show
// — the SHAPE of a seat's season.
//
// The distribution strip is the point. A cumulative market can only ever tell you
// "X% to finish top three"; twelve exact-finish probabilities tell you whether a
// seat is a genuine contender or merely the tallest of twelve short people.

const money = (r) => r.money.reduce((t, m) => t + m.pct, 0);

export default function Standings({ standings, payingPlaces, structure, stakes, Panel }) {
  const n = standings[0].dist.length;
  const paying = new Set(payingPlaces);
  const winnerTakeAll = structure === "winner-take-all";

  return (
    <Panel
      title="PROJECTED STANDINGS"
      blurb={
        winnerTakeAll
          ? `Where every seat actually finishes, across ${"25,000"} simulated seasons. The gold block is first place — the only finish in this league worth money. Everything to the right of it is the same season with nothing at the end of it.`
          : `Where every seat actually finishes, across 25,000 simulated seasons. The gold blocks are the four finishes that pay; the wider a seat's gold, the more often its season ends with money. Hover any block for the price on that exact finish.`
      }
    >
      <div className="fb-standings">
        <div className="fb-st-head">
          <span className="fb-st-rank">#</span>
          <span className="fb-st-seat">SEAT</span>
          <span className="fb-st-num">PROJ</span>
          <span className="fb-st-num">RECORD</span>
          <span className="fb-st-num">PTS</span>
          <span className="fb-st-dist">FINISH DISTRIBUTION — 1ST ({n}TH) </span>
          <span className="fb-st-num">{winnerTakeAll ? "WINS" : "MONEY"}</span>
          <span className="fb-st-num">LAST</span>
        </div>
        {standings.map((r) => (
          <div key={r.rosterId} className="fb-st-row">
            <span className="fb-st-rank">{r.rank}</span>
            <span className="fb-st-seat">
              <span className="fb-st-team">{r.team}</span>
              <span className="fb-st-mgr">{r.manager}</span>
            </span>
            <span className="fb-st-num strong">{r.projFinish.toFixed(1)}</span>
            <span className="fb-st-num">{r.projWins.toFixed(1)}–{r.projLosses.toFixed(1)}</span>
            <span className="fb-st-num">{r.projPoints.toLocaleString("en-US")}</span>
            <span className="fb-st-dist">
              {r.dist.map((p, i) => {
                const place = i + 1;
                const pay = r.money.find((m) => m.place === place);
                return (
                  <span
                    key={place}
                    className={paying.has(place) ? "fb-seg pays" : "fb-seg"}
                    style={{ flexGrow: Math.max(p, 0.15) }}
                    title={
                      pay
                        ? `${ordinal(place)} — ${pay.label} — ${pay.pct}% — ${pay.price}`
                        : `${ordinal(place)} — ${p}%${place === n ? " — last" : ""}`
                    }
                  />
                );
              })}
            </span>
            <span className="fb-st-num strong">{money(r).toFixed(1)}%</span>
            <span className="fb-st-num dim">{r.last}%</span>
          </div>
        ))}
      </div>
      <p className="fb-note">
        PROJ is the average finishing place across every simulated season, so it moves before any single market does —
        a seat can drift from 6.4 to 6.9 without its championship price changing at all.{" "}
        {winnerTakeAll
          ? `Only first place pays in this league, so the MONEY column is the championship number.`
          : `MONEY is the chance of finishing in one of the four paying places — first, second, third, or fourth exactly.`}
      </p>
    </Panel>
  );
}

const ordinal = (x) => `${x}${["th", "st", "nd", "rd"][(x % 100 >> 3) ^ 1 && x % 10] || "th"}`;
