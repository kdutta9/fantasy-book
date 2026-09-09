import { useEffect, useState } from "react";
import { loadBook, loadBooksIndex } from "./data";
import { LineMovement, PriceMove } from "./movement";
import Futures from "./Futures";

// `?book=<id>` → that league's sheet, `?book` → the lobby. This view only
// renders the JSON; every number on it was priced by scripts/build-book.mjs from
// committed inputs and a fixed seed. Chrome, panels and price styling are ported
// from ../worldcup src/Sportsbook.jsx.

export default function Sportsbook({ bookId, week, view }) {
  const [state, setState] = useState({ status: "loading" });
  const [cur, setCur] = useState(0);

  useEffect(() => {
    let live = true;
    const done = (next) => live && setState(next);
    if (bookId) {
      loadBook(bookId)
        .then(({ weeks, sheets }) => {
          done({ status: "ok", weeks, sheets });
          const at = week != null ? weeks.indexOf(week) : -1;
          setCur(at >= 0 ? at : weeks.length - 1); // newest sheet by default
        })
        .catch(() => done({ status: "error" }));
    } else {
      loadBooksIndex()
        .then((index) => done({ status: "ok", index }))
        .catch(() => done({ status: "error" }));
    }
    return () => {
      live = false;
    };
  }, [bookId, week]);

  return (
    <div className="book-root">
      <div className="bk-backbar">
        <a className="bk-back" href="?book">← The lobby</a>
      </div>
      <div className="book-wrap">
        {state.status === "loading" && <p className="state-msg">Opening the book…</p>}
        {state.status === "error" && (
          <p className="state-msg">
            No sheet posted for this league. <a className="bk-link" href="?book">Back to the lobby</a>
          </p>
        )}
        {state.status === "ok" && state.index && <Lobby index={state.index} />}
        {state.status === "ok" && state.sheets && (
          <Sheet
            sheet={state.sheets[cur]}
            prev={cur > 0 ? state.sheets[cur - 1] : null}
            weeks={state.weeks}
            sheets={state.sheets}
            cur={cur}
            view={view}
            onNav={setCur}
          />
        )}
      </div>
    </div>
  );
}

function Lobby({ index }) {
  useEffect(() => {
    document.title = "The Fantasy Book";
  }, []);
  return (
    <>
      <header className="bk-head">
        <p className="bk-eyebrow">THE HOUSE ALWAYS WINS</p>
        <h1 className="bk-title">THE FANTASY BOOK</h1>
        <p className="bk-sub">Two leagues. Eighteen weeks. One coin-flip sport.</p>
      </header>
      <div className="group-list" style={{ marginTop: 28 }}>
        {index.map((b) => (
          <a key={b.id} className="group-link" href={`?book=${b.id}`}>
            <div className="gl-name">{b.name}</div>
            <div className="gl-meta">{b.kind === "crossover" ? "Both leagues, one weekend →" : "Open the book →"}</div>
          </a>
        ))}
      </div>
    </>
  );
}

// Every panel is anchorable, so a slip can be linked straight from the group
// chat: ?book=nicks#the-joint-who-sings-what
const slug = (title) => title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function Panel({ title, blurb, children }) {
  return (
    <section className="bk-panel" id={slug(title)}>
      <h2 className="bk-panel-title">{title}</h2>
      {blurb && <p className="bk-blurb">{blurb}</p>}
      {children}
    </section>
  );
}

function WeekNav({ weeks, cur, onNav }) {
  return (
    <div className="fb-weeknav">
      <button className="bk-nav-btn" disabled={cur === 0} onClick={() => onNav(cur - 1)}>‹ PREV</button>
      <select className="bk-nav-select" value={cur} onChange={(e) => onNav(Number(e.target.value))}>
        {weeks.map((w, i) => (
          <option key={w} value={i}>WEEK {w}</option>
        ))}
      </select>
      <button className="bk-nav-btn" disabled={cur === weeks.length - 1} onClick={() => onNav(cur + 1)}>NEXT ›</button>
    </div>
  );
}

function Sheet({ sheet, prev, weeks, sheets, cur, view, onNav }) {
  const isCrossover = sheet.id === "crossover";
  // The crossover is a single page and ignores `view` — it has no futures board
  // of its own, only slips derived from two committed league sheets (§6.7).
  const page = isCrossover ? "crossover" : view;

  useEffect(() => {
    const label = page === "season" ? seasonTitle(sheet) : `Week ${sheet.week}`;
    document.title = `${sheet.bookName} · ${label}`;
  }, [sheet.bookName, sheet.week, page]);

  // The browser tries to jump to #the-joint before React has rendered anything,
  // so a shared panel link would always land at the top. Re-run it once the
  // sheet is on the page.
  useEffect(() => {
    const target = window.location.hash && document.getElementById(decodeURIComponent(window.location.hash.slice(1)));
    if (target) target.scrollIntoView();
  }, [sheet.id, sheet.week]);

  return (
    <>
      <Head sheet={sheet} weeks={weeks} cur={cur} onNav={onNav} page={page} />
      {page === "crossover" && <Crossover sheet={sheet} />}
      {page === "week" && <Week sheet={sheet} prev={prev} sheets={sheets} weeks={weeks} cur={cur} />}
      {page === "season" && <Season sheet={sheet} prev={prev} />}
      <FinePrint sheet={sheet} page={page} />
    </>
  );
}

// At week 1 nothing has been played, so the futures board IS the season preview.
// From week 2 it is a live futures board that happens to carry a preview written
// in week 1 — so it stops calling itself a preview and says when the prose was
// written instead.
const seasonTitle = (sheet) => (sheet.week === 1 ? "Season preview" : "The futures board");

function Head({ sheet, weeks, cur, onNav, page }) {
  return (
    <header className="bk-head">
      <p className="bk-eyebrow">THE HOUSE ALWAYS WINS</p>
      <h1 className="bk-title">{sheet.bookName}</h1>
      <p className="bk-sub">
        {sheet.tagline} · Week {sheet.week}, {sheet.season}
        {sheet.meta.seed ? <> · Seed <code>{sheet.meta.seed}</code></> : null}
      </p>
      {sheet.stakes && (
        <div className="bk-chips">
          <span className="bk-chip">Buy-in <b>{sheet.stakes.buyIn}</b></span>
          <span className="bk-chip">Pot <b>{sheet.stakes.pot}</b></span>
          {sheet.stakes.payouts.map((p) => (
            <span key={p.place} className="bk-chip">
              {ordinal(p.place)} <b>{p.label}</b>
            </span>
          ))}
        </div>
      )}
      <div className="bk-banner">LINES BUILT FROM {sheet.meta.sources}</div>
      {page !== "crossover" && weeks.length > 1 && <WeekNav weeks={weeks} cur={cur} onNav={onNav} />}
      {page !== "crossover" && (
        <nav className="fb-viewnav">
          <a className={page === "week" ? "active" : ""} href={`?book=${sheet.id}&w=${sheet.week}`}>
            THE CARD — WEEK {sheet.week}
          </a>
          <a className={page === "season" ? "active" : ""} href={`?book=${sheet.id}&w=${sheet.week}&view=season`}>
            {seasonTitle(sheet).toUpperCase()}
          </a>
        </nav>
      )}
      <nav className="fb-booknav">
        <a href="?book">All books</a>
        <a className={page === "crossover" ? "active" : ""} href="?book=crossover">The Crossover</a>
      </nav>
    </header>
  );
}

// --- The week card (?book=<id>) ----------------------------------------------
// Everything that settles this Sunday. The season-long boards live on their own
// page so that a reader looking for "who do I play and am I favoured" does not
// have to scroll past seven futures ladders to find out.

function Week({ sheet, prev, sheets, weeks, cur }) {
  const { punishment } = sheet;
  return (
    <>
      <Panel
        title={`THE CARD — WEEK ${sheet.week}`}
        blurb="Moneyline, spread and total on every matchup. Spreads and totals are the half-point where the simulated distribution splits evenly, so both sides post at −110 — the line moves, not the price."
      >
        <div className="fb-match-head">
          <span>MATCHUP</span>
          <span>MONEYLINE</span>
          <span className="spread">SPREAD</span>
          <span className="total">TOTAL</span>
        </div>
        <div className="fb-card">
          {sheet.matchups.map((m) => (
            <Matchup key={`${m.a.rosterId}-${m.b.rosterId}`} m={m} prev={findMatchup(prev, m)} />
          ))}
        </div>
      </Panel>

      {sheets.length > 1 && <LineMovement weeks={weeks} sheets={sheets} cur={cur} />}

      <div className={punishment.paired ? "fb-grid2" : ""}>
        <Panel title={`${punishment.weekly.name} — LOW SCORER`} blurb={punishment.weekly.copy}>
          {punishment.weekly.parlay && (
            <p className="fb-note">
              {punishment.weekly.legs ?? punishment.weekly.parlay.legs} legs · ${punishment.weekly.parlay.stake} ·
              lifetime record <b>{punishment.weekly.parlay.lifetimeHits}</b> hits.
            </p>
          )}
          <Runners rows={punishment.weekly.rows} prevRows={prev?.punishment?.weekly?.rows} />
        </Panel>
        {punishment.paired && (
          <Panel title={`${punishment.paired.name} — HIGH SCORER`} blurb={punishment.paired.copy}>
            <Runners rows={punishment.paired.rows} prevRows={prev?.punishment?.paired?.rows} />
          </Panel>
        )}
      </div>

      {punishment.joints.length > 0 && (
        <Panel
          title="THE JOINT — WHO SINGS WHAT"
          blurb="Low scorer and high scorer in the same week, priced together rather than multiplied: a 145-point week makes you the high scorer and makes someone else the low one, so these are not independent."
        >
          {punishment.joints.map((j) => (
            <div key={`${j.low.rosterId}-${j.high.rosterId}`} className="fb-slip">
              <span className="fb-slip-text">
                <b>{j.low.team}</b> sings a song picked by <b>{j.high.team}</b>
                <span className="fb-slip-note">{j.low.manager} · {j.high.manager} · {j.pct}%</span>
              </span>
              <span className="bk-price">{j.price}</span>
            </div>
          ))}
        </Panel>
      )}

      <Panel
        title="THE LINEUPS"
        blurb="Optimal by projection against each league's roster slots — what a manager knows Sunday morning. Scores are drawn on the simulation, never on the projection, which would be lookahead bias."
      >
        <div className="fb-lineups">
          {[...sheet.lineups].sort((a, b) => b.projected - a.projected).map((seat) => (
            <Lineup key={seat.rosterId} seat={seat} />
          ))}
        </div>
      </Panel>
    </>
  );
}

// --- The season page (?book=<id>&view=season) --------------------------------

function Season({ sheet, prev }) {
  return (
    <>
      {sheet.preview && <Preview preview={sheet.preview} week={sheet.week} />}
      <Futures sheet={sheet} prev={prev} Panel={Panel} />
    </>
  );
}

function Preview({ preview, week }) {
  return (
    <section className="bk-panel fb-preview" id="season-preview">
      <h2 className="bk-panel-title">{week === 1 ? "SEASON PREVIEW" : `SEASON PREVIEW — WRITTEN WEEK ${preview.writtenWeek}`}</h2>
      {preview.standfirst && <p className="fb-standfirst">{preview.standfirst}</p>}
      {/* Two columns at desktop width. A single 980px-wide measure of serif body
          text is ~140 characters a line, which is unreadable, but capping it at
          68ch left half the panel empty. Columns fill the box AND keep the line
          length right. One column below 900px. */}
      <div className="fb-prose-cols">
        {preview.paragraphs.map((para, i) => (
          <p key={i} className="fb-prose">{para}</p>
        ))}
      </div>
      {week > preview.writtenWeek && (
        <p className="fb-note">
          Written in week {preview.writtenWeek} and left alone since. The boards below are current; the prose is not.
        </p>
      )}
    </section>
  );
}

function Matchup({ m, prev }) {
  return (
    <div className="fb-match">
      <div className="fb-seats">
        <Seat seat={m.a} proj={m.projected.a} fav />
        <Seat seat={m.b} proj={m.projected.b} />
      </div>
      <div className="fb-cell">
        <span className="fb-odds">{m.moneyline.a}</span>
        <span className="fb-odds dim">{m.moneyline.b}</span>
        <PriceMove now={m.moneyline.a} was={prev?.moneyline?.a} />
      </div>
      <div className="fb-cell spread">
        <span className="fb-odds">{m.spread.a}<small>{m.spread.price}</small></span>
        <span className="fb-odds dim">{m.spread.b}<small>{m.spread.price}</small></span>
      </div>
      <div className="fb-cell total">
        <span className="fb-odds">O {m.total.line.toFixed(1)}<small>{m.total.over}</small></span>
        <span className="fb-odds dim">U {m.total.line.toFixed(1)}<small>{m.total.under}</small></span>
      </div>
    </div>
  );
}

const Seat = ({ seat, proj, fav }) => (
  <span className={fav ? "fb-seat fav" : "fb-seat"}>
    <span className="fb-seat-name">{seat.team}</span>
    <span className="fb-seat-mgr">{seat.manager}</span>
    <span className="fb-seat-proj">{proj.toFixed(1)}</span>
  </span>
);

function Runners({ rows, prevRows }) {
  const top = Math.max(...rows.map((r) => r.pct));
  return (
    <div className="fb-runners">
      {rows.map((r, i) => (
        <div key={r.rosterId} className={i === 0 ? "fb-runner lead" : "fb-runner"}>
          <span className="fb-runner-main">
            <span className="fb-runner-team">{r.team}</span>
            <span className="fb-bar" style={{ width: `${(r.pct / top) * 100}%` }} />
            <span className="fb-runner-mgr">{r.manager}</span>
          </span>
          <span className="fb-runner-pct">{r.pct}%</span>
          <span className="bk-line-right">
            <PriceMove now={r.price} was={prevRows?.find((p) => p.rosterId === r.rosterId)?.price} />
            <span className="bk-price">{r.price}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

function Lineup({ seat }) {
  return (
    <div className="fb-lineup">
      <div className="fb-lineup-head">
        <span className="fb-lineup-name">{seat.team}</span>
        <span className="fb-lineup-proj">{seat.projected.toFixed(1)}</span>
      </div>
      {seat.players.map((p, i) => (
        <div key={`${p.slot}-${i}`} className={p.name ? "fb-slot" : "fb-slot empty"}>
          <span className="fb-slot-tag">{p.slot}</span>
          <span className="fb-slot-name">
            {p.name ?? "no eligible player"}
            {p.name && <small> {p.position} {p.team}</small>}
          </span>
          <span className="fb-slot-mu">{p.mu.toFixed(1)}</span>
        </div>
      ))}
      {seat.emptySlots.length > 0 && (
        <p className="fb-warn">
          Forfeits {seat.emptySlots.join(", ")} — nobody on the roster is eligible. Worth roughly eight points, and it is
          why this line looks the way it does.
        </p>
      )}
    </div>
  );
}

// --- The crossover sheet (§6.7) ---------------------------------------------

function Crossover({ sheet }) {
  return (
    <>
      <Panel
        title="THE HEADLINE"
        blurb={`${sheet.managers.length} managers hold a seat in both leagues. These slips cannot live on a league sheet — no league's book may read another league's data — so they get their own.`}
      >
        <div className="fb-headline">
          <span>
            <span className="fb-headline-label">{sheet.headline.label}</span>
            <span className="fb-headline-copy">{sheet.headline.copy} · {sheet.headline.pct}%</span>
          </span>
          <span className="fb-headline-price">{sheet.headline.price}</span>
        </div>
      </Panel>
      {sheet.managers.map((m) => (
        <Panel
          key={m.manager}
          title={m.manager.toUpperCase()}
          blurb={m.seats.map((s) => `${s.team} (${labelOf(sheet, s.league)})`).join("  ·  ")}
        >
          {m.slips.map((s) => (
            <div key={s.label} className="fb-slip">
              <span className="fb-slip-text">
                <b>{s.label}</b>
                <span className="fb-slip-note">{s.copy} · {s.pct}%</span>
              </span>
              <span className="bk-price">{s.price}</span>
            </div>
          ))}
        </Panel>
      ))}
    </>
  );
}

// --- Fine print (§10) --------------------------------------------------------

function FinePrint({ sheet, page }) {
  return (
    <footer className="bk-fine-block">
      <p className="bk-fine">
        <b>HOW THE SAUSAGE IS MADE.</b>{" "}
        {sheet.id === "crossover" ? (
          <>
            Every price here is the product of two numbers each league's own sheet already posted. This pass runs no
            simulation of its own and reads no league's inputs — it only multiplies committed probabilities, which is
            what keeps the two books independent.
          </>
        ) : (
          <>
            Every rostered player's projected points come from Sleeper's own weekly projection, scored through this
            league's exact scoring settings ({sheet.meta.scoringKeys} keys, reproducing Sleeper's published totals to a
            mean absolute error of {sheet.meta.mae}). Weekly scores are drawn from a Gamma distribution whose spread was
            fitted on 2025 projection residuals, position by position — a receiver projected for 18 is far more volatile
            than a quarterback projected for 18, and a pooled number would misprice the top and bottom of every lineup
            in opposite directions. The week was simulated {sheet.meta.sims.toLocaleString()} times.
          </>
        )}
      </p>
      <p className="bk-fine">
        <b>WHAT THIS BOOK CANNOT DO.</b> {sheet.meta.disclosures.join(" ")}
      </p>
      {sheet.meta.overrides?.length > 0 && (
        <p className="bk-fine">
          <b>MANUAL OVERRIDES.</b>{" "}
          {sheet.meta.overrides.map((o) => `${o.player} ${o.was} → ${o.pts}${o.note ? ` (${o.note})` : ""}`).join(" · ")}
        </p>
      )}
      <p className="bk-fine">
        <b>HOUSE RULES.</b> All prices include the house's margin. Ties split. Rosters as pulled
        {sheet.meta.pulledAt ? ` ${sheet.meta.pulledAt.slice(0, 10)}` : ""}; once a week's sheet is posted it is frozen and
        never repriced. For entertainment only.
      </p>
      <p className="bk-foot">{sheet.bookName} · EST. SEPTEMBER 2026 · NO REFUNDS</p>
      <p className="bk-foot-nav">
        {page === "week" && (
          <>
            <a className="bk-link" href={`?book=${sheet.id}&w=${sheet.week}&view=season`}>{seasonTitle(sheet)}</a> ·{" "}
          </>
        )}
        {page === "season" && (
          <>
            <a className="bk-link" href={`?book=${sheet.id}&w=${sheet.week}`}>The card — week {sheet.week}</a> ·{" "}
          </>
        )}
        <a className="bk-link" href="?book">All books</a> ·{" "}
        <a className="bk-link" href="?book=crossover">The Crossover</a>
      </p>
    </footer>
  );
}

// --- helpers -----------------------------------------------------------------

const ordinal = (n) => `${n}${["th", "st", "nd", "rd"][(n % 100 >> 3) ^ 1 && n % 10] || "th"}`;

const labelOf = (sheet, leagueId) => sheet.leagues.find((l) => l.id === leagueId)?.displayName ?? leagueId;

// The same two seats in a prior sheet, re-oriented to this row's a/b order — the
// favourite can flip week to week, and comparing a price to its own opposite
// would render an arrow pointing the wrong way.
function findMatchup(prev, m) {
  if (!prev?.matchups) return null;
  const same = (x) => new Set([x.a.rosterId, x.b.rosterId]);
  const hit = prev.matchups.find((x) => {
    const s = same(x);
    return s.has(m.a.rosterId) && s.has(m.b.rosterId);
  });
  if (!hit) return null;
  if (hit.a.rosterId === m.a.rosterId) return hit;
  return { moneyline: { a: hit.moneyline.b, b: hit.moneyline.a } };
}
