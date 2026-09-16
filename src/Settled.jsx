// "Sheet W settles week W−1" (DESIGN.md §8.1), finally rendered. This is the
// only panel on the book that looks backwards, and it is the only one that can
// be wrong in public — which is the point. A sheet that only ever prints
// forward-looking prices can never be caught, and a book nobody can catch is a
// book nobody believes.
//
// Every number here comes from `sheet.settled`, built by scripts/settle.mjs off
// the league's own committed artifacts. Nothing is computed in the view.

import { Markdown } from "./markdown";

export default function Settled({ settled, punishment, Panel, note, benchNote }) {
  const { reportCard: card } = settled;
  return (
    <>
      <Panel
        title={`HOW WEEK ${settled.week} SETTLED`}
        blurb={note ? null : "Final scores against the lines this book posted last Wednesday. Side A is the side that was favoured."}
      >
        {note && <Markdown text={note} className="fb-prose-cols" />}
        <div className="fb-settled-head">
          <span>RESULT</span>
          <span>LINE</span>
          <span className="spread">ATS</span>
          <span className="total">TOTAL</span>
        </div>
        <div className="fb-card">
          {settled.matchups.map((m) => <SettledRow key={`${m.a.rosterId}-${m.b.rosterId}`} m={m} />)}
        </div>

        <div className="fb-report">
          <h3 className="fb-report-title">THE MODEL'S REPORT CARD</h3>
          <div className="fb-report-grid">
            <Record label="FAVOURITES SU" record={card.straightUp} />
            <Record label="FAVOURITES ATS" record={card.ats} />
            <Record label="TOTALS — OVER" record={card.total} />
            <div className="fb-report-cell">
              <span className="fb-report-num">{card.brier.toFixed(3)}</span>
              <span className="fb-report-label">BRIER SCORE</span>
              <span className="fb-report-note">
                {card.brier < card.coinFlip ? "better" : "worse"} than {card.coinFlip.toFixed(2)}, which is what you
                score by calling every game a coin flip
              </span>
            </div>
          </div>
          <p className="fb-note">
            The book expected {card.expectedChalkWins.toFixed(2)} of its {card.games} favourites to win. {" "}
            {card.straightUp.w} did. Prices are graded on the fair probability, before the house margin — the margin is
            the book's edge, not the model's opinion.
          </p>
        </div>
      </Panel>

      <div className="fb-grid2">
        <Panel title={`${settled.punishment.low.name} — SETTLED`} blurb={punishment.weekly.copy}>
          <Verdict
            outcome={settled.punishment.low}
            verb="took it"
            copy={
              settled.punishment.low.hitFavourite
                ? "The board's own favourite. The book called this one."
                : `Priced ${settled.punishment.low.price}, ${ordinalOf(settled.punishment.low.rank)} of ${settled.punishment.low.of} on the board.`
            }
          />
          {settled.punishment.high && (
            <Verdict
              outcome={settled.punishment.high}
              verb="picks"
              copy={`${settled.punishment.high.name} — ${settled.punishment.high.price} on the board, ${ordinalOf(settled.punishment.high.rank)} of ${settled.punishment.high.of}.`}
            />
          )}
          {settled.punishment.joint && (
            <p className="fb-note">
              {settled.punishment.joint.hit ? (
                <>
                  The joint <b>hit</b> at {settled.punishment.joint.hit.price}. It was one of{" "}
                  {settled.punishment.joint.offered} priced pairings out of{" "}
                  {settled.punishment.joint.offered > 1 ? "dozens" : "many"} possible.
                </>
              ) : (
                <>
                  None of the {settled.punishment.joint.offered} featured joints hit — the pairing that landed was{" "}
                  {settled.punishment.joint.low.team} and {settled.punishment.joint.high.team}, which the sheet did not
                  print.
                </>
              )}
            </p>
          )}
        </Panel>

        <Panel
          title="POINTS LEFT ON THE BENCH"
          blurb="Every line on last week's sheet assumed an optimal lineup. This is what that assumption actually cost, scored on real points — the model's own §5.4 bias, measured rather than disclosed."
        >
          {benchNote && <Markdown text={benchNote} className="fb-panel-prose" />}
          <div className="fb-bench">
            {settled.bench.slice(0, 5).map((row, i) => (
              <div key={row.rosterId} className={i === 0 ? "fb-bench-row lead" : "fb-bench-row"}>
                <span className="fb-bench-main">
                  <span className="fb-runner-team">{row.team}</span>
                  <span className="fb-runner-mgr">
                    {row.points.toFixed(2)} of a possible {row.best.toFixed(2)}
                    {row.missed.length > 0 && (
                      <> · benched {row.missed.map((p) => `${p.name} ${p.points.toFixed(1)}`).join(", ")}</>
                    )}
                  </span>
                </span>
                <span className="bk-price">−{row.left.toFixed(1)}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </>
  );
}

const Record = ({ label, record }) => (
  <div className="fb-report-cell">
    <span className="fb-report-num">
      {record.w}–{record.l}
      {record.p ? `–${record.p}` : ""}
    </span>
    <span className="fb-report-label">{label}</span>
  </div>
);

const Verdict = ({ outcome, verb, copy }) => (
  <div className="fb-verdict">
    <span className="fb-slip-text">
      <b>{outcome.team}</b> {verb} — {outcome.points.toFixed(2)}
      <span className="fb-slip-note">
        {outcome.manager} · {copy}
      </span>
    </span>
    <span className="bk-price">{outcome.price ?? "—"}</span>
  </div>
);

function SettledRow({ m }) {
  if (!m.played) return null;
  return (
    <div className="fb-settled">
      <div className="fb-seats">
        <SettledSeat seat={m.a} points={m.a.points} won={m.winner === "a"} push={m.winner === "push"} />
        <SettledSeat seat={m.b} points={m.b.points} won={m.winner === "b"} push={m.winner === "push"} />
      </div>
      <div className="fb-cell">
        <span className="fb-odds">{m.posted.moneyline.a}</span>
        <Mark hit={m.winner === "a"} push={m.winner === "push"} />
      </div>
      <div className="fb-cell spread">
        <span className="fb-odds">{m.posted.spread.a}</span>
        <Mark hit={m.ats === "a"} push={m.ats === "push"} />
      </div>
      <div className="fb-cell total">
        <span className="fb-odds">{m.total.toFixed(1)}</span>
        <span className="fb-settled-sub">
          {m.ou === "push" ? "push" : m.ou === "a" ? "over" : "under"} {m.posted.total.line.toFixed(1)}
        </span>
      </div>
    </div>
  );
}

const SettledSeat = ({ seat, points, won, push }) => (
  <span className={won ? "fb-seat fav" : "fb-seat"}>
    <span className="fb-seat-name">{seat.team}</span>
    <span className="fb-seat-mgr">
      {seat.manager}
      {push ? " · tie" : ""}
    </span>
    <span className="fb-seat-proj">{points.toFixed(2)}</span>
  </span>
);

const Mark = ({ hit, push }) => (
  <span className={push ? "fb-mark push" : hit ? "fb-mark hit" : "fb-mark miss"}>{push ? "PUSH" : hit ? "✓" : "✗"}</span>
);

const ordinalOf = (n) => (n == null ? "unpriced" : `${n}${["th", "st", "nd", "rd"][(n % 100 >> 3) ^ 1 && n % 10] || "th"}`);
