// HOJA2 over WebUSB: the firmware's vendor interface (class FF/00/00, bulk IN 0x82 / OUT 0x02, 64-byte packets -
// hhl_tusb_webusb.c) and the chunked config-block protocol the desktop HOJA2 PadBox Calibrator uses (settings.c):
// blocks are read and written 32 bytes per packet, commands are confirmed with the same block/command, and the
// live input report streams in the background. Exchanges are queued: one at a time, in order.

import { sleep } from '../ui.js';
import { $t } from '../i18n.js';

export const Blk = { GAMEPAD: 0, HOVER: 1, ANALOG: 2, RGB: 3, TRIGGER: 4, IMU: 5, HAPTIC: 6, USER: 7, INPUT: 8, MAX: 9 };
export const BlkSize = [64, 256, 1024, 256, 64, 32, 8, 64, 2048];
export const Rpt = { READ_CONFIG_BLOCK: 1, WRITE_CONFIG_BLOCK: 2, READ_STATIC_BLOCK: 3, CONFIG_COMMAND: 4, INPUT_COMMAND: 5, PROFILE: 7, SPRING_CAPTURE: 249, ANALOG_DUMP: 250, INPUT_GYRO: 253, INPUT_JOYSTICKS: 254, INPUT_RAW: 255 };
export const DeviceInfo = { Block: 0, Size: 802, InputBlock: 1, InputSize: 360 };

class HojaProtocol {
  constructor() { this.chain = Promise.resolve(); this.pending = null; this.onRaw = null; this.onSticks = null; this.onSnap = null; this.onSpring = null; this.springParts = null; this.onFrame = null; this.onLost = null; }
  // packet in, from the device
  dispatch(p) {
    const id = p[0];
    if (id === Rpt.READ_CONFIG_BLOCK || id === Rpt.READ_STATIC_BLOCK) {
      const q = this.pending;
      if (!q || q.kind !== 'read' || q.id !== id || q.block !== p[1]) return;
      if (p[3] === 0xff) return q.done(q.buf);
      const off = p[3] * 32, size = p[2];
      if (off + size <= q.buf.length) q.buf.set(p.subarray(4, 4 + size), off);
    } else if (id === Rpt.CONFIG_COMMAND) {
      const q = this.pending;
      if (!q || q.kind !== 'cmd' || q.block !== p[1] || q.cmd !== p[2]) return;
      q.done({ ok: p[3] !== 0, data: p.slice(4, 64) });
    } else if (id === Rpt.INPUT_JOYSTICKS) {
      if (this.onFrame) this.onFrame(p);   // every live report carries the raw IMU readings (bytes 3-14)
      if (!this.onSticks) return;
      const u = o => (((p[o] << 8) | p[o + 1]) - 2048) / 2048;
      this.onSticks(u(15), u(17), u(19), u(21), u(23), u(25), u(27), u(29));
    } else if (id === Rpt.PROFILE) {
      // settings profiles (profiles.h): [1] op, [2] 1 done / 0 not, [3] profile count (0: none on this board), [4] the
      // active one, [5] the one asked about, [6..29] its name
      const q = this.pending;
      if (!q || q.kind !== 'profile' || q.op !== p[1]) return;
      const name = new TextDecoder().decode(p.subarray(6, 30)).replace(/\0.*$/, '');
      q.done({ ok: p[2] === 1, count: p[3], active: p[4], profile: p[5], name });
    } else if (id === Rpt.ANALOG_DUMP) {
      // a snapback capture (snapback.c): [1] the axis (0 LX, 1 LY, 2 RX, 3 RY), [2..63] 62 samples 0.5 ms apart
      // after the filter, each (value + 2048) >> 4 (128 = the centre)
      if (this.onSnap && p[1] <= 3) this.onSnap(p[1], Array.from(p.subarray(2, 64), v => (v - 128) / 128));
    } else if (id === Rpt.SPRING_CAPTURE) {
      // a release recording for the Auto tuning (snapback_capture.c): [1] the stick, [2] its number, [3] the packet,
      // [4] packets in all, [5] samples in this one, then x, y pairs (s16 LE); 256 samples in 19 packets
      if (!this.onSpring || p.length < 6) return;
      const k = p[1] + ':' + p[2];
      if (!this.springParts || this.springParts.key !== k) this.springParts = { key: k, got: new Map(), total: p[4] };
      const dv = new DataView(p.buffer, p.byteOffset, p.byteLength), xy = [];
      for (let i = 0; i < p[5] && 6 + i * 4 + 4 <= p.length; i++) xy.push([dv.getInt16(6 + i * 4, true), dv.getInt16(8 + i * 4, true)]);
      this.springParts.got.set(p[3], xy);
      if (this.springParts.got.size === this.springParts.total) {
        const all = [...this.springParts.got.entries()].sort((a, b) => a[0] - b[0]).flatMap(e => e[1]);
        this.springParts = null;
        this.onSpring(p[1], { x: all.map(v => v[0]), y: all.map(v => v[1]) });
      }
    } else if (id === Rpt.INPUT_RAW) {
      if (this.onFrame) this.onFrame(p);
      if (this.onRaw) this.onRaw(p);
    }
  }
  exchange(kind, fields, packet, timeout) {
    const run = () => new Promise(res => {
      const t = setTimeout(() => { this.pending = null; res(null); }, timeout);
      this.pending = Object.assign({ kind, done: v => { clearTimeout(t); this.pending = null; res(v); } }, fields);
      this.send(packet).catch(() => { clearTimeout(t); this.pending = null; res(null); });
    });
    const p = this.chain.then(run);
    this.chain = p.catch(() => { });
    return p;
  }
  pkt(...b) { const p = new Uint8Array(64); p.set(b); return p; }
  readBlock(block) { return this.exchange('read', { id: Rpt.READ_CONFIG_BLOCK, block, buf: new Uint8Array(BlkSize[block]) }, this.pkt(Rpt.READ_CONFIG_BLOCK, block), 1500); }
  readStatic(block, size) { return this.exchange('read', { id: Rpt.READ_STATIC_BLOCK, block, buf: new Uint8Array(size) }, this.pkt(Rpt.READ_STATIC_BLOCK, block), 1500); }
  async command(block, cmd, timeout) { const r = await this.exchange('cmd', { block, cmd }, this.pkt(Rpt.CONFIG_COMMAND, block, cmd), timeout || 1500); return r || { ok: false, data: null }; }
  // Settings profiles: op 0 INFO (a profile's name), 1 SWITCH, 2 RENAME (name), 3 COPY (from another into this one). A
  // switch, rename or copy is answered once stored. null: no answer (firmware from before profiles)
  profile(op, profile, extra) {
    const p = this.pkt(Rpt.PROFILE, op, profile);
    if (op === 3) p[3] = extra;
    if (op === 2) p.set(new TextEncoder().encode(extra || '').subarray(0, 24), 4);   // [3] is COPY's source: the name starts at 4
    return this.exchange('profile', { op }, p, op === 0 ? 1000 : 6000);
  }
  // Writes a whole block into the controller's RAM (32 bytes per packet, then the completion packet that makes it take effect).
  writeBlock(block, data) {
    const run = async () => {
      for (let idx = 0, off = 0; off < data.length; idx++, off += 32) {
        const n = Math.min(32, data.length - off), p = this.pkt(Rpt.WRITE_CONFIG_BLOCK, block, n, idx);
        p.set(data.subarray(off, off + n), 4);
        await this.send(p);
      }
      await this.send(this.pkt(Rpt.WRITE_CONFIG_BLOCK, block, 0, 0xff));
    };
    const p = this.chain.then(run);
    this.chain = p.catch(() => { });
    return p;
  }
  reportMode(mode) { this.send(this.pkt(Rpt.INPUT_COMMAND, 0, mode)).catch(() => { }); }
  // record releases of a stick for the Auto tuning: 0 left, 1 right, 0xff stops
  springCapture(stick) { this.springParts = null; this.send(this.pkt(Rpt.INPUT_COMMAND, 2, stick)).catch(() => { }); }
  focus(input) { this.send(this.pkt(Rpt.INPUT_COMMAND, 1, input)).catch(() => { }); }
  // "Update firmware": WEBUSB_LEGACY_SET_BOOTLOADER (15) with the key "UPD" - restarts into the USB bootloader;
  // "UPN": the same without its drive (no Windows window; the web app writes the firmware over PICOBOOT)
  bootloader(noDrive) { return this.send(this.pkt(15, 0x55, 0x50, noDrive ? 0x4e : 0x44)).catch(() => { }); }
}

export class HojaUsb extends HojaProtocol {
  constructor(device) { super(); this.dev = device; this.alive = false; }
  async open() {
    const d = this.dev;
    if (!d.opened) await d.open();
    if (d.configuration === null) await d.selectConfiguration(1);
    let found = null;
    for (const itf of d.configuration.interfaces)
      for (const a of itf.alternates)
        if (a.interfaceClass === 0xff && a.interfaceSubclass === 0 && a.interfaceProtocol === 0 && a.endpoints.length === 2) found = { itf, a };
    if (!found) throw new Error($t('This isn\'t a PadBox with the HOJA firmware (no HOJA configuration interface). If it runs GP2040-CE or PhobGCC, hold Start while plugging it in.'));
    this.itfNum = found.itf.interfaceNumber;
    await d.claimInterface(this.itfNum);
    this.epIn = found.a.endpoints.find(e => e.direction === 'in').endpointNumber;
    this.epOut = found.a.endpoints.find(e => e.direction === 'out').endpointNumber;
    this.alive = true;
    this.loop();
  }
  async loop() {
    while (this.alive) {
      try {
        const r = await this.dev.transferIn(this.epIn, 64);
        if (r.data && r.data.byteLength) this.dispatch(new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength));
      } catch (e) {
        if (!this.alive) return;
        this.alive = false;
        if (this.onLost) this.onLost();
        return;
      }
    }
  }
  async send(p) { const r = await this.dev.transferOut(this.epOut, p); if (r.status !== 'ok') throw new Error('USB ' + r.status); }
  async close() { this.alive = false; try { await this.dev.close(); } catch (e) { } }
}

// ------------------------------------------------------------------ a fake controller for trying the app (?demo=hoja or ?demo=hoja-platform)
export class HojaDemo extends HojaProtocol {
  constructor(platform, gs = true, ns = false) {
    super();
    this.platform = platform && !ns; this.gs = gs; this.ns = ns; this.focused = -1;   // ns: the PadBox GS NS (a GS Essential without sticks)
    this.blocks = BlkSize.map(n => new Uint8Array(n));
    const B = this.blocks, u16 = (b, o, v) => { b[o] = v & 255; b[o + 1] = (v >> 8) & 255; };
    B[Blk.GAMEPAD][0] = 0x14; B[Blk.ANALOG][0] = 0x14; B[Blk.RGB][0] = 0x12; B[Blk.IMU][0] = 0x12; B[Blk.HAPTIC][0] = 0x11; B[Blk.HAPTIC][1] = 200; B[Blk.HAPTIC][2] = 1;
    B[Blk.GAMEPAD].set([0x2d, 0x2d, 0x2d, 0, 0xe6, 0xe6, 0xe6, 0, 0xff, 0xff, 0xff, 0, 0xff, 0xff, 0xff, 0], 8);   // the Switch colors' defaults
    B[Blk.IMU].fill(120, 14, 17); B[Blk.IMU].fill(100, 17, 20); B[Blk.INPUT][0] = 0x15;
    const an = B[Blk.ANALOG], dv = new DataView(an.buffer);
    an[701] = 1; an[775] = 1;   // the spring model's defaults, as firmware with it fills in (not tuned)
    u16(an, 682, 100); u16(an, 684, 100); u16(an, 688, 80); u16(an, 690, 80); an[696] = 51; an[697] = 51;
    for (let s = 0; s < 2; s++) for (let i = 0; i < 8; i++) { const o = 10 + s * 336 + i * 21; dv.setFloat32(o, i * 45, true); dv.setFloat32(o + 4, i * 45, true); dv.setFloat32(o + 12, 2000, true); dv.setFloat32(o + 16, 2000, true); an[o + 20] = 1; }
    const rg = B[Blk.RGB], rdv = new DataView(rg.buffer);
    rg[1] = 1; u16(rg, 2, 650); u16(rg, 132, 2048);
    for (let i = 0; i < 32; i++) rdv.setUint32(4 + i * 4, 0x2040ff, true);
    rdv.setUint32(4, 0xff6800, true); rdv.setUint32(20, 0xff6800, true);
    this.t = 0; this.mode = Rpt.INPUT_JOYSTICKS;
    this.profActive = 0; this.profNames = ['', '', '', '']; this.profBlocks = [];
    this.timer = setInterval(() => this.frame(), 20);
  }
  async open() {
    const { demoDefaults } = await import('./model.js');
    for (let p = 0; p < 6; p++) demoDefaults(this.blocks[Blk.INPUT], p, this.platform, this.gs);
    this.profBlocks = [0, 1, 2, 3].map(() => this.profileCopy());
  }
  // the blocks a profile holds (the demo keeps them whole; the firmware keeps parts of the analog, IMU and haptic ones)
  profileCopy() { return [Blk.ANALOG, Blk.IMU, Blk.HAPTIC, Blk.RGB, Blk.INPUT].map(b => [b, this.blocks[b].slice()]); }
  async close() { clearInterval(this.timer); }
  frame() {
    this.t += 0.02;
    // the demo's snapback capture: every 4 s, a stick let go from full right that bounces past the centre and settles
    const now = performance.now();
    if (this.mode === Rpt.INPUT_JOYSTICKS && now > (this.snapAt || (this.snapAt = now + 2000))) {
      this.snapAt = now + 4000; this.snapN = (this.snapN || 0) + 1;
      const d = new Uint8Array(64), ax = this.snapN % 4; d[0] = Rpt.ANALOG_DUMP; d[1] = ax;
      for (let i = 0; i < 62; i++) { const ms = i * 0.5, v = 0.92 * Math.exp(-ms / 6) * Math.cos(ms / 3.2) + (Math.random() - 0.5) * 0.02; d[2 + i] = Math.max(0, Math.min(255, Math.round(128 + v * 128))); }
      setTimeout(() => this.dispatch(d), 0);
    }
    // the demo's release recordings for the Auto tuning: one every 1.5 s while armed, let go from the next direction
    if (this.springStick != null && this.springStick !== 0xff && now > (this.springAt || 0)) {
      this.springAt = now + 1500; const o = this.springN = ((this.springN ?? -1) + 1) % 8, ang = o * Math.PI / 4;
      const xs = [], ys = [];
      for (let i = 0; i < 256; i++) {
        const t = i - 40, v = t < 0 ? 1950 : 1950 * Math.exp(-0.035 * t) * Math.cos(0.17 * t) + (Math.random() - 0.5) * 6;
        xs.push(Math.round(v * Math.cos(ang))); ys.push(Math.round(v * Math.sin(ang)));
      }
      for (let k = 0; k < 19; k++) {
        const d = new Uint8Array(64), n = Math.min(14, 256 - k * 14), dv = new DataView(d.buffer);
        d.set([Rpt.SPRING_CAPTURE, this.springStick, this.springNum = ((this.springNum || 0) + (k ? 0 : 1)) & 255, k, 19, n]);
        for (let i = 0; i < n; i++) { dv.setInt16(6 + i * 4, xs[k * 14 + i], true); dv.setInt16(8 + i * 4, ys[k * 14 + i], true); }
        setTimeout(() => this.dispatch(d), 0);
      }
    }
    const f = new Uint8Array(64), a = this.t * 0.5;
    const lx = Math.round(Math.sin(a) * 1400), ly = Math.round(Math.cos(a) * 1400), rx = Math.round(Math.cos(a * 1.3) * 900), ry = Math.round(Math.sin(a * 1.3) * 900);
    const be = (o, v) => { f[o] = (v >> 8) & 255; f[o + 1] = v & 255; };
    if (this.mode === Rpt.INPUT_RAW) {
      f[0] = Rpt.INPUT_RAW;
      f[17 + 27] = (Math.max(0, lx) >> 5) & 0x7f; f[17 + 28] = (Math.max(0, -lx) >> 5) & 0x7f;
      f[17 + 29] = (Math.max(0, ly) >> 5) & 0x7f; f[17 + 30] = (Math.max(0, -ly) >> 5) & 0x7f;
    } else {
      f[0] = Rpt.INPUT_JOYSTICKS;
      be(15, 2048 + lx); be(17, 2048 + ly); be(19, 2048 + rx); be(21, 2048 + ry);
      be(23, 2048 + Math.round(lx * 0.88)); be(25, 2048 + Math.round(ly * 0.88)); be(27, 2048 + Math.round(rx * 0.88)); be(29, 2048 + Math.round(ry * 0.88));
    }
    this.dispatch(f);
  }
  emit(id, block, data) {
    for (let idx = 0, off = 0; off < data.length; idx++, off += 32) {
      const n = Math.min(32, data.length - off), p = new Uint8Array(64);
      p[0] = id; p[1] = block; p[2] = n; p[3] = idx; p.set(data.subarray(off, off + n), 4);
      setTimeout(() => this.dispatch(p), 0);
    }
    const fin = new Uint8Array(64); fin[0] = id; fin[1] = block; fin[3] = 0xff;
    setTimeout(() => this.dispatch(fin), 0);
  }
  async send(p) {
    const id = p[0];
    if (id === Rpt.READ_CONFIG_BLOCK && p[1] < Blk.MAX) this.emit(id, p[1], this.blocks[p[1]]);
    else if (id === Rpt.READ_STATIC_BLOCK && p[1] === DeviceInfo.Block) {
      const d = new Uint8Array(DeviceInfo.Size); d.set(new TextEncoder().encode(this.ns ? 'PadBox GS NS' : this.platform ? 'PadBox GS Platfo' : 'PadBox GS Essent'));
      d[704] = 0x02; d[705] = 0x01; this.emit(id, p[1], d);
    } else if (id === Rpt.READ_STATIC_BLOCK && p[1] === DeviceInfo.InputBlock) {
      const { defaultInputTypes } = await import('./model.js');
      const t = defaultInputTypes(this.platform, this.gs), d = new Uint8Array(DeviceInfo.InputSize);
      t.forEach((v, i) => d[i * 10] = v); this.emit(id, p[1], d);
    } else if (id === Rpt.WRITE_CONFIG_BLOCK) {
      if (p[1] < Blk.MAX && p[3] !== 0xff && p[2] > 0) this.blocks[p[1]].set(p.subarray(4, 4 + p[2]), p[3] * 32);
    } else if (id === Rpt.CONFIG_COMMAND) {
      const r = new Uint8Array(64); r[0] = Rpt.CONFIG_COMMAND; r[1] = p[1]; r[2] = p[2]; r[3] = 1;
      // calibration: 1 both / 5 left / 6 right, ended by 2 (the result is 1 both, 2 left only, 4 right only)
      if (p[1] === Blk.ANALOG && [1, 5, 6].includes(p[2])) this.calSticks = p[2] === 5 ? 1 : p[2] === 6 ? 2 : 3;
      if (p[1] === Blk.ANALOG && p[2] === 2) {
        const a = this.blocks[Blk.ANALOG], v = a[1];
        const done = (v === 1 ? 3 : v === 0xff ? 0 : ((v & 2) ? 1 : 0) | ((v & 4) ? 2 : 0)) | (this.calSticks || 3) | (this.platform ? 2 : 0);
        a[1] = (done & 3) === 3 ? 1 : (done & 1) ? 2 : 4;
      }
      if (p[1] === Blk.ANALOG && (p[2] === 3 || p[2] === 4)) { const dv = new DataView(r.buffer); dv.setFloat32(4, (this.t * 0.5 * 180 / Math.PI) % 360, true); dv.setFloat32(8, 2000, true); }
      if (p[1] === Blk.INPUT && p[2] >= 2 && p[2] <= 7) { const { demoDefaults } = await import('./model.js'); demoDefaults(this.blocks[Blk.INPUT], p[2] - 2, this.platform, this.gs); }
      setTimeout(() => this.dispatch(r), 30);
    } else if (id === Rpt.INPUT_COMMAND && p[1] === 0) this.mode = p[2];
    else if (id === Rpt.INPUT_COMMAND && p[1] === 1) this.focused = p[2];
    else if (id === Rpt.INPUT_COMMAND && p[1] === 2) this.springStick = p[2];
    else if (id === Rpt.PROFILE) {
      const op = p[1], n = p[2], r = new Uint8Array(64);
      if (n < 4) {
        if (op === 1 && n !== this.profActive) { this.profBlocks[this.profActive] = this.profileCopy(); for (const [b, d] of this.profBlocks[n]) this.blocks[b].set(d); this.profActive = n; }
        if (op === 2) { let k = 4; while (k < 28 && p[k]) k++; this.profNames[n] = new TextDecoder().decode(p.subarray(4, k)); }
        if (op === 3 && p[3] < 4) { if (n === this.profActive) for (const [b, d] of this.profBlocks[p[3]]) this.blocks[b].set(d); else this.profBlocks[n] = this.profBlocks[p[3]].map(([b, d]) => [b, d.slice()]); }
      }
      r.set([Rpt.PROFILE, op, n < 4 ? 1 : 0, 4, this.profActive, n]); r.set(new TextEncoder().encode(this.profNames[n] || '').subarray(0, 24), 6);
      setTimeout(() => this.dispatch(r), op ? 400 : 10);
    }
  }
}
