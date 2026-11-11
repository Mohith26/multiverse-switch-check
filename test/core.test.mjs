import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  mulberry32, jointFromRates, samplePairs, packCodes, unpackCodes, BettingTest, analyzeStream, deltaGrid, decide,
  growthRate, pairsToDecision, naiveDailyZ, monthlyCost, analyzeAccount, mOfDelta, codeToX, countCodes,
} from '../src/switchcheck.js';
import { buildAccount } from '../scripts/seed.mjs';
import { accountSummary, replayStudy } from '../scripts/results.mjs';

const data = JSON.parse(readFileSync(new URL('../data/shadow.json', import.meta.url)));
const results = JSON.parse(readFileSync(new URL('../data/results.json', import.meta.url)));

test('jointFromRates reproduces both marginals and rejects impossible discordance', () => {
  const j = jointFromRates(0.7207, 0.7, 0.12);
  assert.ok(Math.abs(j.same + j.curOnly + j.candOnly - 1) < 1e-12);
  assert.ok(Math.abs(j.curOnly - j.candOnly - (0.7207 - 0.7)) < 1e-12); // P(cur) - P(cand) = b - c
  assert.throws(() => jointFromRates(0.8, 0.7, 0.05)); // discordance smaller than the gap
});

test('pack/unpack round-trips random code streams (property)', () => {
  const rng = mulberry32(7);
  for (let t = 0; t < 200; t++) {
    const n = Math.floor(rng() * 500);
    const codes = Uint8Array.from({ length: n }, () => Math.floor(rng() * 3));
    assert.deepEqual(Array.from(unpackCodes(packCodes(codes), n)), Array.from(codes));
  }
});

test('betting wealth never certifies more than alpha of null streams, even when checked after every pair (randomized)', () => {
  // Boundary null: true drop exactly equals the tolerance (hardest case).
  const alpha = 0.05, R = 300, n = 3000;
  const joint = jointFromRates(0.72, 0.70, 0.14); // drop = 2 pts
  let rejected = 0;
  for (let r = 0; r < R; r++) {
    const rng = mulberry32(100 + r);
    const t = new BettingTest(mOfDelta(0.02));
    const codes = samplePairs(rng, joint, n);
    for (const c of codes) { t.push(codeToX(c)); if (t.logK >= Math.log(1 / alpha)) { rejected++; break; } }
  }
  assert.ok(rejected / R <= alpha + 0.02, `false certification rate ${rejected / R}`);
});

test('wealth is a supermartingale under the null: mean terminal wealth <= 1 (Monte Carlo)', () => {
  const joint = jointFromRates(0.75, 0.70, 0.16); // drop 5 pts > 2 pts tolerance
  let sum = 0; const R = 400;
  for (let r = 0; r < R; r++) {
    const rng = mulberry32(900 + r); const t = new BettingTest(mOfDelta(0.02));
    for (const c of samplePairs(rng, joint, 800)) t.push(codeToX(c));
    sum += Math.exp(t.logK);
  }
  assert.ok(sum / R <= 1.05, `mean wealth ${sum / R}`);
});

test('certifies a clearly better candidate and flags a clearly worse one', () => {
  const grid = deltaGrid();
  const good = samplePairs(mulberry32(1), jointFromRates(0.80, 0.83, 0.14), 6000);
  const bad = samplePairs(mulberry32(2), jointFromRates(0.80, 0.73, 0.16), 6000);
  const a = analyzeStream(good, { alphaW: 0.004 }), b = analyzeStream(bad, { alphaW: 0.004 });
  assert.equal(decide(a.snaps.at(-1), grid, 0.02), 'certified');
  assert.equal(decide(b.snaps.at(-1), grid, 0.02), 'regression');
});

test('anytime-valid interval covers the true drop at every checkpoint (randomized)', () => {
  const alphaW = 0.1, R = 120; let miss = 0;
  for (let r = 0; r < R; r++) {
    const rng = mulberry32(5000 + r);
    const delta = (rng() - 0.5) * 0.08; // true drop in [-4, +4] pts
    const pCur = 0.6 + rng() * 0.2;
    const codes = samplePairs(rng, jointFromRates(pCur, pCur - delta, 0.12 + Math.abs(delta)), 1500);
    const cps = Array.from({ length: 15 }, (_, i) => (i + 1) * 100);
    const res = analyzeStream(codes, { alphaW, checkpoints: cps });
    // the reported bounds are on a 0.25-pt grid: compare with half a grid step of slack
    if (res.snaps.some((s) => s.ucb < delta - 0.0025 || s.lcb > delta + 0.0025)) miss++;
  }
  assert.ok(miss / R <= alphaW + 0.04, `miscoverage ${miss / R}`);
});

test('decision is consistent with the bound and nested across tolerances', () => {
  const grid = deltaGrid();
  const codes = samplePairs(mulberry32(3), jointFromRates(0.7, 0.7, 0.12), 4000);
  const s = analyzeStream(codes, { alphaW: 0.004 }).snaps.at(-1);
  let certifiedBefore = false;
  for (const d of [0.005, 0.01, 0.02, 0.03, 0.05]) {
    const st = decide(s, grid, d);
    assert.equal(st === 'certified', s.ucb < d, `tol ${d}`);
    if (certifiedBefore) assert.equal(st, 'certified'); // larger tolerance never un-certifies
    certifiedBefore ||= st === 'certified';
  }
});

test('growth rate is positive exactly when the data favour the alternative', () => {
  const m = mOfDelta(0.02);
  assert.ok(growthRate([0.05, 0.85, 0.10], m).g > 0);       // candidate better: E[X] > m
  assert.equal(growthRate([0.10, 0.85, 0.05], m).g, 0);     // drop 5 pts > 2
  assert.equal(pairsToDecision([850, 100, 50], 0.02, 0.004), Infinity); // observed drop 5 pts
  const n = pairsToDecision([850, 50, 100], 0.02, 0.004);
  assert.ok(n > 100 && n < 5000, `eta ${n}`);
});

test('daily z-test peeking inflates false certifications; Switch Check does not (same streams)', () => {
  const R = 150, days = 14, perDay = 250, alphaW = 0.05;
  const joint = jointFromRates(0.72, 0.70, 0.12); // drop exactly at the 2-pt limit
  const grid = deltaGrid();
  let naive = 0, sc = 0;
  for (let r = 0; r < R; r++) {
    const codes = samplePairs(mulberry32(7000 + r), joint, days * perDay);
    const ends = Array.from({ length: days }, (_, i) => (i + 1) * perDay);
    if (naiveDailyZ(codes, ends, 0.02) >= 0) naive++;
    const snaps = analyzeStream(codes, { alphaW, grid, checkpoints: ends }).snaps;
    if (snaps.some((s) => decide(s, grid, 0.02) === 'certified')) sc++;
  }
  assert.ok(naive / R > 0.1, `naive ${naive / R}`);
  assert.ok(sc / R <= alphaW, `switch check ${sc / R}`);
});

test('cost model matches the worked examples on docs.compactif.ai/pricing', () => {
  // glm-5-3: 1M input of which 800K cached + 100K output = $0.1184
  assert.ok(Math.abs(monthlyCost({ inTok: 1e6, outTok: 1e5, cachedShare: 0.8 }, data.prices['glm-5-3']) - 0.1184) < 1e-9);
  // carina-60b (no prompt caching): 5M input + 2M output = $0.28
  assert.ok(Math.abs(monthlyCost({ inTok: 5e6, outTok: 2e6, cachedShare: 0.5 }, data.prices['carina-60b']) - 0.28) < 1e-9);
});

test('committed data is exactly what the seeded generator produces', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(buildAccount())), data);
  const w = data.workloads.find((x) => x.id === 'retail-support-agent');
  assert.equal(countCodes(unpackCodes(w.codes, w.n)).reduce((a, b) => a + b, 0), w.n);
});

test('family-wise budget is split over shadowed workloads only', () => {
  const an = analyzeAccount(data, { alpha: 0.05, delta: 0.02 });
  assert.equal(an.K, 12); // 13 workloads, kb-rerank has no shadow traffic
  assert.ok(Math.abs(an.alphaW - 0.05 / 12) < 1e-12);
  assert.ok(an.workloads.find((w) => w.id === 'kb-rerank').empty);
});

test('headline numbers in data/results.json reproduce from the committed data', () => {
  const an = analyzeAccount(data, { alpha: 0.05, delta: 0.02 });
  const acc = accountSummary(data, an);
  assert.equal(acc.certified, results.account.certified);
  assert.equal(acc.certified, 6);
  assert.equal(acc.regressions, 2);
  assert.ok(Math.abs(acc.savedPct - results.account.savedPct) < 1e-12);
  assert.ok(Math.abs(acc.bill - results.account.bill) < 1e-9);
  // replay study headline: 0 false certifications for Switch Check vs ~20% for daily z-tests
  assert.equal(results.study.replays, 1000);
  assert.equal(results.study.familyWiseFalseCert.switchCheck, 0);
  assert.ok(results.study.familyWiseFalseCert.naiveDailyZ > 0.15);
  // a fresh slice of the replay study agrees with the committed one
  const mini = replayStudy(20, 0.02, 0.05, 1000);
  assert.equal(mini.familyWiseFalseCert.switchCheck, 0);
});
