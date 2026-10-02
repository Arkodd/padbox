// "Update firmware" for the web app. The PadBox restarts into its USB bootloader, then the page writes the firmware
// straight into its flash over WebUSB (the bootloader's PICOBOOT interface): no drive to pick, no file to copy.
// The first time, Chrome asks once which device to allow ("RP2 Boot" / "RP2350 Boot"); after that it's automatic.
// Where the browser can't reach the bootloader (no WebUSB, or Windows without a driver for the RP2040 one), it falls
// back to downloading the file for the user to drag onto the RPI-RP2 drive.
// Once this browser has installed firmware that way on a chip, later updates ask the firmware for the bootloader
// WITHOUT its drive (enter(true)), so no RPI-RP2 / RP2350 window opens each time. Not for the RP2040 on Windows: without
// its drive that bootloader is a different USB device (no "&MI_01"), which has no WinUSB driver, so Chrome can't reach
// it (the driver people install for "RP2 Boot" - Zadig, picotool - is for the two-part one only).
// The bundled firmware is in firmware/ as "PadBox <board> - <family>.uf2".

import { el, icon, button, dialog, esc, sleep, setButtonText } from './ui.js';

const FAMILIES = { 'GS Essential': ['HOJA2', 'GP2040-CE'], 'GS Platform': ['HOJA2', 'GP2040-CE', 'PhobGCC'], 'M Essential': ['HOJA2', 'GP2040-CE', 'PhobGCC'], 'M Platform': ['HOJA2', 'GP2040-CE', 'PhobGCC'] };   // @M
// @GS const FAMILIES = { 'GS Essential': ['HOJA2', 'GP2040-CE'], 'GS Platform': ['HOJA2', 'GP2040-CE', 'PhobGCC'] };
const BOOT_IDS = [{ vendorId: 0x2e8a, productId: 0x0003 }, { vendorId: 0x2e8a, productId: 0x000f }];   // RP2040, RP2350
const CHIP_FAMILIES = { RP2040: [0xe48bff56], RP2350: [0xe48bff59, 0xe48bff5a] };

// RP2040 / RP2350 / null, from the family ID in every 512-byte UF2 block.
export function uf2Chip(data) {
  if (!data || data.length < 512 || data.length % 512) return null;
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let a = false, b = false;
  for (let o = 0; o < data.length; o += 512) {
    if (v.getUint32(o, true) !== 0x0a324655 || v.getUint32(o + 4, true) !== 0x9e5d5157) return null;
    if ((v.getUint32(o + 8, true) & 0x2000) === 0) return null;
    const fam = v.getUint32(o + 28, true);
    if (fam === 0xe48bff56) a = true; else if (fam === 0xe48bff59 || fam === 0xe48bff5a) b = true; else if (fam !== 0xe48bff57) return null;
  }
  return a === b ? null : a ? 'RP2040' : 'RP2350';
}

const bootChip = dev => dev.productId === 0x0003 ? 'RP2040' : 'RP2350';
// whether this browser has already written firmware straight into this chip's bootloader (so it doesn't need the drive)
const PICOBOOT_KEY = chip => 'padbox-picoboot-ok-' + chip;
const NODRIVE_BAD_KEY = chip => 'padbox-nodrive-failed-' + chip;
const onWindows = () => /Windows/i.test((navigator.userAgentData && navigator.userAgentData.platform) || navigator.userAgent);
const picobootWorked = chip => { try { return localStorage.getItem(PICOBOOT_KEY(chip)) === '1'; } catch (e) { return false; } };
const rememberPicoboot = chip => { try { localStorage.setItem(PICOBOOT_KEY(chip), '1'); } catch (e) { } };
// the drive-less bootloader: only where it can be reached, and never again on a computer where it once wasn't
function useNoDrive(chip) {
  if (!navigator.usb || !picobootWorked(chip)) return false;
  if (chip === 'RP2040' && onWindows()) return false;
  try { return localStorage.getItem(NODRIVE_BAD_KEY(chip)) !== '1'; } catch (e) { return false; }
}
const isBoot = dev => BOOT_IDS.some(f => f.vendorId === dev.vendorId && f.productId === dev.productId);

// The bootloader, if this site was already allowed to use it; waits up to ms for it to show up.
async function findBoot(ms) {
  if (!navigator.usb) return null;
  const end = performance.now() + ms;
  for (;;) {
    try { const d = (await navigator.usb.getDevices()).find(isBoot); if (d) return d; } catch (e) { }
    if (performance.now() > end) return null;
    await sleep(300);
  }
}

// The UF2's flash contents as 4 KB sectors (address -> bytes), only the blocks meant for this chip.
function sectors(data, chip) {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength), out = new Map();
  for (let o = 0; o < data.length; o += 512) {
    const addr = v.getUint32(o + 12, true), size = v.getUint32(o + 16, true), fam = v.getUint32(o + 28, true);
    if (!CHIP_FAMILIES[chip].includes(fam) || addr < 0x10000000 || addr >= 0x11000000 || size > 476) continue;
    const sec = addr & ~0xfff;
    let s = out.get(sec);
    if (!s) { s = new Uint8Array(4096).fill(0xff); out.set(sec, s); }
    s.set(data.subarray(o + 32, o + 32 + size), addr - sec);
  }
  return [...out.entries()].sort((a, b) => a[0] - b[0]);
}

// PICOBOOT (pico-sdk boot/picoboot.h): 32-byte commands on the bulk OUT pipe, an optional data phase, then a
// zero-length acknowledgement in the other direction.
export async function picobootFlash(dev, data, progress) {
  const chip = bootChip(dev);
  const secs = sectors(data, chip);
  if (!secs.length) throw new Error('the file has nothing for this chip');
  await dev.open();
  try {
    if (!dev.configuration) await dev.selectConfiguration(1);
    const itf = dev.configuration.interfaces.find(i => i.alternates[0].interfaceClass === 0xff);
    if (!itf) throw new Error('no PICOBOOT interface');
    const alt = itf.alternates[0];
    const epIn = alt.endpoints.find(e => e.direction === 'in').endpointNumber;
    const epOut = alt.endpoints.find(e => e.direction === 'out').endpointNumber;
    await dev.claimInterface(itf.interfaceNumber);
    await dev.controlTransferOut({ requestType: 'vendor', recipient: 'interface', request: 0x41, value: 0, index: itf.interfaceNumber });   // IF_RESET
    let token = 1;
    const cmd = async (id, args, xfer = 0, payload = null) => {
      const c = new Uint8Array(32), v = new DataView(c.buffer);
      v.setUint32(0, 0x431fd10b, true); v.setUint32(4, token++, true);
      c[8] = id; c[9] = args.length; v.setUint32(12, xfer, true); c.set(args, 16);
      let r = await dev.transferOut(epOut, c);
      if (r.status !== 'ok') throw new Error('command ' + id + ' refused');
      if (xfer) { r = await dev.transferOut(epOut, payload); if (r.status !== 'ok') throw new Error('command ' + id + ' data refused'); }
      r = await dev.transferIn(epIn, 64);
      if (r.status !== 'ok') throw new Error('command ' + id + ' failed');
    };
    const u32 = (...n) => { const b = new Uint8Array(n.length * 4), v = new DataView(b.buffer); n.forEach((x, i) => v.setUint32(i * 4, x >>> 0, true)); return b; };
    await cmd(0x01, new Uint8Array([1]));   // exclusive access (the drive goes read-only meanwhile)
    await cmd(0x06, new Uint8Array(0));     // leave execute-in-place so the flash can be written
    for (let i = 0; i < secs.length; i++) {
      const [addr, bytes] = secs[i];
      await cmd(0x03, u32(addr, 4096));                 // erase
      await cmd(0x05, u32(addr, 4096), 4096, bytes);    // write
      progress(i + 1, secs.length);
    }
    // restart on the new firmware in half a second
    if (chip === 'RP2350') await cmd(0x0a, u32(0, 500, 0, 0));
    else await cmd(0x02, u32(0, 0x20042000, 500));
  } finally {
    try { await dev.close(); } catch (e) { }
  }
}

export function firmwareUpdate({ board, current, enter }) {
  const fams = FAMILIES[board] || [];
  const choice = el('select.combo', { style: { width: '100%' } });
  for (const f of fams) choice.append(el('option', { value: f, text: f + (f === current ? '  (the one running now - reinstall / update)' : '  (switch to it)') }));
  choice.append(el('option', { value: '', text: 'Another .uf2 file...' }));
  choice.value = current;
  let other = null;
  const info = el('p.hint', { style: { margin: '12px 0 0' } });
  const status = el('p', { style: { margin: '12px 0 0', color: 'var(--soft)', whiteSpace: 'pre-line' } });
  const meter = el('div.bar-meter.hidden', { style: { marginTop: '12px' } }, [el('i', { style: { width: '0%' } })]);
  const setInfo = () => {
    info.textContent = choice.value === ''
      ? (other ? 'File: ' + other.name + ' - it is checked against the PadBox\'s chip before anything is written.' : 'Choose a .uf2 file.')
      : 'The PadBox restarts into update mode, the firmware is installed, then it restarts by itself. Your settings are kept.' +
        (choice.value !== current ? '\nSwitching firmware: afterwards, reconnect to the PadBox with its new firmware.' : '');
  };
  choice.addEventListener('change', () => {
    if (choice.value === '') {
      const inp = el('input', { type: 'file', accept: '.uf2' });
      inp.addEventListener('change', () => { other = inp.files[0] || null; setInfo(); });
      inp.click();
    }
    setInfo();
  });
  setInfo();

  const go = button('UPDATE', { primary: true, icon: 'download' });
  const close = button('CANCEL', { icon: '', onclick: () => d.close() });
  const body = el('div', {}, [el('div.caption', { text: 'Firmware to install', style: { marginTop: 0 } }), choice, info, meter, status]);
  const d = dialog('Update firmware', board ? 'PadBox ' + board + (current ? '  •  running ' + current : '') : 'PadBox', 'download', body, [go, close]);
  const say = (t, c) => { status.textContent = t; status.style.color = c || 'var(--soft)'; };
  const progress = p => { meter.classList.remove('hidden'); meter.firstChild.style.width = p + '%'; };
  const reconnect = 'Then reconnect: plug it in (hold Start for GP2040-CE or PhobGCC) and click CONNECT.';

  let data = null, name = '', stage = 'start', noDrive = false;
  go.addEventListener('click', async () => {
    if (stage === 'pick') return pickAndInstall();
    if (stage === 'download') return download();
    if (stage !== 'start') return;
    try {
      if (choice.value === '') {
        if (!other) return say('Choose a .uf2 file first.', 'var(--warn)');
        data = new Uint8Array(await other.arrayBuffer()); name = other.name;
      } else {
        const r = await fetch(new URL('../firmware/PadBox ' + board + ' - ' + choice.value + '.uf2', import.meta.url));   // next to js/, whichever page opened this
        if (!r.ok) throw new Error('not found');
        data = new Uint8Array(await r.arrayBuffer()); name = choice.value;
      }
    } catch (e) { data = null; return say('Couldn\'t load the firmware file (' + e.message + ').', 'var(--bad)'); }
    if (!uf2Chip(data)) { data = null; return say('That file isn\'t PadBox firmware (not a valid RP2040 / RP2350 .uf2). Nothing was changed.', 'var(--bad)'); }
    stage = 'busy'; choice.disabled = true; close.disabled = true; go.disabled = true;
    progress(5); say('Restarting the PadBox into update mode...');
    // the bootloader without its drive when this browser already knows it can reach it directly
    noDrive = useNoDrive(uf2Chip(data));
    try { if (enter) await enter(noDrive); } catch (e) { }
    await sleep(1500);
    progress(10);
    if (!navigator.usb) return offerDownload('This browser can\'t install firmware by itself.');
    const dev = await findBoot(6000);
    if (dev) return install(dev);
    if (noDrive) {
      // the drive-less bootloader didn't show up (older firmware, or this computer can't reach it): from now on this
      // browser uses the normal one, with its drive
      try { localStorage.setItem(NODRIVE_BAD_KEY(uf2Chip(data)), '1'); } catch (e) { }
      stage = 'pick'; go.disabled = false; close.disabled = false;
      setButtonText(go, 'INSTALL', 'download');
      return say('The PadBox didn\'t show up in update mode.\nUnplug it, hold Start + Select while plugging it back in, then click INSTALL. (Next time the update won\'t need this.)', 'var(--warn)');
    }
    // first time on this computer: the browser needs one click to allow the bootloader
    stage = 'pick'; go.disabled = false; close.disabled = false;
    setButtonText(go, 'INSTALL', 'download');
    say('The PadBox is in update mode.\nClick INSTALL and choose "' + (board && board.startsWith('GS') ? 'RP2 Boot' : 'RP2 Boot / RP2350 Boot') + '" in the list (only needed the first time).\n\nIf it isn\'t listed: unplug the PadBox, hold Start + Select while plugging it back in, then click INSTALL.');
  });

  async function pickAndInstall() {
    let dev;
    try { dev = await navigator.usb.requestDevice({ filters: BOOT_IDS }); }
    catch (e) { return; }   // cancelled
    install(dev);
  }

  async function install(dev) {
    const chip = uf2Chip(data), devChip = bootChip(dev);
    if (chip !== devChip) {
      stage = 'pick'; go.disabled = false; close.disabled = false;
      return say('This firmware is for ' + chip + ', but the PadBox is ' + devChip + '. Nothing was changed.', 'var(--bad)');
    }
    stage = 'busy'; go.disabled = true; close.disabled = true;
    say('Installing ' + name + '... don\'t unplug the PadBox.');
    try {
      await picobootFlash(dev, data, (i, n) => progress(10 + Math.round(88 * i / n)));
    } catch (e) {
      // most likely Windows has no driver for this bootloader (the RP2040 one): copy the file instead
      return offerDownload('The browser couldn\'t reach the PadBox\'s bootloader (' + e.message + ').');
    }
    rememberPicoboot(devChip);   // next time: no drive, no window
    progress(100);
    say('Done: the PadBox restarts on ' + name + ' by itself.', 'var(--good)');
    stage = 'done'; go.classList.add('hidden');
    setButtonText(close, 'CLOSE', ''); close.disabled = false;
    // a moment later the window closes and the page goes back to its connect screen (main.js listens for this)
    setTimeout(() => {
      try { d.close(); } catch (e) { }
      dispatchEvent(new CustomEvent('padbox-updated', { detail: { name, message: 'Updated to ' + name + '. The PadBox restarts by itself. ' + reconnect } }));
    }, 2000);
  }

  function offerDownload(why) {
    const board2040 = board && board.startsWith('GS');
    if (board2040 && uf2Chip(data) !== 'RP2040') {
      stage = 'done'; close.disabled = false;
      return say('That firmware is for a different chip (' + uf2Chip(data) + ') than the PadBox GS (RP2040). Nothing was changed.', 'var(--bad)');
    }
    stage = 'download'; go.disabled = false; close.disabled = false;
    setButtonText(go, 'DOWNLOAD FIRMWARE', 'download');
    try { localStorage.removeItem(PICOBOOT_KEY(uf2Chip(data))); } catch (e) { }   // it didn't work here: use the drive next time
    say(why + '\nClick DOWNLOAD FIRMWARE, then drag the downloaded file onto the update drive' + (noDrive ? ' (to get it: unplug the PadBox, hold Start + Select while plugging it back in)' : ' that appeared') + ' (RPI-RP2 or RP2350): the PadBox restarts on the new firmware by itself.', 'var(--warn)');
  }

  function download() {
    const a = el('a', { href: URL.createObjectURL(new Blob([data])), download: 'PADBOX.UF2' }); a.click();
    progress(100);
    say('Downloaded. Drag PADBOX.UF2 onto the update drive (RPI-RP2 or RP2350): the PadBox restarts on ' + name + ' by itself.\n' + reconnect, 'var(--good)');
    setButtonText(close, 'CLOSE', '');
  }
  return d;
}
