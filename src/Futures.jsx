import { useEffect, useState } from "react";
import { PriceMove } from "./movement";
import { accruedInterest, money } from "./interest";
import Standings from "./Standings";

// The season board (DESIGN.md §6.2). The two leagues diverge here and only here,
// because their payout structures are opposites: Nick's pays places 1 through 4,
// so it gets a four-deep ladder; DKEnasty is winner-take-all, so its
// championship board IS the financial book and everything else is pride. There
// is deliberately no "to cash" market in DKEnasty — there is no cash but first.

export default function Futures({ sheet, prev, Panel }) {
  const { futures, stakes } = sheet;
  const winnerTakeAll = futures.structure === "winner-take-all";
  const market = (key) => futures.markets.find((m) => m.key === key);
  const prevRows = (key) => prev?.futures?.markets?.find((m) => m.key === key)?.rows;

  // `market` rather than `key`: React swallows a prop called key, and the board
  // would silently render the wrong market.
  const Board = ({ market: id, blurb, compact }) => {
    const m = market(id);
    return m ? (
      <Panel title={m.pays ? `${m.name} — PAYS ${m.pays.toUpperCase()}` : m.name} blurb={m.copy ?? blurb}>
        <Ladder rows={m.rows} prevRows={prevRows(id)} compact={compact} />
      </Panel>
    ) : null;
  };

  return (
    <>
      <Standings
        standings={futures.standings}
        payingPlaces={futures.payingPlaces}
        structure={futures.structure}
        stakes={stakes}
        Panel={Panel}
      />

      <Board
        market="championship"
        blurb={
          winnerTakeAll
            ? `${stakes.pot}, winner take all. Nobody else gets a cent, which makes this the entire financial book — every other market on this sheet is pride.`
            : `The headline, and the only board here that is not a slice of the table above: winning the bracket is not the same question as finishing high, because three playoff weeks are three more coin flips.`
        }
      />

      {!winnerTakeAll && <TheInterest sheet={sheet} Panel={Panel} />}

      <Board market="lastPlace" />

      <Panel
        title="SEASON WIN TOTALS"
        blurb="Over/under on regular-season wins, per seat. The line is the half-win the simulated seasons split closest to evenly; unlike a weekly total, wins are integers, so these are priced on the real number rather than posted flat."
      >
        <div className="fb-wintotals">
          {[...futures.winTotals].sort((a, b) => b.expected - a.expected).map((w) => (
            <div key={w.rosterId} className="fb-wintotal">
              <span className="fb-wintotal-name">{w.team}</span>
              <span className="fb-wintotal-line">{w.line.toFixed(1)}</span>
              <span className="fb-wintotal-prices">
                O {w.over} · U {w.under}
              </span>
              <span className="fb-wintotal-exp">{w.expected} proj</span>
            </div>
          ))}
        </div>
      </Panel>
    </>
  );
}

function Ladder({ rows, prevRows, compact }) {
  const top = Math.max(...rows.map((r) => r.pct), 1);
  return (
    <div className="fb-runners">
      {rows.map((r, i) => (
        <div key={r.rosterId} className={i === 0 ? "fb-runner lead" : "fb-runner"}>
          <span className="fb-runner-main">
            <span className="fb-runner-team">{r.team}</span>
            <span className="fb-bar" style={{ width: `${(r.pct / top) * 100}%` }} />
            {!compact && <span className="fb-runner-mgr">{r.manager}</span>}
          </span>
          <span className="fb-runner-pct">{r.pct}%</span>
          <span className="bk-line-right">
            <PriceMove now={r.price} was={prevRows?.find((p) => p.rosterId === r.rosterId)?.price} />
            <span className="bk-price">{r.price ?? "OFF"}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

// Fourth place is playing for the interest the pot earned in a savings account.
// The number is computed against the reader's own clock, so it ticks up every
// time anyone opens the sheet — which is the entire joke.
function TheInterest({ sheet, Panel }) {
  const hysa = sheet.stakes.hysa;
  const [interest, setInterest] = useState(() => accruedInterest(hysa));
  useEffect(() => {
    if (!hysa) return undefined;
    const timer = setInterval(() => setInterest(accruedInterest(hysa)), 60000);
    return () => clearInterval(timer);
  }, [hysa]);
  return (
    <Panel
      title="THE INTEREST — 4TH EXACTLY"
      blurb={
        hysa
          ? `First takes ${sheet.stakes.payouts[0]?.label}, second ${sheet.stakes.payouts[1]?.label}, third gets the buy-in back. Fourth gets the interest the pot has earned sitting in a savings account at ${(hysa.apy * 100).toFixed(2)}% APY. That is a real prize, this is what it is worth right now, and the fourth block of every bar above is who is most likely to collect it.`
          : "Fourth place, exactly."
      }
    >
      {interest && (
        <div className="fb-headline">
          <span>
            <span className="fb-headline-label">{money(interest.now)}</span>
            <span className="fb-headline-copy">
              accrued on {money(interest.principal)} over {interest.days} of {interest.totalDays} days ·{" "}
              {interest.settled ? "final" : `${money(interest.atPayout)} if it runs to payout`}
            </span>
          </span>
          <span className="fb-headline-price">4TH</span>
        </div>
      )}
    </Panel>
  );
}
