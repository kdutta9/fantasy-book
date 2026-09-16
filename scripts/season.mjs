// The season simulator (DESIGN.md §5.5). One pass produces both the current
// week's score columns — which the weekly board prices off — and every season
// accumulator. Running it once rather than twice is not only cheaper: it means
// the moneyline on the card and the championship price in the futures board come
// from the same 25,000 seasons, so the two can never disagree.
//
// Everything inside the loop works in roster POSITIONS (0…n−1), not roster ids,
// so the hot path allocates nothing. Ids are attached once, at the end.

import { mulberry32 } from "./lib/rng.mjs";
import { compileLineup, drawSeasonForm, drawTeam } from "./engine.mjs";

const PLAYOFF_ROUNDS = 3; // weeks 15, 16, 17

// The bracket is derived, not read. Sleeper's winners_bracket already carries
// t1/t2 at week 1, but those are roster ids from a seeding that cannot exist yet
// (§3.2), so the only trustworthy thing in the response is its shape: seven
// matches, three rounds, placement games for 1st, 3rd and 5th. That shape
// describes exactly one standard six-team bracket — top two seeds bye, 4/5
// winner meets the 1 seed, 3/6 winner meets the 2 seed, no re-seeding — and
// `assertBracketShape` fails loudly if the committed structure stops agreeing.
// The consolation ladder is whatever seats missed the playoffs, and its size is a
// property of the league rather than a constant: twelve teams leave six behind,
// ten leave four. Sleeper publishes both shapes (a 7-match/3-round losers bracket
// for the first, 4-match/2-round for the second), so both are implemented
// explicitly and anything else fails loudly. Its last slot is the league's last
// place, which is what the season punishment settles on (§6.3).
const CONSOLATION = {
  6: { matches: 7, rounds: 3, places: "1,3,5" },
  4: { matches: 4, rounds: 2, places: "1,3" },
};

export function assertConsolationShape(bracket, seats) {
  const spec = CONSOLATION[seats];
  if (!spec) throw new Error(`No consolation bracket implemented for ${seats} seats out of the playoffs`);
  const rounds = new Set(bracket.map((m) => m.r));
  const places = bracket.filter((m) => m.p).map((m) => m.p).sort((a, b) => a - b);
  if (bracket.length !== spec.matches || rounds.size !== spec.rounds || places.join() !== spec.places)
    throw new Error(
      `Committed consolation bracket is not the ${spec.matches}-match / ${spec.rounds}-round / places-${spec.places} shape for ${seats} seats`
    );
}

export function assertBracketShape(bracket, playoffTeams) {
  if (playoffTeams !== 6) throw new Error(`Only the six-team bracket is implemented; this league has ${playoffTeams}`);
  const rounds = new Set(bracket.map((m) => m.r));
  const places = bracket.filter((m) => m.p).map((m) => m.p).sort((a, b) => a - b);
  if (bracket.length !== 7 || rounds.size !== PLAYOFF_ROUNDS || places.join() !== "1,3,5")
    throw new Error("Committed bracket is not the 7-match / 3-round / places-1,3,5 shape season.mjs implements");
}

// Six seeds → the six places they finish in, resolved on three fresh weekly
// draws rather than on season points: a playoff game is a football game.
// The consolation ladder runs the identical shape over the six seeds that
// missed, so its last slot is the league's last place — which is what THE BUS
// STOP settles on (§6.3).
// Four seats: 1v4 and 2v3, then winners for the top slot and losers for the
// bottom one — the shape Sleeper's own four-team losers bracket describes.
function playFour(seeds, rounds) {
  const beats = (round, a, b) => (rounds[round][a] >= rounds[round][b] ? [a, b] : [b, a]);
  const [w14, l14] = beats(0, seeds[0], seeds[3]);
  const [w23, l23] = beats(0, seeds[1], seeds[2]);
  const [first, second] = beats(1, w14, w23);
  const [third, fourth] = beats(1, l14, l23);
  return [first, second, third, fourth];
}

const playLadder = (seeds, rounds) =>
  seeds.length === 6 ? playBracket(seeds, rounds) : playFour(seeds, rounds);

function playBracket(seeds, rounds) {
  const beats = (round, a, b) => (rounds[round][a] >= rounds[round][b] ? [a, b] : [b, a]);
  const [w36, l36] = beats(0, seeds[2], seeds[5]);
  const [w45, l45] = beats(0, seeds[3], seeds[4]);
  const [wTop, lTop] = beats(1, seeds[0], w45);
  const [wSecond, lSecond] = beats(1, seeds[1], w36);
  const [first, second] = beats(2, wTop, wSecond);
  const [third, fourth] = beats(2, lTop, lSecond);
  const [fifth, sixth] = beats(2, l36, l45);
  return [first, second, third, fourth, fifth, sixth];
}

export function simulateSeason({
  rosterIds,
  weekLineups, // roster_id → this week's lineup, off this week's projection
  restLineups, // roster_id → a typical week, off the rest-of-season projection
  variance,
  seasonVariance,
  schedule, // { "<week>": [[rosterA, rosterB], …] }
  record, // roster_id → { wins, points } already banked before `week`
  week, // the week being previewed
  throughWeek, // last regular-season week (14 in both leagues)
  bracket,
  playoffTeams,
  sims,
  seed,
}) {
  assertBracketShape(bracket.winners, playoffTeams);
  assertConsolationShape(bracket.losers, rosterIds.length - playoffTeams);
  const rng = mulberry32(seed);
  const n = rosterIds.length;
  const at = new Map(rosterIds.map((id, i) => [id, i]));

  const thisWeek = rosterIds.map((id) => compileLineup(weekLineups.get(id), variance));
  // The week being previewed is priced off its own weekly projection, whose
  // error §5.2 already measured — no season multiplier is applied to it, so the
  // card prices exactly as it did before futures existed. Every later week runs
  // through `form`, redrawn once per simulated season.
  const restOfSeason = rosterIds.map((id) => compileLineup(restLineups.get(id), variance, seasonVariance));
  const form = restOfSeason.map((spec) => spec.map((p) => ({ ...p })));
  const regular = [];
  for (let w = week; w <= throughWeek; w++) regular.push({ w, isCurrent: w === week });
  // Positions, not ids, so the inner loop never touches a Map.
  const fixtures = Object.fromEntries(
    Object.entries(schedule).map(([w, pairs]) => [w, pairs.map(([a, b]) => [at.get(a), at.get(b)]).filter(([a, b]) => a != null && b != null)])
  );

  const current = rosterIds.map(() => new Float64Array(sims));
  const acc = {
    place: rosterIds.map(() => new Int32Array(n + 1)), // 1-indexed finishing place
    playoffs: new Int32Array(n),
    bye: new Int32Array(n),
    pointsTitle: new Int32Array(n),
    winsHist: rosterIds.map(() => new Int32Array(throughWeek + 1)),
    winsTotal: new Float64Array(n),
    pointsTotal: new Float64Array(n),
  };

  const score = new Float64Array(n);
  const wins = new Float64Array(n);
  const points = new Float64Array(n);
  // Games already played are banked, not re-simulated. Without this the futures
  // board resets the standings to 0-0 every week, which is wrong from week 2 on
  // and absurd by November: in LoOG's week-2 build bmilgram had won 156.4–104.8
  // and his title price still drifted OUT. The seeding tiebreak is wins then
  // points-for, so both have to carry, and a tie is half a win exactly as it is
  // inside the loop.
  const bankedWins = new Float64Array(n);
  const bankedPoints = new Float64Array(n);
  for (const [id, i] of at) {
    bankedWins[i] = record?.get(id)?.wins ?? 0;
    bankedPoints[i] = record?.get(id)?.points ?? 0;
  }
  const playoffRounds = Array.from({ length: PLAYOFF_ROUNDS }, () => new Float64Array(n));
  const order = new Int32Array(n);

  for (let s = 0; s < sims; s++) {
    wins.set(bankedWins);
    points.set(bankedPoints);
    for (let t = 0; t < n; t++) drawSeasonForm(restOfSeason[t], variance, rng, form[t]);
    for (const { w, isCurrent } of regular) {
      const spec = isCurrent ? thisWeek : form;
      for (let t = 0; t < n; t++) score[t] = drawTeam(spec[t], rng);
      if (w === week) for (let t = 0; t < n; t++) current[t][s] = score[t];
      for (const [i, j] of fixtures[w] ?? []) {
        points[i] += score[i];
        points[j] += score[j];
        // A dead-even week is a tie in both leagues' settings: half a win each.
        wins[i] += score[i] > score[j] ? 1 : score[i] === score[j] ? 0.5 : 0;
        wins[j] += score[j] > score[i] ? 1 : score[i] === score[j] ? 0.5 : 0;
      }
    }

    // Seeding: wins, then points-for — Sleeper's own tiebreak and the only one
    // a simulated season can produce.
    for (let t = 0; t < n; t++) order[t] = t;
    order.sort((a, b) => wins[b] - wins[a] || points[b] - points[a] || a - b);

    for (let r = 0; r < PLAYOFF_ROUNDS; r++) for (let t = 0; t < n; t++) playoffRounds[r][t] = drawTeam(form[t], rng);
    const finish = [
      ...playBracket([...order.slice(0, 6)], playoffRounds),
      ...playLadder([...order.slice(6)], playoffRounds),
    ];

    for (let p = 0; p < finish.length; p++) acc.place[finish[p]][p + 1]++;
    for (let r = 0; r < 6; r++) acc.playoffs[order[r]]++;
    acc.bye[order[0]]++;
    acc.bye[order[1]]++;

    let best = 0;
    for (let t = 1; t < n; t++) if (points[t] > points[best]) best = t;
    acc.pointsTitle[best]++;

    for (let t = 0; t < n; t++) {
      acc.winsHist[t][Math.round(wins[t])]++;
      acc.winsTotal[t] += wins[t];
      acc.pointsTotal[t] += points[t];
    }
  }

  return { current: new Map(rosterIds.map((id, i) => [id, current[i]])), acc, weeksSimulated: regular.length };
}
