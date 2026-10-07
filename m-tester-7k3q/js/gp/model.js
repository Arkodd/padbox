// GP2040-CE: the PadBox layouts and what the controller holds - a port of the desktop PadBox Configurator's
// Layouts / Acts / Model (GP2040-CE\tools\PadBoxConfigurator\Program.cs). Positions are in pixels of the 1530 x 1200
// drawings (assets/*_trace.png).

// ------------------------------------------------------------------ button shapes on the drawings
function spot(name, pin, x, y, rx, ry, label) { return { name, pin, x, y, rx, ry, label, kind: 0 }; }
function arm(name, pin, x, y, r, a0, half) { return { name, pin, x, y, rx: r, ry: r, kind: 1, a0, plusHalf: half }; }
function poly(name, pin, pts, top) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return { name, pin, kind: 2, poly: pts, x: (x0 + x1) / 2, y: (y0 + y1) / 2, rx: (x1 - x0) / 2, ry: (y1 - y0) / 2, labelOnTop: !!top };
}

// One of the GS's menu buttons: a pill tilted 57.5 degrees (see GsPill in the desktop app).
function gsPill(cx, cy, len) {
  const wid = 22.7, a = -57.5 * Math.PI / 180, ux = Math.cos(a), uy = Math.sin(a), r = wid / 2, half = len / 2 - r;
  const p = [];
  for (let end = 0; end < 2; end++) {
    const ex = cx + (end === 0 ? half : -half) * ux, ey = cy + (end === 0 ? half : -half) * uy;
    for (let i = 0; i <= 12; i++) {
      const t = a + (end === 0 ? -Math.PI / 2 : Math.PI / 2) + Math.PI * i / 12;
      p.push([ex + r * Math.cos(t), ey + r * Math.sin(t)]);
    }
  }
  return p;
}

// The GS's top-left tab (the Bumper, NB1 on the PCB), traced along the middle of its drawn line.
function gsTab(dx, dy) {
  const p = [[227, 86], [227, 77], [230, 74], [238, 69], [246, 65], [254, 62], [262, 60], [270, 58.5], [278, 57], [286, 56.5],
    [294, 56], [302, 56.5], [310, 56.5], [318, 57.5], [326, 59], [334, 60.5], [342, 63], [343, 73.5], [334, 73.5], [310, 74.5],
    [286, 75.5], [262, 78.5], [246, 81], [230, 85.5]];
  return p.map(([x, y]) => [x + dx, y + dy]);
}

// What the boards do out of the box (BoardConfig.h)
function commonDefaults() {
  return { 10: 7, 11: 8, 12: 10, 13: 9, 6: 5, 7: 6, 8: 12, 9: 11, 17: 14, 16: 13, 20: 15, 21: 16, 22: 9, 18: 17, 2: 1, 3: 2, 5: 3, 4: 4 };
}

// The PadBox GS Essential (configs/PadboxGSEssential). LED chain: 4K 3K 2K 1K 1P 2P 3P 4P.
export function gsEssential() {
  const d = commonDefaults(); d[22] = 18; d[19] = 18; d[15] = 17;
  const G = 81;
  return {
    name: 'GS Essential', board: 'GS Essential', image: 'assets/gs_essential_trace.png', w: 1530, h: 1200,
    phys: [
      ['1P', 10, 4], ['2P', 11, 5], ['3P', 12, 6], ['4P', 13, 7], ['1K', 6, 3], ['2K', 7, 2], ['3K', 8, 1], ['4K', 9, 0],
      ['Start', 17, -1], ['Select', 16, -1], ['Home', 20, -1], ['Touchpad', 21, -1],
      ['Bumper', 22, -1], ['Left stick click', 18, -1], ['Right stick click', 19, -1],
      ['D-pad Up', 2, -1], ['D-pad Down', 3, -1], ['D-pad Left', 5, -1], ['D-pad Right', 4, -1],
    ].map(([name, pin, led]) => ({ name, pin, led })),
    defaults: d,
    spots: [
      spot('1P', 10, 666, 372, G, G, true), spot('2P', 11, 834, 296, G, G, true),
      spot('3P', 12, 1021, 296, G, G, true), spot('4P', 13, 1200, 347, G, G, true),
      spot('1K', 6, 682, 557, G, G, true), spot('2K', 7, 851, 480, G, G, true),
      spot('3K', 8, 1037, 480, G, G, true), spot('4K', 9, 1216, 531, G, G, true),
      poly('Start', 17, gsPill(556.5, 162.9, 40.5), true), poly('Select', 16, gsPill(618.5, 162.8, 40.5), true),
      poly('Home', 20, gsPill(681.4, 161.8, 40.5), true), poly('Touchpad', 21, gsPill(743.4, 162.7, 40.5), true),
      poly('Bumper', 22, gsTab(11, 23)),
      arm('D-pad Up', 2, 263, 268, 81, 225, 25.5), arm('D-pad Right', 4, 263, 268, 81, 315, 25.5),
      arm('D-pad Down', 3, 263, 268, 81, 45, 25.5), arm('D-pad Left', 5, 263, 268, 81, 135, 25.5),
    ],
    sticks: [{ x: 415, y: 422, r: 58, clickPin: 18 }, { x: 560, y: 763, r: 58, clickPin: 19 }],
    noRightStick: false, sharedLeds: false,
  };
}

// The PadBox GS Platform (configs/PadboxGSPlatform): a four-button C-stick and an "A" button instead of the
// right stick. XInput layout by default.
export function gsPlatform() {
  const d = commonDefaults();
  d[12] = 12; d[13] = 11; d[8] = 10; d[9] = 9;
  d[22] = 17; d[15] = 17; d[27] = 18; d[26] = -10; d[19] = -10; d[18] = -10;
  const G = 78, pl = 35.5;
  return {
    name: 'GS Platform', board: 'GS Platform', image: 'assets/gs_platform_trace.png', w: 1530, h: 1200,
    phys: [
      ['1P', 10, 4], ['2P', 11, 5], ['3P', 12, 6], ['4P', 13, 7], ['1K', 6, 3], ['2K', 7, 2], ['3K', 8, 1], ['4K', 9, 0],
      ['Start', 17, -1], ['Select', 16, -1], ['Home', 20, -1], ['Touchpad', 21, -1],
      ['Bumper', 22, -1], ['A button', 15, 8],
      ['D-pad Up', 2, -1], ['D-pad Down', 3, -1], ['D-pad Left', 5, -1], ['D-pad Right', 4, -1],
      ['C-stick right', 19, 12], ['C-stick left', 26, 10], ['C-stick up', 27, 11], ['C-stick down', 18, 9],
    ].map(([name, pin, led]) => ({ name, pin, led })),
    defaults: d,
    spots: [
      spot('1P', 10, 795, 349, G, G, true), spot('2P', 11, 958, 275, G, G, true),
      spot('3P', 12, 1137, 275, G, G, true), spot('4P', 13, 1310, 324, G, G, true),
      spot('1K', 6, 815, 528, G, G, true), spot('2K', 7, 977, 454, G, G, true),
      spot('3K', 8, 1157, 454, G, G, true), spot('4K', 9, 1330, 503, G, G, true),
      poly('Start', 17, gsPill(552.4, 147.3, pl), true), poly('Select', 16, gsPill(613.2, 147.2, pl), true),
      poly('Home', 20, gsPill(674.0, 147.2, pl), true), poly('Touchpad', 21, gsPill(734.6, 147.2, pl), true),
      poly('Bumper', 22, gsTab(4, 4)),
      arm('D-pad Up', 2, 429, 391, 82, 225, 25.5), arm('D-pad Right', 4, 429, 391, 82, 315, 25.5),
      arm('D-pad Down', 3, 429, 391, 82, 45, 25.5), arm('D-pad Left', 5, 429, 391, 82, 135, 25.5),
      spot('C-stick up', 27, 697, 706, G, G, true), spot('C-stick right', 19, 865, 738, G, G, true),
      spot('C-stick left', 26, 579, 835, G, G, true), spot('C-stick down', 18, 641, 1002, G, G, true),
      spot('A button', 15, 760, 873, G, G, true),
    ],
    sticks: [{ x: 244, y: 262, r: 56, clickPin: -1 }],
    noRightStick: true, sharedLeds: true,
  };
}

// The E2T PadBox GS (configs/E2TPadboxGS): a GS Platform whose firmware locks three C-stick buttons off for good -
// C-up (CY+, GPIO27), C-left (CX-, GPIO26) and C-down (CY-, GPIO18). They aren't buttons here: not drawn, not
// selectable, no LED settings. The two buttons left there are called T1 (the GS Platform's "A" button, GPIO15, L3)
// and T2 (C-right, GPIO19), which is R3 by default - the function C-up has on the GS Platform. Its D-pad and stick
// are swapped against the GS Platform's, as on the GS Essential (assets/e2t_gs_trace.png): the stick where the GS
// Platform has its D-pad (185, 128 away), the D-pad in the top-left bulge where the GS Essential has it (175, 139 away).
export const E2T_LOCKED = [27, 26, 18];
const E2T_NAMES = { 15: 'T1', 19: 'T2' };
export function e2tGs() {
  const L = gsPlatform(), off = new Set(E2T_LOCKED);
  L.defaults[27] = -10; L.defaults[19] = 18;
  const rename = o => (o.pin in E2T_NAMES ? Object.assign(o, { name: E2T_NAMES[o.pin] }) : o);
  return Object.assign(L, {
    name: 'E2T GS', board: 'E2T GS', image: 'assets/e2t_gs_trace.png',
    phys: L.phys.filter(p => !off.has(p.pin)).map(rename),
    spots: L.spots.filter(s => !off.has(s.pin)).map(rename)
      .map(s => (s.kind === 1 ? Object.assign(s, { x: s.x - 175, y: s.y - 139 }) : s)),   // the D-pad's arms
    sticks: L.sticks.map(st => Object.assign(st, { x: st.x + 185, y: st.y + 128 })),
    locked: E2T_LOCKED,
  });
}

// @M{
// ------------------------------------------------------------------ the PadBox M (configs/PadboxMEssential, PadboxMPlatform)
// GPIO numbers from GPIO PADBOX M.xlsx; LED chain on the board: 1P 2P 3P 4P 4K 3K 2K 1K. Positions in the 1530 x 1200
// drawings, read off their SVGs: button rings 73.5 radius, menu buttons 16.5, stick rings 61, the D-pad plus at
// (396.8, 353.2) with arms 28.3 either side of the centre line, reaching 83.35 out.
function mBumper() {
  const p = [[197.8, 78.0], [197.8, 65.7]], p0 = [198.92, 63.34], c1 = [207.24, 56.53], c2 = [262.26, 16.23], p3 = [368.91, 43.99];
  for (let i = 0; i <= 16; i++) { const t = i / 16, u = 1 - t; p.push([0, 1].map(k => u * u * u * p0[k] + 3 * u * u * t * c1[k] + 3 * u * t * t * c2[k] + t * t * t * p3[k])); }
  p.push([370.2, 45.7], [370.2, 58.4]);
  return p;
}
const M_PHYS = [['1P', 10, 0], ['2P', 11, 1], ['3P', 12, 2], ['4P', 13, 3], ['1K', 6, 7], ['2K', 7, 6], ['3K', 8, 5], ['4K', 9, 4],
  ['Start', 17, -1], ['Select', 16, -1], ['Home', 20, -1], ['Capture', 21, -1],
  ['Bumper', 22, -1], ['Left stick click', 18, -1], ['D-pad Up', 2, -1], ['D-pad Down', 3, -1], ['D-pad Left', 5, -1], ['D-pad Right', 4, -1]];
function mSpots() {
  const R = 74;
  return [
    spot('1P', 10, 786, 324, R, R, true), spot('2P', 11, 940, 254, R, R, true), spot('3P', 12, 1110, 254, R, R, true), spot('4P', 13, 1274, 300, R, R, true),
    spot('1K', 6, 795, 505, R, R, true), spot('2K', 7, 949, 435, R, R, true), spot('3K', 8, 1119, 435, R, R, true), spot('4K', 9, 1282, 481, R, R, true),
    spot('Start', 17, 698, 121, 17, 17, false), spot('Select', 16, 759, 121, 17, 17, false), spot('Home', 20, 821, 121, 17, 17, false), spot('Capture', 21, 883, 121, 17, 17, false),
    poly('Bumper', 22, mBumper()),
    arm('D-pad Up', 2, 397, 353, 83, 225, 28.3), arm('D-pad Right', 4, 397, 353, 83, 315, 28.3), arm('D-pad Down', 3, 397, 353, 83, 45, 28.3), arm('D-pad Left', 5, 397, 353, 83, 135, 28.3),
  ];
}
export function mEssential() {
  const d = commonDefaults(); d[15] = 18; d[19] = 18;
  return {
    name: 'M Essential', board: 'M Essential', image: 'assets/essential_trace.png', w: 1530, h: 1200, m: true,
    phys: [...M_PHYS, ['Thumb', 15, -1], ['Right stick click', 19, -1]].map(([name, pin, led]) => ({ name, pin, led })),
    defaults: d,
    spots: [...mSpots(), spot('Thumb', 15, 816, 711, 74, 74, true)],
    sticks: [{ x: 254, y: 238, r: 61, clickPin: 18 }, { x: 641, y: 711, r: 61, clickPin: 19 }],
    noRightStick: false, sharedLeds: false,
  };
}
// One analog stick, a real D-pad and a five-button C-stick. GPIO30-33 are read by the high-GPIO add-on
// (BoardConfig.h), so they're fixed: C-up = R3, the others nothing. XInput layout, like the GS Platform's.
export function mPlatform() {
  const d = commonDefaults(); d[12] = 12; d[13] = 11; d[8] = 10; d[9] = 9; d[19] = 17; d[22] = 17; d[18] = 17;
  const R = 74;
  return {
    name: 'M Platform', board: 'M Platform', image: 'assets/platform_trace.png', w: 1530, h: 1200, m: true,
    phys: [...M_PHYS.map(([name, pin, led]) => ({ name, pin, led })), { name: 'A button', pin: 19, led: -1 },
      { name: 'C-stick right', pin: 30, led: -1, fixed: '-' }, { name: 'C-stick left', pin: 31, led: -1, fixed: '-' },
      { name: 'C-stick up', pin: 32, led: -1, fixed: 'R3' }, { name: 'C-stick down', pin: 33, led: -1, fixed: '-' }],
    defaults: d,
    spots: [...mSpots(),
      spot('C-stick up', 32, 690, 679, R, R, true), spot('C-stick right', 30, 858, 698, R, R, true),
      spot('C-stick left', 31, 590, 816, R, R, true), spot('C-stick down', 33, 658, 970, R, R, true), spot('A button', 19, 759, 835, R, R, true)],
    sticks: [{ x: 254, y: 238, r: 61, clickPin: 18 }],
    noRightStick: true, sharedLeds: false,
  };
}
// @M}

export function layoutFor(boardLabel) {
  const b = (boardLabel || '').toLowerCase();
  if (b.includes('e2tpadboxgs')) return e2tGs();   // before the GS checks: its label has "PadboxGS" in it too
  if (b.includes('padboxgsplatform')) return gsPlatform();
  if (b.includes('padboxgs')) return gsEssential();
  if (b.includes('platform')) return mPlatform();   // @M
  if (b.includes('essential')) return mEssential();   // @M
  return null;
}

// ------------------------------------------------------------------ GP2040-CE functions a button can have (GpioAction numbers)
export const ACTS = [
  [-10, '(nothing)', '-', null],
  [1, 'D-pad Up', 'Up', 'Up'], [2, 'D-pad Down', 'Dn', 'Down'], [3, 'D-pad Left', 'Lt', 'Left'], [4, 'D-pad Right', 'Rt', 'Right'],
  [5, 'B1  (A / Cross / B)', 'B1', 'B1'], [6, 'B2  (B / Circle / A)', 'B2', 'B2'],
  [7, 'B3  (X / Square / Y)', 'B3', 'B3'], [8, 'B4  (Y / Triangle / X)', 'B4', 'B4'],
  [9, 'L1  (LB / L1 / L)', 'L1', 'L1'], [10, 'R1  (RB / R1 / R)', 'R1', 'R1'],
  [11, 'L2  (LT / L2 / ZL)', 'L2', 'L2'], [12, 'R2  (RT / R2 / ZR)', 'R2', 'R2'],
  [13, 'S1  (Back / Select / -)', 'S1', 'S1'], [14, 'S2  (Start / Options / +)', 'S2', 'S2'],
  [15, 'A1  (Guide / PS / Home)', 'A1', 'A1'], [16, 'A2  (Touchpad / Capture)', 'A2', 'A2'],
  [17, 'L3  (left stick click)', 'L3', 'L3'], [18, 'R3  (right stick click)', 'R3', 'R3'],
  [19, 'Fn  (hotkey button)', 'Fn', null],
  [32, 'Turbo  (hold for rapid-fire)', 'Trb', null],
  [40, 'Custom combo  (several buttons at once)', 'Combo', null],   // CUSTOM_BUTTON_COMBO: see COMBO_PARTS
].map(([value, long, short, key]) => ({ value, long, short, key }));
export const act = v => ACTS.find(a => a.value === v) || null;
// What a "Custom combo" button can press, as in GP2040-CE's web config: D-pad directions (customDpadMask) and buttons
// (customButtonMask), with their bits (GamepadState.h GAMEPAD_MASK_*)
export const COMBO_PARTS = [
  ['d', 1, 'Up'], ['d', 2, 'Down'], ['d', 4, 'Left'], ['d', 8, 'Right'],
  ['b', 1, 'B1'], ['b', 2, 'B2'], ['b', 4, 'B3'], ['b', 8, 'B4'], ['b', 16, 'L1'], ['b', 32, 'R1'], ['b', 64, 'L2'], ['b', 128, 'R2'],
  ['b', 256, 'S1'], ['b', 512, 'S2'], ['b', 1024, 'L3'], ['b', 2048, 'R3'], ['b', 4096, 'A1'], ['b', 8192, 'A2'],
].map(([kind, bit, name]) => ({ kind, bit, name }));
export const comboName = c => COMBO_PARTS.filter(p => ((p.kind === 'd' ? c.d : c.b) & p.bit) !== 0).map(p => p.name).join('+');

const pinKey = p => 'pin' + String(p).padStart(2, '0');
const copy = o => JSON.parse(JSON.stringify(o == null ? {} : o));
const I = (d, k, def) => { const v = d && d[k]; if (v == null) return def; if (typeof v === 'boolean') return v ? 1 : 0; const n = Number(v); return isNaN(n) ? def : Math.trunc(n); };
const B = (d, k, def) => I(d, k, def ? 1 : 0) !== 0;

// ------------------------------------------------------------------ what the controller holds
export class Model {
  constructor() {
    this.board = ''; this.version = ''; this.layout = null;
    this.pinDoc = {}; this.profileActions = [{}, {}, {}, {}]; this.editProfile = 1; this.altDocs = [];
    this.profileCombos = [{}, {}, {}, {}];   // pin -> { b: customButtonMask, d: customDpadMask }, per profile
    this.theme = {}; this.ledOpts = {};
    this.ledU = new Array(13).fill(0x0000ff); this.ledD = new Array(13).fill(0xffffff);
    this.mode = 0; this.brightness = 5; this.steps = 5;
    this.stick = [{}, {}];
    this.gamepadDoc = {}; this.addonDoc = {};
    this.socdMode = 1; this.fourWayMode = false; this.debounceDelay = 5; this.profileNumber = 1;
    this.turboEnabled = false; this.turboShotCount = 5;
    this.stick1Enabled = true; this.stick2Enabled = true; this.rumbleEnabled = true;
    this.innerDeadzone = 0; this.outerDeadzone = 100; this.innerDeadzone2 = 0; this.outerDeadzone2 = 100;
    this.circularity = false; this.circularity2 = false;
  }
  get action() { return this.profileActions[Math.max(1, Math.min(4, this.editProfile)) - 1]; }
  actionOf(pin) { const a = this.action[pin]; return a == null ? -10 : a; }
  // a "Custom combo" button's buttons and directions, in the profile being edited
  comboOf(pin) { const c = this.profileCombos[Math.max(1, Math.min(4, this.editProfile)) - 1][pin]; return c ? { ...c } : { b: 0, d: 0 }; }
  setCombo(pin, c) { this.profileCombos[Math.max(1, Math.min(4, this.editProfile)) - 1][pin] = { b: c.b >>> 0, d: c.d >>> 0 }; }
  phys(pin) { return this.layout ? this.layout.phys.find(p => p.pin === pin) || null : null; }
  nameOfPin(pin) { const p = this.phys(pin); return p ? p.name : 'GPIO ' + pin; }

  load(s) {
    this.board = s.ver.boardConfigLabel || ''; this.version = s.ver.version || '';
    this.layout = layoutFor(this.board);
    this.pinDoc = s.pins;
    readActions(s.pins, this.profileActions[0]); readCombos(s.pins, this.profileCombos[0]);
    this.altDocs = (s.profiles && s.profiles.alternativePinMappings) || [];
    for (let i = 1; i < 4; i++) {
      const alt = this.altDocs[i - 1];
      if (alt) { readActions(alt, this.profileActions[i]); readCombos(alt, this.profileCombos[i]); }
      else { this.profileActions[i] = { ...this.profileActions[0] }; this.profileCombos[i] = JSON.parse(JSON.stringify(this.profileCombos[0])); }
    }
    this.theme = s.theme || {}; this.ledOpts = s.led || {};
    this.mode = I(s.padLed, 'mode', 0); this.brightness = I(s.padLed, 'brightness', 5); this.steps = Math.max(1, I(s.padLed, 'brightnessSteps', 5));
    this.loadCal(s.cal);
    // physical LED colors: the LED at position p shows the theme color of the function whose LED index is p
    const map = this.ledOpts.ledButtonMap;
    for (let p = 0; p < this.ledU.length; p++) {
      this.ledU[p] = 0x0000ff; this.ledD[p] = 0xffffff;
      if (!map) continue;
      for (const a of ACTS) {
        if (!a.key || map[a.key] == null || I(map, a.key, -1) !== p) continue;
        const th = this.theme[a.key];
        if (th) { this.ledU[p] = I(th, 'u', 0x0000ff); this.ledD[p] = I(th, 'd', 0xffffff); }
        break;
      }
    }
    const g = s.gamepad || {}, ad = s.addons || {};
    this.gamepadDoc = g; this.addonDoc = ad;
    this.socdMode = I(g, 'socdMode', 1); this.fourWayMode = B(g, 'fourWayMode', false);
    this.debounceDelay = I(g, 'debounceDelay', 5); this.profileNumber = Math.max(1, I(g, 'profileNumber', 1));
    this.turboEnabled = B(ad, 'TurboInputEnabled', false); this.turboShotCount = I(ad, 'turboShotCount', 5);
    // the buttons that always repeat while turbo is on (the redesign's "Assigned Buttons"): GP2040-CE's SHMUP mode
    // "always on" buttons (TurboOptions shmupAlwaysOn1..4, GAMEPAD_MASK_* bits)
    this.turboMask = B(ad, 'shmupMode', false) ? (I(ad, 'shmupAlwaysOn1', 0) | I(ad, 'shmupAlwaysOn2', 0) | I(ad, 'shmupAlwaysOn3', 0) | I(ad, 'shmupAlwaysOn4', 0)) : 0;
    this.turboMask0 = this.turboMask;
    this.innerDeadzone = I(ad, 'inner_deadzone', 0); this.outerDeadzone = I(ad, 'outer_deadzone', 100); this.circularity = B(ad, 'forced_circularity', false);
    this.innerDeadzone2 = I(ad, 'inner_deadzone2', 0); this.outerDeadzone2 = I(ad, 'outer_deadzone2', 100); this.circularity2 = B(ad, 'forced_circularity2', false);
    this.editProfile = Math.max(1, Math.min(4, this.profileNumber));
  }

  loadCal(c) {
    c = c || {};
    for (let i = 0; i < 2; i++) {
      const k = 's' + (i + 1);
      this.stick[i] = { cal: B(c, k + 'cal', false), cx: I(c, k + 'cx', 0), cy: I(c, k + 'cy', 0), minX: I(c, k + 'minx', 0), maxX: I(c, k + 'maxx', 0),
        minY: I(c, k + 'miny', 0), maxY: I(c, k + 'maxy', 0), inv: I(c, k + 'inv', 0) & 3 };
    }
    this.stick1Enabled = B(c, 's1en', true); this.stick2Enabled = B(c, 's2en', true);
    this.rumbleEnabled = B(c, 'rumbleEnabled', true);
    // @M{
    // the PadBox M's analog trigger: calibrated released / fully-pulled readings, and whether pulling lowers the reading
    this.tcal = B(c, 'tcal', false); this.tidle = I(c, 'tidle', 0); this.tpressed = I(c, 'tpressed', 0); this.tinvert = I(c, 'triggerInvert', 1);
    this.taction = I(c, 'taction', 0);   // the M trigger's function (a GpioAction; 0 = the left analog trigger)
    // @M}
  }

  // Which LED color a button shows: its own LED, or on a board whose firmware groups LEDs by function (the GS
  // Platform) the LED of the first button with the same function. -1 = no LED, or mapped to nothing.
  ledSlot(ph) {
    if (!ph || ph.led < 0) return -1;
    if (!this.layout || !this.layout.sharedLeds) return ph.led;
    const a = act(this.actionOf(ph.pin));
    if (!a || !a.key) return -1;
    for (const o of this.layout.phys) {
      if (o.led < 0) continue;
      const oa = act(this.actionOf(o.pin));
      if (oa && oa.key === a.key) return o.led;
    }
    return ph.led;
  }

  gamepadBody() { const d = copy(this.gamepadDoc); Object.assign(d, { socdMode: this.socdMode, fourWayMode: this.fourWayMode, debounceDelay: this.debounceDelay, profileNumber: this.profileNumber }); return d; }
  addonBody() {
    const d = copy(this.addonDoc);
    Object.assign(d, { TurboInputEnabled: this.turboEnabled, turboShotCount: this.turboShotCount,
      inner_deadzone: this.innerDeadzone, outer_deadzone: this.outerDeadzone, forced_circularity: this.circularity,
      inner_deadzone2: this.innerDeadzone2, outer_deadzone2: this.outerDeadzone2, forced_circularity2: this.circularity2 });
    // the sticks' centres belong to the calibration (/api/setCalibration): sending back the values read at connect
    // would put the old ones back - 0 on a new calibration, which leaves a calibrated stick stuck in the middle
    for (const k of ['joystickCenterX', 'joystickCenterY', 'joystickCenterX2', 'joystickCenterY2']) delete d[k];
    if (this.turboMask !== this.turboMask0) Object.assign(d, { shmupMode: this.turboMask !== 0, shmupAlwaysOn1: this.turboMask, shmupAlwaysOn2: 0, shmupAlwaysOn3: 0, shmupAlwaysOn4: 0 });
    return d;
  }
  pinsBody() {
    const d = copy(this.pinDoc);
    for (const k in this.profileActions[0]) { const e = d[pinKey(k)]; if (e) e.action = this.profileActions[0][k]; }
    writeCombos(d, this.profileCombos[0]);
    return d;
  }
  // Profiles 2-4: all three sent and enabled (the firmware only uses profile N if the first N-1 exist).
  profilesBody() {
    const alts = [];
    for (let i = 1; i < 4; i++) {
      const d = copy(this.altDocs[i - 1] || this.pinDoc);
      for (const k in this.profileActions[i]) { const e = d[pinKey(k)]; if (e) e.action = this.profileActions[i][k]; }
      writeCombos(d, this.profileCombos[i]);
      if (d.profileLabel == null) d.profileLabel = '';
      d.enabled = true;
      alts.push(d);
    }
    return { alternativePinMappings: alts };
  }
  ledBodies() {
    const ledOpts = copy(this.ledOpts), theme = copy(this.theme);
    const map = ledOpts.ledButtonMap || (ledOpts.ledButtonMap = {});
    for (const a of ACTS) if (a.key) map[a.key] = null;
    for (const ph of this.layout ? this.layout.phys : []) {
      if (ph.led < 0) continue;
      const a = act(this.actionOf(ph.pin)), key = a ? a.key : null;
      if (!key || !(key in map) || map[key] != null) continue;
      map[key] = ph.led;
      const th = theme[key] || (theme[key] = {});
      th.u = this.ledU[ph.led]; th.d = this.ledD[ph.led];
    }
    theme.enabled = true;
    return { ledOpts, theme };
  }
  calMiscBody() {
    return { s1inv: this.stick[0].inv, s2inv: this.stick[1].inv, s1en: this.stick1Enabled, s2en: this.stick2Enabled, rumbleEnabled: this.rumbleEnabled, taction: this.taction };
  }
}

function readCombos(pins, into) {
  for (const k in into) delete into[k];
  for (let p = 0; p < 48; p++) { const e = pins && pins[pinKey(p)]; if (e) into[p] = { b: I(e, 'customButtonMask', 0) >>> 0, d: I(e, 'customDpadMask', 0) >>> 0 }; }
}
function writeCombos(d, combos) {
  for (const k in combos) { const e = d[pinKey(k)]; if (e) { e.customButtonMask = combos[k].b; e.customDpadMask = combos[k].d; } }
}
function readActions(pins, into) {
  for (const k in into) delete into[k];
  for (let p = 0; p < 48; p++) { const e = pins && pins[pinKey(p)]; if (e) into[p] = I(e, 'action', -10); }
}
