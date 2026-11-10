// STICK TEST: a scatter plot of the stick's output, to check how consistent it is while playing (a dashdance: flicked
// all the way left and right, again and again). Each reading is a dot: blue while travelling, red where the stick
// stayed put for more than one game frame (1/60 s) - the spots the game actually reads as held. Tight red clusters at
// each edge mean the stick lands in the same place each time; a long red arc means it lands somewhere different every
// time. The panel beside the plot measures that spread per side.
//
// Shared by the HOJA2, PhobGCC and GP2040-CE apps: each one calls push(stick, x, y) for every reading it gets, x and y
// in -1..1 of the full radius (up positive). The rate is measured, since each firmware streams at its own pace.

import { el, download } from './js/ui.js';
import { $t } from './js/i18n.js';
import { panel, pbtn, setPbtn, segmented } from './parts.js';

const FRAME = 1000 / 60;   // one game frame
const CELL = 80;           // "the same spot": the same 1/80 of the radius (Melee's step)
const MAX = 30000;         // readings kept
const DASH_X = 0.8;        // Melee's dash threshold on X
const BLUE = '#3b82f6', RED = '#ef4444';

// names: the sticks to choose from (one name: no choice shown)
export function scatterPage(names) {
  let stick = 0, recording = true;
  let xs = new Float32Array(MAX), ys = new Float32Array(MAX), held = new Uint8Array(MAX), ts = new Float64Array(MAX), n = 0;
  let run = null;           // the spot being held: { cell, start, n, done }
  const holds = [];         // each held spot once: [x, y] (its mean)
  let lastT = 0, period = 0, redraw = true, drawn = 0, reds = [], statsDirty = true;

  const cv = el('canvas.scatter-cv');
  const count = el('div.sc-count');
  const legend = el('div.sc-legend', { html: `<span><i style="background:${RED}"></i>${$t('Target (held for more than 1 frame)')}</span><span><i style="background:${BLUE}"></i>${$t('Travel coordinates')}</span>` });
  const bRec = pbtn($t('Pause'), '', false, () => { recording = !recording; run = null; setPbtn(bRec, recording ? $t('Pause') : $t('Resume')); showStats(); });
  const bClear = pbtn($t('Clear'), 'trash', false, clear);
  const bCsv = pbtn($t('Export CSV'), 'download', false, exportCsv);
  const kids = [];
  if (names.length > 1) { const seg = segmented(names, i => { stick = i; clear(); }); kids.push(seg.el); }
  const plotPanel = panel($t('SCATTER PLOT'), [...kids, el('div.sc-wrap', {}, [cv]), count, legend], 'sc-plot');

  const rate = el('div.sc-rate'), left = el('div.sc-side'), right = el('div.sc-side'), state = el('p.sc-state');
  const statsPanel = panel($t('CONSISTENCY'), [
    el('p.hint.wrap.sc-how', { text: $t('Dashdance: flick the stick all the way left and right, as fast and for as long as you would in a game (10 seconds or more). Tight red clusters at each edge: the stick lands in the same place every time. Red spread along the rim: it lands somewhere different each time.') }),
    rate, left, right, state,
    el('div.btnrow', {}, [bRec, bClear, bCsv]),
  ], 'sc-stats');
  const page = el('div.page.hidden.dpage.scatter', {}, [plotPanel, statsPanel]);

  function clear() {
    n = 0; run = null; holds.length = 0; reds = []; redraw = true; statsDirty = true;
    showStats();
  }

  // a reading of stick k: x, y in -1..1 (up positive)
  function push(k, x, y) {
    if (k !== stick || !recording || page.classList.contains('hidden')) return;
    const t = performance.now();
    if (lastT) { const dt = t - lastT; if (dt < 250) period = period ? period * 0.95 + dt * 0.05 : dt; }   // the stream's pace (a pause doesn't count)
    lastT = t;
    if (n >= MAX) { if (recording) { recording = false; setPbtn(bRec, $t('Resume')); state.textContent = $t('The plot is full: Clear it to record more.'); } return; }
    const i = n++;
    xs[i] = x; ys[i] = y; ts[i] = t; held[i] = 0;
    const cell = Math.round(x * CELL) + ',' + Math.round(y * CELL);
    if (run && run.cell === cell) run.n++;
    else { endRun(); run = { cell, start: i, n: 1, done: false }; }
    // held for more than a frame: two readings or more, lasting longer than 1/60 s
    if (!run.done && run.n >= 2 && run.n * (period || FRAME) > FRAME) { run.done = true; for (let j = run.start; j < i; j++) { held[j] = 1; reds.push(j); } }
    if (run.done) held[i] = 1;
    statsDirty = true;
  }
  function endRun() {
    if (!run || !run.done) return;
    let sx = 0, sy = 0;
    for (let j = run.start; j < run.start + run.n; j++) { sx += xs[j]; sy += ys[j]; }
    holds.push([sx / run.n, sy / run.n]);
  }

  // ---------------------------------------------------------------- the plot
  let size = 0, ctx = null;
  function geom() {
    const r = cv.getBoundingClientRect(), px = Math.round(r.width * (window.devicePixelRatio || 1));
    if (!px) return false;
    if (px !== size) { size = cv.width = cv.height = px; redraw = true; }
    ctx = ctx || cv.getContext('2d');
    return true;
  }
  const R = () => size * 0.46, sx = x => size / 2 + x * R(), sy = y => size / 2 - y * R();
  function dot(i) {
    const d = Math.max(2, size / 140), c = Math.max(-1.08, Math.min(1.08, xs[i])), e = Math.max(-1.08, Math.min(1.08, ys[i]));
    ctx.fillStyle = held[i] ? RED : BLUE;
    ctx.fillRect(sx(c) - d / 2, sy(e) - d / 2, d, d);
  }
  function background() {
    ctx.fillStyle = '#1b1d22'; ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = '#3d424c'; ctx.lineWidth = Math.max(1, size / 220);
    ctx.beginPath(); ctx.arc(size / 2, size / 2, R(), 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(size / 2, size / 2 - R()); ctx.lineTo(size / 2, size / 2 + R()); ctx.moveTo(size / 2 - R(), size / 2); ctx.lineTo(size / 2 + R(), size / 2); ctx.stroke();
    // Melee's dash threshold, faint
    ctx.strokeStyle = '#2c3039'; ctx.setLineDash([size / 80, size / 80]);
    ctx.beginPath(); for (const s of [-1, 1]) { ctx.moveTo(sx(s * DASH_X), sy(-1)); ctx.lineTo(sx(s * DASH_X), sy(1)); } ctx.stroke();
    ctx.setLineDash([]);
  }
  function paint() {
    if (page.classList.contains('hidden') || !geom()) return;
    if (redraw) { background(); drawn = 0; reds = []; redraw = false; }
    for (const j of reds) if (j < drawn) dot(j);
    reds = [];
    for (; drawn < n; drawn++) dot(drawn);
    if (statsDirty) { statsDirty = false; showStats(); }
  }

  // ---------------------------------------------------------------- the numbers
  const deg = r => r * 180 / Math.PI;
  function side(list, sign, name) {
    // the held spots at this edge: past half way out, within 45 degrees of straight sideways
    const pts = list.filter(([x, y]) => x * sign > 0.5 && Math.abs(y) < Math.abs(x));
    if (pts.length < 2) return `<b>${name}</b><span class="m">${$t('No held spots yet')}</span>`;
    const ang = pts.map(([x, y]) => deg(Math.atan2(y, x * sign)));   // 0 = straight sideways, up positive
    const rad = pts.map(([x, y]) => Math.hypot(x, y)), xa = pts.map(([x]) => Math.abs(x));
    const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
    const sd = a => { const m = mean(a); return Math.sqrt(mean(a.map(v => (v - m) ** 2))); };
    const lo = Math.min(...ang), hi = Math.max(...ang), dash = xa.filter(v => v >= DASH_X - 1e-6).length;
    const f = v => (v >= 0 ? '+' : '') + v.toFixed(1) + '°';
    return `<b>${name}</b><span>${$t('{0} held spots', pts.length)}</span>` +
      `<span>${$t('Angle')}: ${f(lo)} … ${f(hi)} <em>(${$t('spread')} ${(hi - lo).toFixed(1)}°, ±${sd(ang).toFixed(1)}°)</em></span>` +
      `<span>${$t('Distance from centre')}: ${(Math.min(...rad) * 100).toFixed(0)} … ${(Math.max(...rad) * 100).toFixed(0)}%</span>` +
      `<span>${$t('X past {0} (dash)', DASH_X.toFixed(2))}: ${dash} / ${pts.length}</span>`;
  }
  function showStats() {
    count.textContent = $t('{0} coordinates plotted', n);
    rate.textContent = period ? $t('Readings: about {0} a second (the game reads 60)', Math.round(1000 / period)) : $t('Waiting for readings...');
    rate.classList.toggle('slow', !!period && 1000 / period < 58);
    rate.title = period && 1000 / period < 58 ? $t('Slower than the game: some frames fall between readings, so fewer travel points show. The held spots are still right.') : '';
    const all = run && run.done ? [...holds, (() => { let a = 0, b = 0; for (let j = run.start; j < run.start + run.n; j++) { a += xs[j]; b += ys[j]; } return [a / run.n, b / run.n]; })()] : holds;
    left.innerHTML = side(all, -1, $t('LEFT'));
    right.innerHTML = side(all, 1, $t('RIGHT'));
    if (recording && n < MAX) state.textContent = '';
    else if (!recording && n < MAX) state.textContent = $t('Paused.');
  }

  function exportCsv() {
    const rows = ['index,time_ms,x,y,held'];
    for (let i = 0; i < n; i++) rows.push(`${i},${(ts[i] - ts[0]).toFixed(1)},${xs[i].toFixed(4)},${ys[i].toFixed(4)},${held[i]}`);
    download('padbox-stick-test.csv', rows.join('\n'), 'text/csv');
  }

  showStats();
  return { page, push, paint, clear, get stick() { return stick; } };
}
