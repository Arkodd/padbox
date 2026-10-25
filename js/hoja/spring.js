// HOJA2's Auto snapback, tuned to one stick: the firmware (HOJA-LIB-RP2040 snapback_spring.c) models a stick that's
// been let go as a damped spring, s[n+1] = a1 s[n] + a2 s[n-1] per analog sample (a1, a2 in Q16, one pair per octant
// it was let go from), and holds the output at neutral only while the stick follows that spring. This file reads the
// firmware's release recordings and fits that spring. No DOM.
//
// A recording (WEBUSB_SNAPBACK_CAPTURE, snapback_capture.c): 256 samples of x and y (about +-2048) as the filter sees
// them, the first 48 of them before the stick fell back under 500 from out past 800.

// The firmware's built-in tuning (a ProGCC 3S left stick), used until a stick is tuned
export const DEFAULTS = Object.freeze({
  a1: [126802, 125429, 125618, 124742, 124719, 125250, 126071, 126201],
  a2: [-62953, -62076, -62255, -61868, -61619, -62021, -62529, -62543],
  decide_step: 45, grab_err: 40, stiff_den: 25, cross_speed: 20,
});
// what the firmware takes (_spring_cfg_valid); anything else and it puts its defaults back
const LIMITS = { a1: [98304, 131072], a2: [-65535, -52429], decide_step: [10, 300], grab_err: [10, 300] };

const PRE = 48;          // samples recorded before the stick fell under 500
const EDGE = 1600;       // the firmware's "at the edge" and release line
const RELEASE = 1200;
const DECIDE = 6;        // samples after the release line the firmware compares with the free spring
const MAX_FALL = 8;      // release line to centre: a stick let go gets there in 3-6 samples, one guided back takes longer
const SWING = 120;       // samples of the free swing fitted, from the first centre crossing
const RMS_MAX = 30;      // a clean swing fits the spring within this (counts)
export const PER_OCTANT = 2;   // releases asked for in each of the 8 directions

const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));

// 0 = +x, counting towards +y, each 45 degrees wide (as the firmware's _spring_octant)
export function octant(x, y) {
  const a = Math.atan2(y, x) * 4 / Math.PI;
  return ((Math.round(a) % 8) + 8) % 8;
}

// a1, a2 by least squares over s
function ar2(s) {
  let uu = 0, uv = 0, vv = 0, uw = 0, vw = 0;
  for (let i = 2; i < s.length; i++) {
    const u = s[i - 1], v = s[i - 2], w = s[i];
    uu += u * u; uv += u * v; vv += v * v; uw += u * w; vw += v * w;
  }
  const det = uu * vv - uv * uv;
  if (!det) return null;
  const a1 = (uw * vv - vw * uv) / det, a2 = (uu * vw - uv * uw) / det;
  let e = 0;
  for (let i = 2; i < s.length; i++) e += (s[i] - a1 * s[i - 1] - a2 * s[i - 2]) ** 2;
  return { a1, a2, rms: Math.sqrt(e / Math.max(1, s.length - 2)) };
}

// the spring's swing per sample (radians) and its damping ratio, or null if it doesn't ring
function shape(a1, a2) {
  if (a2 >= 0 || a1 * a1 + 4 * a2 >= 0) return null;
  const r = Math.sqrt(-a2), theta = Math.acos(clamp(a1 / (2 * r), [-1, 1])), sigma = -Math.log(r);
  return { theta, zeta: sigma / Math.hypot(theta, sigma) };
}

// One recording: a clean release from the edge, and its spring - or why not:
// 'edge' (not pushed all the way out), 'guided' (brought back by the thumb), 'spring' (didn't swing like a spring)
export function readRelease(c) {
  let at = 0, far = -1;
  for (let i = 0; i < Math.min(PRE, c.x.length); i++) { const d = Math.hypot(c.x[i], c.y[i]); if (d > far) { far = d; at = i; } }
  if (far < EDGE) return { ok: false, why: 'edge' };
  const ex = c.x[at] / far, ey = c.y[at] / far, p = c.x.map((x, i) => x * ex + c.y[i] * ey);
  let line = -1;
  for (let i = at; i < p.length; i++) if (Math.hypot(c.x[i], c.y[i]) < RELEASE) { line = i; break; }
  if (line < 1) return { ok: false, why: 'edge' };
  let cross = -1;
  for (let i = line; i < p.length - 1; i++) if (p[i] > 0 && p[i + 1] <= 0) { cross = i; break; }
  if (cross < 0 || cross + 1 - line > MAX_FALL) return { ok: false, why: 'guided' };
  const fit = ar2(p.slice(cross, cross + SWING)), sh = fit && shape(fit.a1, fit.a2);
  // between about 25 and 150 Hz at 2 kHz, and clearly ringing
  if (!fit || !sh || fit.rms > RMS_MAX || sh.theta < 0.078 || sh.theta > 0.47 || sh.zeta > 0.5) return { ok: false, why: 'spring' };
  return { ok: true, octant: octant(c.x[at], c.y[at]), line, a1: fit.a1, a2: fit.a2 };
}

const step = (a1, a2, s1, s2) => (a1 * s1 + a2 * s2) / 65536;

// How far a release strays from the free spring in the firmware's first 3 ms (the worst miss / samples since the line)
function strays(c, r, p) {
  const o = r.octant, a1 = p.a1[o], a2 = p.a2[o];
  let fx2 = c.x[r.line - 1], fy2 = c.y[r.line - 1], fx1 = c.x[r.line], fy1 = c.y[r.line], worst = 0;
  for (let k = 1; k <= DECIDE && r.line + k < c.x.length; k++) {
    const fx = step(a1, a2, fx1, fx2), fy = step(a1, a2, fy1, fy2);
    fx2 = fx1; fy2 = fy1; fx1 = fx; fy1 = fy;
    if (k >= 2) worst = Math.max(worst, Math.hypot(c.x[r.line + k] - fx, c.y[r.line + k] - fy) / k);
  }
  return worst;
}

// The spring's own one-step miss while the rebound rings (3 samples running, as the firmware's grab check counts)
function swingMiss(c, r, p) {
  const o = r.octant, a1 = p.a1[o], a2 = p.a2[o], run = [];
  let worst = 0;
  for (let i = r.line + DECIDE; i < Math.min(c.x.length, r.line + DECIDE + SWING); i++) {
    if (Math.hypot(c.x[i], c.y[i]) < 40) break;   // settled
    run.push(Math.hypot(c.x[i] - step(a1, a2, c.x[i - 1], c.x[i - 2]), c.y[i] - step(a1, a2, c.y[i - 1], c.y[i - 2])));
    if (run.length > 3) run.shift();
    if (run.length === 3) worst = Math.max(worst, Math.min(...run));
  }
  return worst;
}

// The tuning for one stick from its clean releases ({x, y} recordings that readRelease took).
// The crossing checks (stiff_den, cross_speed) keep the firmware's values: they're about the thumb, not the spring.
export function fit(caps) {
  const rel = caps.map(c => ({ c, r: readRelease(c) })).filter(k => k.r.ok);
  const per = Array.from({ length: 8 }, () => []);
  for (const k of rel) per[k.r.octant].push(k.r);
  const mean = (list, key) => list.reduce((s, r) => s + r[key], 0) / list.length;
  const p = { ...DEFAULTS, a1: [], a2: [] };
  for (let o = 0; o < 8; o++) {
    // a direction with no release takes its neighbours', then any
    let list = per[o];
    if (!list.length) list = [...per[(o + 7) % 8], ...per[(o + 1) % 8]];
    if (!list.length) list = per.flat();
    p.a1.push(list.length ? clamp(Math.round(mean(list, 'a1') * 65536), LIMITS.a1) : DEFAULTS.a1[o]);
    p.a2.push(list.length ? clamp(Math.round(mean(list, 'a2') * 65536), LIMITS.a2) : DEFAULTS.a2[o]);
  }
  // decide_step: never under the firmware's own (so a thumb move passes as it did), raised if this stick's releases need it
  const worst = Math.max(0, ...rel.map(k => strays(k.c, k.r, p)));
  p.decide_step = clamp(Math.max(DEFAULTS.decide_step, Math.ceil(worst * 1.15)), LIMITS.decide_step);
  // grab_err: twice the spring's own miss while it rings, 40..100 (higher notices the thumb taking it back later)
  const miss = Math.max(0, ...rel.map(k => swingMiss(k.c, k.r, p)));
  p.grab_err = Math.min(100, Math.max(DEFAULTS.grab_err, Math.ceil(miss * 2)));
  return p;
}
