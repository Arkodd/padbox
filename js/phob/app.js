// The PhobGCC PadBox Calibrator, in the browser - the desktop Phob Calibrator's pages for the PadBox GS Platform:
// CALIBRATION (PhobGCC's own step-by-step stick calibration, driven through virtual button presses), CONTROLLER
// (the drawing, what each button does as a GameCube button, LED colors) and SETTINGS (stick response).
// The button map, the settings and the axis flips wait for SAVE; LED colors apply (and save) right away.

import { el, icon, button, card, toggle, slider, combo, setItems, swatchRow, pickColor, hex, readable, image, clamp, sleep, setButtonText } from '../ui.js';
import { firmwareUpdate } from '../update.js';

const BA = 1, BB = 2, BX = 4, BY = 8, BZ = 16, BL = 32, BR = 64, BS = 128;
const CAL_ORDER = [0, 1, 8, 9, 16, 17, 24, 25, 4, 5, 12, 13, 20, 21, 28, 29, 2, 3, 6, 7, 10, 11, 14, 15, 18, 19, 22, 23, 26, 27, 30, 31];
const ADJ_ORDER = [2, 6, 10, 14, 1, 3, 5, 7, 9, 11, 13, 15];
const BTN_NAMES = ['A (1K)', 'B (2K)', 'X (1P)', 'Y (2P)', 'Z (3P)', 'L (4K)', 'R (3K)', 'Start', 'Up', 'Down', 'Left', 'Right'];
const OUTPUTS = ['A', 'B', 'X', 'Y', 'Z', 'L', 'R', 'Start', 'D-pad Up', 'D-pad Down', 'D-pad Left', 'D-pad Right', '(nothing)'];
const OUT_SHORT = ['A', 'B', 'X', 'Y', 'Z', 'L', 'R', 'St', 'Up', 'Dn', 'Lt', 'Rt'];
const C_UP = 100, C_DOWN = 101, C_LEFT = 102, C_RIGHT = 103;   // the C-stick buttons: not in the firmware's input table
const TRIG = 20;                                                // the analog trigger's slot in the input table
const PRESETS = [0x0000ff, 0xff0000, 0x00ff00, 0xffffff, 0xff6800, 0x9600ff, 0x000000];

// ------------------------------------------------------------------ the boards (the desktop app's PhobBoard, MapPanel and VisualPanel)
function gsPill(cx, cy) {
  const len = 35.5, wid = 22.7, a = -57.5 * Math.PI / 180, ux = Math.cos(a), uy = Math.sin(a), r = wid / 2, half = len / 2 - r, p = [];
  for (let end = 0; end < 2; end++) {
    const ex = cx + (end === 0 ? half : -half) * ux, ey = cy + (end === 0 ? half : -half) * uy;
    for (let i = 0; i <= 12; i++) { const t = a + (end === 0 ? -Math.PI / 2 : Math.PI / 2) + Math.PI * i / 12; p.push([ex + r * Math.cos(t), ey + r * Math.sin(t)]); }
  }
  return p;
}
const GS_TAB = [[227, 86], [227, 77], [230, 74], [238, 69], [246, 65], [254, 62], [262, 60], [270, 58.5], [278, 57], [286, 56.5], [294, 56], [302, 56.5], [310, 56.5], [318, 57.5], [326, 59], [334, 60.5], [342, 63], [343, 73.5], [334, 73.5], [310, 74.5], [286, 75.5], [262, 78.5], [246, 81], [230, 85.5]].map(([x, y]) => [x + 4, y + 4]);
const S = (name, bit, x, y, r, label = true) => ({ name, bit, x, y, rx: r, ry: r, kind: 0, label });
const P = (name, bit, pts) => { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const [x, y] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } return { name, bit, kind: 2, poly: pts, x: (x0 + x1) / 2, y: (y0 + y1) / 2, rx: (x1 - x0) / 2, ry: (y1 - y0) / 2 }; };
const dpad = (x, y, r) => [['D-pad Up', 16, 225], ['D-pad Right', 19, 315], ['D-pad Down', 17, 45], ['D-pad Left', 18, 135]].map(([name, bit, a0]) => ({ name, bit, x, y, rx: r, ry: r, kind: 1, a0 }));
const BOARDS = {
  'GS Platform': {
    image: 'assets/gs_platform_trace.png', gs: true, digitalC: true, trigger: false, rumble: false, plusHalf: 25.5, leds: 13,
    spots: [
      S('1P', 0, 795, 349, 78), S('2P', 1, 958, 275, 78), S('3P', 2, 1137, 275, 78), S('4P', 3, 1310, 324, 78),
      S('1K', 4, 815, 528, 78), S('2K', 5, 977, 454, 78), S('3K', 6, 1157, 454, 78), S('4K', 7, 1330, 503, 78),
      P('Start', 8, gsPill(552.4, 147.3)), P('Select', 9, gsPill(613.2, 147.2)), P('Home', 10, gsPill(674.0, 147.2)), P('Touchpad', 11, gsPill(734.6, 147.2)),
      P('Bumper', 13, GS_TAB), S('A button', 12, 760, 873, 78), ...dpad(429, 391, 82),
      S('C-U', C_UP, 697, 706, 78), S('C-R', C_RIGHT, 865, 738, 78), S('C-L', C_LEFT, 579, 835, 78), S('C-D', C_DOWN, 641, 1002, 78),
    ],
    sticks: [{ x: 244, y: 262, r: 56, click: -1 }],
    inputs: ['1P', '2P', '3P (RB)', '4P (LB)', '1K', '2K', '3K (RT)', '4K (LT)', 'Start', 'Select', 'Home', 'Touchpad', 'A button', 'Bumper', '(not used)', '(not used)', 'D-pad Up', 'D-pad Down', 'D-pad Left', 'D-pad Right', '(no analog trigger)'],
    // the HOJA2 GameCube layout: 1P=R 2P=Y 3P=R 10% 4P=R 50%, 1K=B 2K=X 3K=Z 4K=nothing, "A" button = A, Bumper = L
    def: [6, 3, 6, 6, 1, 2, 4, 12, 7, 12, 12, 12, 0, 5, 12, 12, 8, 9, 10, 11, 12, 100, 100, 10, 50, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 27],
    // the LED chain: 4K 3K 2K 1K 1P 2P 3P 4P, then the "A" button, C-down, C-left, C-up, C-right
    ledOf: b => b >= 0 && b < 8 ? [4, 5, 6, 7, 3, 2, 1, 0][b] : b === 12 ? 8 : b === C_DOWN ? 9 : b === C_LEFT ? 10 : b === C_UP ? 11 : b === C_RIGHT ? 12 : -1,
    ledNote: 'The 8 face-button LEDs are under 4K 3K 2K 1K 1P 2P 3P 4P (LEDs 1-8); LED 9 is under the A button and LEDs 10-13 under C-down, C-left, C-up and C-right.',
  },
};

const whichBoard = async () => 'GS Platform';

export async function startPhob(shell, dev, opts) {
  let alive = true, frame = null, map = null, led = null, settings = null;
  let macro = [], macroMask = 0, macroUntil = 0, holdMask = 0;
  const pending = { map: null, settings: null, inv: -1 };   // staged until SAVE
  const wanted = { map: null, settings: null, inv: -1, at: 0, tries: 0 };
  let asked = { map: 0, led: 0, settings: 0 };

  shell.footer('Waiting for the controller...');
  const boardName = await whichBoard(dev), BD = BOARDS[boardName], SPOTS = BD.spots, N_LEDS = BD.leds;
  shell.header('PhobGCC PadBox Calibrator', 'PadBox ' + boardName + '  •  GameCube stick calibration' + (opts.demo ? '  •  demo' : ''));
  shell.status(true);
  const say = (t, c) => { shell.footer(t); document.getElementById('footer').style.color = c || ''; };
  say('Waiting for the controller...');

  const btnSave = button('SAVE', { primary: true, disabled: true, onclick: saveAll });
  const btnUpdate = button('UPDATE FIRMWARE', { onclick: () => firmwareUpdate({ board: boardName, current: 'PhobGCC', enter: async () => { await saveAll(); await sleep(300); alive = false; await dev.send('BOOTSEL'); await sleep(3500); } }) });
  shell.actions([btnUpdate, btnSave]);
  function staged() { btnSave.disabled = false; say('Unsaved changes - click SAVE to send them to the controller.', 'var(--warn)'); }
  async function saveAll() {
    btnSave.disabled = true;
    if (pending.map) { wanted.map = pending.map; pending.map = null; await dev.send('N ' + wanted.map.join(' ')); }
    if (pending.settings) { wanted.settings = pending.settings; pending.settings = null; await dev.send('S ' + wanted.settings.join(' ')); }
    if (pending.inv >= 0) { wanted.inv = pending.inv; pending.inv = -1; await dev.send('I ' + wanted.inv); }
    wanted.at = performance.now(); wanted.tries = 1;
    say('Saving...', 'var(--warn)');
  }

  // ---------------------------------------------------------------- CALIBRATION page
  const views = [makeView('LEFT stick (main)', true), makeView(BD.digitalC ? 'C-stick (four buttons)' : 'RIGHT stick (C-stick)', !BD.digitalC)];
  const octL = toggle('Octagon gate', v => { views[0].octagon = v; }); octL.checked = true;
  // flips: bit 0 left X, 1 left Y, 2 right X, 3 right Y ("I <mask>", saved in the controller, no need to recalibrate)
  const flips = [toggle('Flip X axis', flipChanged), toggle('Flip Y axis', flipChanged), toggle('Flip X axis', flipChanged), toggle('Flip Y axis', flipChanged)];
  const clearL = button('Clear trace / set centre', { icon: '', onclick: () => views[0].reset(true) });
  const clearR = button('Clear trace / set centre', { icon: '', onclick: () => views[1].reset(true) });
  const colL = el('div.card', { style: { display: 'flex', flexDirection: 'column', padding: '10px' } }, [views[0].canvas, el('div.row', { style: { marginTop: '6px' } }, [octL.el, flips[0].el, flips[1].el, el('div.grow'), clearL])]);
  const colR = el('div.card', { style: { display: 'flex', flexDirection: 'column', padding: '10px' } }, [views[1].canvas, el('div.row', { style: { marginTop: '6px' } }, [flips[2].el, flips[3].el, el('div.grow'), BD.digitalC ? null : clearR])]);
  function flipChanged() { pending.inv = flips.reduce((m, f, i) => m | (f.checked ? 1 << i : 0), 0); staged(); }

  const stepLbl = el('div', { style: { fontSize: '19px', fontWeight: 600 } });
  const prog = el('div.bar-meter', {}, [el('i')]);
  const instr = el('div.card', { style: { minHeight: '104px', fontSize: '14px', color: '#fff', padding: '12px 14px' } });
  const macroBtn = (text, steps, primary) => button(text, { primary, icon: text.startsWith('CALIBRATE') ? 'target' : text.startsWith('UNDO') || text.startsWith('RESET') ? 'reset' : '', onclick: () => { macro = steps.slice(); macroUntil = 0; } });
  const holdBtn = (text, m) => { const b = button(text, { icon: '' }); b.addEventListener('pointerdown', () => { holdMask |= m; }); for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => { holdMask &= ~m; }); return b; };
  const section = t => el('div', { text: t, style: { color: 'var(--orange)', fontWeight: 600, margin: '12px 0 4px' } });
  const grid = (...b) => el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' } }, b);
  const calRight = macroBtn('CALIBRATE RIGHT', [[BA | BX | BY | BR, 300]], true); calRight.disabled = BD.digitalC;   // a C-stick of buttons has nothing to calibrate
  const seen = el('div', { style: { color: 'var(--soft)' } }), trigL = el('div', { style: { color: 'var(--soft)' } });
  if (!BD.trigger) trigL.classList.add('hidden');
  const info = el('div', { style: { width: '360px', flex: 'none', overflow: 'auto', padding: '4px 4px 10px' } }, [
    stepLbl, el('div', { style: { height: '8px' } }), prog, el('div', { style: { height: '10px' } }), instr,
    section('Start / stop'), grid(macroBtn('UNLOCK', [[BA | BX | BY | BS, 1300]]), macroBtn('LOCK', [[BA | BX | BY | BS, 250]]), macroBtn('CALIBRATE LEFT', [[BA | BX | BY | BL, 300]], true), calRight),
    section('During calibration'), grid(macroBtn('ADVANCE (A)', [[BA, 200]], true), macroBtn('UNDO (Z)', [[BZ, 200]]), holdBtn('ROTATE CW (X)', BX), holdBtn('ROTATE CCW (Y)', BY), macroBtn('RESET NOTCH (B)', [[BB, 200]]), macroBtn('SKIP (Start)', [[BS, 200]])),
    section('What the controller sees'), seen, trigL,
  ]);
  const page0 = el('div.page', { style: { display: 'flex', gap: '12px', padding: '12px' } }, [el('div', { style: { flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', minWidth: 0 } }, [colL, colR]), info]);

  function makeView(title, analog) {
    const canvas = el('canvas', { style: { width: '100%', flex: '1', minHeight: '300px', display: 'block' } });
    const v = { title, analog, canvas, octagon: title.startsWith('LEFT'), active: false, hideOut: false, outX: 0, outY: 0, hasTarget: false, tx: 0, ty: 0,
      aim: NaN, aimCenter: false, rawX: 0.5, rawY: 0.5, cx: NaN, cy: NaN, range: 0.05, trail: [], ang: 0, pct: 0 };
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
    v.paint = () => {
      const r = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
      if (r.width < 10) return;
      if (canvas.width !== Math.round(r.width * dpr) || canvas.height !== Math.round(r.height * dpr)) { canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr); }
      const g = canvas.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, r.width, r.height);
      const top = 30, cx = r.width / 2, cy = top + (r.height - top - 60) / 2, R = Math.min(r.width, r.height - top - 60) * 0.44;
      g.font = '600 14.5px Poppins'; g.fillStyle = v.active ? '#ff6800' : '#fff'; g.textAlign = 'left'; g.textBaseline = 'top';
      g.fillText(v.title + (v.active ? '  (calibrating)' : ''), 6, 4);
      g.lineWidth = 1; g.strokeStyle = '#2e2e2e'; g.beginPath(); g.moveTo(cx - R * 1.1, cy); g.lineTo(cx + R * 1.1, cy); g.moveTo(cx, cy - R * 1.1); g.lineTo(cx, cy + R * 1.1); g.stroke();
      g.lineWidth = 1.5; g.strokeStyle = '#545454'; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();
      if (v.octagon) { g.strokeStyle = 'rgba(255,104,0,.67)'; g.beginPath(); for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; g[i ? 'lineTo' : 'moveTo'](cx + R * Math.cos(a), cy - R * Math.sin(a)); } g.closePath(); g.stroke(); }
      for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4, ux = Math.cos(a), uy = -Math.sin(a);
        g.lineWidth = 1; g.strokeStyle = '#222'; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + ux * R, cy + uy * R); g.stroke();
        g.lineWidth = 2; g.strokeStyle = '#969696'; g.beginPath(); g.moveTo(cx + ux * R * 0.96, cy + uy * R * 0.96); g.lineTo(cx + ux * R * 1.06, cy + uy * R * 1.06); g.stroke();
      }
      if (v.active && !isNaN(v.aim)) { const a = v.aim * Math.PI / 180; g.setLineDash([6, 4]); g.lineWidth = 2; g.strokeStyle = '#ffd23c'; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * R * 1.08, cy - Math.sin(a) * R * 1.08); g.stroke(); g.setLineDash([]); }
      if (analog) {
        g.fillStyle = 'rgba(70,130,255,.47)';
        for (const [x, y] of v.trail) g.fillRect(cx + x / v.range * R - 1.5, cy - y / v.range * R - 1.5, 3, 3);
        if (!isNaN(v.cx)) { g.beginPath(); g.arc(cx + (v.rawX - v.cx) / v.range * R, cy - (v.rawY - v.cy) / v.range * R, 6, 0, Math.PI * 2); g.fillStyle = '#4682ff'; g.fill(); }
      }
      if (!v.hideOut) { g.beginPath(); g.arc(cx + v.outX * R, cy - v.outY * R, 9, 0, Math.PI * 2); g.lineWidth = 2.5; g.strokeStyle = '#46dc78'; g.stroke(); }
      if (v.hasTarget) {
        const tx = cx + v.tx * R, ty = cy - v.ty * R; g.lineWidth = 3; g.strokeStyle = '#ffd23c';
        g.beginPath(); g.moveTo(tx - 10, ty - 10); g.lineTo(tx + 10, ty + 10); g.moveTo(tx - 10, ty + 10); g.lineTo(tx + 10, ty - 10); g.stroke();
        g.font = '12px Poppins'; g.fillStyle = '#ffd23c'; g.fillText('target', tx > cx + R * 0.55 ? tx - 52 : tx + 10, ty - 8);
      }
      let txt = `stick now: ${Math.round(v.ang)}°   ${Math.round(v.pct)}% out`, col = '#c8c8c8';
      if (v.active && !isNaN(v.aim)) {
        let err = v.ang - v.aim; while (err > 180) err -= 360; while (err < -180) err += 360;
        txt = `aim ${Math.round(v.aim)}°   now ${Math.round(v.ang)}°   (${err >= 0 ? '+' : ''}${Math.round(err)}°)   ${Math.round(v.pct)}% out`;
        col = Math.abs(err) <= 3 && v.pct > 85 ? '#5ae682' : Math.abs(err) <= 8 ? '#ffc85a' : '#ff6e6e';
      } else if (v.active && v.aimCenter) { txt = `aim: CENTRE   now ${Math.round(v.pct)}% out`; col = v.pct <= 4 ? '#5ae682' : '#ffc85a'; }
      if (!analog) txt = 'the C-stick is four buttons: nothing to calibrate';
      g.font = '600 13px Poppins'; g.fillStyle = col; g.fillText(txt, 6, r.height - 56);
      g.font = '11.5px Poppins'; g.fillStyle = '#8a95a4';
      g.fillText('blue = raw sensor (gate trace)   green = calibrated output', 6, r.height - 34);
      g.fillText('yellow cross = where the stick should be (target)', 6, r.height - 18);
    };
    return v;
  }

  function notchName(n) { return { 0: 'RIGHT', 2: 'UP-RIGHT', 4: 'UP', 6: 'UP-LEFT', 8: 'LEFT', 10: 'DOWN-LEFT', 12: 'DOWN', 14: 'DOWN-RIGHT' }[n] || 'in-between notch ' + n; }
  function instruction(f) {
    if (f.step < 0) return f.locked ? 'LOCKED. Click UNLOCK (hands off the sticks), wait 2 seconds, then pick a stick to calibrate.'
      : BD.digitalC ? 'Ready. Click CALIBRATE LEFT, wait 2 seconds and keep the stick centred.' : 'Ready. Click CALIBRATE LEFT or RIGHT, wait 2 seconds and keep the stick centred.';
    const who = f.stick === 1 ? 'RIGHT' : 'LEFT', round = !views[f.stick === 1 ? 1 : 0].octagon;
    if (f.step < 32) {
      const e = CAL_ORDER[f.step], notch = e >> 1;
      if (!(e & 1)) return 'Let the ' + who + ' stick rest in the CENTRE and hold it still, then click ADVANCE.';
      if (notch % 2 === 0) return 'Push the ' + who + ' stick firmly into the ' + notchName(notch) + ' position and hold it still, then click ADVANCE.' + (round && notch % 4 ? ' Round gate: edge at 45 degrees, see the target.' : '');
      return 'In-between notch #' + notch + ': if your gate has none here, leave the stick in the CENTRE, then click ADVANCE.';
    }
    const i = f.step - 32;
    if (i < ADJ_ORDER.length) return 'Notch adjustment (' + notchName(ADJ_ORDER[i]) + '): hold ROTATE CW / CCW to nudge it, RESET NOTCH to undo, ADVANCE to accept.';
    return 'Finishing and saving...';
  }

  // ---------------------------------------------------------------- CONTROLLER page
  const canvas = el('canvas', { style: { width: '100%', height: '100%', display: 'block' } });
  const drawWrap = el('div.frame', { style: { position: 'absolute', left: '16px', right: '16px', top: '12px', bottom: BD.trigger ? '58px' : '40px' } }, [canvas]);
  const drawHint = el('div.hint', { text: 'Click a button to edit it. Buttons light up as you press them.', style: { position: 'absolute', left: '30px', bottom: '12px' } });
  let sel = -1, phys = 0;
  const selTitle = el('span', { text: 'Select a button' }), sub = el('p.hint', { style: { margin: '0 0 8px' } });
  const act = combo(OUTPUTS, () => { if (sel < 0 || !map) return; const m = map.slice(); m[sel] = act.selectedIndex; setMap(m); }); act.style.width = '100%';
  const pct = slider('Analog amount', 1, 100, v => v + '%', v => { if (sel < 0 || !map) return; const m = map.slice(); m[21 + sel] = v; setMap(m); });
  const pctHint = el('p.note');
  const ledBtn = el('button.colorbtn', { type: 'button', style: { width: '100%' }, on: { click: () => { const li = BD.ledOf(sel); if (li < 0 || !led) return; pickColor(ledRgbRaw(li), c => { led[li * 3] = (c >> 16) & 255; led[li * 3 + 1] = (c >> 8) & 255; led[li * 3 + 2] = c & 255; sendLed(); }); } } });
  const ledNone = el('p.note', { text: 'This button has no LED.' });
  const ledRow = el('div', {}, [el('div.caption', { text: 'LED color' }), ledBtn, ledNone]);
  const actRow = el('div', {}, [el('div.caption', { text: 'Acts as', style: { marginTop: 0 } }), act, el('div', { style: { height: '6px' } }), pct.el, pctHint]);
  const resetBtn = button('RESET BUTTON', { onclick: () => { if (sel < 0 || !map) return; const m = map.slice(); m[sel] = BD.def[sel]; m[21 + sel] = BD.def[21 + sel]; setMap(m); } });
  const resetAll = button('RESET ALL', { onclick: () => { if (map) setMap(BD.def.slice()); } });
  const selCard = el('div.card', {}, [el('h2', { html: icon('cursor') }, [selTitle]), sub, actRow, ledRow, el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '14px' } }, [resetBtn, resetAll])]);
  const bright = slider('Brightness', 0, 100, v => v + '%', v => { if (!led) return; led[N_LEDS * 3] = v; sendLed(); });
  const setAll = c => { if (!led) return; for (let i = 0; i < N_LEDS; i++) { led[i * 3] = (c >> 16) & 255; led[i * 3 + 1] = (c >> 8) & 255; led[i * 3 + 2] = c & 255; } sendLed(); };
  const ledCard = card('LEDs', 'bulb', [bright.el, el('div.caption', { text: 'Color all buttons' }), swatchRow(PRESETS, setAll, setAll),
    el('p.note', { text: BD.ledNote + ' In settings mode (after A+X+Y+Start) only LED 1 shows, red.' })]);
  const side = el('div', { style: { width: '340px', flex: 'none', padding: '12px 14px 14px 0', display: 'flex', flexDirection: 'column', gap: '12px', overflow: 'auto' } }, [selCard, ledCard]);
  const page1 = el('div.page.hidden', { style: { display: 'flex' } }, [el('div', { style: { position: 'relative', flex: 1, minWidth: 0 } }, [drawWrap, drawHint]), side]);
  const ledRgbRaw = i => led ? (led[i * 3] << 16) | (led[i * 3 + 1] << 8) | led[i * 3 + 2] : 0;
  const ledRgb = i => led ? Math.round(led[i * 3] * led[N_LEDS * 3] / 100) << 16 | Math.round(led[i * 3 + 1] * led[N_LEDS * 3] / 100) << 8 | Math.round(led[i * 3 + 2] * led[N_LEDS * 3] / 100) : 0x000000;
  let ledTimer = 0, ledSentAt = 0;
  function sendLed() { refreshSide(); clearTimeout(ledTimer); ledTimer = setTimeout(() => { ledSentAt = performance.now(); dev.send('L ' + led.join(' ')); }, 60); }
  function setMap(m) { map = m; pending.map = m.slice(); staged(); refreshSide(); }
  function refreshSide() {
    const has = !!map;
    if (sel < 0) { selTitle.textContent = 'Select a button'; sub.textContent = 'Click a button on the drawing, or press it on the controller.'; actRow.classList.add('hidden'); ledRow.classList.add('hidden'); }
    else {
      selTitle.textContent = sel >= C_UP ? SPOTS.find(s => s.bit === sel).name : BD.inputs[sel];
      sub.textContent = sel >= C_UP ? 'A C-stick button: it always pushes the C-stick, so it can\'t be remapped.' + (BD.ledOf(sel) >= 0 ? ' Its LED can be changed.' : '') : has ? 'Click SAVE (top right) to send your changes to the controller.' : 'Waiting for the controller...';
      actRow.classList.toggle('hidden', sel >= C_UP);
      if (sel < C_UP) {
        const m = map || BD.def;
        setItems(act, sel === TRIG ? OUTPUTS.map((o, i) => i === 5 ? 'L (analog trigger)' : i === 6 ? 'R (analog trigger)' : o) : OUTPUTS);
        act.selectedIndex = m[sel] >= 0 && m[sel] <= 12 ? m[sel] : 12; act.disabled = !has;
        pct.value = m[21 + sel] >= 1 && m[21 + sel] <= 100 ? m[21 + sel] : sel === TRIG ? 27 : 100;
        const o = act.selectedIndex;
        // the % means something for a button set to L or R, and for the trigger set to anything else (how far to pull it)
        const use = has && (sel < TRIG ? (o === 5 || o === 6) : (o >= 0 && o < 5) || (o >= 7 && o < 12));
        pct.disabled = !use;
        pctHint.textContent = sel < TRIG
          ? (use ? '100% = an ordinary digital press; less = analog only at that percent (R at 50% = light shield).' : 'The % only applies when this button acts as L or R.')
          : (use ? 'How far you must pull the trigger before this button presses.' : 'As L or R the trigger stays analog. Set it to another button to press that button when pulled.');
      }
      const li = BD.ledOf(sel);
      ledRow.classList.remove('hidden');
      ledBtn.classList.toggle('hidden', li < 0); ledNone.classList.toggle('hidden', li >= 0);
      if (li >= 0) { const c = ledRgb(li); ledBtn.style.background = hex(c); ledBtn.style.color = readable(c); ledBtn.textContent = 'LED ' + (li + 1) + '  -  click to change'; ledBtn.disabled = !led; }
    }
    resetBtn.disabled = !has || sel < 0 || sel >= C_UP; resetAll.disabled = !has;
    if (led) bright.value = led[N_LEDS * 3];
    bright.disabled = !led;
  }

  const art = await image(BD.image);
  const G = { s: 1, ox: 0, oy: 0 };
  const ax = x => G.ox + x * G.s, ay = y => G.oy + y * G.s;
  // one arm of the D-pad plus: from the edge of the centre square (plusHalf out) to the arm's end (rx)
  function armRect(sp, inset) {
    const mid = (sp.a0 + 45) * Math.PI / 180, dx = Math.round(Math.cos(mid)), dy = Math.round(Math.sin(mid)), near = BD.plusHalf + inset, far = sp.rx - inset, half = BD.plusHalf - inset;
    if (dx) { const x0 = sp.x + dx * near, x1 = sp.x + dx * far; return [Math.min(x0, x1), sp.y - half, Math.abs(x1 - x0), 2 * half]; }
    const y0 = sp.y + dy * near, y1 = sp.y + dy * far; return [sp.x - half, Math.min(y0, y1), 2 * half, Math.abs(y1 - y0)];
  }
  function inside(sp, qx, qy) {
    if (sp.kind === 1) { const [x, y, w, h] = armRect(sp, 0); return qx >= x && qx <= x + w && qy >= y && qy <= y + h; }
    if (sp.kind === 2) { let c = false; const p = sp.poly; for (let i = 0, j = p.length - 1; i < p.length; j = i++) if (((p[i][1] > qy) !== (p[j][1] > qy)) && (qx < (p[j][0] - p[i][0]) * (qy - p[i][1]) / (p[j][1] - p[i][1]) + p[i][0])) c = !c; return c; }
    const dx = (qx - sp.x) / sp.rx, dy = (qy - sp.y) / sp.ry; return dx * dx + dy * dy <= 1;
  }
  canvas.addEventListener('mousedown', e => {
    const r = canvas.getBoundingClientRect(), qx = (e.clientX - r.left - G.ox) / G.s, qy = (e.clientY - r.top - G.oy) / G.s;
    const st = BD.sticks.find(s => s.click >= 0 && (qx - s.x) ** 2 + (qy - s.y) ** 2 <= s.r * s.r * 1.2);
    if (st) { sel = st.click; refreshSide(); return; }
    const sp = SPOTS.find(s => inside(s, qx, qy)); if (sp) { sel = sp.bit; refreshSide(); }
  });
  const lit = sp => {
    if (sp.bit >= C_UP) { if (!frame) return false; const cx = frame.cx - 127, cy = frame.cy - 127; return sp.bit === C_UP ? cy > 30 : sp.bit === C_DOWN ? cy < -30 : sp.bit === C_RIGHT ? cx > 30 : cx < -30; }
    return (phys & (1 << sp.bit)) !== 0;
  };
  function paintDrawing() {
    const r = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    if (r.width < 10) return;
    if (canvas.width !== Math.round(r.width * dpr) || canvas.height !== Math.round(r.height * dpr)) { canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr); }
    G.s = Math.min((r.width - 24) / 1530, (r.height - 24) / 1200); G.ox = (r.width - 1530 * G.s) / 2; G.oy = (r.height - 1200 * G.s) / 2;
    const g = canvas.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, r.width, r.height);
    g.drawImage(art, G.ox, G.oy, 1530 * G.s, 1200 * G.s);
    const m = map || BD.def, big = `600 ${Math.max(10, 38 * G.s * 1.33)}px Poppins`, small = '600 10px Poppins';
    const br = 0.5 + 0.5 * Math.sin(performance.now() / 1000 * 3), ring = `rgba(255,255,255,${(190 + 65 * br) / 255})`;
    const outName = (bit, long) => bit < 21 && m[bit] >= 0 && m[bit] < 12 ? (long ? OUTPUTS[m[bit]] : OUT_SHORT[m[bit]]) : null;
    const pctText = bit => bit < 21 && (m[bit] === 5 || m[bit] === 6) && m[21 + bit] < 100 ? m[21 + bit] + '%' : null;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const sp of SPOTS) {
      const on = lit(sp), cx = ax(sp.x), cy = ay(sp.y), rx = sp.rx * G.s, ry = sp.ry * G.s;
      const label = sp.bit >= C_UP ? sp.name : outName(sp.bit, false), p100 = pctText(sp.bit);
      if (sp.kind === 1) {
        const [x, y, w, h] = armRect(sp, 4);
        g.beginPath(); g.roundRect(ax(x), ay(y), w * G.s, h * G.s, 4);
        if (on) { g.fillStyle = 'rgba(255,104,0,.9)'; g.fill(); }
        if (sel === sp.bit) { g.fillStyle = 'rgba(255,255,255,.22)'; g.fill(); g.lineWidth = 2; g.strokeStyle = ring; g.stroke(); }
        if (label) { g.font = small; g.fillStyle = on ? '#000' : '#bbb'; g.fillText(label, ax(x + w / 2), ay(y + h / 2)); }
        continue;
      }
      if (sp.kind === 2) {
        const path = new Path2D(); sp.poly.forEach(([x, y], i) => i ? path.lineTo(ax(x), ay(y)) : path.moveTo(ax(x), ay(y))); path.closePath();
        if (on) { g.fillStyle = 'rgba(255,104,0,.9)'; g.fill(path); }
        if (sel === sp.bit) { g.lineWidth = 2.4; g.strokeStyle = ring; g.stroke(path); }
        if (label) {
          const t = p100 ? label + ' ' + p100 : label;
          g.font = small;
          g.fillStyle = on ? '#ff6800' : '#bbb'; g.fillText(sp.name === 'Start' ? 'St' : t, cx, sp.name === 'Bumper' ? cy - ry - 10 : cy - ry - 9);
        }
        continue;
      }
      const li = BD.ledOf(sp.bit), c = li >= 0 ? ledRgb(li) : null;
      g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      if (on) { g.fillStyle = '#ff6800'; g.fill(); }
      else if (c != null) { g.fillStyle = `rgb(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255})`; g.fill(); g.lineWidth = 2; g.strokeStyle = `rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},.9)`; g.stroke(); }
      else { g.lineWidth = 1.5; g.strokeStyle = '#464646'; g.stroke(); }
      if (sel === sp.bit) { g.beginPath(); g.ellipse(cx, cy, rx + 6, ry + 6, 0, 0, Math.PI * 2); g.lineWidth = 2.6; g.strokeStyle = ring; g.stroke(); }
      if (!label) continue;
      if (sp.label) {   // big buttons: the name inside, and the % under it
        g.font = big; g.fillStyle = on ? '#000' : c != null ? readable(c) : '#ddd';
        if (p100) { g.fillText(label, cx, cy - 8); g.font = small; g.fillText(p100, cx, cy + 14); } else g.fillText(label, cx, cy);
      } else { g.font = small; g.fillStyle = on ? '#ff6800' : '#969696'; g.fillText(p100 ? label + ' ' + p100 : label, cx, cy + (sp.ry + 13) * G.s + 7); }   // small round menu buttons: caption under the outline
    }
    for (const [i, st] of BD.sticks.entries()) {
      const R = st.r * G.s, cx = ax(st.x), cy = ay(st.y);
      if (st.click >= 0 && (phys & (1 << st.click))) { g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fillStyle = 'rgba(255,104,0,.47)'; g.fill(); }
      g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.lineWidth = 1.4; g.strokeStyle = sel === st.click && st.click >= 0 ? ring : '#6e6e6e'; g.stroke();
      const cn = st.click >= 0 ? outName(st.click, false) : null;
      if (cn) { g.font = small; g.fillStyle = '#969696'; g.fillText('click: ' + cn, cx, cy + R + 10); }
      const sx = frame ? ((i ? frame.cx : frame.ax) - 127) / 100 : 0, sy = frame ? ((i ? frame.cy : frame.ay) - 127) / 100 : 0, mm = Math.min(1, Math.hypot(sx, sy)) / Math.max(1e-6, Math.hypot(sx, sy));
      g.beginPath(); g.arc(cx + sx * mm * (R * 0.7), cy - sy * mm * (R * 0.7), R * 0.28, 0, Math.PI * 2); g.fillStyle = Math.hypot(sx, sy) > 0.05 ? '#ff6800' : '#787878'; g.fill();
    }
  }

  // ---------------------------------------------------------------- SETTINGS page
  // the 19 values of the "S" command, in setStickSettingsFromText's order (see the desktop app's SettingsPanel)
  const vals = new Array(19).fill(0);
  let setTimer = 0;
  const sChanged = () => { clearTimeout(setTimer); setTimer = setTimeout(() => { pending.settings = vals.slice(); staged(); }, 200); };
  const signed = x => x > 0 ? '+' + x : String(x), plain = x => String(x), pctF = x => x + '%';
  const SL = (cap, min, max, f, idx) => { const s = slider(cap, min, max, f, v => { vals[idx] = v; sChanged(); }); s.idx = idx; return s; };
  const sliders = [
    SL('Snapback X  (both sticks)', -10, 10, signed, 4), SL('Snapback Y  (both sticks)', -10, 10, signed, 5),
    SL('Left stick (main) X', 0, 18, plain, 6), SL('Left stick (main) Y', 0, 18, plain, 7), SL('Right stick (C-stick) X', 0, 18, plain, 8), SL('Right stick (C-stick) Y', 0, 18, plain, 9),
    SL('Left stick (main) X', -24, 24, signed, 10), SL('Left stick (main) Y', -24, 24, signed, 11), SL('Right stick (C-stick) X', -24, 24, signed, 12), SL('Right stick (C-stick) Y', -24, 24, signed, 13),
    SL('Left stick (main)', -2, 6, signed, 0), SL('Right stick (C-stick)', -2, 6, signed, 1),
    SL('Left stick (main)', 90, 110, pctF, 2), SL('Right stick (C-stick)', 90, 110, pctF, 3),
    SL('L trigger offset / value  (depends on the mode)', 49, 227, plain, 17),
  ];
  const page3 = el('div.page.hidden', { style: { padding: '14px 16px' } }, [
    el('p.hint', { text: BD.gs ? 'Advanced stick settings (normally only reachable with PhobGCC\'s button combos). Click SAVE (top right) to keep your changes.'
      : 'Advanced stick, trigger and rumble settings (normally only reachable with PhobGCC\'s button combos). Click SAVE (top right) to keep your changes.', style: { margin: '0 0 12px' } }),
    el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '14px', alignItems: 'start' } }, [
      el('div', { style: { display: 'grid', gap: '14px' } }, [card('Snapback filtering', 'sliders', [sliders[0].el, sliders[1].el]), card('Stick smoothing', 'sliders', sliders.slice(2, 6).map(s => s.el)), card('Waveshaping  (response during fast movement)', 'sliders', sliders.slice(6, 10).map(s => s.el))]),
      el('div', { style: { display: 'grid', gap: '14px' } }, [card('Cardinal snapping', 'sliders', [el('p.note', { text: 'Snaps near-cardinal inputs to true up / down / left / right.', style: { margin: '0 0 6px' } }), sliders[10].el, sliders[11].el]),
        card('Analog scaler', 'sliders', [el('p.note', { text: 'Output range at the gate edge, as a percent of the calibrated size.', style: { margin: '0 0 6px' } }), sliders[12].el, sliders[13].el]),
        ]),
    ]),
  ]);
  function showSettings(v) { for (let i = 0; i < 19; i++) vals[i] = v[i]; for (const s of sliders) s.value = vals[s.idx]; }

  // ---------------------------------------------------------------- tabs, lines from the controller, timers
  const pages = [page0, page1, page3];
  shell.content(el('div', { style: { position: 'absolute', inset: 0 } }, pages));
  let curPage = page0;
  shell.tabs(['CALIBRATION', 'CONTROLLER', 'SETTINGS'], i => { curPage = pages[i]; pages.forEach((p, k) => p.classList.toggle('hidden', k !== i)); });
  refreshSide();

  const ints = (line, n) => { const p = line.split(','); if (p.length !== n + 1) return null; const v = p.slice(1).map(Number); return v.some(isNaN) ? null : v; };
  let haveFrame = false;
  dev.onLine = line => {
    if (line.startsWith('F,')) {
      const v = line.split(',').slice(1).map(Number);
      if (v.length < 15) return;
      frame = { step: v[0], stick: v[1], locked: v[2], ax: v[4], ay: v[5], cx: v[6], cy: v[7], la: v[8], buttons: v[10],
        rawAx: v[11] / 10000, rawAy: v[12] / 10000, rawCx: v[13] / 10000, rawCy: v[14] / 10000, inv: v.length > 15 ? v[15] : 0, phys: v.length > 16 ? v[16] : 0,
        hasTrig: v.length >= 25, trigRaw: v[17], trigLevel: v[18], trigCal: v[19], trigRest: v[20], trigFull: v[21], trigSeq: v[22], trigCode: v[23], saveState: v.length >= 25 ? v[24] : 0,
        hasTrack: v.length >= 28, tracking: v[25], trigMax: v[26], trigRestNew: v[27] };
      if (!haveFrame) { haveFrame = true; views[0].setRaw(frame.rawAx, frame.rawAy); views[0].reset(true); views[1].setRaw(frame.rawCx, frame.rawCy); views[1].reset(true); say('Receiving data'); }
      onFrame(frame);
    } else if (line.startsWith('M,')) {
      const m = ints(line, 42); if (!m) return;
      if (wanted.map) { if (m.join() !== wanted.map.join()) return; wanted.map = null; say('Button mapping saved in the controller.', 'var(--good)'); }
      if (!pending.map) { map = m; refreshSide(); }
    } else if (line.startsWith('LC,')) {
      let p = line.split(',').slice(1).map(Number);
      if (N_LEDS === 13 && p.length === 25) p = [...p.slice(0, 24), ...new Array(15).fill(0), p[24]];   // older GS firmware: 8 LEDs
      if (p.length !== N_LEDS * 3 + 1) return;
      if (performance.now() - ledSentAt > 500) { led = p; refreshSide(); }
    } else if (line.startsWith('S,')) {
      const s = ints(line, 19); if (!s) return;
      if (wanted.settings) { if (s.join() !== wanted.settings.join()) return; wanted.settings = null; say('Settings saved in the controller.', 'var(--good)'); }
      if (!pending.settings) { settings = s; showSettings(s); }
    }
  };
  function onFrame(f) {
    const freshPress = f.phys & ~phys;
    phys = f.phys;
    if (freshPress && curPage === page1) { for (let b = 0; b < 21; b++) if (freshPress & (1 << b)) { sel = b; refreshSide(); break; } }   // pressing a button selects it
    views[0].setRaw(f.rawAx, f.rawAy); views[1].setRaw(f.rawCx, f.rawCy);
    const calL = f.step >= 0 && f.stick === 0, calR = f.step >= 0 && f.stick === 1;
    views[0].active = calL; views[1].active = calR;
    for (const v of views) { v.aim = NaN; v.aimCenter = false; }
    if (f.step >= 0 && f.step < 32) { const e = CAL_ORDER[f.step], v = views[f.stick === 1 ? 1 : 0]; if (!(e & 1)) v.aimCenter = true; else if ((e >> 1) % 2 === 0) v.aim = (e >> 1) * 22.5; }
    views[0].outX = (f.ax - 127) / 100; views[0].outY = (f.ay - 127) / 100;
    views[1].outX = (f.cx - 127) / 100; views[1].outY = (f.cy - 127) / 100;
    // while one stick is calibrated, the other stick's output is the target drawn on it
    views[0].hasTarget = calL; views[0].hideOut = calR; views[1].hasTarget = calR; views[1].hideOut = calL;
    if (calL) { views[0].tx = views[1].outX; views[0].ty = views[1].outY; }
    if (calR) { views[1].tx = views[0].outX; views[1].ty = views[0].outY; }
    if (f.step < 0) { stepLbl.textContent = f.locked ? 'LOCKED' : 'READY'; stepLbl.style.color = f.locked ? '#ff6e6e' : '#6ee682'; prog.firstChild.style.width = '0%'; }
    else { stepLbl.textContent = (f.stick === 1 ? 'RIGHT' : 'LEFT') + ' stick: step ' + (f.step + 1) + ' / 44'; stepLbl.style.color = f.step >= 32 ? '#ffd23c' : f.stick === 1 ? '#e66ee6' : '#5aaaff'; prog.firstChild.style.width = (Math.min(f.step, 44) / 44 * 100) + '%'; }
    instr.textContent = instruction(f);
    const names = BTN_NAMES.filter((_, i) => f.buttons & (1 << i));
    seen.textContent = 'buttons: ' + (names.length ? names.join(', ') : '-');
    trigL.textContent = 'L trigger: ' + f.la + ' / 255';
    if (wanted.inv >= 0 && f.inv === wanted.inv) { wanted.inv = -1; say('Axis flip saved in the controller. No need to recalibrate.', 'var(--good)'); views.forEach(v => v.reset(true)); }
    else if (wanted.inv < 0 && pending.inv < 0) flips.forEach((t, i) => { t.checked = (f.inv & (1 << i)) !== 0; });
    if (f.saveState === 2) say('Warning: the controller couldn\'t save its settings.', 'var(--bad)');
    // ask for what we don't know yet; resend what wasn't confirmed
    const now = performance.now();
    if (!led && now - asked.led > 1000) { asked.led = now; dev.send('L'); }
    if (!map && !wanted.map && now - asked.map > 1000) { asked.map = now; dev.send('M'); }
    if (!settings && !wanted.settings && now - asked.settings > 1000) { asked.settings = now; dev.send('S'); }
    if ((wanted.map || wanted.settings || wanted.inv >= 0) && now - wanted.at > 800) {
      if (wanted.tries++ < 5) { wanted.at = now; if (wanted.map) dev.send('N ' + wanted.map.join(' ')); if (wanted.settings) dev.send('S ' + wanted.settings.join(' ')); if (wanted.inv >= 0) dev.send('I ' + wanted.inv); }
      else { wanted.map = wanted.settings = null; wanted.inv = -1; say('The controller did not accept the changes. Try SAVE again.', 'var(--bad)'); btnSave.disabled = false; }
    }
  }
  // virtual buttons: the macro steps and the held buttons, sent every 60 ms (the firmware releases them after 1 s of silence)
  const keep = setInterval(() => {
    if (!alive) return clearInterval(keep);
    const now = performance.now();
    if (now >= macroUntil) { const s = macro.shift(); if (s) { macroMask = s[0]; macroUntil = now + s[1]; } else macroMask = 0; }
    dev.send('B ' + (macroMask | holdMask));
  }, 60);
  const paintAll = () => { if (!alive) return; if (curPage === page0) views.forEach(v => v.paint()); if (curPage === page1) paintDrawing(); };
  const loop = () => { if (!alive) return; paintAll(); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  const tick = setInterval(() => { if (!alive) return clearInterval(tick); paintAll(); }, 200);
  dev.onLost = () => { if (alive) { alive = false; shell.lost('Lost the connection to the PadBox.'); } };

  return { stop() { alive = false; clearInterval(keep); clearInterval(tick); }, dirty: () => !!(pending.map || pending.settings || pending.inv >= 0) };
}
