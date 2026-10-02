// The HOJA2 PadBox Calibrator, in the browser - the desktop app's pages: CONTROLLER (mode, the drawing, what each
// button does in that mode, button LED colors, lighting), STICKS (calibration, deadzones, snapback, curve, ANGLE SET)
// @M{
// and, on the PadBox M, TRIGGER (the analog trigger's range), GYRO (live 3D view, sensitivity, gyro calibration) and
// RUMBLE. Changes apply to the PadBox right away (written into its RAM); SAVE keeps them.
// @M}
// @GS // Changes apply to the PadBox right away (written into its RAM); SAVE keeps them.

import { el, icon, button, card, toggle, slider, combo, swatchRow, pickColor, hex, readable, image, clamp, sleep, confirmBox, setButtonText } from '../ui.js';
import { Blk, Rpt, DeviceInfo } from './device.js';
import { Analog, Rgb, Gamepad, Imu, Haptic, Input, IN, IN_TRIGGER, INPUTS, PROFILES, MODES, profileOfMode, RGB_MODES, OUTPUTS, assign, defaultInputTypes, gsEssential, gsPlatform, mEssential, mPlatform, VERSIONS } from './model.js';   // @M
// @GS import { Analog, Rgb, Gamepad, Input, IN, IN_TRIGGER, INPUTS, PROFILES, MODES, profileOfMode, RGB_MODES, OUTPUTS, assign, defaultInputTypes, gsEssential, gsPlatform, VERSIONS } from './model.js';
import { firmwareUpdate } from '../update.js';
import { GyroView, ImuFusion, loadStl } from './gyro.js';   // @M

const PRESETS = [0xff6800, 0xff0000, 0x00ff00, 0x0000ff, 0x00ffff, 0xa020f0, 0xffffff];
const TAB_TRIGGER = 2, TAB_GYRO = 3, TAB_RUMBLE = 4;   // @M

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
  const hov = await dev.readBlock(Blk.HOVER);   // hoverConfig_s: [1] = the analog trigger has been calibrated   // @M
  const name = info ? new TextDecoder().decode(info.subarray(0, 16)).replace(/\0.*$/, '').trim() : '';
  const fw = info ? (info[704] | (info[705] << 8) | (info[706] << 16) | (info[707] << 24)) >>> 0 : 0;
  // Which board, from its product name (HOJA_PRODUCT cut to 16 characters: "PadBox GS Essent", "PadBox M Platfor"),   // @M
  // @GS  // Which board, from its product name (HOJA_PRODUCT cut to 16 characters: "PadBox GS Essent", "PadBox GS Platfo"),
  // or failing that from whether it has a right analog stick (only the Essentials do).
  if (name && !/^PadBox (GS|M) /.test(name)) throw new Error('This PadBox ("' + name + '") isn\'t supported by this app.');   // @M
  // @GS if (name && !name.startsWith('PadBox GS ')) throw new Error('This PadBox ("' + name + '") isn\'t supported by this app.');
  const gs = !name.startsWith('PadBox M ');   // @M
  // @GS const gs = true;
  const platform = /platf/i.test(name) || (!/essen/i.test(name) && !!ins && ins[32 * 10] === IN.Unused);
  const types = ins ? Array.from({ length: INPUTS }, (_, i) => ins[i * 10]) : defaultInputTypes(platform, gs);
  const lay = gs ? (platform ? gsPlatform() : gsEssential()) : (platform ? mPlatform() : mEssential());   // @M
  // @GS const lay = platform ? gsPlatform() : gsEssential();
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

  const btnUpdate = button('UPDATE FIRMWARE', { onclick: () => firmwareUpdate({ board: lay.board, current: 'HOJA2', enter: async noDrive => { alive = false; await dev.bootloader(noDrive); } }) });
  const btnDisc = button('DISCONNECT', { onclick: async () => { if (dirty.size && !await confirmBox('Unsaved changes', 'Your changes work now but aren\'t saved: they\'ll be lost when the PadBox is unplugged. Disconnect anyway?', 'DISCONNECT')) return; shell.lost(null); } });
  const btnSave = button('SAVE', { primary: true, disabled: true, onclick: save });
  shell.actions([btnUpdate, btnDisc, btnSave]);

  // ---------------------------------------------------------------- CONTROLLER page
  let editProfile = 0, selInput = -1;
  const inputType = i => (i >= 0 && i < INPUTS ? types[i] : IN.Unused);
  // the analog trigger isn't on the drawing: it has its own button above it   // @M
  const selectable = i => inputType(i) !== IN.Unused && (i === IN_TRIGGER || lay.spots.some(s => s.input === i));   // @M
  // @GS const selectable = i => inputType(i) !== IN.Unused && lay.spots.some(s => s.input === i);
  const outputOf = i => { if (i < 0) return null; const c = Input.code(B[Blk.INPUT], editProfile, i), o = OUTPUTS[editProfile]; return c >= 0 && c < o.length ? o[c] : null; };
  const spotOf = (i, withLed) => lay.spots.find(s => s.input === i && s.kind !== 3 && (!withLed || s.led >= 0)) || lay.spots.find(s => s.input === i && (!withLed || s.led >= 0));

  const gpMode = combo(MODES.map(([n, v]) => ({ value: v, text: n })), () => {
    editProfile = profileOfMode(+gpMode.value);
    Gamepad.setMode(B[Blk.GAMEPAD], +gpMode.value); changed(Blk.GAMEPAD);
    refreshCard();
  }, 200);
  const btnTrig = button('ANALOG TRIGGER', { icon: 'trigger', onclick: () => select(IN_TRIGGER) });   // @M
  btnTrig.classList.toggle('hidden', !selectable(IN_TRIGGER));   // @M
  const strip = el('div.row', { style: { padding: '14px 18px 10px', gap: '14px' } }, [el('span.hint', { text: 'Mode' }), gpMode, btnTrig]);   // @M
  // @GS const strip = el('div.row', { style: { padding: '14px 18px 10px', gap: '14px' } }, [el('span.hint', { text: 'Mode' }), gpMode]);
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
    cardTitle.textContent = !has ? 'Select a button' : selInput === IN_TRIGGER ? 'Analog trigger' : (spotOf(selInput, false) || {}).name || 'Input ' + selInput;   // @M
    // @GS cardTitle.textContent = !has ? 'Select a button' : (spotOf(selInput, false) || {}).name || 'Input ' + selInput;
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

  // @M{
  // ---------------------------------------------------------------- TRIGGER page (PadBox M)
  // The analog trigger (a Hall-effect sensor, INPUT_CODE_LT_ANALOG, a "hover" input in hoja2). The firmware learns its
  // range itself: HOVER command 0x40 | input starts learning (the lowest and highest readings become 0 % and 100 %),
  // 0x00 stops and applies it. The result is in the controller's RAM, so it only needs SAVE.
  let trigValue = 0, trigCalibrating = false, trigCalibrated = !!(hov && hov[1]);
  const trigFill = el('i', { style: { width: '0%' } });
  const trigPct = el('b', { text: '0 %', style: { width: '64px', textAlign: 'right', fontSize: '15px', color: '#fff' } });
  const trigStatus = el('div', { style: { fontWeight: 600, marginTop: '16px' } });
  const trigSteps = el('div', { style: { color: 'var(--soft)', whiteSpace: 'pre-line', margin: '8px 0 18px' } });
  const trigBtn = button('CALIBRATE', { primary: true, onclick: () => trigCalibrating ? trigDone() : trigStart() });
  const page2 = el('div.page.hidden', { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' } }, [
    el('div', { style: { width: 'min(600px, 100%)' } }, [card('Trigger calibration', 'trigger', [
      el('p', { text: 'Sets the two ends of the analog trigger: released = 0 %, pressed all the way = 100 %.', style: { color: 'var(--soft)', margin: '0 0 14px' } }),
      el('div.caption', { text: 'Trigger now' }),
      el('div.row', {}, [el('div.bar-meter.grow', { style: { height: '16px', borderRadius: '8px' } }, [trigFill]), trigPct]),
      trigStatus, trigSteps, trigBtn,
    ])]),
  ]);
  function refreshTrig() {
    setButtonText(trigBtn, trigCalibrating ? 'DONE' : 'CALIBRATE', trigCalibrating ? '' : 'target');
    trigStatus.textContent = trigCalibrating ? 'Calibrating...' : trigCalibrated ? 'Calibrated.' : 'Not calibrated yet: a full press may not reach 100 %.';
    trigStatus.style.color = trigCalibrating ? 'var(--warn)' : trigCalibrated ? 'var(--good)' : 'var(--warn)';
    trigSteps.textContent = trigCalibrating
      ? '1.  Let go of the trigger completely.\n2.  Press it all the way down, hold it a moment, and let go. Do it two or three times.\n3.  Click DONE.'
      : 'Click CALIBRATE, then follow the steps shown here. Don\'t touch the trigger while you click it.';
  }
  async function trigStart() {
    trigBtn.disabled = true;
    const r = await dev.command(Blk.HOVER, 0x40 | IN_TRIGGER, 2000);   // start learning the trigger
    trigBtn.disabled = false;
    if (r.ok) trigCalibrating = true; else say('The PadBox didn\'t start the trigger calibration. Try again.', 'var(--bad)');
    refreshTrig();
  }
  async function trigDone() {
    trigBtn.disabled = true;
    const r = await dev.command(Blk.HOVER, 0x00, 2000);   // stop and apply the new range
    trigBtn.disabled = false;
    if (r.ok) { trigCalibrating = false; trigCalibrated = true; markUnsaved(Blk.HOVER); say('Trigger calibrated. Click SAVE to keep it after unplugging.', 'var(--good)'); }
    else say('The PadBox didn\'t confirm the end of the calibration. Click DONE again.', 'var(--bad)');
    refreshTrig();
  }

  // ---------------------------------------------------------------- GYRO page (PadBox M)
  // The orientation is worked out here from the raw IMU readings in every live report (see gyro.js).
  let gyro = null, fusion = null, lastImuT = -1, autoCentreIn = 0, imuCalibrating = false, imuTextCount = 0;
  const gyroCanvas = el('canvas', { style: { position: 'absolute', inset: 0, width: '100%', height: '100%' } });
  const gyroMsg = el('div', { text: 'Loading 3D model...', style: { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#969696', textAlign: 'center', padding: '20px' } });
  const gyroInfo = el('span.hint', { text: 'Tilt the PadBox to see it move.' });
  const viewCard = el('div.card', { style: { display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 } }, [
    el('h2', { html: icon('gyro') + '<span>Live orientation</span>' }),
    el('div', { style: { position: 'relative', flex: 1, minHeight: '260px', borderRadius: '6px', overflow: 'hidden', background: 'radial-gradient(closest-side, rgba(255,110,30,.18), rgba(255,110,30,0)) #0e141c' } }, [gyroCanvas, gyroMsg]),
    el('div.row', { style: { marginTop: '12px' } }, [button('CENTRE VIEW', { icon: 'target', onclick: () => gyro && gyro.centre() }), gyroInfo]),
  ]);
  const imuOn = toggle('Gyro and accelerometer on', v => { Imu.setDisabled(B[Blk.IMU], !v); enableImu(); changed(Blk.IMU); });
  const pctF = v => v + '%';
  const gyroSens = ['X', 'Y', 'Z'].map((a, k) => slider(a + ' axis', 50, 200, pctF, v => { Imu.setGyroSens(B[Blk.IMU], k, v); changed(Blk.IMU); }));
  const accSens = ['X', 'Y', 'Z'].map((a, k) => slider(a + ' axis', 50, 200, pctF, v => { Imu.setAccelSens(B[Blk.IMU], k, v); changed(Blk.IMU); }));
  const imuCal = button('CALIBRATE GYRO', { primary: true, onclick: calibrateGyro });
  const imuStatus = el('p.note', { text: 'If the view slowly drifts: put the PadBox on a flat table, don\'t touch it, and click CALIBRATE GYRO.' });
  const motionCard = card('Motion controls', 'sliders', [imuOn.el,
    el('div.caption', { text: 'Gyro sensitivity  (default 120%)', style: { marginTop: '16px' } }), ...gyroSens.map(s => s.el),
    el('div.caption', { text: 'Accelerometer sensitivity  (default 100%)', style: { marginTop: '12px' } }), ...accSens.map(s => s.el),
    el('div', { style: { height: '12px' } }), imuCal, imuStatus]);
  motionCard.style.width = '420px'; motionCard.style.flex = 'none'; motionCard.style.alignSelf = 'flex-start';
  const page3 = el('div.page.hidden', { style: { display: 'flex', gap: '16px', padding: '16px' } }, [viewCard, motionCard]);
  function enableImu() { const on = imuOn.checked; for (const s of [...gyroSens, ...accSens]) s.disabled = !on; imuCal.disabled = !on; }
  function loadGyro() {
    imuOn.checked = !Imu.disabled(B[Blk.IMU]);
    gyroSens.forEach((s, k) => s.value = clamp(Imu.gyroSens(B[Blk.IMU], k), 50, 200));
    accSens.forEach((s, k) => s.value = clamp(Imu.accelSens(B[Blk.IMU], k), 50, 200));
    enableImu();
  }
  async function openGyro() {
    if (gyro) return;
    gyro = new GyroView(gyroCanvas); fusion = new ImuFusion();
    if (!gyro.ok) { gyroMsg.textContent = 'This browser can\'t draw the 3D view (WebGL 2 is off).'; return; }
    try {
      const r = await fetch('assets/padbox.stl'); if (!r.ok) throw new Error();
      const mesh = loadStl(await r.arrayBuffer()); if (!mesh) throw new Error();
      gyro.setMesh(mesh); gyroMsg.classList.add('hidden');
    } catch (e) { gyroMsg.textContent = 'Could not read the 3D model.'; }
  }
  async function calibrateGyro() {
    clearTimeout(liveTimer); await pushLive();
    imuCal.disabled = true; imuCalibrating = true;
    imuStatus.textContent = 'Calibrating - keep the PadBox completely still...'; imuStatus.style.color = 'var(--warn)';
    // IMU_CMD_CALIBRATE_START only answers once the calibration has finished; the new offsets are in the RAM copy of
    // the block, so it's read back (a later SAVE, or a sensitivity change that re-sends the block, keeps them)
    const r = await dev.command(Blk.IMU, 1, 15000);
    const fresh = r.ok ? await dev.readBlock(Blk.IMU) : null;
    imuCalibrating = false; if (fusion) fusion.reset(); lastImuT = -1;
    if (fresh) { B[Blk.IMU] = fresh; loadGyro(); markUnsaved(Blk.IMU); imuStatus.textContent = 'Gyro calibrated. Click SAVE to keep it after unplugging.'; imuStatus.style.color = 'var(--good)'; }
    else { enableImu(); imuStatus.textContent = 'The PadBox didn\'t report back. Make sure it\'s still, then try again.'; imuStatus.style.color = 'var(--bad)'; }
  }
  // every live report: bytes 3-14 are the accelerometer and gyro, straight from the firmware's standard IMU mode
  function onImu(p) {
    if (curTab !== TAB_GYRO || !fusion || imuCalibrating) { lastImuT = -1; return; }
    const now = performance.now() / 1000;
    if (lastImuT < 0) autoCentreIn = 50;   // tab just opened: centre once the estimate has settled
    const dt = lastImuT < 0 ? 0 : Math.min(0.05, now - lastImuT); lastImuT = now;
    const s16 = o => { const v = p[o] | (p[o + 1] << 8); return v > 32767 ? v - 65536 : v; };
    const I = B[Blk.IMU], gs3 = k => clamp(Imu.gyroSens(I, k), 50, 200), as3 = k => clamp(Imu.accelSens(I, k), 50, 200);
    // undo the sensitivity %, so the model turns exactly as far as the PadBox does
    const gx = s16(9) * 100 / gs3(0), gy = s16(11) * 100 / gs3(1), gz = s16(13) * 100 / gs3(2);
    const ax = s16(3) * 100 / as3(0), ay = s16(5) * 100 / as3(1), az = s16(7) * 100 / as3(2);
    fusion.update(ImuFusion.toModel(ax, ay, az), ImuFusion.toModel(gx, gy, gz), 4096 /* +-8 g */, dt);
    gyro.setOrientation(fusion.q);
    if (autoCentreIn > 0 && --autoCentreIn === 0) gyro.centre();
    if (++imuTextCount % 12 === 0) gyroInfo.textContent = `accelerometer ${(Math.hypot(ax, ay, az) / 4096).toFixed(2)} g     gyro ${Math.round(gx * 0.061)} / ${Math.round(gy * 0.061)} / ${Math.round(gz * 0.061)} °/s`;
  }

  // ---------------------------------------------------------------- RUMBLE page (PadBox M)
  const hapOn = toggle('Rumble on', v => { hapStrength.disabled = hapTest.disabled = !v; Haptic.setStrength(B[Blk.HAPTIC], v ? pctToStrength(hapStrength.value) : 0); changed(Blk.HAPTIC); });
  const pctToStrength = pct => clamp(Math.round(pct * 255 / 100), 1, 255);
  const hapStrength = slider('Strength', 1, 100, pctF, v => { if (!hapOn.checked) return; Haptic.setStrength(B[Blk.HAPTIC], pctToStrength(v)); changed(Blk.HAPTIC); });
  const hapTest = button('TEST', { primary: true, icon: 'rumble', onclick: async () => {
    clearTimeout(liveTimer); await pushLive();   // test at the strength shown, not the last one sent
    hapTest.disabled = true; setButtonText(hapTest, 'BUZZING...', 'rumble');
    await dev.command(Blk.HAPTIC, 1, 2500);   // HAPTIC_CMD_TEST_STRENGTH
    setButtonText(hapTest, 'TEST', 'rumble'); hapTest.disabled = !hapOn.checked;
  } });
  const page4 = el('div.page.hidden', { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' } }, [
    el('div', { style: { width: 'min(560px, 100%)' } }, [card('Rumble', 'rumble', [hapOn.el, el('div', { style: { height: '10px' } }), hapStrength.el,
      el('div.row', { style: { marginTop: '12px' } }, [hapTest, el('span.hint', { text: 'Buzzes for one second at the strength above.' })]),
      el('p.note', { text: 'This strength applies to all rumble, including in games.', style: { marginTop: '14px' } })])]),
  ]);
  function loadRumble() {
    const st = Haptic.strength(B[Blk.HAPTIC]);
    hapOn.checked = st > 0; hapStrength.value = st > 0 ? clamp(Math.round(st * 100 / 255), 1, 100) : 100;
    hapStrength.disabled = hapTest.disabled = !hapOn.checked;
  }

  // @M}
  // ---------------------------------------------------------------- tabs, load, live reports
  const pages = [page0, page1, page2, page3, page4];   // @M
  // @GS const pages = [page0, page1];
  shell.content(el('div', { style: { position: 'absolute', inset: 0 } }, pages));
  let curTab = 0;
  // @M{
  // no TRIGGER / GYRO / RUMBLE on the GS (no analog trigger, gyro or rumble motor)
  const tabs = shell.tabs(gs ? ['CONTROLLER', 'STICKS'] : ['CONTROLLER', 'STICKS', 'TRIGGER', 'GYRO', 'RUMBLE'], i => {
    curTab = i; pages.forEach((p, k) => p.classList.toggle('hidden', k !== i));
    // the live report the open tab needs: raw buttons for CONTROLLER and TRIGGER, the sticks otherwise
    dev.reportMode(i === 0 || i === TAB_TRIGGER ? Rpt.INPUT_RAW : Rpt.INPUT_JOYSTICKS);
    if (i === TAB_TRIGGER) dev.focus(IN_TRIGGER);   // its full value in bytes 15-16
    if (i === TAB_GYRO) openGyro();
    pressed.fill(false);
  });
  if (!gs && !selectable(IN_TRIGGER)) tabs.hide(TAB_TRIGGER, true);
  // @M}
  // @GS shell.tabs(['CONTROLLER', 'STICKS'], i => {
  // @GS   curTab = i; pages.forEach((p, k) => p.classList.toggle('hidden', k !== i));
  // @GS   dev.reportMode(i === 0 ? Rpt.INPUT_RAW : Rpt.INPUT_JOYSTICKS);
  // @GS   pressed.fill(false);
  // @GS });
  gpMode.value = String(MODES.some(m => m[1] === Gamepad.mode(B[Blk.GAMEPAD])) ? Gamepad.mode(B[Blk.GAMEPAD]) : 0);
  editProfile = profileOfMode(+gpMode.value);
  rgbMode.selectedIndex = clamp(Rgb.mode(B[Blk.RGB]), 0, RGB_MODES.length - 1); speed.disabled = rgbMode.selectedIndex < 2;
  speed.value = clamp(Rgb.speed(B[Blk.RGB]), 300, 5000); bright.value = clamp(Math.round(Rgb.brightness(B[Blk.RGB]) * 100 / 4096), 0, 100);
  idle.checked = Rgb.idleGlow(B[Blk.RGB]) !== 0;
  sticks.forEach(s => s.load && s.load());
  refreshCard(); refreshCal(); refreshTrig(); loadGyro(); loadRumble();   // @M
  // @GS refreshCard(); refreshCal();
  say(mismatch ? 'This firmware doesn\'t match this app. Update it with UPDATE FIRMWARE before changing anything.' : 'Changes apply to the PadBox right away. Click SAVE to keep them after unplugging.', mismatch ? 'var(--bad)' : '');

  dev.onFrame = onImu;   // @M
  dev.onRaw = p => {
    // @M{
    if (curTab === TAB_TRIGGER) {
      // the trigger is the focused input: its full value (0..4095, after the firmware's calibration) is in bytes 15-16
      let tv = ((p[15] << 8) | p[16]) & 0x0fff;
      if (tv === 0 && (p[17 + IN_TRIGGER] & 0x7f)) tv = (p[17 + IN_TRIGGER] & 0x7f) << 5;   // focus not taken yet
      trigValue = tv;
    }
    // @M}
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
    if (curTab === TAB_TRIGGER) { const pct = clamp(trigValue / 4095, 0, 1); trigFill.style.width = (pct * 100) + '%'; trigPct.textContent = Math.round(pct * 100) + ' %'; }   // @M
    if (curTab === TAB_GYRO && gyro) gyro.frame();   // @M
  };
  const loop = () => { if (!alive) return; frame(); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  const tick = setInterval(() => { if (!alive) return clearInterval(tick); frame(); }, 200);   // also without animation frames

  return { stop() { alive = false; clearInterval(tick); }, dirty: () => dirty.size > 0 };
}
