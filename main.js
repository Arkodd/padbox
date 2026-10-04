// Test copy of the web app with the new design (Figma "PadBox Software"): GP2040-CE and HOJA2 on the PadBox GS
// Essential and GS Platform, and PhobGCC on the GS Platform. The page is laid out at the design's own size (1046 x 653)
// and scaled to the window, so it keeps its proportions. ?demo=gp, gp-platform, hoja, hoja-platform or phob tries it
// without a controller. GP2040-CE and HOJA2 are reached with WebUSB, PhobGCC with Web Serial (its USB tool mode).

import { el, icon, button } from './js/ui.js';
import { GP_FILTERS, GpUsb, GpDemo } from './js/gp/device.js';
import { startGp } from './gp-app.js';
import { startHoja } from './hoja-app.js';
import { HojaUsb, HojaDemo } from './js/hoja/device.js';
import { startPhob } from './phob-app.js';
import { PhobSerial, PhobDemo } from './js/phob/device.js';
// PhobGCC's USB tool mode on the PadBox GS (RP2040): the pico-sdk serial port
const PHOB_FILTERS = [{ usbVendorId: 0x2e8a, usbProductId: 0x000a }];

// HOJA2 in each of its USB identities
const HOJA_FILTERS = [
  { vendorId: 0x2e8a, productId: 0x10c6 },   // HOJA2 (SInput / its own identity)
  { vendorId: 0x057e, productId: 0x2009 },   // HOJA2 in Switch mode
  { vendorId: 0x057e, productId: 0x0337 },   // HOJA2 in Slippi mode
  { vendorId: 0x045e, productId: 0x028e },   // HOJA2 in XInput mode
];
const isGp = d => d.vendorId === 0xcafe;
const isHoja = d => HOJA_FILTERS.some(f => f.vendorId === d.vendorId && f.productId === d.productId);
import { dicon } from './icons.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const PAGES = {
  CONTROLLER: ['controller', 'gamepad', 'Assign functions to each button and configure LED lighting'],
  STICKS: ['sticks', 'stick', 'Calibrate the sticks and set their deadzones'],
  SETTINGS: ['settings', 'gear', 'Choose how the buttons and the turbo behave'],
  BACKUP: ['backup', 'cloud', 'Save the controller\'s settings to a file, or load them back'],
  CALIBRATION: ['calibration', 'stick', 'Calibrate the stick notch by notch, with PhobGCC\'s own calibration'],
};
let current = null, connecting = false;


// fit the design's 1046 x 653 frame into the window
function fit() { const s = Math.min(innerWidth / 1046, innerHeight / 653); document.documentElement.style.setProperty('--zoom', s); }
addEventListener('resize', fit); fit();

// Tooltips in the design ("Backup idea.png"): a light grey box with an arrow pointing at the element, below it (above
// it near the bottom of the window). Any element with a title gets one; the title moves to data-tip so the browser
// doesn't show its own as well.
{
  const stage = document.getElementById('stage'), tip = el('div#tip');
  stage.append(tip);
  let on = null;
  const hide = () => { on = null; tip.classList.remove('show'); };
  stage.addEventListener('mouseover', e => {
    const t = e.target.closest && e.target.closest('[title], [data-tip]');
    if (!t || !stage.contains(t) || t === stage) return hide();
    if (t.title) { t.dataset.tip = t.title; t.removeAttribute('title'); }
    if (t === on || !t.dataset.tip) return;
    on = t; tip.textContent = t.dataset.tip;
    const z = parseFloat(getComputedStyle(stage).zoom) || 1, s = stage.getBoundingClientRect(), r = t.getBoundingClientRect();
    const x = (r.left + r.width / 2 - s.left) / z, top = (r.top - s.top) / z, bottom = (r.bottom - s.top) / z;
    tip.classList.add('show');
    const w = tip.offsetWidth, h = tip.offsetHeight, above = bottom + 8 + h > stage.clientHeight - 4;
    const left = Math.max(4, Math.min(stage.clientWidth - w - 4, x - w / 2));
    tip.classList.toggle('above', above);
    tip.style.left = left + 'px'; tip.style.top = (above ? top - 8 - h : bottom + 8) + 'px';
    tip.style.setProperty('--ax', (x - left) + 'px');
  });
  stage.addEventListener('mouseleave', hide);
  stage.addEventListener('mousedown', hide);
}

const shell = {
  header(title, board) { $('title').textContent = title; $('board').textContent = board || ''; $('who').classList.remove('hidden'); },
  status(on) { $('who').classList.toggle('off', !on); $('state').textContent = on ? 'Connected' : 'Not connected'; },
  actions(nodes) { const a = $('actions'); a.innerHTML = ''; for (const n of nodes || []) a.append(n); },
  // subs: optional subtitles that replace PAGES' ({ SETTINGS: '...' })
  tabs(names, onselect, subs) {
    const nav = $('nav'); nav.innerHTML = ''; nav.classList.toggle('hidden', !names);
    $('heading').classList.toggle('hidden', !names);
    if (!names) return;
    const btns = names.map((n, i) => {
      const b = el('button', { type: 'button', title: n.charAt(0) + n.slice(1).toLowerCase(), html: dicon(PAGES[n][1]) });
      b.addEventListener('click', () => select(i));
      nav.append(b);
      return b;
    });
    const select = i => {
      btns.forEach((b, k) => b.classList.toggle('sel', k === i));
      $('h1').textContent = names[i]; $('h2').textContent = (subs && subs[names[i]]) || PAGES[names[i]][2];
      document.body.dataset.page = PAGES[names[i]][0];
      onselect && onselect(i);
    };
    select(Math.min(btns.length - 1, +(params.get('tab') || 0)));
    return { select };
  },
  content(node) { const m = $('main'); m.innerHTML = ''; m.append(node); },
  footer(text, color) { const m = $('msg'); m.textContent = text || ''; m.style.color = color || ''; },
  lost(message) { disconnect(message); },
};

// after a firmware update: back to the connect screen (js/update.js sends this once the install is done)
addEventListener('padbox-updated', e => disconnect(e.detail.message));

async function disconnect(message) {
  const c = current; current = null;
  if (c) { try { c.app && c.app.stop(); } catch (e) { } try { await c.dev.close(); } catch (e) { } }
  showConnect(message);
}

function showConnect(problem) {
  $('who').classList.add('hidden'); shell.actions([]); shell.tabs(null); shell.footer('');
  document.body.dataset.page = 'connect';
  const btn = button('CONNECT', { primary: true, cls: 'big', icon: 'usb', disabled: !navigator.usb, onclick: pick });
  const serBtn = button('CONNECT PHOBGCC', { cls: 'big', icon: 'serial', disabled: !navigator.serial, onclick: pickSerial });
  shell.content(el('div.connect2', {}, [
    el('h1', { text: 'CONNECT' }),
    el('p', { text: 'Plug the PadBox GS in with a USB data cable (for GP2040-CE, hold Start while plugging it in), then click CONNECT and choose it in the list. PhobGCC (GS Platform): hold Start while plugging it in, then click CONNECT PHOBGCC and choose "PadBox GS Calibrator".' }),
    el('div.connect-btns', {}, [btn, serBtn]),
    el('p.demo', { html: 'No controller at hand? Try the demo: GP2040-CE on the <a href="?demo=gp">GS Essential</a> or <a href="?demo=gp-platform">GS Platform</a>, HOJA2 on the <a href="?demo=hoja-platform">GS Platform</a>, PhobGCC on the <a href="?demo=phob">GS Platform</a>' }),
    problem ? el('p.problem' + (/^Updated to /.test(problem) ? '.good' : ''), { text: problem }) : null,   // after an update: in green
  ]));
}

async function pick() {
  let d;
  try { d = await navigator.usb.requestDevice({ filters: [...GP_FILTERS, ...HOJA_FILTERS] }); } catch (e) { return; }
  open(d);
}
async function pickSerial() {
  let p;
  try { p = await navigator.serial.requestPort({ filters: PHOB_FILTERS }); } catch (e) { return; }
  openSerial(p);
}
async function openSerial(p) {
  if (connecting || current) return;
  connecting = true;
  try { const dev = new PhobSerial(p); await dev.open(); await run(dev, startPhob); }
  catch (e) { showConnect(/busy|in use|failed to open/i.test((e && e.message) || '') ? 'The PadBox is busy: another program or browser tab is using its serial port (the PadBox Suite, or another PadBox Calibrator tab). Close it, then click CONNECT PHOBGCC again.' : (e && e.message) || String(e)); }
  connecting = false;
}
async function open(d) {
  if (connecting || current) return;
  connecting = true;
  try {
    if (isGp(d)) { const dev = new GpUsb(d); await dev.open(); await run(dev, startGp); }
    else { const dev = new HojaUsb(d); await dev.open(); await run(dev, startHoja); }
  }
  catch (e) {
    const t = (e && e.message) || String(e);
    // only one program or tab can use the PadBox at a time
    showConnect(/unable to claim|access denied|busy/i.test(t)
      ? 'The PadBox is busy: another browser tab or program is using it (another PadBox Calibrator tab, the public site, or the PadBox Suite). Close it, then click CONNECT again.'
      : t);
    try { await d.close(); } catch (x) { }
  }
  connecting = false;
}
async function run(dev, start, opts) {
  current = { dev, app: null };
  current.app = await start(shell, dev, opts || {});
}

navigator.usb && navigator.usb.addEventListener('disconnect', e => { if (current && current.dev.dev === e.device) disconnect('The PadBox was unplugged.'); });
navigator.usb && navigator.usb.addEventListener('connect', e => { if ((isGp(e.device) || isHoja(e.device)) && !current) open(e.device); });
navigator.serial && navigator.serial.addEventListener('connect', e => { if (!current && !connecting) openSerial(e.target); });
addEventListener('beforeunload', e => { if (current && current.app && current.app.dirty && current.app.dirty()) { e.preventDefault(); e.returnValue = ''; } });

(async () => {
  const demo = params.get('demo');   // ?demo=gp, gp-platform, hoja, hoja-platform or phob
  if (demo && demo.startsWith('phob')) { const d = new PhobDemo('GS Platform'); await d.open(); return run(d, startPhob, { demo: true }); }
  if (demo && demo.startsWith('hoja')) { const d = new HojaDemo(true, true); await d.open(); return run(d, startHoja, { demo: true }); }
  if (demo) return run(new GpDemo(demo.includes('platform'), true), startGp, { demo: true });
  showConnect();
  try { const list = navigator.usb ? await navigator.usb.getDevices() : []; const d = list.find(x => isGp(x) || isHoja(x)); if (d) open(d); } catch (e) { }
  try { if (navigator.serial && !current && !connecting) { const ports = await navigator.serial.getPorts(); if (ports[0]) openSerial(ports[0]); } } catch (e) { }
})();
// the offline copy (sw.js, at the site's root once published); not on a local test server
if ('serviceWorker' in navigator && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') navigator.serviceWorker.register('sw.js').catch(() => { });
