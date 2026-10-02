// COPY for trying the new design (Figma "PadBox Software"): the GP2040-CE PadBox Calibrator for the PadBox GS Essential,
// with the redesigned CONTROLLER page and frame (header, side menu). STICKS, SETTINGS and BACKUP are the current app's pages,
// and saving works exactly as in the app (js/gp/app.js), which this is a copy of.

import { el, icon, button, card, toggle, slider, combo, setItems, swatchRow, pickColor, hex, readable, image, clamp, sleep, download, openFile, confirmBox, setButtonText } from './js/ui.js';
import { Model, ACTS, act } from './js/gp/model.js';
import { firmwareUpdate } from './js/update.js';
import { buildDrawing } from './drawing.js';
import { dicon } from './icons.js';

const SOCD = ['Up priority', 'Neutral (opposite directions cancel out)', 'Second input priority', 'First input priority (locking)', 'Bypass (no cleaning)'];
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

  shell.header('GP2040-CE', m.board || ('PadBox ' + L.name));
  shell.status(true);

  // ---------------------------------------------------------------- header buttons (the design's icon buttons)
  const iconBtn = (cls, ic, title, onclick) => { const b = el('button.act.' + cls, { type: 'button', title, html: dicon(ic) }); b.addEventListener('click', onclick); return b; };
  const btnUpdate = iconBtn('outline', 'download', 'Update firmware', () => firmwareUpdate({ board: L.board, current: 'GP2040-CE', enter: noDrive => reboot(noDrive ? 3 : 2, true) }));
  const btnSave = iconBtn('save', 'save', 'Save to the controller', () => flush()); btnSave.disabled = true;
  const btnPreview = iconBtn('light', 'beacon', 'Restart to Preview LED', () => reboot(1));
  const btnExit = el('button.act.primary', { type: 'button', html: dicon('gamepad') + '<span>Restart as controller</span>' }); btnExit.addEventListener('click', () => reboot(0));
  shell.actions([btnUpdate, btnSave, btnPreview, btnExit]);

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
  const drawing = buildDrawing(pin => select(pin), pin => {
    const a = act(actOf(pin));
    return (pin === TRIG ? 'Analog trigger' : m.nameOfPin(pin)) + '  →  ' + (a && a.value !== -10 ? fnName(a) : 'nothing');
  }, pin => { const a = act(actOf(pin)); return !a || a.value === -10 ? '' : a.value === 32 ? 'Turbo' : a.value <= 4 ? a.key : a.short; },   // D-pad: Up/Down/Left/Right, drawn as arrows
  { 'GS Platform': 'platform', 'M Essential': 'm-essential', 'M Platform': 'm-platform' }[L.board] || 'essential');   // @M
  // @GS { 'GS Platform': 'platform' }[L.board] || 'essential');

  // the right-hand column: BUTTON SETTINGS (or "No button selected"), then GLOBAL LED SETTINGS
  const status = el('p.hint2');
  const empty = el('div.panel.empty', {}, [
    el('div.click-icon', { html: dicon('click') }),
    el('div.empty-t', { text: 'No button selected' }),
    el('div.empty-d', { text: 'Click a button on the controller or press it on the device to configure its function and LED lighting' }),
  ]);
  const fn = el('select.field.mono');
  for (const a of ACTS) fn.append(el('option', { value: a.value, text: fnName(a) }));
  fn.addEventListener('change', () => { if (selPin >= 0) setAction(selPin, +fn.value); });
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
    el('div.lbl', { text: 'Function' }), fn,
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
  const ledPanel = el('div.panel', {}, [
    el('div.ptitle', { text: 'GLOBAL LED SETTINGS' }),
    el('div.lbl', { text: 'Lighting effect' }), effect,
    el('div.lbl', { text: 'LED color' }),
    el('div.colorrow', {}, [wheel, el('div', {}, [el('div.readout', {}, [rgbTxt, hexTxt]), swatches])]),
    el('div.lbl.split', {}, [el('span', { text: 'Brightness' }), brightVal]), bright,
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
    column.classList.toggle('selected', !none);
    if (!none) {
      const ph = selPin === TRIG ? null : m.phys(selPin);
      for (const o of fn.options) o.disabled = selPin === TRIG && !TRIG_OK.has(+o.value);   // what the trigger can do
      fn.value = String(actOf(selPin)); fn.disabled = !!(ph && ph.fixed);
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
  const panel = (title, kids, cls) => el('div.panel' + (cls ? '.' + cls : ''), {}, [el('div.ptitle', { text: title }), ...kids]);
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
    return { el: wrap, get value() { return +input.value; }, set value(v) { input.value = v; paint(); } };
  }
  function dselect(items, onchange) {
    const s = el('select.field');
    items.forEach((t, i) => s.append(el('option', { value: i, text: t })));
    s.addEventListener('change', () => onchange(+s.value));
    return s;
  }
  function pbtn(text, ic, primary, onclick) {
    const b = el('button.pbtn.' + (primary ? 'primary' : 'outline'), { type: 'button', html: (ic ? icon(ic) : '') + '<span>' + text + '</span>' });
    b.addEventListener('click', onclick);
    return b;
  }

  // ---------------------------------------------------------------- STICKS page
  const sticks = [makeStick(0, 'LEFT STICK'), makeStick(1, 'RIGHT STICK')];
  const page1 = el('div.page.hidden.dpage.sticks', {}, sticks.map(s => s.card));
  function makeStick(idx, title) {
    const cv = el('canvas.gate');
    const en = dtoggle('Stick enabled', v => { if (idx === 0) m.stick1Enabled = v; else m.stick2Enabled = v; markDirty('cal'); });
    const stepL = el('div.step'), infoL = el('div.info');
    const bCal = pbtn('Calibrate', 'target', true, () => begin());
    const bNext = pbtn('Next', '', true, () => next());
    const bCancel = pbtn('Cancel', '', false, () => end('Calibration cancelled.'));
    const bReset = pbtn('Reset', 'reset', false, () => postCal({ ['s' + (idx + 1) + 'cal']: false }, 'Calibration removed. The stick is centred automatically at power-up again.'));
    const fx = dtoggle('Flip X axis', () => flip()), fy = dtoggle('Flip Y axis', () => flip());
    const inner = dslider('Inner deadzone', 0, 100, v => v + '%', v => { if (idx === 0) m.innerDeadzone = v; else m.innerDeadzone2 = v; markDirty('settings'); });
    const outer = dslider('Outer deadzone', 0, 100, v => v + '%', v => { if (idx === 0) m.outerDeadzone = v; else m.outerDeadzone2 = v; markDirty('settings'); });
    // the gate: the right stick's is always round (GP2040-CE's forced circularity); the left one is round by default
    // and can be switched to octagonal (the stick then reaches the octagon's corners)
    const circ = idx === 0 ? dtoggle('Force circularity (round gate)', v => { m.circularity = v; markDirty('settings'); }) : null;
    const circNote = idx === 0 ? null : el('p.hint.wrap', { text: 'Circularity is always forced on this stick (round gate).' });
    const absent = el('div.empty-d', { text: 'No analog stick on this output.', style: { padding: '90px 0', textAlign: 'center' } });
    const body = el('div.stick-body', {}, [
      el('div.gate-col', {}, [cv]),
      el('div.ctl-col', {}, [stepL, infoL, el('div.btnrow', {}, [bCal, bReset, bNext, bCancel]),
        el('div.lbl', { text: 'Axes' }), el('div.two', {}, [fx.el, fy.el]),
        inner.el, outer.el, circ && el('div', { style: { height: '6px' } }), circ && circ.el, circNote]),
    ]);
    const c = panel(title, [body, absent], 'stick');
    c.firstChild.append(en.el);   // "Stick enabled" on the title row
    const st = { card: c, outX: 0, outY: 0, state: 0, hx: [], hy: [], seen: 0, trail: [], present: true };
    let prov = null, w = null;
    const isAbsent = idx === 1 && L.noRightStick;
    body.classList.toggle('hidden', isAbsent); absent.classList.toggle('hidden', !isAbsent); en.el.classList.toggle('hidden', isAbsent);

    function flip() { m.stick[idx].inv = (fx.checked ? 1 : 0) | (fy.checked ? 2 : 0); markDirty('cal'); }
    st.sync = () => {
      const c2 = m.stick[idx];
      fx.checked = (c2.inv & 1) !== 0; fy.checked = (c2.inv & 2) !== 0;
      en.checked = idx === 0 ? m.stick1Enabled : m.stick2Enabled;
      inner.value = clamp(idx === 0 ? m.innerDeadzone : m.innerDeadzone2, 0, 100);
      outer.value = clamp(idx === 0 ? m.outerDeadzone : m.outerDeadzone2, 0, 100);
      if (circ) circ.checked = m.circularity; else m.circularity2 = true;   // saved round with the next Save
      refresh();
    };
    const sync = st.sync;
    function refresh() {
      bCal.classList.toggle('hidden', st.state !== 0); bReset.classList.toggle('hidden', st.state !== 0);
      bNext.classList.toggle('hidden', st.state === 0); bCancel.classList.toggle('hidden', st.state === 0);
      if (st.state !== 0) return;
      const c2 = m.stick[idx];
      stepL.classList.toggle('ok', !!c2.cal);
      if (c2.cal) { stepL.textContent = 'Calibrated'; infoL.textContent = `Centre ${c2.cx} / ${c2.cy}, X ${c2.minX}..${c2.maxX}, Y ${c2.minY}..${c2.maxY} (raw sensor counts).`; st.status = 'stored in the controller'; }
      else { stepL.textContent = 'Not calibrated'; infoL.textContent = 'The stick is centred at power-up and its range is learned as you play. Calibrate to store both.'; st.status = 'automatic (no stored calibration)'; }
    }
    const mean = q => q.reduce((a, b) => a + b, 0) / Math.max(1, q.length);
    const spread = q => q.length ? Math.max(...q) - Math.min(...q) : 0;
    function begin() { st.state = 1; st.trail = []; stepL.classList.remove('ok'); stepL.textContent = 'Step 1 of 2: centre'; infoL.textContent = 'Let go of the stick so it rests in the middle, then click Next.'; bNext.querySelector('span').textContent = 'Next'; refresh(); }
    function next() {
      if (st.state === 1) {
        if (st.hx.length < 8) { infoL.textContent = 'Not enough readings yet, wait a second and click Next again.'; return; }
        const wob = Math.max(spread(st.hx), spread(st.hy));
        if (wob > 120) { infoL.textContent = `The stick is still moving (${wob} counts of wobble). Let it rest and click Next again.`; return; }
        const cx = mean(st.hx), cy = mean(st.hy);
        w = { cx, cy, minX: cx, maxX: cx, minY: cy, maxY: cy };
        st.state = 2; st.trail = [];
        stepL.textContent = 'Step 2 of 2: full range';
        infoL.textContent = 'Roll the stick slowly around the edge 3 times, touching every corner. Click Finish when the trace shows the whole gate.';
        bNext.querySelector('span').textContent = 'Finish';
      } else if (st.state === 2) {
        const rx = Math.min(w.maxX - w.cx, w.cx - w.minX), ry = Math.min(w.maxY - w.cy, w.cy - w.minY);
        if (rx < 250 || ry < 250) { infoL.textContent = `Not enough movement: the stick has to reach the edge on all four sides (now ${rx | 0} / ${ry | 0} counts, need at least 250). Keep rolling it.`; return; }
        const k = 's' + (idx + 1);
        postCal({ [k + 'cal']: true, [k + 'cx']: Math.round(w.cx), [k + 'cy']: Math.round(w.cy), [k + 'minx']: w.minX | 0, [k + 'maxx']: w.maxX | 0, [k + 'miny']: w.minY | 0, [k + 'maxy']: w.maxY | 0 }, 'Saved to the controller. Restart the controller to use it.');
      }
    }
    function end(msg) { st.state = 0; st.trail = []; refresh(); if (msg) infoL.textContent = msg + ' ' + infoL.textContent; }
    async function postCal(body, msg) {
      try { const r = await dev.post('/api/setCalibration', body); m.loadCal(r); end(msg); sync(); }
      catch (e) { infoL.textContent = 'Couldn\'t save: ' + e.message; }
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
    // the gate, in the design's colors: dark field, grey ring, the stick as an orange dot
    st.paint = () => {
      if (isAbsent || page1.classList.contains('hidden')) return;
      const r = cv.getBoundingClientRect(), z = parseFloat(getComputedStyle(document.getElementById('stage')).zoom) || 1, dpr = (window.devicePixelRatio || 1) * z;
      const W = r.width / z, H = r.height / z;
      if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
      const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
      const cx = W / 2, cy = W / 2, R = W / 2 - 6;
      const round = idx === 0 ? m.circularity : true;
      // the gate's outline: an octagon with its corners at the 8 directions, or a circle
      const gate = () => { g.beginPath(); if (round) g.arc(cx, cy, R, 0, Math.PI * 2); else { for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; g[i ? 'lineTo' : 'moveTo'](cx + R * Math.cos(a), cy - R * Math.sin(a)); } g.closePath(); } };
      gate(); g.fillStyle = '#232323'; g.fill();
      g.lineWidth = 1; g.strokeStyle = '#353535';
      for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * R, cy - Math.sin(a) * R); g.stroke(); }
      gate(); g.lineWidth = 1.5; g.lineJoin = 'round'; g.strokeStyle = '#c5c5c5'; g.stroke();
      const din = (idx === 0 ? m.innerDeadzone : m.innerDeadzone2) / 100, dout = (idx === 0 ? m.outerDeadzone : m.outerDeadzone2) / 100;
      g.setLineDash([4, 3]); g.lineWidth = 1.2;
      if (din > 0.004) { g.strokeStyle = 'rgba(254,104,5,.8)'; g.beginPath(); g.arc(cx, cy, R * din, 0, Math.PI * 2); g.stroke(); }
      if (dout < 0.996) { g.strokeStyle = 'rgba(40,166,255,.8)'; g.beginPath(); g.arc(cx, cy, R * dout, 0, Math.PI * 2); g.stroke(); }
      g.setLineDash([]);
      st.trail.forEach(([x, y], i) => { g.fillStyle = `rgba(40,166,255,${(26 + 150 * i / Math.max(1, st.trail.length - 1)) / 255})`; g.fillRect(cx + x * R - 1, cy - y * R - 1, 2, 2); });
      // a round gate: the firmware limits the stick to the circle, so the dot stops at it too
      let px = st.outX, py = st.outY; const pm = Math.hypot(px, py); if (round && pm > 1) { px /= pm; py /= pm; }
      const ox = cx + px * R, oy = cy - py * R;
      g.beginPath(); g.arc(ox, oy, 6.5, 0, Math.PI * 2); g.fillStyle = '#fe6805'; g.fill(); g.lineWidth = 1.5; g.strokeStyle = '#2a2a2a'; g.stroke();
      const mag = Math.hypot(st.outX, st.outY); let ang = Math.atan2(st.outY, st.outX) * 180 / Math.PI; if (ang < 0) ang += 360;
      const f = v => (v > 0 ? '+' : '') + Math.round(v * 100);
      g.font = '600 9.5px Poppins'; g.fillStyle = '#cfcfcf'; g.textAlign = 'center';
      g.fillText(`X ${f(st.outX)}%   Y ${f(st.outY)}%   ${mag > 0.05 ? Math.round(ang) + '°' : 'centred'}`, cx, W + 12);
      if (st.status) { g.font = '8.5px Poppins'; g.fillStyle = '#8a8a8a'; g.fillText(st.status, cx, W + 25); }
    };
    return st;
  }

  // ---------------------------------------------------------------- SETTINGS page
  const socd = dselect(SOCD, i => { m.socdMode = i; markDirty('settings'); });
  const fourWay = dtoggle('4-way mode (no diagonals)', v => { m.fourWayMode = v; markDirty('settings'); });
  const debounce = dslider('Debounce delay', 0, 50, v => v === 0 ? 'off' : v + ' ms', v => { m.debounceDelay = v; markDirty('settings'); });
  const rumble = dtoggle('Rumble enabled', v => { m.rumbleEnabled = v; markDirty('cal'); });
  const turbo = dtoggle('Turbo enabled', v => { m.turboEnabled = v; markDirty('settings'); });
  const shots = dslider('Shot count (higher is faster)', 2, 30, null, v => { m.turboShotCount = v; markDirty('settings'); });
  const page2 = el('div.page.hidden.dpage.settings', {}, [
    panel('INPUT BEHAVIOR', [el('div.lbl', { text: 'SOCD cleaning mode' }), socd, el('div', { style: { height: '12px' } }), fourWay.el, el('div', { style: { height: '8px' } }), debounce.el]),
    panel('TURBO', [turbo.el, el('div', { style: { height: '8px' } }), shots.el, el('p.hint', { text: 'Give a button the Turbo function on the Controller page to use it.' })]),
  ]);
  // the PadBox M's rumble motor (the GS has none)   // @M
  if (L.m) page2.append(panel('RUMBLE', [rumble.el, el('p.hint', { text: 'Turns the vibration motor off completely.' })]));   // @M
  function syncSettings() {
    socd.value = String(clamp(m.socdMode, 0, 4)); fourWay.checked = m.fourWayMode; debounce.value = m.debounceDelay;
    turbo.checked = m.turboEnabled; shots.value = m.turboShotCount; rumble.checked = m.rumbleEnabled;
  }

  // @M{
  // ---------------------------------------------------------------- TRIGGER page (the PadBox M): released and fully pulled,
  // stored in the controller (/api/setCalibration tcal / tidle / tpressed), as in the desktop Suite and the previous app
  const tr = { state: 0, hist: [], wIdle: 0, wExt: 0 };
  const tFill = el('i'), tPct = el('span.tpct', { text: '0%' }), tRaw = el('p.hint');
  const tStep = el('div.step'), tInfo = el('div.info');
  const tCal = pbtn('Calibrate', '', true, () => trBegin()), tNext = pbtn('Next', '', true, () => trNextStep());
  const tCancel = pbtn('Cancel', '', false, () => trEnd('Calibration cancelled.'));
  const tReset = pbtn('Reset', '', false, () => trPost({ tcal: false }, 'Calibration removed: the released position is measured at power-up again.'));
  const pageTrig = el('div.page.hidden.dpage.mtrig', {}, [
    panel('TRIGGER CALIBRATION', [
      el('p.text', { text: 'Stores the trigger\'s two ends in the controller: released = 0%, pulled all the way = 100%.' }),
      el('div.tbar-row', {}, [el('div.tbar', {}, [tFill]), tPct]), tRaw,
      tStep, tInfo, el('div.btnrow', {}, [tCal, tNext, tCancel, tReset]),
    ]),
  ]);
  const spread = q => q.length ? Math.max(...q) - Math.min(...q) : 0, meanOf = q => q.reduce((a, b) => a + b, 0) / Math.max(1, q.length);
  function trRefresh(msg, color) {
    for (const [b, show] of [[tCal, tr.state === 0], [tReset, tr.state === 0 && m.tcal], [tNext, tr.state !== 0], [tCancel, tr.state !== 0]]) b.classList.toggle('hidden', !show);
    tInfo.style.color = color || '';
    if (tr.state !== 0) return;
    tStep.classList.toggle('ok', !!m.tcal);
    tStep.textContent = m.tcal ? 'Calibrated' : 'Not calibrated';
    tInfo.textContent = msg || (m.tcal ? 'Released = ' + m.tidle + ', fully pulled = ' + m.tpressed + ' (raw sensor counts, 0 to 4095).'
      : 'The released position is read at power-up (don\'t touch the trigger while plugging in) and the full pull is learned as you play. Calibrate to store both.');
  }
  function trBegin() { tr.state = 1; tr.hist = []; tStep.classList.remove('ok'); tStep.textContent = 'Step 1 of 2: released'; tNext.querySelector('span').textContent = 'Next'; trRefresh(); tInfo.textContent = 'Let go of the trigger, then click Next.'; }
  function trNextStep() {
    if (tr.state === 1) {
      if (tr.hist.length < 8) { tInfo.textContent = 'Not enough readings yet: wait a second and click Next again.'; return; }
      if (spread(tr.hist) > 120) { tInfo.textContent = 'The trigger is still moving (' + spread(tr.hist) + ' counts). Let go of it and click Next again.'; return; }
      tr.wIdle = tr.wExt = meanOf(tr.hist); tr.state = 2;
      tStep.textContent = 'Step 2 of 2: fully pulled'; tInfo.textContent = 'Pull the trigger all the way and hold it there for a moment, then click Finish.';
      tNext.querySelector('span').textContent = 'Finish';
    } else if (tr.state === 2) {
      const moved = Math.abs(tr.wExt - tr.wIdle);
      if (moved < 200) { tInfo.textContent = 'The trigger only moved ' + (moved | 0) + ' counts; at least 200 are needed. Pull it all the way and try again.'; return; }
      trPost({ tcal: true, tidle: Math.round(tr.wIdle), tpressed: Math.round(tr.wExt) }, 'Saved to the controller. Click Restart as controller to use it.');
    }
  }
  function trEnd(msg, color) { tr.state = 0; trRefresh(msg, color); }
  async function trPost(body, msg) {
    try { m.loadCal(await dev.post('/api/setCalibration', body)); trEnd(msg, 'var(--good)'); }
    catch (e) { tInfo.textContent = 'Couldn\'t save: ' + e.message; tInfo.style.color = 'var(--bad)'; }
  }
  // each live reading (adc[4]): the bar shows the trigger as the firmware sees it (trigLevel), the calibration collects
  function trFeed(v) {
    if (v == null || v < 0) { tRaw.textContent = 'No analog trigger reading.'; return; }
    tr.hist.push(v); if (tr.hist.length > 30) tr.hist.shift();
    const inv = m.tinvert !== 0;
    if (tr.state === 2 && (inv ? v < tr.wExt : v > tr.wExt)) tr.wExt = v;
    let lv = trigLevel(v) || 0;
    if (tr.state === 2) { const span = inv ? tr.wIdle - tr.wExt : tr.wExt - tr.wIdle, travel = inv ? tr.wIdle - v : v - tr.wIdle; lv = span > 1 ? clamp(travel / span, 0, 1) : 0; }
    tFill.style.width = (lv * 100) + '%'; tPct.textContent = Math.round(lv * 100) + '%';
    tRaw.textContent = 'raw ' + v + (tr.state === 2 ? '   released ' + (tr.wIdle | 0) + '   pulled so far ' + (tr.wExt | 0) : m.tcal ? '   stored calibration' : '   automatic');
  }
  // @M}

  // ---------------------------------------------------------------- BACKUP page
  const bStatus = el('p.hint.wrap');
  const page3 = el('div.page.hidden.dpage.backup', {}, [
    panel('BACKUP', [
      el('p.text', { text: 'Save all the controller\'s settings (buttons, LEDs, calibration and settings) to a file, or load them back. Importing replaces everything on the controller.' }),
      el('div.btnrow', {}, [
        pbtn('Export to file', 'upload', true, async () => { try { bStatus.textContent = 'Exporting...'; const cfg = await dev.get('/api/getConfig'); download('padbox-backup.json', JSON.stringify(cfg, null, 1)); bStatus.textContent = 'Saved.'; } catch (e) { bStatus.textContent = 'Export failed: ' + e.message; } }),
        pbtn('Import from file', 'download', false, async () => {
          const text = await openFile('.json,application/json'); if (!text) return;
          if (!await confirmBox('Import backup', 'This overwrites every setting currently on the controller with the ones in this file. Continue?', 'IMPORT')) return;
          try { bStatus.textContent = 'Importing...'; await dev.post('/api/setConfig', JSON.parse(text)); bStatus.textContent = 'Imported. Click Restart as controller to apply everything.'; } catch (e) { bStatus.textContent = 'Import failed: ' + e.message; }
        }),
      ]), bStatus,
    ]),
  ]);

  // ---------------------------------------------------------------- the side menu
  const tabNames = ['CONTROLLER', 'STICKS', 'SETTINGS', 'BACKUP'], pages = [page0, page1, page2, page3];
  if (L.m) { tabNames.splice(2, 0, 'TRIGGER'); pages.splice(2, 0, pageTrig); }   // the PadBox M's analog trigger   // @M
  shell.content(el('div', { style: { position: 'absolute', inset: 0 } }, pages));
  shell.tabs(tabNames, i => pages.forEach((p, k) => p.classList.toggle('hidden', k !== i)));
  refreshSide(); syncSettings(); sticks.forEach(s => s.sync && s.sync());
  if (L.m) trRefresh();   // @M
  say('Changes are sent to the PadBox when you click Save.');

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
        if (L.m) trFeed(adc[4]);   // @M
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
