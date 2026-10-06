// The GP2040-CE PadBox Calibrator in the new design (Figma "PadBox Software", then the GS Essential Redesign:
// "PadBox GP2040 Essential.pdf") for the PadBox GS Essential and GS Platform: CONTROLLER, STICKS, SETTINGS and
// BACKUP & RESTORE. Saving works exactly as in the previous app (js/gp/app.js), which this started as a copy of.

import { el, icon, button, card, toggle, slider, combo, setItems, swatchRow, pickColor, hex, readable, image, clamp, sleep, download, openFile, confirmBox, setButtonText, dialog } from './js/ui.js';
import { Model, ACTS, act, COMBO_PARTS, comboName } from './js/gp/model.js';
import { firmwareUpdate } from './js/update.js';
import { buildDrawing } from './drawing.js';
import { panel, dtoggle, dslider, pbtn, setPbtn, segmented, badge, paintGate, readout, multiSelect, backupPage, updateNotice } from './parts.js';
import { dicon } from './icons.js';

const SOCD = ['Up priority', 'Neutral (Opposite directions cancel out)', 'Second input priority', 'First input priority (Locking)', 'Bypass (No cleaning)'];
const EFFECTS = ['Static color', 'Rainbow', 'Chase', 'Static theme', 'Custom theme'];
const PRESETS = [0x0000ff, 0xff6800, 0xff0000, 0x00ff00, 0xffffff, 0xa020f0, 0x00ffff];

export async function startGp(shell, dev, opts) {
  const m = new Model();
  let alive = true, pressed = 0n, adc = [-1, -1, -1, -1, -1];
  const dirty = { pins: false, led: false, settings: false, cal: false };

  // ---------------------------------------------------------------- read everything
  shell.footer('Reading settings...');
  const s = {};
  try {
    s.ver = await dev.get('/api/getFirmwareVersion');
    s.pins = await dev.get('/api/getPinMappings');
    try { s.profiles = await dev.get('/api/getProfileOptions'); } catch (e) { s.profiles = null; }
    s.cal = await dev.get('/api/getCalibration');
    s.theme = await dev.get('/api/getCustomTheme');
    s.led = await dev.get('/api/getLedOptions');
    s.padLed = await dev.get('/api/getPadboxLed');
    s.gamepad = await dev.get('/api/getGamepadOptions');
    s.addons = await dev.get('/api/getAddonsOptions');
  } catch (e) {
    throw new Error('The PadBox answered but didn\'t send its settings (' + e.message + '). It may run older firmware: update it, then hold Start while plugging it in again.');
  }
  m.load(s);
  if (!m.layout) throw new Error('This PadBox (board "' + m.board + '") isn\'t supported by this app.');
  const L = m.layout;

  shell.header('GP2040-CE', 'PadBox' + L.board.replace(/^GS /, '').replace(/ /g, ''), 'PadBox ' + L.board + (s.ver && s.ver.version ? '  •  GP2040-CE ' + s.ver.version : '') + (m.board ? '  •  board config ' + m.board : '') + (opts.demo ? '  •  demo' : ''));
  shell.status(true);

  // ---------------------------------------------------------------- header buttons (the design's icon buttons)
  const iconBtn = (cls, ic, title, onclick) => { const b = el('button.act.' + cls, { type: 'button', title, html: dicon(ic) }); b.addEventListener('click', onclick); return b; };
  const btnUpdate = iconBtn('outline', 'hdr-download', 'Update firmware', () => firmwareUpdate({ board: L.board, current: 'GP2040-CE', enter: noDrive => reboot(noDrive ? 3 : 2, true) }));
  const btnSave = iconBtn('save', 'hdr-save', 'Save to the controller', () => flush()); btnSave.disabled = true;
  const btnPreview = iconBtn('light', 'hdr-beacon', 'Restart to preview LED', () => reboot(1));
  // Disconnect: back to the connect screen; the PadBox stays in its configuration mode until it restarts
  const btnPower = iconBtn('light', 'hdr-power', 'Disconnect', async () => {
    if (Object.values(dirty).some(Boolean) && !await confirmBox('Unsaved changes', 'Your changes aren\'t saved on the controller yet. Disconnect anyway?', 'DISCONNECT')) return;
    alive = false; shell.lost('Disconnected. The PadBox stays in configuration mode until you unplug it or restart it.');
  });
  const btnExit = el('button.act.primary', { type: 'button', html: dicon('hdr-gamepad') + '<span>Restart as controller</span>' }); btnExit.addEventListener('click', () => reboot(0));
  shell.actions([btnUpdate, btnSave, btnPreview, btnPower, btnExit]);
  // a newer firmware on the site: say so (the build is padboxBuild; firmware from before it had none)
  if (!opts.demo || /[?&]update/.test(location.search)) updateNotice({ board: L.board, family: 'GP2040-CE', build: +(s.ver && s.ver.padboxBuild) || 0, button: btnUpdate, open: () => btnUpdate.click() });

  function markDirty(k) {
    dirty[k] = true; btnSave.disabled = false;
    say('Unsaved changes - click Save to send them to the controller.', 'var(--warn)');
  }
  function say(text, color) { status.textContent = text; status.style.color = color || ''; shell.footer(text, color); }

  // ---------------------------------------------------------------- CONTROLLER page
  let selPin = -1;
  const isPressed = pin => pin >= 0 && ((pressed >> BigInt(pin)) & 1n) === 1n;
  // a board's analog trigger, drawn as pin 44 (its GPIO): its function is AnalogOptions.trigger_action
  // (/api/setCalibration "taction"): L2 or R2 stay analog, anything else is a button pressed at half pull
  const TRIG = 44, TRIG_OK = new Set([-10, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]);
  const actOf = pin => pin === TRIG ? (m.taction ? m.taction : 11) : m.actionOf(pin);
  const fnName = a => (a ? a.long : '').replace(/\s*\/\s*/g, '/').replace(/\s+\(/, ' (');
  // the D-pad, the bumper and the stick clicks: no label in the drawing while they have their default function
  const QUIET_STICKS = { 'GS Essential': [18, 19] };
  const QUIET = new Set([2, 3, 4, 5, 22, ...(QUIET_STICKS[L.board] || [])]);
  // the GS draws its face buttons with their GameCube names, as in the redesign (X Y Z / A B R L; L1 has none, so its
  // button is left blank); the full function is in the button's tooltip and in BUTTON SETTINGS
  const GC = /^GS /.test(L.board) ? { B1: 'A', B2: 'B', B3: 'X', B4: 'Y', R1: 'Z', R2: 'R', L2: 'L', L1: '' } : null;
  const quiet = pin => QUIET.has(pin) && L.defaults && pin in L.defaults && actOf(pin) === L.defaults[pin];
  const drawing = buildDrawing(pin => select(pin), pin => {
    const a = act(actOf(pin));
    return (pin === TRIG ? 'Analog trigger' : m.nameOfPin(pin)) + '  →  ' + (a && a.value === 40 ? 'Custom combo: ' + (comboName(m.comboOf(pin)) || 'nothing yet') : a && a.value !== -10 ? fnName(a) : 'nothing');
  }, pin => { const a = act(actOf(pin)); return !a || a.value === -10 || quiet(pin) ? '' : a.value === 32 ? 'Turbo' : a.value === 40 ? (comboName(m.comboOf(pin)) || 'Combo') : a.value <= 4 ? a.key : GC && a.short in GC ? GC[a.short] : a.short; },   // D-pad: Up/Down/Left/Right, drawn as arrows
  { 'GS Platform': 'platform' }[L.board] || 'essential');

  // the right-hand column: BUTTON SETTINGS (or "No button selected"), then GLOBAL LED SETTINGS
  const status = el('p.hint2');
  const empty = el('div.panel.empty', {}, [
    el('div.click-icon', { html: dicon('click') }),
    el('div.empty-t', { text: 'No button selected' }),
    el('div.empty-d', { text: 'Click a button on the controller or press\nit on the device to configure its function\nand LED lighting' }),
  ]);
  const fn = el('select.field.mono');
  for (const a of ACTS) fn.append(el('option', { value: a.value, text: fnName(a) }));
  fn.addEventListener('change', () => {
    if (selPin < 0) return;
    const a = +fn.value, was = actOf(selPin);
    setAction(selPin, a);
    if (a === 40 && was !== 40) {   // a new combo: start from the button it was, then choose the rest
      const c = m.comboOf(selPin);
      if (!c.b && !c.d) { const p = COMBO_PARTS.find(x => x.name === (act(was) || {}).key); if (p) { if (p.kind === 'd') c.d = p.bit; else c.b = p.bit; m.setCombo(selPin, c); } }
      editCombo();
    }
  });
  // "Custom combo": one physical button presses several controller buttons at once (GP2040-CE's customButtonMask /
  // customDpadMask), chosen in a small window; the row under Function shows them and reopens it
  const comboTxt = el('span.combo-txt');
  const comboEdit = el('button.combo-edit', { type: 'button', text: '+ Add', title: 'Make this button press more than one button at once' });
  comboEdit.addEventListener('click', () => {
    if (selPin < 0) return;
    if (actOf(selPin) !== 40) {   // one function so far: turn it into a combo that starts with it
      const was = actOf(selPin), c = m.comboOf(selPin), p = COMBO_PARTS.find(x => x.name === (act(was) || {}).key);
      c.b = 0; c.d = 0; if (p) { if (p.kind === 'd') c.d = p.bit; else c.b = p.bit; }
      m.setCombo(selPin, c); setAction(selPin, 40);
    }
    editCombo();
  });
  const comboRow = el('div.amount-row.combo-row', {}, [el('span', { text: 'Presses' }), comboTxt, comboEdit]);
  function editCombo() {
    const pin = selPin; if (pin < 0) return;
    const c = m.comboOf(pin), boxes = [];
    const grid = el('div.combo-grid', {}, COMBO_PARTS.map(p => {
      const input = el('input', { type: 'checkbox' }); input.checked = ((p.kind === 'd' ? c.d : c.b) & p.bit) !== 0;
      boxes.push([p, input]);
      return el('label.combo-chip', {}, [input, el('span', { text: p.name })]);
    }));
    let d;
    const ok = button('OK', { primary: true, icon: '', onclick: () => {
      const n = { b: 0, d: 0 };
      for (const [p, input] of boxes) if (input.checked) { if (p.kind === 'd') n.d |= p.bit; else n.b |= p.bit; }
      m.setCombo(pin, n); markDirty('pins'); d.close(); refreshSide();
    } });
    const cancel = button('CANCEL', { icon: '', onclick: () => d.close() });
    d = dialog('Custom combo', m.nameOfPin(pin) + ': the buttons it presses, all at once', 'gamepad',
      [el('p', { text: 'Tick every button and direction this button should press together.', style: { margin: '0 0 12px', color: 'var(--soft)' } }), grid], [ok, cancel]);
  }
  const ledField = pressedColor => {
    const dot = el('i.dot'), txt = el('span');
    const f = el('button.field.color', { type: 'button' }, [dot, txt]);
    f.addEventListener('click', () => pickLed(pressedColor));
    return { f, set(c) { dot.style.background = hex(c); txt.textContent = hex(c).toUpperCase(); } };
  };
  const ledU = ledField(false), ledD = ledField(true);
  const ledBlock = el('div.led-block', {}, [
    el('div.lbl', { text: 'LED color' }),
    el('div.two', {}, [ledU.f, ledD.f]),
    el('div.noled-note', { text: 'This button has no LED' }),
    el('div.two.caps', {}, [el('span', { text: 'Default color' }), el('span', { text: 'When pressed' })]),
  ]);
  const btnResetOne = el('button.pbtn.primary', { type: 'button', html: dicon('sync') + '<span>Reset this button</span>' });
  btnResetOne.addEventListener('click', () => { if (selPin === TRIG) setAction(TRIG, 11); else if (selPin in L.defaults) setAction(selPin, L.defaults[selPin]); });
  const btnResetAll = el('button.pbtn.outline', { type: 'button', html: dicon('sync') + '<span>Reset all buttons</span>' });
  btnResetAll.addEventListener('click', () => { for (const k in L.defaults) m.action[k] = L.defaults[k]; if (L.m && m.taction !== 11) { m.taction = 11; markDirty('cal'); } markDirty('pins'); markDirty('led'); refreshSide(); });
  const settingsPanel = el('div.panel.hidden', {}, [
    el('div.ptitle', { text: 'BUTTON SETTINGS' }),
    el('div.lbl', { text: 'Function' }), fn, comboRow,
    ledBlock,
    btnResetOne, btnResetAll,
    el('p.hint', { html: 'Click <b>Save</b> to apply your changes to the controller' }),
  ]);

  // GLOBAL LED SETTINGS: GP2040-CE's own effects; the color is set on every button (like "LED color for all buttons")
  const effect = el('select.field');
  EFFECTS.forEach((n, i) => effect.append(el('option', { value: i, text: n })));
  effect.addEventListener('change', () => { m.mode = +effect.value; markDirty('led'); });
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
  wheel.addEventListener('click', e => {
    const r = wheel.getBoundingClientRect(), x = e.clientX - r.left - r.width / 2, y = e.clientY - r.top - r.height / 2;
    if (Math.hypot(x, y) < r.width * 0.3) return pickColor(allColor, c => { showAllColor(c); setAllLeds(c); });   // the middle: any color
    let h = Math.atan2(y, x) * 180 / Math.PI + 90; if (h < 0) h += 360;
    const c = hueColor(h); showAllColor(c); setAllLeds(c);
  });
  const swatches = el('div.sw', {}, [0xe02b2b, 0xe09c06, 0x0634e0, 0xeb2fdb].map(c => { const b = el('button', { type: 'button', title: hex(c) }); b.style.background = hex(c); b.addEventListener('click', () => { showAllColor(c); setAllLeds(c); }); return b; }));
  const plus = el('button.plus', { type: 'button', title: 'Another color...', html: dicon('plus') });
  plus.addEventListener('click', () => pickColor(allColor, c => { showAllColor(c); setAllLeds(c); }));
  swatches.append(plus);
  const brightVal = el('span');
  const bright = el('input.range', { type: 'range', min: 0, max: 5, step: 1 });
  const paintBright = () => { const p = +bright.max ? +bright.value / +bright.max * 100 : 0; bright.style.setProperty('--p', p + '%'); brightVal.textContent = Math.round(p) + '%'; };
  bright.addEventListener('input', () => { m.brightness = +bright.value; paintBright(); markDirty('led'); });
  // Idle Glow and Animation time: in the design's panel, but GP2040-CE has neither setting, so they're shown switched off
  // (as the design draws them for an effect that doesn't use them)
  const idle = dtoggle('Idle Glow', () => { }); idle.disabled = true;
  idle.el.title = 'Idle Glow is a HOJA2 setting: GP2040-CE does not have it';
  const anim = dslider('Animation time', 0, 100, () => '', () => { }); anim.value = 25; anim.disabled = true;
  anim.el.title = 'GP2040-CE sets the animation speed itself';
  const colorLbl = el('span', { text: 'Color' });
  const ledPanel = el('div.panel.ledp', {}, [
    el('div.ptitle', { text: 'GLOBAL LED SETTINGS' }),
    el('div.lbl', { text: 'Lighting effect' }), effect,
    el('div.lbl.idle-row', {}, [colorLbl, idle.el]),
    el('div.colorrow', {}, [wheel, el('div', {}, [el('div.readout', {}, [rgbTxt, hexTxt]), swatches])]),
    el('div.dslider', {}, [el('div.lbl.split', {}, [el('span', { text: 'Brightness' }), brightVal]), bright]), anim.el,
    status,
  ]);
  const column = el('div.side-col', {}, [empty, settingsPanel, ledPanel]);
  // PROFILE: the button profile in use, which is also the one this page edits
  // (a dropdown above the right-hand panels; each profile shows its name from GP2040-CE, or "Profile n")
  const profileName = n => { const d = n === 1 ? m.pinDoc : m.altDocs[n - 2]; const t = d && d.profileLabel ? String(d.profileLabel).trim() : ''; return t || 'Profile ' + n; };
  const profileBar = el('select.field.profile-sel', { title: 'The button profile in use (on the controller: hold Home + Touchpad and press 1P, 2P, 3P or 4P)' });
  for (let n = 1; n <= 4; n++) profileBar.append(el('option', { value: n, text: profileName(n) }));
  profileBar.addEventListener('change', () => { const n = +profileBar.value; m.profileNumber = n; m.editProfile = n; markDirty('settings'); refreshSide(); });
  const page0 = el('div.page.controller', {}, [drawing.svg, profileBar, column]);

  function refreshSide() {
    bright.max = Math.max(1, m.steps); bright.value = clamp(m.brightness, 0, m.steps); paintBright();
    effect.value = String(clamp(m.mode, 0, 4));
    profileBar.value = String(clamp(m.editProfile, 1, 4));
    const none = selPin < 0;
    empty.classList.toggle('hidden', !none); settingsPanel.classList.toggle('hidden', none);
    column.classList.toggle('selected', !none); page0.classList.toggle('selected', !none);
    colorLbl.textContent = none ? 'Color' : 'LED color';   // as the design words it in each state
    if (!none) {
      const ph = selPin === TRIG ? null : m.phys(selPin);
      for (const o of fn.options) o.disabled = selPin === TRIG && !TRIG_OK.has(+o.value);   // what the trigger can do
      fn.value = String(actOf(selPin)); fn.disabled = !!(ph && ph.fixed);
      const isCombo = actOf(selPin) === 40, one = act(actOf(selPin));
      // a combo can be any of the buttons and directions; not Turbo, Fn or the trigger
      const canCombo = selPin !== TRIG && !(ph && ph.fixed) && (isCombo || actOf(selPin) === -10 || !!(one && one.key));
      comboRow.classList.toggle('off', !canCombo || !isCombo);   // shown for a combo only (choose "Custom combo" in Function)
      comboTxt.textContent = isCombo ? (comboName(m.comboOf(selPin)) || 'nothing yet') : one && one.key ? one.key : 'nothing';
      comboEdit.textContent = isCombo ? 'Edit' : '+ Add';
      for (const o of fn.options) if (+o.value === 40) o.disabled = selPin === TRIG;   // the trigger can't be a combo
      const slot = selPin === TRIG ? -1 : m.ledSlot(ph);
      ledBlock.classList.toggle('noled', slot < 0);   // keeps its space, so the panels below don't move
      if (slot >= 0) { ledU.set(m.ledU[slot]); ledD.set(m.ledD[slot]); }
      btnResetOne.disabled = !(selPin in L.defaults) && selPin !== TRIG;
    }
    drawing.refreshTips();
  }
  function pickLed(pressedColor) {
    const slot = m.ledSlot(m.phys(selPin));
    if (slot < 0) return;
    pickColor(pressedColor ? m.ledD[slot] : m.ledU[slot], c => { if (pressedColor) m.ledD[slot] = c; else m.ledU[slot] = c; markDirty('led'); refreshSide(); });
  }
  function setAction(pin, a) {
    if (pin === TRIG) { if (actOf(TRIG) !== a) { m.taction = a; markDirty('cal'); refreshSide(); } return; }
    if (m.actionOf(pin) === a) return; m.action[pin] = a; markDirty('pins'); markDirty('led'); refreshSide(); }
  function setAllLeds(c) { for (let i = 0; i < m.ledU.length; i++) m.ledU[i] = c; markDirty('led'); refreshSide(); }
  function select(pin) { selPin = pin; refreshSide(); }
  showAllColor(m.ledU[L.phys.find(p => p.led >= 0).led]);
  // the drawing follows the controller: the selected button orange, pressed buttons lit
  const drawTick = setInterval(() => {
    if (!alive) return clearInterval(drawTick);
    drawing.set(selPin, isPressed);
    // each face button's LED around it: its color, or its "when pressed" color while held
    drawing.setLeds(pin => { const slot = m.ledSlot(m.phys(pin)); return slot < 0 ? null : hex(isPressed(pin) ? m.ledD[slot] : m.ledU[slot]); });
    drawing.setSticks(sticks.map(s => [s.outX, s.outY]));   // the orange dots follow the real sticks
  }, 30);


  // ---------------------------------------------------------------- the design's building blocks for the other pages
  // (panels, switches, sliders and buttons: parts.js)
  function dselect(items, onchange) {
    const s = el('select.field');
    items.forEach((t, i) => s.append(el('option', { value: i, text: t })));
    s.addEventListener('change', () => onchange(+s.value));
    return s;
  }

  // ---------------------------------------------------------------- STICKS page
  // The redesign: one tall panel per stick - its name with Calibrated / Not calibrated, Enabled; the gate with the stick
  // in it and its reading; the axes; the gate's shape; the deadzones; then Reset and Calibrate. A stick switched off shows
  // "Stick disabled" instead of its settings.
  const sticks = [makeStick(0, 'LEFT STICK'), makeStick(1, 'RIGHT STICK')];
  const page1 = el('div.page.hidden.dpage.sticks', {}, sticks.map(s => s.card));
  function makeStick(idx, title) {
    const cv = el('canvas.gate'), tag = badge();
    const en = dtoggle('Enabled', v => { if (idx === 0) m.stick1Enabled = v; else m.stick2Enabled = v; markDirty('cal'); showOn(); }, 'Disabled');
    const rd1 = el('div.rd1'), rd2 = el('div.rd2'), infoL = el('p.cal-info');
    const bCal = pbtn('Calibrate', 'target', true, () => begin());
    const bNext = pbtn('Next', '', true, () => next());
    const bCancel = pbtn('Cancel', '', false, () => end('Calibration cancelled.'));
    const bReset = pbtn('Reset', 'sync', false, () => postCal({ ['s' + (idx + 1) + 'cal']: false }, 'Calibration removed. The stick is centred automatically at power-up again.'));
    bReset.title = 'Remove the stored calibration'; bCal.title = 'Store the stick\'s centre and full range in the controller';
    const fx = dtoggle('Flip X axis', () => flip()), fy = dtoggle('Flip Y axis', () => flip());
    // the gate: the right stick's is always round (GP2040-CE's forced circularity); the left one is round by default
    // and can be switched to octagonal (the stick then reaches the octagon's corners)
    const gate = segmented(['Round Gate', 'Octagonal Gate'], v => { m.circularity = v === 0; markDirty('settings'); });
    if (idx === 1) gate.lock(true, 'This stick\'s gate is always round');
    const inner = dslider('Inner deadzone', 0, 100, v => v + '%', v => { if (idx === 0) m.innerDeadzone = v; else m.innerDeadzone2 = v; markDirty('settings'); });
    // GP2040-CE stores how far out the stick reaches 100% (100 = all the way); shown as the deadzone at the edge (0% = none)
    const outer = dslider('Outer deadzone', 0, 100, v => v + '%', v => { if (idx === 0) m.outerDeadzone = 100 - v; else m.outerDeadzone2 = 100 - v; markDirty('settings'); });
    const offMsg = el('div.stick-off', {}, [el('div.empty-t', { text: 'Stick disabled' }),
      el('div.empty-d', { text: 'This stick is currently disabled. Enable it to access calibration, deadzone, and other input settings.' })]);
    // while calibrating, the steps take the settings' place
    const settingsBox = el('div.stick-set', {}, [el('div.two.flips', {}, [fx.el, fy.el]), gate.el, inner.el, outer.el]);
    const controls = el('div.stick-ctl', {}, [settingsBox, infoL, el('div.btnrow.bottom', {}, [bReset, bCal, bCancel, bNext])]);
    const absent = el('div.empty-d', { text: 'No analog stick on this output.', style: { padding: '90px 0', textAlign: 'center' } });
    const body = el('div.stick-body', {}, [el('div.gate-wrap', {}, [cv]), el('div.rd', {}, [rd1, rd2]), controls, offMsg]);
    const c = panel(title, [body, absent], 'stick');
    c.firstChild.append(tag.el, en.el);   // the badge and "Enabled" on the title row
    const st = { card: c, outX: 0, outY: 0, state: 0, hx: [], hy: [], seen: 0, trail: [], present: true, msg: '' };
    let prov = null, w = null;
    const isAbsent = idx === 1 && L.noRightStick;
    body.classList.toggle('hidden', isAbsent); absent.classList.toggle('hidden', !isAbsent); en.el.classList.toggle('hidden', isAbsent); tag.el.classList.toggle('hidden', isAbsent);

    function flip() { m.stick[idx].inv = (fx.checked ? 1 : 0) | (fy.checked ? 2 : 0); markDirty('cal'); }
    function showOn() {
      const on = en.checked;
      controls.classList.toggle('hidden', !on); offMsg.classList.toggle('hidden', on);
      if (!on && st.state) end();
    }
    st.sync = () => {
      const c2 = m.stick[idx];
      fx.checked = (c2.inv & 1) !== 0; fy.checked = (c2.inv & 2) !== 0;
      en.checked = idx === 0 ? m.stick1Enabled : m.stick2Enabled;
      inner.value = clamp(idx === 0 ? m.innerDeadzone : m.innerDeadzone2, 0, 100);
      outer.value = 100 - clamp(idx === 0 ? m.outerDeadzone : m.outerDeadzone2, 0, 100);
      if (idx === 0) gate.value = m.circularity ? 0 : 1; else { gate.value = 0; m.circularity2 = true; }   // saved round with the next Save
      showOn(); refresh();
    };
    const sync = st.sync;
    function refresh() {
      for (const [b, show] of [[bCal, st.state === 0], [bReset, st.state === 0], [bNext, st.state !== 0], [bCancel, st.state !== 0]]) b.classList.toggle('hidden', !show);
      tag.set(st.state ? 'busy' : m.stick[idx].cal ? 'ok' : 'no');
      settingsBox.classList.toggle('hidden', st.state !== 0); infoL.classList.toggle('hidden', st.state === 0);
      if (st.state === 0) st.status = '';
    }
    // the steps in the panel while calibrating; the result in the status line at the bottom
    function say(t, color) { if (st.state) { infoL.textContent = t || ''; infoL.style.color = color || ''; } else if (t) shell.footer(t, color); }
    const mean = q => q.reduce((a, b) => a + b, 0) / Math.max(1, q.length);
    const spread = q => q.length ? Math.max(...q) - Math.min(...q) : 0;
    function begin() { st.state = 1; st.trail = []; st.msg = ''; say('Step 1 of 2: let go of the stick so it rests in the middle, then click Next.'); setPbtn(bNext, 'Next'); refresh(); }
    function next() {
      if (st.state === 1) {
        if (st.hx.length < 8) { say('Not enough readings yet, wait a second and click Next again.', 'var(--warn)'); return; }
        const wob = Math.max(spread(st.hx), spread(st.hy));
        if (wob > 120) { say(`The stick is still moving (${wob} counts of wobble). Let it rest and click Next again.`, 'var(--warn)'); return; }
        const cx = mean(st.hx), cy = mean(st.hy);
        w = { cx, cy, minX: cx, maxX: cx, minY: cy, maxY: cy };
        st.state = 2; st.trail = [];
        say('Step 2 of 2: roll the stick slowly around the edge 3 times, touching every corner. Click Finish when the trace shows the whole gate.');
        setPbtn(bNext, 'Finish');
      } else if (st.state === 2) {
        const rx = Math.min(w.maxX - w.cx, w.cx - w.minX), ry = Math.min(w.maxY - w.cy, w.cy - w.minY);
        if (rx < 250 || ry < 250) { say(`Not enough movement: the stick has to reach the edge on all four sides (now ${rx | 0} / ${ry | 0} counts, need at least 250). Keep rolling it.`, 'var(--warn)'); return; }
        const k = 's' + (idx + 1);
        postCal({ [k + 'cal']: true, [k + 'cx']: Math.round(w.cx), [k + 'cy']: Math.round(w.cy), [k + 'minx']: w.minX | 0, [k + 'maxx']: w.maxX | 0, [k + 'miny']: w.minY | 0, [k + 'maxy']: w.maxY | 0 }, 'Saved to the controller. Restart the controller to use it.');
      }
    }
    function end(msg, color) { st.state = 0; st.trail = []; refresh(); say(msg, color); }
    async function postCal(body, msg) {
      try { const r = await dev.post('/api/setCalibration', body); m.loadCal(r); end(msg, 'var(--good)'); sync(); }
      catch (e) { say('Couldn\'t save: ' + e.message, 'var(--bad)'); }
    }
    const norm = (v, c2, lo, hi) => v >= c2 ? (hi - c2 > 1 ? Math.min(1, (v - c2) / (hi - c2)) : 0) : (c2 - lo > 1 ? -Math.min(1, (c2 - v) / (c2 - lo)) : 0);
    st.feed = (x, y) => {
      st.present = x >= 0 && y >= 0;
      if (!st.present) { st.outX = st.outY = 0; return; }
      st.seen++; st.hx.push(x); st.hy.push(y); if (st.hx.length > 30) { st.hx.shift(); st.hy.shift(); }
      if (st.seen === 20) { const cx = mean(st.hx), cy = mean(st.hy); prov = { cx, cy, minX: cx - 800, maxX: cx + 800, minY: cy - 800, maxY: cy + 800 }; }
      const c2 = m.stick[idx]; let r, inv = 0;
      if (st.state === 2) { w.minX = Math.min(w.minX, x); w.maxX = Math.max(w.maxX, x); w.minY = Math.min(w.minY, y); w.maxY = Math.max(w.maxY, y); r = w; }
      else if (c2.cal) { r = c2; inv = c2.inv; }
      else if (prov) { if (st.seen > 20) { prov.minX = Math.min(prov.minX, x); prov.maxX = Math.max(prov.maxX, x); prov.minY = Math.min(prov.minY, y); prov.maxY = Math.max(prov.maxY, y); } r = prov; inv = c2.inv; }
      else r = { cx: x, cy: y, minX: x - 800, maxX: x + 800, minY: y - 800, maxY: y + 800 };
      if (st.state === 1) { const cx = mean(st.hx), cy = mean(st.hy); r = { cx, cy, minX: cx - 1500, maxX: cx + 1500, minY: cy - 1500, maxY: cy + 1500 }; }
      let nx = norm(x, r.cx, r.minX, r.maxX), ny = -norm(y, r.cy, r.minY, r.maxY);
      if (inv & 1) nx = -nx; if (inv & 2) ny = -ny;
      st.outX = nx; st.outY = ny;
      if (st.state === 2 && Math.hypot(nx, ny) > 0.55) { st.trail.push([nx, ny]); if (st.trail.length > 4000) st.trail.shift(); }
      if (st.state === 1) st.status = 'resting: ' + Math.max(spread(st.hx), spread(st.hy)) + ' counts of wobble';
      if (st.state === 2) { const rx = Math.min(w.maxX - w.cx, w.cx - w.minX), ry = Math.min(w.maxY - w.cy, w.cy - w.minY); st.status = `reach so far: X ${rx | 0}  Y ${ry | 0} counts`; }
    };
    // the gate (parts.js paintGate): a round gate stops the dot at the circle, as the firmware does
    st.paint = () => {
      if (isAbsent || page1.classList.contains('hidden')) return;
      const round = idx === 0 ? m.circularity : true;
      let px = st.outX, py = st.outY; const pm = Math.hypot(px, py); if (round && pm > 1) { px /= pm; py /= pm; }
      paintGate(cv, { round, din: (idx === 0 ? m.innerDeadzone : m.innerDeadzone2) / 100, dout: (idx === 0 ? m.outerDeadzone : m.outerDeadzone2) / 100,
        out: [px, py], trail: st.trail, gate: st.state ? '#ff6800' : '#666666', off: !en.checked });
      const r = readout(st.outX, st.outY);
      rd1.textContent = r.xy; rd2.textContent = st.state && st.status ? st.status : r.centered ? 'Centered' : r.angle;
    };
    return st;
  }

  // ---------------------------------------------------------------- SETTINGS page
  // INPUT BEHAVIOR and TURBO, each with Reset (back to GP2040-CE's defaults) and Save. TURBO's "Assigned Buttons" always
  // repeat while held when turbo is on (GP2040-CE's SHMUP "always on" buttons); a button with the Turbo function can
  // still switch turbo on or off for any button while playing.
  const socd = dselect(SOCD, i => { m.socdMode = i; markDirty('settings'); });
  const fourWay = dtoggle('4-way mode (No diagonals on the D-Pad / Left stick)', v => { m.fourWayMode = v; markDirty('settings'); });
  const debounce = dslider('Debounce delay', 0, 50, v => v === 0 ? 'Off' : v + 'ms', v => { m.debounceDelay = v; markDirty('settings'); });
  const rumble = dtoggle('Rumble enabled', v => { m.rumbleEnabled = v; markDirty('cal'); });
  const turbo = dtoggle('Enabled', v => { m.turboEnabled = v; markDirty('settings'); syncTurbo(); }, 'Disabled');
  const shots = dslider('Shot count (Higher is faster)', 2, 30, null, v => { m.turboShotCount = v; markDirty('settings'); });
  const TURBO_BTNS = COMBO_PARTS.filter(p => p.kind === 'b' && p.bit <= 128).map(p => { const a = ACTS.find(x => x.key === p.name); return { value: p.bit, text: a ? fnName(a) : p.name, short: p.name }; });
  const assigned = multiSelect('Select buttons to enable Turbo', TURBO_BTNS, v => { m.turboMask = v.reduce((a, b) => a | b, 0); markDirty('settings'); });
  assigned.el.title = 'These buttons repeat by themselves while held, whenever turbo is on';
  const inputPanel = panel('INPUT BEHAVIOR', [el('div.lbl', { text: 'SOCD cleaning mode' }), socd, fourWay.el, debounce.el,
    el('div.btnrow.bottom', {}, [
      pbtn('Reset', 'sync', false, () => { m.socdMode = 1; m.fourWayMode = false; m.debounceDelay = 5; syncSettings(); markDirty('settings'); }),
      pbtn('Save', 'check', true, () => flush()),
    ])], 'stretch');
  const turboOn = el('div.turbo-on', {}, [shots.el, el('div.lbl', { text: 'Assigned Buttons' }), assigned.el,
    el('p.hint.wrap', { text: 'Turbo Mode automatically repeats the assigned button input while held, allowing faster repeated actions with less effort.' }),
    el('div.btnrow.bottom', {}, [
      pbtn('Reset', 'sync', false, () => { m.turboShotCount = 5; m.turboMask = 0; syncSettings(); markDirty('settings'); }),
      pbtn('Save', 'check', true, () => flush()),
    ])]);
  const turboOff = el('div.panel-off', {}, [el('div.off-icon', { html: dicon('bolt') }), el('div.empty-t', { text: 'Turbo mode disabled' }),
    el('div.empty-d', { text: 'Enable Turbo Mode to repeat supported\nbutton inputs automatically while held' })]);
  const turboPanel = panel('TURBO', [turboOn, turboOff], 'stretch');
  turboPanel.firstChild.append(turbo.el);
  function syncTurbo() { turboOn.classList.toggle('hidden', !turbo.checked); turboOff.classList.toggle('hidden', turbo.checked); }
  const page2 = el('div.page.hidden.dpage.settings', {}, [inputPanel, turboPanel]);
  function syncSettings() {
    socd.value = String(clamp(m.socdMode, 0, 4)); fourWay.checked = m.fourWayMode; debounce.value = m.debounceDelay;
    turbo.checked = m.turboEnabled; shots.value = m.turboShotCount; rumble.checked = m.rumbleEnabled;
    assigned.value = TURBO_BTNS.filter(t => (m.turboMask & t.value) !== 0).map(t => t.value); syncTurbo();
  }


  // ---------------------------------------------------------------- BACKUP & RESTORE page (parts.js): the whole configuration
  // (GP2040-CE's /api/getConfig), to a file and the backup history; restoring sends it back (/api/setConfig)
  const backup = backupPage({
    controller: 'GP2040-CE', board: L.board, firmware: s.ver && s.ver.version ? String(s.ver.version) : '',
    modeTitle: 'Profiles', mode: () => '4',   // the design's "Profiles" column: this app keeps all four button profiles
    exportData: () => dev.get('/api/getConfig'),
    fileName: name => 'PadBox ' + L.board + ' - GP2040-CE - ' + name.replace(/[\\/:*?"<>|]/g, '_') + '.json',
    check: d => !d || typeof d !== 'object' || Array.isArray(d) ? 'This file isn\'t a PadBox configuration file.'
      : d.format ? 'This is a ' + (/hoja/.test(d.format) ? 'HOJA2' : 'different') + ' configuration file: it only goes back onto a PadBox running that firmware.' : '',
    restore: async d => { await dev.post('/api/setConfig', d); return 'Restored. Click Restart as controller to apply everything.'; },
  });
  const page3 = backup.page;

  // ---------------------------------------------------------------- the side menu
  const tabNames = ['CONTROLLER', 'STICKS', 'SETTINGS', 'BACKUP & RESTORE'], pages = [page0, page1, page2, page3];
  shell.content(el('div', { style: { position: 'absolute', inset: 0 } }, pages));
  shell.tabs(tabNames, i => pages.forEach((p, k) => p.classList.toggle('hidden', k !== i)));
  refreshSide(); syncSettings(); sticks.forEach(s => s.sync && s.sync());
  // the demo: ?sel=<pin> opens with that button selected
  shell.footer('');
  { const q = opts.demo && /[?&]sel=(\d+)/.exec(location.search); if (q) select(+q[1]); }

  // ---------------------------------------------------------------- save / restart
  async function flush() {
    if (!Object.values(dirty).some(Boolean)) return;
    const d = { ...dirty }; for (const k in dirty) dirty[k] = false;
    btnSave.disabled = true; say('Saving...', 'var(--warn)');
    try {
      if (d.pins) { await dev.post('/api/setPinMappings', m.pinsBody()); await dev.post('/api/setProfileOptions', m.profilesBody()); }
      if (d.led) {
        const b = m.ledBodies();
        await dev.post('/api/setLedOptions', b.ledOpts); await dev.post('/api/setCustomTheme', b.theme);
        await dev.post('/api/setPadboxLed', { mode: m.mode, brightness: m.brightness });
      }
      if (d.settings) { await dev.post('/api/setGamepadOptions', m.gamepadBody()); await dev.post('/api/setAddonsOptions', m.addonBody()); }
      if (d.cal) { m.loadCal(await dev.post('/api/setCalibration', m.calMiscBody())); sticks.forEach(s => s.sync && s.sync()); }
      // read the button map back: the save only counts if the controller really has it
      if (d.pins) {
        const back = await dev.get('/api/getPinMappings'), want = m.pinsBody();
        const off = Object.keys(want).filter(k => want[k] && typeof want[k] === 'object' && back[k] && back[k].action !== want[k].action);
        if (off.length) throw new Error('the controller still has the old setting for ' + off.map(k => m.nameOfPin(+k.slice(3))).join(', '));
      }
      if (d.led) {
        const back = await dev.get('/api/getPadboxLed');
        if (back.mode !== m.mode || back.brightness !== m.brightness) throw new Error('the controller still has the old LED effect');
      }
      say('Saved and checked. Click Restart as controller to use the new buttons.', 'var(--good)');
    } catch (e) {
      for (const k in d) if (d[k]) dirty[k] = true;
      btnSave.disabled = false; say('Saving failed: ' + e.message, 'var(--bad)');
    }
  }
  async function reboot(mode, quiet) {
    await flush();
    alive = false;
    try { await dev.post('/api/reboot', { bootMode: mode }); } catch (e) { }
    if (!quiet) shell.lost(mode === 2 ? 'The PadBox restarted into update mode.' : mode === 1 ? 'The PadBox is restarting to preview its LEDs. Hold Start while plugging it in to configure it again.' : 'The PadBox restarted as a controller. Hold Start while plugging it in to configure it again.');
  }

  // the analog trigger (adc[4], raw 0..4095), 0..1 for the drawing: from its stored calibration, or else
  // learned as it goes (released = the first readings, fully pulled = the furthest it has gone), as in the current app
  const tAuto = { n: 0, sum: 0, idle: 0, ext: null };
  function trigLevel(v) {
    if (v == null || v < 0) return null;
    const inv = m.tinvert !== 0;
    let idle, ext;
    if (m.tcal) { idle = m.tidle; ext = m.tpressed; }
    else {
      if (tAuto.n < 20) { tAuto.n++; tAuto.sum += v; tAuto.idle = tAuto.sum / tAuto.n; }
      idle = tAuto.idle;
      if (tAuto.ext == null) tAuto.ext = inv ? idle - 400 : idle + 400;
      if (inv ? v < tAuto.ext : v > tAuto.ext) tAuto.ext = v;
      ext = tAuto.ext;
    }
    const span = inv ? idle - ext : ext - idle, travel = inv ? idle - v : v - idle;
    const lv = span > 1 ? clamp(travel / span, 0, 1) : 0;
    return lv < 0.04 ? 0 : lv;
  }

  // ---------------------------------------------------------------- live state
  (async () => {
    let fails = 0, last = 0n;
    while (alive) {
      try {
        const d = await dev.get('/api/getLiveState');
        const p = (BigInt(d.gpio >>> 0)) | (BigInt((d.gpioHi || 0) >>> 0) << 32n);
        const fresh = p & ~last; last = p; pressed = p;
        adc = d.adc || adc;
        sticks[0].feed(adc[0] ?? -1, adc[1] ?? -1);
        if (!L.noRightStick) sticks[1].feed(adc[2] ?? -1, adc[3] ?? -1);
        sticks.forEach(s => s.paint());
        if (L.m) {   // 0..100% only as the left / right analog trigger; as any other button it's pressed past half
          const ta = actOf(TRIG), lv = trigLevel(adc[4]), analog = ta === 11 || ta === 12;
          drawing.setTrigger(ta === -10 ? 0 : analog ? lv : (lv >= 0.5 ? 1 : 0), analog);
        }
        if (fresh && !page0.classList.contains('hidden')) {
          const ph = L.phys.find(x => (fresh >> BigInt(x.pin)) & 1n); if (ph) select(ph.pin);
        }
        fails = 0;
        await sleep(15);
      } catch (e) {
        if (!alive) return;
        if (++fails >= 3) { alive = false; shell.lost('Lost the connection to the PadBox.'); return; }
        await sleep(200);
      }
    }
  })();

  return { stop() { alive = false; }, dirty: () => Object.values(dirty).some(Boolean) };
}
