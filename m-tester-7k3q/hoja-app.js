// The HOJA2 PadBox Calibrator in the new design (Figma "PadBox Software", then the GS Essential Redesign: "PadBox HOJA2
// Essential.pdf"), for the PadBox GS Essential and GS Platform: the same frame, drawing and panels as gp-app.js, with
// HOJA2's settings - it started as a copy of js/hoja/app.js. CONTROLLER: the mode (in the menu beside the CONTROLLER
// button, named under the title), what each button does in that mode, its LED color, and the lighting (effect, color,
// idle glow, brightness, animation time). STICKS: calibration, ANGLE SET, deadzones, snapback and curve. BACKUP &
// RESTORE. Changes apply to the PadBox right away (written into its RAM); Save keeps them.

import { el, pickColor, hex, clamp, confirmBox, download, openFile } from './js/ui.js';
import { Blk, Rpt, DeviceInfo } from './js/hoja/device.js';
import { Analog, Rgb, Gamepad, Imu, Haptic, Input, IN, IN_TRIGGER, INPUTS, PROFILES, MODES, profileOfMode, RGB_MODES, OUTPUTS, assign, defaultInputTypes, gsEssential, gsPlatform, mEssential, mPlatform, VERSIONS } from './js/hoja/model.js';   // @M
// @GS import { Analog, Rgb, Gamepad, Input, IN, IN_TRIGGER, INPUTS, PROFILES, MODES, profileOfMode, RGB_MODES, OUTPUTS, assign, defaultInputTypes, gsEssential, gsPlatform, VERSIONS } from './js/hoja/model.js';
import { firmwareUpdate } from './js/update.js';
import { buildDrawing } from './drawing.js';
import { dicon } from './icons.js';
import { panel, dtoggle, dslider, pbtn, setPbtn, segmented, badge, paintGate, readout, backupPage, updateNotice } from './parts.js';

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
// @M{
// the PadBox M (js/hoja/model.js mEssential / mPlatform): the same slots for the shared buttons; the Essential's
// Thumb button on RP2, the Platform's C-stick on the right-stick codes and its A button on LP1
const M_ESSENTIAL = { input: { ...COMMON_IN, 18: 26, 19: 31, 15: 17, 44: 11 }, led: COMMON_LED,
  name: { ...COMMON_NAME, 44: 'Analog trigger', 18: 'Left stick click (L3)', 19: 'Right stick click (R3)', 15: 'Thumb', 21: 'Capture' } };
const M_PLATFORM = {
  input: { ...COMMON_IN, 18: 26, 32: 34, 30: 32, 31: 33, 33: 35, 19: 14, 44: 11 },   // 44: the analog trigger (IN_TRIGGER)
  led: { ...COMMON_LED, 32: 9, 30: 12, 31: 11, 33: 10, 19: 8 },
  name: { ...COMMON_NAME, 44: 'Analog trigger', 18: 'Left stick click (L3)', 32: 'C-stick up', 30: 'C-stick right', 31: 'C-stick left', 33: 'C-stick down', 19: 'A button', 21: 'Capture' },
};
// @M}
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
  const isM = name.startsWith('PadBox M ');   // @M
  // a PadBox on the HOJA2 it shipped with ("Padbox GS-C"): the connect screen opens "Update an older PadBox"
  const older = () => { const e = new Error('This PadBox runs an older HOJA ("' + name + '"). Install the latest firmware to set it up here.'); e.legacy = 'hoja'; return e; };
  if (name && !name.startsWith('PadBox GS ') && !isM) throw older();   // @M
  // @GS if (name && !name.startsWith('PadBox GS ')) throw older();
  const platform = /platf/i.test(name) || (!/essen/i.test(name) && !!ins && ins[32 * 10] === IN.Unused);
  const types = ins ? Array.from({ length: INPUTS }, (_, i) => ins[i * 10]) : defaultInputTypes(platform, !isM);   // @M
  // @GS const types = ins ? Array.from({ length: INPUTS }, (_, i) => ins[i * 10]) : defaultInputTypes(platform, true);
  const lay = isM ? (platform ? mPlatform() : mEssential()) : platform ? gsPlatform() : gsEssential();   // @M
  // @GS const lay = platform ? gsPlatform() : gsEssential();
  const hasRight = !platform;
  const BOARD = isM ? (platform ? M_PLATFORM : M_ESSENTIAL) : platform ? PLATFORM : ESSENTIAL;   // @M
  // @GS const BOARD = platform ? PLATFORM : ESSENTIAL;
  const mismatch = B[Blk.ANALOG][0] !== VERSIONS.analog || B[Blk.GAMEPAD][0] !== VERSIONS.gamepad || B[Blk.RGB][0] !== VERSIONS.rgb || B[Blk.INPUT][0] !== VERSIONS.input;

  shell.header('HOJA', 'PadBox' + lay.name.replace(/^GS /, '').replace(/ /g, ''), 'PadBox ' + lay.name + (fw ? '  •  firmware ' + fw.toString(16).toUpperCase() : '') + (opts.demo ? '  •  demo' : ''));
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
  const btnUpdate = iconBtn('outline', 'hdr-download', 'Update firmware', () => firmwareUpdate({ board: lay.board, current: 'HOJA2', enter: async noDrive => { alive = false; await dev.bootloader(noDrive); } }));
  const btnSave = iconBtn('save', 'hdr-save', 'Save to the PadBox', save); btnSave.disabled = true;
  const btnPower = iconBtn('light', 'hdr-power', 'Disconnect', async () => {
    if (dirty.size && !await confirmBox('Unsaved changes', 'Your changes work now but aren\'t saved: they\'ll be lost when the PadBox is unplugged. Disconnect anyway?', 'DISCONNECT')) return;
    shell.lost(null);
  });
  // the design's other two buttons. HOJA2 works as a controller while it's being set up, and shows LED changes right
  // away, so there's nothing to restart: the LED button sends any change still waiting, and "Restart as controller"
  // saves and closes the connection (the PadBox carries on as a controller)
  const btnPreview = iconBtn('light', 'hdr-beacon', 'Preview LED on the PadBox (HOJA shows LED changes right away)', async () => { clearTimeout(liveTimer); await pushLive(); say('The PadBox shows your LED settings now.', 'var(--good)'); });
  const btnExit = el('button.act.primary', { type: 'button', title: 'Save and finish: the PadBox carries on as a controller', html: dicon('hdr-gamepad') + '<span>Restart as controller</span>' });
  btnExit.addEventListener('click', async () => {
    if (dirty.size) { await save(); if (dirty.size) return; }
    alive = false; shell.lost('Saved. The PadBox is working as a controller: plug it back in or click CONNECT to set it up again.');
  });
  shell.actions([btnUpdate, btnSave, btnPreview, btnPower, btnExit]);
  // a newer firmware on the site: say so (HOJA2's fw_version is its build time)
  if (!opts.demo || /[?&]update/.test(location.search)) updateNotice({ board: lay.board, family: 'HOJA2', build: fw, button: btnUpdate, open: () => btnUpdate.click() });

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
    const own = { 2: 'D-pad up', 3: 'D-pad down', 5: 'D-pad left', 4: 'D-pad right' }[pin];
    if (own && o.name === own) return '';
    if (!platform && ((pin === 18 && o.short === 'LS') || (pin === 19 && o.short === 'RS'))) return '';
    if (pin === 22 && /^(L|LB|L1)$/.test(o.short)) return '';
    if (/^D-pad /.test(o.name)) return ARROWS[o.short] || o.short;
    const amt = amountOf(i);
    return amt != null && amt < 100 ? o.short.replace('~', '') + ' ' + amt + '%' : o.short;
  }, (isM ? 'm-' : '') + (platform ? 'platform' : 'essential'));   // @M
  // @GS }, platform ? 'platform' : 'essential');

  // the mode: which console the PadBox acts as, each with its own button mapping. The redesign chooses it in a menu
  // beside the CONTROLLER button (shell.tabs menus) and names it under the page's title, in the console's color.
  const MODE_MENU = [[0, 'Switch Pro', '#e60012'], [3, 'GameCube', '#8f7fd8'], [2, 'Slippi', '#21ba45'], [4, 'Nintendo 64', '#f2b705'],
    [5, 'SNES', '#b4a7e5'], [1, 'XInput (Xbox / PC)', '#52b043'], [6, 'SInput', '#28a6ff']];
  let curMode = 0;
  function showMode() {
    const mm = MODE_MENU.find(x => x[0] === curMode) || MODE_MENU[0];
    shell.sub('CONTROLLER', el('span', {}, ['Assign functions to each button and configure LED lighting', el('br'), 'in ', el('b.mode-name', { text: mm[1], style: { color: mm[2] } }), ' mode']));
  }
  function setMode(v) { curMode = v; editProfile = profileOfMode(v); Gamepad.setMode(B[Blk.GAMEPAD], v); changed(Blk.GAMEPAD); showMode(); refreshSide(); }
  const modeMenu = () => MODE_MENU.map(([v, text]) => ({ text, sel: v === curMode, pick: () => { if (v !== curMode) setMode(v); } }));

  // the right-hand column: BUTTON SETTINGS (or "No button selected"), then GLOBAL LED SETTINGS
  const empty = el('div.panel.empty', {}, [
    el('div.click-icon', { html: dicon('click') }),
    el('div.empty-t', { text: 'No button selected' }),
    el('div.empty-d', { text: 'Click a button on the controller or press\nit on the device to configure its function\nand LED lighting' }),
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
  const pressDot = el('i.dot'), pressTxt = el('span');
  const pressField = el('button.field.color', { type: 'button', disabled: true, title: 'HOJA lights a pressed button in its own color (Reactive effect)' }, [pressDot, pressTxt]);
  const ledBlock = el('div.led-block', {}, [
    el('div.lbl', { text: 'LED color' }),
    el('div.two', {}, [ledFieldBtn, pressField]),
    el('div.noled-note', { text: 'This button has no LED' }),
    el('div.two.caps', {}, [el('span', { text: 'Default color' }), el('span', { text: 'When pressed' })]),
  ]);
  ledFieldBtn.title = 'This button\x27s LED color (used by the Static and Reactive effects)';
  const btnResetMode = el('button.pbtn.primary', { type: 'button', html: dicon('sync') + '<span>Reset this button</span>' });
  btnResetMode.addEventListener('click', () => resetButton());
  const btnResetAll = el('button.pbtn.outline', { type: 'button', html: dicon('sync') + '<span>Reset all buttons</span>' });
  btnResetAll.addEventListener('click', () => resetModes([editProfile]));
  btnResetAll.title = 'Every button back to its default in this mode';
  const settingsPanel = el('div.panel.hidden', {}, [
    el('div.ptitle', { text: 'BUTTON SETTINGS' }),
    el('div.lbl', { text: 'Function' }), fn, amount.el,
    ledBlock,
    btnResetMode, btnResetAll,
    el('p.hint', { html: 'Click <b>Save</b> to keep your changes on the controller' }),
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
  const setAll = c => { if (colorRow.classList.contains('off')) return; showAllColor(c); for (let i = 0; i < 32; i++) Rgb.setColor(B[Blk.RGB], i, c); changed(Blk.RGB); refreshSide(); };
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
  // One color for every button only means something in Static and Reactive: Fairy, Rainbow and Authentic use their own
  // colors, so there the wheel is greyed out. (Fairy used to blend the first six buttons' colors, so painting them all
  // one color flattened it; since the 2026-10-05 firmware it has its own palette.)
  const colorRow = el('div.colorrow', {}, [wheel, el('div', {}, [el('div.readout', {}, [rgbTxt, hexTxt]), swatches])]);
  const colorLbl = el('span', { text: 'Color' });
  const ledPanel = el('div.panel.ledp', {}, [
    el('div.ptitle', { text: 'GLOBAL LED SETTINGS' }),
    el('div.lbl', { text: 'Lighting effect' }), effect,
    el('div.lbl.idle-row', {}, [colorLbl, idle.el]),
    colorRow,
    bright.el, speed.el,
  ]);
  const column = el('div.side-col', {}, [empty, settingsPanel, ledPanel]);
  const page0 = el('div.page.controller.hoja', {}, [drawing.svg, column]);

  function refreshSide() {
    const rb = B[Blk.RGB];
    effect.value = String(clamp(Rgb.mode(rb), 0, RGB_MODES.length - 1));
    speed.disabled = Rgb.mode(rb) < 2;   // only the animated effects use it
    const md = Rgb.mode(rb), oneColor = md === 1 || md === 3;   // Static, Reactive
    colorRow.classList.toggle('off', !oneColor);
    colorRow.title = oneColor ? '' : 'This effect uses its own colors';
    const none = selInput < 0;
    empty.classList.toggle('hidden', !none); settingsPanel.classList.toggle('hidden', none);
    column.classList.toggle('selected', !none); page0.classList.toggle('selected', !none);
    colorLbl.textContent = none ? 'Color' : 'LED color';   // as the design words it in each state
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
      if (led >= 0) { const c = Rgb.color(rb, led); ledDot.style.background = pressDot.style.background = hex(c); ledTxt.textContent = pressTxt.textContent = hex(c).toUpperCase(); }
    }
    drawing.refreshTips();
  }
  function select(i) { if (!selectable(i)) return; selInput = i; refreshSide(); }
  // one button back to its default in this mode: the firmware only resets a whole mode (MAPPER_CMD_DEFAULT_<mode>), so
  // that's done, this button's slot taken from it, and every other button put back as it was
  async function resetButton() {
    const i = selInput; if (i < 0) return;
    clearTimeout(liveTimer); await pushLive();
    const keep = B[Blk.INPUT].slice();
    btnResetMode.disabled = btnResetAll.disabled = true;
    const r = await dev.command(Blk.INPUT, 2 + editProfile, 1500);
    const fresh = r.ok ? await dev.readBlock(Blk.INPUT) : null;
    btnResetMode.disabled = btnResetAll.disabled = false;
    if (!fresh) { if (r.ok) await dev.writeBlock(Blk.INPUT, keep.slice()); return say('Couldn\'t reset the button - the PadBox didn\'t answer. Try again.', 'var(--bad)'); }
    const o = Input.offset(editProfile, i);
    keep.set(fresh.subarray(o, o + 5), o);
    B[Blk.INPUT] = keep; changed(Blk.INPUT); refreshSide();
    say('This button is back to its default in ' + PROFILES[editProfile] + ' mode. Click Save to keep it after unplugging.', 'var(--warn)');
  }
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

  // ---------------------------------------------------------------- the design's building blocks for the other pages: parts.js

  // ---------------------------------------------------------------- STICKS page
  // The redesign: one tall panel per stick - its name with Calibrated / Not calibrated, Enabled; the gate with the output
  // (orange dot) and the raw reading (ring); ANGLE SET; the axes; the gate's shape; deadzones, snapback and curve; then
  // Reset (back to this stick's settings as they were when connecting) and Calibrate. Each panel's Calibrate calibrates
  // that stick only; firmware from before the one-stick commands calibrates both sticks together instead.
  // the GS Platform has one stick: one wide panel, as in its design (the gate, its reading and ANGLE SET on the left,
  // the settings on the right)
  const sticks = [makeStick(false, hasRight ? 'LEFT STICK' : 'STICK'), makeStick(true, hasRight ? 'RIGHT STICK' : 'C-STICK')];
  if (!hasRight) { const c = sticks[0].card; c.classList.add('wide'); const body = c.querySelector('.stick-body'), rd = body.querySelector('.rd');
    rd.after(c.querySelector('.angle-row'), c.querySelector('p.angle-hint:not(.left)')); }
  const shownSticks = hasRight ? sticks : sticks.slice(0, 1);
  const page1 = el('div.page.hidden.dpage.sticks.hoja' + (hasRight ? '' : '.one'), {}, shownSticks.map(s => s.card));
  // SNAPBACK: its own page, a panel per stick (as in HOJA3's configurator)
  const pageSnap = el('div.page.hidden.dpage.snappage' + (hasRight ? '' : '.one'), {}, shownSticks.map(s => s.snapCard));
  // a snapback capture goes to its stick's analyzer (LX / LY: the left stick, RX / RY: the right)
  dev.onSnap = (axis, samples) => { const s = sticks[axis >= 2 ? 1 : 0]; if (s.present) s.snap(axis, samples); };
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
    const cv = el('canvas.gate'), tag = badge();
    const en = dtoggle('Enabled', v => { Analog.setDisabled(A(), right, !v); changed(Blk.ANALOG); showOn(); }, 'Disabled');
    const rd1 = el('div.rd1'), infoL = el('p.cal-info');
    const legend = el('div.rd2.legend', { html: '<i class="lg-dot"></i>Output<i class="lg-ring"></i>Raw' });
    const bCal = pbtn('Calibrate', 'target', true, () => toggleCalibrate(right));
    const bAngle = pbtn('Angle set', 'angle', true, angleSet);
    bAngle.classList.add('angle');
    const bReset = pbtn('Reset', 'sync', false, () => { st.load(st.start); st.apply(); changed(Blk.ANALOG); st.showCal('This stick\'s settings are back to how they were when you connected.'); });
    bReset.title = 'Put this stick\'s settings back to how they were when you connected';
    const fx = dtoggle('Flip X axis', v => { Analog.setInv(A(), right ? 6 : 2, v); changed(Blk.ANALOG); });
    const fy = dtoggle('Flip Y axis', v => { Analog.setInv(A(), right ? 8 : 4, v); changed(Blk.ANALOG); });
    // the gate drawn: round or octagonal (the left stick: octagonal by default on the GS Platform)
    const gate = segmented(['Round Gate', 'Octagonal Gate'], () => { });
    gate.value = !right && platform ? 1 : 0;
    const dz = v => (v * 100 / 2047).toFixed(1) + '%';
    const dead = dslider('Inner deadzone', 0, 400, dz, v => { Analog.setDeadzone(A(), right, v); changed(Blk.ANALOG); });
    const outer = dslider('Outer deadzone', 0, 400, dz, v => { Analog.setOuter(A(), right, v); changed(Blk.ANALOG); });
    const exp = dslider('Curve', 50, 300, v => (v / 100).toFixed(2), v => { Analog.setExp(A(), right, clamp(v - 49, 1, 251)); changed(Blk.ANALOG); });
    const offMsg = el('div.stick-off', {}, [el('div.off-icon', { html: dicon('nav-stick') }), el('div.empty-t', { text: 'Stick disabled' }),
      el('div.empty-d', { text: 'This stick is currently disabled. Enable it to access calibration, deadzone, and other input settings.' })]);
    // while calibrating, the steps take the settings' place
    const settingsBox = el('div.stick-set', {}, [
      el('div.angle-row', {}, [bAngle]), el('p.angle-hint', { text: 'Hold the stick in a notch, then click ANGLE SET to line that notch up with it' }),
      el('div.two.flips', {}, [fx.el, fy.el]), gate.el, dead.el, outer.el, exp.el,
      el('p.angle-hint.left', { text: 'Adjust how stick input responds around the centre' }),
]);
    exp.el.title = 'Adjust how stick input responds around the centre';
    // SNAPBACK: the filter that stops the stick bouncing past the centre when you let go (HOJA's snapback.c), and the
    // analyzer: the firmware records each flick's first 31 ms after you let go and sends it (dev.onSnap)
    const MODES = ['Low-pass', 'Auto', 'Off'];   // = l/r_snapback_type 0, 1, 2 (HOJA-LIB-RP2040-latest's snapback.c, which the PadBox builds with)
    const MODE_TIP = ['Low-pass: smooths fast movement near the centre (set how strongly with the cutoff)',
      'Auto: spots the moment you let go and holds back the rebound only then', 'Off: the stick\'s raw output, to see its natural snapback'];
    const snapMode = segmented(MODES, i => { Analog.setSnapType(A(), right, i); changed(Blk.ANALOG); showMode(); });
    const modeHint = el('p.snap-hint');
    // the cutoff: 30..150 Hz in 0.5 Hz steps (the slider counts half-hertz; stored in tenths)
    const cutoff = dslider('Filter cutoff', 60, 300, v => (v / 2).toFixed(1) + ' Hz', v => { Analog.setSnap(A(), right, v * 5); changed(Blk.ANALOG); });
    cutoff.el.title = 'Lower removes more bounce but adds a touch of delay to fast flicks near the centre; higher feels snappier but lets more rebound through. Default 60 Hz';
    const showMode = () => { const m = snapMode.value; cutoff.disabled = m !== 0; modeHint.textContent = MODE_TIP[m]; };
    const snapCv = el('canvas.snap-plot'), snapStats = el('div.snap-stats'), snapHist = el('div.snap-hist'), snapState = el('span.snap-state', { text: 'Listening' });
    const snapCard = panel(right ? (hasRight ? 'RIGHT STICK SNAPBACK' : 'C-STICK SNAPBACK') : (hasRight ? 'LEFT STICK SNAPBACK' : 'SNAPBACK'), [
      el('div.snap-set', {}, [el('p.snap-sub', { text: 'Stops the stick bouncing past the centre when you let it go. Changes apply right away: click Save to keep them.' }), el('div.lbl', { text: 'Filter mode' }), snapMode.el, modeHint, cutoff.el]),
      el('div.snap-an', {}, [el('div.snap-head', {}, [el('div.lbl', { text: 'Analyzer' }), snapState]),
        el('p.snap-hint', { text: 'Push the stick all the way to one side and let it snap back: the plot shows what it does in the 31 ms after you let go.' }),
        snapStats, snapCv, snapHist]),
    ], 'snapback');
    const controls = el('div.stick-ctl', {}, [settingsBox, infoL, el('div.btnrow.bottom', {}, [bReset, bCal])]);
    const absent = el('div.empty-d', { text: 'The C-stick is made of buttons, so there\'s nothing to calibrate.', style: { padding: '90px 0', textAlign: 'center' } });
    const body = el('div.stick-body', {}, [el('div.gate-wrap', {}, [cv]), el('div.rd', {}, [rd1, legend]), controls, offMsg]);
    const c = panel(title, [body, absent], 'stick');
    c.firstChild.append(tag.el, en.el);   // the badge and "Enabled" on the title row
    body.classList.toggle('hidden', !present); absent.classList.toggle('hidden', present); en.el.classList.toggle('hidden', !present); tag.el.classList.toggle('hidden', !present);
    const st = { card: c, snapCard, bCal, right, present, x: 0, y: 0, rx: 0, ry: 0, trail: [], start: null };
    // the analyzer: the latest capture drawn, its numbers, the last few to go back to
    const caps = [];
    let shown = null;
    function drawSnap() {
      const z = parseFloat(getComputedStyle(document.getElementById('stage')).zoom) || 1, r = snapCv.getBoundingClientRect();
      const W = r.width / z, H = r.height / z; if (W < 10) return;
      const dpr = (window.devicePixelRatio || 1) * z;
      if (snapCv.width !== Math.round(W * dpr)) { snapCv.width = Math.round(W * dpr); snapCv.height = Math.round(H * dpr); }
      const g = snapCv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
      const L = 30, T = 6, PW = W - L - 6, PH = H - T - 16, X = ms => L + ms / 31 * PW, Y = v => T + (1 - v) / 2 * PH;
      g.font = '7px Poppins, sans-serif'; g.fillStyle = '#8a8a8a'; g.lineWidth = 1;
      for (const v of [1, 0.5, 0, -0.5, -1]) { g.strokeStyle = v === 0 ? '#5a5a5a' : '#3a3a3a'; g.beginPath(); g.moveTo(L, Y(v)); g.lineTo(L + PW, Y(v)); g.stroke(); g.textAlign = 'right'; g.fillText((v > 0 ? '+' : '') + v * 100 + '%', L - 4, Y(v) + 2.5); }
      for (let ms = 0; ms <= 30; ms += 5) { g.strokeStyle = '#3a3a3a'; g.beginPath(); g.moveTo(X(ms), T); g.lineTo(X(ms), T + PH); g.stroke(); g.textAlign = 'center'; g.fillText(ms + ' ms', X(ms), T + PH + 11); }
      // the settle band: within 5 % of the centre
      g.fillStyle = 'rgba(52,222,131,.12)'; g.fillRect(L, Y(0.05), PW, Y(-0.05) - Y(0.05));
      if (!shown) { g.fillStyle = '#8a8a8a'; g.textAlign = 'center'; g.font = '9px Poppins, sans-serif'; g.fillText('Flick the stick...', L + PW / 2, T + PH / 2 - 6); return; }
      const s = shown.samples;
      g.beginPath(); g.moveTo(X(0), Y(0)); s.forEach((v, i) => g.lineTo(X(i * 0.5), Y(v))); g.lineTo(X((s.length - 1) * 0.5), Y(0)); g.closePath();
      g.fillStyle = 'rgba(254,104,5,.16)'; g.fill();
      g.beginPath(); s.forEach((v, i) => g[i ? 'lineTo' : 'moveTo'](X(i * 0.5), Y(v))); g.strokeStyle = '#fe6805'; g.lineWidth = 1.5; g.stroke();
    }
    // overshoot: how far it swings past the centre, the other way; settled: from when it stays within 5 % of the centre
    function stats(s) {
      const max = Math.max(...s), min = Math.min(...s), dir = Math.sign(s[0]) || 1;
      const over = Math.max(0, ...s.map(v => -dir * v));
      let last = -1; s.forEach((v, i) => { if (Math.abs(v) > 0.05) last = i; });
      return { over, settled: last === s.length - 1 ? null : (last + 1) * 0.5, max, min };
    }
    function showCap(c) {
      shown = c;
      const a = stats(c.samples), pc = v => Math.round(v * 100) + '%';
      snapStats.innerHTML = '';
      for (const [k, v] of [['Axis', c.name], ['Overshoot', pc(a.over)], ['Settled', a.settled == null ? '> 31 ms' : a.settled.toFixed(1) + ' ms'], ['Peak +', pc(Math.max(0, a.max))], ['Peak −', pc(Math.max(0, -a.min))]])
        snapStats.append(el('div', {}, [el('span', { text: k }), el('b', { text: v })]));
      for (const b of snapHist.children) b.classList.toggle('on', b.cap === c);
      drawSnap();
    }
    st.snap = (axis, samples) => {
      const c = { name: ['LX', 'LY', 'RX', 'RY'][axis], samples, mode: MODES[snapMode.value], time: new Date() };
      caps.unshift(c); caps.length = Math.min(caps.length, 6);
      snapHist.innerHTML = '';
      for (const k of caps) { const b = el('button.snap-cap', { type: 'button', text: k.name + '  ' + k.time.toTimeString().slice(3, 8) + '  ' + k.mode }); b.cap = k; b.addEventListener('click', () => showCap(k)); snapHist.append(b); }
      snapState.textContent = 'Captured'; snapState.classList.add('got');
      showCap(c);
    };
    st.drawSnap = drawSnap;
    new ResizeObserver(() => drawSnap()).observe(snapCv);   // drawn once the page shows it (and when the window changes)
    st.calibrated = () => calibrating && (calSticks & (right ? 2 : 1)) !== 0;   // this stick is being calibrated
    function showOn() { const on = en.checked; controls.classList.toggle('hidden', !on); offMsg.classList.toggle('hidden', on); }
    // this stick's settings: read from B (or from a copy kept at connect, for Reset)
    const read = () => ({ on: !Analog.disabled(A(), right), fx: Analog.inv(A(), right ? 6 : 2), fy: Analog.inv(A(), right ? 8 : 4),
      dead: clamp(Analog.deadzone(A(), right), 0, 400), outer: clamp(Analog.outer(A(), right), 0, 400), exp: clamp(Analog.exp(A(), right) + 49, 50, 300),
      // the mode as the firmware runs it (anything but 1 or 2 is low-pass there: snapback.c's default branch); the
      // cutoff as it's used (kept within 30..150 Hz)
      mode: [1, 2].includes(Analog.snapType(A(), right)) ? Analog.snapType(A(), right) : 0, cut: clamp(Math.round(Analog.snap(A(), right) / 5), 60, 300) });
    st.load = v => {
      v = v || read(); if (!st.start) st.start = v;
      en.checked = v.on; fx.checked = v.fx; fy.checked = v.fy;
      dead.value = v.dead; outer.value = v.outer; exp.value = v.exp; snapMode.value = v.mode; cutoff.value = v.cut; showMode();
      showOn();
    };
    st.apply = () => {
      Analog.setDisabled(A(), right, !en.checked);
      Analog.setInv(A(), right ? 6 : 2, fx.checked); Analog.setInv(A(), right ? 8 : 4, fy.checked);
      Analog.setDeadzone(A(), right, dead.value); Analog.setOuter(A(), right, outer.value); Analog.setSnapType(A(), right, snapMode.value); Analog.setSnap(A(), right, cutoff.value * 5); Analog.setExp(A(), right, clamp(exp.value - 49, 1, 251));
    };
    st.showCal = (msg, color) => {
      const mine = st.calibrated();
      setPbtn(bCal, mine ? 'Stop' : 'Calibrate', mine ? '' : 'target');
      const set = Analog.stickCalibrated(A(), right);
      tag.set(mine ? 'busy' : set ? 'ok' : 'no');
      // the steps in the panel while calibrating; anything else in the status line at the bottom
      const busy = mine || calibrating;
      settingsBox.classList.toggle('hidden', busy); infoL.classList.toggle('hidden', !busy); bReset.disabled = busy;
      infoL.style.color = color || '';
      infoL.textContent = busy ? msg || (mine
        ? 'Roll ' + (calSticks === 3 && hasRight ? 'both sticks' : 'the stick') + ' slowly around the edge 3 times, touching every corner, then click Stop.'
        : 'The other stick is being calibrated. This one keeps working as usual.') : '';
      if (!busy && msg) say(msg, color);
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
    // the gate (parts.js paintGate): the gate's shape in orange over a dashed reference circle, as in the design
    st.paint = () => {
      if (!present || page1.classList.contains('hidden')) return;
      if (st.calibrated() && Math.hypot(st.rx, st.ry) > 0.5) { st.trail.push([st.rx, st.ry]); if (st.trail.length > 3000) st.trail.shift(); }
      paintGate(cv, { round: gate.value === 0, din: dead.value / 2047, dout: 1 - outer.value / 2047, out: [st.x, st.y], raw: [st.rx, st.ry],
        trail: st.trail, gate: '#fe6805', ref: true, off: !en.checked });
      const r = readout(st.x, st.y);
      rd1.textContent = r.xy + (r.angle ? '     ' + r.angle : '');
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
  const file = () => {
    const blocks = {};
    for (const [k, b] of Object.entries(BACKUP_BLOCKS)) blocks[k] = b64(B[b]);
    return { format: 'padbox-hoja2-backup', version: 1, board: lay.name, firmware: fw ? fw.toString(16).toUpperCase() : '', created: new Date().toISOString(), blocks };
  };
  const checkFile = f => {
    if (!f || f.format !== 'padbox-hoja2-backup' || !f.blocks) return 'This file isn\x27t a HOJA configuration file. GP2040-CE and PhobGCC files only go back onto those firmwares.';
    if (f.board !== lay.name) return 'This configuration is from a PadBox ' + f.board + ', and this is a PadBox ' + lay.name + ': their buttons differ, so it can\x27t be restored here.';
    if (calibrating) return 'Finish the stick calibration first.';
    for (const [k, b] of Object.entries(BACKUP_BLOCKS)) {
      let d; try { d = unb64(f.blocks[k] || ''); } catch (e) { d = null; }
      if (!d || d.length !== B[b].length) return 'This configuration is incomplete or damaged (' + k + ' settings).';
      if (d[0] !== B[b][0]) return 'This configuration was made with a different HOJA version (' + k + ' settings), so it can\x27t be restored on this firmware.';
    }
    return '';
  };
  async function restoreFile(f) {
    const data = {};
    for (const [k, b] of Object.entries(BACKUP_BLOCKS)) data[b] = unb64(f.blocks[k]);
    clearTimeout(liveTimer); live.clear();
    for (const [b, d] of Object.entries(data)) { B[b] = d; await dev.writeBlock(+b, d.slice()); }
    loadUi();
    saving = true; btnSave.disabled = true;
    const r = await dev.command(Blk.GAMEPAD, 0xff, 4000);   // GAMEPAD_CMD_SAVE_ALL
    saving = false;
    if (!r.ok) { Object.values(BACKUP_BLOCKS).forEach(b => dirty.add(b)); refreshSave(); throw new Error('the configuration is on the PadBox now, but saving it failed: click Save to keep it after unplugging'); }
    dirty.clear(); refreshSave(); say('Configuration restored and saved.', 'var(--good)');
    return 'Configuration restored and saved to the PadBox.';
  }
  const backup = backupPage({
    controller: 'HOJA2', board: lay.name, firmware: fw ? fw.toString(16).toUpperCase() : '', mode: () => (MODE_MENU.find(x => x[0] === curMode) || MODE_MENU[0])[1],
    exportData: async () => { clearTimeout(liveTimer); await pushLive(); return file(); },
    fileName: name => 'PadBox ' + lay.name + ' - HOJA - ' + name.replace(/[\\/:*?"<>|]/g, '_') + '.json',
    check: checkFile, restore: restoreFile,
  });
  const page2 = backup.page;

  // @M{
  // ---------------------------------------------------------------- TRIGGER, GYRO and RUMBLE pages (the PadBox M only)
  // The same pages as the desktop Suite and the previous app, in this design: the analog trigger's range, the motion
  // sensor (live 3D view, sensitivity, gyro calibration) and the rumble.
  const hov = isM ? await dev.readBlock(Blk.HOVER) : null;   // hoverConfig_s: [1] = the analog trigger has been calibrated
  if (hov) { B[Blk.HOVER] = hov; BACKUP_BLOCKS.hover = Blk.HOVER; }   // the trigger calibration goes into backups too
  const pctF = v => v + '%';
  const offSlider = (s, off) => { s.el.classList.toggle('off', off); s.el.querySelector('input').disabled = off; };

  // TRIGGER: released = 0 %, pressed all the way = 100 % (the firmware learns the range while calibrating)
  let trigValue = 0, trigCalibrating = false, trigCalibrated = !!(hov && hov[1]);
  const tFill = el('i'), tPct = el('span.tpct', { text: '0%' });
  const tStep = el('div.step'), tInfo = el('div.info');
  const tBtn = pbtn('Calibrate', '', true, () => trigCalibrating ? trigDone() : trigStart());
  const mTrigPage = el('div.page.hidden.dpage.mtrig', {}, [
    panel('TRIGGER CALIBRATION', [
      el('p.text', { text: 'Sets the two ends of the analog trigger: released = 0%, pressed all the way = 100%.' }),
      el('div.tbar-row', {}, [el('div.tbar', {}, [tFill]), tPct]),
      tStep, tInfo, el('div.btnrow', {}, [tBtn]),
    ]),
  ]);
  function refreshTrig(msg, color) {
    tBtn.querySelector('span').textContent = trigCalibrating ? 'Done' : 'Calibrate';
    tStep.textContent = trigCalibrating ? 'Calibrating' : trigCalibrated ? 'Calibrated' : 'Not calibrated';
    tStep.classList.toggle('ok', !trigCalibrating && trigCalibrated);
    tInfo.style.color = color || '';
    tInfo.textContent = msg || (trigCalibrating
      ? '1. Let go of the trigger completely.\n2. Press it all the way down, hold it a moment, and let go. Do it two or three times.\n3. Click Done.'
      : trigCalibrated ? 'A full press reaches 100%. Calibrate again if it doesn\'t.' : 'A full press may not reach 100%. Click Calibrate, then follow the steps shown here. Don\'t touch the trigger while you click it.');
  }
  async function trigStart() {
    tBtn.disabled = true;
    const r = await dev.command(Blk.HOVER, 0x40 | IN_TRIGGER, 2000);   // start learning the trigger
    tBtn.disabled = false;
    if (r.ok) { trigCalibrating = true; refreshTrig(); } else refreshTrig('The PadBox didn\'t start the trigger calibration. Try again.', 'var(--bad)');
  }
  async function trigDone() {
    tBtn.disabled = true;
    const r = await dev.command(Blk.HOVER, 0x00, 2000);   // stop and apply the new range
    tBtn.disabled = false;
    if (r.ok) { trigCalibrating = false; trigCalibrated = true; if (B[Blk.HOVER]) B[Blk.HOVER][1] = 1; markUnsaved(Blk.HOVER); refreshTrig('Trigger calibrated. Click Save to keep it after unplugging.', 'var(--good)'); }
    else refreshTrig('The PadBox didn\'t confirm the end of the calibration. Click Done again.', 'var(--bad)');
  }

  // GYRO: the orientation is worked out here from the raw IMU readings in every live report (js/hoja/gyro.js)
  let gyro = null, fusion = null, ImuFusion = null, lastImuT = -1, autoCentreIn = 0, imuCalibrating = false, imuTextCount = 0;
  const gyroCanvas = el('canvas'), gyroMsg = el('div.gyro-msg', { text: 'Loading 3D model...' });
  const gyroInfo = el('p.hint', { text: 'Tilt the PadBox to see it move.' });
  const imuOn = dtoggle('On', v => { Imu.setDisabled(B[Blk.IMU], !v); enableImu(); changed(Blk.IMU); });
  imuOn.el.title = 'Gyro and accelerometer on';
  const gyroSens = ['X', 'Y', 'Z'].map((a, k) => dslider('Gyro ' + a + ' axis', 50, 200, pctF, v => { Imu.setGyroSens(B[Blk.IMU], k, v); changed(Blk.IMU); }));
  const accSens = ['X', 'Y', 'Z'].map((a, k) => dslider('Accelerometer ' + a + ' axis', 50, 200, pctF, v => { Imu.setAccelSens(B[Blk.IMU], k, v); changed(Blk.IMU); }));
  const imuCal = pbtn('Calibrate gyro', '', true, calibrateGyro);
  const imuStatus = el('p.hint.wrap', { text: 'If the view slowly drifts: put the PadBox on a flat table, don\'t touch it, and click Calibrate gyro.' });
  const viewPanel = panel('LIVE ORIENTATION', [el('div.gyro-view', {}, [gyroCanvas, gyroMsg]),
    el('div.btnrow', {}, [pbtn('Centre view', '', false, () => gyro && gyro.centre())]), gyroInfo]);
  const motionPanel = panel('MOTION CONTROLS', [
    el('div.lbl', { text: 'Gyro sensitivity (default 120%)' }), ...gyroSens.map(s => s.el),
    el('div.lbl', { text: 'Accelerometer sensitivity (default 100%)', style: { marginTop: '10px' } }), ...accSens.map(s => s.el),
    el('div.btnrow', { style: { marginTop: '12px' } }, [imuCal]), imuStatus]);
  motionPanel.firstChild.append(imuOn.el);   // "On" on the title row, like "Stick enabled"
  const mGyroPage = el('div.page.hidden.dpage.mgyro', {}, [viewPanel, motionPanel]);
  function enableImu() { const off = !imuOn.checked; for (const s of [...gyroSens, ...accSens]) offSlider(s, off); imuCal.disabled = off; }
  function loadGyro() {
    imuOn.checked = !Imu.disabled(B[Blk.IMU]);
    gyroSens.forEach((s, k) => s.value = clamp(Imu.gyroSens(B[Blk.IMU], k), 50, 200));
    accSens.forEach((s, k) => s.value = clamp(Imu.accelSens(B[Blk.IMU], k), 50, 200));
    enableImu();
  }
  async function openGyro() {
    if (gyro) return;
    const G = await import('./js/hoja/gyro.js');
    ImuFusion = G.ImuFusion; gyro = new G.GyroView(gyroCanvas); fusion = new ImuFusion();
    if (!gyro.ok) { gyroMsg.textContent = 'This browser can\'t draw the 3D view (WebGL 2 is off).'; return; }
    try {
      const r = await fetch('./assets/padbox.stl'); if (!r.ok) throw new Error();
      const mesh = G.loadStl(await r.arrayBuffer()); if (!mesh) throw new Error();
      gyro.setMesh(mesh); gyroMsg.classList.add('hidden');
    } catch (e) { gyroMsg.textContent = 'Could not read the 3D model.'; }
  }
  async function calibrateGyro() {
    clearTimeout(liveTimer); await pushLive();
    imuCal.disabled = true; imuCalibrating = true;
    imuStatus.textContent = 'Calibrating: keep the PadBox completely still...'; imuStatus.style.color = 'var(--warn)';
    // IMU_CMD_CALIBRATE_START only answers once it has finished; the new offsets are in the RAM copy, so read them back
    const r = await dev.command(Blk.IMU, 1, 15000);
    const fresh = r.ok ? await dev.readBlock(Blk.IMU) : null;
    imuCalibrating = false; if (fusion) fusion.reset(); lastImuT = -1;
    if (fresh) { B[Blk.IMU] = fresh; loadGyro(); markUnsaved(Blk.IMU); imuStatus.textContent = 'Gyro calibrated. Click Save to keep it after unplugging.'; imuStatus.style.color = 'var(--good)'; }
    else { enableImu(); imuStatus.textContent = 'The PadBox didn\'t report back. Make sure it\'s still, then try again.'; imuStatus.style.color = 'var(--bad)'; }
  }
  // every live report: bytes 3-14 are the accelerometer and gyro, straight from the firmware's standard IMU mode
  function onImu(p) {
    if (curName !== 'GYRO' || !fusion || imuCalibrating) { lastImuT = -1; return; }
    const now = performance.now() / 1000;
    if (lastImuT < 0) autoCentreIn = 50;   // page just opened: centre once the estimate has settled
    const dt = lastImuT < 0 ? 0 : Math.min(0.05, now - lastImuT); lastImuT = now;
    const s16 = o => { const v = p[o] | (p[o + 1] << 8); return v > 32767 ? v - 65536 : v; };
    const I = B[Blk.IMU], gs3 = k => clamp(Imu.gyroSens(I, k), 50, 200), as3 = k => clamp(Imu.accelSens(I, k), 50, 200);
    // undo the sensitivity %, so the model turns exactly as far as the PadBox does
    const gx = s16(9) * 100 / gs3(0), gy = s16(11) * 100 / gs3(1), gz = s16(13) * 100 / gs3(2);
    const ax = s16(3) * 100 / as3(0), ay = s16(5) * 100 / as3(1), az = s16(7) * 100 / as3(2);
    fusion.update(ImuFusion.toModel(ax, ay, az), ImuFusion.toModel(gx, gy, gz), 4096 /* +-8 g */, dt);
    gyro.setOrientation(fusion.q);
    if (autoCentreIn > 0 && --autoCentreIn === 0) gyro.centre();
    if (++imuTextCount % 12 === 0) gyroInfo.textContent = 'accelerometer ' + (Math.hypot(ax, ay, az) / 4096).toFixed(2) + ' g     gyro ' + Math.round(gx * 0.061) + ' / ' + Math.round(gy * 0.061) + ' / ' + Math.round(gz * 0.061) + ' °/s';
  }

  // RUMBLE: on / off and its strength (for all rumble, games included), with a one-second test
  const pctToStrength = pct => clamp(Math.round(pct * 255 / 100), 1, 255);
  const hapOn = dtoggle('On', v => { offSlider(hapStrength, !v); hapTest.disabled = !v; Haptic.setStrength(B[Blk.HAPTIC], v ? pctToStrength(hapStrength.value) : 0); changed(Blk.HAPTIC); });
  hapOn.el.title = 'Rumble on';
  const hapStrength = dslider('Strength', 1, 100, pctF, v => { if (!hapOn.checked) return; Haptic.setStrength(B[Blk.HAPTIC], pctToStrength(v)); changed(Blk.HAPTIC); });
  const hapTest = pbtn('Test', '', true, async () => {
    clearTimeout(liveTimer); await pushLive();   // test at the strength shown, not the last one sent
    hapTest.disabled = true; hapTest.querySelector('span').textContent = 'Buzzing...';
    await dev.command(Blk.HAPTIC, 1, 2500);   // HAPTIC_CMD_TEST_STRENGTH
    hapTest.querySelector('span').textContent = 'Test'; hapTest.disabled = !hapOn.checked;
  });
  // the click felt when a trigger is pressed (the analog trigger, and the 3K / 4K trigger buttons): on by default
  const hapTrig = dtoggle('Vibrate when a trigger is pressed', v => { Haptic.setTriggers(B[Blk.HAPTIC], v); changed(Blk.HAPTIC); });
  hapTrig.el.title = 'A short click on the motor each time the analog trigger or a trigger button (LT / RT) is pressed';
  const rumblePanel = panel('RUMBLE', [hapStrength.el, el('div.btnrow', { style: { marginTop: '12px' } }, [hapTest]),
    el('p.hint.wrap', { text: 'Test buzzes for one second at the strength above. This strength applies to all rumble, including in games.' }),
    el('div', { style: { height: '12px' } }), hapTrig.el,
    el('p.hint.wrap', { text: 'A short click each time the analog trigger or a trigger button (LT / RT) is pressed. Turn it off to stop it.' })]);
  rumblePanel.firstChild.append(hapOn.el);
  const mRumblePage = el('div.page.hidden.dpage.mtrig', {}, [rumblePanel]);
  function loadRumble() {
    const st = Haptic.strength(B[Blk.HAPTIC]);
    hapOn.checked = st > 0; hapStrength.value = st > 0 ? clamp(Math.round(st * 100 / 255), 1, 100) : 100;
    offSlider(hapStrength, !hapOn.checked); hapTest.disabled = !hapOn.checked;
    hapTrig.checked = Haptic.triggers(B[Blk.HAPTIC]);
  }
  function mLoad() { refreshTrig(); loadGyro(); loadRumble(); }
  // @M}

  // ---------------------------------------------------------------- the side menu, load, live reports
  const tabNames = ['CONTROLLER', 'STICKS', 'SNAPBACK', 'BACKUP & RESTORE'], pages = [page0, page1, pageSnap, page2];
  if (isM) { tabNames.splice(3, 0, 'TRIGGER', 'GYRO', 'RUMBLE'); pages.splice(3, 0, mTrigPage, mGyroPage, mRumblePage); }   // @M
  shell.content(el('div', { style: { position: 'absolute', inset: 0 } }, pages));
  let curTab = 0, curName = 'CONTROLLER';
  shell.tabs(tabNames, i => {
    curTab = i; curName = tabNames[i]; pages.forEach((p, k) => p.classList.toggle('hidden', k !== i));
    // the live report the open page needs: raw buttons for CONTROLLER (and the trigger), the sticks otherwise
    dev.reportMode(curName === 'CONTROLLER' || curName === 'TRIGGER' ? Rpt.INPUT_RAW : Rpt.INPUT_JOYSTICKS);
    if (curName === 'TRIGGER') dev.focus(IN_TRIGGER);   // its full value in bytes 15-16   // @M
    if (curName === 'GYRO') openGyro();   // @M
    pressed.fill(false);
  }, null, { 0: modeMenu });
  // shows the settings in B on every page (at start, and after a backup is imported)
  function loadUi() {
    curMode = MODES.some(m => m[1] === Gamepad.mode(B[Blk.GAMEPAD])) ? Gamepad.mode(B[Blk.GAMEPAD]) : 0;
    editProfile = profileOfMode(curMode); showMode();
    bright.value = clamp(Math.round(Rgb.brightness(B[Blk.RGB]) * 100 / 4096), 0, 100);
    speed.value = clamp(Rgb.speed(B[Blk.RGB]), 300, 5000);
    idle.checked = Rgb.idleGlow(B[Blk.RGB]) !== 0;
    showAllColor(Rgb.color(B[Blk.RGB], BOARD.led[10]));
    sticks.forEach(s => s.load());
    refreshSide(); refreshCal();
    if (isM) mLoad();   // @M
  }
  loadUi();
  say(mismatch ? 'This firmware doesn\'t match this app. Update it (the download button, top right) before changing anything.' : '', mismatch ? 'var(--bad)' : '');
  // the demo: ?sel=<pin> opens with that button selected
  { const q = opts.demo && /[?&]sel=(\d+)/.exec(location.search); if (q) select(inputOf(+q[1])); }

  // @M{
  if (isM) dev.onFrame = onImu;
  // @M}
  dev.onRaw = p => {
    // @M{
    if (curName === 'TRIGGER') {   // the focused trigger: its full value (0..4095, after the firmware's calibration) in bytes 15-16
      let tv = ((p[15] << 8) | p[16]) & 0x0fff;
      if (tv === 0 && (p[17 + IN_TRIGGER] & 0x7f)) tv = (p[17 + IN_TRIGGER] & 0x7f) << 5;   // focus not taken yet
      trigValue = tv;
    }
    // @M}
    let fresh = -1;
    for (let i = 0; i < INPUTS; i++) { const d = (p[17 + i] & 0x80) !== 0; if (d && !pressed[i] && fresh < 0) fresh = i; pressed[i] = d; }
    const v = i => ((p[17 + i] & 0x7f) << 5) / 2048;
    stickXY[0] = [v(27) - v(28), v(29) - v(30)]; stickXY[1] = [v(32) - v(33), v(34) - v(35)];
    // @M{
    // the PadBox M's analog trigger (a hover input, already scaled by its calibration in the firmware)
    if (isM && types[IN_TRIGGER] === IN.Hover) {   // 0..100% only when its function is an analog output, else pressed or not
      const o = OUTPUTS[editProfile][Input.code(B[Blk.INPUT], editProfile, IN_TRIGGER)], analog = !!o && ANALOG_OUT(o.type);
      drawing.setTrigger(!o ? 0 : analog ? (p[17 + IN_TRIGGER] & 0x7f) / 127 : (p[17 + IN_TRIGGER] & 0x80 ? 1 : 0), analog);
    }
    // @M}
    if (fresh >= 0 && types[fresh] !== IN.Joystick && types[fresh] !== IN.Hover && curTab === 0) select(fresh);
  };
  dev.onSticks = (lxR, lyR, rxR, ryR, lxS, lyS, rxS, ryS) => {
    Object.assign(sticks[0], { rx: lxR, ry: lyR, x: lxS, y: lyS }); Object.assign(sticks[1], { rx: rxR, ry: ryR, x: rxS, y: ryS });
  };
  dev.onLost = () => { if (alive) { alive = false; shell.lost('Lost the connection to the PadBox.'); } };
  const frame = () => {
    if (!alive) return;
    sticks.forEach(s => s.paint());
    // @M{
    if (curName === 'TRIGGER') { const v = clamp(trigValue / 4095, 0, 1); tFill.style.width = (v * 100) + '%'; tPct.textContent = Math.round(v * 100) + '%'; }
    if (curName === 'GYRO' && gyro) gyro.frame();
    // @M}
  };
  const loop = () => { if (!alive) return; frame(); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);

  return { stop() { alive = false; }, dirty: () => dirty.size > 0 };
}
