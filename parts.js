// The redesign's building blocks (GS Essential Redesign: "PadBox GP2040 Essential.pdf" and "PadBox HOJA2 Essential.pdf"),
// shared by gp-app.js and hoja-app.js: the bordered panels and their controls, the STICKS page's gate, the TURBO
// panel's button list, and the BACKUP & RESTORE page with its backup history.

import { el, button, dialog, confirmBox, download, openFile } from './js/ui.js';
import { dicon } from './icons.js';
import { famName, padboxName } from './js/update.js';

export function panel(title, kids, cls) { return el('div.panel' + (cls ? '.' + cls : ''), {}, [el('div.ptitle', {}, [el('span.pt', { text: title })]), ...kids]); }

// a switch; offText: its caption while off, when it reads as a state ("Enabled" / "Disabled")
export function dtoggle(text, onchange, offText) {
  const input = el('input', { type: 'checkbox' }), cap = el('span', { text });
  const lab = el('label.dtoggle', {}, [input, el('i'), cap]);
  const paint = () => { if (offText) cap.textContent = input.checked ? text : offText; };
  input.addEventListener('change', () => { paint(); onchange(input.checked); });
  return { el: lab, get checked() { return input.checked; }, set checked(v) { input.checked = !!v; paint(); },
    set disabled(v) { input.disabled = !!v; lab.classList.toggle('off', !!v); } };
}

export function dslider(caption, min, max, fmt, onchange) {
  const val = el('span'), input = el('input.range', { type: 'range', min, max, step: 1 });
  const paint = () => { const v = +input.value; val.textContent = fmt ? fmt(v) : String(v); input.style.setProperty('--p', (max > min ? (v - min) / (max - min) * 100 : 0) + '%'); };
  input.addEventListener('input', () => { paint(); onchange(+input.value); });
  const wrap = el('div.dslider', {}, [el('div.lbl.split', {}, [el('span', { text: caption }), val]), input]);
  return { el: wrap, get value() { return +input.value; }, set value(v) { input.value = v; paint(); },
    set disabled(v) { input.disabled = !!v; wrap.classList.toggle('off', !!v); } };
}

export function pbtn(text, ic, primary, onclick) {
  const b = el('button.pbtn.' + (primary ? 'primary' : 'outline'), { type: 'button', html: (ic ? dicon(ic) : '') + '<span>' + text + '</span>' });
  b.addEventListener('click', onclick);
  return b;
}
export const setPbtn = (b, text, ic) => { b.innerHTML = (ic ? dicon(ic) : '') + '<span>' + text + '</span>'; };

// two choices side by side, the chosen one light ("Round Gate | Octagonal Gate")
export function segmented(labels, onchange) {
  let value = 0, locked = false;
  const btns = labels.map((t, i) => { const b = el('button', { type: 'button', text: t }); b.addEventListener('click', () => { if (locked || value === i) return; set(i); onchange(i); }); return b; });
  const wrap = el('div.seg', {}, btns);
  const set = i => { value = i; btns.forEach((b, k) => b.classList.toggle('on', k === i)); };
  set(0);
  return { el: wrap, get value() { return value; }, set value(i) { set(i); },
    lock(on, why) { locked = !!on; wrap.classList.toggle('locked', locked); wrap.title = on ? why || '' : ''; } };
}

// the small colored tag beside a stick's name: Not calibrated (red), Calibrated (green), Calibrating (orange)
export function badge() {
  const b = el('span.badge');
  const TEXT = { no: 'Not calibrated', ok: 'Calibrated', busy: 'Calibrating' };
  return { el: b, set(kind) { b.className = 'badge ' + kind + (b.classList.contains('hidden') ? ' hidden' : ''); b.textContent = TEXT[kind] || kind; } };
}

// The STICKS page's gate, as in the design: the gate's outline with its 8 spokes, the inner deadzone as a circle with
// an orange glow inside, the stick's output as an orange dot in a light ring (o.raw: the raw reading's ring, apart from
// the dot), greyed out when the stick is off. o: { round, din 0..1, dout 0..1 (1 = none), out [x, y], raw [x, y] or null,
// trail [[x, y]...], gate: the gate's color, ref: draw a dashed reference circle, off }
export function paintGate(cv, o) {
  const r = cv.getBoundingClientRect(), z = parseFloat(getComputedStyle(document.getElementById('stage')).zoom) || 1, dpr = (window.devicePixelRatio || 1) * z;
  const W = r.width / z; if (!W) return;
  if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(W * dpr); }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, W);
  const c = W / 2, R = W / 2 - 3, orange = o.off ? '#7a7a7a' : '#fe6805';
  const shape = (rad, round) => { g.beginPath(); if (round) g.arc(c, c, rad, 0, Math.PI * 2); else { for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; g[i ? 'lineTo' : 'moveTo'](c + rad * Math.cos(a), c - rad * Math.sin(a)); } g.closePath(); } };
  // inner deadzone: the glow, then its circle
  const din = Math.max(o.din || 0, 0.001), rin = R * din;
  if (din > 0.01) {
    const grad = g.createRadialGradient(c, c, 0, c, c, rin);
    grad.addColorStop(0, o.off ? 'rgba(150,150,150,.16)' : 'rgba(254,104,5,.2)'); grad.addColorStop(1, o.off ? 'rgba(150,150,150,.03)' : 'rgba(254,104,5,.04)');
    g.fillStyle = grad; g.beginPath(); g.arc(c, c, rin, 0, Math.PI * 2); g.fill();
  }
  // outer deadzone (the stick reaches 100% this far out), drawn like the inner one: the same glow, in the ring between
  // it and the gate's edge (strongest at the edge), then the same circle
  const dout = o.dout != null && o.dout < 0.995 ? Math.max(o.dout, 0) : 1, rout = R * dout;
  if (dout < 1) {
    const grad = g.createRadialGradient(c, c, rout, c, c, R);
    grad.addColorStop(0, o.off ? 'rgba(150,150,150,.03)' : 'rgba(254,104,5,.04)'); grad.addColorStop(1, o.off ? 'rgba(150,150,150,.16)' : 'rgba(254,104,5,.2)');
    g.fillStyle = grad; g.beginPath(); g.arc(c, c, R, 0, Math.PI * 2); g.arc(c, c, rout, 0, Math.PI * 2, true); g.fill('evenodd');
  }
  g.lineWidth = 1; g.strokeStyle = '#4a4a4a';
  for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; g.beginPath(); g.moveTo(c, c); g.lineTo(c + Math.cos(a) * R, c - Math.sin(a) * R); g.stroke(); }
  if (din > 0.01) { g.strokeStyle = '#5a5a5a'; g.beginPath(); g.arc(c, c, rin, 0, Math.PI * 2); g.stroke(); }
  if (dout < 1) { g.strokeStyle = '#5a5a5a'; g.beginPath(); g.arc(c, c, rout, 0, Math.PI * 2); g.stroke(); }
  if (o.ref) { g.setLineDash([3, 2.5]); g.lineWidth = 1; g.strokeStyle = '#b5b5b5'; shape(R, true); g.stroke(); g.setLineDash([]); }
  g.lineWidth = o.ref ? 1.3 : 1; g.lineJoin = 'round'; g.strokeStyle = o.off ? '#5c5c5c' : o.gate || '#666666'; shape(o.ref ? R - 1.5 : R, o.round); g.stroke();
  (o.trail || []).forEach(([x, y], i, t) => { g.fillStyle = `rgba(40,166,255,${(26 + 150 * i / Math.max(1, t.length - 1)) / 255})`; g.fillRect(c + x * R - 1, c - y * R - 1, 2, 2); });
  const place = ([x, y]) => { const m = Math.hypot(x, y); if (m > 1) { x /= m; y /= m; } return [c + x * R, c - y * R]; };
  const [ox, oy] = place(o.out || [0, 0]), [rx, ry] = place(o.raw || o.out || [0, 0]);
  g.beginPath(); g.arc(rx, ry, 6, 0, Math.PI * 2); g.lineWidth = 1; g.strokeStyle = o.off ? '#8a8a8a' : '#e6e6e6'; g.stroke();
  g.beginPath(); g.arc(ox, oy, 4, 0, Math.PI * 2); g.fillStyle = orange; g.fill();
}
// the reading under the gate: "x : 58%   y : 15%" and the angle, or "Centered"
export function readout(x, y) {
  const mag = Math.hypot(x, y); let a = Math.atan2(y, x) * 180 / Math.PI; if (a < 0) a += 360;
  return { xy: `x : ${Math.round(x * 100)}%     y : ${Math.round(y * 100)}%`, angle: mag > 0.05 ? Math.round(a) + '°' : '', centered: mag <= 0.05 };
}

// A dropdown of check boxes ("Assigned Buttons"): items [{ value, text }]; shows the chosen ones, or the placeholder
export function multiSelect(placeholder, items, onchange) {
  let chosen = new Set();
  const txt = el('span.ms-txt'), field = el('button.field.ms', { type: 'button' }, [txt]);
  const list = el('div.ms-list.hidden', {}, items.map(it => {
    const input = el('input', { type: 'checkbox', value: it.value });
    input.addEventListener('change', () => { if (input.checked) chosen.add(it.value); else chosen.delete(it.value); paint(); onchange([...chosen]); });
    return el('label', {}, [input, el('span', { text: it.text })]);
  }));
  const wrap = el('div.ms-wrap', {}, [field, list]);
  const paint = () => {
    const names = items.filter(it => chosen.has(it.value)).map(it => it.short || it.text);
    txt.textContent = names.length ? names.join(', ') : placeholder; field.classList.toggle('empty', !names.length);
    list.querySelectorAll('input').forEach(i => { i.checked = chosen.has(+i.value) || chosen.has(i.value); });
  };
  field.addEventListener('click', () => list.classList.toggle('hidden'));
  addEventListener('mousedown', e => { if (!wrap.contains(e.target)) list.classList.add('hidden'); });
  paint();
  return { el: wrap, get value() { return [...chosen]; }, set value(v) { chosen = new Set(v); paint(); } };
}

// ---------------------------------------------------------------- BACKUP & RESTORE
// CONFIGURATION FILES: export (named, then downloaded) and import; BACKUP HISTORY: every export made in this browser
// (kept in its storage, with the settings themselves), to restore, rename or delete. A backup only goes back onto the
// same firmware and board it came from.
// o: { controller: 'GP2040-CE', 'HOJA2' or 'PhobGCC', board: 'GS Essential', firmware: 'v0.7.12', mode: () => the mode or profile in use,
//      exportData: async () => object, fileName: name => file name, check: object => problem text or '',
//      restore: async object => message (throws on failure) }
const STORE = 'padbox-backup-history';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const niceDate = d => { d = new Date(d); const p = n => String(n).padStart(2, '0'); return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${p(d.getHours())}:${p(d.getMinutes())}`; };
function loadHistory() { try { const h = JSON.parse(localStorage.getItem(STORE) || '[]'); return Array.isArray(h) ? h : []; } catch (e) { return []; } }
function saveHistory(h) { try { localStorage.setItem(STORE, JSON.stringify(h)); return true; } catch (e) { return false; } }

// The design's name window ("EDIT BACKUP", Figma PadBox GS Platform): a panel in the middle of the frame over the page,
// dimmed and blurred; its text, the name field, then Cancel and the orange button. Resolves to the name, or null.
function askName(title, text, value, ok) {
  return new Promise(res => {
    const stage = document.getElementById('stage');
    const input = el('input.field.dm-in', { type: 'text', value, maxlength: 40, spellcheck: 'false' });
    const cancel = el('button.pbtn.outline', { type: 'button', html: '<i class="dm-x">×</i><span>Cancel</span>' });
    const go = el('button.pbtn.primary', { type: 'button', html: dicon('check') + '<span>' + ok + '</span>' });
    const box = el('div.panel.dmodal', { role: 'dialog', 'aria-label': title }, [el('div.ptitle', { text: title }), el('p.dm-t', { text }), input, el('div.dm-btns', {}, [cancel, go])]);
    const back = el('div.dm-back', {}, [box]);
    const done = v => { back.remove(); removeEventListener('keydown', key, true); res(v); };
    const key = e => { if (e.key === 'Escape') { e.preventDefault(); done(null); } };
    cancel.addEventListener('click', () => done(null));
    go.addEventListener('click', () => done(input.value.trim() || value));
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); done(input.value.trim() || value); } });
    back.addEventListener('mousedown', e => { if (e.target === back) done(null); });
    addEventListener('keydown', key, true);
    stage.append(back);
    setTimeout(() => { input.focus(); input.select(); }, 30);
  });
}

export function backupPage(o) {
  const last = el('p.text.last'), status = el('p.hint.wrap');
  const say = (t, color) => { status.textContent = t || ''; status.style.color = color || ''; };
  const rows = el('tbody');
  const mine = e => e.controller === o.controller && e.board === o.board;
  function paint() {
    const h = loadHistory();
    const newest = h.slice().sort((a, b) => b.created.localeCompare(a.created))[0];
    last.innerHTML = '';
    if (newest) last.append('Your last backup was successfully saved as ', el('b', { text: newest.name }), ' on ', el('b', { text: niceDate(newest.created) }), '.');
    else last.append('No backup saved from this browser yet. Export one to keep a copy of your settings.');
    rows.innerHTML = '';
    if (!h.length) rows.append(el('tr.none', {}, [el('td', { colspan: 8, text: 'Your backups will be listed here.' })]));
    for (const e of h.slice().sort((a, b) => b.created.localeCompare(a.created))) {
      const ok = mine(e);
      const act = (ic, title, cls, fn, off) => { const b = el('button.ia.' + cls, { type: 'button', title, html: dicon(ic) }); b.disabled = !!off; b.addEventListener('click', fn); return b; };
      // the design's row: name to status, then rename and delete; clicking the row restores it (if it's from this PadBox)
      const tr = el('tr' + (ok ? '.can' : ''), { title: ok ? 'Click to restore this backup onto the controller' : '' }, [
        el('td.nm', { text: e.name }), el('td', { text: e.mode || (e.profiles != null ? e.profiles + (e.profiles === 1 ? ' profile' : ' profiles') : '') }), el('td', { text: niceDate(e.created) }),
        el('td', { text: (e.size / 1024).toFixed(2) + ' Kb' }), el('td', { text: famName(e.controller) }), el('td', { text: e.firmware || '' }),
        el('td.' + (ok ? 'valid' : 'other'), { text: ok ? 'Valid' : 'Other PadBox', title: ok ? '' : 'Made on a' + (/^E2T /.test(e.board) ? 'n ' : ' ') + padboxName(e.board) + ' with ' + famName(e.controller) + ': it can only go back onto that one.' }),
        el('td.acts', {}, [
          act('pencil', 'Rename', 'ed', ev => { ev.stopPropagation(); rename(e); }),
          act('trash', 'Delete', 'del', ev => { ev.stopPropagation(); remove(e); }),
        ]),
      ]);
      if (ok) tr.addEventListener('click', () => restoreFrom(e));
      rows.append(tr);
    }
  }
  async function exportNow() {
    const n = loadHistory().filter(mine).length + 1;
    const name = await askName('EXPORT CONFIGURATION', 'Name this backup to find it in your Backup history', 'Backup ' + n, 'Export'); if (!name) return;
    say('Exporting...', 'var(--warn)');
    let data; try { data = await o.exportData(); } catch (e) { return say('Export failed: ' + e.message, 'var(--bad)'); }
    const text = JSON.stringify(data, null, 1);
    download(o.fileName(name), text);
    const h = loadHistory();
    h.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, created: new Date().toISOString(), size: new Blob([text]).size,
      controller: o.controller, board: o.board, firmware: o.firmware, mode: o.mode(), data: text });
    while (h.length > 30) h.shift();   // the browser keeps a few MB per site: the 30 newest
    const kept = saveHistory(h);
    paint();
    say(kept ? 'Saved to your downloads and to the backup history.' : 'Saved to your downloads. The browser\'s storage is full, so it isn\'t in the history: delete old backups to make room.', kept ? 'var(--good)' : 'var(--warn)');
  }
  async function restoreData(data, what) {
    const problem = o.check(data); if (problem) return say(problem, 'var(--bad)');
    if (!await confirmBox('Restore configuration', 'This replaces every setting on the controller with ' + what + '. Continue?', 'RESTORE')) return;
    say('Restoring...', 'var(--warn)');
    try { say(await o.restore(data), 'var(--good)'); } catch (e) { say('Restoring failed: ' + e.message, 'var(--bad)'); }
  }
  async function importNow() {
    const text = await openFile('.json,application/json'); if (!text) return;
    let data; try { data = JSON.parse(text); } catch (e) { return say('This file isn\'t a PadBox configuration file.', 'var(--bad)'); }
    restoreData(data, 'the ones in this file');
  }
  async function restoreFrom(e) {
    let data; try { data = JSON.parse(e.data); } catch (x) { return say('This backup is damaged.', 'var(--bad)'); }
    restoreData(data, 'the backup "' + e.name + '" from ' + niceDate(e.created));
  }
  async function rename(e) {
    const name = await askName('EDIT BACKUP', 'Enter a new name to find this backup in your Backup history', e.name, 'Save'); if (!name) return;
    const h = loadHistory(), x = h.find(y => y.id === e.id); if (x) { x.name = name; saveHistory(h); }
    paint();
  }
  async function remove(e) {
    if (!await confirmBox('Delete backup', 'Remove "' + e.name + '" from the backup history? A file you downloaded stays where it is.', 'DELETE')) return;
    saveHistory(loadHistory().filter(y => y.id !== e.id)); paint();
  }
  const head = el('thead', {}, [el('tr', {}, ['Name', o.modeTitle || 'Mode', 'Date', 'Size', 'Controller', 'Firmware', 'Status', ''].map(t => el('th', { text: t })))]);
  const cols = el('colgroup', {}, [122.58, 71.91, 120.13, 76.81, 99.7, 90.71, 68.63, null].map(w => el('col', w ? { style: { width: w + 'px' } } : {})));
  const page = el('div.page.hidden.dpage.backup', {}, [
    panel('CONFIGURATION FILES', [last, el('div.btnrow', {}, [pbtn('Export configuration to file', 'dl-small', false, exportNow), pbtn('Import configuration from file', 'ul-small', true, importNow)]), status]),
    panel('BACKUP HISTORY', [el('p.text', { text: 'View previously saved configurations and restore a previous setup' }), el('div.tbl', {}, [el('table.hist', {}, [cols, head, rows])])]),
  ]);
  paint();
  return { page, say };
}

// A notice at the top right that goes away by itself ("Calibration complete" in the GS Platform design)
export function toast(title, text, kind) {
  const stage = document.getElementById('stage');
  for (const old of stage.querySelectorAll('.toast')) old.remove();
  const close = el('button.toast-x', { type: 'button', text: '×', title: 'Close' });
  const t = el('div.toast.' + (kind || 'good'), {}, [el('i.toast-ic', { html: dicon('check') }), el('div', {}, [el('div.toast-t', { text: title }), el('div.toast-d', { text })]), close]);
  close.addEventListener('click', () => t.remove());
  stage.append(t);
  setTimeout(() => t.remove(), 7000);
}

// ---------------------------------------------------------------- "a new firmware is available"
// firmware/versions.json (tools/firmware-versions.js) has the build of each firmware file this site ships. When the
// connected controller's build is older (or it has none: firmware from before builds were numbered), the update button
// gets a red dot and a notice at the top right offers to update now. o: { board: 'GS Essential', family: 'HOJA2',
// build: the controller's build (0 = unknown), button: the header's update button, open: () => opens the updater }
export async function updateNotice(o) {
  let latest = 0;
  try {
    const r = await fetch('./firmware/versions.json', { cache: 'no-store' });
    if (r.ok) latest = +(await r.json())[padboxName(o.board) + ' - ' + o.family] || 0;
  } catch (e) { }
  if (!latest || (o.build && o.build >= latest)) return false;
  o.button.classList.add('has-update');
  o.button.title = 'A firmware update is available - click to install it';
  const stage = document.getElementById('stage');
  for (const old of stage.querySelectorAll('.update-note')) old.remove();
  const when = d => { const x = new Date(d * 1000); return x.getDate() + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][x.getMonth()] + ' ' + x.getFullYear(); };
  const later = el('button.pbtn.outline', { type: 'button', html: '<span>Later</span>' });
  const now = el('button.pbtn.primary', { type: 'button', html: dicon('download') + '<span>Update now</span>' });
  const note = el('div.update-note', {}, [
    el('div.un-head', {}, [el('i.un-ic', { html: dicon('download') }), el('div.un-t', { text: 'Firmware update available' })]),
    el('div.un-d', { text: 'A newer ' + famName(o.family) + ' firmware (' + when(latest) + ') is available for your ' + padboxName(o.board) + '. Update it to get the latest fixes and features.' }),
    el('div.btnrow', {}, [later, now]),
  ]);
  later.addEventListener('click', () => note.remove());
  now.addEventListener('click', () => { note.remove(); o.open(); });
  stage.append(note);
  // the arrow at the top points at the update button
  const z = parseFloat(getComputedStyle(stage).zoom) || 1, s = stage.getBoundingClientRect(), b = o.button.getBoundingClientRect();
  note.style.setProperty('--un-ax', Math.max(8, (s.right - (b.left + b.width / 2)) / z - 12 - 6) + 'px');
  return true;
}
