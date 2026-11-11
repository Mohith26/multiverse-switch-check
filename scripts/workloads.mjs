// Workload definitions for the demo account. Shared by seed.mjs, results.mjs and the tests.
//
// True pass rates come from Multiverse's own published paired benchmark table
// (Comet 60B vs Nemotron 3.5 Super, BF16, Hugging Face model card, Oct 2026): each workload
// borrows the original-model score and the compressed-model score of the benchmark that
// best matches its task. They are used only to SIMULATE the shadow traffic; the app never
// sees them. Prices are the CompactifAI API list prices (docs.compactif.ai/pricing, 2026-10-22).

export const PRICES = {
  'glm-5-3': { input: 0.20, cached: 0.018, output: 0.64 },
  'quasar-1-2-358b': { input: 0.11, cached: 0.0099, output: 0.33 },
  'carina-60b': { input: 0.022, cached: null, output: 0.085 },
};

export const CURRENT = 'glm-5-3';
export const CANDIDATE = 'quasar-1-2-358b';
export const DAYS = 14;
export const SHADOW_RATE = 0.10;
export const START = '2026-10-27'; // first shadow day (Tue); 14 days -> 2026-11-09

// reqPerDay: weekday production requests; tokens are per request; cached = share of input served from prompt cache.
export const WORKLOADS = [
  { id: 'retail-support-agent', key: 'cai-…a51c', grader: 'Task success (tool-call trace)', bench: 'τ²-Bench retail', pCur: 0.8279, pCand: 0.8509, discord: 0.14, reqPerDay: 30000, inTok: 6200, outTok: 420, cached: 0.72 },
  { id: 'telecom-support-agent', key: 'cai-…a51c', grader: 'Task success (tool-call trace)', bench: 'τ²-Bench telecom', pCur: 0.7675, pCand: 0.7928, discord: 0.16, reqPerDay: 9000, inTok: 5800, outTok: 390, cached: 0.70 },
  { id: 'workflow-automation', key: 'cai-…0f2e', grader: 'End-state check', bench: 'AutomationBench-AA', pCur: 0.3116, pCand: 0.3318, discord: 0.12, reqPerDay: 7000, inTok: 9400, outTok: 650, cached: 0.64 },
  { id: 'airline-rebooking', key: 'cai-…a51c', grader: 'Task success (tool-call trace)', bench: 'τ²-Bench airline', pCur: 0.7725, pCand: 0.7800, discord: 0.15, reqPerDay: 4200, inTok: 6100, outTok: 410, cached: 0.71 },
  { id: 'sci-code-assistant', key: 'cai-…7d90', grader: 'Unit tests', bench: 'SciCode (subtask)', pCur: 0.4536, pCand: 0.4601, discord: 0.14, reqPerDay: 3200, inTok: 3800, outTok: 1900, cached: 0.35 },
  { id: 'bank-dispute-agent', key: 'cai-…0f2e', grader: 'Policy-compliant resolution', bench: 'τ³-Banking', pCur: 0.2113, pCand: 0.2075, discord: 0.10, reqPerDay: 6000, inTok: 7000, outTok: 380, cached: 0.68 },
  { id: 'contract-qa', key: 'cai-…3b44', grader: 'Exact answer match', bench: 'AA-LCR', pCur: 0.6831, pCand: 0.6738, discord: 0.10, reqPerDay: 3000, inTok: 38000, outTok: 520, cached: 0.30 },
  { id: 'i18n-code-migration', key: 'cai-…7d90', grader: 'Unit tests', bench: 'SWE-bench Multilingual', pCur: 0.6700, pCand: 0.6656, discord: 0.12, reqPerDay: 2000, inTok: 21000, outTok: 950, cached: 0.60 },
  { id: 'pr-review-bot', key: 'cai-…7d90', grader: 'Unit tests on suggested patch', bench: 'SWE-bench Verified', pCur: 0.7207, pCand: 0.7000, discord: 0.12, reqPerDay: 2600, inTok: 24000, outTok: 880, cached: 0.62 },
  { id: 'research-qa', key: 'cai-…3b44', grader: 'LLM judge (reference answer)', bench: 'HLE (no tools)', pCur: 0.2859, pCand: 0.2535, discord: 0.12, reqPerDay: 5000, inTok: 2100, outTok: 2400, cached: 0.10 },
  { id: 'terminal-ops-agent', key: 'cai-…0f2e', grader: 'Container end-state check', bench: 'Terminal-Bench 2.1', pCur: 0.6067, pCand: 0.5576, discord: 0.18, reqPerDay: 1200, inTok: 31000, outTok: 610, cached: 0.84 },
  { id: 'report-drafting', key: 'cai-…3b44', grader: 'Rubric judge (≥ 70/100)', bench: 'GDPval-AA v2.1', pCur: 0.7451, pCand: 0.6905, discord: 0.16, reqPerDay: 3000, inTok: 8200, outTok: 3100, cached: 0.22 },
  { id: 'kb-rerank', key: 'cai-…3b44', grader: 'nDCG@10 ≥ baseline', bench: null, pCur: null, pCand: null, discord: null, reqPerDay: 11000, inTok: 2600, outTok: 60, cached: 0.0, noShadow: true },
];

export function dayVolume(rng, w, day) {
  // day 0 = Tue 27 Oct; weekends (Sat=4, Sun=5, Sat=11, Sun=12) run at 55%
  const dow = (day + 2) % 7; // 0 = Sun
  const wk = dow === 0 || dow === 6 ? 0.55 : 1;
  const noise = 0.9 + 0.2 * rng();
  return Math.round(w.reqPerDay * wk * noise);
}
