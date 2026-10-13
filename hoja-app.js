// The HOJA2 PadBox Calibrator in the new design (Figma "PadBox Software", then the GS Essential Redesign: "PadBox HOJA2
// Essential.pdf"), for the PadBox GS Essential and GS Platform: the same frame, drawing and panels as gp-app.js, with
// HOJA2's settings - it started as a copy of js/hoja/app.js. CONTROLLER: the mode (in the menu beside the CONTROLLER
// button, named under the title), what each button does in that mode, its LED color, and the lighting (effect, color,
// idle glow, brightness, animation time). STICKS: calibration, ANGLE SET, deadzones, snapback and curve. BACKUP &
// RESTORE. Changes apply to the PadBox right away (written into its RAM); Save keeps them.

import { el, pickColor, hex, clamp, confirmBox, download, openFile } from './js/ui.js';
import { Blk, Rpt, DeviceInfo } from './js/hoja/device.js';
import { Analog, Rgb, Gamepad, Input, IN, IN_TRIGGER, INPUTS, PROFILES, MODES, SWITCH_COLORS, profileOfMode, RGB_MODES, OUTPUTS, assign, defaultInputTypes, gsEssential, gsPlatform, gsNs, VERSIONS } from './js/hoja/model.js';
import { firmwareUpdate } from './js/update.js';
import { buildDrawing } from './drawing.js';
import { dicon } from './icons.js';
import { $t, $tn, $tNodes } from './js/i18n.js';
import { panel, dtoggle, dslider, pbtn, setPbtn, segmented, badge, paintGate, readout, backupPage, updateNotice } from './parts.js';

// The drawing's buttons (named by their GP2040-CE GPIO, see drawing.js) -> HOJA2's input slots and LED numbers
// (js/hoja/model.js gsEssential / gsPlatform)
const COMMON_IN = { 10: 2, 11: 3, 12: 9, 13: 8, 6: 0, 7: 1, 8: 12, 9: 10, 2: 4, 3: 5, 5: 6, 4: 7, 17: 18, 16: 19, 20: 20, 21: 21, 22: 15 };
const COMMON_LED = { 10: 0, 11: 1, 12: 2, 13: 3, 6: 4, 7: 5, 8: 6, 9: 7 };
const COMMON_NAME = { 10: '1P', 11: '2P', 12: '3P', 13: '4P', 6: '1K', 7: '2K', 8: '3K', 9: '4K', 2: 'D-pad up', 3: 'D-pad down', 5: 'D-pad left', 4: 'D-pad right',
  17: 'Start', 16: 'Select', 20: 'Home', 21: 'Touchpad', 22: 'Bumper' };
// the PadBox GS NS (js/hoja/model.js gsNs): the GS Essential without sticks, so without its stick clicks
const NS = { input: COMMON_IN, led: COMMON_LED, name: COMMON_NAME };
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
  shell.footer($t('Reading settings...'));
  const info = await dev.readStatic(DeviceInfo.Block, DeviceInfo.Size);
  const ins = await dev.readStatic(DeviceInfo.InputBlock, DeviceInfo.InputSize);
  const B = {};
  for (const b of [Blk.HAPTIC, Blk.IMU, Blk.ANALOG, Blk.RGB, Blk.GAMEPAD, Blk.INPUT]) {
    let r = await dev.readBlock(b); if (!r) r = await dev.readBlock(b);
    if (!r) throw new Error($t('The PadBox didn\'t send its settings. Unplug it, plug it back in and try again. If it keeps happening, reinstall the firmware (Update firmware).'));
    B[b] = r;
  }
  const name = info ? new TextDecoder().decode(info.subarray(0, 16)).replace(/\0.*$/, '').trim() : '';
  const fw = info ? (info[704] | (info[705] << 8) | (info[706] << 16) | (info[707] << 24)) >>> 0 : 0;
  // which board, from its product name ("PadBox GS Essent", "PadBox GS Platfo"), or from whether it has a right stick
  // a PadBox on the HOJA2 it shipped with ("Padbox GS-C"): the connect screen opens "Update an older PadBox"
  const older = () => { const e = new Error($t('This PadBox runs an older HOJA ("{0}"). Install the latest firmware to set it up here.', name)); e.legacy = 'hoja'; return e; };
  if (name && !name.startsWith('PadBox GS ')) throw older();
  const ns = /^PadBox GS NS/.test(name);   // the PadBox GS NS: a GS Essential without sticks (its stick inputs are unused too, like the Platform's right stick)
  const platform = !ns && (/platf/i.test(name) || (!/essen/i.test(name) && !!ins && ins[32 * 10] === IN.Unused));
  const types = ins ? Array.from({ length: INPUTS }, (_, i) => ins[i * 10]) : defaultInputTypes(platform, true);
  const lay = ns ? gsNs() : platform ? gsPlatform() : gsEssential();
  const hasRight = !platform;
  const BOARD = ns ? NS : platform ? PLATFORM : ESSENTIAL;
  const mismatch = B[Blk.ANALOG][0] !== VERSIONS.analog || B[Blk.GAMEPAD][0] !== VERSIONS.gamepad || B[Blk.RGB][0] !== VERSIONS.rgb || B[Blk.INPUT][0] !== VERSIONS.input;

  shell.header('HOJA', 'PadBox' + (ns ? lay.name : lay.name.replace(/^GS /, '')).replace(/ /g, ''));   // "PadBoxEssential"; the GS NS in full: "PadBoxGSNS"
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
    if (dirty.size && !saving) say($t('Unsaved changes - click Save to send them to the controller.'), 'var(--warn)');
  }
  function say(t, c) { shell.footer(t, c); }
  async function save() {
    clearTimeout(liveTimer); await pushLive();
    saving = true; btnSave.disabled = true; say($t('Saving to the PadBox...'), 'var(--warn)');
    const r = await dev.command(Blk.GAMEPAD, 0xff, 4000);   // GAMEPAD_CMD_SAVE_ALL
    saving = false;
    if (r.ok) { dirty.clear(); say($t('Saved. Your settings stay on the PadBox after unplugging.'), 'var(--good)'); }
    else say($t('Saving failed: the PadBox didn\'t confirm. Try again.'), 'var(--bad)');
    refreshSave();
  }

  // ---------------------------------------------------------------- header buttons (the design's icon buttons)
  const iconBtn = (cls, ic, title, onclick) => { const b = el('button.act.' + cls, { type: 'button', title, html: dicon(ic) }); b.addEventListener('click', onclick); return b; };
  const btnUpdate = iconBtn('outline', 'hdr-download', $t('Update firmware'), () => firmwareUpdate({ board: lay.board, current: 'HOJA2', enter: async noDrive => { alive = false; await dev.bootloader(noDrive); } }));
  const btnSave = iconBtn('save', 'hdr-save', $t('Save to the PadBox'), save); btnSave.disabled = true;
  const btnPower = iconBtn('light', 'hdr-power', $t('Disconnect'), async () => {
    if (dirty.size && !await confirmBox($t('Unsaved changes'), $t('Your changes work now but aren\'t saved: they\'ll be lost when the PadBox is unplugged. Disconnect anyway?'), $t('DISCONNECT'))) return;
    shell.lost(null);
  });
  // the design's other two buttons. HOJA2 works as a controller while it's being set up, and shows LED changes right
  // away, so there's nothing to restart: the LED button sends any change still waiting, and "Restart as controller"
  // saves and closes the connection (the PadBox carries on as a controller)
  const btnPreview = iconBtn('light', 'hdr-beacon', $t('Preview LED on the PadBox (HOJA shows LED changes right away)'), async () => { clearTimeout(liveTimer); await pushLive(); say($t('The PadBox shows your LED settings now.'), 'var(--good)'); });
  const btnExit = el('button.act.primary', { type: 'button', title: $t('Save and finish: the PadBox carries on as a controller'), html: dicon('hdr-gamepad') + '<span>' + $t('Restart as controller') + '</span>' });
  btnExit.addEventListener('click', async () => {
    if (dirty.size) { await save(); if (dirty.size) return; }
    alive = false; shell.lost($t('Saved. The PadBox is working as a controller: plug it back in or click CONNECT to set it up again.'));
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
    return $tn(BOARD.name[pin] || 'Button') + '  →  ' + (o ? $tn(o.name) : $t('nothing'));
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
  }, ns ? 'ns' : platform ? 'platform' : 'essential');

  // the mode: which console the PadBox acts as, each with its own button mapping. The redesign chooses it in a menu
  // beside the CONTROLLER button (shell.tabs menus) and names it under the page's title, in the console's color.
  const MODE_MENU = [[0, 'Switch Pro', '#e60012'], [3, 'GameCube', '#8f7fd8'], [2, 'Slippi', '#21ba45'], [4, 'Nintendo 64', '#f2b705'],
    [5, 'SNES', '#b4a7e5'], [1, 'XInput (Xbox / PC)', '#52b043'], [6, 'Steam Input', '#28a6ff']];
  let curMode = 0;
  function showMode() {
    const mm = MODE_MENU.find(x => x[0] === curMode) || MODE_MENU[0];
    shell.sub('CONTROLLER', el('span', {}, [$t('Assign functions to each button and configure LED lighting'), el('br'), ...$tNodes('in {0} mode', el('b.mode-name', { text: mm[1], style: { color: mm[2] } }))]));
  }
  function setMode(v) { curMode = v; editProfile = profileOfMode(v); Gamepad.setMode(B[Blk.GAMEPAD], v); changed(Blk.GAMEPAD); showMode(); refreshSide(); }
  const modeMenu = () => MODE_MENU.map(([v, text]) => ({ text, sel: v === curMode, pick: () => { if (v !== curMode) setMode(v); } }));

  // the right-hand column: BUTTON SETTINGS (or "No button selected"), then GLOBAL LED SETTINGS
  const empty = el('div.panel.empty', {}, [
    el('div.click-icon', { html: dicon('click') }),
    el('div.empty-t', { text: $t('No button selected') }),
    el('div.empty-d', { text: $t('Click a button on the controller or press\nit on the device to configure its function\nand LED lighting') }),
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
  const amount = { el: el('div.amount-row', { title: $t('How far the analog output goes when this button is pressed') }, [el('span', { text: $t('Analog amount') }), amtIn, amtVal]),
    set value(v) { amtIn.value = v; amtPaint(); } };
  const ledDot = el('i.dot'), ledTxt = el('span');
  const ledFieldBtn = el('button.field.color', { type: 'button' }, [ledDot, ledTxt]);
  ledFieldBtn.addEventListener('click', () => {
    const led = ledOf(selInput); if (led < 0) return;
    pickColor(Rgb.color(B[Blk.RGB], led), c => { Rgb.setColor(B[Blk.RGB], led, c); changed(Blk.RGB); refreshSide(); });
  });
  // one color per button: HOJA has no separate "when pressed" color (the design's second field is left out)
  const ledBlock = el('div.led-block', {}, [
    el('div.lbl', { text: $t('LED color') }),
    el('div.two.one', {}, [ledFieldBtn]),
    el('div.noled-note', { text: $t('This button has no LED') }),
  ]);
  ledFieldBtn.title = $t('This button\x27s LED color (used by the Static and Reactive effects)');
  const btnResetMode = el('button.pbtn.primary', { type: 'button', html: dicon('sync') + '<span>' + $t('Reset this button') + '</span>' });
  btnResetMode.addEventListener('click', () => resetButton());
  const btnResetAll = el('button.pbtn.outline', { type: 'button', html: dicon('sync') + '<span>' + $t('Reset all buttons') + '</span>' });
  btnResetAll.addEventListener('click', () => resetModes([editProfile]));
  btnResetAll.title = $t('Every button back to its default in this mode');
  const settingsPanel = el('div.panel.hidden', {}, [
    el('div.ptitle', { text: $t('BUTTON SETTINGS') }),
    el('div.lbl', { text: $t('Function') }), fn, amount.el,
    ledBlock,
    btnResetMode, btnResetAll,
    el('p.hint', { html: $t('Click <b>Save</b> to keep your changes on the controller') }),
  ]);

  // GLOBAL LED SETTINGS: the effect, one color for every button, idle glow, brightness and the animation's time
  const effect = el('select.field');
  RGB_MODES.forEach((n, i) => effect.append(el('option', { value: i, text: $tn(n) })));
  effect.addEventListener('change', () => { Rgb.setMode(B[Blk.RGB], +effect.value); changed(Blk.RGB); refreshSide(); });
  const idle = dtoggle($t('Idle Glow'), v => { Rgb.setIdleGlow(B[Blk.RGB], v ? 1 : 0); changed(Blk.RGB); });
  let allColor = 0x28a6ff;
  const wheelDot = el('i.wheel-in'), wheelKnob = el('i.wheel-knob');
  const wheel = el('div.wheel', { title: $t('Pick a color for every button') }, [wheelDot, wheelKnob]);
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
  const plus = el('button.plus', { type: 'button', title: $t('Another color...'), html: dicon('plus') });
  plus.addEventListener('click', () => pickColor(allColor, setAll));
  swatches.append(plus);
  const bright = dslider($t('Brightness'), 0, 100, v => v + '%', v => { Rgb.setBrightness(B[Blk.RGB], Math.round(v * 4096 / 100)); changed(Blk.RGB); });
  const speed = dslider($t('Animation time'), 300, 5000, v => (v / 1000).toFixed(2) + 's', v => { Rgb.setSpeed(B[Blk.RGB], v); changed(Blk.RGB); });
  // One color for every button only means something in Static and Reactive: Fairy, Rainbow and Authentic use their own
  // colors, so there the wheel is greyed out. (Fairy used to blend the first six buttons' colors, so painting them all
  // one color flattened it; since the 2026-10-05 firmware it has its own palette.)
  const colorRow = el('div.colorrow', {}, [wheel, el('div', {}, [el('div.readout', {}, [rgbTxt, hexTxt]), swatches])]);
  const colorLbl = el('span', { text: $t('Color') });
  const ledPanel = el('div.panel.ledp', {}, [
    el('div.ptitle', { text: $t('GLOBAL LED SETTINGS') }),
    el('div.lbl', { text: $t('Lighting effect') }), effect,
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
    colorRow.title = oneColor ? '' : $t('This effect uses its own colors');
    const none = selInput < 0;
    empty.classList.toggle('hidden', !none); settingsPanel.classList.toggle('hidden', none);
    column.classList.toggle('selected', !none); page0.classList.toggle('selected', !none);
    colorLbl.textContent = none ? $t('Color') : $t('LED color');   // as the design words it in each state
    if (!none) {
      fn.innerHTML = '';
      fn.append(el('option', { value: -1, text: $t('Nothing (disabled)') }));
      OUTPUTS[editProfile].forEach((o, i) => fn.append(el('option', { value: i, text: $tn(o.name) })));
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
    if (!fresh) { if (r.ok) await dev.writeBlock(Blk.INPUT, keep.slice()); return say($t('Couldn\'t reset the button - the PadBox didn\'t answer. Try again.'), 'var(--bad)'); }
    const o = Input.offset(editProfile, i);
    keep.set(fresh.subarray(o, o + 5), o);
    B[Blk.INPUT] = keep; changed(Blk.INPUT); refreshSide();
    say($t('This button is back to its default in {0} mode. Click Save to keep it after unplugging.', PROFILES[editProfile]), 'var(--warn)');
  }
  async function resetModes(list) {
    const one = list.length === 1 ? PROFILES[list[0]] : null;
    if (!await confirmBox($t('Reset buttons'), one ? $t('Put every button back to its default in {0} mode?', one) : $t('Put every button back to its default in every mode?'), $t('RESET'))) return;
    clearTimeout(liveTimer); await pushLive();
    btnResetMode.disabled = btnResetAll.disabled = true;
    let ok = true;
    for (const p of list) { const r = await dev.command(Blk.INPUT, 2 + p, 1500); if (!r.ok) ok = false; }   // MAPPER_CMD_DEFAULT_<mode>
    const fresh = ok ? await dev.readBlock(Blk.INPUT) : null;
    btnResetMode.disabled = btnResetAll.disabled = false;
    if (!fresh) return say($t('Couldn\'t reset the buttons - the PadBox didn\'t answer. Try again.'), 'var(--bad)');
    B[Blk.INPUT] = fresh; markUnsaved(Blk.INPUT); refreshSide();
    say(one ? $t('The buttons of {0} mode are back to their defaults. Click Save to keep them after unplugging.', one) : $t('The buttons of every mode are back to their defaults. Click Save to keep them after unplugging.'), 'var(--warn)');
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
  const sticks = [makeStick(false, hasRight ? $t('LEFT STICK') : $t('STICK')), makeStick(true, hasRight ? $t('RIGHT STICK') : $t('C-STICK'))];
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
      if (!r.ok && calSticks !== 3) { calSticks = 3; r = await dev.command(Blk.ANALOG, 1, 1500); note = $t('This firmware calibrates both sticks together: roll both, then click Stop. Update it to calibrate one stick at a time.'); }
      calibrating = true;
      sticks.forEach(s => { s.bCal.disabled = !s.calibrated(); });
      refreshCal(note || undefined, note ? 'var(--warn)' : undefined);
    } else {
      calibrating = false; sticks.forEach(s => s.bCal.disabled = true); refreshCal($t('Finishing...'), 'var(--warn)');
      await dev.command(Blk.ANALOG, 2, 1500);   // ANALOG_CMD_CALIBRATE_STOP
      const fresh = await dev.readBlock(Blk.ANALOG);
      sticks.forEach(s => { s.bCal.disabled = false; s.trail.length = 0; });
      if (!fresh) return refreshCal($t('Couldn\'t read the result back from the PadBox. Try again.'), 'var(--bad)');
      const pending = live.has(Blk.ANALOG);
      B[Blk.ANALOG] = fresh;
      if (pending) sticks.forEach(s => s.apply && s.apply());
      markUnsaved(Blk.ANALOG); if (pending) pushLive();
      const done = calSticks; calSticks = 0; refreshCal();
      for (const s of sticks) {
        if (!(done & (s.right ? 2 : 1)) || !s.present) continue;
        if (Analog.stickCalibrated(fresh, s.right)) s.showCal($t('Calibrated. Click Save to keep it after unplugging.'), 'var(--good)');
        else s.showCal($t('Not enough movement was seen. Try again with slower, fuller circles that touch every corner.'), 'var(--bad)');
      }
    }
  }
  function makeStick(right, title) {
    const A = () => B[Blk.ANALOG];
    const present = !right || hasRight;
    const cv = el('canvas.gate'), tag = badge();
    const en = dtoggle($t('Enabled'), v => { Analog.setDisabled(A(), right, !v); changed(Blk.ANALOG); showOn(); }, $t('Disabled'));
    const rd1 = el('div.rd1'), infoL = el('p.cal-info');
    const legend = el('div.rd2.legend', { html: '<i class="lg-dot"></i>' + $t('Output') + '<i class="lg-ring"></i>' + $t('Raw') });
    const bCal = pbtn($t('Calibrate'), 'target', true, () => toggleCalibrate(right));
    const bAngle = pbtn($t('Angle set'), 'angle', true, angleSet);
    bAngle.classList.add('angle');
    const bReset = pbtn($t('Reset'), 'sync', false, () => { st.load(st.start); st.apply(); changed(Blk.ANALOG); st.showCal($t('This stick\'s settings are back to how they were when you connected.')); });
    bReset.title = $t('Put this stick\'s settings back to how they were when you connected');
    const fx = dtoggle($t('Flip X axis'), v => { Analog.setInv(A(), right ? 6 : 2, v); changed(Blk.ANALOG); });
    const fy = dtoggle($t('Flip Y axis'), v => { Analog.setInv(A(), right ? 8 : 4, v); changed(Blk.ANALOG); });
    // the gate drawn: round or octagonal (the left stick: octagonal by default on the GS Platform)
    const gate = segmented([$t('Round Gate'), $t('Octagonal Gate')], () => { });
    gate.value = !right && platform ? 1 : 0;
    const dz = v => (v * 100 / 2047).toFixed(1) + '%';
    const dead = dslider($t('Inner deadzone'), 0, 400, dz, v => { Analog.setDeadzone(A(), right, v); changed(Blk.ANALOG); });
    const outer = dslider($t('Outer deadzone'), 0, 400, dz, v => { Analog.setOuter(A(), right, v); changed(Blk.ANALOG); });
    const exp = dslider($t('Curve'), 50, 300, v => (v / 100).toFixed(2), v => { Analog.setExp(A(), right, clamp(v - 49, 1, 251)); changed(Blk.ANALOG); });
    const offMsg = el('div.stick-off', {}, [el('div.off-icon', { html: dicon('nav-stick') }), el('div.empty-t', { text: $t('Stick disabled') }),
      el('div.empty-d', { text: $t('This stick is currently disabled. Enable it to access calibration, deadzone, and other input settings.') })]);
    // while calibrating, the steps take the settings' place
    const settingsBox = el('div.stick-set', {}, [
      el('div.angle-row', {}, [bAngle]), el('p.angle-hint', { text: $t('Hold the stick in a notch, then click ANGLE SET to line that notch up with it') }),
      el('div.two.flips', {}, [fx.el, fy.el]), gate.el, dead.el, outer.el, exp.el,
      el('p.angle-hint.left', { text: $t('Adjust how stick input responds around the centre') }),
]);
    exp.el.title = $t('Adjust how stick input responds around the centre');
    // SNAPBACK: the filter that stops the stick bouncing past the centre when you let go (HOJA's snapback.c), and the
    // analyzer: the firmware records each flick's first 31 ms after you let go and sends it (dev.onSnap)
    const MODES = [$t('Low-pass'), $t('Auto'), $t('Off')];   // = l/r_snapback_type 0, 1, 2 (HOJA-LIB-RP2040-latest's snapback.c, which the PadBox builds with)
    const MODE_TIP = [$t('Low-pass: smooths fast movement near the centre (set how strongly with the cutoff)'),
      $t('Auto: spots the moment you let go and holds back the rebound only then'), $t('Off: the stick\'s raw output, to see its natural snapback')];
    const snapMode = segmented(MODES, i => { Analog.setSnapType(A(), right, i); changed(Blk.ANALOG); showMode(); });
    const modeHint = el('p.snap-hint');
    // the cutoff: 30..150 Hz in 0.5 Hz steps (the slider counts half-hertz; stored in tenths)
    const cutoff = dslider($t('Filter cutoff'), 60, 300, v => (v / 2).toFixed(1) + ' Hz', v => { Analog.setSnap(A(), right, v * 5); changed(Blk.ANALOG); });
    cutoff.el.title = $t('Lower removes more bounce but adds a touch of delay to fast flicks near the centre; higher feels snappier but lets more rebound through. Default 60 Hz');
    const showMode = () => { const m = snapMode.value; cutoff.disabled = m !== 0; modeHint.textContent = MODE_TIP[m]; };
    const snapCv = el('canvas.snap-plot'), snapStats = el('div.snap-stats'), snapHist = el('div.snap-hist'), snapState = el('span.snap-state', { text: $t('Listening') });
    const snapCard = panel(right ? (hasRight ? $t('RIGHT STICK SNAPBACK') : $t('C-STICK SNAPBACK')) : (hasRight ? $t('LEFT STICK SNAPBACK') : $t('SNAPBACK')), [
      el('div.snap-set', {}, [el('p.snap-sub', { text: $t('Stops the stick bouncing past the centre when you let it go. Changes apply right away: click Save to keep them.') }), el('div.lbl', { text: $t('Filter mode') }), snapMode.el, modeHint, cutoff.el]),
      el('div.snap-an', {}, [el('div.snap-head', {}, [el('div.lbl', { text: $t('Analyzer') }), snapState]),
        el('p.snap-hint', { text: $t('Push the stick all the way to one side and let it snap back: the plot shows what it does in the 31 ms after you let go.') }),
        snapStats, snapCv, snapHist]),
    ], 'snapback');
    const controls = el('div.stick-ctl', {}, [settingsBox, infoL, el('div.btnrow.bottom', {}, [bReset, bCal])]);
    const absent = el('div.empty-d', { text: $t('The C-stick is made of buttons, so there\'s nothing to calibrate.'), style: { padding: '90px 0', textAlign: 'center' } });
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
      if (!shown) { g.fillStyle = '#8a8a8a'; g.textAlign = 'center'; g.font = '9px Poppins, sans-serif'; g.fillText($t('Flick the stick...'), L + PW / 2, T + PH / 2 - 6); return; }
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
      for (const [k, v] of [[$t('Axis'), c.name], [$t('Overshoot'), pc(a.over)], [$t('Settled'), a.settled == null ? '> 31 ms' : a.settled.toFixed(1) + ' ms'], [$t('Peak +'), pc(Math.max(0, a.max))], [$t('Peak −'), pc(Math.max(0, -a.min))]])
        snapStats.append(el('div', {}, [el('span', { text: k }), el('b', { text: v })]));
      for (const b of snapHist.children) b.classList.toggle('on', b.cap === c);
      drawSnap();
    }
    st.snap = (axis, samples) => {
      const c = { name: ['LX', 'LY', 'RX', 'RY'][axis], samples, mode: MODES[snapMode.value], time: new Date() };
      caps.unshift(c); caps.length = Math.min(caps.length, 6);
      snapHist.innerHTML = '';
      for (const k of caps) { const b = el('button.snap-cap', { type: 'button', text: k.name + '  ' + k.time.toTimeString().slice(3, 8) + '  ' + k.mode }); b.cap = k; b.addEventListener('click', () => showCap(k)); snapHist.append(b); }
      snapState.textContent = $t('Captured'); snapState.classList.add('got');
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
      setPbtn(bCal, mine ? $t('Stop') : $t('Calibrate'), mine ? '' : 'target');
      const set = Analog.stickCalibrated(A(), right);
      tag.set(mine ? 'busy' : set ? 'ok' : 'no');
      // the steps in the panel while calibrating; anything else in the status line at the bottom
      const busy = mine || calibrating;
      settingsBox.classList.toggle('hidden', busy); infoL.classList.toggle('hidden', !busy); bReset.disabled = busy;
      infoL.style.color = color || '';
      infoL.textContent = busy ? msg || (mine
        ? (calSticks === 3 && hasRight ? $t('Roll both sticks slowly around the edge 3 times, touching every corner, then click Stop.') : $t('Roll the stick slowly around the edge 3 times, touching every corner, then click Stop.'))
        : $t('The other stick is being calibrated. This one keeps working as usual.')) : '';
      if (!busy && msg) say(msg, color);
    };
    async function angleSet() {
      if (calibrating) return st.showCal($t('Finish the calibration first.'), 'var(--warn)');
      bAngle.disabled = true;
      const r = await dev.command(Blk.ANALOG, right ? 4 : 3, 1500);
      bAngle.disabled = false;
      if (!r.ok || !r.data) return st.showCal($t('Couldn\'t read the stick\'s position. Try again.'), 'var(--bad)');
      const dv = new DataView(r.data.buffer, r.data.byteOffset), angle = dv.getFloat32(0, true), dist = dv.getFloat32(4, true);
      if (dist < 150) return st.showCal($t('The stick is near the centre: push it all the way against the notch first.'), 'var(--warn)');
      const slot = Analog.nearestSlot(A(), right, angle);
      if (slot < 0) return st.showCal($t('This stick has no notches to adjust yet: calibrate the sticks first.'), 'var(--bad)');
      const target = Analog.slotOutAngle(A(), right, slot);
      Analog.setSlotIn(A(), right, slot, angle, dist); changed(Blk.ANALOG);
      st.showCal($t('The notch at {0}° now matches your stick ({1}°). Click Save to keep it.', Math.round(target), Math.round(angle)), 'var(--good)');
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

  // ---------------------------------------------------------------- SWITCH COLORS page
  // The colors the Switch draws the controller in (its Controllers screen and controller icons), as in HOJA's own
  // configurator: body, buttons and the two grips. The firmware hands the colors over when it's plugged in, so they
  // show after Save and plugging it back in.
  // The preview: the Pro Controller exactly as the Switch draws it on its Controllers screen, traced from Nintendo's
  // screenshot of that screen (nintendo.com support, "Setting up controllers") into an outline, the left grip (the
  // right one is its mirror image) and the buttons; the darker edge is the console's, most visible on bright grips. No box behind it: a thin light rim keeps a dark body visible on the dark panel.
  const SW_BODY = 'M60.3 4.1C58.8 4.3 57.5 4.5 55.8 4.8C54.8 5 52.9 5.3 51.6 5.4C48.2 5.8 42.7 7.1 40.3 8.2C33.7 11 29.1 15.4 27.1 20.7C26.5 22.3 26 23 24.5 24.8C20.7 29.2 20 31.2 15.7 47.7C15.3 49.3 14.8 51.4 14.5 52.3C13.6 55.3 13.3 57.1 12.6 62.6C12.4 64 12 66 11.8 67.2C11 70.3 10.8 71.7 10.6 74.1C10.3 76.8 10.3 76.8 9.8 79C9.6 80 9.2 81.9 9 83.3C8.8 84.7 8.5 86.5 8.3 87.2C7.9 89.2 7.6 91.2 7.2 94.2C6.7 98.4 6.4 100.3 6.1 101.7C5.4 104.5 5.3 105.4 5.1 107.8C5 109.1 4.8 110.8 4.7 111.5C4.5 113 4.2 120.6 4.3 123.9C4.4 128 5.6 133.3 6.9 135.7C7.2 136.3 7.7 137.1 7.9 137.6C8.4 138.5 10.6 141.9 11.3 142.8C11.5 143.1 12.2 143.7 12.9 144.2C13.5 144.6 14.5 145.4 15 145.9C16.6 147.4 17.4 147.8 20.3 148.4C21.2 148.6 22.7 149 23.7 149.3C26.1 150.1 26.8 150.1 29.8 149.3C31 149 32.5 148.6 33.3 148.4C35.6 148 36.2 147.7 37.8 146.2C38.4 145.6 39.5 144.8 40.1 144.5C41.6 143.5 42.2 143 43 141.8C43.4 141.2 43.9 140.4 44.2 140.1C44.4 139.7 45 138.8 45.4 138.1C45.8 137.4 46.4 136.4 46.9 135.8C47.3 135.2 48 134.2 48.3 133.4C48.7 132.7 49.4 131.4 49.8 130.6C50.3 129.8 51.1 128.3 51.6 127.3C59.3 111.5 59.6 111.1 63.4 110.5C65.1 110.2 143.9 110.2 145.6 110.5C149.4 111.1 149.7 111.5 157.4 127.3C157.9 128.3 158.7 129.8 159.2 130.6C159.6 131.4 160.3 132.7 160.7 133.4C161 134.2 161.7 135.2 162.1 135.8C162.6 136.4 163.2 137.4 163.6 138.1C164 138.8 164.6 139.7 164.8 140.1C165.1 140.4 165.6 141.2 166 141.8C166.8 143 167.4 143.5 168.9 144.5C169.5 144.8 170.6 145.6 171.2 146.2C172.8 147.7 173.4 148 175.7 148.4C176.5 148.6 178 149 179.3 149.3C182.2 150.1 182.9 150.1 185.3 149.3C186.3 149 187.8 148.6 188.8 148.4C191.6 147.8 192.4 147.4 194 145.9C194.5 145.4 195.5 144.6 196.1 144.2C196.8 143.7 197.5 143.1 197.7 142.8C198.4 141.9 200.6 138.5 201.1 137.6C201.3 137.1 201.8 136.3 202.1 135.7C203.4 133.3 204.6 128 204.7 123.9C204.8 120.6 204.5 113 204.3 111.5C204.2 110.8 204 109.1 203.9 107.8C203.7 105.4 203.6 104.5 202.9 101.7C202.6 100.3 202.3 98.4 201.8 94.2C201.4 91.2 201.1 89.2 200.7 87.2C200.5 86.5 200.2 84.7 200 83.3C199.8 81.9 199.4 80 199.2 79C198.7 76.8 198.7 76.8 198.4 74.1C198.2 71.7 198 70.3 197.2 67.2C197 66 196.6 64 196.4 62.6C195.7 57.1 195.4 55.3 194.5 52.3C194.2 51.4 193.7 49.3 193.3 47.7C189 31.2 188.3 29.2 184.5 24.8C183 23 182.5 22.3 181.9 20.7C179.9 15.4 175.3 11 168.7 8.2C166.3 7.1 160.8 5.8 157.4 5.4C156.1 5.3 154.2 5 153.2 4.8C150 4.2 149.3 4.1 145.8 4.1C142.2 4.1 141.8 4.2 138.9 5C136.4 5.7 135.3 6.3 133.4 7.7C131.7 9.2 131 9.6 129.9 9.9C128.6 10.3 80.4 10.3 79.1 9.9C78 9.6 77.3 9.2 75.6 7.7C73.4 6 71.6 5.2 67.7 4.4C66.8 4.2 61.6 4 60.3 4.1';
  const SW_GRIP = 'M16.3 49.8C14.6 50.5 13.7 53.8 12.6 62.6C12.4 64 12 66 11.8 67.2C11 70.3 10.8 71.7 10.6 74.1C10.3 76.8 10.3 76.8 9.8 79C9.6 80 9.2 81.9 9 83.3C8.8 84.7 8.5 86.5 8.3 87.2C7.9 89.2 7.6 91.2 7.2 94.2C6.7 98.4 6.4 100.3 6.1 101.7C5.4 104.5 5.3 105.4 5.1 107.8C5 109.1 4.8 110.8 4.7 111.5C4.5 113 4.2 120.6 4.3 123.9C4.4 128 5.6 133.3 6.9 135.7C7.2 136.3 7.7 137.1 7.9 137.6C8.4 138.5 10.6 141.9 11.3 142.8C11.5 143.1 12.2 143.7 12.9 144.2C13.5 144.6 14.5 145.4 15 145.9C16.6 147.4 17.4 147.8 20.3 148.4C21.2 148.6 22.7 148.9 23.6 149.2C25.8 149.8 26.5 149.8 29.1 149.3C30.2 149 31.8 148.7 32.6 148.6C35.3 148.1 36 147.8 37.6 146.2C38.3 145.6 39.2 144.9 40.1 144.4C41.8 143.4 42.2 143 43 141.8C43.4 141.2 43.9 140.4 44.2 140.1C44.4 139.7 45 138.8 45.4 138.1C45.8 137.4 46.4 136.4 46.9 135.8C47.3 135.2 48 134.2 48.3 133.4C48.7 132.7 49.4 131.4 49.8 130.6C50.3 129.8 51.1 128.3 51.6 127.3C53.7 123 57.1 116.2 57.9 114.9C58.3 114 59 112.8 59.4 112.1C60.7 109.8 60.7 109.2 59.3 106.9C59 106.4 58.4 105.5 58.2 105C57.9 104.5 57.3 103.7 56.7 103.1C56.2 102.6 55.5 101.7 55.1 101.1C54.6 100.5 54 99.7 53.2 99.1C52.4 98.4 51.9 97.8 51.3 97C50.9 96.4 50.3 95.6 49.9 95.2C48.5 94 48.1 93.5 47.5 92.6C47.3 92.1 46.7 91.3 46.2 90.8C45.7 90.3 45.1 89.4 44.7 88.7C44.3 88.1 43.7 87.2 43.2 86.7C42.8 86.3 42.1 85.4 41.7 84.8C41.3 84.2 40.6 83.2 40.1 82.7C39.7 82.2 39 81.3 38.7 80.9C38.4 80.4 37.6 79.5 37 78.8C36.3 78.1 35.7 77.3 35.3 76.7C35 76.1 34.4 75.2 33.9 74.7C33.5 74.1 32.9 73.2 32.6 72.8C32.3 72.3 31.7 71.3 31.2 70.6C30.7 69.9 30.1 69.1 29.9 68.7C29.5 68 29.1 67.5 28.1 66.2C27.8 65.9 27.2 64.9 26.7 64C24.7 60.1 24.3 59.5 23.7 58.7C23.4 58.2 23 57.5 22.7 57.1C22.2 56 21.7 55.3 20.8 54.3C20.4 53.8 19.9 53.1 19.7 52.7C18.5 50.2 18.5 50.2 18 49.9C17.3 49.5 17 49.5 16.3 49.8';
  const swPrev = el('div.sw-prev', { html: '<svg viewBox="0 0 208.9 154.1"><defs><path id="sw-b" d="' + SW_BODY + '"/><clipPath id="sw-clip"><use href="#sw-b"/></clipPath></defs>'
    + '<use class="rim" href="#sw-b"/><use class="c0" href="#sw-b"/><g clip-path="url(#sw-clip)"><path class="c2" d="' + SW_GRIP + '"/><path class="c3" transform="translate(208.8 0) scale(-1 1)" d="' + SW_GRIP + '"/>'
    + '<use class="edge" href="#sw-b"/></g><g class="c1"><circle cx="47.8" cy="47.7" r="11.1"/><circle cx="129.8" cy="79.6" r="11.1"/><circle cx="172.8" cy="47.6" r="7.3"/><circle cx="157.2" cy="61.4" r="7.3"/><circle cx="141.6" cy="47.6" r="7.3"/><circle cx="157.2" cy="33.9" r="7.2"/><path d="M68.5 64.9h9.1v10.2h10.2v9.1h-10.2v10.2h-9.1v-10.2h-10.2v-9.1h10.2z"/></g></svg>' });
  const SHELL_COLORS = [[$t('Black'), 0x101010], [$t('Lime green'), 0xa6e22e], [$t('Red'), 0xe02b2b], [$t('Electric blue'), 0x0a5cff], [$t('Dark grey'), 0x4a4a4a], [$t('Purple'), 0x7a2fd0], [$t('Orange'), 0xff6800]];
  const swFields = SWITCH_COLORS.map(([text], i) => {
    const dot = el('i.dot'), txt = el('span'), b = el('button.field.color', { type: 'button', title: $t('{0} color', $tn(text)) }, [dot, txt]);
    b.addEventListener('click', () => pickColor(Gamepad.color(B[Blk.GAMEPAD], i), c => setSw(i, c)));
    // quick picks under the box, like GLOBAL LED SETTINGS' swatches: the seven colors the PadBox GS comes in
    const quick = el('div.sw', {}, SHELL_COLORS.map(([name, c]) => { const s = el('button', { type: 'button', title: name }); s.style.background = hex(c); s.addEventListener('click', () => setSw(i, c)); return s; }));
    return { dot, txt, row: el('div', {}, [el('div.lbl', { text: $tn(text) }), b, quick]) };
  });
  function showSw() {
    swFields.forEach((f, i) => {
      const c = Gamepad.color(B[Blk.GAMEPAD], i);
      f.dot.style.background = hex(c); f.txt.textContent = hex(c).toUpperCase();
      for (const n of swPrev.querySelectorAll('.c' + i)) n.style.fill = hex(c);
    });
  }
  function setSw(i, c) {
    Gamepad.setColor(B[Blk.GAMEPAD], i, c); changed(Blk.GAMEPAD); showSw();
    say($t('Click Save, then plug the PadBox back in: the Switch reads its colors when it connects.'), 'var(--warn)');
  }
  const swReset = pbtn($t('Reset colors'), 'sync', false, () => { SWITCH_COLORS.forEach(([, c], i) => Gamepad.setColor(B[Blk.GAMEPAD], i, c)); setSw(0, SWITCH_COLORS[0][1]); });
  swReset.title = $t('Back to the default dark grey controller');
  const pageSw = el('div.page.hidden.dpage.swcolors', {}, [
    panel($t('CONTROLLER COLORS'), [
      el('p.text', { text: $t('The colors your PadBox has on the Nintendo Switch, in Switch Pro mode.') }),
      el('div.two', {}, swFields.map(f => f.row)),
      el('div.btnrow', {}, [swReset]),
      el('p.hint.wrap', { html: $t('Click <b>Save</b>, then plug the PadBox back in: the Switch reads the colors when it connects.') }),
    ]),
    panel($t('PREVIEW'), [swPrev]),
  ]);

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
    if (!f || f.format !== 'padbox-hoja2-backup' || !f.blocks) return $t('This file isn\x27t a HOJA configuration file. GP2040-CE and PhobGCC files only go back onto those firmwares.');
    if (f.board !== lay.name) return $t('This configuration is from a PadBox {0}, and this is a PadBox {1}: their buttons differ, so it can\'t be restored here.', f.board, lay.name);
    if (calibrating) return $t('Finish the stick calibration first.');
    for (const [k, b] of Object.entries(BACKUP_BLOCKS)) {
      let d; try { d = unb64(f.blocks[k] || ''); } catch (e) { d = null; }
      if (!d || d.length !== B[b].length) return $t('This configuration is incomplete or damaged ({0} settings).', k);
      if (d[0] !== B[b][0]) return $t('This configuration was made with a different HOJA version ({0} settings), so it can\'t be restored on this firmware.', k);
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
    if (!r.ok) { Object.values(BACKUP_BLOCKS).forEach(b => dirty.add(b)); refreshSave(); throw new Error($t('the configuration is on the PadBox now, but saving it failed: click Save to keep it after unplugging')); }
    dirty.clear(); refreshSave(); say($t('Configuration restored and saved.'), 'var(--good)');
    return $t('Configuration restored and saved to the PadBox.');
  }
  const backup = backupPage({
    controller: 'HOJA2', board: lay.name, firmware: fw ? fw.toString(16).toUpperCase() : '', mode: () => (MODE_MENU.find(x => x[0] === curMode) || MODE_MENU[0])[1],
    exportData: async () => { clearTimeout(liveTimer); await pushLive(); return file(); },
    fileName: name => 'PadBox ' + lay.name + ' - HOJA - ' + name.replace(/[\\/:*?"<>|]/g, '_') + '.json',
    check: checkFile, restore: restoreFile,
  });
  const page2 = backup.page;


  // ---------------------------------------------------------------- the side menu, load, live reports
  const tabNames = ['CONTROLLER', 'STICKS', 'SNAPBACK', 'SWITCH COLORS', 'BACKUP & RESTORE'], pages = [page0, page1, pageSnap, pageSw, page2];
  if (ns) { tabNames.splice(1, 2); pages.splice(1, 2); }   // the PadBox GS NS has no sticks: no STICKS and no SNAPBACK page (they stay hidden)
  shell.content(el('div', { style: { position: 'absolute', inset: 0 } }, pages));
  let curTab = 0, curName = 'CONTROLLER';
  shell.tabs(tabNames, i => {
    curTab = i; curName = tabNames[i]; pages.forEach((p, k) => p.classList.toggle('hidden', k !== i));
    // the live report the open page needs: raw buttons for CONTROLLER (and the trigger), the sticks otherwise
    dev.reportMode(curName === 'CONTROLLER' || curName === 'TRIGGER' ? Rpt.INPUT_RAW : Rpt.INPUT_JOYSTICKS);
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
    refreshSide(); refreshCal(); showSw();
  }
  loadUi();
  say(mismatch ? $t('This firmware doesn\'t match this app. Update it (the download button, top right) before changing anything.') : '', mismatch ? 'var(--bad)' : '');
  // the demo: ?sel=<pin> opens with that button selected
  { const q = opts.demo && /[?&]sel=(\d+)/.exec(location.search); if (q) select(inputOf(+q[1])); }

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
  dev.onLost = () => { if (alive) { alive = false; shell.lost($t('Lost the connection to the PadBox.')); } };
  const frame = () => {
    if (!alive) return;
    sticks.forEach(s => s.paint());
  };
  const loop = () => { if (!alive) return; frame(); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);

  return { stop() { alive = false; }, dirty: () => dirty.size > 0 };
}
