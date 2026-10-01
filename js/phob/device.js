// PhobGCC over Web Serial: the PadBox's USB tool mode (hold Start while plugging in) is a serial port that
// streams "F,..." status lines every 20 ms and answers text commands (usbToolLoop in PhobGCC-PadBox src/main.cpp):
//   B <mask>      virtual buttons (the calibration wizard runs on PhobGCC's own button combos)
//   M / N <42>    ask for / set the button map (21 outputs, then 21 percents)
//   L / L <40>    ask for / set the LED colors (13 x r g b, then brightness %)
//   S / S <19>    ask for / set the stick-response settings
//   I <mask>      flip stick axes;   BOOTSEL   restart into the USB bootloader

export class PhobSerial {
  constructor(port) { this.port = port; this.alive = false; this.onLine = null; this.onLost = null; }
  async open() {
    await this.port.open({ baudRate: 115200 });
    try { await this.port.setSignals({ dataTerminalReady: true }); } catch (e) { }   // the firmware only talks once the port is "open"
    this.writer = this.port.writable.getWriter();
    this.alive = true;
    this.loop();
  }
  async loop() {
    const dec = new TextDecoder();
    let buf = '';
    try {
      while (this.alive && this.port.readable) {
        this.reader = this.port.readable.getReader();
        try {
          for (;;) {
            const { value, done } = await this.reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            let i;
            while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line && this.onLine) this.onLine(line); }
            if (buf.length > 4096) buf = '';
          }
        } finally { try { this.reader.releaseLock(); } catch (e) { } }
      }
    } catch (e) { }
    if (this.alive) { this.alive = false; if (this.onLost) this.onLost(); }
  }
  async send(line) { if (!this.alive) return; try { await this.writer.write(new TextEncoder().encode(line + '\n')); } catch (e) { } }
  async close() {
    this.alive = false;
    try { await this.writer.write(new TextEncoder().encode('B 0\n')); } catch (e) { }
    try { this.reader && await this.reader.cancel(); } catch (e) { }
    try { this.writer.releaseLock(); } catch (e) { }
    try { await this.port.close(); } catch (e) { }
  }
}

// ------------------------------------------------------------------ a fake controller for trying the app (?demo=phob): a GS Platform
export class PhobDemo {
  constructor(board = 'GS Platform') {
    this.board = board; this.gs = board === 'GS Platform';
    this.onLine = null; this.alive = false;
    this.map = [6, 3, 6, 6, 1, 2, 4, 12, 7, 12, 12, 12, 0, 5, 12, 12, 8, 9, 10, 11, 12, 100, 100, 10, 50, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 27];
    this.led = []; for (let i = 0; i < (this.gs ? 13 : 8); i++) this.led.push(0, 0, 255); this.led.push(100);
    this.settings = [6, 6, 100, 100, 4, 4, 0, 0, 5, 5, 0, 0, 0, 0, 9, 0, 0, 49, 49];
    this.step = -1; this.locked = 1; this.inv = 0; this.mask = 0; this.since = 0; this.t = 0;
    this.trig = { cal: 0, rest: 0, full: 0, seq: 0, code: 0, tracking: 0, max: 0, restNew: 0 };
  }
  async open() {
    this.alive = true;
    this.timer = setInterval(() => {
      this.t += 0.02;
      const a = this.t * 0.5, rx = Math.sin(a) * 0.3, ry = Math.cos(a) * 0.3;
      const ax = 127 + Math.round(Math.sin(a) * 80) * (this.inv & 1 ? -1 : 1), ay = 127 + Math.round(Math.cos(a) * 80) * (this.inv & 2 ? -1 : 1);   // the flips act on the output, as in the firmware
      const cx = 127, cy = 127;
      const T = this.trig, raw = this.gs ? 0 : Math.round(600 + (0.5 + 0.5 * Math.sin(this.t * 1.1)) * 2800);
      if (T.tracking) T.max = Math.max(T.max, raw);
      const level = this.gs ? 0 : Math.max(0, Math.min(255, Math.round((raw - (T.cal ? T.rest : 600)) * 255 / ((T.cal ? T.full : 3000) - (T.cal ? T.rest : 600)))));
      this.emit(`F,${this.step},0,${this.locked},1,${ax},${ay},${cx},${cy},${level},0,0,${Math.round((0.5 + rx) * 10000)},${Math.round((0.5 + ry) * 10000)},${Math.round((0.5 + (cx - 127) / 400) * 10000)},${Math.round((0.5 + (cy - 127) / 400) * 10000)},${this.inv},0,` +
        `${raw},${level},${T.cal},${T.rest},${T.full},${T.seq},${T.code},1,${T.tracking},${T.max},${T.tracking ? T.restNew : 0}`);
    }, 20);
  }
  async close() { this.alive = false; clearInterval(this.timer); }
  emit(l) { if (this.onLine) this.onLine(l); }
  async send(line) {
    const [c, ...rest] = line.split(' '), v = rest.map(Number);
    if (c === 'M') this.emit('M,' + this.map.join(','));
    else if (c === 'N') { this.map = v; this.emit('M,' + this.map.join(',')); }
    else if (c === 'L') { if (v.length > 1) this.led = v; this.emit('LC,' + this.led.join(',')); }
    else if (c === 'S') { if (v.length > 1) this.settings = v; this.emit('S,' + this.settings.join(',')); }
    else if (c === 'I') this.inv = v[0] & 15;
    else if (c === 'V') this.emit('V,PadBox GS Calibrator');
    else if (c === 'B') this.buttons(v[0] | 0);
  }
  // a rough copy of the button-combo wizard, enough to make the buttons do something
  buttons(mask) {
    // like the firmware, a combo counts once it's let go (held at least 150 ms): robust to the page's timers slowing down
    const now = performance.now();
    const A = 1, B = 2, X = 4, Y = 8, Z = 16, L = 32, R = 64, S = 128;
    if (mask === this.mask) return;
    const held = this.mask, dur = now - this.since;
    this.mask = mask; this.since = now;
    if (!held || dur < 150) return;
    if (held === (A | X | Y | S)) this.locked = dur > 1000 ? 0 : 1;   // held over a second unlocks, a short press locks
    else if (!this.locked && held === (A | X | Y | L)) this.step = 0;
    else if (this.step >= 0 && held === A) this.step = this.step >= 43 ? -1 : this.step + 1;
    else if (this.step > 0 && held === Z) this.step--;
    else if (this.step >= 0 && held === S) this.step = 32;
  }

}
