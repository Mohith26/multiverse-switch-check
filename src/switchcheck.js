// Switch Check core: anytime-valid paired non-inferiority for model switches.
// Pure functions, no DOM. Used by the app (browser), the seed/results scripts and the tests (node).
//
// Each shadow pair is one production request answered by the current model and the
// candidate model and scored by the workload's own grader (pass/fail).
// Codes: 0 = same verdict (both pass or both fail), 1 = only the current model passed,
// 2 = only the candidate passed. D = Y_cur - Y_cand is +1 for code 1, -1 for code 2, 0 otherwise.
// Delta = E[D] = quality drop of the candidate in pass-rate units (0.02 = 2 points).

export const CODE_SAME = 0, CODE_CUR_ONLY = 1, CODE_CAND_ONLY = 2;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Joint distribution of (Y_cur, Y_cand) from the two marginal pass rates and the
// discordance rate r = P(Y_cur != Y_cand). Returns probabilities of the 3 codes.
export function jointFromRates(pCur, pCand, discord) {
  const delta = pCur - pCand;
  const b = (discord + delta) / 2; // current only
  const c = (discord - delta) / 2; // candidate only
  if (b < 0 || c < 0) throw new Error('discordance must be at least |pCur - pCand|');
  if (b > Math.min(pCur, 1 - pCand) + 1e-12 || c > Math.min(pCand, 1 - pCur) + 1e-12) throw new Error('infeasible joint');
  return { same: 1 - discord, curOnly: b, candOnly: c, delta };
}

export function samplePairs(rng, joint, n) {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const u = rng();
    out[i] = u < joint.curOnly ? CODE_CUR_ONLY : u < joint.curOnly + joint.candOnly ? CODE_CAND_ONLY : CODE_SAME;
  }
  return out;
}

export const codeToD = (c) => (c === CODE_CUR_ONLY ? 1 : c === CODE_CAND_ONLY ? -1 : 0);
// Map D in {-1,0,1} to X in [0,1]; E[X] = (1 - Delta) / 2.
export const codeToX = (c) => (1 - codeToD(c)) / 2;
export const mOfDelta = (delta) => (1 - delta) / 2;

// One-sided betting test of H0: E[X] <= m against E[X] > m, X in [0,1].
// Wealth K_t = prod (1 + lambda_i (X_i - m)) is a nonnegative supermartingale under H0
// for predictable lambda_i in [0, 1/m), so by Ville's inequality P(sup K_t >= 1/alpha) <= alpha.
// lambda: aGRAPA (Waudby-Smith & Ramdas 2023), truncated to [0, cap/m].
export class BettingTest {
  constructor(m, cap = 0.5) {
    this.m = m; this.cap = cap;
    this.n = 0; this.sum = 0; this.sumsq = 0; // running moments of X (with a prior pseudo-observation)
    this.logK = 0; this.maxLogK = 0;
  }
  lambda() {
    // prior: one pseudo-observation at m (no bet before data)
    const n = this.n + 1;
    const mean = (this.sum + this.m) / n;
    const v = Math.max((this.sumsq + this.m * this.m) / n - mean * mean, 1e-4);
    const g = mean - this.m;
    const lam = g / (v + g * g);
    return Math.min(Math.max(lam, 0), this.cap / Math.max(this.m, 1e-9));
  }
  push(x) {
    const lam = this.lambda();
    this.logK += Math.log1p(lam * (x - this.m));
    if (this.logK > this.maxLogK) this.maxLogK = this.logK;
    this.n += 1; this.sum += x; this.sumsq += x * x;
    return this.logK;
  }
}

// Grid of Delta values (pass-rate units) used for the anytime-valid bounds.
export function deltaGrid(lo = -0.3, hi = 0.4, step = 0.0025) {
  const g = [];
  const k = Math.round((hi - lo) / step);
  for (let i = 0; i <= k; i++) g.push(Math.round((lo + i * step) * 1e6) / 1e6);
  return g;
}

// Run the paired sequential analysis over a code stream.
// For every grid value d we run two tests:
//   up[d]:   H0 Delta >= d (reject => Delta < d)          used for the upper bound / certification
//   down[d]: H0 Delta <= d (reject => Delta > d)          used for the lower bound / regression alarm
// Each side at level alphaW/2, so the bounds form a two-sided (1 - alphaW) confidence sequence.
// Snapshots are recorded at the indices in `checkpoints` (e.g. end of each day).
export function analyzeStream(codes, { alphaW, grid = deltaGrid(), checkpoints = [codes.length] }) {
  const thr = Math.log(2 / alphaW);
  const G = grid.length;
  const up = grid.map((d) => new BettingTest(mOfDelta(d)));
  const down = grid.map((d) => new BettingTest(1 - mOfDelta(d))); // on Y = 1 - X
  const upRej = new Uint8Array(G), downRej = new Uint8Array(G);
  const snaps = [];
  let ci = 0, sumD = 0, sumD2 = 0, n = 0;
  const cps = [...checkpoints].sort((a, b) => a - b);
  const snap = () => {
    // UCB: largest grid value not yet rejected by `up`; LCB: smallest not rejected by `down`.
    let ucb = null, lcb = null;
    for (let j = G - 1; j >= 0; j--) if (!upRej[j]) { ucb = grid[j]; break; }
    for (let j = 0; j < G; j++) if (!downRej[j]) { lcb = grid[j]; break; }
    const mean = n ? sumD / n : 0;
    const sd = n > 1 ? Math.sqrt(Math.max(sumD2 / n - mean * mean, 0) * n / (n - 1)) : 0;
    snaps.push({ n, deltaHat: mean, sd, ucb, lcb, upRej: Uint8Array.from(upRej), downRej: Uint8Array.from(downRej) });
  };
  while (ci < cps.length && cps[ci] === 0) { snap(); ci++; }
  for (let i = 0; i < codes.length; i++) {
    const x = codeToX(codes[i]);
    const d = codeToD(codes[i]);
    n++; sumD += d; sumD2 += d * d;
    for (let j = 0; j < G; j++) {
      if (!upRej[j]) { up[j].push(x); if (up[j].logK >= thr) upRej[j] = 1; }
      if (!downRej[j]) { down[j].push(1 - x); if (down[j].logK >= thr) downRej[j] = 1; }
    }
    while (ci < cps.length && cps[ci] === i + 1) { snap(); ci++; }
  }
  while (ci < cps.length) { snap(); ci++; }
  return { grid, thr, snaps, upTests: up, downTests: down };
}

// Decision for tolerance delta from a snapshot. The grid must contain delta.
// certified  <=> every grid value >= delta has been rejected by `up` (so Delta < delta with the CS guarantee)
// regression <=> every grid value <= delta has been rejected by `down` (Delta > delta)
export function decide(snap, grid, delta) {
  const jd = grid.findIndex((g) => Math.abs(g - delta) < 1e-9);
  if (jd < 0) throw new Error('delta not on grid');
  let cert = true, reg = true;
  for (let j = jd; j < grid.length; j++) if (!snap.upRej[j]) { cert = false; break; }
  for (let j = 0; j <= jd; j++) if (!snap.downRej[j]) { reg = false; break; }
  return cert ? 'certified' : reg ? 'regression' : 'collecting';
}

// Optimal expected log-growth of the bet against m for a 3-point pmf over X in {0, .5, 1}.
// g*(m) = max_{lambda in [0, 1/m)} E log(1 + lambda (X - m)); > 0 iff E[X] > m.
export function growthRate(pmf, m) {
  const xs = [0, 0.5, 1];
  const f = (lam) => xs.reduce((s, x, i) => s + (pmf[i] > 0 ? pmf[i] * Math.log1p(lam * (x - m)) : 0), 0);
  let lo = 0, hi = (1 / m) * 0.999;
  for (let it = 0; it < 100; it++) {
    const a = lo + (hi - lo) / 3, b = hi - (hi - lo) / 3;
    if (f(a) < f(b)) lo = a; else hi = b;
  }
  const lam = (lo + hi) / 2;
  return { g: Math.max(f(lam), 0), lambda: lam };
}

// Expected additional pairs needed to certify at tolerance delta given the empirical pmf,
// from the remaining log-evidence divided by the optimal growth rate. Infinity if the
// observed drop is not below delta.
export function pairsToDecision(counts, delta, alphaW, currentLogK = 0) {
  const tot = counts[0] + counts[1] + counts[2];
  if (!tot) return Infinity;
  // pmf over X: X=1 when candidate-only (D=-1), X=0 when current-only (D=+1), X=.5 same
  const pmf = [counts[1] / tot, counts[0] / tot, counts[2] / tot];
  const { g } = growthRate(pmf, mOfDelta(delta));
  if (g <= 1e-12) return Infinity;
  const need = Math.log(2 / alphaW) - currentLogK;
  return Math.max(0, Math.ceil(need / g));
}

// Naive practice for comparison: check a one-sided paired z-test every day and certify
// the first day the 95% upper bound on Delta is below delta (no correction for peeking or multiplicity).
export function naiveDailyZ(codes, dayEnds, delta, z = 1.645) {
  let n = 0, s = 0, s2 = 0, k = 0;
  for (let day = 0; day < dayEnds.length; day++) {
    for (; k < dayEnds[day]; k++) { const d = codeToD(codes[k]); n++; s += d; s2 += d * d; }
    if (n < 30) continue;
    const mean = s / n;
    const v = Math.max(s2 / n - mean * mean, 1e-9);
    if (mean + z * Math.sqrt(v / n) < delta) return day;
  }
  return -1;
}

// Monthly cost in USD for a token profile and a price card (USD per 1M tokens).
export function monthlyCost(t, price) {
  const cached = t.inTok * t.cachedShare;
  const fresh = t.inTok - cached;
  const cachedPrice = price.cached ?? price.input;
  return (fresh * price.input + cached * cachedPrice + t.outTok * price.output) / 1e6;
}

export function countCodes(codes, from = 0, to = codes.length) {
  const c = [0, 0, 0];
  for (let i = from; i < to; i++) c[codes[i]]++;
  return c;
}

// Compact transport encoding for the code streams: base-27 packing of 3 codes per char.
const ALPH = 'abcdefghijklmnopqrstuvwxyz{';
export function packCodes(codes) {
  let s = '';
  for (let i = 0; i < codes.length; i += 3) {
    const a = codes[i], b = i + 1 < codes.length ? codes[i + 1] : 0, c = i + 2 < codes.length ? codes[i + 2] : 0;
    s += ALPH[a * 9 + b * 3 + c];
  }
  return s;
}
export function unpackCodes(s, n) {
  const out = new Uint8Array(n);
  for (let i = 0, k = 0; i < s.length; i++) {
    const v = ALPH.indexOf(s[i]);
    if (v < 0) throw new Error('bad code char');
    const t = [Math.floor(v / 9), Math.floor(v / 3) % 3, v % 3];
    for (const x of t) if (k < n) out[k++] = x;
  }
  return out;
}

// Full account analysis used by the page: per workload, per day.
export function analyzeAccount(data, { alpha, delta }) {
  const live = data.workloads.filter((w) => w.n > 0);
  const K = Math.max(live.length, 1);
  const alphaW = alpha / K; // family-wise over workloads (Bonferroni), two-sided inside analyzeStream
  const grid = deltaGrid();
  const out = [];
  for (const w of data.workloads) {
    if (!w.n) { out.push({ id: w.id, empty: true }); continue; }
    const codes = unpackCodes(w.codes, w.n);
    const res = analyzeStream(codes, { alphaW, grid, checkpoints: w.dayEnds });
    const days = res.snaps.map((s) => ({ n: s.n, deltaHat: s.deltaHat, ucb: s.ucb, lcb: s.lcb, status: decide(s, grid, delta) }));
    const last = res.snaps[res.snaps.length - 1];
    const status = days[days.length - 1].status;
    const decidedDay = status === 'collecting' ? -1 : days.findIndex((d) => d.status === status);
    const counts = countCodes(codes);
    const jd = grid.findIndex((g) => Math.abs(g - delta) < 1e-9);
    const eta = status === 'collecting' ? pairsToDecision(counts, delta, alphaW, res.upTests[jd].logK) : 0;
    out.push({ id: w.id, codes, counts, days, status, decidedDay, deltaHat: last.deltaHat, ucb: last.ucb, lcb: last.lcb, n: last.n,
      logK: res.upTests[jd].logK, logKmax: res.upTests[jd].maxLogK, thr: res.thr, etaPairs: eta, alphaW });
  }
  return { alphaW, K, grid, workloads: out };
}
