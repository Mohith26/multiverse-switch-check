// Switch Check app shell (CompactifAI Dashboard look). All numbers are computed from
// data/shadow.json by src/switchcheck.js at load time.
import { analyzeAccount, monthlyCost, countCodes, BettingTest, codeToX, mOfDelta } from './src/switchcheck.js';

const $ = (s, el = document) => el.querySelector(s);
const view = $('#view');
const LS = 'cai-switch-check-v1';
const DELTAS = [1, 2, 3, 5];
const ALPHAS = [1, 5, 10];
const CANDS = ['quasar-1-2-358b', 'carina-60b'];

let DATA = null, AN = null, ANKEY = '', LOADERR = null;
const store = loadStore();
let ui = { sel: 0 };

function loadStore() {
  try { return Object.assign({ switched: {}, shadowReq: {}, delta: 2, alpha: 5, cand: 'quasar-1-2-358b' }, JSON.parse(localStorage.getItem(LS) || '{}')); }
  catch { return { switched: {}, shadowReq: {}, delta: 2, alpha: 5, cand: 'quasar-1-2-358b' }; }
}
function save() { localStorage.setItem(LS, JSON.stringify(store)); }

// ---------- formatting
const nf = new Intl.NumberFormat('en-US');
const fmtN = (x) => nf.format(Math.round(x));
const fmtUSD = (x) => '$' + nf.format(Math.round(x));
const fmtUSD2 = (x) => '$' + x.toFixed(2);
const pts = (x, d = 1) => (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x * 100).toFixed(d);
const drop = (x) => (x < 0 ? '−' : '') + String(+Math.abs(x * 100).toFixed(2)); // positive = quality drop; bounds sit on a 0.25-pt grid
const dayLabel = (i) => { const d = new Date(Date.UTC(2026, 9, 27 + i)); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }); };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- routing (hash deep links)
function parseHash() {
  const h = location.hash.replace(/^#/, '') || '/switch-check';
  const [path, q = ''] = h.split('?');
  const params = Object.fromEntries(new URLSearchParams(q));
  const parts = path.split('/').filter(Boolean);
  return { page: parts[0] || 'switch-check', id: parts[1] ? decodeURIComponent(parts[1]) : null, params };
}
function settingsFromParams(p) {
  if (p.delta && DELTAS.includes(+p.delta)) store.delta = +p.delta;
  if (p.alpha && ALPHAS.includes(+p.alpha)) store.alpha = +p.alpha;
  if (p.cand && CANDS.includes(p.cand)) store.cand = p.cand;
  save();
}
function qs() { return `?delta=${store.delta}&alpha=${store.alpha}&cand=${store.cand}`; }
function go(path) { location.hash = '#' + path + qs(); }

// ---------- data
async function load() {
  LOADERR = null;
  try {
    const r = await fetch('data/shadow.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    DATA = await r.json();
  } catch (e) { LOADERR = e; DATA = null; }
}
function analysis() {
  const key = `${store.delta}|${store.alpha}`;
  if (AN && ANKEY === key) return AN;
  const t0 = performance.now();
  AN = analyzeAccount(DATA, { alpha: store.alpha / 100, delta: store.delta / 100 });
  AN.ms = performance.now() - t0; ANKEY = key;
  AN.rows = DATA.workloads.map((w, i) => {
    const r = AN.workloads[i];
    const cur = monthlyCost(w.tokens, DATA.prices[DATA.current]);
    const cand = monthlyCost(w.tokens, DATA.prices[DATA.candidate]);
    return { w, r, cur, cand, save: cur - cand };
  });
  return AN;
}
function effStatus(row) {
  if (row.r.empty) return store.shadowReq[row.w.id] ? 'pending' : 'none';
  if (store.switched[row.w.id]) return 'switched';
  return row.r.status;
}
const STATUS_LABEL = { certified: 'Certified', switched: 'Switched', collecting: 'Collecting', regression: 'Quality drop', none: 'Not shadowed', pending: 'Shadow starting' };
const statusChip = (s) => `<span class="status ${s === 'pending' ? 'none' : s}">${STATUS_LABEL[s]}</span>`;

// ---------- shell
const caret = '<svg class="caret" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 10l5 5 5-5z"/></svg>';
const dlIcon = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true" style="width:18px;height:18px"><path fill="currentColor" d="M5 20h14v-2H5zM19 9h-4V3H9v6H5l7 7z"/></svg>';
function setActiveNav(page) {
  document.querySelectorAll('.nav-item').forEach((a) => a.classList.toggle('active', a.dataset.route === page));
}
function header(title, sub) { return `<header class="page-header"><h1>${title}</h1><p>${sub}</p></header>`; }

function filtersHTML() {
  const sel = (id, label, opts, val, fmt) => `<div class="field"><label for="${id}">${label}</label><select id="${id}">${opts.map((o) => `<option value="${o}" ${String(o) === String(val) ? 'selected' : ''}>${fmt(o)}</option>`).join('')}</select>${caret}</div>`;
  return `<section class="glass subtle" aria-label="Filters"><div class="filters">
    <div class="field"><label>Current model</label><div class="static" title="Model these workloads call today">${DATA.current}</div></div>
    ${sel('f-cand', 'Candidate model', CANDS, store.cand, (o) => o)}
    ${sel('f-delta', 'Max quality drop', DELTAS, store.delta, (o) => `${o} point${o > 1 ? 's' : ''}`)}
    ${sel('f-alpha', 'Error rate (family-wise)', ALPHAS, store.alpha, (o) => `${o}%`)}
    <div class="field"><label>Shadow window · ${Math.round(DATA.shadowRate * 100)}%</label><div class="static">${dayLabel(0)} – ${dayLabel(DATA.days - 1)}</div></div>
    <button class="btn" id="f-reset" type="button">Reset to defaults</button>
  </div></section>`;
}
function bindFilters() {
  $('#f-cand').onchange = (e) => { store.cand = e.target.value; save(); go(currentPath()); };
  $('#f-delta').onchange = (e) => { store.delta = +e.target.value; save(); go(currentPath()); };
  $('#f-alpha').onchange = (e) => { store.alpha = +e.target.value; save(); go(currentPath()); };
  $('#f-reset').onclick = () => { store.delta = 2; store.alpha = 5; store.cand = 'quasar-1-2-358b'; save(); go(currentPath()); toast('Filters reset'); };
}
function currentPath() { const { page, id } = parseHash(); return '/' + page + (id ? '/' + encodeURIComponent(id) : ''); }

// ---------- interval glyph: anytime-valid interval vs tolerance, scale -6..+10 points
function ivlSVG(lcb, ucb, est, delta) {
  const lo = -0.06, hi = 0.10, W = 96, x = (v) => Math.max(0, Math.min(W, ((v - lo) / (hi - lo)) * W));
  const col = ucb < delta ? '#00cc66' : lcb > delta ? '#f01438' : '#ffa726';
  return `<svg class="ivl" viewBox="0 0 ${W} 14" aria-hidden="true"><line x1="${x(0)}" x2="${x(0)}" y1="1" y2="13" stroke="rgb(255 255 255 / .25)"/><line x1="${x(delta)}" x2="${x(delta)}" y1="0" y2="14" stroke="#ffa726" stroke-dasharray="2 2"/><rect x="${x(lcb)}" y="4" width="${Math.max(2, x(ucb) - x(lcb))}" height="6" rx="3" fill="${col}" opacity=".55"/><circle cx="${x(est)}" cy="7" r="2.6" fill="#fff"/></svg>`;
}

// ---------- main view
function renderList() {
  const an = analysis();
  const delta = store.delta / 100;
  setActiveNav('switch-check');
  let html = header('Switch Check', `Certify which workloads can move from ${DATA.current} to a compressed model without losing quality.`) + filtersHTML();
  if (store.cand !== DATA.candidate) {
    const pending = store.shadowReq['__cand_' + store.cand];
    html += `<div class="empty" role="status"><h3>No shadow traffic for ${esc(store.cand)} yet</h3><p>Switch Check needs paired requests: a share of each workload is sent to both models and scored by that workload's grader. ${pending ? 'Shadowing was requested; results appear here after the first day of traffic.' : `Start shadowing ${Math.round(DATA.shadowRate * 100)}% of traffic to ${esc(store.cand)} to compare it against ${DATA.current}.`}</p><button class="btn primary" id="startCand" type="button" ${pending ? 'disabled' : ''}>${pending ? 'Shadowing requested' : `Start shadowing ${esc(store.cand)}`}</button></div>`;
    view.innerHTML = html; bindFilters();
    const b = $('#startCand'); if (b && !pending) b.onclick = () => { store.shadowReq['__cand_' + store.cand] = Date.now(); save(); toast(`Shadowing ${store.cand} on ${Math.round(DATA.shadowRate * 100)}% of traffic`); renderList(); };
    return;
  }
  const rows = an.rows;
  const st = rows.map(effStatus);
  const nCert = st.filter((s) => s === 'certified').length, nSw = st.filter((s) => s === 'switched').length, nReg = st.filter((s) => s === 'regression').length;
  const bill = rows.reduce((s, r) => s + r.cur, 0);
  const avail = rows.reduce((s, r, i) => s + (st[i] === 'certified' ? r.save : 0), 0);
  const realized = rows.reduce((s, r, i) => s + (st[i] === 'switched' ? r.save : 0), 0);
  const pairs = rows.reduce((s, r) => s + (r.r.n || 0), 0);
  html += `<div class="alert info" role="note"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M11 7h2v2h-2zm0 4h2v6h-2zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2m0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8"/></svg><div><b>${nCert + nSw} of ${an.K} shadowed workloads</b> are certified to lose at most ${store.delta} point${store.delta > 1 ? 's' : ''} of pass rate on ${DATA.candidate}, with at most a ${store.alpha}% chance that any certificate on this page is wrong, however often you check. Switching them saves <b>${fmtUSD(avail + realized)}/month</b> (${((avail + realized) / bill * 100).toFixed(0)}% of this account's ${fmtUSD(bill)}). ${nReg ? `<b>${nReg}</b> workload${nReg > 1 ? 's show' : ' shows'} a confirmed quality drop.` : ''}</div></div>`;
  html += `<div class="section-head"><h2>Workloads</h2><div class="actions"><button class="btn" id="exCSV" type="button">${dlIcon}<span>Export CSV</span></button><button class="btn" id="exJSON" type="button">${dlIcon}<span>Certificates JSON</span></button></div></div>`;
  html += `<section class="glass" style="padding:0;overflow:hidden"><div class="table-wrap"><table class="t" aria-label="Workloads">
    <colgroup><col class="c1"><col class="c2"><col class="c3"><col class="c4"><col class="c5"><col class="c6"><col class="c7"><col class="c8"></colgroup>
    <thead><tr><th>Workload</th><th>Pairs</th><th title="Candidate pass rate minus current pass rate, in points">Change</th><th class="l" title="Anytime-valid ${100 - store.alpha}% interval for the quality drop (points); dashed line = your max drop">Drop interval (pts)</th><th class="l">Status</th><th>Cost / mo</th><th>If switched</th><th>Savings</th></tr></thead><tbody>`;
  rows.forEach((row, i) => {
    const s = st[i]; const r = row.r;
    const chg = r.empty ? '—' : `<span class="${-r.deltaHat > 0 ? 'pos' : -r.deltaHat < 0 ? 'neg' : ''}">${pts(-r.deltaHat)}</span>`;
    const ivl = r.empty ? '<span class="muted">No shadow traffic</span>' : `${ivlSVG(r.lcb, r.ucb, r.deltaHat, delta)}${drop(r.lcb)} to ${drop(r.ucb)}`;
    const sv = s === 'certified' || s === 'switched' ? `<span class="pos">${fmtUSD(row.save)}</span>` : '<span class="muted">—</span>';
    html += `<tr class="row ${i === ui.sel ? 'sel' : ''}" tabindex="0" data-i="${i}" data-id="${esc(row.w.id)}"><td><span class="wl">${esc(row.w.id)}</span><span class="sub">${esc(row.w.grader)}</span></td><td>${r.empty ? '0' : fmtN(r.n)}</td><td>${chg}</td><td class="l">${ivl}</td><td class="l">${statusChip(s)}</td><td>${fmtUSD(row.cur)}</td><td>${fmtUSD(s === 'switched' ? row.cand : row.cand)}</td><td>${sv}</td></tr>`;
  });
  html += `<tr class="total"><td>Total</td><td>${fmtN(pairs)}</td><td>—</td><td class="l">—</td><td class="l">${nCert} certified · ${nSw} switched</td><td>${fmtUSD(bill)}</td><td>${fmtUSD(bill - avail - realized)}</td><td>${fmtUSD(avail + realized)}</td></tr>`;
  html += `</tbody></table></div></section>`;
  html += chartCardHTML(rows, st);
  html += `<p class="note">Analysis of ${fmtN(pairs)} shadow pairs ran in your browser in ${Math.round(an.ms)} ms. Per workload error budget ${(an.alphaW * 100).toFixed(2)}% (${store.alpha}% split across ${an.K} workloads). Keys: <kbd>j</kbd>/<kbd>k</kbd> move, <kbd>Enter</kbd> open, <kbd>s</kbd> switch, <kbd>e</kbd> export, <kbd>?</kbd> help.</p>`;
  view.innerHTML = html;
  bindFilters();
  view.querySelectorAll('tr.row').forEach((tr) => {
    tr.onclick = () => go('/switch-check/' + encodeURIComponent(tr.dataset.id));
    tr.onkeydown = (e) => { if (e.key === 'Enter') go('/switch-check/' + encodeURIComponent(tr.dataset.id)); };
  });
  $('#exCSV').onclick = exportCSV; $('#exJSON').onclick = exportJSON;
  bindChart(rows, st);
}

function chartCardHTML(rows, st) {
  return `<section class="glass chart-card" aria-label="Monthly cost by workload"><div class="chart-head"><div><p class="chart-title">Monthly cost by workload</p><div class="legend"><span><i style="background:var(--chart-1)"></i>${DATA.current} today</span><span><i style="background:var(--chart-2)"></i>After switching certified workloads</span></div></div><div class="muted" style="font-size:14px;margin-top:2px">Projected from the last 14 days of tokens · USD</div></div><div id="costChart"></div></section>`;
}
function bindChart(rows, st) {
  const el = $('#costChart'); if (!el) return;
  const W = Math.max(600, el.clientWidth || 900), H = 300, L = 64, B = 64, T = 12, R = 8;
  const data = rows.map((r, i) => ({ id: r.w.id, a: r.cur, b: st[i] === 'certified' || st[i] === 'switched' ? r.cand : r.cur, s: st[i] }));
  const max = Math.max(...data.map((d) => d.a));
  const step = niceStep(max / 5); const top = Math.ceil(max / step) * step;
  const y = (v) => T + (H - T - B) * (1 - v / top);
  const bw = (W - L - R) / data.length;
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Grouped bar chart of monthly cost per workload">`;
  for (let v = 0; v <= top + 1e-9; v += step) s += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><line class="axis" x1="${L - 5}" x2="${L}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${fmtN(v)}</text>`;
  s += `<line class="axis" x1="${L}" x2="${L}" y1="${T}" y2="${H - B}"/><line class="axis" x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}"/>`;
  data.forEach((d, i) => {
    const x0 = L + i * bw, gw = bw * 0.7, w1 = gw / 2, xa = x0 + (bw - gw) / 2;
    s += `<rect data-i="${i}" x="${xa}" y="${y(d.a)}" width="${w1 - 1}" height="${H - B - y(d.a)}" fill="var(--chart-1)"/><rect data-i="${i}" x="${xa + w1}" y="${y(d.b)}" width="${w1 - 1}" height="${H - B - y(d.b)}" fill="var(--chart-2)"/>`;
    s += `<line class="axis" x1="${x0 + bw}" x2="${x0 + bw}" y1="${H - B}" y2="${H - B + 5}"/><text x="${x0 + bw / 2}" y="${H - B + 16}" text-anchor="end" transform="rotate(-28 ${x0 + bw / 2} ${H - B + 16})">${esc(d.id.replace(/-agent$|-assistant$/, ''))}</text>`;
  });
  s += `<rect id="hov" x="0" y="0" width="0" height="0" fill="rgb(255 255 255 / .05)"/></svg>`;
  el.innerHTML = s;
  const svg = el.firstChild; const tip = ensureTip();
  svg.onmousemove = (e) => {
    const pt = svg.getBoundingClientRect(); const px = (e.clientX - pt.left) * (W / pt.width);
    const i = Math.floor((px - L) / bw);
    if (i < 0 || i >= data.length) { tip.hidden = true; return; }
    const d = data[i];
    const hov = $('#hov', svg); hov.setAttribute('x', L + i * bw); hov.setAttribute('y', T); hov.setAttribute('width', bw); hov.setAttribute('height', H - B - T);
    tip.innerHTML = `<b>${esc(d.id)}</b><div class="r"><span>${DATA.current}</span><span>${fmtUSD(d.a)}</span></div><div class="r"><span>After plan</span><span>${fmtUSD(d.b)}</span></div><div class="r muted"><span>Status</span><span>${STATUS_LABEL[d.s]}</span></div>`;
    tip.hidden = false; tip.style.left = e.clientX + 14 + 'px'; tip.style.top = e.clientY + 10 + 'px';
  };
  svg.onmouseleave = () => { tip.hidden = true; const hov = $('#hov', svg); hov.setAttribute('width', 0); };
  svg.onclick = (e) => { const pt = svg.getBoundingClientRect(); const i = Math.floor(((e.clientX - pt.left) * (W / pt.width) - L) / bw); if (data[i]) go('/switch-check/' + encodeURIComponent(data[i].id)); };
}
function niceStep(raw) { const p = Math.pow(10, Math.floor(Math.log10(raw))); const f = raw / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p; }
function ensureTip() { let t = $('#tip'); if (!t) { t = document.createElement('div'); t.id = 'tip'; t.className = 'tip'; t.hidden = true; document.body.appendChild(t); } return t; }

// ---------- detail view
function renderDetail(id) {
  const an = analysis();
  const idx = an.rows.findIndex((r) => r.w.id === id);
  setActiveNav('switch-check');
  if (idx < 0) { view.innerHTML = header('Switch Check', 'Workload not found.') + `<div class="empty"><h3>No workload called “${esc(id)}”</h3><p>It may have been renamed or removed from this account.</p><a class="btn" href="#/switch-check${qs()}">Back to all workloads</a></div>`; return; }
  ui.sel = idx;
  const row = an.rows[idx], r = row.r, w = row.w, s = effStatus(row), delta = store.delta / 100;
  const crumbs = `<nav class="crumbs" aria-label="Breadcrumb"><a href="#/switch-check${qs()}">Switch Check</a> / ${esc(w.id)}</nav>`;
  let html = crumbs + header(esc(w.id), `${esc(w.grader)} · API key ${esc(w.key)} · ${DATA.current} → ${DATA.candidate}`);
  if (r.empty) {
    const pend = store.shadowReq[w.id];
    html += `<div class="empty"><h3>This workload has no shadow traffic</h3><p>${fmtN(w.volumes.reduce((a, b) => a + b, 0))} requests in the last 14 days, none mirrored to ${DATA.candidate}. Start shadowing to get a certificate; at ${Math.round(DATA.shadowRate * 100)}% that is about ${fmtN(w.volumes.reduce((a, b) => a + b, 0) / 14 * DATA.shadowRate)} pairs a day.</p><button class="btn primary" id="startShadow" type="button" ${pend ? 'disabled' : ''}>${pend ? 'Shadowing requested' : 'Start shadowing'}</button></div>`;
    view.innerHTML = html;
    const b = $('#startShadow'); if (b && !pend) b.onclick = () => { store.shadowReq[w.id] = Date.now(); save(); toast(`Shadowing ${w.id} at ${Math.round(DATA.shadowRate * 100)}%`); renderDetail(id); };
    return;
  }
  const last = r.days[r.days.length - 1];
  const etaDays = isFinite(r.etaPairs) ? Math.ceil(r.etaPairs / (r.n / DATA.days)) : Infinity;
  const evid = Math.exp(Math.min(r.wealthDays[r.wealthDays.length - 1], 50));
  let decisionTxt, acts;
  if (s === 'switched') { decisionTxt = `Live on ${DATA.candidate} since ${new Date(store.switched[w.id]).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}. A ${Math.round(DATA.shadowRate * 100)}% holdback keeps running on ${DATA.current}, and the same test keeps watching it, so a later drop above ${store.delta} points still raises an alarm.`; acts = `<button class="btn danger" id="rollback" type="button">Roll back to ${DATA.current}</button>`; }
  else if (s === 'certified') { decisionTxt = `With ${fmtN(r.n)} paired requests, the quality drop is below ${store.delta} point${store.delta > 1 ? 's' : ''} (anytime-valid bound ${drop(r.ucb)} pts), certified on ${dayLabel(r.decidedDay)}. Switching saves ${fmtUSD(row.save)} a month.`; acts = `<button class="btn primary" id="doSwitch" type="button">Switch to ${DATA.candidate}</button>`; }
  else if (s === 'regression') { decisionTxt = `${DATA.candidate} is worse on this workload by more than ${store.delta} points (bound ${drop(r.lcb)} to ${drop(r.ucb)} pts), confirmed on ${dayLabel(r.decidedDay)}. Keep ${DATA.current}; the shadow pairs below show where it fails.`; acts = `<button class="btn" id="stopShadow" type="button">Stop shadowing</button>`; }
  else { decisionTxt = isFinite(etaDays) ? `Not enough evidence yet. At the current rate (${fmtN(r.n / DATA.days)} pairs a day) and the current observed change, about ${fmtN(r.etaPairs)} more pairs (${etaDays} day${etaDays > 1 ? 's' : ''}) should settle it. You can check as often as you like; the guarantee holds.` : `The observed drop (${drop(r.deltaHat)} pts) is not below your ${store.delta}-point limit, so more data is unlikely to certify a switch. A confirmed drop needs the lower bound (${drop(r.lcb)} pts) to clear ${store.delta}.`; acts = `<button class="btn" id="raise" type="button">Raise shadow rate to 20%</button>`; }
  html += `<section class="glass decision"><div><h3>${statusChip(s)}<span>${s === 'switched' ? 'Switched' : s === 'certified' ? 'Safe to switch' : s === 'regression' ? 'Do not switch' : 'Collecting evidence'}</span></h3><p>${decisionTxt}</p></div><div class="acts">${acts}<button class="btn" id="exCert" type="button">${dlIcon}<span>Certificate</span></button></div></section>`;
  const c = r.counts;
  html += `<div class="kpis">
    <div class="kpi"><div class="k">Shadow pairs</div><div class="v">${fmtN(r.n)}</div><div class="s">${fmtN(r.n / DATA.days)} / day over ${DATA.days} days</div></div>
    <div class="kpi"><div class="k">Pass rate change</div><div class="v ${-r.deltaHat >= 0 ? 'pos' : 'neg'}">${pts(-r.deltaHat, 2)} pts</div><div class="s">${fmtN(c[2])} better · ${fmtN(c[1])} worse</div></div>
    <div class="kpi"><div class="k">Drop interval</div><div class="v">${drop(r.lcb)} to ${drop(r.ucb)}</div><div class="s">pts, anytime-valid</div></div>
    <div class="kpi"><div class="k">Evidence (drop ${r.evDir === 'drop' ? '&gt;' : '&lt;'} ${store.delta})</div><div class="v">${evid >= 1e6 ? '>10⁶' : evid >= 100 ? fmtN(evid) : evid.toFixed(2)}×</div><div class="s">decides at ${fmtN(Math.exp(r.thr))}×</div></div>
    <div class="kpi"><div class="k">To decision</div><div class="v">${s === 'collecting' ? (isFinite(etaDays) ? `~${etaDays} d` : '—') : 'Decided'}</div><div class="s">${s === 'collecting' ? (isFinite(etaDays) ? `~${fmtN(r.etaPairs)} more pairs` : 'observed drop above limit') : dayLabel(r.decidedDay)}</div></div>
    <div class="kpi"><div class="k">Monthly cost</div><div class="v">${fmtUSD(row.cur)}</div><div class="s">${fmtUSD(row.cand)} if switched (−${(row.save / row.cur * 100).toFixed(0)}%)</div></div>
  </div>`;
  html += `<div class="two"><section class="glass chart-card"><p class="chart-title">Quality drop over time</p><div class="legend"><span><i class="line" style="background:var(--chart-1)"></i>Observed drop</span><span><i style="background:rgb(2 178 175 / .3)"></i>Anytime-valid interval</span><span><i class="dash"></i>Your limit (${store.delta} pts)</span></div><div id="ch1"></div></section>
    <section class="glass chart-card"><p class="chart-title">Evidence that drop ${r.evDir === 'drop' ? '&gt;' : '&lt;'} ${store.delta} pts</p><div class="legend"><span><i class="line" style="background:var(--chart-2)"></i>Betting wealth (log scale)</span><span><i class="dash"></i>Decision threshold</span></div><div id="ch2"></div></section></div>`;
  html += `<div class="section-head"><h2>Daily shadow results</h2><div class="actions"><button class="btn" id="exDays" type="button">${dlIcon}<span>Export CSV</span></button></div></div>`;
  html += `<section class="glass" style="padding:0;overflow:hidden"><div class="table-wrap"><table class="t" aria-label="Daily shadow results"><thead><tr><th>Day</th><th>Requests</th><th>Shadow pairs</th><th title="Pairs where only the candidate passed">Cand. better</th><th title="Pairs where only the current model passed">Cur. better</th><th>Change</th><th class="l">Drop interval</th><th class="l">Status</th></tr></thead><tbody>`;
  r.days.forEach((d, i) => {
    const from = i ? w.dayEnds[i - 1] : 0, cc = countCodes(r.codes, from, w.dayEnds[i]);
    html += `<tr><td>${dayLabel(i)}</td><td>${fmtN(w.volumes[i])}</td><td>${fmtN(w.dayEnds[i] - from)}</td><td>${fmtN(cc[2])}</td><td>${fmtN(cc[1])}</td><td>${pts(-d.deltaHat, 2)}</td><td class="l">${drop(d.lcb)} to ${drop(d.ucb)}</td><td class="l">${statusChip(d.status)}</td></tr>`;
  });
  html += `</tbody></table></div></section>`;
  view.innerHTML = html;
  drawBand($('#ch1'), r, delta);
  drawEvidence($('#ch2'), r, delta);
  const sw = $('#doSwitch'); if (sw) sw.onclick = () => confirmSwitch(row);
  const rb = $('#rollback'); if (rb) rb.onclick = () => { delete store.switched[w.id]; save(); toast(`${w.id} rolled back to ${DATA.current}`); renderDetail(id); };
  const ra = $('#raise'); if (ra) ra.onclick = () => { toast(`Shadow rate for ${w.id} set to 20% (concept: takes effect on new traffic)`); };
  const ss = $('#stopShadow'); if (ss) ss.onclick = () => { toast(`Shadowing paused for ${w.id} (concept)`); };
  $('#exCert').onclick = () => download(`${w.id}-certificate.json`, JSON.stringify(certificate(row), null, 2), 'application/json');
  $('#exDays').onclick = () => download(`${w.id}-daily.csv`, ['day,requests,pairs,cand_only,cur_only,change_pts,drop_lcb_pts,drop_ucb_pts,status', ...r.days.map((d, i) => { const from = i ? w.dayEnds[i - 1] : 0, cc = countCodes(r.codes, from, w.dayEnds[i]); return [dayLabel(i), w.volumes[i], w.dayEnds[i] - from, cc[2], cc[1], (-d.deltaHat * 100).toFixed(3), (d.lcb * 100).toFixed(2), (d.ucb * 100).toFixed(2), d.status].join(','); })].join('\n'), 'text/csv');
}

function lineChart(el, { days, series, bands = [], hlines = [], yfmt, ylabel, logScale = false }) {
  const W = Math.max(420, el.clientWidth || 560), H = 260, L = 56, B = 34, T = 10, R = 12;
  const all = [...series.flatMap((s) => s.v), ...bands.flatMap((b) => [...b.lo, ...b.hi]), ...hlines.map((h) => h.v)].filter((v) => isFinite(v));
  let lo = Math.min(...all), hi = Math.max(...all);
  const pad = (hi - lo) * 0.08 || 1; lo -= pad; hi += pad;
  const step = niceStep((hi - lo) / 5); lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
  const x = (i) => L + (W - L - R) * (days.length === 1 ? 0.5 : i / (days.length - 1));
  const y = (v) => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${ylabel}">`;
  for (let v = lo; v <= hi + 1e-9; v += step) s += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><line class="axis" x1="${L - 5}" x2="${L}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${yfmt(v)}</text>`;
  s += `<line class="axis" x1="${L}" x2="${L}" y1="${T}" y2="${H - B}"/><line class="axis" x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}"/>`;
  days.forEach((d, i) => { if (i % 2 === 0 || days.length < 8) s += `<line class="axis" x1="${x(i)}" x2="${x(i)}" y1="${H - B}" y2="${H - B + 5}"/><text x="${x(i)}" y="${H - B + 18}" text-anchor="middle">${d}</text>`; });
  for (const b of bands) { const top = b.hi.map((v, i) => `${x(i)},${y(Math.min(v, hi))}`).join(' '); const bot = b.lo.map((v, i) => `${x(i)},${y(Math.max(v, lo))}`).reverse().join(' '); s += `<polygon points="${top} ${bot}" fill="${b.color}"/>`; }
  for (const h of hlines) s += `<line x1="${L}" x2="${W - R}" y1="${y(h.v)}" y2="${y(h.v)}" stroke="#ffa726" stroke-width="1.5" stroke-dasharray="5 4"/>`;
  for (const sr of series) { s += `<polyline fill="none" stroke="${sr.color}" stroke-width="2" points="${sr.v.map((v, i) => `${x(i)},${y(v)}`).join(' ')}"/>` + sr.v.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="3" fill="${sr.color}"/>`).join(''); }
  s += `<line id="vx" x1="0" x2="0" y1="${T}" y2="${H - B}" stroke="rgb(255 255 255 / .35)" stroke-dasharray="3 3" visibility="hidden"/></svg>`;
  el.innerHTML = s;
  const svg = el.firstChild, tip = ensureTip();
  svg.onmousemove = (e) => {
    const bb = svg.getBoundingClientRect(); const px = (e.clientX - bb.left) * (W / bb.width);
    const i = Math.round(((px - L) / (W - L - R)) * (days.length - 1));
    if (i < 0 || i >= days.length) { tip.hidden = true; return; }
    const vx = $('#vx', svg); vx.setAttribute('x1', x(i)); vx.setAttribute('x2', x(i)); vx.setAttribute('visibility', 'visible');
    tip.innerHTML = `<b>${days[i]}</b>` + series.map((sr) => `<div class="r"><span>${sr.name}</span><span>${yfmt(sr.v[i], true)}</span></div>`).join('') + bands.map((b) => `<div class="r"><span>${b.name}</span><span>${yfmt(b.lo[i], true)} to ${yfmt(b.hi[i], true)}</span></div>`).join('');
    tip.hidden = false; tip.style.left = e.clientX + 14 + 'px'; tip.style.top = e.clientY + 10 + 'px';
  };
  svg.onmouseleave = () => { tip.hidden = true; $('#vx', svg).setAttribute('visibility', 'hidden'); };
}
function drawBand(el, r, delta) {
  const days = r.days.map((_, i) => dayLabel(i));
  lineChart(el, { days, ylabel: 'Quality drop in points with anytime-valid interval', yfmt: (v, t) => (t ? (v * 100).toFixed(2) : (v * 100).toFixed(1)) + (t ? ' pts' : ''),
    series: [{ name: 'Observed drop', color: 'var(--chart-1)', v: r.days.map((d) => d.deltaHat) }],
    bands: [{ name: 'Interval', color: 'rgb(2 178 175 / .22)', lo: r.days.map((d) => Math.max(d.lcb, -0.12)), hi: r.days.map((d) => Math.min(d.ucb, 0.16)) }],
    hlines: [{ v: delta }] });
}
function drawEvidence(el, r, delta) {
  // recompute the daily wealth path for the delta test (same code as the table, from the stream)
  const days = r.days.map((_, i) => dayLabel(i));
  lineChart(el, { days, ylabel: 'Log10 betting wealth for the certification test', yfmt: (v, t) => (t ? '10^' + v.toFixed(2) : v.toFixed(0) === '0' ? '1' : '10' + sup(v)),
    series: [{ name: 'Wealth', color: 'var(--chart-2)', v: r.wealthDays.map((v) => v / Math.LN10) }], hlines: [{ v: r.thr / Math.LN10 }] });
}
function sup(v) { const m = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '.': '·' }; return String(+v.toFixed(1)).split('').map((c) => m[c] ?? c).join(''); }

function certificate(row) {
  const r = row.r;
  return { workload: row.w.id, api_key: row.w.key, grader: row.w.grader, current_model: DATA.current, candidate_model: DATA.candidate, window: `${dayLabel(0)} to ${dayLabel(DATA.days - 1)} 2026`, shadow_pairs: r.n,
    counts: { same: r.counts[0], current_only_passed: r.counts[1], candidate_only_passed: r.counts[2] }, observed_drop_pts: +(r.deltaHat * 100).toFixed(3),
    anytime_interval_pts: [+(r.lcb * 100).toFixed(2), +(r.ucb * 100).toFixed(2)], max_drop_pts: store.delta, family_alpha: store.alpha / 100, per_workload_alpha: +r.alphaW.toFixed(6),
    decision: effStatus(row), decided_on: r.decidedDay >= 0 ? dayLabel(r.decidedDay) : null, monthly_cost_usd: +row.cur.toFixed(2), monthly_cost_if_switched_usd: +row.cand.toFixed(2),
    method: 'Paired shadow requests; one-sided betting tests (aGRAPA) on X=(1-D)/2 at every grid value of the drop; Ville inequality; Bonferroni across workloads.' };
}
function confirmSwitch(row) {
  const m = $('#modal');
  m.innerHTML = `<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dlgT"><h3 id="dlgT">Switch ${esc(row.w.id)} to ${DATA.candidate}?</h3><p>Requests from this workload will be served by ${DATA.candidate}. ${Math.round(DATA.shadowRate * 100)}% keep going to ${DATA.current} as a holdback so the certificate stays monitored.</p>
  <table><tr><td>Anytime-valid drop bound</td><td>${drop(row.r.ucb)} pts (limit ${store.delta})</td></tr><tr><td>Monthly cost</td><td>${fmtUSD(row.cur)} → ${fmtUSD(row.cand)}</td></tr><tr><td>Routing rule</td><td><code>model: ${DATA.current} → ${DATA.candidate}</code></td></tr></table>
  <div class="row-acts"><button class="btn" id="dlgNo" type="button">Cancel</button><button class="btn primary" id="dlgYes" type="button">Switch</button></div></div>`;
  m.hidden = false; $('#dlgYes').focus();
  const close = () => { m.hidden = true; m.innerHTML = ''; };
  $('#dlgNo').onclick = close; m.onclick = (e) => { if (e.target === m) close(); };
  $('#dlgYes').onclick = () => { store.switched[row.w.id] = Date.now(); save(); close(); toast(`${row.w.id} now runs on ${DATA.candidate}`); route(); };
}

// ---------- exports
function download(name, text, type) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  toast(`Downloaded ${name}`);
}
function exportCSV() {
  const an = analysis();
  const lines = ['workload,api_key,grader,shadow_pairs,change_pts,drop_lcb_pts,drop_ucb_pts,status,monthly_cost_usd,if_switched_usd,savings_usd'];
  for (const row of an.rows) { const r = row.r, s = effStatus(row); lines.push([row.w.id, row.w.key, `"${row.w.grader}"`, r.n || 0, r.empty ? '' : (-r.deltaHat * 100).toFixed(3), r.empty ? '' : (r.lcb * 100).toFixed(2), r.empty ? '' : (r.ucb * 100).toFixed(2), s, row.cur.toFixed(2), row.cand.toFixed(2), s === 'certified' || s === 'switched' ? row.save.toFixed(2) : '0'].join(',')); }
  download(`switch-check-${DATA.candidate}-${store.delta}pt.csv`, lines.join('\n'), 'text/csv');
}
function exportJSON() { const an = analysis(); download(`switch-check-certificates.json`, JSON.stringify(an.rows.filter((r) => !r.r.empty).map(certificate), null, 2), 'application/json'); }

// ---------- other pages (shell only)
function renderStub(page) {
  setActiveNav(page);
  const names = { playground: 'Playground', usage: 'API Usage', 'api-keys': 'Manage your API keys', 'rate-limits': 'Usage Limits', wallet: 'Wallet', settings: 'Settings', contact: 'Contact us' };
  view.innerHTML = header(names[page] || 'Not found', 'This page is part of the real CompactifAI Dashboard and is not reproduced in this concept demo.') + `<div class="empty"><h3>Not part of this demo</h3><p>Switch Check is the only page built here. Its numbers come from the same usage data the API Usage page shows.</p><a class="btn" href="#/switch-check${qs()}">Open Switch Check</a></div>`;
}

// ---------- states
function renderLoading() {
  view.innerHTML = header('Switch Check', 'Loading shadow results…') + `<section class="glass subtle"><div class="skel" style="width:60%"></div></section><section class="glass">${Array.from({ length: 8 }, () => '<div class="skel" style="margin:14px 0"></div>').join('')}</section>`;
}
function renderError() {
  view.innerHTML = header('Switch Check', 'See which workloads can move to a compressed model.') + `<div class="alert error" role="alert"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M11 15h2v2h-2zm0-8h2v6h-2zm1-5C6.47 2 2 6.5 2 12a10 10 0 1 0 10-10"/></svg><div>Could not load shadow results (${esc(LOADERR?.message || 'unknown error')}).</div></div><button class="btn" id="retry" type="button">Retry</button>`;
  $('#retry').onclick = boot;
}

// ---------- toast, help, keys
let tt;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(tt); tt = setTimeout(() => { t.hidden = true; }, 2600); }
function help() {
  const m = $('#modal');
  m.innerHTML = `<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="hT"><h3 id="hT">Keyboard shortcuts</h3><table><tr><td><kbd>j</kbd> / <kbd>k</kbd></td><td>Next / previous workload</td></tr><tr><td><kbd>Enter</kbd></td><td>Open workload</td></tr><tr><td><kbd>Esc</kbd></td><td>Back to all workloads</td></tr><tr><td><kbd>s</kbd></td><td>Switch the open workload (if certified)</td></tr><tr><td><kbd>e</kbd></td><td>Export CSV</td></tr><tr><td><kbd>?</kbd></td><td>This help</td></tr></table><div class="row-acts"><button class="btn" id="hClose" type="button">Close</button></div></div>`;
  m.hidden = false; $('#hClose').focus(); $('#hClose').onclick = () => { m.hidden = true; m.innerHTML = ''; };
}
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
  const m = $('#modal');
  if (!m.hidden) { if (e.key === 'Escape') { m.hidden = true; m.innerHTML = ''; } return; }
  const { page, id } = parseHash();
  if (page !== 'switch-check' || !DATA) return;
  const n = DATA.workloads.length;
  if (e.key === '?') { help(); e.preventDefault(); }
  else if (e.key === 'Escape' && id) go('/switch-check');
  else if (e.key === 'e') { id ? $('#exDays')?.click() : exportCSV(); }
  else if ((e.key === 'j' || e.key === 'k') && !id) { ui.sel = (ui.sel + (e.key === 'j' ? 1 : n - 1)) % n; view.querySelectorAll('tr.row').forEach((tr) => tr.classList.toggle('sel', +tr.dataset.i === ui.sel)); view.querySelector(`tr.row[data-i="${ui.sel}"]`)?.focus(); }
  else if ((e.key === 'j' || e.key === 'k') && id) { ui.sel = (ui.sel + (e.key === 'j' ? 1 : n - 1)) % n; go('/switch-check/' + encodeURIComponent(DATA.workloads[ui.sel].id)); }
  else if (e.key === 'Enter' && !id && document.activeElement?.tagName !== 'TR') go('/switch-check/' + encodeURIComponent(DATA.workloads[ui.sel].id));
  else if (e.key === 's' && id) $('#doSwitch')?.click();
});

// Augment analysis with the daily wealth path used by the evidence chart.
function addWealth() {
  const an = analysis();
  if (an._w) return; an._w = true;
  const jd = an.grid.findIndex((g) => Math.abs(g - store.delta / 100) < 1e-9);
  for (const r of an.workloads) {
    if (r.empty) continue;
    const w = DATA.workloads.find((x) => x.id === r.id);
    // replay the single delta test to record end-of-day wealth (frozen once it crosses, as in the core)
    const run = (m, flip) => {
      const t = new BettingTest(m); let k = 0, crossed = false; const out = [];
      for (const end of w.dayEnds) {
        for (; k < end && !crossed; k++) { const x = codeToX(r.codes[k]); t.push(flip ? 1 - x : x); if (t.logK >= r.thr) crossed = true; }
        k = Math.max(k, end);
        out.push(t.logK);
      }
      return out;
    };
    r.wealthCert = run(mOfDelta(an.grid[jd]), false);
    r.wealthDrop = run(1 - mOfDelta(an.grid[jd]), true);
    // show the direction the data points to
    r.evDir = r.status === 'regression' || (r.status === 'collecting' && r.deltaHat > an.grid[jd]) ? 'drop' : 'cert';
    r.wealthDays = r.evDir === 'drop' ? r.wealthDrop : r.wealthCert;
  }
}

function route() {
  if (!DATA) return LOADERR ? renderError() : renderLoading();
  const { page, id, params } = parseHash();
  settingsFromParams(params);
  if (page === 'switch-check') { analysis(); addWealth(); id ? renderDetail(id) : renderList(); }
  else renderStub(page);
  $('#main').scrollTop = 0;
}
window.addEventListener('hashchange', route);
window.addEventListener('resize', () => { clearTimeout(window.__rz); window.__rz = setTimeout(route, 150); });

async function boot() {
  renderLoading();
  await load();
  if (!location.hash) history.replaceState(null, '', '#/switch-check' + qs());
  route();
}
boot();
