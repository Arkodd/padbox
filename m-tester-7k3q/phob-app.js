// The PhobGCC PadBox Calibrator in the new design (Figma "PadBox Software"), for the PadBox GS Platform - the same
// frame, drawing and panels as the GP2040-CE and HOJA2 copies, with PhobGCC's settings (a copy of js/phob/app.js):
// CONTROLLER (what each button does as a GameCube button, LED colors), CALIBRATION (PhobGCC's own step-by-step notch
// calibration, driven through virtual button presses) and SETTINGS (stick response).
// The button map, the settings and the axis flips wait for Save; LED colors apply (and save) right away.

import { el, pickColor, hex, clamp, confirmBox } from './js/ui.js';
import { firmwareUpdate } from './js/update.js';
import { buildDrawing } from './drawing.js';
import { dicon } from './icons.js';

const BA = 1, BB = 2, BX = 4, BY = 8, BZ = 16, BL = 32, BR = 64, BS = 128;
const CAL_ORDER = [0, 1, 8, 9, 16, 17, 24, 25, 4, 5, 12, 13, 20, 21, 28, 29, 2, 3, 6, 7, 10, 11, 14, 15, 18, 19, 22, 23, 26, 27, 30, 31];
const ADJ_ORDER = [2, 6, 10, 14, 1, 3, 5, 7, 9, 11, 13, 15];
const BTN_NAMES = ['A (1K)', 'B (2K)', 'X (1P)', 'Y (2P)', 'Z (3P)', 'L (4K)', 'R (3K)', 'Start', 'Up', 'Down', 'Left', 'Right'];
const OUTPUTS = ['A', 'B', 'X', 'Y', 'Z', 'L', 'R', 'Start', 'D-pad Up', 'D-pad Down', 'D-pad Left', 'D-pad Right', '(nothing)'];
const OUT_SHORT = ['A', 'B', 'X', 'Y', 'Z', 'L', 'R', 'Start', 'Up', 'Down', 'Left', 'Right'];   // Up..Right are drawn as arrows
const C_UP = 100, C_DOWN = 101, C_LEFT = 102, C_RIGHT = 103;   // the C-stick buttons: not in the firmware's input table
const C_NAME = { [C_UP]: 'C-stick up', [C_DOWN]: 'C-stick down', [C_LEFT]: 'C-stick left', [C_RIGHT]: 'C-stick right' };
const C_SHORT = { [C_UP]: 'C-Up', [C_DOWN]: 'C-Dn', [C_LEFT]: 'C-Lt', [C_RIGHT]: 'C-Rt' };
const TRIG = 20;   // the analog trigger's slot in the input table (the GS Platform has none)

// The PadBox GS Platform (the desktop app's PhobBoard)
const INPUTS = ['1P', '2P', '3P (RB)', '4P (LB)', '1K', '2K', '3K (RT)', '4K (LT)', 'Start', 'Select', 'Home', 'Touchpad', 'A button', 'Bumper', '(not used)', '(not used)', 'D-pad Up', 'D-pad Down', 'D-pad Left', 'D-pad Right', '(no analog trigger)'];
// the HOJA2 GameCube layout: 1P=R 2P=Y 3P=R 10% 4P=R 50%, 1K=B 2K=X 3K=Z 4K=nothing, "A" button = A, Bumper = L
const DEF = [6, 3, 6, 6, 1, 2, 4, 12, 7, 12, 12, 12, 0, 5, 12, 12, 8, 9, 10, 11, 12, 100, 100, 10, 50, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 27];
const N_LEDS = 13;
// the LED chain: 4K 3K 2K 1K 1P 2P 3P 4P, then the "A" button, C-down, C-left, C-up, C-right
const ledOf = b => b >= 0 && b < 8 ? [4, 5, 6, 7, 3, 2, 1, 0][b] : b === 12 ? 8 : b === C_DOWN ? 9 : b === C_LEFT ? 10 : b === C_UP ? 11 : b === C_RIGHT ? 12 : -1;
// the drawing's buttons (named by their GP2040-CE GPIO, see drawing.js) -> PhobGCC's input bits
const BIT = { 10: 0, 11: 1, 12: 2, 13: 3, 6: 4, 7: 5, 8: 6, 9: 7, 17: 8, 16: 9, 20: 10, 21: 11, 15: 12, 22: 13, 2: 16, 3: 17, 5: 18, 4: 19, 27: C_UP, 19: C_RIGHT, 26: C_LEFT, 18: C_DOWN };

export async function startPhob(shell, dev, opts) {
  let alive = true, frame = null, map = null, led = null, settings = null;
  let macro = [], macroMask = 0, macroUntil = 0, holdMask = 0;
  const pending = { map: null, settings: null, inv: -1 };   // staged until Save
  const wanted = { map: null, settings: null, inv: -1, at: 0, tries: 0 };
  const asked = { map: 0, led: 0, settings: 0 };
  const boardName = 'GS Platform';

  shell.header('PhobGCC', 'PadBox GS Platform' + (opts.demo ? '  •  demo' : ''));
  shell.status(true);
  const say = (t, c) => shell.footer(t, c);
  say('Waiting for the controller...');

  // ---------------------------------------------------------------- header buttons (the design's icon buttons)
  const iconBtn = (cls, ic, title, onclick) => { const b = el('button.act.' + cls, { type: 'button', title, html: dicon(ic) }); b.addEventListener('click', onclick); return b; };
  const btnUpdate = iconBtn('outline', 'download', 'Update firmware', () => firmwareUpdate({ board: boardName, current: 'PhobGCC',
    enter: async noDrive => { await saveAll(); await new Promise(r => setTimeout(r, 300)); alive = false; await dev.send(noDrive ? 'BOOTSEL NODRIVE' : 'BOOTSEL'); await new Promise(r => setTimeout(r, 3500)); } }));
  const btnSave = iconBtn('save', 'save', 'Save to the controller', saveAll); btnSave.disabled = true;
  const btnDone = el('button.act.primary', { type: 'button', html: dicon('gamepad') + '<span>Disconnect</span>' });
  btnDone.addEventListener('click', async () => {
    if (isDirty() && !await confirmBox('Unsaved changes', 'Your button map, settings or axis flips aren\'t saved yet: they\'ll be lost. Disconnect anyway?', 'DISCONNECT')) return;
    shell.lost(null);
  });
  shell.actions([btnUpdate, btnSave, btnDone]);
  const isDirty = () => !!(pending.map || pending.settings || pending.inv >= 0);
  function staged() { btnSave.disabled = false; say('Unsaved changes - click Save to send them to the controller.', 'var(--warn)'); }
  async function saveAll() {
    if (!isDirty()) return;
    btnSave.disabled = true;
    if (pending.map) { wanted.map = pending.map; pending.map = null; await dev.send('N ' + wanted.map.join(' ')); }
    if (pending.settings) { wanted.settings = pending.settings; pending.settings = null; await dev.send('S ' + wanted.settings.join(' ')); }
    if (pending.inv >= 0) { wanted.inv = pending.inv; pending.inv = -1; await dev.send('I ' + wanted.inv); }
    wanted.at = performance.now(); wanted.tries = 1;
    say('Saving...', 'var(--warn)');
  }

  // ---------------------------------------------------------------- the design's building blocks
  function panel(title, kids, cls) { return el('div.panel' + (cls ? '.' + cls : ''), {}, [el('div.ptitle', { text: title }), ...kids]); }
  function dtoggle(text, onchange) {
    const input = el('input', { type: 'checkbox' });
    const lab = el('label.dtoggle', {}, [input, el('i'), el('span', { text })]);
    input.addEventListener('change', () => onchange(input.checked));
    return { el: lab, get checked() { return input.checked; }, set checked(v) { input.checked = !!v; } };
  }
  function dslider(caption, min, max, fmt, onchange) {
    const val = el('span'), input = el('input.range', { type: 'range', min, max, step: 1 });
    const paint = () => { const v = +input.value; val.textContent = fmt ? fmt(v) : String(v); input.style.setProperty('--p', (max > min ? (v - min) / (max - min) * 100 : 0) + '%'); };
    input.addEventListener('input', () => { paint(); onchange(+input.value); });
    const wrap = el('div.dslider', {}, [el('div.lbl.split', {}, [el('span', { text: caption }), val]), input]);
    return { el: wrap, get value() { return +input.value; }, set value(v) { input.value = v; paint(); },
      set disabled(v) { input.disabled = !!v; wrap.classList.toggle('off', !!v); } };
  }
  function pbtn(text, primary, onclick) {
    const b = el('button.pbtn.' + (primary ? 'primary' : 'outline'), { type: 'button', html: '<span>' + text + '</span>' });
    if (onclick) b.addEventListener('click', onclick);
    return b;
  }
  const zoomOf = () => parseFloat(getComputedStyle(document.getElementById('stage')).zoom) || 1;

  // ---------------------------------------------------------------- CONTROLLER page
  let sel = -1, phys = 0;
  const pinOf = b => { for (const p in BIT) if (BIT[p] === b) return +p; return -1; };
  const nameOf = b => b >= C_UP ? C_NAME[b] : INPUTS[b];
  const ledRgbRaw = i => led ? (led[i * 3] << 16) | (led[i * 3 + 1] << 8) | led[i * 3 + 2] : 0;
  const curMap = () => map || DEF;
  const drawing = buildDrawing(pin => select(BIT[pin]), pin => {
    const b = BIT[pin], m = curMap();
    return nameOf(b) + '  →  ' + (b >= C_UP ? 'the C-stick' : m[b] >= 0 && m[b] < 12 ? OUTPUTS[m[b]] : 'nothing');
  }, pin => {
    const b = BIT[pin]; if (b == null) return '';
    if (b >= C_UP) return C_SHORT[b];
    const m = curMap(), o = m[b];
    if (!(o >= 0 && o < 12)) return '';
    return (o === 5 || o === 6) && m[21 + b] < 100 ? OUT_SHORT[o] + ' ' + m[21 + b] + '%' : OUT_SHORT[o];
  }, 'platform');

  const empty = el('div.panel.empty', {}, [
    el('div.click-icon', { html: dicon('click') }),
    el('div.empty-t', { text: 'No button selected' }),
    el('div.empty-d', { text: 'Click a button on the controller or press it on the device to configure its function and LED lighting' }),
  ]);
  const fn = el('select.field.mono');
  OUTPUTS.forEach((o, i) => fn.append(el('option', { value: i, text: o })));
  const fnC = el('option', { value: 99, text: 'C-stick (can\'t be remapped)' });
  fn.addEventListener('change', () => { if (sel < 0 || sel >= C_UP || !map) return; const m = map.slice(); m[sel] = +fn.value; setMap(m); });
  const amount = dslider('Analog amount (as L or R)', 1, 100, v => v + '%', v => { if (sel < 0 || sel >= C_UP || !map) return; const m = map.slice(); m[21 + sel] = v; setMap(m); });
  const ledDot = el('i.dot'), ledTxt = el('span');
  const ledFieldBtn = el('button.field.color', { type: 'button' }, [ledDot, ledTxt]);
  ledFieldBtn.addEventListener('click', () => {
    const li = ledOf(sel); if (li < 0 || !led) return;
    pickColor(ledRgbRaw(li), c => { setLed(li, c); sendLed(); });
  });
  const ledCap = el('span');
  const ledBlock = el('div.led-block', {}, [
    el('div.lbl', { text: 'LED color' }),
    el('div.two.one', {}, [ledFieldBtn]),
    el('div.noled-note', { text: 'This button has no LED' }),
    el('div.two.caps.one', {}, [ledCap]),
  ]);
  const btnResetOne = el('button.pbtn.primary', { type: 'button', html: dicon('sync') + '<span>Reset this button</span>' });
  btnResetOne.addEventListener('click', () => { if (sel < 0 || sel >= C_UP || !map) return; const m = map.slice(); m[sel] = DEF[sel]; m[21 + sel] = DEF[21 + sel]; setMap(m); });
  const btnResetAll = el('button.pbtn.outline', { type: 'button', html: dicon('sync') + '<span>Reset all buttons</span>' });
  btnResetAll.addEventListener('click', () => { if (map) setMap(DEF.slice()); });
  const settingsPanel = el('div.panel.hidden', {}, [
    el('div.ptitle', { text: 'BUTTON SETTINGS' }),
    el('div.lbl', { text: 'Function' }), fn,
    amount.el,
    ledBlock,
    btnResetOne, btnResetAll,
    el('p.hint', { html: 'Click <b>Save</b> to send your changes to the controller' }),
  ]);

  // GLOBAL LED SETTINGS: one color for every button, and the brightness
  let allColor = 0x0000ff;
  const wheelDot = el('i.wheel-in'), wheelKnob = el('i.wheel-knob');
  const wheel = el('div.wheel', { title: 'Pick a color for every button' }, [wheelDot, wheelKnob]);
  const rgbTxt = el('span'), hexTxt = el('span');
  const hsvHue = c => { const r = ((c >> 16) & 255) / 255, g = ((c >> 8) & 255) / 255, b = (c & 255) / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (!d) return 0; let h = mx === r ? (g - b) / d % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; return h < 0 ? h + 360 : h; };
  const hueColor = h => { const f = n => { const k = (n + h / 60) % 6; return Math.round(255 * (1 - Math.max(0, Math.min(k, 4 - k, 1)))); }; return (f(5) << 16) | (f(3) << 8) | f(1); };
  function showAllColor(c) {
    allColor = c; wheelDot.style.background = hex(c);
    const a = (hsvHue(c) - 90) * Math.PI / 180;
    wheelKnob.style.left = (50 + 41.5 * Math.cos(a)) + '%'; wheelKnob.style.top = (50 + 41.5 * Math.sin(a)) + '%';
    rgbTxt.textContent = `R${(c >> 16) & 255} G${(c >> 8) & 255} B${c & 255}`; hexTxt.textContent = hex(c).toUpperCase();
  }
  const setLed = (i, c) => { led[i * 3] = (c >> 16) & 255; led[i * 3 + 1] = (c >> 8) & 255; led[i * 3 + 2] = c & 255; };
  const setAll = c => { showAllColor(c); if (!led) return; for (let i = 0; i < N_LEDS; i++) setLed(i, c); sendLed(); };
  wheel.addEventListener('click', e => {
    const r = wheel.getBoundingClientRect(), x = e.clientX - r.left - r.width / 2, y = e.clientY - r.top - r.height / 2;
    if (Math.hypot(x, y) < r.width * 0.3) return pickColor(allColor, setAll);
    let h = Math.atan2(y, x) * 180 / Math.PI + 90; if (h < 0) h += 360;
    setAll(hueColor(h));
  });
  const swatches = el('div.sw', {}, [0xe02b2b, 0xe09c06, 0x0634e0, 0xeb2fdb].map(c => { const b = el('button', { type: 'button', title: hex(c) }); b.style.background = hex(c); b.addEventListener('click', () => setAll(c)); return b; }));
  const plus = el('button.plus', { type: 'button', title: 'Another color...', html: dicon('plus') });
  plus.addEventListener('click', () => pickColor(allColor, setAll));
  swatches.append(plus);
  const bright = dslider('Brightness', 0, 100, v => v + '%', v => { if (!led) return; led[N_LEDS * 3] = v; sendLed(); });
  const ledPanel = el('div.panel', {}, [
    el('div.ptitle', { text: 'GLOBAL LED SETTINGS' }),
    el('div.lbl', { text: 'LED color' }),
    el('div.colorrow', {}, [wheel, el('div', {}, [el('div.readout', {}, [rgbTxt, hexTxt]), swatches])]),
    bright.el,
    el('p.hint.wrap', { text: 'LED colors apply and save right away.' }),
  ]);
  const column = el('div.side-col.phob', {}, [empty, settingsPanel, ledPanel]);
  const page0 = el('div.page.controller', {}, [drawing.svg, column]);

  let ledTimer = 0, ledSentAt = 0;
  function sendLed() { refreshSide(); clearTimeout(ledTimer); ledTimer = setTimeout(() => { ledSentAt = performance.now(); dev.send('L ' + led.join(' ')); }, 60); }
  function setMap(m) { map = m; pending.map = m.slice(); staged(); refreshSide(); }
  function select(b) { if (b == null) return; sel = b; refreshSide(); }
  function refreshSide() {
    const none = sel < 0;
    empty.classList.toggle('hidden', !none); settingsPanel.classList.toggle('hidden', none);
    column.classList.toggle('selected', !none);
    if (!none) {
      const m = curMap(), isC = sel >= C_UP;
      if (isC) { if (!fnC.parentNode) fn.append(fnC); fn.value = '99'; }
      else { fnC.remove(); fn.value = String(m[sel] >= 0 && m[sel] <= 12 ? m[sel] : 12); }
      fn.disabled = isC || !map;
      amount.value = !isC && m[21 + sel] >= 1 && m[21 + sel] <= 100 ? m[21 + sel] : 100;
      amount.disabled = isC || !map || !(m[sel] === 5 || m[sel] === 6);   // the % only means something as L or R
      const li = ledOf(sel);
      ledBlock.classList.toggle('noled', li < 0);
      if (li >= 0) { const c = ledRgbRaw(li); ledDot.style.background = hex(c); ledTxt.textContent = hex(c).toUpperCase(); ledCap.textContent = 'LED ' + (li + 1) + ' of the chain'; }
      btnResetOne.disabled = isC || !map;
    }
    btnResetAll.disabled = !map;
    if (led) bright.value = led[N_LEDS * 3];
    bright.disabled = !led;
    drawing.refreshTips();
  }
  // which buttons are down: the physical buttons, and the C-stick buttons from the C-stick's output
  const lit = b => {
    if (b == null) return false;
    if (b >= C_UP) { if (!frame || frame.step >= 0) return false;   // while calibrating, the C-stick's output is the target
      const cx = frame.cx - 127, cy = frame.cy - 127; return b === C_UP ? cy > 30 : b === C_DOWN ? cy < -30 : b === C_RIGHT ? cx > 30 : cx < -30; }
    return (phys & (1 << b)) !== 0;
  };
  const drawTick = setInterval(() => {
    if (!alive) return clearInterval(drawTick);
    drawing.set(pinOf(sel), pin => lit(BIT[pin]));
    drawing.setLeds(pin => { const li = ledOf(BIT[pin]); return li >= 0 && led ? hex(ledRgbRaw(li)) : null; });
    drawing.setSticks([frame ? [(frame.ax - 127) / 100, (frame.ay - 127) / 100] : [0, 0]]);
  }, 30);

  // ---------------------------------------------------------------- CALIBRATION page
  const view = makeView();
  const oct = dtoggle('Octagonal gate', v => { view.octagon = v; });   // how the gate is drawn and which notches are aimed at
  oct.checked = true; view.octagon = true;   // octagonal by default, like a GameCube stick's gate
  // flips: bit 0 left X, 1 left Y ("I <mask>", saved in the controller, no need to recalibrate)
  const flips = [dtoggle('Flip X axis', flipChanged), dtoggle('Flip Y axis', flipChanged)];
  let invOther = 0;   // the C-stick's flip bits, kept as they are
  function flipChanged() { pending.inv = invOther | (flips[0].checked ? 1 : 0) | (flips[1].checked ? 2 : 0); staged(); }
  const clearBtn = pbtn('Clear trace / set centre', false, () => view.reset(true));
  const stickPanel = panel('LEFT STICK', [
    el('div.phob-gate', {}, [view.canvas]),
    el('div.two', {}, [flips[0].el, flips[1].el]),
    el('div.phob-row', {}, [oct.el, clearBtn]),
  ], 'phob-stick');

  const stepLbl = el('div.step');
  const prog = el('div.phob-prog', {}, [el('i')]);
  const instr = el('div.info.phob-instr');
  const macroBtn = (text, steps, primary) => pbtn(text, primary, () => { macro = steps.slice(); macroUntil = 0; });
  const holdBtn = (text, m) => { const b = pbtn(text, false); b.addEventListener('pointerdown', () => { holdMask |= m; }); for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => { holdMask &= ~m; }); return b; };
  const seen = el('div.info');
  const calPanel = panel('CALIBRATION', [
    stepLbl, prog, instr,
    el('div.lbl', { text: 'Start / stop' }),
    el('div.phob-grid', {}, [macroBtn('Unlock', [[BA | BX | BY | BS, 1300]]), macroBtn('Lock', [[BA | BX | BY | BS, 250]]), macroBtn('Calibrate the stick', [[BA | BX | BY | BL, 300]], true)]),
    el('div.lbl', { text: 'During calibration' }),
    el('div.phob-grid', {}, [macroBtn('Advance (A)', [[BA, 200]], true), macroBtn('Undo (Z)', [[BZ, 200]]), macroBtn('Skip (Start)', [[BS, 200]]),
      holdBtn('Rotate CW (X)', BX), holdBtn('Rotate CCW (Y)', BY), macroBtn('Reset notch (B)', [[BB, 200]])]),
    el('div.lbl', { text: 'What the controller sees' }), seen,
  ], 'phob-cal');
  const page1 = el('div.page.hidden.dpage.phobcal', {}, [stickPanel, calPanel]);

  function makeView() {
    const canvas = el('canvas.phob-canvas');
    const v = { canvas, octagon: false, active: false, outX: 0, outY: 0, hasTarget: false, tx: 0, ty: 0, aim: NaN, aimCenter: false, rawX: 0.5, rawY: 0.5, cx: NaN, cy: NaN, range: 0.05, trail: [], ang: 0, pct: 0 };
    v.setRaw = (x, y) => {
      if (isNaN(v.cx)) { v.cx = x; v.cy = y; }
      v.rawX = x; v.rawY = y;
      const dx = x - v.cx, dy = y - v.cy, m = Math.hypot(dx, dy);
      if (m > v.range) v.range = m;
      let ang = Math.atan2(dy, dx) * 180 / Math.PI; if (ang < 0) ang += 360;
      v.ang = ang; v.pct = v.range > 0 ? 100 * m / v.range : 0;
      if (m > 0.6 * v.range) { v.trail.push([dx, dy]); if (v.trail.length > 5000) v.trail.shift(); }
    };
    v.reset = recenter => { v.trail = []; v.range = 0.05; if (recenter) { v.cx = v.rawX; v.cy = v.rawY; } };
    // the gate in the design's colors: dark field, grey outline, blue trace and raw dot, orange output dot, yellow aim
    v.paint = () => {
      const r = canvas.getBoundingClientRect(), z = zoomOf(), dpr = (window.devicePixelRatio || 1) * z;
      const W = r.width / z, H = r.height / z;
      if (W < 10) return;
      if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
      const g = canvas.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
      const bottom = 30, cx = W / 2, cy = (H - bottom) / 2, R = Math.min(W, H - bottom) / 2 - 12;
      const gate = () => { g.beginPath(); if (!v.octagon) g.arc(cx, cy, R, 0, Math.PI * 2); else { for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; g[i ? 'lineTo' : 'moveTo'](cx + R * Math.cos(a), cy - R * Math.sin(a)); } g.closePath(); } };
      gate(); g.fillStyle = '#232323'; g.fill();
      g.lineWidth = 1; g.strokeStyle = '#353535';
      for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * R, cy - Math.sin(a) * R); g.stroke(); }
      gate(); g.lineWidth = 1.5; g.lineJoin = 'round'; g.strokeStyle = v.active ? '#fe6805' : '#c5c5c5'; g.stroke();
      // the notch ticks
      g.lineWidth = 2; g.strokeStyle = '#8a8a8a';
      for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, ux = Math.cos(a), uy = -Math.sin(a); g.beginPath(); g.moveTo(cx + ux * R * 0.96, cy + uy * R * 0.96); g.lineTo(cx + ux * R * 1.07, cy + uy * R * 1.07); g.stroke(); }
      if (v.active && !isNaN(v.aim)) { const a = v.aim * Math.PI / 180; g.setLineDash([5, 4]); g.lineWidth = 1.5; g.strokeStyle = '#ffd23c'; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * R * 1.08, cy - Math.sin(a) * R * 1.08); g.stroke(); g.setLineDash([]); }
      g.fillStyle = 'rgba(40,166,255,.5)';
      for (const [x, y] of v.trail) g.fillRect(cx + x / v.range * R - 1, cy - y / v.range * R - 1, 2, 2);
      if (!isNaN(v.cx)) { g.beginPath(); g.arc(cx + (v.rawX - v.cx) / v.range * R, cy - (v.rawY - v.cy) / v.range * R, 5, 0, Math.PI * 2); g.fillStyle = '#28a6ff'; g.fill(); }
      if (!v.active) { g.beginPath(); g.arc(cx + v.outX * R, cy - v.outY * R, 6.5, 0, Math.PI * 2); g.fillStyle = '#fe6805'; g.fill(); g.lineWidth = 1.5; g.strokeStyle = '#2a2a2a'; g.stroke(); }
      // the target: where PhobGCC wants the stick for this step (it shows it on the C-stick's output while calibrating)
      if (v.hasTarget) {
        const tx = cx + v.tx * R, ty = cy - v.ty * R; g.lineWidth = 2.5; g.lineCap = 'round'; g.strokeStyle = '#ffd23c';
        g.beginPath(); g.moveTo(tx - 8, ty - 8); g.lineTo(tx + 8, ty + 8); g.moveTo(tx - 8, ty + 8); g.lineTo(tx + 8, ty - 8); g.stroke(); g.lineCap = 'butt';
        g.font = '600 9px Poppins'; g.fillStyle = '#ffd23c'; g.textAlign = tx > cx + R * 0.55 ? 'right' : 'left'; g.fillText('target', tx > cx + R * 0.55 ? tx - 11 : tx + 11, ty - 8);
      }
      let txt = `stick now: ${Math.round(v.ang)}°   ${Math.round(v.pct)}% out`, col = '#cfcfcf';
      if (v.active && !isNaN(v.aim)) {
        let err = v.ang - v.aim; while (err > 180) err -= 360; while (err < -180) err += 360;
        txt = `aim ${Math.round(v.aim)}°   now ${Math.round(v.ang)}°   (${err >= 0 ? '+' : ''}${Math.round(err)}°)   ${Math.round(v.pct)}% out`;
        col = Math.abs(err) <= 3 && v.pct > 85 ? '#34de83' : Math.abs(err) <= 8 ? '#ffc85a' : '#ff6e6e';
      } else if (v.active && v.aimCenter) { txt = `aim: centre   now ${Math.round(v.pct)}% out`; col = v.pct <= 4 ? '#34de83' : '#ffc85a'; }
      g.textAlign = 'center';
      g.font = '600 9.5px Poppins'; g.fillStyle = col; g.fillText(txt, cx, H - 17);
      g.font = '8.5px Poppins'; g.fillStyle = '#8a8a8a'; g.fillText('blue = raw sensor   orange = output   ✕ = target', cx, H - 4);
    };
    return v;
  }
  function notchName(n) { return { 0: 'right', 2: 'up-right', 4: 'up', 6: 'up-left', 8: 'left', 10: 'down-left', 12: 'down', 14: 'down-right' }[n] || 'in-between notch ' + n; }
  function instruction(f) {
    if (f.step < 0) return f.locked ? 'Locked. Click Unlock (hands off the stick), wait 2 seconds, then click Calibrate the stick.' : 'Ready. Click Calibrate the stick, wait 2 seconds and keep the stick centred.';
    if (f.step < 32) {
      const e = CAL_ORDER[f.step], notch = e >> 1;
      if (!(e & 1)) return 'Let the stick rest in the centre and hold it still, then click Advance.';
      if (notch % 2 === 0) return 'Push the stick firmly into the ' + notchName(notch) + ' notch and hold it still, then click Advance.' + (!view.octagon && notch % 4 ? ' Round gate: the edge at 45°.' : '');
      return 'In-between notch #' + notch + ': if your gate has none here, leave the stick in the centre, then click Advance.';
    }
    const i = f.step - 32;
    if (i < ADJ_ORDER.length) return 'Notch adjustment (' + notchName(ADJ_ORDER[i]) + '): hold Rotate CW / CCW to nudge it, Reset notch to undo, Advance to accept.';
    return 'Finishing and saving...';
  }

  // ---------------------------------------------------------------- SETTINGS page (the left stick's: the C-stick is buttons)
  // the 19 values of the "S" command, in setStickSettingsFromText's order (see the desktop app's SettingsPanel)
  const vals = new Array(19).fill(0);
  let setTimer = 0;
  const sChanged = () => { clearTimeout(setTimer); setTimer = setTimeout(() => { pending.settings = vals.slice(); staged(); }, 200); };
  const signed = x => x > 0 ? '+' + x : String(x), plain = x => String(x), pctF = x => x + '%';
  const SL = (cap, min, max, f, idx) => { const s = dslider(cap, min, max, f, v => { vals[idx] = v; sChanged(); }); s.idx = idx; return s; };
  const sliders = [
    SL('Snapback X', -10, 10, signed, 4), SL('Snapback Y', -10, 10, signed, 5),
    SL('Smoothing X', 0, 18, plain, 6), SL('Smoothing Y', 0, 18, plain, 7),
    SL('Waveshaping X', -24, 24, signed, 10), SL('Waveshaping Y', -24, 24, signed, 11),
    SL('Cardinal snapping', -2, 6, signed, 0), SL('Analog scaler', 90, 110, pctF, 2),
  ];
  const note = t => el('p.hint.wrap', { text: t });
  const page2 = el('div.page.hidden.dpage.settings', {}, [
    panel('SNAPBACK FILTERING', [sliders[0].el, sliders[1].el, note('Less snapback when you let the stick go (both sticks).')]),
    panel('STICK SMOOTHING', [sliders[2].el, sliders[3].el, note('Smooths the stick\'s output; higher = smoother but slower.')]),
    panel('WAVESHAPING', [sliders[4].el, sliders[5].el, note('The stick\'s response during fast movement.')]),
    panel('CARDINAL SNAPPING', [sliders[6].el, note('Snaps near-cardinal inputs to true up / down / left / right.')]),
    panel('ANALOG SCALER', [sliders[7].el, note('The output at the gate edge, as a percent of the calibrated size.')]),
  ]);
  function showSettings(v) { for (let i = 0; i < 19; i++) vals[i] = v[i]; for (const s of sliders) s.value = vals[s.idx]; }

  // ---------------------------------------------------------------- the side menu, lines from the controller, timers
  const pages = [page0, page1, page2];
  shell.content(el('div', { style: { position: 'absolute', inset: 0 } }, pages));
  let curPage = page0;
  shell.tabs(['CONTROLLER', 'CALIBRATION', 'SETTINGS'], i => { curPage = pages[i]; pages.forEach((p, k) => p.classList.toggle('hidden', k !== i)); },
    { SETTINGS: 'Fine-tune how the stick responds' });
  refreshSide(); showAllColor(allColor);

  const ints = (line, n) => { const p = line.split(','); if (p.length !== n + 1) return null; const v = p.slice(1).map(Number); return v.some(isNaN) ? null : v; };
  let haveFrame = false, colorShown = false;
  dev.onLine = line => {
    if (line.startsWith('F,')) {
      const v = line.split(',').slice(1).map(Number);
      if (v.length < 15) return;
      frame = { step: v[0], stick: v[1], locked: v[2], ax: v[4], ay: v[5], cx: v[6], cy: v[7], la: v[8], buttons: v[10],
        rawAx: v[11] / 10000, rawAy: v[12] / 10000, inv: v.length > 15 ? v[15] : 0, phys: v.length > 16 ? v[16] : 0, saveState: v.length >= 25 ? v[24] : 0 };
      if (!haveFrame) { haveFrame = true; view.setRaw(frame.rawAx, frame.rawAy); view.reset(true); say('Receiving data'); }
      onFrame(frame);
    } else if (line.startsWith('M,')) {
      const m = ints(line, 42); if (!m) return;
      if (wanted.map) { if (m.join() !== wanted.map.join()) return; wanted.map = null; say('Button mapping saved in the controller.', 'var(--good)'); }
      if (!pending.map) { map = m; refreshSide(); }
    } else if (line.startsWith('LC,')) {
      let p = line.split(',').slice(1).map(Number);
      if (p.length === 25) p = [...p.slice(0, 24), ...new Array(15).fill(0), p[24]];   // older firmware: 8 LEDs
      if (p.length !== N_LEDS * 3 + 1) return;
      if (performance.now() - ledSentAt > 500) { led = p; if (!colorShown) { colorShown = true; showAllColor(ledRgbRaw(4)); } refreshSide(); }
    } else if (line.startsWith('S,')) {
      const s = ints(line, 19); if (!s) return;
      if (wanted.settings) { if (s.join() !== wanted.settings.join()) return; wanted.settings = null; say('Settings saved in the controller.', 'var(--good)'); }
      if (!pending.settings) { settings = s; showSettings(s); }
    }
  };
  function onFrame(f) {
    const freshPress = f.phys & ~phys;
    phys = f.phys;
    if (freshPress && curPage === page0) { for (let b = 0; b < 21; b++) if (freshPress & (1 << b)) { if (pinOf(b) >= 0) select(b); break; } }   // pressing a button selects it
    view.setRaw(f.rawAx, f.rawAy);
    view.active = f.step >= 0 && f.stick === 0;
    view.aim = NaN; view.aimCenter = false;
    if (view.active && f.step < 32) { const e = CAL_ORDER[f.step]; if (!(e & 1)) view.aimCenter = true; else if ((e >> 1) % 2 === 0) view.aim = (e >> 1) * 22.5; }
    view.outX = (f.ax - 127) / 100; view.outY = (f.ay - 127) / 100;
    // while calibrating, the C-stick's output is the target
    view.hasTarget = view.active; view.tx = (f.cx - 127) / 100; view.ty = (f.cy - 127) / 100;
    if (f.step < 0) { stepLbl.textContent = f.locked ? 'Locked' : 'Ready'; stepLbl.classList.toggle('ok', !f.locked); prog.firstChild.style.width = '0%'; }
    else { stepLbl.textContent = 'Step ' + (f.step + 1) + ' of 44' + (f.step >= 32 ? ': notch adjustment' : ''); stepLbl.classList.remove('ok'); prog.firstChild.style.width = (Math.min(f.step, 44) / 44 * 100) + '%'; }
    instr.textContent = instruction(f);
    const names = BTN_NAMES.filter((_, i) => f.buttons & (1 << i));
    seen.textContent = 'Buttons: ' + (names.length ? names.join(', ') : '-');
    invOther = f.inv & 12;
    if (wanted.inv >= 0 && f.inv === wanted.inv) { wanted.inv = -1; say('Axis flip saved in the controller. No need to recalibrate.', 'var(--good)'); view.reset(true); }
    else if (wanted.inv < 0 && pending.inv < 0) { flips[0].checked = (f.inv & 1) !== 0; flips[1].checked = (f.inv & 2) !== 0; }
    if (f.saveState === 2) say('Warning: the controller couldn\'t save its settings.', 'var(--bad)');
    // ask for what we don't know yet; resend what wasn't confirmed
    const now = performance.now();
    if (!led && now - asked.led > 1000) { asked.led = now; dev.send('L'); }
    if (!map && !wanted.map && now - asked.map > 1000) { asked.map = now; dev.send('M'); }
    if (!settings && !wanted.settings && now - asked.settings > 1000) { asked.settings = now; dev.send('S'); }
    if ((wanted.map || wanted.settings || wanted.inv >= 0) && now - wanted.at > 800) {
      if (wanted.tries++ < 5) { wanted.at = now; if (wanted.map) dev.send('N ' + wanted.map.join(' ')); if (wanted.settings) dev.send('S ' + wanted.settings.join(' ')); if (wanted.inv >= 0) dev.send('I ' + wanted.inv); }
      else { wanted.map = wanted.settings = null; wanted.inv = -1; say('The controller did not accept the changes. Try Save again.', 'var(--bad)'); btnSave.disabled = false; }
    }
  }
  // virtual buttons: the macro steps and the held buttons, sent every 60 ms (the firmware releases them after 1 s of silence)
  const keep = setInterval(() => {
    if (!alive) return clearInterval(keep);
    const now = performance.now();
    if (now >= macroUntil) { const s = macro.shift(); if (s) { macroMask = s[0]; macroUntil = now + s[1]; } else macroMask = 0; }
    dev.send('B ' + (macroMask | holdMask));
  }, 60);
  const loop = () => { if (!alive) return; if (curPage === page1) view.paint(); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  dev.onLost = () => { if (alive) { alive = false; shell.lost('Lost the connection to the PadBox.'); } };

  return { stop() { alive = false; clearInterval(keep); clearInterval(drawTick); }, dirty: isDirty };
}
