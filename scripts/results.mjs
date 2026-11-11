// Reproduces data/results.json: the demo-account numbers plus a replay study.
// Run: node scripts/results.mjs [replays]   (default 1000, ~2-3 min)
import { readFileSync, writeFileSync } from 'node:fs';
import { analyzeAccount, unpackCodes, naiveDailyZ, monthlyCost } from '../src/switchcheck.js';
import { buildAccount } from './seed.mjs';
import { WORKLOADS } from './workloads.mjs';

export const DELTA = 0.02, ALPHA = 0.05;

export function accountSummary(data, an) {
  const rows = an.workloads.map((r) => {
    const w = data.workloads.find((x) => x.id === r.id);
    const cur = monthlyCost(w.tokens, data.prices[data.current]);
    const cand = monthlyCost(w.tokens, data.prices[data.candidate]);
    return { id: r.id, status: r.empty ? 'not-shadowed' : r.status, n: r.n ?? 0, deltaHat: r.deltaHat ?? null, lcb: r.lcb ?? null, ucb: r.ucb ?? null, decidedDay: r.decidedDay ?? -1, cost: cur, costIfSwitched: cand };
  });
  const bill = rows.reduce((s, r) => s + r.cost, 0);
  const saved = rows.filter((r) => r.status === 'certified').reduce((s, r) => s + (r.cost - r.costIfSwitched), 0);
  return { rows, bill, saved, savedPct: saved / bill, certified: rows.filter((r) => r.status === 'certified').length, shadowed: rows.filter((r) => r.status !== 'not-shadowed').length, regressions: rows.filter((r) => r.status === 'regression').length };
}

export function replayStudy(R, delta = DELTA, alpha = ALPHA, seed0 = 1000) {
  const truth = Object.fromEntries(WORKLOADS.filter((w) => !w.noShadow).map((w) => [w.id, w.pCur - w.pCand]));
  const unsafe = Object.keys(truth).filter((id) => truth[id] >= delta);
  const safe = Object.keys(truth).filter((id) => truth[id] < delta);
  let fwSC = 0, fwNaive = 0, fwFixed = 0;
  const perSC = Object.fromEntries(unsafe.map((k) => [k, 0])), perNaive = Object.fromEntries(unsafe.map((k) => [k, 0]));
  const daysSC = [], daysNaive = [];
  let safeCertSC = 0, safeCertNaive = 0, safeCertFixed = 0, regCaught = 0, falseReg = 0;
  for (let r = 0; r < R; r++) {
    const data = buildAccount(seed0 + r);
    const an = analyzeAccount(data, { alpha, delta });
    const K = an.K;
    let anySC = false, anyNaive = false, anyFixed = false;
    for (const res of an.workloads) {
      if (res.empty) continue;
      const w = data.workloads.find((x) => x.id === res.id);
      const codes = unpackCodes(w.codes, w.n);
      const nd = naiveDailyZ(codes, w.dayEnds, delta);
      // fixed horizon, Bonferroni-corrected one-sided z at day 14 only (valid but slow)
      const zB = 2.87; // one-sided z for 0.05/12 = 0.00417
      const fixedCert = naiveDailyZ(codes, [w.dayEnds[w.dayEnds.length - 1]], delta, zB) === 0;
      const isUnsafe = truth[res.id] >= delta;
      if (isUnsafe) {
        if (res.status === 'certified') { anySC = true; perSC[res.id]++; }
        if (nd >= 0) { anyNaive = true; perNaive[res.id]++; }
        if (fixedCert) anyFixed = true;
        if (res.status === 'regression') regCaught++;
      } else {
        if (res.status === 'certified') { safeCertSC++; daysSC.push(res.decidedDay + 1); }
        if (nd >= 0) { safeCertNaive++; daysNaive.push(nd + 1); }
        if (fixedCert) safeCertFixed++;
        if (res.status === 'regression') falseReg++;
      }
    }
    if (anySC) fwSC++; if (anyNaive) fwNaive++; if (anyFixed) fwFixed++;
    void K;
  }
  const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
  return {
    replays: R, delta, alpha, unsafe, safe,
    familyWiseFalseCert: { switchCheck: fwSC / R, naiveDailyZ: fwNaive / R, fixedDay14Bonferroni: fwFixed / R },
    perWorkloadFalseCert: { switchCheck: Object.fromEntries(unsafe.map((k) => [k, perSC[k] / R])), naiveDailyZ: Object.fromEntries(unsafe.map((k) => [k, perNaive[k] / R])) },
    safeCertifiedShare: { switchCheck: safeCertSC / (R * safe.length), naiveDailyZ: safeCertNaive / (R * safe.length), fixedDay14Bonferroni: safeCertFixed / (R * safe.length) },
    medianDayToCertify: { switchCheck: med(daysSC), naiveDailyZ: med(daysNaive), fixedDay14Bonferroni: 14 },
    regressionAlarms: { trueOnUnsafe: regCaught / (R * unsafe.length), falseOnSafe: falseReg / (R * safe.length) },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const R = Number(process.argv[2] || 1000);
  const data = JSON.parse(readFileSync(new URL('../data/shadow.json', import.meta.url)));
  const an = analyzeAccount(data, { alpha: ALPHA, delta: DELTA });
  const account = accountSummary(data, an);
  const t0 = Date.now();
  const study = replayStudy(R);
  const out = { generated: 'node scripts/results.mjs ' + R, settings: { delta: DELTA, alpha: ALPHA, current: data.current, candidate: data.candidate }, account, study, seconds: (Date.now() - t0) / 1000 };
  writeFileSync(new URL('../data/results.json', import.meta.url), JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ account: { bill: account.bill, saved: account.saved, savedPct: account.savedPct, certified: account.certified, shadowed: account.shadowed, regressions: account.regressions }, study }, null, 2));
}
