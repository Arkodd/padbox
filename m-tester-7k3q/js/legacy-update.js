// "Update an older PadBox": for controllers still on the firmware they shipped with (HOJA2 "Padbox GS-C", GP2040-CE 0.8.x,
// PhobGCC), which this app can't configure. Each of those can get into the USB bootloader without the board's BOOTSEL
// button, then the firmware is written from here exactly as in "Update firmware" (js/update.js):
//   - the older HOJA2: from this page, over WebUSB - its "reset to bootloader" command (CONFIG_COMMAND, gamepad block,
//     GAMEPAD_CMD_RESET_TO_BOOTLOADER); or by hand: hold L + Start while plugging it in (boot.c)
//   - GP2040-CE 0.8.x: hold Select + Start + D-pad Up while plugging it in (gp2040.cpp, getButtonMappedBootAction)
//   - PhobGCC: hold Start while plugging it in (the original PhobGCC; the PadBox's own build uses that for its PC mode)
// The bootloader can't tell an Essential from a Platform, so the customer says which one they have.

import { el, dialog, button, setButtonText, sleep } from './ui.js';
import { BOOT_IDS, bootChip, uf2Chip, findBoot, picobootFlash, rememberPicoboot, famName } from './update.js';

const BOARDS = { 'GS Essential': ['HOJA2', 'GP2040-CE'], 'GS Platform': ['HOJA2', 'GP2040-CE', 'PhobGCC'] };
// what's on it now -> how it gets into update mode
const NOW = {
  hoja: { text: 'HOJA (older version, "Padbox GS-C")', family: 'HOJA2', auto: true,
    how: 'Plug the PadBox in as usual, then click RESTART IN UPDATE MODE and choose it in the list ("Padbox GS-C", "HOJA Gamepad" or a Nintendo / Xbox controller).',
    manual: 'If it isn\'t listed or doesn\'t restart: unplug it, hold L + Start, plug it back in while holding them, then click INSTALL.' },
  gp: { text: 'GP2040-CE (version 0.8)', family: 'GP2040-CE',
    how: 'Unplug the PadBox. Hold Select + Start + D-pad Up, plug it back in while holding them, then let go and click INSTALL.' },
  phob: { text: 'PhobGCC', family: 'PhobGCC', platform: true,
    how: 'Unplug the PadBox. Hold Start, plug it back in while holding it, then let go and click INSTALL.' },
};
// HOJA2 in each of its USB identities (as main.js)
const HOJA_FILTERS = [{ vendorId: 0x2e8a, productId: 0x10c6 }, { vendorId: 0x057e, productId: 0x2009 }, { vendorId: 0x057e, productId: 0x0337 }, { vendorId: 0x045e, productId: 0x028e }];

// o.now: 'hoja' / 'gp' / 'phob' to start with (the connect screen passes 'hoja' when it found an older HOJA2)
export function legacyUpdate(o = {}) {
  const sel = (items, value) => { const s = el('select.combo', { style: { width: '100%' } }); for (const [v, t] of items) s.append(el('option', { value: v, text: t })); if (value) s.value = value; return s; };
  const boardSel = sel(Object.keys(BOARDS).map(b => [b, 'PadBox ' + b]), o.board || 'GS Essential');
  const nowSel = sel([], '');
  const famSel = sel([], '');
  const how = el('p', { style: { margin: '14px 0 0', color: 'var(--text)', whiteSpace: 'pre-line', lineHeight: '1.45' } });
  const status = el('p', { style: { margin: '12px 0 0', color: 'var(--soft)', whiteSpace: 'pre-line' } });
  const meter = el('div.bar-meter.hidden', { style: { marginTop: '12px' } }, [el('i', { style: { width: '0%' } })]);
  const cap = t => el('div.caption', { text: t, style: { marginTop: '12px' } });

  function fill() {
    const board = boardSel.value, now = nowSel.value || o.now || 'hoja', fam = famSel.value;
    nowSel.innerHTML = '';
    for (const [k, v] of Object.entries(NOW)) if (!v.platform || board === 'GS Platform') nowSel.append(el('option', { value: k, text: v.text }));
    nowSel.value = NOW[now] && (!NOW[now].platform || board === 'GS Platform') ? now : 'hoja';
    famSel.innerHTML = '';
    for (const f of BOARDS[board]) famSel.append(el('option', { value: f, text: famName(f) }));
    famSel.value = BOARDS[board].includes(fam) ? fam : BOARDS[board].includes(NOW[nowSel.value].family) ? NOW[nowSel.value].family : BOARDS[board][0];
    const n = NOW[nowSel.value];
    how.textContent = n.how + (n.manual ? '\n' + n.manual : '');
    if (stage === 'start') setButtonText(go, n.auto ? 'RESTART IN UPDATE MODE' : 'INSTALL', 'download');
  }
  // a different firmware on it now: offer the newest of that same firmware (it can still be changed)
  boardSel.addEventListener('change', fill); famSel.addEventListener('change', fill);
  nowSel.addEventListener('change', () => { famSel.value = NOW[nowSel.value].family; fill(); });

  let stage = 'start', data = null, name = '';
  const go = button('INSTALL', { primary: true, icon: 'download' });
  const close = button('CANCEL', { icon: '', onclick: () => d.close() });
  const body = el('div', {}, [
    el('p', { text: 'For a PadBox GS still on its original firmware: this installs the latest one without opening it. Your old settings aren\'t kept: set it up again afterwards.', style: { margin: 0, color: 'var(--soft)' } }),
    cap('Your PadBox'), boardSel, cap('The firmware on it now'), nowSel, cap('Install'), famSel, how, meter, status,
  ]);
  const d = dialog('Update an older PadBox', 'Firmware from before the PadBox Calibrator', 'download', body, [go, close]);
  const say = (t, c) => { status.textContent = t; status.style.color = c || 'var(--soft)'; };
  const progress = p => { meter.classList.remove('hidden'); meter.firstChild.style.width = p + '%'; };
  const lock = on => { for (const s of [boardSel, nowSel, famSel]) s.disabled = on; go.disabled = on; close.disabled = on; };
  fill();

  go.addEventListener('click', async () => {
    if (stage === 'pick') return pick();
    if (stage === 'download') return download();
    if (stage !== 'start') return;
    // the firmware first, so nothing restarts if it can't be loaded
    try {
      const r = await fetch(new URL('../firmware/PadBox ' + boardSel.value + ' - ' + famSel.value + '.uf2', import.meta.url));
      if (!r.ok) throw new Error('not found');
      data = new Uint8Array(await r.arrayBuffer()); name = famSel.value;
      if (uf2Chip(data) !== 'RP2040') throw new Error('not RP2040 firmware');
    } catch (e) { return say('Couldn\'t load the firmware file (' + e.message + ').', 'var(--bad)'); }
    lock(true); progress(5);
    if (NOW[nowSel.value].auto) {
      say('Restarting the PadBox in update mode...');
      const ok = await restartHoja();
      if (!ok) {
        lock(false); stage = 'pick'; setButtonText(go, 'INSTALL', 'download');
        return say('The PadBox couldn\'t be restarted from here.\n' + NOW.hoja.manual, 'var(--warn)');
      }
      await sleep(1500);
    } else say('Looking for the PadBox in update mode...');
    progress(10);
    if (!navigator.usb) return offerDownload('This browser can\'t install firmware by itself.');
    const dev = await findBoot(5000);
    if (dev) return install(dev);
    // first time on this computer: one click to allow the bootloader
    lock(false); for (const s of [boardSel, nowSel, famSel]) s.disabled = true;
    stage = 'pick'; setButtonText(go, 'INSTALL', 'download');
    say('Click INSTALL and choose "RP2 Boot" in the list.\nIf it isn\'t listed, the PadBox isn\'t in update mode yet: ' + (NOW[nowSel.value].manual || NOW[nowSel.value].how), 'var(--warn)');
  });

  // the older HOJA2: open its configuration interface and ask for the bootloader (also the newer firmware's own
  // command, in case it's already newer than it looks)
  async function restartHoja() {
    if (!navigator.usb) return false;
    let dev = null;
    try { dev = (await navigator.usb.getDevices()).find(x => HOJA_FILTERS.some(f => f.vendorId === x.vendorId && f.productId === x.productId)); } catch (e) { }
    if (!dev) { try { dev = await navigator.usb.requestDevice({ filters: HOJA_FILTERS }); } catch (e) { return false; } }
    try {
      if (!dev.opened) await dev.open();
      if (dev.configuration === null) await dev.selectConfiguration(1);
      let itf = null, ep = null;
      for (const i of dev.configuration.interfaces) for (const a of i.alternates)
        if (a.interfaceClass === 0xff && a.endpoints.length === 2) { itf = i; ep = a.endpoints.find(e => e.direction === 'out'); }
      if (!itf || !ep) throw new Error('no configuration interface');
      await dev.claimInterface(itf.interfaceNumber);
      const pkt = (...b) => { const p = new Uint8Array(64); p.set(b); return p; };
      await dev.transferOut(ep.endpointNumber, pkt(4, 0, 1)).catch(() => { });            // CONFIG_COMMAND: gamepad block, reset to bootloader
      await dev.transferOut(ep.endpointNumber, pkt(15, 0x55, 0x50, 0x44)).catch(() => { });  // the newer firmware's "Update firmware"
      try { await dev.close(); } catch (e) { }
      return true;
    } catch (e) { try { await dev.close(); } catch (x) { } return false; }
  }

  async function pick() {
    let dev;
    try { dev = await navigator.usb.requestDevice({ filters: BOOT_IDS }); } catch (e) { return; }
    install(dev);
  }

  async function install(dev) {
    if (bootChip(dev) !== 'RP2040') { stage = 'pick'; lock(false); return say('That isn\'t a PadBox GS in update mode (its chip is ' + bootChip(dev) + '). Nothing was changed.', 'var(--bad)'); }
    stage = 'busy'; lock(true);
    say('Installing ' + name + '... don\'t unplug the PadBox.');
    try { await picobootFlash(dev, data, (i, n) => progress(10 + Math.round(88 * i / n))); }
    catch (e) { return offerDownload('The browser couldn\'t reach the PadBox in update mode (' + e.message + ').'); }
    rememberPicoboot('RP2040');
    progress(100); stage = 'done'; go.classList.add('hidden'); close.disabled = false; setButtonText(close, 'CLOSE', '');
    say('Done: the PadBox restarts on ' + famName(name) + ' by itself.\nTo set it up: ' + (name === 'HOJA2' ? 'plug it in' : 'hold Start while plugging it in') + ', then click CONNECT.', 'var(--good)');
  }

  function offerDownload(why) {
    stage = 'download'; lock(false); for (const s of [boardSel, nowSel, famSel]) s.disabled = true;
    setButtonText(go, 'DOWNLOAD FIRMWARE', 'download');
    say(why + '\nClick DOWNLOAD FIRMWARE, then drag the file onto the "RPI-RP2" drive that appeared when the PadBox went into update mode: it restarts on the new firmware by itself.', 'var(--warn)');
  }
  function download() {
    const a = el('a', { href: URL.createObjectURL(new Blob([data])), download: 'PADBOX.UF2' }); a.click();
    progress(100);
    say('Downloaded. Drag PADBOX.UF2 onto the RPI-RP2 drive: the PadBox restarts on ' + famName(name) + ' by itself.\nTo set it up afterwards: ' + (name === 'HOJA2' ? 'plug it in' : 'hold Start while plugging it in') + ', then click CONNECT.', 'var(--good)');
    setButtonText(close, 'CLOSE', '');
  }
  return d;
}
