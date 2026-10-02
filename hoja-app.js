// The HOJA2 PadBox Calibrator in the new design (Figma "PadBox Software"), for the PadBox GS Essential and GS Platform:
// the same frame, drawing and panels as the GP2040-CE copy (gp-app.js), with HOJA2's settings - a copy of js/hoja/app.js.
// CONTROLLER: the mode (top right), what each button does in that mode, its LED color, and the lighting (effect, color,
// idle glow, brightness, animation time - as in the design's image.png). STICKS: calibration, deadzones, snapback,
// curve and ANGLE SET. Changes apply to the PadBox right away (written into its RAM); Save keeps them.

import { el, pickColor, hex, clamp, confirmBox, download, openFile } from './js/ui.js';
import { Blk, Rpt, DeviceInfo } from './js/hoja/device.js';
import { Analog, Rgb, Gamepad, Input, IN, IN_TRIGGER, INPUTS, PROFILES, MODES, profileOfMode, RGB_MODES, OUTPUTS, assign, defaultInputTypes, gsEssential, gsPlatform, VERSIONS } from './js/hoja/model.js';
import { firmwareUpdate } from './js/update.js';
import { buildDrawing } from './drawing.js';
import { dicon } from './icons.js';

// The drawing's buttons (named by their GP2040-CE GPIO, see drawing.js) -> HOJA2's input slots and LED numbers
// (js/hoja/model.js gsEssential / gsPlatform)
const COMMON_IN = { 10: 2, 11: 3, 12: 9, 13: 8, 6: 0, 7: 1, 8: 12, 9: 10, 2: 4, 3: 5, 5: 6, 4: 7, 17: 18, 16: 19, 20: 20, 21: 21, 22: 15 };
const COMMON_LED = { 10: 0, 11: 1, 12: 2, 13: 3, 6: 4, 7: 5, 8: 6, 9: 7 };
const COMMON_NAME = { 10: '1P', 11: '2P', 12: '3P', 13: '4P', 6: '1K', 7: '2K', 8: '3K', 9: '4K', 2: 'D-pad up', 3: 'D-pad down', 5: 'D-pad left', 4: 'D-pad right',
  17: 'Start', 16: 'Select', 20: 'Home', 21: 'Touchpad', 22: 'Bumper' };
const ESSENTIAL = { input: { ...COMMON_IN, 18: 26, 19: 31 }, led: COMMON_LED, name: { ...COMMON_NAME, 18: 'Left stick click (L3)', 19: 'Right stick click (R3)' } };
const PLATFORM = {
  input: { ...COMMON_IN, 27: 34, 19: 32, 26: 33, 18: 35, 15: 14 },
  led: { ...COMMON_LED, 27: 9, 19: 12, 26: 11, 18: 10, 15: 8 },
  name: { ...COMMON_NAME, 27: 'C-stick up', 19: 'C-stick right', 26: 'C-stick left', 18: 'C-stick down', 15: 'A button' },
};
const ARROWS = { Up: 'Up', Dn: 'Down', Lt: 'Left', Rt: 'Right' };   // the D-pad's outputs are drawn as arrows

export async function startHoja(shell, dev, opts) {
  let alive = true;

  // ---------------------------------------------------------------- read everything
  shell.footer('Reading settings...');
  const info = await dev.readStatic(DeviceInfo.Block, DeviceInfo.Size);
  const ins = await dev.readStatic(DeviceInfo.InputBlock, DeviceInfo.InputSize);
  const B = {};
  for (const b of [Blk.HAPTIC, Blk.IMU, Blk.ANALOG, Blk.RGB, Blk.GAMEPAD, Blk.INPUT]) {
    let r = await dev.readBlock(b); if (!r) r = await dev.readBlock(b);
    if (!r) throw new Error('The PadBox didn\'t send its settings. Unplug it, plug it back in and try again. If it keeps happening, reinstall the firmware (Update firmware).');
    B[b] = r;
  }
  const name = info ? new TextDecoder().decode(info.subarray(0, 16)).replace(/\0.*$/, '').trim() : '';
  const fw = info ? (info[704] | (info[705] << 8) | (info[706] << 16) | (info[707] << 24)) >>> 0 : 0;
  // which board, from its product name ("PadBox GS Essent", "PadBox GS Platfo"), or from whether it has a right stick
  if (name && !name.startsWith('PadBox GS ')) throw new Error('This PadBox ("' + name + '") isn\'t supported by this app.');
  const platform = /platf/i.test(name) || (!/essen/i.test(name) && !!ins && ins[32 * 10] === IN.Unused);
  const types = ins ? Array.from({ length: INPUTS }, (_, i) => ins[i * 10]) : defaultInputTypes(platform, true);
  const lay = platform ? gsPlatform() : gsEssential();
  const hasRight = !platform;
  const BOARD = platform ? PLATFORM : ESSENTIAL;
  const mismatch = B[Blk.ANALOG][0] !== VERSIONS.analog || B[Blk.GAMEPAD][0] !== VERSIONS.gamepad || B[Blk.RGB][0] !== VERSIONS.rgb || B[Blk.INPUT][0] !== VERSIONS.input;

  shell.header('HOJA2', 'PadBox ' + lay.name + (fw ? '  •  firmware ' + fw.toString(16).toUpperCase() : '') + (opts.demo ? '  •  demo' : ''));
  shell.status(true);

  // ---------------------------------------------------------------- changes: live to RAM, Save to flash
  const dirty = new Set(), live = new Set();
  let liveTimer = 0, calibrating = false, calSticks = 0, saving = false;   // calSticks: which sticks are being calibrated (1 left, 2 right)
  function changed(b) { dirty.add(b); live.add(b); clearTimeout(liveTimer); liveTimer = setTimeout(pushLive, 120); refreshSave(); }
  function markUnsaved(b) { dirty.add(b); refreshSave(); }
  async function pushLive() {
    for (const b of [...live]) {
      if (b === Blk.ANALOG && calibrating) continue;   // would reset the calibration in progress
      live.delete(b);
      await dev.writeBlock(b, B[b].slice());
    }
  }
  function refreshSave() {
    btnSave.disabled = !dirty.size || saving;
    if (dirty.size && !saving) say('Unsaved changes: they work now, but click Save to keep them after unplugging.', 'var(--warn)');
  }
  function say(t, c) { shell.footer(t, c); }
  async function save() {
    clearTimeout(liveTimer); await pushLive();
    saving = true; btnSave.disabled = true; say('Saving to the PadBox...', 'var(--warn)');
    const r = await dev.command(Blk.GAMEPAD, 0xff, 4000);   // GAMEPAD_CMD_SAVE_ALL
    saving = false;
    if (r.ok) { dirty.clear(); say('Saved. Your settings stay on the PadBox after unplugging.', 'var(--good)'); }
    else say('Saving failed: the PadBox didn\'t confirm. Try again.', 'var(--bad)');
    refreshSave();
  }

  // ---------------------------------------------------------------- header buttons (the design's icon buttons)
  const iconBtn = (cls, ic, title, onclick) => { const b = el('button.act.' + cls, { type: 'button', title, html: dicon(ic) }); b.addEventListener('click', onclick); return b; };
  const btnUpdate = iconBtn('outline', 'download', 'Update firmware', () => firmwareUpdate({ board: lay.board, current: 'HOJA2', enter: async noDrive => { alive = false; await dev.bootloader(noDrive); } }));
  const btnSave = iconBtn('save', 'save', 'Save to the PadBox', save); btnSave.disabled = true;
  const btnDone = el('button.act.primary', { type: 'button', html: dicon('gamepad') + '<span>Disconnect</span>' });
  btnDone.addEventListener('click', async () => {
    if (dirty.size && !await confirmBox('Unsaved changes', 'Your changes work now but aren\'t saved: they\'ll be lost when the PadBox is unplugged. Disconnect anyway?', 'DISCONNECT')) return;
    shell.lost(null);
  });
  shell.actions([btnUpdate, btnSave, btnDone]);

  // ---------------------------------------------------------------- CONTROLLER page
  let editProfile = 0, selInput = -1;
  const pressed = new Array(INPUTS).fill(false), stickXY = [[0, 0], [0, 0]];
  const inputOf = pin => pin in BOARD.input ? BOARD.input[pin] : -1;
  const pinOf = i => { for (const p in BOARD.input) if (BOARD.input[p] === i) return +p; return -1; };
  const selectable = i => i >= 0 && i < INPUTS && types[i] !== IN.Unused && pinOf(i) >= 0;
  const outputOf = i => { if (i < 0) return null; const c = Input.code(B[Blk.INPUT], editProfile, i), o = OUTPUTS[editProfile]; return c >= 0 && c < o.length ? o[c] : null; };
  const ledOf = i => { const p = pinOf(i); return p >= 0 && p in BOARD.led ? BOARD.led[p] : -1; };

  const drawing = buildDrawing(pin => select(inputOf(pin)), pin => {
    const i = inputOf(pin), o = selectable(i) ? outputOf(i) : null;
    return (BOARD.name[pin] || 'Button') + '  →  ' + (o ? o.name : 'nothing');
  }, pin => {
    const i = inputOf(pin), o = selectable(i) ? outputOf(i) : null;
    if (!o) return '';
    if (/^D-pad /.test(o.name)) return ARROWS[o.short] || o.short;
    const amt = amountOf(i);
    return amt != null && amt < 100 ? o.short.replace('~', '') + ' ' + amt + '%' : o.short;
  }, platform ? 'platform' : 'essential');

  // the mode, top right (where the GP2040-CE copy has its profile): which console the PadBox talks to; each mode
  // has its own button mapping
  const modeSel = el('select.field.profile-sel', { title: 'The controller mode: which console the PadBox acts as. Each mode has its own button mapping.' });
  for (const [n, v] of MODES) modeSel.append(el('option', { value: v, text: n }));
  modeSel.addEventListener('change', () => {
    editProfile = profileOfMode(+modeSel.value);
    Gamepad.setMode(B[Blk.GAMEPAD], +modeSel.value); changed(Blk.GAMEPAD);
    refreshSide();
  });

  // the right-hand column: BUTTON SETTINGS (or "No button selected"), then GLOBAL LED SETTINGS
  const empty = el('div.panel.empty', {}, [
    el('div.click-icon', { html: dicon('click') }),
    el('div.empty-t', { text: 'No button selected' }),
    el('div.empty-d', { text: 'Click a button on the controller or press it on the device to configure its function and LED lighting' }),
  ]);
  const fn = el('select.field.mono');
  fn.addEventListener('change', () => {
    if (selInput < 0) return;
    const code = +fn.value;
    if (code === Input.code(B[Blk.INPUT], editProfile, selInput)) return;
    assign(B[Blk.INPUT], editProfile, selInput, types[selInput], code);
    changed(Blk.INPUT); refreshSide();
  });
  // Analog amount: for a button whose function is an analog output (an analog trigger like GameCube R, or a stick
  // direction), how far that output goes when the button is pressed (static_output in mapper.c, 4096 = 100%)
  function ANALOG_OUT(t) { return t === 2 || t === 3; }
  function amountOf(i) {
    if (i < 0 || types[i] !== IN.Digital) return null;
    const code = Input.code(B[Blk.INPUT], editProfile, i), o = OUTPUTS[editProfile][code];
    if (!o || !ANALOG_OUT(o.type)) return null;
    const st = Input.stat(B[Blk.INPUT], editProfile, i);
    return st === 0 ? 100 : clamp(Math.round(st * 100 / 4096), 1, 100);
  }
  // one compact row (its space is always kept, so the box is the same height for every button)
  const amtVal = el('span.amt-val'), amtIn = el('input.range', { type: 'range', min: 1, max: 100, step: 1 });
  const amtPaint = () => { amtVal.textContent = amtIn.value + '%'; amtIn.style.setProperty('--p', ((+amtIn.value - 1) / 99 * 100) + '%'); };
  amtIn.addEventListener('input', () => {
    amtPaint();
    if (amountOf(selInput) == null) return;
    const b = B[Blk.INPUT];
    Input.setModeStatic(b, editProfile, selInput, Input.mode(b, editProfile, selInput), Math.round(+amtIn.value * 4096 / 100));
    changed(Blk.INPUT); drawing.refreshTips();
  });
  const amount = { el: el('div.amount-row', { title: 'How far the analog output goes when this button is pressed' }, [el('span', { text: 'Analog amount' }), amtIn, amtVal]),
    set value(v) { amtIn.value = v; amtPaint(); } };
  const ledDot = el('i.dot'), ledTxt = el('span');
  const ledFieldBtn = el('button.field.color', { type: 'button' }, [ledDot, ledTxt]);
  ledFieldBtn.addEventListener('click', () => {
    const led = ledOf(selInput); if (led < 0) return;
    pickColor(Rgb.color(B[Blk.RGB], led), c => { Rgb.setColor(B[Blk.RGB], led, c); changed(Blk.RGB); refreshSide(); });
  });
  const ledBlock = el('div.led-block', {}, [
    el('div.lbl', { text: 'LED color' }),
    el('div.two.one', {}, [ledFieldBtn]),
    el('div.noled-note', { text: 'This button has no LED' }),
  ]);
  ledFieldBtn.title = 'This button\x27s LED color (used by the Static, Reactive and Fairy effects)';
  const btnResetMode = el('button.pbtn.primary', { type: 'button', html: dicon('sync') + '<span>Reset this mode</span>' });
  btnResetMode.addEventListener('click', () => resetModes([editProfile]));
  const btnResetAll = el('button.pbtn.outline', { type: 'button', html: dicon('sync') + '<span>Reset all modes</span>' });
  btnResetAll.addEventListener('click', () => resetModes(PROFILES.map((_, p) => p)));
  const settingsPanel = el('div.panel.hidden', {}, [
    el('div.ptitle', { text: 'BUTTON SETTINGS' }),
    el('div.lbl', { text: 'Function' }), fn, amount.el,
    ledBlock,
    btnResetMode, btnResetAll,
  ]);

  // GLOBAL LED SETTINGS: the effect, one color for every button, idle glow, brightness and the animation's time
  const effect = el('select.field');
  RGB_MODES.forEach((n, i) => effect.append(el('option', { value: i, text: n })));
  effect.addEventListener('change', () => { Rgb.setMode(B[Blk.RGB], +effect.value); changed(Blk.RGB); refreshSide(); });
  const idle = dtoggle('Idle Glow', v => { Rgb.setIdleGlow(B[Blk.RGB], v ? 1 : 0); changed(Blk.RGB); });
  let allColor = 0x28a6ff;
  const wheelDot = el('i.wheel-in'), wheelKnob = el('i.wheel-knob');
  const wheel = el('div.wheel', { title: 'Pick a color for every button' }, [wheelDot, wheelKnob]);
  const rgbTxt = el('span'), hexTxt = el('span');
  const hsvHue = c => { const r = ((c >> 16) & 255) / 255, g = ((c >> 8) & 255) / 255, b = (c & 255) / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (!d) return 0; let h = mx === r ? (g - b) / d % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; return h < 0 ? h + 360 : h; };
  const hueColor = h => { const f = n => { const k = (n + h / 60) % 6; return Math.round(255 * (1 - Math.max(0, Math.min(k, 4 - k, 1)))); }; return (f(5) << 16) | (f(3) << 8) | f(1); };
  function showAllColor(c) {
    allColor = c; wheelDot.style.background = hex(c);
    const a = (hsvHue(c) - 90) * Math.PI / 180;   // hue 0 at the top, like the conic ring
    wheelKnob.style.left = (50 + 41.5 * Math.cos(a)) + '%'; wheelKnob.style.top = (50 + 41.5 * Math.sin(a)) + '%';
    rgbTxt.textContent = `R${(c >> 16) & 255} G${(c >> 8) & 255} B${c & 255}`; hexTxt.textContent = hex(c).toUpperCase();
  }
  const setAll = c => { showAllColor(c); for (let i = 0; i < 32; i++) Rgb.setColor(B[Blk.RGB], i, c); changed(Blk.RGB); refreshSide(); };
  wheel.addEventListener('click', e => {
    const r = wheel.getBoundingClientRect(), x = e.clientX - r.left - r.width / 2, y = e.clientY - r.top - r.height / 2;
    if (Math.hypot(x, y) < r.width * 0.3) return pickColor(allColor, setAll);   // the middle: any color
    let h = Math.atan2(y, x) * 180 / Math.PI + 90; if (h < 0) h += 360;
    setAll(hueColor(h));
  });
  const swatches = el('div.sw', {}, [0xe02b2b, 0xe09c06, 0x0634e0, 0xeb2fdb].map(c => { const b = el('button', { type: 'button', title: hex(c) }); b.style.background = hex(c); b.addEventListener('click', () => setAll(c)); return b; }));
  const plus = el('button.plus', { type: 'button', title: 'Another color...', html: dicon('plus') });
  plus.addEventListener('click', () => pickColor(allColor, setAll));
  swatches.append(plus);
  const bright = dslider('Brightness', 0, 100, v => v + '%', v => { Rgb.setBrightness(B[Blk.RGB], Math.round(v * 4096 / 100)); changed(Blk.RGB); });
  const speed = dslider('Animation time', 300, 5000, v => (v / 1000).toFixed(2) + 's', v => { Rgb.setSpeed(B[Blk.RGB], v); changed(Blk.RGB); });
  const ledPanel = el('div.panel.hoja-led', {}, [
    el('div.ptitle', { text: 'GLOBAL LED SETTINGS' }),
    el('div.lbl', { text: 'Lighting effect' }), effect,
    el('div.lbl.split.idle-row', {}, [el('span', { text: 'LED color' }), idle.el]),
    el('div.colorrow', {}, [wheel, el('div', {}, [el('div.readout', {}, [rgbTxt, hexTxt]), swatches])]),
    bright.el, speed.el,
  ]);
  const column = el('div.side-col', {}, [empty, settingsPanel, ledPanel]);
  const page0 = el('div.page.controller', {}, [drawing.svg, modeSel, column]);

  function refreshSide() {
    const rb = B[Blk.RGB];
    effect.value = String(clamp(Rgb.mode(rb), 0, RGB_MODES.length - 1));
    speed.disabled = Rgb.mode(rb) < 2;   // only the animated effects use it
    const none = selInput < 0;
    empty.classList.toggle('hidden', !none); settingsPanel.classList.toggle('hidden', none);
    column.classList.toggle('selected', !none);
    if (!none) {
      fn.innerHTML = '';
      fn.append(el('option', { value: -1, text: 'Nothing (disabled)' }));
      OUTPUTS[editProfile].forEach((o, i) => fn.append(el('option', { value: i, text: o.name })));
      const code = Input.code(B[Blk.INPUT], editProfile, selInput);
      fn.value = String(code >= 0 && code < OUTPUTS[editProfile].length ? code : -1);
      const amt = amountOf(selInput);
      amount.el.classList.toggle('off', amt == null); if (amt != null) amount.value = amt;
      const led = ledOf(selInput);
      ledBlock.classList.toggle('noled', led < 0);   // keeps its space, so the panels below don't move
      if (led >= 0) { const c = Rgb.color(rb, led); ledDot.style.background = hex(c); ledTxt.textContent = hex(c).toUpperCase(); }
    }
    drawing.refreshTips();
  }
  function select(i) { if (!selectable(i)) return; selInput = i; refreshSide(); }
  async function resetModes(list) {
    const what = list.length === 1 ? PROFILES[list[0]] + ' mode' : 'every mode';
    if (!await confirmBox('Reset buttons', 'Put every button back to its default in ' + what + '?', 'RESET')) return;
    clearTimeout(liveTimer); await pushLive();
    btnResetMode.disabled = btnResetAll.disabled = true;
    let ok = true;
    for (const p of list) { const r = await dev.command(Blk.INPUT, 2 + p, 1500); if (!r.ok) ok = false; }   // MAPPER_CMD_DEFAULT_<mode>
    const fresh = ok ? await dev.readBlock(Blk.INPUT) : null;
    btnResetMode.disabled = btnResetAll.disabled = false;
    if (!fresh) return say('Couldn\'t reset the buttons - the PadBox didn\'t answer. Try again.', 'var(--bad)');
    B[Blk.INPUT] = fresh; markUnsaved(Blk.INPUT); refreshSide();
    say('The buttons of ' + what + ' are back to their defaults. Click Save to keep them after unplugging.', 'var(--warn)');
  }

  // the drawing follows the controller: the selected button orange, pressed buttons lit, each LED's color around its
  // button, the sticks' dots
  const drawTick = setInterval(() => {
    if (!alive) return clearInterval(drawTick);
    drawing.set(pinOf(selInput), pin => { const i = inputOf(pin); return i >= 0 && pressed[i]; });
    drawing.setLeds(pin => pin in BOARD.led ? hex(Rgb.color(B[Blk.RGB], BOARD.led[pin])) : null);
    drawing.setSticks(stickXY);
  }, 30);

  // ---------------------------------------------------------------- the design's building blocks for the other pages
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
  function pbtn(text, ic, primary, onclick) {
    const b = el('button.pbtn.' + (primary ? 'primary' : 'outline'), { type: 'button', html: (ic ? dicon(ic) : '') + '<span>' + text + '</span>' });
    b.addEventListener('click', onclick);
    return b;
  }

  // ---------------------------------------------------------------- STICKS page
  // Each panel's Calibrate button calibrates that stick only; the other stick keeps its calibration. Firmware from
  // before the one-stick commands calibrates both sticks together instead.
  const sticks = [makeStick(false, 'LEFT STICK'), makeStick(true, hasRight ? 'RIGHT STICK' : 'C-STICK')];
  const page1 = el('div.page.hidden.dpage.sticks', {}, sticks.map(s => s.card));
  function refreshCal(msg, color) {
    for (const s of sticks) s.showCal(msg, color);
  }
  async function toggleCalibrate(right) {
    if (!calibrating) {
      clearTimeout(liveTimer); await pushLive();
      sticks.forEach(s => { s.bCal.disabled = true; s.trail.length = 0; });
      // ANALOG_CMD_CALIBRATE_START_LEFT (5) / _RIGHT (6); a board without a right stick uses ANALOG_CMD_CALIBRATE_START (1)
      calSticks = hasRight ? (right ? 2 : 1) : 3;
      let r = await dev.command(Blk.ANALOG, calSticks === 3 ? 1 : right ? 6 : 5, 1500);
      let note = '';
      if (!r.ok && calSticks !== 3) { calSticks = 3; r = await dev.command(Blk.ANALOG, 1, 1500); note = 'This firmware calibrates both sticks together: roll both, then click Stop. Update it to calibrate one stick at a time.'; }
      calibrating = true;
      sticks.forEach(s => { s.bCal.disabled = !s.calibrated(); });
      refreshCal(note || undefined, note ? 'var(--warn)' : undefined);
    } else {
      calibrating = false; sticks.forEach(s => s.bCal.disabled = true); refreshCal('Finishing...', 'var(--warn)');
      await dev.command(Blk.ANALOG, 2, 1500);   // ANALOG_CMD_CALIBRATE_STOP
      const fresh = await dev.readBlock(Blk.ANALOG);
      sticks.forEach(s => { s.bCal.disabled = false; s.trail.length = 0; });
      if (!fresh) return refreshCal('Couldn\'t read the result back from the PadBox. Try again.', 'var(--bad)');
      const pending = live.has(Blk.ANALOG);
      B[Blk.ANALOG] = fresh;
      if (pending) sticks.forEach(s => s.apply && s.apply());
      markUnsaved(Blk.ANALOG); if (pending) pushLive();
      const done = calSticks; calSticks = 0; refreshCal();
      for (const s of sticks) {
        if (!(done & (s.right ? 2 : 1)) || !s.present) continue;
        if (Analog.stickCalibrated(fresh, s.right)) s.showCal('Calibrated. Click Save to keep it after unplugging.', 'var(--good)');
        else s.showCal('Not enough movement was seen. Try again with slower, fuller circles that touch every corner.', 'var(--bad)');
      }
    }
  }
  function makeStick(right, title) {
    const A = () => B[Blk.ANALOG];
    const present = !right || hasRight;
    const cv = el('canvas.gate');
    const en = dtoggle('Stick enabled', v => { Analog.setDisabled(A(), right, !v); changed(Blk.ANALOG); });
    const stepL = el('div.step'), infoL = el('div.info');
    const bCal = pbtn('Calibrate', '', true, () => toggleCalibrate(right));
    const bAngle = pbtn('Angle set', '', false, angleSet);
    bAngle.title = 'Hold the stick in a notch, then click to line that notch up with it';
    const fx = dtoggle('Flip X axis', v => { Analog.setInv(A(), right ? 6 : 2, v); changed(Blk.ANALOG); });
    const fy = dtoggle('Flip Y axis', v => { Analog.setInv(A(), right ? 8 : 4, v); changed(Blk.ANALOG); });
    // the gate drawn: the right stick's is round; the left one's is round by default on the GS Essential and
    // octagonal by default on the GS Platform (switchable either way)
    const oct = right ? null : dtoggle('Octagonal gate', () => { });
    if (oct) oct.checked = platform;
    const dz = v => (v * 100 / 2047).toFixed(1) + '%';
    const dead = dslider('Inner deadzone', 0, 400, dz, v => { Analog.setDeadzone(A(), right, v); changed(Blk.ANALOG); });
    const outer = dslider('Outer deadzone', 0, 400, dz, v => { Analog.setOuter(A(), right, v); changed(Blk.ANALOG); });
    const snap = dslider('Snapback filter', 0, 255, v => v === 0 ? 'off' : String(v), v => { Analog.setSnap(A(), right, v); changed(Blk.ANALOG); });
    const exp = dslider('Curve (1.00 = linear)', 50, 300, v => (v / 100).toFixed(2), v => { Analog.setExp(A(), right, clamp(v - 49, 1, 251)); changed(Blk.ANALOG); });
    const absent = el('div.empty-d', { text: 'The C-stick is made of buttons, so there\'s nothing to calibrate.', style: { padding: '90px 0', textAlign: 'center' } });
    const body = el('div.stick-body', {}, [
      el('div.gate-col', {}, [cv]),
      el('div.ctl-col', {}, [stepL, infoL, el('div.btnrow', {}, [bCal, bAngle]),
        el('div.lbl', { text: 'Axes' }), el('div.two', {}, [fx.el, fy.el]),
        dead.el, outer.el, snap.el, exp.el, oct && el('div', { style: { height: '8px' } }), oct && oct.el]),
    ]);
    const c = panel(title, [body, absent], 'stick');
    c.firstChild.append(en.el);   // "Stick enabled" on the title row
    body.classList.toggle('hidden', !present); absent.classList.toggle('hidden', present); en.el.classList.toggle('hidden', !present);
    const st = { card: c, bCal, right, present, x: 0, y: 0, rx: 0, ry: 0, trail: [] };
    st.calibrated = () => calibrating && (calSticks & (right ? 2 : 1)) !== 0;   // this stick is being calibrated
    st.load = () => {
      en.checked = !Analog.disabled(A(), right); fx.checked = Analog.inv(A(), right ? 6 : 2); fy.checked = Analog.inv(A(), right ? 8 : 4);
      dead.value = clamp(Analog.deadzone(A(), right), 0, 400); outer.value = clamp(Analog.outer(A(), right), 0, 400);
      snap.value = clamp(Analog.snap(A(), right), 0, 255); exp.value = clamp(Analog.exp(A(), right) + 49, 50, 300);
    };
    st.apply = () => {
      Analog.setInv(A(), right ? 6 : 2, fx.checked); Analog.setInv(A(), right ? 8 : 4, fy.checked);
      Analog.setDeadzone(A(), right, dead.value); Analog.setOuter(A(), right, outer.value); Analog.setSnap(A(), right, snap.value); Analog.setExp(A(), right, clamp(exp.value - 49, 1, 251));
    };
    st.showCal = (msg, color) => {
      const mine = st.calibrated();
      bCal.querySelector('span').textContent = mine ? 'Stop' : 'Calibrate';
      const set = Analog.stickCalibrated(A(), right);
      stepL.classList.toggle('ok', !mine && !!set && !msg);
      stepL.textContent = mine ? 'Calibrating' : set ? 'Calibrated' : 'Not calibrated';
      infoL.style.color = color || '';
      infoL.textContent = msg || (mine
        ? 'Roll ' + (calSticks === 3 && hasRight ? 'both sticks' : 'the stick') + ' slowly around the edge 3 times, touching every corner, then click Stop.'
        : calibrating ? 'The other stick is being calibrated. This one keeps working as usual.'
        : set ? 'Hold the stick in a notch and click Angle set to line that notch up with it.' : 'Calibrate for the full range and accurate diagonals.');
    };
    async function angleSet() {
      if (calibrating) return st.showCal('Finish the calibration first.', 'var(--warn)');
      bAngle.disabled = true;
      const r = await dev.command(Blk.ANALOG, right ? 4 : 3, 1500);
      bAngle.disabled = false;
      if (!r.ok || !r.data) return st.showCal('Couldn\'t read the stick\'s position. Try again.', 'var(--bad)');
      const dv = new DataView(r.data.buffer, r.data.byteOffset), angle = dv.getFloat32(0, true), dist = dv.getFloat32(4, true);
      if (dist < 150) return st.showCal('The stick is near the centre: push it all the way against the notch first.', 'var(--warn)');
      const slot = Analog.nearestSlot(A(), right, angle);
      if (slot < 0) return st.showCal('This stick has no notches to adjust yet: calibrate the sticks first.', 'var(--bad)');
      const target = Analog.slotOutAngle(A(), right, slot);
      Analog.setSlotIn(A(), right, slot, angle, dist); changed(Blk.ANALOG);
      st.showCal(`The notch at ${Math.round(target)}° now matches your stick (${Math.round(angle)}°). Click Save to keep it.`, 'var(--good)');
    }
    // the gate, in the design's colors: dark field, grey outline, the output as an orange dot, the raw reading as a ring
    st.paint = () => {
      if (!present || page1.classList.contains('hidden')) return;
      if (st.calibrated() && Math.hypot(st.rx, st.ry) > 0.5) { st.trail.push([st.rx, st.ry]); if (st.trail.length > 3000) st.trail.shift(); }
      const r = cv.getBoundingClientRect(), z = parseFloat(getComputedStyle(document.getElementById('stage')).zoom) || 1, dpr = (window.devicePixelRatio || 1) * z;
      const W = r.width / z, H = r.height / z;
      if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
      const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
      const cx = W / 2, cy = W / 2, R = W / 2 - 6;
      const round = !(oct && oct.checked);
      const gate = () => { g.beginPath(); if (round) g.arc(cx, cy, R, 0, Math.PI * 2); else { for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; g[i ? 'lineTo' : 'moveTo'](cx + R * Math.cos(a), cy - R * Math.sin(a)); } g.closePath(); } };
      gate(); g.fillStyle = '#232323'; g.fill();
      g.lineWidth = 1; g.strokeStyle = '#353535';
      for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * R, cy - Math.sin(a) * R); g.stroke(); }
      gate(); g.lineWidth = 1.5; g.lineJoin = 'round'; g.strokeStyle = st.calibrated() ? '#fe6805' : '#c5c5c5'; g.stroke();
      const din = dead.value / 2047, dout = 1 - outer.value / 2047;
      g.setLineDash([4, 3]); g.lineWidth = 1.2;
      if (din > 0.003) { g.strokeStyle = 'rgba(254,104,5,.8)'; g.beginPath(); g.arc(cx, cy, R * din, 0, Math.PI * 2); g.stroke(); }
      if (dout < 0.997) { g.strokeStyle = 'rgba(40,166,255,.8)'; g.beginPath(); g.arc(cx, cy, R * dout, 0, Math.PI * 2); g.stroke(); }
      g.setLineDash([]);
      st.trail.forEach(([x, y], i) => { g.fillStyle = `rgba(40,166,255,${(26 + 150 * i / Math.max(1, st.trail.length - 1)) / 255})`; g.fillRect(cx + x * R - 1, cy - y * R - 1, 2, 2); });
      const place = (x, y) => { const m = Math.hypot(x, y); if (m > 1) { x /= m; y /= m; } return [cx + x * R, cy - y * R]; };
      const [rwx, rwy] = place(st.rx, st.ry), [ox, oy] = place(st.x, st.y);
      g.beginPath(); g.arc(rwx, rwy, 7, 0, Math.PI * 2); g.lineWidth = 1.5; g.strokeStyle = 'rgba(225,225,225,.75)'; g.stroke();
      g.beginPath(); g.arc(ox, oy, 6.5, 0, Math.PI * 2); g.fillStyle = '#fe6805'; g.fill(); g.lineWidth = 1.5; g.strokeStyle = '#2a2a2a'; g.stroke();
      const mag = Math.hypot(st.x, st.y); let ang = Math.atan2(st.y, st.x) * 180 / Math.PI; if (ang < 0) ang += 360;
      const f = v => (v > 0 ? '+' : '') + Math.round(v * 100);
      g.font = '600 9.5px Poppins'; g.fillStyle = '#cfcfcf'; g.textAlign = 'center';
      g.fillText(`X ${f(st.x)}%   Y ${f(st.y)}%   ${mag > 0.05 ? Math.round(ang) + '°' : 'centred'}`, cx, W + 12);
      g.font = '8.5px Poppins'; g.fillStyle = '#8a8a8a'; g.fillText('orange dot = output   ring = raw', cx, W + 25);
    };
    return st;
  }

  // ---------------------------------------------------------------- BACKUP page
  // Every settings block HOJA2 keeps (buttons, LEDs, sticks and their calibration, gyro, rumble, mode) in one file.
  // Import writes them all to the PadBox and saves them. A backup only goes back onto the same board (GS Essential
  // or GS Platform) running the same version of each block.
  const BACKUP_BLOCKS = { haptic: Blk.HAPTIC, imu: Blk.IMU, analog: Blk.ANALOG, rgb: Blk.RGB, gamepad: Blk.GAMEPAD, input: Blk.INPUT };
  const b64 = u => { let t = ''; for (let i = 0; i < u.length; i += 0x8000) t += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(t); };
  const unb64 = t => Uint8Array.from(atob(t), c => c.charCodeAt(0));
  const bStatus = el('p.hint.wrap');
  const bSay = (t, c) => { bStatus.textContent = t; bStatus.style.color = c || ''; };
  async function exportBackup() {
    clearTimeout(liveTimer); await pushLive();
    const blocks = {};
    for (const [k, b] of Object.entries(BACKUP_BLOCKS)) blocks[k] = b64(B[b]);
    const now = new Date(), p2 = n => String(n).padStart(2, '0'), day = now.getFullYear() + '-' + p2(now.getMonth() + 1) + '-' + p2(now.getDate());   // local date
    download('PadBox ' + lay.name + ' - HOJA2 backup ' + day + '.json', JSON.stringify({
      format: 'padbox-hoja2-backup', version: 1, board: lay.name, firmware: fw ? fw.toString(16).toUpperCase() : '', created: now.toISOString(), blocks }, null, 1));
    bSay('Backup saved to your downloads.' + (dirty.size ? ' It includes the changes you haven\x27t saved to the PadBox yet.' : ''), 'var(--good)');
  }
  async function importBackup() {
    if (calibrating) return bSay('Finish the stick calibration first.', 'var(--warn)');
    const text = await openFile('.json,application/json'); if (!text) return;
    let file; try { file = JSON.parse(text); } catch (e) { return bSay('This file isn\x27t a PadBox backup.', 'var(--bad)'); }
    if (!file || file.format !== 'padbox-hoja2-backup' || !file.blocks) return bSay('This file isn\x27t a HOJA2 backup. GP2040-CE and PhobGCC backups only go back onto those firmwares.', 'var(--bad)');
    if (file.board !== lay.name) return bSay('This backup is from a PadBox ' + file.board + ', and this is a PadBox ' + lay.name + ': their buttons differ, so it can\x27t be restored here.', 'var(--bad)');
    const data = {};
    for (const [k, b] of Object.entries(BACKUP_BLOCKS)) {
      let d; try { d = unb64(file.blocks[k] || ''); } catch (e) { d = null; }
      if (!d || d.length !== B[b].length) return bSay('This backup is incomplete or damaged (' + k + ' settings).', 'var(--bad)');
      if (d[0] !== B[b][0]) return bSay('This backup was made with a different HOJA2 version (' + k + ' settings), so it can\x27t be restored on this firmware.', 'var(--bad)');
      data[b] = d;
    }
    const when = file.created ? new Date(file.created).toLocaleString() : 'an unknown date';
    if (!await confirmBox('Import backup', 'This replaces every setting on the PadBox (buttons, LEDs, sticks and their calibration, gyro, rumble and mode) with the backup from ' + when + ', and saves it. Continue?', 'IMPORT')) return;
    bSay('Importing...', 'var(--warn)');
    clearTimeout(liveTimer); live.clear();
    for (const [b, d] of Object.entries(data)) { B[b] = d; await dev.writeBlock(+b, d.slice()); }
    loadUi();
    saving = true; btnSave.disabled = true;
    const r = await dev.command(Blk.GAMEPAD, 0xff, 4000);   // GAMEPAD_CMD_SAVE_ALL
    saving = false;
    if (r.ok) { dirty.clear(); bSay('Backup imported and saved to the PadBox.', 'var(--good)'); say('Backup imported and saved.', 'var(--good)'); }
    else { Object.values(BACKUP_BLOCKS).forEach(b => dirty.add(b)); bSay('The backup is on the PadBox now, but saving it failed: click Save to keep it after unplugging.', 'var(--bad)'); }
    refreshSave();
  }
  const page2 = el('div.page.hidden.dpage.backup', {}, [
    panel('BACKUP', [
      el('p.text', { text: 'Save all the PadBox\x27s settings (buttons, LEDs, sticks and their calibration, gyro, rumble and mode) to a file, or load them back. Importing replaces everything on the PadBox.' }),
      el('div.btnrow', {}, [pbtn('Export to file', 'upload', true, exportBackup), pbtn('Import from file', 'download', false, importBackup)]),
      bStatus,
    ]),
  ]);

  // ---------------------------------------------------------------- the side menu, load, live reports
  const pages = [page0, page1, page2];
  shell.content(el('div', { style: { position: 'absolute', inset: 0 } }, pages));
  let curTab = 0;
  shell.tabs(['CONTROLLER', 'STICKS', 'BACKUP'], i => {
    curTab = i; pages.forEach((p, k) => p.classList.toggle('hidden', k !== i));
    // the live report the open page needs: raw buttons for CONTROLLER, the sticks for STICKS
    dev.reportMode(i === 0 ? Rpt.INPUT_RAW : Rpt.INPUT_JOYSTICKS);
    pressed.fill(false);
  });
  // shows the settings in B on every page (at start, and after a backup is imported)
  function loadUi() {
    modeSel.value = String(MODES.some(m => m[1] === Gamepad.mode(B[Blk.GAMEPAD])) ? Gamepad.mode(B[Blk.GAMEPAD]) : 0);
    editProfile = profileOfMode(+modeSel.value);
    bright.value = clamp(Math.round(Rgb.brightness(B[Blk.RGB]) * 100 / 4096), 0, 100);
    speed.value = clamp(Rgb.speed(B[Blk.RGB]), 300, 5000);
    idle.checked = Rgb.idleGlow(B[Blk.RGB]) !== 0;
    showAllColor(Rgb.color(B[Blk.RGB], BOARD.led[10]));
    sticks.forEach(s => s.load());
    refreshSide(); refreshCal();
  }
  loadUi();
  say(mismatch ? 'This firmware doesn\'t match this app. Update it (the download button, top right) before changing anything.' : 'Changes apply to the PadBox right away. Click Save to keep them after unplugging.', mismatch ? 'var(--bad)' : '');

  dev.onRaw = p => {
    let fresh = -1;
    for (let i = 0; i < INPUTS; i++) { const d = (p[17 + i] & 0x80) !== 0; if (d && !pressed[i] && fresh < 0) fresh = i; pressed[i] = d; }
    const v = i => ((p[17 + i] & 0x7f) << 5) / 2048;
    stickXY[0] = [v(27) - v(28), v(29) - v(30)]; stickXY[1] = [v(32) - v(33), v(34) - v(35)];
    if (fresh >= 0 && types[fresh] !== IN.Joystick && types[fresh] !== IN.Hover && curTab === 0) select(fresh);
  };
  dev.onSticks = (lxR, lyR, rxR, ryR, lxS, lyS, rxS, ryS) => {
    Object.assign(sticks[0], { rx: lxR, ry: lyR, x: lxS, y: lyS }); Object.assign(sticks[1], { rx: rxR, ry: ryR, x: rxS, y: ryS });
  };
  dev.onLost = () => { if (alive) { alive = false; shell.lost('Lost the connection to the PadBox.'); } };
  const frame = () => { if (alive) sticks.forEach(s => s.paint()); };
  const loop = () => { if (!alive) return; frame(); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);

  return { stop() { alive = false; }, dirty: () => dirty.size > 0 };
}
