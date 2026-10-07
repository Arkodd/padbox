// Test copy of the web app with the new design (Figma "PadBox Software"): GP2040-CE and HOJA2 on the PadBox GS
// Essential and GS Platform, and PhobGCC on the GS Platform. The page is laid out at the design's own size (1046 x 653)
// and scaled to the window, so it keeps its proportions. ?demo=gp, gp-platform, hoja-essential, hoja-platform or phob tries it
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
import { legacyUpdate } from './js/legacy-update.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const PAGES = {
  CONTROLLER: ['controller', 'nav-gamepad', 'Assign functions to each button and configure LED lighting'],
  STICKS: ['sticks', 'nav-stick', 'Calibrate stick input and adjust deadzones and stick behavior'],
  SETTINGS: ['settings', 'nav-gear', 'Manage Turbo mode and other advanced controller settings'],
  'BACKUP & RESTORE': ['backup', 'nav-cloud', 'Export your controller configuration or import a saved configuration file'],
  SNAPBACK: ['snapback', 'snap', 'Tune the snapback filter and see how the stick settles when you let it go'],
  CALIBRATION: ['calibration', 'nav-stick', 'Calibrate the stick notch by notch, with PhobGCC\'s own calibration'],
  TRIGGER: ['trigger', 'trigger', 'Calibrate the analog trigger\'s range'],   // @M
  GYRO: ['gyro', 'gyro', 'See the motion sensor live and set its sensitivity'],   // @M
  RUMBLE: ['rumble', 'rumble', 'Turn the rumble on or off and set its strength'],   // @M
};
let current = null, connecting = false;


// the Arkodd logo as the design draws it (vector, from its pages)
{ const img = document.querySelector('#head .logo'); if (img) { const t = document.createElement('template'); t.innerHTML = dicon('logo', 'logo'); t.content.firstChild.setAttribute('aria-label', 'Arkodd'); img.replaceWith(t.content.firstChild); } }

// fit the design's 1046 x 653 frame into the window
// (the visual viewport: on a phone, innerWidth can be the wider layout the browser falls back to, not the screen)
function fit() { const v = window.visualViewport, w = v ? v.width * v.scale : innerWidth, h = v ? v.height * v.scale : innerHeight; document.documentElement.style.setProperty('--zoom', Math.min(w / 1046, h / 653)); }
addEventListener('resize', fit); if (window.visualViewport) visualViewport.addEventListener('resize', fit); fit();

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

// the side menu's flyout (HOJA2's modes): a list beside the button, closed by any click elsewhere
let flyout = null, subOver = {}, curName = '';
function closeMenu() { if (flyout) { flyout.remove(); flyout = null; } }
function openMenu(btn, i, items) {
  closeMenu();
  flyout = el('div.flyout', { 'data-i': String(i) }, items().map(it => {
    const b = el('button' + (it.sel ? '.sel' : ''), { type: 'button', text: it.text });
    b.addEventListener('click', e => { e.stopPropagation(); closeMenu(); it.pick(); });
    return b;
  }));
  // level with the button (the side menu is centred with a transform, so measured on screen, in the frame's units)
  const z = parseFloat(getComputedStyle($('stage')).zoom) || 1;
  flyout.style.top = ((btn.getBoundingClientRect().top - $('stage').getBoundingClientRect().top) / z) + 'px';
  $('stage').append(flyout);
}
addEventListener('mousedown', e => { if (flyout && !flyout.contains(e.target) && !(e.target.closest && e.target.closest('#nav .has-menu'))) closeMenu(); });

// the owner's guide (guide/ on the same site): opens in a new tab
const GUIDE = 'https://arkodd.github.io/padbox/guide/';
const guideBtn = () => el('a.act.outline.guide', { href: GUIDE, target: '_blank', rel: 'noopener', title: 'Owner\'s guide: how to use your PadBox and this page', html: dicon('help') });

const shell = {
  // board: written as the design does ("PadBoxEssential"); more: the firmware version and such, shown on hover
  header(title, board, more) { $('title').textContent = title; $('board').textContent = board || ''; $('who').title = more || ''; $('who').classList.remove('hidden'); },
  status(on) { $('who').classList.toggle('off', !on); $('state').textContent = on ? 'Connected' : 'Not connected'; },
  actions(nodes) { const a = $('actions'); a.innerHTML = ''; a.append(guideBtn()); for (const n of nodes || []) a.append(n); },
  // subs: optional subtitles that replace PAGES' ({ SETTINGS: '...' }); menus: a flyout menu beside a side-menu button
  // ({ 0: () => [{ text, sel, pick }] }, as HOJA2's controller modes in the redesign): clicking the button opens it
  tabs(names, onselect, subs, menus) {
    const nav = $('nav'); nav.innerHTML = ''; nav.classList.toggle('hidden', !names);
    $('heading').classList.toggle('hidden', !names);
    if (!names) return;
    closeMenu(); subOver = {};
    const btns = names.map((n, i) => {
      // a button with a menu (HOJA2's modes): the design's own icon for it, the gamepad moved left with an arrow beside it
      const ic = menus && menus[i] && PAGES[n][1] === 'nav-gamepad' ? 'nav-gamepad-menu' : PAGES[n][1];
      const b = el('button', { type: 'button', title: n.charAt(0) + n.slice(1).toLowerCase(), html: dicon(ic) });
      if (menus && menus[i]) b.classList.add('has-menu');
      b.addEventListener('click', () => { const was = !!flyout && flyout.dataset.i === String(i); select(i); if (menus && menus[i] && !was) openMenu(b, i, menus[i]); });
      nav.append(b);
      return b;
    });
    const select = i => {
      btns.forEach((b, k) => b.classList.toggle('sel', k === i));
      closeMenu();
      curName = names[i]; $('h1').textContent = names[i]; paintSub();
      document.body.dataset.page = PAGES[names[i]][0];
      onselect && onselect(i);
    };
    const paintSub = () => { const o = subOver[curName]; if (o) { $('h2').innerHTML = ''; $('h2').append(o); } else $('h2').textContent = (subs && subs[curName]) || PAGES[curName][2]; };
    shell.sub = (name, node) => { subOver[name] = node; if (name === curName) paintSub(); };
    select(Math.min(btns.length - 1, +(params.get('tab') || 0)));
    return { select };
  },
  // a page's subtitle replaced by a node (HOJA2: "... in Switch Pro mode", the mode in its color); set up by tabs()
  sub() { },
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
  // a PadBox still on the firmware it shipped with (from before this app): install the latest without opening it
  const oldBtn = button('UPDATE AN OLDER PADBOX', { cls: 'big', icon: 'download', onclick: () => legacyUpdate() });
  shell.content(el('div.connect2', {}, [
    el('h1', { text: 'CONNECT' }),
    el('p', { text: 'Plug the PadBox GS in with a USB data cable (for GP2040-CE, hold Start while plugging it in), then click CONNECT and choose it in the list. PhobGCC (GS Platform): hold Start while plugging it in, then click CONNECT PHOBGCC and choose "PadBox GS Configurator" ("PadBox GS Calibrator" on older PhobGCC firmware).' }),
    el('div.connect-btns', {}, [btn, serBtn, oldBtn]),
    el('p.guide', {}, ['New to the PadBox? Read the ', el('a', { href: GUIDE, target: '_blank', rel: 'noopener', text: 'PadBox GS owner\'s guide' }), ': the buttons, the console modes, and how to use this page.']),
    el('p.old', { text: 'Your PadBox won’t connect, or still has the firmware it came with (HOJA "Padbox GS-C", GP2040-CE 0.8 or the original PhobGCC)? Click UPDATE AN OLDER PADBOX: it installs the latest firmware without opening the controller.' }),
    el('p.demo', { html: 'No controller at hand? Try the demo: GP2040-CE on the <a href="?demo=gp">GS Essential</a> or <a href="?demo=gp-platform">GS Platform</a>, HOJA on the <a href="?demo=hoja-essential">GS Essential</a> or <a href="?demo=hoja-platform">GS Platform</a>, PhobGCC on the <a href="?demo=phob">GS Platform</a>' }),
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
  catch (e) { showConnect(/busy|in use|failed to open/i.test((e && e.message) || '') ? 'The PadBox is busy: another program or browser tab is using its serial port (the PadBox Suite, or another PadBox Configurator tab). Close it, then click CONNECT PHOBGCC again.' : (e && e.message) || String(e)); }
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
    // a PadBox on its original firmware: straight to "Update an older PadBox"
    if (e && e.legacy) { try { await d.close(); } catch (x) { } current = null; connecting = false; showConnect(t); legacyUpdate({ now: e.legacy }); return; }
    // only one program or tab can use the PadBox at a time
    showConnect(/unable to claim|access denied|busy/i.test(t)
      ? 'The PadBox is busy: another browser tab or program is using it (another PadBox Configurator tab, the public site, or the PadBox Suite). Close it, then click CONNECT again.'
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
  const demo = params.get('demo');   // ?demo=gp, gp-platform, hoja-essential, hoja-platform or phob
  if (demo && demo.startsWith('phob')) { const d = new PhobDemo('GS Platform'); await d.open(); return run(d, startPhob, { demo: true }); }
  if (demo && demo.startsWith('hoja')) { const d = new HojaDemo(demo.includes('platform') || demo === 'hoja', !/^hoja-m(-|$)/.test(demo)); await d.open(); return run(d, startHoja, { demo: true }); }   // HOJA2 demo on the GS: hoja-essential, or the Platform (hoja, hoja-platform); hoja-m, hoja-m-platform: the PadBox M   // @M
  // @GS if (demo && demo.startsWith('hoja')) { const d = new HojaDemo(!demo.includes('essential'), true); await d.open(); return run(d, startHoja, { demo: true }); }
  if (demo) return run(new GpDemo(demo.includes('platform'), !/^gp-m(-|$)/.test(demo), demo === 'gp-e2t'), startGp, { demo: true });   // gp-m, gp-m-platform: the PadBox M; gp-e2t: the E2T PadBox GS (unlisted)   // @M
  // @GS if (demo) return run(new GpDemo(demo.includes('platform'), true, demo === 'gp-e2t'), startGp, { demo: true });   // gp-e2t: the E2T PadBox GS (unlisted)
  showConnect();
  try { const list = navigator.usb ? await navigator.usb.getDevices() : []; const d = list.find(x => isGp(x) || isHoja(x)); if (d) open(d); } catch (e) { }
  try { if (navigator.serial && !current && !connecting) { const ports = await navigator.serial.getPorts(); if (ports[0]) openSerial(ports[0]); } } catch (e) { }
})();
// the offline copy (sw.js, at the site's root once published); not on a local test server
if ('serviceWorker' in navigator && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') navigator.serviceWorker.register('sw.js').catch(() => { });
