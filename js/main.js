// The PadBox web app: the connect screen, and the frame every firmware's app draws into (header, tabs, footer).
// HOJA2 and GP2040-CE are reached with WebUSB, PhobGCC with Web Serial. A PadBox this browser already has
// permission for connects by itself (like the desktop PadBox Suite's detection screen).

import { el, icon, button, esc } from './ui.js';
import { GP_FILTERS, GpUsb, GpDemo } from './gp/device.js';

const HOJA_FILTERS = [
  { vendorId: 0x2e8a, productId: 0x10c6 },   // HOJA2 (SInput / its own identity)
  { vendorId: 0x057e, productId: 0x2009 },   // HOJA2 in Switch mode
  { vendorId: 0x057e, productId: 0x0337 },   // HOJA2 in Slippi mode
  { vendorId: 0x045e, productId: 0x028e },   // HOJA2 in XInput mode
];
// PhobGCC's USB tool mode (the pico-sdk serial port)
const PHOB_FILTERS = [{ usbVendorId: 0x2e8a, usbProductId: 0x000a }];

const APP_VERSION = 6;   // shown on the connect screen, so it's easy to tell which version a phone has (see VERSION in sw.js)
const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
let current = null;   // { app, dev }
let connecting = false;

// ---------------------------------------------------------------- the frame
const shell = {
  header(title, sub) { $('title').textContent = title; $('sub').textContent = sub || ''; document.title = title; },
  status(on) {
    const s = $('status'); s.classList.remove('hidden'); s.classList.toggle('on', on); s.classList.toggle('off', !on);
    s.querySelector('.st').textContent = on ? 'Connected' : 'Not connected';
  },
  actions(nodes) { const a = $('actions'); a.innerHTML = ''; for (const n of nodes || []) a.append(n); },
  tabs(names, onselect) {
    const nav = $('tabs'); nav.innerHTML = ''; nav.classList.toggle('hidden', !names || !names.length);
    const ICON = { CONTROLLER: 'gamepad', STICKS: 'stick', TRIGGER: 'trigger', GYRO: 'gyro', RUMBLE: 'rumble', SETTINGS: 'gear', BACKUP: 'cloud', CALIBRATION: 'target' };
    const btns = (names || []).map((n, i) => {
      const b = el('button', { type: 'button', html: icon(ICON[n]) + `<span>${esc(n)}</span>` });
      b.addEventListener('click', () => select(i));
      nav.append(b);
      return b;
    });
    const select = i => { btns.forEach((b, k) => b.classList.toggle('sel', k === i)); onselect && onselect(i); };
    if (btns.length) select(Math.min(btns.length - 1, +(params.get('tab') || 0)));
    return { select, hide(i, h) { btns[i].classList.toggle('hidden', h); } };
  },
  content(node) { const m = $('main'); m.innerHTML = ''; m.append(node); },
  footer(text) { $('footer').textContent = text || ''; },
  lost(message) { disconnect(message); },
};

async function disconnect(message) {
  const c = current; current = null;
  if (c) { try { c.app && c.app.stop(); } catch (e) { } try { await c.dev.close(); } catch (e) { } }
  showConnect(message);
}

// ---------------------------------------------------------------- the connect screen
function showConnect(problem) {
  shell.header('PadBox Calibrator', 'HOJA2  •  GP2040-CE  •  PhobGCC');
  shell.actions([]); shell.tabs(null); $('status').classList.add('hidden');
  shell.footer('Plug your PadBox into this computer with a USB data cable.   •   web app version ' + APP_VERSION);
  const hasUsb = 'usb' in navigator, hasSerial = 'serial' in navigator;
  const box = el('div.box');
  box.append(el('h1', { text: 'Connect your PadBox' }));
  box.append(el('p.lead', { text: 'Plug it in with a USB data cable, then click CONNECT and pick it in the list the browser shows.' }));
  if (!hasUsb) {
    box.append(el('p.problem.unsupported', { text: 'This browser can\'t talk to USB devices. Open this page in Chrome, Edge or Opera on a computer or an Android phone (Firefox, Safari and iPhone / iPad browsers aren\'t able to).' }));
  }
  const usbBtn = button('CONNECT', { primary: true, cls: 'big', icon: 'usb', disabled: !hasUsb, onclick: () => pickUsb() });
  const serBtn = button('CONNECT', { cls: 'big', icon: 'serial', disabled: !hasSerial, onclick: () => pickSerial() });
  box.append(el('div.choices', {}, [
    el('div.card.choice', {}, [el('h3', { text: 'HOJA2' }), el('p', { text: 'Just plug it in.' })]),
    el('div.card.choice', {}, [el('h3', { text: 'GP2040-CE' }), el('p', { text: 'Hold Start while plugging it in. It shows up as "PadBox (GP2040-CE)".' })]),
    el('div.card.choice', {}, [el('h3', { text: 'PhobGCC' }), el('p', { text: 'Hold Start while plugging it in. It shows up as "PadBox GS Calibrator".' }), serBtn]),
  ]));
  box.querySelectorAll('.choice')[0].append(usbBtn.cloneNode(true));
  box.querySelectorAll('.choice')[0].lastChild.addEventListener('click', () => pickUsb());
  box.querySelectorAll('.choice')[1].append(usbBtn);
  if (problem) box.append(el('p.problem', { text: problem }));
  const scr = el('div.connect', {}, [box]);
  shell.content(scr);
}

async function pickUsb() {
  let d;
  try { d = await navigator.usb.requestDevice({ filters: [...GP_FILTERS, ...HOJA_FILTERS] }); } catch (e) { return; }   // cancelled
  openUsb(d);
}
async function pickSerial() {
  let p;
  try { p = await navigator.serial.requestPort({ filters: PHOB_FILTERS }); } catch (e) { return; }
  openSerial(p);
}

async function openUsb(d) {
  if (connecting || current) return;
  connecting = true;
  try {
    if (d.vendorId === 0xcafe) {
      const dev = new GpUsb(d); await dev.open();
      await run('gp', dev);
    } else {
      const { HojaUsb } = await import('./hoja/device.js');
      const dev = new HojaUsb(d); await dev.open();
      await run('hoja', dev);
    }
  } catch (e) { connecting = false; showConnect(message(e)); try { await d.close(); } catch (x) { } }
  connecting = false;
}
async function openSerial(p) {
  if (connecting || current) return;
  connecting = true;
  try {
    const { PhobSerial } = await import('./phob/device.js');
    const dev = new PhobSerial(p); await dev.open();
    await run('phob', dev);
  } catch (e) { connecting = false; showConnect(message(e)); }
  connecting = false;
}

function message(e) {
  const t = (e && e.message) || String(e);
  if (/access denied|unable to claim|busy/i.test(t)) return 'The PadBox is busy: another program or browser tab is using it (the PadBox Suite, or the HOJA web configurator). Close it, then click CONNECT again.\n(' + t + ')';
  return t;
}

async function run(kind, dev, opts) {
  opts = opts || {};
  const mod = kind === 'gp' ? await import('./gp/app.js') : kind === 'hoja' ? await import('./hoja/app.js') : await import('./phob/app.js');
  const start = mod.startGp || mod.startHoja || mod.startPhob;
  current = { dev, app: null };
  current.app = await start(shell, dev, opts);
}

// ---------------------------------------------------------------- start
navigator.usb && navigator.usb.addEventListener('disconnect', e => { if (current && current.dev.dev === e.device) disconnect('The PadBox was unplugged.'); });
navigator.usb && navigator.usb.addEventListener('connect', e => autoUsb([e.device]));
navigator.serial && navigator.serial.addEventListener('connect', e => autoSerial([e.target]));
window.addEventListener('beforeunload', e => { if (current && current.app && current.app.dirty && current.app.dirty()) { e.preventDefault(); e.returnValue = ''; } });

function autoUsb(list) {
  const d = list.find(x => x.vendorId === 0xcafe || HOJA_FILTERS.some(f => f.vendorId === x.vendorId && f.productId === x.productId));
  if (d && !current && !connecting) openUsb(d);
}
function autoSerial(list) { const p = list[0]; if (p && !current && !connecting) openSerial(p); }

(async () => {
  const demo = params.get('demo');
  // ?demo=gp | hoja | phob, then -platform for a Platform
  if (demo) {
    const platform = demo.includes('platform'), gs = true;
    if (demo.startsWith('gp')) return run('gp', new GpDemo(platform, gs), { demo: true });
    if (demo.startsWith('hoja')) { const { HojaDemo } = await import('./hoja/device.js'); const d = new HojaDemo(platform, gs); await d.open(); return run('hoja', d, { demo: true }); }
    if (demo.startsWith('phob')) { const { PhobDemo } = await import('./phob/device.js'); const d = new PhobDemo('GS Platform'); await d.open(); return run('phob', d, { demo: true }); }
  }
  showConnect();
  try { if (navigator.usb) autoUsb(await navigator.usb.getDevices()); } catch (e) { }
  try { if (navigator.serial && !current) autoSerial(await navigator.serial.getPorts()); } catch (e) { }
})();

// Offline: keep a copy of the app once it's been opened (not on the local test server, where files change constantly)
if ('serviceWorker' in navigator && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') navigator.serviceWorker.register('sw.js').catch(() => { });
