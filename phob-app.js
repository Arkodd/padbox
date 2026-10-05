// The PhobGCC PadBox Calibrator in the new design, for the PadBox GS Platform (Figma "PadBox GS Platform", the PhobGCC
// flow) - the same frame, drawing and panels as gp-app.js and hoja-app.js, with PhobGCC's settings (it started as a
// copy of js/phob/app.js): CONTROLLER (what each button does as a GameCube button, LED colors), STICKS (PhobGCC's own
// step-by-step notch calibration, driven through virtual button presses), SETTINGS (stick response) and BACKUP &
// RESTORE. The button map, the settings and the axis flips wait for Save; LED colors apply (and save) right away.
// Not in this firmware, so not here (the design has them): a port / mode menu, LED effects, idle glow, animation time,
// a "when pressed" color, switching the stick off, and restarting as a controller.

import { el, pickColor, hex, clamp, confirmBox } from './js/ui.js';
import { firmwareUpdate } from './js/update.js';
import { buildDrawing } from './drawing.js';
import { dicon } from './icons.js';
import { panel, dtoggle, dslider, pbtn, segmented, badge, readout, backupPage, toast } from './parts.js';

const BA = 1, BB = 2, BX = 4, BY = 8, BZ = 16, BL = 32, BR = 64, BS = 128;
const CAL_ORDER = [0, 1, 8, 9, 16, 17, 24, 25, 4, 5, 12, 13, 20, 21, 28, 29, 2, 3, 6, 7, 10, 11, 14, 15, 18, 19, 22, 23, 26, 27, 30, 31];
const ADJ_ORDER = [2, 6, 10, 14, 1, 3, 5, 7, 9, 11, 13, 15];
const OUTPUTS = ['A', 'B', 'X', 'Y', 'Z', 'L', 'R', 'Start', 'D-pad Up', 'D-pad Down', 'D-pad Left', 'D-pad Right', '(nothing)'];
const OUT_SHORT = ['A', 'B', 'X', 'Y', 'Z', 'L', 'R', 'Start', 'Up', 'Down', 'Left', 'Right'];   // Up..Right are drawn as arrows
const C_UP = 100, C_DOWN = 101, C_LEFT = 102, C_RIGHT = 103;   // the C-stick buttons: not in the firmware's input table
const C_NAME = { [C_UP]: 'C-stick up', [C_DOWN]: 'C-stick down', [C_LEFT]: 'C-stick left', [C_RIGHT]: 'C-stick right' };
const C_SHORT = { [C_UP]: 'C-U', [C_DOWN]: 'C-D', [C_LEFT]: 'C-L', [C_RIGHT]: 'C-R' };

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
  let alive = true, frame = null, map = null, led = null, settings = null, settings0 = null;
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
  // Disconnect: the power button (PhobGCC works as a controller again once it's unplugged and plugged back in)
  const btnPower = iconBtn('light', 'power', 'Disconnect', async () => {
    if (isDirty() && !await confirmBox('Unsaved changes', 'Your button map, settings or axis flips aren\'t saved yet: they\'ll be lost. Disconnect anyway?', 'DISCONNECT')) return;
    shell.lost(null);
  });
  shell.actions([btnUpdate, btnSave, btnPower]);
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
    if ((b === 13 || (b >= 16 && b <= 19)) && o === DEF[b]) return '';   // the D-pad and the bumper doing what they're for: no label
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
  const ledBlock = el('div.led-block', {}, [
    el('div.lbl', { text: 'LED color' }),
    el('div.two.one', {}, [ledFieldBtn]),
    el('div.noled-note', { text: 'This button has no LED' }),
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
    el('p.hint', { html: 'Click <b>Save</b> to apply your changes to the controller' }),
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
  const column = el('div.side-col', {}, [empty, settingsPanel, ledPanel]);
  const page0 = el('div.page.controller', {}, [drawing.svg, column]);

  let ledTimer = 0, ledSentAt = 0;
  function sendLed() { refreshSide(); clearTimeout(ledTimer); ledTimer = setTimeout(() => { ledSentAt = performance.now(); dev.send('L ' + led.join(' ')); }, 60); }
  function setMap(m) { map = m; pending.map = m.slice(); staged(); refreshSide(); }
  function select(b) { if (b == null) return; sel = b; refreshSide(); }
  function refreshSide() {
    const none = sel < 0;
    empty.classList.toggle('hidden', !none); settingsPanel.classList.toggle('hidden', none);
    column.classList.toggle('selected', !none); page0.classList.toggle('selected', !none);
    if (!none) {
      const m = curMap(), isC = sel >= C_UP;
      if (isC) { if (!fnC.parentNode) fn.append(fnC); fn.value = '99'; }
      else { fnC.remove(); fn.value = String(m[sel] >= 0 && m[sel] <= 12 ? m[sel] : 12); }
      fn.disabled = isC || !map;
      amount.value = !isC && m[21 + sel] >= 1 && m[21 + sel] <= 100 ? m[21 + sel] : 100;
      amount.disabled = isC || !map || !(m[sel] === 5 || m[sel] === 6);   // the % only means something as L or R
      const li = ledOf(sel);
      ledBlock.classList.toggle('noled', li < 0);
      if (li >= 0) { const c = ledRgbRaw(li); ledDot.style.background = hex(c); ledTxt.textContent = hex(c).toUpperCase(); }
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
  }, 30);

  // ---------------------------------------------------------------- STICKS page
  // The GS Platform design: one wide panel - the gate on the left (output, raw reading, PhobGCC's target as a yellow
  // cross) with Set center under it; on the right the axes, the gate's shape, the calibration's current step (GETTING
  // READY, CAPTURE THE CROSS, LINE THE NOTCH UP WITH YOUR GATE) with its buttons, and Calibrate.
  const view = makeView();
  view.octagon = true;   // octagonal by default, like a GameCube stick's gate
  const gateSeg = segmented(['Round Gate', 'Octagonal Gate'], v => { view.octagon = v === 1; });
  gateSeg.value = 1;
  // flips: bit 0 left X, 1 left Y ("I <mask>", saved in the controller, no need to recalibrate)
  const flips = [dtoggle('Flip X axis', flipChanged), dtoggle('Flip Y axis', flipChanged)];
  let invOther = 0;   // the C-stick's flip bits, kept as they are
  function flipChanged() { pending.inv = invOther | (flips[0].checked ? 1 : 0) | (flips[1].checked ? 2 : 0); staged(); }
  const tag = badge(); tag.el.classList.add('hidden');   // shown once a calibration starts here (the firmware doesn't say)
  const rd1 = el('div.rd1');
  const legend = el('div.rd2.legend', { html: '<i class="lg-dot"></i>Output<i class="lg-ring"></i>Raw<b class="lg-x">✕</b>Target' });
  const setCenter = pbtn('Set center', 'target', true, () => view.reset(true));
  setCenter.classList.add('angle');
  // the current step: its title, what to do, how it's going, and its buttons
  const macroBtn = (text, key, steps, primary) => { const b = pbtn(text, '', primary, () => { macro = steps.slice(); macroUntil = 0; }); if (key) b.prepend(el('i.key', { text: key })); return b; };
  const holdBtn = (cls, title, m) => { const b = el('button.hold.' + cls, { type: 'button', title, html: dicon(cls === 'ccw' ? 'minus' : 'plus') }); b.addEventListener('pointerdown', () => { holdMask |= m; }); for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => { holdMask &= ~m; }); return b; };
  const stepT = el('div.cal-t'), stepD = el('div.cal-d'), stepS = el('div.cal-s'), prog = el('div.phob-prog', {}, [el('i')]);
  const bUndo = macroBtn('Undo', 'Z', [[BZ, 200]], false), bSkip = macroBtn('Skip', 'START', [[BS, 200]], false), bAdv = macroBtn('Advance', 'A', [[BA, 200]], true);
  const angleRow = el('div.angle-off', {}, [holdBtn('ccw', 'Rotate counter-clockwise (hold)', BY), el('span', { text: 'Angle offset' }), holdBtn('cw', 'Rotate clockwise (hold)', BX)]);
  const calBox = el('div.cal-box.hidden', {}, [el('div.cal-head', {}, [stepT, angleRow]), stepD, stepS, prog, el('div.btnrow.cal-btns', {}, [bUndo, bSkip, bAdv])]);
  const bCal = pbtn('Calibrate', 'target', true, () => {
    if (!frame || frame.step >= 0) return;
    // a locked controller (PhobGCC's safe mode) is unlocked first: A+X+Y+Start held, then A+X+Y+L starts the calibration
    macro = frame.locked ? [[BA | BX | BY | BS, 1300], [0, 2200], [BA | BX | BY | BL, 300]] : [[BA | BX | BY | BL, 300]];
    macroUntil = 0; cal.starting = performance.now() + (frame.locked ? 3800 : 300);
  });
  bCal.title = 'PhobGCC\'s own step-by-step calibration: 16 notches, then fine-tuning each notch\'s angle';
  const stickPanel = panel('STICK', [el('div.phob-body', {}, [
    el('div.phob-left', {}, [el('div.gate-wrap', {}, [view.canvas]), el('div.rd', {}, [rd1, legend]), el('div.angle-row', {}, [setCenter]),
      el('p.angle-hint', { text: 'Let go of the stick, then click Set center if the stick reads off-center or the plot is cluttered' })]),
    el('div.phob-right', {}, [el('div.two.flips', {}, [flips[0].el, flips[1].el]), gateSeg.el, calBox, el('div.btnrow.cal-main', {}, [bCal])]),
  ])], 'phob-wide');
  stickPanel.firstChild.append(tag.el);
  const page1 = el('div.page.hidden.dpage.phobsticks', {}, [stickPanel]);
  const cal = { starting: 0, was: -1 };

  function makeView() {
    const canvas = el('canvas.gate.phob-gate-cv');
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
    // the gate in the design's look: a grey ring, the gate's shape in orange, spokes, a soft orange middle; the trace in
    // blue, the raw reading as a light ring, the output as an orange dot, PhobGCC's target as a yellow cross
    v.paint = () => {
      const r = canvas.getBoundingClientRect(), z = zoomOf(), dpr = (window.devicePixelRatio || 1) * z;
      const W = r.width / z; if (W < 10) return;
      if (canvas.width !== Math.round(W * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(W * dpr); }
      const g = canvas.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, W);
      const c = W / 2, R = W / 2 - 10;
      const shape = (rad, oct) => { g.beginPath(); if (!oct) g.arc(c, c, rad, 0, Math.PI * 2); else { for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; g[i ? 'lineTo' : 'moveTo'](c + rad * Math.cos(a), c - rad * Math.sin(a)); } g.closePath(); } };
      const grad = g.createRadialGradient(c, c, 0, c, c, R * 0.5);
      grad.addColorStop(0, 'rgba(254,104,5,.2)'); grad.addColorStop(1, 'rgba(254,104,5,.04)');
      g.fillStyle = grad; g.beginPath(); g.arc(c, c, R * 0.5, 0, Math.PI * 2); g.fill();
      g.lineWidth = 1; g.strokeStyle = '#4f4f4f';
      for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; g.beginPath(); g.moveTo(c, c); g.lineTo(c + Math.cos(a) * R, c - Math.sin(a) * R); g.stroke(); }
      g.beginPath(); g.arc(c, c, R * 0.5, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = '#7a7a7a'; shape(R, false); g.stroke();
      g.lineWidth = 1.3; g.lineJoin = 'round'; g.strokeStyle = '#fe6805'; shape(view.octagon ? R : R - 1.5, view.octagon); g.stroke();
      if (v.active && !isNaN(v.aim)) { const a = v.aim * Math.PI / 180; g.setLineDash([4, 4]); g.lineWidth = 1; g.strokeStyle = 'rgba(255,210,60,.6)'; g.beginPath(); g.moveTo(c, c); g.lineTo(c + Math.cos(a) * R, c - Math.sin(a) * R); g.stroke(); g.setLineDash([]); }
      g.fillStyle = 'rgba(40,166,255,.5)';
      for (const [x, y] of v.trail) g.fillRect(c + x / v.range * R - 1, c - y / v.range * R - 1, 2, 2);
      if (!isNaN(v.cx)) { g.beginPath(); g.arc(c + (v.rawX - v.cx) / v.range * R, c - (v.rawY - v.cy) / v.range * R, 6, 0, Math.PI * 2); g.lineWidth = 1; g.strokeStyle = '#e6e6e6'; g.stroke(); }
      g.beginPath(); g.arc(c + clamp(v.outX, -1.2, 1.2) * R, c - clamp(v.outY, -1.2, 1.2) * R, 4, 0, Math.PI * 2); g.fillStyle = '#fe6805'; g.fill();
      // the target: where PhobGCC wants the stick for this step (it shows it on the C-stick's output while calibrating)
      if (v.hasTarget) {
        const tx = c + v.tx * R, ty = c - v.ty * R; g.lineWidth = 1.8; g.lineCap = 'round'; g.strokeStyle = '#ffd23c';
        g.beginPath(); g.moveTo(tx - 4.5, ty - 4.5); g.lineTo(tx + 4.5, ty + 4.5); g.moveTo(tx - 4.5, ty + 4.5); g.lineTo(tx + 4.5, ty - 4.5); g.stroke(); g.lineCap = 'butt';
      }
    };
    return v;
  }
  function notchName(n) { return { 0: 'right', 2: 'up-right', 4: 'up', 6: 'up-left', 8: 'left', 10: 'down-left', 12: 'down', 14: 'down-right' }[n] || 'in-between'; }
  // the calibration box, from each frame: getting ready, the 32 capture steps (16 notches, each centre then edge), the
  // 12 notch adjustments, saving
  function showStep(f) {
    const now = performance.now();
    const ready = f.step < 0 && cal.starting && now < cal.starting + 4000;   // clicked Calibrate, the firmware hasn't started yet
    const on = f.step >= 0 || ready;
    calBox.classList.toggle('hidden', !on); bCal.disabled = on;
    if (f.step >= 0) cal.starting = 0;
    if (on) { tag.el.classList.remove('hidden'); tag.set('busy'); }
    if (cal.was >= 0 && f.step < 0) { tag.set('ok'); toast('Calibration complete', 'Your stick is calibrated and saved in the controller.'); view.reset(true); }
    cal.was = f.step;
    if (!on) return;
    let title, text, sub = '', p = 0, buttons = [bUndo, bAdv], angle = false;
    if (ready) {
      title = 'GETTING READY'; text = 'Let go of the stick';
      sub = f.locked ? 'Unlocking the controller...' : 'Reading the resting center...';
      buttons = [];
    } else if (f.step < 32) {
      const e = CAL_ORDER[f.step], notch = e >> 1, n = (f.step >> 1) + 1;
      title = 'CAPTURE THE CROSS (' + n + '/16)'; p = f.step / 44;
      if (!(e & 1)) text = 'Let go of the stick so it rests in the middle, then press Advance (A)';
      else if (notch % 2 === 0) text = 'Push the stick to the yellow cross (the ' + notchName(notch) + ' notch) then press Advance (A)';
      else text = 'In-between notch: if your gate has none here, leave the stick in the middle, then press Advance (A)';
      if (view.active && !isNaN(view.aim)) { let err = view.ang - view.aim; while (err > 180) err -= 360; while (err < -180) err += 360; sub = `aim ${Math.round(view.aim)}°   now ${Math.round(view.ang)}° (${err >= 0 ? '+' : ''}${Math.round(err)}°)   ${Math.round(view.pct)}% out`; }
      else if (view.active && view.aimCenter) sub = `now ${Math.round(view.pct)}% out of the middle`;
    } else if (f.step - 32 < ADJ_ORDER.length) {
      const i = f.step - 32;
      title = 'LINE THE NOTCH UP WITH YOUR GATE (' + (i + 1) + '/' + ADJ_ORDER.length + ')'; p = f.step / 44;
      text = 'Rotate the ' + notchName(ADJ_ORDER[i]) + ' notch\'s angle with the − / + buttons (hold), then press Advance (A)';
      buttons = [bUndo, bSkip, bAdv]; angle = true;
    } else { title = 'SAVING'; text = 'Finishing and saving the calibration...'; buttons = []; p = 1; }
    stepT.textContent = title; stepD.textContent = text; stepS.textContent = sub;
    prog.firstChild.style.width = (p * 100) + '%'; prog.classList.toggle('hidden', ready);
    angleRow.classList.toggle('hidden', !angle);
    for (const b of [bUndo, bSkip, bAdv]) b.classList.toggle('hidden', !buttons.includes(b));
  }

  // ---------------------------------------------------------------- SETTINGS page (the left stick's: the C-stick is buttons)
  // the 19 values of the "S" command, in setStickSettingsFromText's order (see the desktop app's SettingsPanel); two
  // cards in the design's style, each with Reset (back to the values read when connecting) and Save
  const vals = new Array(19).fill(0);
  let setTimer = 0;
  const sChanged = () => { clearTimeout(setTimer); setTimer = setTimeout(() => { pending.settings = vals.slice(); staged(); }, 200); };
  const signed = x => x > 0 ? '+' + x : String(x), plain = x => String(x), pctF = x => x + '%';
  const SL = (cap, min, max, f, idx, tip) => { const s = dslider(cap, min, max, f, v => { vals[idx] = v; sChanged(); }); s.idx = idx; if (tip) s.el.title = tip; return s; };
  const sliders = [
    SL('Snapback X', -10, 10, signed, 4, 'Less snapback when you let the stick go'), SL('Snapback Y', -10, 10, signed, 5, 'Less snapback when you let the stick go'),
    SL('Smoothing X', 0, 18, plain, 6, 'Higher = smoother but slower'), SL('Smoothing Y', 0, 18, plain, 7, 'Higher = smoother but slower'),
    SL('Waveshaping X', -24, 24, signed, 10, 'The stick\'s response during fast movement'), SL('Waveshaping Y', -24, 24, signed, 11, 'The stick\'s response during fast movement'),
    SL('Cardinal snapping', -2, 6, signed, 0, 'Snaps near-cardinal inputs to true up / down / left / right'), SL('Analog scaler', 90, 110, pctF, 2, 'The output at the gate edge, as a percent of the calibrated size'),
  ];
  const resetSet = list => { if (!settings0) return; for (const s of list) { vals[s.idx] = settings0[s.idx]; s.value = vals[s.idx]; } sChanged(); };
  const card = (title, list, note) => panel(title, [...list.map(s => s.el), el('p.hint.wrap', { text: note }),
    el('div.btnrow.bottom', {}, [pbtn('Reset', 'sync', false, () => resetSet(list)), pbtn('Save', 'check', true, () => { clearTimeout(setTimer); pending.settings = vals.slice(); saveAll(); })])], 'stretch');
  const page2 = el('div.page.hidden.dpage.settings', {}, [
    card('STICK RESPONSE', sliders.slice(0, 4), 'Snapback: less bounce when you let the stick go. Smoothing: higher is smoother but slower.'),
    card('STICK SHAPING', sliders.slice(4), 'Waveshaping: the response during fast movement. Cardinal snapping: near-cardinal inputs snap to the axis.'),
  ]);
  function showSettings(v) { for (let i = 0; i < 19; i++) vals[i] = v[i]; for (const s of sliders) s.value = vals[s.idx]; }

  // ---------------------------------------------------------------- BACKUP & RESTORE (parts.js): the button map, the LED colors,
  // the stick settings and the axis flips. The stick calibration stays in the controller: PhobGCC doesn't send it.
  const backup = backupPage({
    controller: 'PhobGCC', board: boardName, firmware: '', mode: () => 'GameCube',
    exportData: async () => {
      if (!map || !led || !settings || !frame) throw new Error('the controller hasn\'t sent all its settings yet. Wait a second and try again');
      return { format: 'padbox-phob-backup', version: 1, board: boardName, created: new Date().toISOString(),
        map: (pending.map || map).slice(), led: led.slice(), settings: (pending.settings || vals).slice(), inv: pending.inv >= 0 ? pending.inv : frame.inv & 15 };
    },
    fileName: name => 'PadBox GS Platform - PhobGCC - ' + name.replace(/[\\/:*?"<>|]/g, '_') + '.json',
    check: d => !d || d.format !== 'padbox-phob-backup' ? 'This file isn\'t a PhobGCC configuration file. GP2040-CE and HOJA2 files only go back onto those firmwares.'
      : d.board !== boardName ? 'This configuration is from a PadBox ' + d.board + ', not a PadBox ' + boardName + '.'
      : !Array.isArray(d.map) || d.map.length !== 42 || !Array.isArray(d.led) || d.led.length !== N_LEDS * 3 + 1 || !Array.isArray(d.settings) || d.settings.length !== 19 ? 'This configuration is incomplete or damaged.'
      : frame && frame.step >= 0 ? 'Finish the stick calibration first.' : '',
    restore: async d => {
      led = d.led.slice(); sendLed(); showAllColor(ledRgbRaw(4));
      map = d.map.slice(); pending.map = map.slice();
      showSettings(d.settings); pending.settings = d.settings.slice();
      pending.inv = (invOther & 12) | (d.inv & 3);
      refreshSide(); await saveAll();
      return 'Restored and saved in the controller. The stick calibration isn\'t part of a backup: it stays as it is.';
    },
  });
  const page3 = backup.page;

  // ---------------------------------------------------------------- the side menu, lines from the controller, timers
  const pages = [page0, page1, page2, page3];
  shell.content(el('div', { style: { position: 'absolute', inset: 0 } }, pages));
  let curPage = page0;
  shell.tabs(['CONTROLLER', 'STICKS', 'SETTINGS', 'BACKUP & RESTORE'], i => { curPage = pages[i]; pages.forEach((p, k) => p.classList.toggle('hidden', k !== i)); },
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
      if (!settings0) settings0 = s.slice();
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
    if (curPage === page1) { const r = readout(view.outX, view.outY); rd1.textContent = r.xy + (r.angle ? '     ' + r.angle : ''); }
    showStep(f);
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
