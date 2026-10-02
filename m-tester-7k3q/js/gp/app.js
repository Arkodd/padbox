// The GP2040-CE PadBox Calibrator, in the browser - the desktop PadBox Configurator's pages: CONTROLLER (the
// drawing, the button editor and the LED effect), STICKS (calibration, deadzones), SETTINGS and BACKUP.
// Edits are staged locally; SAVE sends them all, like the desktop app.

import { el, icon, button, card, toggle, slider, combo, setItems, swatchRow, pickColor, hex, readable, image, clamp, sleep, download, openFile, confirmBox, setButtonText } from '../ui.js';
import { Model, ACTS, act } from './model.js';
import { firmwareUpdate } from '../update.js';

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

  shell.header('GP2040-CE PadBox Calibrator', ['GP2040-CE', m.version, 'PadBox ' + L.name].filter(Boolean).join('  •  '));
  shell.status(true);

  // ---------------------------------------------------------------- header buttons
  const btnUpdate = button('UPDATE FIRMWARE', { onclick: () => firmwareUpdate({ board: L.board, current: 'GP2040-CE', enter: noDrive => reboot(noDrive ? 3 : 2, true) }) });
  const btnSave = button('SAVE', { primary: true, disabled: true, onclick: () => flush() });
  const btnPreview = button('RESTART TO PREVIEW LEDS', { onclick: () => reboot(1) });
  const btnExit = button('RESTART AS CONTROLLER', { primary: true, onclick: () => reboot(0) });
  shell.actions([btnUpdate, btnSave, btnPreview, btnExit]);

  function markDirty(k) {
    dirty[k] = true; btnSave.disabled = false;
    say('Unsaved changes - click SAVE to send them to the controller.', 'var(--warn)');
  }
  function say(text, color) {
    status.textContent = text; status.style.color = color || 'var(--muted)';
    shell.footer(text); document.getElementById('footer').style.color = color || '';   // also in the bottom bar: easy to miss on a phone otherwise
  }

  // ---------------------------------------------------------------- CONTROLLER page
  const topProfile = combo(['Profile 1', 'Profile 2', 'Profile 3', 'Profile 4'], i => { m.profileNumber = i + 1; m.editProfile = i + 1; markDirty('settings'); refreshSide(); }, 200);
  const profileBar = el('div.row', { style: { padding: '14px 18px 10px' } }, [
    el('span.hint', { text: 'Profile' }), topProfile,
    el('span', { html: icon('info'), style: { color: 'var(--orange)', display: 'inline-flex', width: '22px', marginLeft: '12px' } }),
    el('span.hint', { text: 'On the controller: hold Home + Touchpad and press 1P / 2P / 3P / 4P' }),
  ]);
  const canvas = el('canvas', { style: { width: '100%', height: '100%', display: 'block' } });
  const drawWrap = el('div.frame', { style: { position: 'absolute', left: '16px', right: '16px', top: '0', bottom: '44px' } }, [canvas]);
  // the analog trigger: a bar along the bottom (boards without one just get the hint)
  // @M{
  const drawBarFill = el('i', { style: { width: '0%' } }), drawBarText = el('span');
  const drawHint = !L.m ? el('div.hint', { text: 'Click a button, or press it on the controller, to edit it.', style: { position: 'absolute', left: '30px', bottom: '14px' } })
    : el('div', { style: { position: 'absolute', left: '30px', right: '30px', bottom: '8px' } }, [
      el('div.hint', {}, [drawBarText]), el('div.bar-meter', { style: { height: '12px', borderRadius: '6px', marginTop: '3px' } }, [drawBarFill])]);
  // @M}
  // @GS const drawHint = el('div.hint', { text: 'Click a button, or press it on the controller, to edit it.', style: { position: 'absolute', left: '30px', bottom: '14px' } });
  const drawArea = el('div', { style: { position: 'relative', flex: '1', minHeight: '0' } }, [drawWrap, drawHint]);
  const left = el('div', { style: { display: 'flex', flexDirection: 'column', flex: '1', minWidth: '0' } }, [profileBar, drawArea]);

  // side panel: the selected button, then the LED effect
  let selPin = -1;
  const selTitle = el('span', { text: 'Select a button' });
  const selHint = el('p.hint', { style: { margin: '0 0 6px' } });
  const actCombo = combo(ACTS.map(a => ({ value: a.value, text: a.long })), () => { if (selPin >= 0) setAction(selPin, +actCombo.value); });
  actCombo.style.width = '100%';
  const ledHead = el('span', { text: 'LED' });
  const swU = el('button.colorbtn', { type: 'button', on: { click: () => pickLed(false) } });
  const swD = el('button.colorbtn', { type: 'button', on: { click: () => pickLed(true) } });
  const ledRow = el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' } }, [
    el('div', {}, [el('div.caption', { text: 'Color', style: { marginTop: 0 } }), swU]),
    el('div', {}, [el('div.caption', { text: 'Color when pressed', style: { marginTop: 0 } }), swD])]);
  const btnResetOne = button('RESET THIS BUTTON', { cls: 'wide', onclick: () => { if (selPin in L.defaults) setAction(selPin, L.defaults[selPin]); } });
  const btnResetAll = button('RESET ALL BUTTONS', { cls: 'wide', onclick: () => { for (const k in L.defaults) m.action[k] = L.defaults[k]; markDirty('pins'); markDirty('led'); refreshSide(); } });
  const status = el('p.note');
  const selCard = el('div.card', {}, [
    el('h2', {}, [el('span', { html: icon('cursor') }), selTitle]), selHint,
    el('div.caption', { text: 'Acts as' }), actCombo,
    el('h2', { style: { fontSize: '15px', margin: '16px 0 6px' } }, [el('span', { html: icon('sun') }), ledHead]), ledRow,
    el('div', { style: { display: 'grid', gap: '8px', marginTop: '14px' } }, [btnResetOne, btnResetAll]), status,
  ]);
  selCard.querySelectorAll('h2 > span:first-child').forEach(s => s.style.display = 'inline-flex');
  const effect = combo(EFFECTS, i => { m.mode = i; markDirty('led'); });
  effect.style.width = '100%';
  const bright = slider('Brightness', 0, 5, v => v + ' / ' + m.steps, v => { m.brightness = v; markDirty('led'); });
  const ledCard = card('LED effect', 'bulb', [
    el('div.caption', { text: 'EFFECT' }), effect,
    el('p.note', { text: 'The per-button colors show with Custom theme.' }),
    el('div.caption', { text: 'LED COLOR FOR ALL BUTTONS', style: { marginTop: '14px' } }),
    swatchRow(PRESETS, c => setAllLeds(c), c => setAllLeds(c)), el('div', { style: { height: '8px' } }), bright.el,
  ]);
  const side = el('div', { style: { width: '340px', flex: 'none', padding: '10px 14px 14px 0', display: 'flex', flexDirection: 'column', gap: '12px', overflow: 'auto' } }, [selCard, ledCard]);
  const page0 = el('div.page', { style: { display: 'flex' } }, [left, side]);

  function refreshSide() {
    topProfile.selectedIndex = clamp(m.editProfile - 1, 0, 3);
    bright.max = Math.max(1, m.steps); bright.value = clamp(m.brightness, 0, m.steps);
    effect.selectedIndex = clamp(m.mode, 0, 4);
    const none = selPin < 0;
    actCombo.disabled = none;
    if (none) {
      selTitle.textContent = 'Select a button'; selHint.textContent = 'Click a button on the drawing, or press it on the controller.';
      actCombo.value = ''; ledRow.classList.add('hidden'); ledHead.textContent = 'LED';
    } else {
      const ph = m.phys(selPin);
      selTitle.textContent = m.nameOfPin(selPin); selHint.textContent = 'GPIO ' + selPin;
      actCombo.value = String(m.actionOf(selPin));
      if (ph && ph.fixed) { actCombo.value = ''; actCombo.disabled = true; selHint.textContent = 'GPIO ' + selPin + '  -  set in the firmware, can\'t be remapped here.'; }
      const slot = m.ledSlot(ph), led = slot >= 0;
      ledRow.classList.toggle('hidden', !led);
      if (ph && ph.led >= 0 && !led) ledHead.textContent = 'LED off (this button does nothing)';
      else if (led && slot !== ph.led) ledHead.textContent = 'LED (shared with ' + nameOfLed(slot) + ', same function)';
      else ledHead.textContent = led ? 'LED under this button' : 'LED';
      if (led) {
        for (const [b, c] of [[swU, m.ledU[slot]], [swD, m.ledD[slot]]]) { b.style.background = hex(c); b.style.color = readable(c); b.textContent = hex(c).toUpperCase(); }
      }
    }
    btnResetOne.disabled = none || !(selPin in L.defaults);
  }
  const nameOfLed = led => { const o = L.phys.find(p => p.led === led); return o ? o.name : 'LED ' + led; };
  function pickLed(pressedColor) {
    const slot = m.ledSlot(m.phys(selPin));
    if (slot < 0) return;
    pickColor(pressedColor ? m.ledD[slot] : m.ledU[slot], c => { if (pressedColor) m.ledD[slot] = c; else m.ledU[slot] = c; markDirty('led'); refreshSide(); });
  }
  function setAction(pin, a) { if (m.actionOf(pin) === a) return; m.action[pin] = a; markDirty('pins'); markDirty('led'); refreshSide(); }
  function setAllLeds(c) { for (let i = 0; i < m.ledU.length; i++) m.ledU[i] = c; markDirty('led'); refreshSide(); }
  function select(pin) { selPin = pin; refreshSide(); }

  // ---------------------------------------------------------------- the drawing
  const art = await image(L.image);
  const glow = new Float32Array(64);
  let lastT = performance.now(), fade = 1;
  const shownAt = performance.now();   // the drawing fades in over half a second
  const G = { scale: 1, offX: 0, offY: 0, w: 0, h: 0 };
  function layout2() {
    const r = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    G.w = r.width; G.h = r.height;
    const pad = 12;
    G.scale = Math.min((r.width - 2 * pad) / L.w, (r.height - 2 * pad) / L.h);
    G.offX = (r.width - L.w * G.scale) / 2; G.offY = (r.height - L.h * G.scale) / 2;
    return dpr;
  }
  const ax = x => G.offX + x * G.scale, ay = y => G.offY + y * G.scale;
  function armRect(sp, inset) {
    const mid = (sp.a0 + 45) * Math.PI / 180, dx = Math.round(Math.cos(mid)), dy = Math.round(Math.sin(mid));
    const near = sp.plusHalf + inset, far = sp.rx - inset, half = sp.plusHalf - inset;
    if (dx !== 0) { const x0 = sp.x + dx * near, x1 = sp.x + dx * far; return [Math.min(x0, x1), sp.y - half, Math.abs(x1 - x0), 2 * half]; }
    const y0 = sp.y + dy * near, y1 = sp.y + dy * far; return [sp.x - half, Math.min(y0, y1), 2 * half, Math.abs(y1 - y0)];
  }
  function hit(sp, mx, my) {
    const qx = (mx - G.offX) / G.scale, qy = (my - G.offY) / G.scale;
    if (sp.kind === 2) {
      let inside = false; const p = sp.poly;
      for (let i = 0, j = p.length - 1; i < p.length; j = i++)
        if (((p[i][1] > qy) !== (p[j][1] > qy)) && (qx < (p[j][0] - p[i][0]) * (qy - p[i][1]) / (p[j][1] - p[i][1]) + p[i][0])) inside = !inside;
      return inside;
    }
    if (sp.kind === 1) { const [x, y, w, h] = armRect(sp, 0); return qx >= x && qx <= x + w && qy >= y && qy <= y + h; }
    const dx = (qx - sp.x) / sp.rx, dy = (qy - sp.y) / sp.ry; return dx * dx + dy * dy <= 1;
  }
  canvas.addEventListener('mousedown', e => {
    const r = canvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    for (const st of L.sticks) { const cx = ax(st.x), cy = ay(st.y), R = st.r * G.scale; if (st.clickPin >= 0 && (mx - cx) ** 2 + (my - cy) ** 2 <= R * R * 1.2) return select(st.clickPin); }
    for (const sp of L.spots) if (hit(sp, mx, my)) return select(sp.pin);
  });
  canvas.addEventListener('mousemove', e => {
    const r = canvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    const sp = L.spots.find(s => hit(s, mx, my));
    canvas.style.cursor = sp ? 'pointer' : 'default';
    const fx = sp && (m.phys(sp.pin) || {}).fixed;
    canvas.title = sp ? sp.name + ' (GPIO ' + sp.pin + ')  ->  ' + (fx ? 'fixed in the firmware' : (act(m.actionOf(sp.pin)) || {}).long || '?') : '';
  });
  const isPressed = pin => pin >= 0 && ((pressed >> BigInt(pin)) & 1n) === 1n;
  const orange = a => `rgba(255,104,0,${a})`;
  function mix(c, a) { const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255, br = 13, bg = 18, bb = 25; return `rgb(${Math.round(br + (r - br) * a)},${Math.round(bg + (g - bg) * a)},${Math.round(bb + (b - bb) * a)})`; }
  function stickOut(i) {
    const st = sticks[i];
    return st ? [st.outX, st.outY] : [0, 0];
  }
  function drawFrame(now) {
    if (!alive) return;
    requestAnimationFrame(drawFrame);
    paint(now);
  }
  // also on a timer when the page doesn't get animation frames (a background tab, a headless capture)
  const tick = setInterval(() => { if (!alive) return clearInterval(tick); if (performance.now() - lastT > 120) paint(performance.now()); }, 150);
  function paint(now) {
    if (!page0.isConnected || page0.classList.contains('hidden')) return;
    now = performance.now();   // one clock for the animation frames and the timer
    const dt = Math.max(0, Math.min(0.1, (now - lastT) / 1000)); lastT = now;
    for (let p = 0; p < glow.length; p++) { const t = isPressed(p) ? 1 : 0, v = glow[p]; glow[p] = v < t ? Math.min(t, v + dt * 16) : Math.max(t, v - dt * 4.5); }
    fade = Math.max(0, 1 - (now - shownAt) / 500);
    const dpr = layout2(), g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, G.w, G.h);
    g.drawImage(art, G.offX, G.offY, L.w * G.scale, L.h * G.scale);
    const artScale = G.scale * L.w / 2040;
    const big = `600 ${Math.max(10.5, 20 * artScale * 2)}px Poppins`, small = '600 10px Poppins';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const sp of L.spots) {
      const cx = ax(sp.x), cy = ay(sp.y), rx = sp.rx * G.scale, ry = sp.ry * G.scale, a = glow[sp.pin] || 0;
      const ph = m.phys(sp.pin);
      if (sp.kind === 2) {
        const path = new Path2D(); sp.poly.forEach(([x, y], i) => i ? path.lineTo(ax(x), ay(y)) : path.moveTo(ax(x), ay(y))); path.closePath();
        if (a > 0.01) { g.fillStyle = orange(0.92 * a); g.fill(path); }
        label(g, sp, cx, cy, rx, ry, a, small, big);
        continue;
      }
      if (sp.kind === 1) {
        if (a > 0.01) { const [x, y, w, h] = armRect(sp, 4); g.fillStyle = orange(0.92 * a); roundRect(g, ax(x), ay(y), w * G.scale, h * G.scale, 6 * artScale); g.fill(); }
        label(g, sp, cx, cy, rx, ry, a, small, big);
        continue;
      }
      const slot = m.ledSlot(ph);
      g.beginPath(); g.ellipse(cx, cy, rx + 1.5, ry + 1.5, 0, 0, Math.PI * 2);
      if (slot >= 0) { g.fillStyle = mix(m.ledU[slot], 120 / 255); g.fill(); g.lineWidth = 2.5; g.strokeStyle = mix(m.ledU[slot], 230 / 255); g.stroke(); }
      else { g.lineWidth = 1.5; g.strokeStyle = '#464646'; g.stroke(); }
      if (a > 0.01) {
        for (let k = 3; k >= 1; k--) { g.beginPath(); g.ellipse(cx, cy, rx + 8 * k * artScale, ry + 8 * k * artScale, 0, 0, Math.PI * 2); g.fillStyle = orange(0.12 * a); g.fill(); }
        g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); g.fillStyle = orange(0.92 * a); g.fill();
      }
      label(g, sp, cx, cy, rx, ry, a, small, big);
    }
    L.sticks.forEach((st, i) => {
      const cx = ax(st.x), cy = ay(st.y), R = st.r * G.scale, ca = glow[st.clickPin] || 0;
      if (ca > 0.01) { g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fillStyle = orange(0.47 * ca); g.fill(); }
      g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.lineWidth = 1.5; g.strokeStyle = '#6e6e6e'; g.stroke();
      const cn = st.clickPin >= 0 ? act(m.actionOf(st.clickPin)) : null;
      if (cn && cn.value !== -10) { g.fillStyle = '#969696'; g.font = small; g.fillText('click: ' + cn.short, cx, cy + R + 10); }
      let [nx, ny] = stickOut(i); const mg = Math.hypot(nx, ny); if (mg > 1) { nx /= mg; ny /= mg; }
      const dotR = R * 0.3, travel = R - dotR - 2, px = cx + nx * travel, py = cy - ny * travel, moved = mg > 0.08;
      g.beginPath(); g.arc(px, py, dotR, 0, Math.PI * 2); g.fillStyle = moved ? '#ff6800' : '#787878'; g.fill();
    });
    if (selPin >= 0) {
      const br = 0.5 + 0.5 * Math.sin(now / 1000 * 3), ra = (190 + 65 * br) / 255;
      g.lineJoin = 'round';
      for (const sp of L.spots) {
        if (sp.pin !== selPin) continue;
        const cx = ax(sp.x), cy = ay(sp.y), rx = sp.rx * G.scale + 6, ry = sp.ry * G.scale + 6;
        let path = new Path2D();
        if (sp.kind === 2) { sp.poly.forEach(([x, y], i) => i ? path.lineTo(ax(x), ay(y)) : path.moveTo(ax(x), ay(y))); path.closePath(); }
        else if (sp.kind === 1) { const [x, y, w, h] = armRect(sp, 4); g.beginPath(); roundRect(g, ax(x), ay(y), w * G.scale, h * G.scale, 6 * artScale); g.fillStyle = 'rgba(255,255,255,.22)'; g.fill(); g.lineWidth = 2; g.strokeStyle = `rgba(255,255,255,${ra})`; g.stroke(); continue; }
        else path.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        g.lineWidth = 7; g.strokeStyle = `rgba(255,255,255,${(24 + 34 * br) / 255})`; g.stroke(path);
        g.lineWidth = 2.6; g.strokeStyle = `rgba(255,255,255,${ra})`; g.stroke(path);
      }
      for (const st of L.sticks) if (st.clickPin === selPin) {
        const p = new Path2D(); p.arc(ax(st.x), ay(st.y), st.r * G.scale + 6, 0, Math.PI * 2);
        g.lineWidth = 7; g.strokeStyle = `rgba(255,255,255,${(24 + 34 * br) / 255})`; g.stroke(p);
        g.lineWidth = 2.6; g.strokeStyle = `rgba(255,255,255,${ra})`; g.stroke(p);
      }
    }
    if (fade > 0.002) { g.fillStyle = `rgba(14,20,28,${fade})`; g.fillRect(0, 0, G.w, G.h); }
  }
  function label(g, sp, cx, cy, rx, ry, a, small, big) {
    const fixed = (m.phys(sp.pin) || {}).fixed;
    const x = fixed ? { short: fixed, value: 0 } : act(m.actionOf(sp.pin));   // fixed buttons show their firmware label
    if (!x || x.value === -10) return;
    let dim = '#969696';
    if (sp.kind === 0 && m.ledSlot(m.phys(sp.pin)) >= 0) dim = '#ffffff';
    const lit = a > 0.5 ? '#000000' : dim;
    if (sp.kind === 1) { const [x0, y0, w, h] = armRect(sp, 0); g.font = small; g.fillStyle = lit; g.fillText(x.short, ax(x0 + w / 2), ay(y0 + h / 2)); }
    else if (sp.label) { g.font = big; g.fillStyle = lit; g.fillText(x.short, cx, cy); }
    else if (sp.name === 'Bumper') { g.font = small; g.fillStyle = lit; g.fillText(x.short, cx, cy); }
    else { g.font = small; g.fillStyle = a > 0.5 ? '#ff6800' : dim; g.fillText(x.short, cx, sp.labelOnTop ? cy - ry - 9 : cy + (sp.ry + 13) * G.scale + 7); }   // round menu buttons: under the outline
  }
  function roundRect(g, x, y, w, h, r) { g.beginPath(); g.roundRect(x, y, w, h, r); }
  requestAnimationFrame(drawFrame);

  // ---------------------------------------------------------------- STICKS page
  const sticks = [makeStick(0, 'Left stick'), makeStick(1, L.noRightStick ? 'Right stick' : 'Right stick')];
  const page1 = el('div.page.hidden', { style: { padding: '16px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', alignContent: 'start' } }, sticks.map(s => s.card));
  function makeStick(idx, title) {
    const cv = el('canvas', { style: { width: '100%', height: '250px', display: 'block' } });
    const en = toggle('Stick enabled', v => { if (idx === 0) m.stick1Enabled = v; else m.stick2Enabled = v; markDirty('cal'); });
    const head = el('div.row', {}, [el('h2', { text: title, style: { margin: 0, fontSize: '16px', flex: 1 } }), en.el]);
    const stepL = el('div', { style: { color: 'var(--orange)', fontWeight: 600, marginTop: '6px' } });
    const infoL = el('div', { style: { color: 'var(--soft)', fontSize: '12.5px', whiteSpace: 'pre-line', minHeight: '38px' } });
    const bCal = button('CALIBRATE', { primary: true, onclick: () => begin() });
    const bNext = button('NEXT', { primary: true, icon: '', onclick: () => next() });
    const bCancel = button('CANCEL', { icon: '', onclick: () => end('Calibration cancelled.') });
    const bReset = button('RESET', { onclick: () => postCal({ ['s' + (idx + 1) + 'cal']: false }, 'Calibration removed. The stick is centred automatically at power-up again.') });
    const fx = toggle('Flip X axis', () => flip()), fy = toggle('Flip Y axis', () => flip());
    const inner = slider('Inner deadzone', 0, 100, v => v + '%', v => { if (idx === 0) m.innerDeadzone = v; else m.innerDeadzone2 = v; markDirty('settings'); });
    const outer = slider('Outer deadzone', 0, 100, v => v + '%', v => { if (idx === 0) m.outerDeadzone = v; else m.outerDeadzone2 = v; markDirty('settings'); });
    const circ = toggle('Round gate (limit the stick to a circle)', v => { if (idx === 0) m.circularity = v; else m.circularity2 = v; markDirty('settings'); });
    const buttons = el('div.row', { style: { margin: '10px 0' } }, [bCal, bNext, bCancel, bReset, el('div.grow'), fx.el, fy.el]);
    const absent = el('div.hint', { text: 'No analog stick on this output.', style: { padding: '80px 0', textAlign: 'center' } });
    const body = el('div', {}, [cv, stepL, infoL, buttons, inner.el, outer.el, circ.el]);
    const c = el('div.card', {}, [head, body, absent]);
    const st = { card: c, outX: 0, outY: 0, state: 0, hx: [], hy: [], seen: 0, trail: [], present: true };
    let prov = null, w = null;
    const isAbsent = idx === 1 && L.noRightStick;
    body.classList.toggle('hidden', isAbsent); absent.classList.toggle('hidden', !isAbsent); en.el.classList.toggle('hidden', isAbsent);

    // (a control only reports changes the user makes, so setting them below never triggers these)
    function flip() { m.stick[idx].inv = (fx.checked ? 1 : 0) | (fy.checked ? 2 : 0); markDirty('cal'); }
    st.sync = () => {
      const c2 = m.stick[idx];
      fx.checked = (c2.inv & 1) !== 0; fy.checked = (c2.inv & 2) !== 0;
      en.checked = idx === 0 ? m.stick1Enabled : m.stick2Enabled;
      inner.value = clamp(idx === 0 ? m.innerDeadzone : m.innerDeadzone2, 0, 100);
      outer.value = clamp(idx === 0 ? m.outerDeadzone : m.outerDeadzone2, 0, 100);
      circ.checked = idx === 0 ? m.circularity : m.circularity2;
      refresh();
    };
    const sync = st.sync;
    function refresh() {
      bCal.classList.toggle('hidden', st.state !== 0); bReset.classList.toggle('hidden', st.state !== 0);
      bNext.classList.toggle('hidden', st.state === 0); bCancel.classList.toggle('hidden', st.state === 0);
      if (st.state !== 0) return;
      const c2 = m.stick[idx];
      if (c2.cal) { stepL.textContent = 'Calibrated'; infoL.textContent = `centre ${c2.cx} / ${c2.cy}    X ${c2.minX} .. ${c2.maxX}    Y ${c2.minY} .. ${c2.maxY}   (raw sensor counts)`; st.status = ['stored in the controller', 'var(--good)']; }
      else { stepL.textContent = 'Not calibrated'; infoL.textContent = 'The stick is centred at power-up and its range is learned as you play. Calibrate to store both.'; st.status = ['automatic (no stored calibration)', 'var(--warn)']; }
    }
    const mean = q => q.reduce((a, b) => a + b, 0) / Math.max(1, q.length);
    const spread = q => q.length ? Math.max(...q) - Math.min(...q) : 0;
    function begin() { st.state = 1; st.trail = []; stepL.textContent = 'Step 1 of 2: centre'; infoL.textContent = 'Let go of the stick so it rests in the middle, then click NEXT.'; setButtonText(bNext, 'NEXT', ''); refresh(); }
    function next() {
      if (st.state === 1) {
        if (st.hx.length < 8) { infoL.textContent = 'Not enough readings yet, wait a second and click NEXT again.'; return; }
        const wob = Math.max(spread(st.hx), spread(st.hy));
        if (wob > 120) { infoL.textContent = `The stick is still moving (${wob} counts of wobble). Let it rest and click NEXT again.`; return; }
        const cx = mean(st.hx), cy = mean(st.hy);
        w = { cx, cy, minX: cx, maxX: cx, minY: cy, maxY: cy };
        st.state = 2; st.trail = [];
        stepL.textContent = 'Step 2 of 2: full range';
        infoL.textContent = 'Roll the stick slowly around the edge 3 times, touching every corner. Click FINISH when the blue trace shows the whole gate.';
        setButtonText(bNext, 'FINISH', '');
      } else if (st.state === 2) {
        const rx = Math.min(w.maxX - w.cx, w.cx - w.minX), ry = Math.min(w.maxY - w.cy, w.cy - w.minY);
        if (rx < 250 || ry < 250) { infoL.textContent = `Not enough movement: the stick has to reach the edge on all four sides (now ${rx | 0} / ${ry | 0} counts, need at least 250). Keep rolling it.`; return; }
        const k = 's' + (idx + 1);
        postCal({ [k + 'cal']: true, [k + 'cx']: Math.round(w.cx), [k + 'cy']: Math.round(w.cy), [k + 'minx']: w.minX | 0, [k + 'maxx']: w.maxX | 0, [k + 'miny']: w.minY | 0, [k + 'maxy']: w.maxY | 0 }, 'Saved to the controller. Restart the controller to use it.');
      }
    }
    function end(msg) { st.state = 0; st.trail = []; refresh(); if (msg) infoL.textContent = msg + '\n' + infoL.textContent; }
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
      if (st.state === 1) st.status = ['resting: ' + Math.max(spread(st.hx), spread(st.hy)) + ' counts of wobble', 'var(--warn)'];
      if (st.state === 2) { const rx = Math.min(w.maxX - w.cx, w.cx - w.minX), ry = Math.min(w.maxY - w.cy, w.cy - w.minY); st.status = [`reach so far: X ${rx | 0}  Y ${ry | 0} counts`, rx >= 250 && ry >= 250 ? 'var(--good)' : 'var(--warn)']; }
    };
    st.paint = () => {
      if (isAbsent || page1.classList.contains('hidden')) return;
      const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
      if (cv.width !== Math.round(r.width * dpr)) { cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr); }
      const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, r.width, r.height);
      const cx = r.width / 2, cy = r.height / 2 - 12, R = Math.min(r.width, r.height - 40) * 0.44;
      const grd = g.createRadialGradient(cx, cy, 0, cx, cy, R * 1.18); grd.addColorStop(0, `rgba(255,110,30,${st.state ? 0.24 : 0.13})`); grd.addColorStop(1, 'rgba(255,110,30,0)');
      g.fillStyle = grd; g.fillRect(cx - R * 1.2, cy - R * 1.2, R * 2.4, R * 2.4);
      g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fillStyle = 'rgba(8,8,9,.47)'; g.fill();
      g.lineWidth = 1; g.strokeStyle = '#222228';
      for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * R, cy - Math.sin(a) * R); g.stroke(); }
      g.lineWidth = 1.5; g.strokeStyle = '#64646c'; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();
      const din = (idx === 0 ? m.innerDeadzone : m.innerDeadzone2) / 100, dout = (idx === 0 ? m.outerDeadzone : m.outerDeadzone2) / 100;
      g.setLineDash([5, 4]);
      if (din > 0.004) { g.strokeStyle = 'rgba(255,100,100,.67)'; g.beginPath(); g.arc(cx, cy, R * din, 0, Math.PI * 2); g.stroke(); }
      if (dout < 0.996) { g.strokeStyle = 'rgba(100,170,255,.67)'; g.beginPath(); g.arc(cx, cy, R * dout, 0, Math.PI * 2); g.stroke(); }
      g.setLineDash([]);
      st.trail.forEach(([x, y], i) => { g.fillStyle = `rgba(80,140,255,${(26 + 120 * i / Math.max(1, st.trail.length - 1)) / 255})`; g.fillRect(cx + x * R - 1.5, cy - y * R - 1.5, 3, 3); });
      const ox = cx + st.outX * R, oy = cy - st.outY * R;
      g.beginPath(); g.arc(ox, oy, 6, 0, Math.PI * 2); g.fillStyle = '#508cff'; g.fill();
      g.beginPath(); g.arc(ox, oy, 10, 0, Math.PI * 2); g.lineWidth = 2.2; g.strokeStyle = '#46dc78'; g.stroke();
      const mag = Math.hypot(st.outX, st.outY); let ang = Math.atan2(st.outY, st.outX) * 180 / Math.PI; if (ang < 0) ang += 360;
      g.font = '600 12.5px Poppins'; g.fillStyle = '#d7d7da'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
      const f = v => (v > 0 ? '+' : '') + Math.round(v * 100);
      g.fillText(`x ${f(st.outX)}%   y ${f(st.outY)}%   ${mag > 0.05 ? Math.round(ang) + '°' : 'centred'}`, 4, r.height - 20);
      if (st.status) { g.font = '11.5px Poppins'; g.fillStyle = getComputedStyle(document.body).getPropertyValue(st.status[1].slice(4, -1)) || '#8a95a4'; g.fillText(st.status[0], 4, r.height - 4); }
    };
    return st;
  }

  // ---------------------------------------------------------------- SETTINGS page
  const socd = combo(SOCD, i => { m.socdMode = i; markDirty('settings'); }); socd.style.width = '100%';
  const fourWay = toggle('4-way mode (no diagonals on the D-pad / left stick)', v => { m.fourWayMode = v; markDirty('settings'); });
  const debounce = slider('Debounce delay', 0, 50, v => v === 0 ? 'off' : v + ' ms', v => { m.debounceDelay = v; markDirty('settings'); });
  const rumble = toggle('Rumble enabled', v => { m.rumbleEnabled = v; markDirty('cal'); });
  const turbo = toggle('Turbo enabled', v => { m.turboEnabled = v; markDirty('settings'); });
  const shots = slider('Shot count (higher is faster)', 2, 30, null, v => { m.turboShotCount = v; markDirty('settings'); });
  const page2 = el('div.page.hidden', { style: { padding: '16px', display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 540px))', justifyContent: 'center', gap: '16px', alignContent: 'start' } }, [
    card('Input behavior', 'sliders', [el('div.caption', { text: 'SOCD cleaning mode' }), socd, el('div', { style: { height: '12px' } }), fourWay.el, el('div', { style: { height: '10px' } }), debounce.el]),
    el('div', { style: { display: 'grid', gap: '16px', alignContent: 'start' } }, [
      card('Turbo', 'bolt', [turbo.el, el('div', { style: { height: '8px' } }), shots.el, el('p.note', { text: 'Assign the Turbo action to a physical button in the CONTROLLER tab to use it.' })]),
      L.m ? card('Rumble', 'rumble', [rumble.el, el('p.note', { text: 'Turns the vibration motor off completely.' })]) : null,   // no rumble motor on the GS   // @M
    ]),
  ]);
  function syncSettings() {
    socd.selectedIndex = clamp(m.socdMode, 0, 4); fourWay.checked = m.fourWayMode; debounce.value = m.debounceDelay;
    turbo.checked = m.turboEnabled; shots.value = m.turboShotCount; rumble.checked = m.rumbleEnabled;
  }

  // @M{
  // ---------------------------------------------------------------- TRIGGER page: released and fully pulled, stored in the controller
  const tr = { state: 0, hist: [], seen: 0, provIdle: 0, provExt: 0, wIdle: 0, wExt: 0, level: 0 };
  const trFill = el('i', { style: { width: '0%' } });
  const trHead = el('div', { style: { fontSize: '15px', fontWeight: 600, color: '#fff' } }), trCap = el('div.hint');
  const trStep = el('div', { style: { color: 'var(--orange)', fontWeight: 600, marginTop: '18px' } });
  const trInfo = el('div', { style: { color: 'var(--soft)', whiteSpace: 'pre-line', margin: '6px 0 18px' } });
  const trCal = button('CALIBRATE', { primary: true, onclick: () => trBegin() });
  const trNext = button('NEXT', { primary: true, icon: '', onclick: () => trNextStep() });
  const trCancel = button('CANCEL', { icon: '', onclick: () => trEnd('Calibration cancelled.') });
  const trReset = button('RESET', { onclick: () => trPost({ tcal: false }, 'Calibration removed. The released position is measured at power-up again.') });
  const pageTrig = el('div.page.hidden', { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' } }, [
    el('div', { style: { width: 'min(680px, 100%)' } }, [card('Analog trigger', 'trigger', [
      trHead, el('div.bar-meter', { style: { height: '24px', borderRadius: '12px', margin: '8px 0 6px' } }, [trFill]), trCap,
      trStep, trInfo, el('div.row', {}, [trCal, trNext, trCancel, trReset]),
    ])]),
  ]);
  const spread = q => q.length ? Math.max(...q) - Math.min(...q) : 0, meanOf = q => q.reduce((a, b) => a + b, 0) / Math.max(1, q.length);
  function trRefresh() {
    trCal.classList.toggle('hidden', tr.state !== 0); trReset.classList.toggle('hidden', tr.state !== 0);
    trNext.classList.toggle('hidden', tr.state === 0); trCancel.classList.toggle('hidden', tr.state === 0);
    if (tr.state !== 0) return;
    if (m.tcal) { trStep.textContent = 'Calibrated'; trInfo.textContent = `released = ${m.tidle}     fully pulled = ${m.tpressed}     (raw sensor counts, 0..4095)`; }
    else { trStep.textContent = 'Not calibrated'; trInfo.textContent = 'The released position is read at power-up (don\'t touch the trigger while plugging in) and the full pull is learned as you play. Calibrate to store both.'; }
  }
  function trBegin() { tr.state = 1; trStep.textContent = 'Step 1 of 2: released'; trInfo.textContent = 'Let go of the trigger, then click NEXT.'; setButtonText(trNext, 'NEXT', ''); trRefresh(); }
  function trNextStep() {
    if (tr.state === 1) {
      if (tr.hist.length < 8) { trInfo.textContent = 'Not enough readings yet, wait a second and click NEXT again.'; return; }
      if (spread(tr.hist) > 120) { trInfo.textContent = `The trigger is still moving (${spread(tr.hist)} counts). Let go of it and click NEXT again.`; return; }
      tr.wIdle = tr.wExt = meanOf(tr.hist); tr.state = 2;
      trStep.textContent = 'Step 2 of 2: fully pulled'; trInfo.textContent = 'Pull the trigger all the way and hold it there for a moment, then click FINISH.';
      setButtonText(trNext, 'FINISH', '');
    } else if (tr.state === 2) {
      const moved = Math.abs(tr.wExt - tr.wIdle);
      if (moved < 200) { trInfo.textContent = `The trigger only moved ${moved | 0} counts, at least 200 are needed. Pull it all the way and try again.`; return; }
      trPost({ tcal: true, tidle: Math.round(tr.wIdle), tpressed: Math.round(tr.wExt) }, 'Saved to the controller. Restart the controller to use it.');
    }
  }
  function trEnd(msg) { tr.state = 0; trRefresh(); if (msg) trInfo.textContent = msg + '\n' + trInfo.textContent; }
  async function trPost(body, msg) {
    try { m.loadCal(await dev.post('/api/setCalibration', body)); trEnd(msg); }
    catch (e) { trInfo.textContent = 'Couldn\'t save: ' + e.message; }
  }
  function trFeed(v) {
    if (v < 0) { trHead.textContent = 'No analog trigger on this output'; tr.level = 0; return; }
    tr.seen++; tr.hist.push(v); if (tr.hist.length > 30) tr.hist.shift();
    const inv = m.tinvert !== 0;
    if (tr.seen === 20) { tr.provIdle = meanOf(tr.hist); tr.provExt = inv ? tr.provIdle - 400 : tr.provIdle + 400; }
    let idle, ext;
    if (tr.state === 2) { if (inv ? v < tr.wExt : v > tr.wExt) tr.wExt = v; idle = tr.wIdle; ext = tr.wExt; }
    else if (m.tcal) { idle = m.tidle; ext = m.tpressed; }
    else {
      if (tr.seen > 20 && (inv ? v < tr.provExt : v > tr.provExt)) tr.provExt = v;
      idle = tr.seen >= 20 ? tr.provIdle : v; ext = tr.seen >= 20 ? tr.provExt : (inv ? v - 400 : v + 400);
    }
    const travel = inv ? idle - v : v - idle, span = inv ? idle - ext : ext - idle;
    tr.level = span > 1 ? clamp(travel / span, 0, 1) : 0; if (tr.level < 0.04) tr.level = 0;
    const pct = Math.round(tr.level * 100);
    trHead.textContent = 'Analog trigger  ' + pct + '%'; trFill.style.width = pct + '%';
    trCap.textContent = tr.state ? `raw ${v}   released ${idle | 0}   pulled so far ${ext | 0}` : `raw ${v}   ${m.tcal ? 'stored calibration' : 'automatic'}`;
    if (L.m) { drawBarFill.style.width = pct + '%'; drawBarText.textContent = 'Analog trigger -> L2 (left trigger)   ' + pct + '%      (click a button, or press it on the controller, to edit it)'; }
  }
  // @M}

  // ---------------------------------------------------------------- BACKUP page
  const bStatus = el('p.note');
  const page3 = el('div.page.hidden', { style: { padding: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center' } }, [
    el('div', { style: { width: 'min(640px, 100%)' } }, [card('Backup', 'cloud', [
      el('p', { text: 'Save all the controller\'s settings (buttons, LEDs, calibration and the SETTINGS tab) to a file, or load them back. Importing replaces everything on the controller.', style: { color: 'var(--soft)', margin: '0 0 14px' } }),
      el('div.row', {}, [
        button('EXPORT TO FILE...', { primary: true, onclick: async () => { try { bStatus.textContent = 'Exporting...'; const cfg = await dev.get('/api/getConfig'); download('padbox-backup.json', JSON.stringify(cfg, null, 1)); bStatus.textContent = 'Saved.'; } catch (e) { bStatus.textContent = 'Export failed: ' + e.message; } } }),
        button('IMPORT FROM FILE...', { onclick: async () => {
          const text = await openFile('.json,application/json'); if (!text) return;
          if (!await confirmBox('Import backup', 'This overwrites every setting currently on the controller with the ones in this file. Continue?', 'IMPORT')) return;
          try { bStatus.textContent = 'Importing...'; await dev.post('/api/setConfig', JSON.parse(text)); bStatus.textContent = 'Imported. Click RESTART AS CONTROLLER to apply everything.'; } catch (e) { bStatus.textContent = 'Import failed: ' + e.message; }
        } }),
      ]), bStatus,
    ])]),
  ]);

  // ---------------------------------------------------------------- tabs
  // @M{
  // no TRIGGER tab on the GS (no analog trigger)
  const pages = L.m ? [page0, page1, pageTrig, page2, page3] : [page0, page1, page2, page3];
  // @M}
  // @GS const pages = [page0, page1, page2, page3];
  shell.content(el('div', { style: { position: 'absolute', inset: 0 } }, pages));
  shell.tabs(L.m ? ['CONTROLLER', 'STICKS', 'TRIGGER', 'SETTINGS', 'BACKUP'] : ['CONTROLLER', 'STICKS', 'SETTINGS', 'BACKUP'], i => pages.forEach((p, k) => p.classList.toggle('hidden', k !== i)));   // @M
  // @GS shell.tabs(['CONTROLLER', 'STICKS', 'SETTINGS', 'BACKUP'], i => pages.forEach((p, k) => p.classList.toggle('hidden', k !== i)));
  refreshSide(); syncSettings(); sticks.forEach(s => s.sync && s.sync()); trRefresh();   // @M
  // @GS refreshSide(); syncSettings(); sticks.forEach(s => s.sync && s.sync());
  say('Make your changes, then click SAVE to send them to the controller.');
  shell.footer('Changes are sent to the PadBox when you click SAVE.');

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
      say('Saved and checked. Click RESTART AS CONTROLLER to use the new buttons, or RESTART TO PREVIEW LEDS to see the LEDs.', 'var(--good)');
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
        if (L.m) trFeed(adc[4] ?? -1);   // @M
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
