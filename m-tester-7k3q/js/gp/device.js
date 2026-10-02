// GP2040-CE over WebUSB: the web-config API (the same /api/... calls the desktop configurator makes over the
// network) carried by the PadBox firmware's WebUSB bridge (GP2040-CE src/drivers/net/NetDriver.cpp):
//   OUT 1 BEGIN (path), OUT 2 BODY (pieces of the JSON body), OUT 3 RUN, IN 4 STATUS (found, length), IN 5 READ (offset).
// Calls are queued: one at a time, in order.

export const GP_FILTERS = [{ vendorId: 0xcafe }];   // GP2040-CE's web-config mode (TinyUSB's VID)
const BODY_PIECE = 512;

export class GpUsb {
  constructor(device) { this.dev = device; this.itf = -1; this.chain = Promise.resolve(); }

  async open() {
    const d = this.dev;
    if (!d.opened) await d.open();
    if (d.configuration === null) await d.selectConfiguration(1);
    const itf = d.configuration.interfaces.find(i => i.alternates.some(a => a.interfaceClass === 0xff));
    if (!itf) throw new Error('This PadBox\'s GP2040-CE firmware is too old for the web app (no WebUSB bridge). Update it with UPDATE FIRMWARE in the PadBox Suite.');
    this.itf = itf.interfaceNumber;
    await d.claimInterface(this.itf);
  }

  async close() { try { await this.dev.close(); } catch (e) { } }

  setup(request, value) { return { requestType: 'vendor', recipient: 'interface', request, value: value || 0, index: this.itf }; }

  // One USB transfer, given up on after a few seconds: a transfer that never finishes must show up as an error, not
  // leave the app waiting forever (SAVE looking done when nothing was saved).
  guard(p, what) {
    let t;
    return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error('USB: no answer to ' + what)), 5000); })]).finally(() => clearTimeout(t));
  }

  async raw(path, body) {
    const d = this.dev, enc = new TextEncoder();
    let r = await this.guard(d.controlTransferOut(this.setup(1), enc.encode(path)), path);
    if (r.status !== 'ok') throw new Error('USB: ' + r.status);
    // The body (saves only) goes in small pieces: some Android phones' USB can't send large control transfers.
    const bytes = enc.encode(body == null ? '' : typeof body === 'string' ? body : JSON.stringify(body));
    for (let o = 0; o < bytes.length; o += BODY_PIECE) {
      r = await this.guard(d.controlTransferOut(this.setup(2), bytes.subarray(o, Math.min(bytes.length, o + BODY_PIECE))), path);
      if (r.status !== 'ok') throw new Error('USB: ' + r.status);
    }
    r = await this.guard(d.controlTransferOut(this.setup(3)), path);
    if (r.status !== 'ok') throw new Error('USB: ' + r.status);
    const st = await this.guard(d.controlTransferIn(this.setup(4), 5), path);
    if (st.status !== 'ok' || !st.data || st.data.byteLength < 5) throw new Error('USB: no status for ' + path);
    const sv = new DataView(st.data.buffer, st.data.byteOffset, st.data.byteLength);
    if (sv.getUint8(0) !== 1) throw new Error('The controller doesn\'t know ' + path + ' (older firmware?)');
    const n = sv.getUint32(1, true), out = new Uint8Array(n);
    for (let off = 0; off < n;) {
      const got = await this.guard(d.controlTransferIn(this.setup(5, off), Math.min(4096, n - off)), path);
      const chunk = new Uint8Array(got.data.buffer, got.data.byteOffset, got.data.byteLength);
      if (chunk.length === 0) break;
      out.set(chunk, off); off += chunk.length;
    }
    const text = new TextDecoder().decode(out);
    return text ? JSON.parse(text) : {};
  }

  call(path, body) {
    const p = this.chain.then(() => this.raw(path, body));
    this.chain = p.catch(() => { });
    return p;
  }
  get(path) { return this.call(path, null); }
  post(path, body) { return this.call(path, body); }
}

// ------------------------------------------------------------------ a fake controller for trying the app (?demo=gp or ?demo=gp-platform)
export class GpDemo {
  constructor(platform, gs = true) {
    this.platform = platform; this.gs = gs;
    const pins = {};
    const acts = platform
      ? { 10: 7, 11: 8, 12: 12, 13: 11, 6: 5, 7: 6, 8: 10, 9: 9, 17: 14, 16: 13, 20: 15, 21: 16, 22: 17, 15: 17, 2: 1, 3: 2, 5: 3, 4: 4, 27: 18, 26: -10, 19: -10, 18: -10 }
      : { 10: 7, 11: 8, 12: 10, 13: 9, 6: 5, 7: 6, 8: 12, 9: 11, 17: 14, 16: 13, 20: 15, 21: 16, 22: 18, 18: 17, 19: 18, 15: 17, 2: 1, 3: 2, 5: 3, 4: 4 };
    for (let p = 0; p < 30; p++) pins['pin' + String(p).padStart(2, '0')] = { action: acts[p] != null ? acts[p] : -10, customButtonMask: 0, customDpadMask: 0 };
    this.pins = pins; this.profiles = { alternativePinMappings: [] };
    // @M{
    // the M Platform (XInput layout): the "A" button, Bumper and L3 are L3, and its C-stick pins (30-33) are fixed
    if (!gs && platform) Object.assign(acts, { 19: 17, 18: 17, 15: -10, 26: -10, 27: -10, 30: -10, 31: -10, 32: -10, 33: -10 });
    if (!gs) for (let p = 0; p < 34; p++) pins['pin' + String(p).padStart(2, '0')] = { action: acts[p] != null ? acts[p] : -10, customButtonMask: 0, customDpadMask: 0 };
    // @M}
    this.cal = { s1cal: false, s2cal: false, s1inv: 0, s2inv: 0, s1en: true, s2en: true, rumbleEnabled: true, tcal: false, tidle: 0, tpressed: 0, triggerInvert: 1 };
    this.theme = { enabled: true }; this.led = { dataPin: 14, ledButtonMap: {} };
    const order = ['L1', 'R1', 'B2', 'B1', 'B3', 'B4', 'R2', 'L2'];
    order.forEach((k, i) => { this.led.ledButtonMap[k] = i; this.theme[k] = { u: 0x0000ff, d: 0xffffff }; });
    this.padLed = { mode: 0, brightness: 5, brightnessSteps: 5 };
    this.gamepad = { socdMode: 1, fourWayMode: false, debounceDelay: 5, profileNumber: 1 };
    this.addons = { TurboInputEnabled: false, turboShotCount: 5, inner_deadzone: 0, outer_deadzone: 100, forced_circularity: true, inner_deadzone2: 0, outer_deadzone2: 100, forced_circularity2: true };   // round gates, like the GS firmware's defaults
    this.t0 = performance.now();
  }
  async open() { }
  async close() { }
  async get(path) { return this.handle(path, null); }
  async post(path, body) { return this.handle(path, body); }
  handle(path, body) {
    const c = o => JSON.parse(JSON.stringify(o));
    switch (path) {
      case '/api/getFirmwareVersion': return { version: 'demo', boardConfigLabel: (this.gs ? 'PadboxGS' : 'PadboxM') + (this.platform ? 'Platform' : 'Essential') };   // @M
      // @GS case '/api/getFirmwareVersion': return { version: 'demo', boardConfigLabel: this.platform ? 'PadboxGSPlatform' : 'PadboxGSEssential' };
      case '/api/getPinMappings': return c(this.pins);
      case '/api/setPinMappings': this.pins = c(body); return c(body);
      case '/api/getProfileOptions': return c(this.profiles);
      case '/api/setProfileOptions': this.profiles = c(body); return c(body);
      case '/api/getCalibration': return c(this.cal);
      case '/api/setCalibration': Object.assign(this.cal, body); return c(this.cal);
      case '/api/getCustomTheme': return c(this.theme);
      case '/api/setCustomTheme': this.theme = c(body); return c(body);
      case '/api/getLedOptions': return c(this.led);
      case '/api/setLedOptions': this.led = c(body); return c(body);
      case '/api/getPadboxLed': return c(this.padLed);
      case '/api/setPadboxLed': Object.assign(this.padLed, body); return c(this.padLed);
      case '/api/getGamepadOptions': return c(this.gamepad);
      case '/api/setGamepadOptions': this.gamepad = c(body); return c(body);
      case '/api/getAddonsOptions': return c(this.addons);
      case '/api/setAddonsOptions': this.addons = c(body); return c(body);
      case '/api/getConfig': return { demo: true, pins: this.pins };
      case '/api/setConfig': return { success: true };
      case '/api/reboot': return { success: true };
      case '/api/getLiveState': {
        const t = (performance.now() - this.t0) / 1000, a = t * 0.5;
        return { gpio: 0, gpioHi: 0, adc: [Math.round(2048 + Math.sin(a) * 1400), Math.round(2048 - Math.cos(a) * 1400), this.platform ? -1 : 2048, this.platform ? -1 : 2048,
          this.gs ? -1 : Math.round(2900 - (0.5 + 0.5 * Math.sin(t * 1.3)) * 1600)] };
      }
    }
    return {};
  }
}
