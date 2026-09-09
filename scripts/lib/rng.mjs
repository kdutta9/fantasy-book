// Seeded RNG and the score distribution (DESIGN.md §5.3).
// `mulberry32` is ported from ../worldcup scripts/sportsbook/engine.mjs; the
// Gamma sampler is Marsaglia-Tsang with the k<1 boost, as in reference/spike.mjs.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Marsaglia polar. The spare is held on the generator, not in module scope, so
// two concurrent generators cannot bleed draws into each other — a module-level
// `spare` would make results depend on interleaving and break reproducibility.
export function gaussian(rng) {
  if (rng._spare != null) {
    const s = rng._spare;
    rng._spare = null;
    return s;
  }
  let u, v, s2;
  do {
    u = rng() * 2 - 1;
    v = rng() * 2 - 1;
    s2 = u * u + v * v;
  } while (s2 >= 1 || s2 === 0);
  const m = Math.sqrt((-2 * Math.log(s2)) / s2);
  rng._spare = v * m;
  return u * m;
}

export function gammaK(k, rng) {
  if (k < 1) return gammaK(k + 1, rng) * Math.pow(rng(), 1 / k);
  const d = k - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    const x = gaussian(rng);
    const v = (1 + c * x) ** 3;
    if (v <= 0) continue;
    const u = rng();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

// A weekly score: Gamma with the fitted mean and standard deviation.
// mu <= 0 means "no projection" — DESIGN.md §5.3: the player does not play.
export function drawScore(mu, sigma, rng) {
  if (mu <= 0) return 0;
  const k = (mu / sigma) ** 2;
  const theta = (sigma * sigma) / mu;
  return gammaK(k, rng) * theta;
}

// Deterministic per (league, week). Recorded in meta.seed and never derived
// from the clock — DESIGN.md §5.5.
export const seedFor = (leagueId, week) =>
  (0x5eed0000 ^ (week * 7919) ^ [...leagueId].reduce((a, c) => a + c.charCodeAt(0), 0)) >>> 0;
