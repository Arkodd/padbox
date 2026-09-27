// The HOJA2 PadBox Calibrator, in the browser - the desktop app's pages: CONTROLLER (mode, the drawing, what each
// button does in that mode, button LED colors, lighting), STICKS (calibration, deadzones, snapback, curve, ANGLE SET)
// Changes apply to the PadBox right away (written into its RAM); SAVE keeps them.

import { el, icon, button, card, toggle, slider, combo, swatchRow, pickColor, hex, readable, image, clamp, sleep, confirmBox, setButtonText } from '../ui.js';
import { Blk, Rpt, DeviceInfo } from './device.js';
import { Analog, Rgb, Gamepad, Input, IN, IN_TRIGGER, INPUTS, PROFILES, MODES, profileOfMode, RGB_MODES, OUTPUTS, assign, defaultInputTypes, gsEssential, gsPlatform, VERSIONS } from './model.js';
import { firmwareUpdate } from '../update.js';

const PRESETS = [0xff6800, 0xff0000, 0x00ff00, 0x0000ff, 0x00ffff, 0xa020f0, 0xffffff];

export async function startHoja(shell, dev, opts) {
  let alive = true;
  shell.footer('Reading settings...');
  const info = await dev.readStatic(DeviceInfo.Block, DeviceInfo.Size);
  const ins = await dev.readStatic(DeviceInfo.InputBlock, DeviceInfo.InputSize);
  const B = {};
  for (const b of [Blk.HAPTIC, Blk.IMU, Blk.ANALOG, Blk.RGB, Blk.GAMEPAD, Blk.INPUT]) {
    let r = await dev.readBlock(b); if (!r) r = await dev.readBlock(b);
    if (!r) throw new Error('The PadBox didn\'t send its settings. Unplug it, plug it back in and try again. If it keeps happening, reinstall the firmware (UPDATE FIRMWARE).');
    B[b] = r;
  }
  const name = info ? new TextDecoder().decode(info.subarray(0, 16)).replace(/\0.*$/, '').trim() : '';
  const fw = info ? (info[704] | (info[705] << 8) | (info[706] << 16) | (info[707] << 24)) >>> 0 : 0;
   // Which board, from its product name (HOJA_PRODUCT cut to 16 characters: "PadBox GS Essent", "PadBox GS Platfo"),
  // or failing that from whether it has a right analog stick (only the Essentials do).
  if (name && !name.startsWith('PadBox GS ')) throw new Error('This PadBox ("' + name + '") isn\'t supported by this app.');
  const gs = true;
  const platform = /platf/i.test(name) || (!/essen/i.test(name) && !!ins && ins[32 * 10] === IN.Unused);
  const types = ins ? Array.from({ length: INPUTS }, (_, i) => ins[i * 10]) : defaultInputTypes(platform, gs);
  const lay = platform ? gsPlatform() : gsEssential();
  const hasRight = lay.sticks.length > 1;
  const mismatch = B[Blk.ANALOG][0] !== VERSIONS.analog || B[Blk.GAMEPAD][0] !== VERSIONS.gamepad || B[Blk.RGB][0] !== VERSIONS.rgb || B[Blk.INPUT][0] !== VERSIONS.input || B[Blk.IMU][0] !== VERSIONS.imu;

  shell.header('HOJA2 PadBox Calibrator', ['HOJA2', 'PadBox ' + lay.name, fw ? 'firmware ' + fw.toString(16).toUpperCase() : null, opts.demo ? 'demo' : null].filter(Boolean).join('  •  '));
  shell.status(true);

  // ---------------------------------------------------------------- changes: live to RAM, SAVE to flash
  const dirty = new Set(), live = new Set();
  let liveTimer = 0, calibrating = false, saving = false;
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
    if (dirty.size && !saving) say('Unsaved changes: they work now, but click SAVE to keep them after unplugging.', 'var(--warn)');
  }
  function say(t, c) { shell.footer(t); document.getElementById('footer').style.color = c || ''; }
  async function save() {
    clearTimeout(liveTimer); await pushLive();
    saving = true; btnSave.disabled = true; say('Saving to the PadBox...', 'var(--warn)');
    const r = await dev.command(Blk.GAMEPAD, 0xff, 4000);   // GAMEPAD_CMD_SAVE_ALL
    saving = false;
    if (r.ok) { dirty.clear(); say('Saved. Your settings stay on the PadBox after unplugging.', 'var(--good)'); }
    else say('Saving failed: the PadBox didn\'t confirm. Try again.', 'var(--bad)');
    refreshSave();
  }

  const btnUpdate = button('UPDATE FIRMWARE', { onclick: () => firmwareUpdate({ board: lay.board, current: 'HOJA2', enter: async () => { alive = false; await dev.bootloader(); } }) });
  const btnDisc = button('DISCONNECT', { onclick: async () => { if (dirty.size && !await confirmBox('Unsaved changes', 'Your changes work now but aren\'t saved: they\'ll be lost when the PadBox is unplugged. Disconnect anyway?', 'DISCONNECT')) return; shell.lost(null); } });
  const btnSave = button('SAVE', { primary: true, disabled: true, onclick: save });
  shell.actions([btnUpdate, btnDisc, btnSave]);

  // ---------------------------------------------------------------- CONTROLLER page
  let editProfile = 0, selInput = -1;
  const inputType = i => (i >= 0 && i < INPUTS ? types[i] : IN.Unused);
  const selectable = i => inputType(i) !== IN.Unused && lay.spots.some(s => s.input === i);
  const outputOf = i => { if (i < 0) return null; const c = Input.code(B[Blk.INPUT], editProfile, i), o = OUTPUTS[editProfile]; return c >= 0 && c < o.length ? o[c] : null; };
  const spotOf = (i, withLed) => lay.spots.find(s => s.input === i && s.kind !== 3 && (!withLed || s.led >= 0)) || lay.spots.find(s => s.input === i && (!withLed || s.led >= 0));

  const gpMode = combo(MODES.map(([n, v]) => ({ value: v, text: n })), () => {
    editProfile = profileOfMode(+gpMode.value);
    Gamepad.setMode(B[Blk.GAMEPAD], +gpMode.value); changed(Blk.GAMEPAD);
    refreshCard();
  }, 200);
  const strip = el('div.row', { style: { padding: '14px 18px 10px', gap: '14px' } }, [el('span.hint', { text: 'Mode' }), gpMode]);
  const canvas = el('canvas', { style: { width: '100%', height: '100%', display: 'block' } });
  const drawWrap = el('div.frame', { style: { position: 'absolute', left: '16px', right: '16px', top: '0', bottom: '12px' } }, [canvas]);
  const leftCol = el('div', { style: { display: 'flex', flexDirection: 'column', flex: '1', minWidth: '0' } }, [strip, el('div', { style: { position: 'relative', flex: '1' } }, [drawWrap])]);

  const cardTitle = el('span', { text: 'Select a button' });
  const cardHint = el('p.hint', { style: { margin: '0 0 8px' } });
  const acts = el('select.combo', { style: { width: '100%' } });
  acts.addEventListener('change', () => {
    if (selInput < 0) return;
    const code = +acts.value;
    if (code === Input.code(B[Blk.INPUT], editProfile, selInput)) return;
    assign(B[Blk.INPUT], editProfile, selInput, inputType(selInput), code);
    changed(Blk.INPUT);
  });
  const actsRow = el('div', {}, [el('div.caption', { text: 'Acts as', style: { marginTop: 0 } }), acts]);
  const ledBtn = el('button.colorbtn', { type: 'button', style: { width: '100%' }, on: { click: () => {
    const sp = spotOf(selInput, true); if (!sp) return;
    pickColor(Rgb.color(B[Blk.RGB], sp.led), c => { Rgb.setColor(B[Blk.RGB], sp.led, c); changed(Blk.RGB); refreshCard(); });
  } } });
  const ledRow = el('div', {}, [el('div.caption', { text: 'LED' }), ledBtn]);
  const btnReset = button('RESET THIS MODE\'S MAPPING', { cls: 'wide', onclick: resetMapping });
  const selCard = el('div.card', {}, [el('h2', { html: icon('cursor') }, [cardTitle]), cardHint, actsRow, ledRow, el('div', { style: { height: '12px' } }), btnReset]);
  const rgbMode = combo(RGB_MODES, i => { Rgb.setMode(B[Blk.RGB], i); speed.disabled = i < 2; changed(Blk.RGB); }); rgbMode.style.width = '100%';
  const bright = slider('Brightness', 0, 100, v => v + '%', v => { Rgb.setBrightness(B[Blk.RGB], Math.round(v * 4096 / 100)); changed(Blk.RGB); });
  const speed = slider('Animation time', 300, 5000, v => (v / 1000).toFixed(2) + ' s', v => { Rgb.setSpeed(B[Blk.RGB], v); changed(Blk.RGB); });
  const idle = toggle('Idle glow', v => { Rgb.setIdleGlow(B[Blk.RGB], v ? 1 : 0); changed(Blk.RGB); });
  const setAll = c => { for (let i = 0; i < 32; i++) Rgb.setColor(B[Blk.RGB], i, c); changed(Blk.RGB); refreshCard(); };
  const lightCard = card('Lighting', 'bulb', [el('div.caption', { text: 'Effect', style: { marginTop: 0 } }), rgbMode,
    el('div.caption', { text: 'Color all buttons' }), swatchRow(PRESETS, setAll, setAll), el('div', { style: { height: '6px' } }),
    bright.el, speed.el, el('div', { style: { height: '6px' } }), idle.el, el('p.note', { text: 'Button colors show with Static, Reactive and Fairy.' })]);
  const side = el('div', { style: { width: '340px', flex: 'none', padding: '10px 14px 14px 0', display: 'flex', flexDirection: 'column', gap: '12px', overflow: 'auto' } }, [selCard, lightCard]);
  const page0 = el('div.page', { style: { display: 'flex' } }, [leftCol, side]);

  function refreshCard() {
    const has = selInput >= 0;
    cardTitle.textContent = !has ? 'Select a button' : (spotOf(selInput, false) || {}).name || 'Input ' + selInput;
    cardHint.textContent = has ? 'What this button does in the selected mode.' : 'Click a button on the drawing, or press it on the PadBox. The labels show what each button does.';
    actsRow.classList.toggle('hidden', !has);
    if (has) {
      acts.innerHTML = '';
      acts.append(el('option', { value: -1, text: 'Nothing (disabled)' }));
      OUTPUTS[editProfile].forEach((o, i) => acts.append(el('option', { value: i, text: o.name })));
      const code = Input.code(B[Blk.INPUT], editProfile, selInput);
      acts.value = code >= 0 && code < OUTPUTS[editProfile].length ? code : -1;
    }
    const sp = has ? spotOf(selInput, true) : null;
    ledRow.classList.toggle('hidden', !sp);
    if (sp) { const c = Rgb.color(B[Blk.RGB], sp.led); ledBtn.style.background = hex(c); ledBtn.style.color = readable(c); ledBtn.textContent = hex(c).toUpperCase() + '  -  change'; }
  }
  function select(i) { if (!selectable(i)) return; selInput = i; refreshCard(); }
  async function resetMapping() {
    const p = editProfile;
    if (!await confirmBox('Reset mapping', 'Put every button back to its default in ' + PROFILES[p] + ' mode?', 'RESET')) return;
    clearTimeout(liveTimer); await pushLive();
    btnReset.disabled = true;
    const r = await dev.command(Blk.INPUT, 2 + p, 1500);   // MAPPER_CMD_DEFAULT_<mode>
    const fresh = r.ok ? await dev.readBlock(Blk.INPUT) : null;
    btnReset.disabled = false;
    if (!fresh) return say('Couldn\'t reset the mapping - the PadBox didn\'t answer. Try again.', 'var(--bad)');
    B[Blk.INPUT] = fresh; markUnsaved(Blk.INPUT); refreshCard();
    say(PROFILES[p] + ' mapping is back to the defaults. Click SAVE to keep it after unplugging.', 'var(--warn)');
  }

  // the drawing: tinted per console, LED buttons in their colors, pressed buttons lit, a dot per stick
  const art = await image(lay.image);
  const tinted = document.createElement('canvas');
  let tintKey = '';
  const pressed = new Array(INPUTS).fill(false), stickXY = [[0, 0], [0, 0]];
  const G = { scale: 1, offX: 0, offY: 0, w: 0, h: 0 };
  let hover = null;
  function tint() {
    if (editProfile === 4 && +gpMode.value === 2) return [255, 255, 255];   // Slippi: white
    return { 0: [240, 60, 60], 1: [70, 200, 90], 4: [160, 120, 240] }[editProfile] || [255, 255, 255];
  }
  const ax = x => G.offX + x * G.scale, ay = y => G.offY + y * G.scale;
  function armRect(sp, inset) {
    const mid = (sp.a0 + 45) * Math.PI / 180, dx = Math.round(Math.cos(mid)), dy = Math.round(Math.sin(mid));
    const near = sp.armIn + inset, far = sp.armOut - inset, half = sp.armHalf - inset;
    if (dx !== 0) { const x0 = sp.x + dx * near, x1 = sp.x + dx * far; return [Math.min(x0, x1), sp.y - half, Math.abs(x1 - x0), 2 * half]; }
    const y0 = sp.y + dy * near, y1 = sp.y + dy * far; return [sp.x - half, Math.min(y0, y1), 2 * half, Math.abs(y1 - y0)];
  }
  function inside(sp, qx, qy) {
    if (sp.kind === 1) { const [x, y, w, h] = armRect(sp, 0); return qx >= x && qx <= x + w && qy >= y && qy <= y + h; }
    if (sp.kind === 2) { let c = false; const p = sp.poly; for (let i = 0, j = p.length - 1; i < p.length; j = i++) if (((p[i][1] > qy) !== (p[j][1] > qy)) && (qx < (p[j][0] - p[i][0]) * (qy - p[i][1]) / (p[j][1] - p[i][1]) + p[i][0])) c = !c; return c; }
    const dx = (qx - sp.x) / sp.rx, dy = (qy - sp.y) / sp.ry; return dx * dx + dy * dy <= 1;
  }
  function hit(e) {
    const r = canvas.getBoundingClientRect(), qx = (e.clientX - r.left - G.offX) / G.scale, qy = (e.clientY - r.top - G.offY) / G.scale;
    for (const pass of [0, 1]) for (const sp of lay.spots) if (sp.input >= 0 && selectable(sp.input) && (sp.kind === 3) === (pass === 1) && inside(sp, qx, qy)) return sp;
    return null;
  }
  canvas.addEventListener('mousedown', e => { const sp = hit(e); if (sp) select(sp.input); });
  canvas.addEventListener('mousemove', e => { hover = hit(e); canvas.style.cursor = hover ? 'pointer' : 'default'; canvas.title = hover ? hover.name + '   →   ' + ((outputOf(hover.input) || {}).name || 'nothing') : ''; });
  canvas.addEventListener('mouseleave', () => { hover = null; });
  function paint() {
    if (!alive || page0.classList.contains('hidden') || !page0.isConnected) return;
    const r = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    const W = Math.max(1, Math.round(r.width * dpr)), H = Math.max(1, Math.round(r.height * dpr));
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    G.w = r.width; G.h = r.height;
    G.scale = Math.max(0.01, Math.min((r.width - 32) / lay.w, (r.height - 32) / lay.h));
    G.offX = (r.width - lay.w * G.scale) / 2; G.offY = (r.height - lay.h * G.scale) / 2;
    const g = canvas.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, G.w, G.h);
    // the art is white lines on transparent: tint it once per color/size
    const tc = tint(), key = tc.join() + '|' + W + 'x' + H;
    if (key !== tintKey) {
      tintKey = key;
      tinted.width = Math.max(1, Math.round(lay.w * G.scale * dpr)); tinted.height = Math.max(1, Math.round(lay.h * G.scale * dpr));
      const t = tinted.getContext('2d');
      t.clearRect(0, 0, tinted.width, tinted.height); t.globalCompositeOperation = 'source-over';
      t.drawImage(art, 0, 0, tinted.width, tinted.height);
      t.globalCompositeOperation = 'source-in'; t.fillStyle = `rgb(${tc})`; t.fillRect(0, 0, tinted.width, tinted.height);
    }
    g.drawImage(tinted, G.offX, G.offY, lay.w * G.scale, lay.h * G.scale);
    const now = performance.now() / 1000, br = 0.5 + 0.5 * Math.sin(now * 3), ring = `rgba(255,255,255,${(190 + 65 * br) / 255})`;
    const ns = G.scale * lay.w / 2040;
    const big = `600 ${Math.max(9.5, 40 * ns * 1.33)}px Poppins`, small = `${Math.max(8, 21 * ns * 1.33)}px Poppins`, armF = `600 ${Math.max(8.5, 26 * ns * 1.33)}px Poppins`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const sp of lay.spots) {
      const can = sp.input >= 0 && selectable(sp.input), sel = can && sp.input === selInput, hov = sp === hover, prs = can && pressed[sp.input];
      const o = can ? outputOf(sp.input) : null, lab = o ? o.short : null;
      const cx = ax(sp.x), cy = ay(sp.y); let rx = sp.rx * G.scale, ry = sp.ry * G.scale;
      if (sp.kind === 1) {
        if (!can) continue;
        const [x, y, w, h] = armRect(sp, 4);
        g.beginPath(); g.roundRect(ax(x), ay(y), w * G.scale, h * G.scale, 6 * ns);
        const f = prs ? 'rgba(255,104,0,.67)' : sel ? 'rgba(255,255,255,.22)' : hov ? 'rgba(255,255,255,.12)' : null;
        if (f) { g.fillStyle = f; g.fill(); }
        if (sel) { g.lineWidth = 2; g.strokeStyle = ring; g.stroke(); }
        g.font = armF; g.fillStyle = lab ? 'rgba(255,255,255,.9)' : 'rgba(255,255,255,.35)';
        g.fillText(lab || '—', ax(x + w / 2), ay(y + h / 2));
        continue;
      }
      if (sp.kind === 2) {
        const path = new Path2D(); sp.poly.forEach(([x, y], i) => i ? path.lineTo(ax(x), ay(y)) : path.moveTo(ax(x), ay(y))); path.closePath();
        const f = prs ? 'rgba(255,104,0,.67)' : sel ? 'rgba(255,255,255,.22)' : hov ? 'rgba(255,255,255,.14)' : null;
        if (f) { g.fillStyle = f; g.fill(path); }
        g.lineJoin = 'round'; g.lineWidth = sel ? 2.4 : 1.2; g.strokeStyle = sel ? ring : '#5a5a60'; g.stroke(path);
        const smallShape = sp.rx < 40;
        let text = lab;
        if (gs && smallShape) text = { Start: 'St', Select: 'Sel', Home: 'Home', Touchpad: 'TP' }[sp.name] || text;
        if (can && lab) { g.font = smallShape ? small : armF; g.fillStyle = '#fff'; g.fillText(text, cx, cy - ry - (smallShape ? 9 : 12) - (gs ? 9 : 0)); }
        continue;
      }
      if (sp.kind === 3) {
        if (prs) { g.beginPath(); g.arc(cx, cy, rx, 0, Math.PI * 2); g.fillStyle = 'rgba(255,104,0,.27)'; g.fill(); }
        if (hov) { g.beginPath(); g.arc(cx, cy, rx + 4, 0, Math.PI * 2); g.lineWidth = 2; g.strokeStyle = 'rgba(255,255,255,.43)'; g.stroke(); }
        if (sel) { g.beginPath(); g.arc(cx, cy, rx + 6, 0, Math.PI * 2); g.lineWidth = 2.6; g.strokeStyle = ring; g.stroke(); }
        continue;
      }
      const fill = sp.led >= 0 ? Rgb.color(B[Blk.RGB], sp.led) : null;
      const face = fill != null ? fill : 0x343439;
      const large = rx >= 18;
      if (fill != null || (large && can) || prs || sel || hov) {
        rx += 1.5; ry += 1.5;
        g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); g.fillStyle = '#0d1219'; g.fill();
        const gr = g.createRadialGradient(cx - rx * 0.25, cy - ry * 0.3, 0, cx - rx * 0.25, cy - ry * 0.3, rx * 1.35);
        gr.addColorStop(0, rgba(lerp(face, 0xffffff, prs ? 0.55 : 0.25), 215 / 255)); gr.addColorStop(1, rgba(lerp(face, 0, prs ? 0.05 : 0.35), 200 / 255));
        g.fillStyle = gr; g.fill();
        g.lineWidth = prs ? 3 : 2; g.strokeStyle = prs ? '#ff6800' : fill != null ? rgba(fill, 235 / 255) : '#6e6e74';
        g.beginPath(); g.ellipse(cx, cy, rx - g.lineWidth / 2, ry - g.lineWidth / 2, 0, 0, Math.PI * 2); g.stroke();
      } else { g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); g.lineWidth = 1.2; g.strokeStyle = '#464646'; g.stroke(); }
      if (hov) { g.beginPath(); g.ellipse(cx, cy, rx + 4, ry + 4, 0, 0, Math.PI * 2); g.lineWidth = 2; g.strokeStyle = 'rgba(255,255,255,.47)'; g.stroke(); }
      if (sel) {
        g.beginPath(); g.ellipse(cx, cy, rx + 6, ry + 6, 0, 0, Math.PI * 2);
        g.lineWidth = 7; g.strokeStyle = `rgba(255,255,255,${(24 + 34 * br) / 255})`; g.stroke();
        g.lineWidth = 2.6; g.strokeStyle = ring; g.stroke();
      }
      if (large && can) {
        const tcol = readable(face);
        g.font = big; g.fillStyle = lab ? tcol : tcol + '78';
        g.fillText(lab || '—', cx, cy - ry * 0.28 + 1);
        g.font = small; g.fillStyle = tcol === '#ffffff' ? 'rgba(255,255,255,.67)' : 'rgba(16,16,18,.67)';
        g.fillText(sp.label, cx, cy + ry * 0.52);
      }
    }
    lay.sticks.forEach((st, i) => {
      const cx = ax(st.x), cy = ay(st.y), R = st.r * G.scale;
      g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.lineWidth = 1.4; g.strokeStyle = '#6e6e6e'; g.stroke();
      let [nx, ny] = stickXY[i]; const m = Math.hypot(nx, ny); if (m > 1) { nx /= m; ny /= m; }
      const dotR = R * 0.26, travel = R - dotR - 2;
      g.beginPath(); g.arc(cx + nx * travel, cy - ny * travel, dotR, 0, Math.PI * 2); g.fillStyle = m > 0.05 ? '#ff6800' : '#787878'; g.fill();
    });
  }
  const lerp = (a, b, t) => { const c = (s) => ((a >> s) & 255) + (((b >> s) & 255) - ((a >> s) & 255)) * t; return (Math.round(c(16)) << 16) | (Math.round(c(8)) << 8) | Math.round(c(0)); };
  const rgba = (c, a) => `rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},${a})`;

  // ---------------------------------------------------------------- STICKS page
  const btnCal = button(hasRight ? 'CALIBRATE BOTH STICKS' : 'CALIBRATE THE STICK', { primary: true, onclick: toggleCalibrate });
  const calStatus = el('div', { style: { color: 'var(--soft)', fontSize: '13px' } });
  const calCard = el('div.card.row', { style: { gap: '22px', padding: '16px 20px' } }, [btnCal, el('div', {}, [el('div', { text: 'Stick calibration', style: { fontSize: '16px', fontWeight: 600, color: '#fff' } }), calStatus])]);
  const sticks = [makeStick(false, 'Left stick'), makeStick(true, hasRight ? 'Right stick' : 'C-stick')];
  const page1 = el('div.page.hidden', { style: { padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' } }, [calCard, el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' } }, sticks.map(s => s.card))]);
  function refreshCal(msg, color) {
    setButtonText(btnCal, calibrating ? 'STOP' : hasRight ? 'CALIBRATE BOTH STICKS' : 'CALIBRATE THE STICK', calibrating ? '' : 'target');
    if (msg) { calStatus.textContent = msg; calStatus.style.color = color || 'var(--soft)'; return; }
    if (calibrating) { calStatus.textContent = 'Calibrating: roll ' + (hasRight ? 'both sticks' : 'the stick') + ' slowly around the edge 3 times, touching every corner, then click STOP.'; calStatus.style.color = 'var(--warn)'; }
    else if (Analog.calibrationSet(B[Blk.ANALOG])) { calStatus.textContent = hasRight ? 'Both sticks are calibrated.' : 'The stick is calibrated.'; calStatus.style.color = 'var(--good)'; }
    else { calStatus.textContent = 'Not calibrated yet. Calibrate for full range and accurate diagonals.'; calStatus.style.color = 'var(--warn)'; }
  }
  async function toggleCalibrate() {
    if (!calibrating) {
      clearTimeout(liveTimer); await pushLive();
      calibrating = true; sticks.forEach(s => s.trail.length = 0); refreshCal();
      dev.command(Blk.ANALOG, 1, 1500);   // ANALOG_CMD_CALIBRATE_START
    } else {
      calibrating = false; btnCal.disabled = true; refreshCal('Finishing...', 'var(--warn)');
      await dev.command(Blk.ANALOG, 2, 1500);   // ANALOG_CMD_CALIBRATE_STOP
      const fresh = await dev.readBlock(Blk.ANALOG);
      btnCal.disabled = false; sticks.forEach(s => s.trail.length = 0);
      if (!fresh) return refreshCal('Couldn\'t read the result back from the PadBox. Try again.', 'var(--bad)');
      const pending = live.has(Blk.ANALOG);
      B[Blk.ANALOG] = fresh;
      if (pending) sticks.forEach(s => s.apply());
      markUnsaved(Blk.ANALOG); if (pending) pushLive();
      if (Analog.calibrationSet(fresh)) refreshCal('Calibrated. Click SAVE to keep it after unplugging.', 'var(--good)');
      else refreshCal('Not enough movement was seen. Try again with slower, fuller circles that touch every corner.', 'var(--bad)');
    }
  }
  function makeStick(right, title) {
    const A = () => B[Blk.ANALOG];
    const present = !right || hasRight;
    const cv = el('canvas', { style: { width: '100%', height: '236px', display: 'block' } });
    const en = toggle('Stick enabled', v => { Analog.setDisabled(A(), right, !v); changed(Blk.ANALOG); });
    const fx = toggle('Flip X axis', v => { Analog.setInv(A(), right ? 6 : 2, v); changed(Blk.ANALOG); });
    const fy = toggle('Flip Y axis', v => { Analog.setInv(A(), right ? 8 : 4, v); changed(Blk.ANALOG); });
    const oct = right ? null : toggle('Octagonal gate', () => { });
    if (oct) oct.checked = true;
    const dz = v => (v * 100 / 2047).toFixed(1) + '%';
    const dead = slider('Inner deadzone (centre)', 0, 400, dz, v => { Analog.setDeadzone(A(), right, v); changed(Blk.ANALOG); });
    const outer = slider('Outer deadzone (edge)', 0, 400, dz, v => { Analog.setOuter(A(), right, v); changed(Blk.ANALOG); });
    const snap = slider('Snapback filter', 0, 255, v => v === 0 ? 'off' : String(v), v => { Analog.setSnap(A(), right, v); changed(Blk.ANALOG); });
    const exp = slider('Curve  (1.00 = linear, higher = finer centre)', 50, 300, v => (v / 100).toFixed(2), v => { Analog.setExp(A(), right, clamp(v - 49, 1, 251)); changed(Blk.ANALOG); });
    const angleStatus = el('span', { text: 'Hold the stick in a notch, then click ANGLE SET to line that notch up with it.', style: { color: 'var(--soft)', fontSize: '12.5px', flex: 1 } });
    const angleBtn = button('ANGLE SET', { primary: true, icon: '', onclick: angleSet });
    const opts = el('div', {}, [el('div.row', { style: { margin: '6px 0' } }, [fx.el, fy.el, el('div.grow'), oct && oct.el]), dead.el, outer.el, snap.el, exp.el, el('div.row', { style: { marginTop: '10px' } }, [angleBtn, angleStatus])]);
    const missing = el('div.hint', { text: 'The C-stick is made of buttons, so there\'s nothing to calibrate.', style: { padding: '90px 0', textAlign: 'center' } });
    const head = el('div.row', {}, [el('h2', { text: title, style: { margin: 0, fontSize: '16px', flex: 1 } }), en.el]);
    const c = el('div.card', {}, [head, present ? cv : missing, present ? opts : null]);
    if (!present) en.el.classList.add('hidden');
    const st = { card: c, x: 0, y: 0, rx: 0, ry: 0, trail: [] };
    st.load = () => {
      en.checked = !Analog.disabled(A(), right); fx.checked = Analog.inv(A(), right ? 6 : 2); fy.checked = Analog.inv(A(), right ? 8 : 4);
      dead.value = clamp(Analog.deadzone(A(), right), 0, 400); outer.value = clamp(Analog.outer(A(), right), 0, 400);
      snap.value = clamp(Analog.snap(A(), right), 0, 255); exp.value = clamp(Analog.exp(A(), right) + 49, 50, 300);
    };
    st.apply = () => {
      Analog.setInv(A(), right ? 6 : 2, fx.checked); Analog.setInv(A(), right ? 8 : 4, fy.checked);
      Analog.setDeadzone(A(), right, dead.value); Analog.setOuter(A(), right, outer.value); Analog.setSnap(A(), right, snap.value); Analog.setExp(A(), right, clamp(exp.value - 49, 1, 251));
    };
    async function angleSet() {
      if (calibrating) { angleStatus.textContent = 'Finish the calibration first.'; angleStatus.style.color = 'var(--warn)'; return; }
      angleBtn.disabled = true;
      const r = await dev.command(Blk.ANALOG, right ? 4 : 3, 1500);
      angleBtn.disabled = false;
      if (!r.ok || !r.data) { angleStatus.textContent = 'Couldn\'t read the stick\'s position. Try again.'; angleStatus.style.color = 'var(--bad)'; return; }
      const dv = new DataView(r.data.buffer, r.data.byteOffset), angle = dv.getFloat32(0, true), dist = dv.getFloat32(4, true);
      if (dist < 150) { angleStatus.textContent = 'The stick is near the centre - push it all the way against the notch first.'; angleStatus.style.color = 'var(--warn)'; return; }
      const slot = Analog.nearestSlot(A(), right, angle);
      if (slot < 0) { angleStatus.textContent = 'This stick has no notches to adjust yet - calibrate the sticks first.'; angleStatus.style.color = 'var(--bad)'; return; }
      const target = Analog.slotOutAngle(A(), right, slot);
      Analog.setSlotIn(A(), right, slot, angle, dist); changed(Blk.ANALOG);
      angleStatus.textContent = `Notch at ${Math.round(target)}° now matches your stick (${Math.round(angle)}°). Click SAVE to keep it.`; angleStatus.style.color = 'var(--good)';
    }
    st.paint = () => {
      if (!present || page1.classList.contains('hidden')) return;
      if (calibrating && Math.hypot(st.rx, st.ry) > 0.5) { st.trail.push([st.rx, st.ry]); if (st.trail.length > 3000) st.trail.shift(); }
      const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
      if (cv.width !== Math.round(r.width * dpr)) { cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr); }
      const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, r.width, r.height);
      const bottom = 26, cx = r.width / 2, cy = (r.height - bottom) / 2, R = Math.min(r.width, r.height - bottom) / 2 - 8;
      const grd = g.createRadialGradient(cx, cy, 0, cx, cy, R * 1.2); grd.addColorStop(0, `rgba(255,110,30,${calibrating ? 0.24 : 0.13})`); grd.addColorStop(1, 'rgba(255,110,30,0)');
      g.fillStyle = grd; g.fillRect(0, 0, r.width, r.height);
      g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fillStyle = 'rgba(8,8,9,.47)'; g.fill();
      g.lineWidth = 1; g.strokeStyle = '#222226';
      for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * R, cy - Math.sin(a) * R); g.stroke(); }
      const octOn = oct && oct.checked;
      const gate = () => { g.beginPath(); if (octOn) { for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; g[i ? 'lineTo' : 'moveTo'](cx + R * Math.cos(a), cy - R * Math.sin(a)); } g.closePath(); } else g.arc(cx, cy, R, 0, Math.PI * 2); };
      if (octOn) { g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.lineWidth = 1.5; g.strokeStyle = '#69696f'; g.stroke(); }
      gate(); g.lineJoin = 'round'; g.lineWidth = 5; g.strokeStyle = 'rgba(255,104,0,.22)'; g.stroke(); g.lineWidth = 2; g.strokeStyle = '#ff6800'; g.stroke();
      const din = dead.value / 2047, dout = 1 - outer.value / 2047;
      g.setLineDash([5, 4]); g.lineWidth = 1.4;
      if (din > 0.003) { g.strokeStyle = 'rgba(255,100,100,.67)'; g.beginPath(); g.arc(cx, cy, R * din, 0, Math.PI * 2); g.stroke(); }
      if (dout < 0.997) { g.strokeStyle = 'rgba(100,170,255,.67)'; g.beginPath(); g.arc(cx, cy, R * dout, 0, Math.PI * 2); g.stroke(); }
      g.setLineDash([]);
      st.trail.forEach(([x, y], i) => { g.fillStyle = `rgba(80,140,255,${(26 + 120 * i / Math.max(1, st.trail.length - 1)) / 255})`; g.fillRect(cx + x * R - 1.5, cy - y * R - 1.5, 3, 3); });
      const place = (x, y) => { const m = Math.hypot(x, y); if (m > 1) { x /= m; y /= m; } return [cx + x * R, cy - y * R]; };
      const [rwx, rwy] = place(st.rx, st.ry), [ox, oy] = place(st.x, st.y);
      g.beginPath(); g.arc(rwx, rwy, 8, 0, Math.PI * 2); g.lineWidth = 1.8; g.strokeStyle = 'rgba(225,225,230,.75)'; g.stroke();
      g.beginPath(); g.arc(ox, oy, 6, 0, Math.PI * 2); g.fillStyle = '#ff6800'; g.fill();
      const mag = Math.hypot(st.x, st.y); let ang = Math.atan2(st.y, st.x) * 180 / Math.PI; if (ang < 0) ang += 360;
      const f = v => (v > 0 ? '+' : '') + Math.round(v * 100);
      g.font = '600 12.5px Poppins'; g.fillStyle = '#d7d7da'; g.textAlign = 'left'; g.textBaseline = 'top';
      g.fillText(`x ${f(st.x)}%    y ${f(st.y)}%    ${mag > 0.05 ? Math.round(ang) + '°' : 'centred'}`, 6, r.height - bottom + 5);
      g.font = '11.5px Poppins'; g.fillStyle = '#8a95a4'; g.textAlign = 'right';
      g.fillText('output        raw', r.width - 6, r.height - bottom + 6);
    };
    return st;
  }

  // ---------------------------------------------------------------- tabs, load, live reports
  const pages = [page0, page1];
  shell.content(el('div', { style: { position: 'absolute', inset: 0 } }, pages));
  let curTab = 0;
  shell.tabs(['CONTROLLER', 'STICKS'], i => {
    curTab = i; pages.forEach((p, k) => p.classList.toggle('hidden', k !== i));
    dev.reportMode(i === 0 ? Rpt.INPUT_RAW : Rpt.INPUT_JOYSTICKS);
    pressed.fill(false);
  });
  gpMode.value = String(MODES.some(m => m[1] === Gamepad.mode(B[Blk.GAMEPAD])) ? Gamepad.mode(B[Blk.GAMEPAD]) : 0);
  editProfile = profileOfMode(+gpMode.value);
  rgbMode.selectedIndex = clamp(Rgb.mode(B[Blk.RGB]), 0, RGB_MODES.length - 1); speed.disabled = rgbMode.selectedIndex < 2;
  speed.value = clamp(Rgb.speed(B[Blk.RGB]), 300, 5000); bright.value = clamp(Math.round(Rgb.brightness(B[Blk.RGB]) * 100 / 4096), 0, 100);
  idle.checked = Rgb.idleGlow(B[Blk.RGB]) !== 0;
  sticks.forEach(s => s.load && s.load());
  refreshCard(); refreshCal();
  say(mismatch ? 'This firmware doesn\'t match this app. Update it with UPDATE FIRMWARE before changing anything.' : 'Changes apply to the PadBox right away. Click SAVE to keep them after unplugging.', mismatch ? 'var(--bad)' : '');

  dev.onRaw = p => {
    let fresh = -1;
    for (let i = 0; i < INPUTS; i++) { const d = (p[17 + i] & 0x80) !== 0; if (d && !pressed[i] && fresh < 0) fresh = i; pressed[i] = d; }
    const v = i => ((p[17 + i] & 0x7f) << 5) / 2048;
    stickXY[0] = [v(27) - v(28), v(29) - v(30)]; stickXY[1] = [v(32) - v(33), v(34) - v(35)];
    if (fresh >= 0 && inputType(fresh) !== IN.Joystick && curTab === 0) select(fresh);
  };
  dev.onSticks = (lxR, lyR, rxR, ryR, lxS, lyS, rxS, ryS) => {
    Object.assign(sticks[0], { rx: lxR, ry: lyR, x: lxS, y: lyS }); Object.assign(sticks[1], { rx: rxR, ry: ryR, x: rxS, y: ryS });
  };
  dev.onLost = () => { if (alive) { alive = false; shell.lost('Lost the connection to the PadBox.'); } };
  const frame = () => {
    if (!alive) return;
    paint(); sticks.forEach(s => s.paint && s.paint());
  };
  const loop = () => { if (!alive) return; frame(); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  const tick = setInterval(() => { if (!alive) return clearInterval(tick); frame(); }, 200);   // also without animation frames

  return { stop() { alive = false; clearInterval(tick); }, dirty: () => dirty.size > 0 };
}
