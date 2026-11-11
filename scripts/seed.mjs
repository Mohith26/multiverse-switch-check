// Generates data/shadow.json: 14 days of paired shadow traffic (glm-5-3 vs quasar-1-2-358b)
// for the demo account. Deterministic (seeded). Run: node scripts/seed.mjs
import { writeFileSync } from 'node:fs';
import { mulberry32, jointFromRates, samplePairs, packCodes } from '../src/switchcheck.js';
import { WORKLOADS, PRICES, CURRENT, CANDIDATE, DAYS, SHADOW_RATE, START, dayVolume } from './workloads.mjs';

export function buildAccount(seed = 20261109) {
  const rng = mulberry32(seed);
  const workloads = [];
  for (const w of WORKLOADS) {
    const vols = [];
    for (let d = 0; d < DAYS; d++) vols.push(dayVolume(rng, w, d));
    const monthlyReq = (vols.reduce((a, b) => a + b, 0) / DAYS) * 30;
    const tokens = { inTok: monthlyReq * w.inTok, outTok: monthlyReq * w.outTok, cachedShare: w.cached };
    const base = { id: w.id, key: w.key, grader: w.grader, bench: w.bench, volumes: vols, tokens };
    if (w.noShadow) { workloads.push({ ...base, n: 0, codes: '', dayEnds: [] }); continue; }
    const joint = jointFromRates(w.pCur, w.pCand, w.discord);
    const parts = []; const dayEnds = []; let n = 0;
    for (let d = 0; d < DAYS; d++) {
      const k = Math.round(vols[d] * SHADOW_RATE);
      parts.push(samplePairs(rng, joint, k));
      n += k; dayEnds.push(n);
    }
    const codes = new Uint8Array(n); let o = 0;
    for (const p of parts) { codes.set(p, o); o += p.length; }
    workloads.push({ ...base, n, codes: packCodes(codes), dayEnds });
  }
  return { org: 'Northwind Freight', current: CURRENT, candidate: CANDIDATE, start: START, days: DAYS, shadowRate: SHADOW_RATE, prices: PRICES, seed, workloads };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const acct = buildAccount();
  writeFileSync(new URL('../data/shadow.json', import.meta.url), JSON.stringify(acct));
  const tot = acct.workloads.reduce((s, w) => s + w.n, 0);
  console.log(`wrote data/shadow.json: ${acct.workloads.length} workloads, ${tot} shadow pairs`);
}
