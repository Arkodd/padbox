// HOJA2: the config blocks' fields, the outputs of every mode, the button mapping and the PadBox GS layouts - a
// port of the desktop HOJA2 PadBox Calibrator (hoja-device-fw-2350\tools\PadBoxCalibrator\Program.cs).

// ------------------------------------------------------------------ little-endian access into the raw blocks
const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const set16 = (b, o, v) => { b[o] = v & 255; b[o + 1] = (v >> 8) & 255; };
const f32 = (b, o) => new DataView(b.buffer, b.byteOffset).getFloat32(o, true);
const setF32 = (b, o, v) => new DataView(b.buffer, b.byteOffset).setFloat32(o, v, true);

export const VERSIONS = { analog: 0x14, gamepad: 0x14, rgb: 0x12, input: 0x15, imu: 0x12 };

// imuConfig_s (32 bytes): disabled at 13, gyro sensitivity % X/Y/Z at 14-16, accelerometer sensitivity % at 17-19
export const Imu = {
  disabled: b => b[13] !== 0, setDisabled: (b, v) => { b[13] = v ? 1 : 0; },
  gyroSens: (b, axis) => b[14 + axis], setGyroSens: (b, axis, v) => { b[14 + axis] = v; },
  accelSens: (b, axis) => b[17 + axis], setAccelSens: (b, axis, v) => { b[17 + axis] = v; },
};
// hapticConfig_s (8 bytes): haptic_strength 0..255 at 1 (0 = rumble off)
export const Haptic = { strength: b => b[1], setStrength: (b, v) => { b[1] = v; } };

// analogConfig_s (1024 bytes)
export const Analog = {
  // [1]: 1 = both sticks calibrated, 2 = only the left one, 4 = only the right one (one-stick calibration)
  calibrationSet: b => b[1] === 1,
  stickCalibrated: (b, right) => b[1] === 1 || (b[1] !== 0xff && (b[1] & (right ? 4 : 2)) !== 0),
  slotOff: (right, i) => (right ? 10 + 16 * 21 : 10) + i * 21,
  slotOutAngle: (b, right, i) => f32(b, Analog.slotOff(right, i) + 4),
  slotEnabled: (b, right, i) => b[Analog.slotOff(right, i) + 20],
  setSlotIn(b, right, i, angle, dist) { const o = Analog.slotOff(right, i); setF32(b, o, angle); setF32(b, o + 12, dist); },
  nearestSlot(b, right, angle) {
    let best = -1, bd = 999;
    for (let i = 0; i < 16; i++) {
      if (!Analog.slotEnabled(b, right, i)) continue;
      let d = Math.abs(Analog.slotOutAngle(b, right, i) - angle) % 360; if (d > 180) d = 360 - d;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  },
  inv: (b, off) => (u16(b, off) & 1) !== 0,                       // 2 lx, 4 ly, 6 rx, 8 ry
  setInv: (b, off, v) => set16(b, off, (u16(b, off) & ~1) | (v ? 1 : 0)),
  deadzone: (b, right) => u16(b, right ? 684 : 682), setDeadzone: (b, right, v) => set16(b, right ? 684 : 682, v),
  outer: (b, right) => u16(b, right ? 690 : 688), setOuter: (b, right, v) => set16(b, right ? 690 : 688, v),
  snap: (b, right) => u16(b, right ? 694 : 692), setSnap: (b, right, v) => set16(b, right ? 694 : 692, v),
  exp: (b, right) => b[right ? 697 : 696], setExp: (b, right, v) => { b[right ? 697 : 696] = v; },
  disabled: (b, right) => b[right ? 700 : 699] === 1, setDisabled: (b, right, v) => { b[right ? 700 : 699] = v ? 1 : 0; },
};
// rgbConfig_s (256 bytes)
export const Rgb = {
  mode: b => b[1], setMode: (b, v) => { b[1] = v; },
  speed: b => u16(b, 2), setSpeed: (b, v) => set16(b, 2, v),
  color: (b, i) => (b[4 + i * 4] | (b[5 + i * 4] << 8) | (b[6 + i * 4] << 16)) & 0xffffff,
  setColor(b, i, c) { b[4 + i * 4] = c & 255; b[5 + i * 4] = (c >> 8) & 255; b[6 + i * 4] = (c >> 16) & 255; b[7 + i * 4] = 0; },
  brightness: b => u16(b, 132), setBrightness: (b, v) => set16(b, 132, v),
  idleGlow: b => b[134], setIdleGlow: (b, v) => { b[134] = v; },
};
// gamepadConfig_s: default_mode at 1
export const Gamepad = { mode: b => b[1], setMode: (b, v) => { b[1] = v; } };

// inputConfig_s: version, then profiles of 36 slots of 5 bytes: u16 {mode:3, static:13}, u16 threshold, s8 code
export const INPUTS = 36;
const off = (p, i) => 1 + p * INPUTS * 5 + i * 5;
export const Input = {
  code: (b, p, i) => { const v = b[off(p, i) + 4]; return v > 127 ? v - 256 : v; },
  setCode: (b, p, i, c) => { b[off(p, i) + 4] = c & 255; },
  stat: (b, p, i) => u16(b, off(p, i)) >> 3,
  mode: (b, p, i) => u16(b, off(p, i)) & 7,
  setModeStatic: (b, p, i, mode, st) => set16(b, off(p, i), (mode & 7) | ((st & 0x1fff) << 3)),
  threshold: (b, p, i) => u16(b, off(p, i) + 2),
  setThreshold: (b, p, i, v) => set16(b, off(p, i) + 2, v),
};

// ------------------------------------------------------------------ modes and their outputs
export const IN = { Unused: 0, Digital: 1, Hover: 2, Joystick: 3 };
export const IN_TRIGGER = 11;   // INPUT_CODE_LT_ANALOG: the analog trigger
const T = { D: 1, H: 2, J: 3, P: 4 };
export const PROFILES = ['Switch Pro', 'XInput (Xbox / PC)', 'SNES', 'N64', 'GameCube / Slippi', 'SInput'];
export const MODES = [['Switch Pro', 0], ['XInput (Xbox / PC)', 1], ['Slippi', 2], ['GameCube', 3], ['N64', 4], ['SNES', 5], ['SInput', 6]];
export function profileOfMode(m) { return { 1: 1, 2: 4, 3: 4, 4: 3, 5: 2, 6: 5 }[m] || 0; }
export const RGB_MODES = ['Authentic (era colors)', 'Static', 'Rainbow', 'Reactive', 'Fairy'];

const Dpad = ['D-pad up|Up|P', 'D-pad down|Dn|P', 'D-pad left|Lt|P', 'D-pad right|Rt|P'];
const LStick = ['Left stick right|LX+|J', 'Left stick left|LX-|J', 'Left stick up|LY+|J', 'Left stick down|LY-|J'];
const RStick = ['Right stick right|RX+|J', 'Right stick left|RX-|J', 'Right stick up|RY+|J', 'Right stick down|RY-|J'];
function parse(...groups) {
  return groups.flat().map(s => { const f = s.split('|'); return { name: f[0], short: f[1] || f[0], type: T[f[2]] || T.D }; });
}
export const OUTPUTS = [
  parse(['A', 'B', 'X', 'Y'], Dpad, ['L', 'R', 'ZL', 'ZR', 'Plus (+)|+', 'Minus (-)|-', 'Home', 'Capture|Cap', 'Left stick click|LS', 'Right stick click|RS'], LStick, RStick),
  parse(['A', 'B', 'X', 'Y'], Dpad, ['LB', 'RB', 'Start', 'Back', 'Guide', 'Left stick click|LS', 'Right stick click|RS', 'Left trigger|LT|H', 'Right trigger|RT|H'], LStick, RStick),
  parse(['A', 'B', 'X', 'Y'], Dpad, ['L', 'R', 'Start', 'Select|Sel']),
  parse(['A', 'B', 'C-up|C-Up', 'C-down|C-Dn', 'C-left|C-Lt', 'C-right|C-Rt'], Dpad, ['L', 'R', 'Z', 'Start'], LStick),
  parse(['A', 'B', 'X', 'Y'], Dpad, ['Start', 'Z', 'L', 'R', 'L (analog)|L~|H', 'R (analog)|R~|H'], LStick, ['C-stick right|CX+|J', 'C-stick left|CX-|J', 'C-stick up|CY+|J', 'C-stick down|CY-|J']),
  parse(['South|S', 'East|E', 'West|W', 'North|N'], Dpad,
    ['LB', 'RB', 'Left trigger (digital)|LT', 'Left trigger (analog)|LT~|H', 'Right trigger (digital)|RT', 'Right trigger (analog)|RT~|H',
      'Left paddle 1|LP1', 'Right paddle 1|RP1', 'Left paddle 2|LP2', 'Right paddle 2|RP2', 'Start', 'Select|Sel', 'Guide', 'Share',
      'Misc 3 (power)|M3', 'Misc 4|M4', 'Touchpad 1|TP1', 'Touchpad 2|TP2', 'Left stick click|LS'], LStick, ['Right stick click|RS'], RStick, ['Misc 5|M5', 'Misc 6|M6']),
];

// Points an input at an output, choosing the output mode the way mapper.c's _mapper_set_defaults does.
export function assign(b, p, input, inType, code) {
  Input.setCode(b, p, input, code);
  if (code < 0 || code >= OUTPUTS[p].length) return;
  const outType = OUTPUTS[p][code].type;
  let mode = 0;
  if (inType === IN.Hover || inType === IN.Joystick) mode = outType === T.P ? 1 : (outType === T.H || outType === T.J) ? 2 : (inType === IN.Hover ? 1 : 0);
  const st = Input.stat(b, p, input);
  Input.setModeStatic(b, p, input, mode, st === 0 ? 0x1000 : st);
  if (Input.threshold(b, p, input) === 0) Input.setThreshold(b, p, input, 2048);
}

// The board's input slots (board_config.h HOJA_INPUT_SLOTS), if the controller doesn't send its own list.
export function defaultInputTypes(platform, gs = true) {
  const t = new Array(INPUTS).fill(IN.Unused);
  if (gs && platform) {
    for (const i of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 15, 18, 19, 20, 21, 32, 33, 34, 35]) t[i] = IN.Digital;
    for (let i = 27; i <= 30; i++) t[i] = IN.Joystick;
  } else if (gs) {
    for (const i of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 15, 18, 19, 20, 21, 26, 31]) t[i] = IN.Digital;
    for (let i = 27; i <= 35; i++) if (i !== 31) t[i] = IN.Joystick;
  }
  return t;
}

// Demo only: roughly each mode's defaults (pairs of input code, output code).
const DEMO_MAPS = [
  [0, 1, 1, 0, 2, 3, 3, 2, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 12, 11, 15, 8, 18, 12, 19, 13, 20, 14, 21, 15, 26, 16, 31, 17, 27, 18, 28, 19, 29, 20, 30, 21, 32, 22, 33, 23, 34, 24, 35, 25],
  [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 15, 12, 16, 15, 8, 18, 10, 19, 11, 20, 12, 26, 13, 31, 14, 27, 17, 28, 18, 29, 19, 30, 20, 32, 21, 33, 22, 34, 23, 35, 24],
  [0, 1, 1, 0, 2, 3, 3, 2, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 18, 10, 19, 11],
  [0, 0, 1, 1, 4, 6, 5, 7, 6, 8, 7, 9, 8, 10, 9, 11, 10, 12, 18, 13, 27, 14, 28, 15, 29, 16, 30, 17, 32, 5, 33, 4, 34, 2, 35, 3],
  [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 18, 8, 9, 9, 10, 10, 12, 11, 27, 14, 28, 15, 29, 16, 30, 17, 32, 18, 33, 19, 34, 20, 35, 21],
  null,
];
// GameCube on a Platform (GS and M): the firmware's own defaults (board_config.h HOJA_INPUT_DEFAULTS_GAMECUBE), the same
// layout as PhobGCC: 1P R, 2P Y, 3P R analog 10%, 4P R analog 50%, 1K B, 2K X, 3K Z, Bumper L, "A" button A, Start,
// the D-pad, the stick and the C-stick. [input, output, analog amount (4096 = 100%)]
const DEMO_GC_PLATFORM = [[2, 11], [3, 3], [9, 13, 410], [8, 13, 2048], [0, 1], [1, 2], [12, 9], [15, 10], [14, 0],
  [4, 4], [5, 5], [6, 6], [7, 7], [18, 8], [27, 14], [28, 15], [29, 16], [30, 17], [32, 18], [33, 19], [34, 20], [35, 21]];
export function demoDefaults(b, p, platform, gs = true) {
  const types = defaultInputTypes(platform, gs);
  for (let i = 0; i < INPUTS; i++) Input.setCode(b, p, i, -1);
  if (p === 4 && platform) {
    for (const [i, code, amt] of DEMO_GC_PLATFORM) if (types[i]) {
      assign(b, p, i, types[i], code);
      if (amt) Input.setModeStatic(b, p, i, Input.mode(b, p, i), amt);
    }
    return;
  }
  const m = DEMO_MAPS[p];
  if (!m) { for (let i = 0; i < INPUTS; i++) if (types[i]) assign(b, p, i, types[i], i); return; }
  for (let k = 0; k < m.length; k += 2) if (types[m[k]]) assign(b, p, m[k], types[m[k]], m[k + 1]);
}

// ------------------------------------------------------------------ the drawings (same positions as the GP2040-CE app)
function S(name, x, y, rx, ry) { return { name, label: name, x, y, rx, ry, kind: 0, led: -1, input: -1 }; }
function arm(name, x, y, r, a0, inner, outer, half) { return { name, label: name, x, y, rx: r, ry: r, kind: 1, a0, armIn: inner, armOut: outer, armHalf: half, led: -1, input: -1 }; }
function poly(name, pts) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return { name, label: name, kind: 2, poly: pts, x: (x0 + x1) / 2, y: (y0 + y1) / 2, rx: (x1 - x0) / 2, ry: (y1 - y0) / 2, led: -1, input: -1 };
}
const click = (name, x, y, r, input) => ({ name, label: name, x, y, rx: r, ry: r, kind: 3, led: -1, input });
const L = (s, led, label) => { s.led = led; s.label = label; return s; };
const In = (s, input) => { s.input = input; return s; };
function gsPill(cx, cy, len) {
  const wid = 22.7, a = -57.5 * Math.PI / 180, ux = Math.cos(a), uy = Math.sin(a), r = wid / 2, half = len / 2 - r, p = [];
  for (let end = 0; end < 2; end++) {
    const ex = cx + (end === 0 ? half : -half) * ux, ey = cy + (end === 0 ? half : -half) * uy;
    for (let i = 0; i <= 12; i++) { const t = a + (end === 0 ? -Math.PI / 2 : Math.PI / 2) + Math.PI * i / 12; p.push([ex + r * Math.cos(t), ey + r * Math.sin(t)]); }
  }
  return p;
}
function gsTab(dx, dy) {
  return [[227, 86], [227, 77], [230, 74], [238, 69], [246, 65], [254, 62], [262, 60], [270, 58.5], [278, 57], [286, 56.5],
    [294, 56], [302, 56.5], [310, 56.5], [318, 57.5], [326, 59], [334, 60.5], [342, 63], [343, 73.5], [334, 73.5], [310, 74.5],
    [286, 75.5], [262, 78.5], [246, 81], [230, 85.5]].map(([x, y]) => [x + dx, y + dy]);
}

export function gsEssential() {
  const G = 81;
  return {
    name: 'GS Essential', board: 'GS Essential', image: 'assets/gs_essential_trace.png', w: 1530, h: 1200,
    spots: [
      In(L(S('1P', 666, 372, G, G), 0, '1P'), 2), In(L(S('2P', 834, 296, G, G), 1, '2P'), 3),
      In(L(S('3P', 1021, 296, G, G), 2, '3P'), 9), In(L(S('4P', 1200, 347, G, G), 3, '4P'), 8),
      In(L(S('1K', 682, 557, G, G), 4, '1K'), 0), In(L(S('2K', 851, 480, G, G), 5, '2K'), 1),
      In(L(S('3K', 1037, 480, G, G), 6, '3K'), 12), In(L(S('4K', 1216, 531, G, G), 7, '4K'), 10),
      In(poly('Start', gsPill(556.5, 162.9, 40.5)), 18), In(poly('Select', gsPill(618.5, 162.8, 40.5)), 19),
      In(poly('Home', gsPill(681.4, 161.8, 40.5)), 20), In(poly('Touchpad', gsPill(743.4, 162.7, 40.5)), 21),
      In(poly('Bumper', gsTab(11, 23)), 15),
      In(arm('D-pad up', 263, 268, 81, 225, 18, 80.5, 25.5), 4), In(arm('D-pad right', 263, 268, 81, 315, 18, 80.5, 25.5), 7),
      In(arm('D-pad down', 263, 268, 81, 45, 18, 80.5, 25.5), 5), In(arm('D-pad left', 263, 268, 81, 135, 18, 80.5, 25.5), 6),
      click('Left stick click (L3)', 415, 422, 58, 26), click('Right stick click (R3)', 560, 763, 58, 31),
    ],
    sticks: [{ x: 415, y: 422, r: 58 }, { x: 560, y: 763, r: 58 }],
  };
}

export function gsPlatform() {
  const G = 78, pl = 35.5;
  return {
    name: 'GS Platform', board: 'GS Platform', image: 'assets/gs_platform_trace.png', w: 1530, h: 1200,
    spots: [
      In(L(S('1P', 795, 349, G, G), 0, '1P'), 2), In(L(S('2P', 958, 275, G, G), 1, '2P'), 3),
      In(L(S('3P', 1137, 275, G, G), 2, '3P'), 9), In(L(S('4P', 1310, 324, G, G), 3, '4P'), 8),
      In(L(S('1K', 815, 528, G, G), 4, '1K'), 0), In(L(S('2K', 977, 454, G, G), 5, '2K'), 1),
      In(L(S('3K', 1157, 454, G, G), 6, '3K'), 12), In(L(S('4K', 1330, 503, G, G), 7, '4K'), 10),
      In(poly('Start', gsPill(552.4, 147.3, pl)), 18), In(poly('Select', gsPill(613.2, 147.2, pl)), 19),
      In(poly('Home', gsPill(674.0, 147.2, pl)), 20), In(poly('Touchpad', gsPill(734.6, 147.2, pl)), 21),
      In(poly('Bumper', gsTab(4, 4)), 15),
      In(arm('D-pad up', 429, 391, 82, 225, 18, 81.5, 25.5), 4), In(arm('D-pad right', 429, 391, 82, 315, 18, 81.5, 25.5), 7),
      In(arm('D-pad down', 429, 391, 82, 45, 18, 81.5, 25.5), 5), In(arm('D-pad left', 429, 391, 82, 135, 18, 81.5, 25.5), 6),
      In(L(S('C-stick up', 697, 706, G, G), 9, 'C-Up'), 34), In(L(S('C-stick right', 865, 738, G, G), 12, 'C-Rt'), 32),
      In(L(S('C-stick left', 579, 835, G, G), 11, 'C-Lt'), 33), In(L(S('C-stick down', 641, 1002, G, G), 10, 'C-Dn'), 35),
      In(L(S('A button', 760, 873, G, G), 8, 'A'), 14),
    ],
    sticks: [{ x: 244, y: 262, r: 56 }],
  };
}

