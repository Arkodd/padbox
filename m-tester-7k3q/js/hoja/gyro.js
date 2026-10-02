// The GYRO tab's live 3D PadBox - a port of the desktop HOJA2 PadBox Calibrator's Quat / ImuFusion / StlMesh /
// Gyro3DView: the orientation is worked out here from the raw gyro + accelerometer readings every live report
// carries, and the model (assets/padbox.stl) is drawn with WebGL, lit like the desktop view.

// ------------------------------------------------------------------ quaternions: Hamilton, scalar-last [x, y, z, w]
export const Q = {
  identity: () => [0, 0, 0, 1],
  axisAngle(ax, deg) { const l = Math.hypot(...ax) || 1, h = deg * Math.PI / 360, s = Math.sin(h); return [ax[0] / l * s, ax[1] / l * s, ax[2] / l * s, Math.cos(h)]; },
  conj: q => [-q[0], -q[1], -q[2], q[3]],
  mul: (a, b) => [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]],
  norm(q) { const l = Math.hypot(...q); return l > 1e-8 ? q.map(v => v / l) : [0, 0, 0, 1]; },
  rotate(q, v) {
    const u = [q[0], q[1], q[2]], w = q[3];
    const uv = cross(u, v), uuv = cross(u, uv);
    return [v[0] + 2 * (uv[0] * w + uuv[0]), v[1] + 2 * (uv[1] * w + uuv[1]), v[2] + 2 * (uv[2] * w + uuv[2])];
  },
  slerp(a, b, t) {
    let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
    if (d < 0) { b = b.map(v => -v); d = -d; }
    if (d > 0.9995) return Q.norm(a.map((v, i) => v + (b[i] - v) * t));
    const t0 = Math.acos(d), th = t0 * t, s0 = Math.cos(th) - d * Math.sin(th) / Math.sin(t0), s1 = Math.sin(th) / Math.sin(t0);
    return a.map((v, i) => s0 * v + s1 * b[i]);
  },
  dist: (a, b) => 1 - Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]),
  between(a, b) { const c = cross(a, b), d = dot(a, b); return d < -0.9999 ? [1, 0, 0, 0] : Q.norm([c[0], c[1], c[2], 1 + d]); },
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = a => Math.hypot(a[0], a[1], a[2]);

// ------------------------------------------------------------------ orientation from the raw IMU readings (a Mahony filter)
// The gyro turns the estimate and the accelerometer's sense of "down" slowly pulls tilt back, so it never drifts
// (heading can drift a little; CENTRE VIEW resets it).
export class ImuFusion {
  constructor() { this.reset(); }
  reset() { this.q = Q.identity(); this.started = false; }
  // The IMU chip's axes -> the model's (X right, Y up, Z towards the player), measured on an Essential lying face up.
  static toModel(x, y, z) { return [-x, -z, -y]; }
  // accel and gyro in raw counts (already corrected for the sensitivity %), oneG = the accel reading for 1 g, dt in s
  update(accel, gyro, oneG, dt) {
    const al = len(accel), a = al > 1e-3 ? accel.map(v => v / al) : [0, 1, 0];
    if (!this.started) { this.q = Q.between(a, [0, 1, 0]); this.started = true; return; }
    const rad = 2000 / 32768 * Math.PI / 180;   // LSM6DSR at +-2000 dps
    let w = gyro.map(v => v * rad);
    const upEst = Q.rotate(Q.conj(this.q), [0, 1, 0]);
    const g = al / oneG;
    if (g > 0.75 && g < 1.25) { const c = cross(a, upEst); w = w.map((v, i) => v + c[i] * 2.0); }
    const dq = Q.mul(this.q, [w[0], w[1], w[2], 0]);
    this.q = Q.norm(this.q.map((v, i) => v + 0.5 * dq[i] * dt));
  }
}

// ------------------------------------------------------------------ the model: a binary STL, centred and scaled into a 1.8-unit box,
// smooth-shaded across edges gentler than 40 degrees so the case's real edges stay crisp.
export function loadStl(buf) {
  const dv = new DataView(buf);
  let n = dv.getUint32(80, true);
  if (!n || 84 + 50 * n > buf.byteLength) n = Math.floor((buf.byteLength - 84) / 50);
  const raw = new Float32Array(n * 9);
  let mn = [1e30, 1e30, 1e30], mx = [-1e30, -1e30, -1e30];
  for (let i = 0; i < n; i++) for (let k = 0; k < 9; k++) {
    const v = dv.getFloat32(84 + i * 50 + 12 + k * 4, true), c = k % 3;
    raw[i * 9 + k] = v; if (v < mn[c]) mn[c] = v; if (v > mx[c]) mx[c] = v;
  }
  const dim = Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]);
  if (!(dim > 1e-6)) return null;
  const s = 1.8 / dim, ctr = [0, 1, 2].map(c => (mn[c] + mx[c]) / 2);
  for (let i = 0; i < raw.length; i++) raw[i] = (raw[i] - ctr[i % 3]) * s;
  // corners at the same position share a vertex (and an averaged normal) unless their faces meet at a sharp edge
  const cosLimit = Math.cos(40 * Math.PI / 180);
  const head = new Map(), pos = [], firstN = [], acc = [], next = [], idx = [];
  for (let i = 0; i < n; i++) {
    const o = i * 9, A = [raw[o], raw[o + 1], raw[o + 2]], B = [raw[o + 3], raw[o + 4], raw[o + 5]], C = [raw[o + 6], raw[o + 7], raw[o + 8]];
    const cr = cross([B[0] - A[0], B[1] - A[1], B[2] - A[2]], [C[0] - A[0], C[1] - A[1], C[2] - A[2]]), l = len(cr);
    if (l < 1e-12) continue;
    const fn = cr.map(v => v / l);
    for (const p of [A, B, C]) {
      const key = Math.round((p[0] + 1) * 524288) + ',' + Math.round((p[1] + 1) * 524288) + ',' + Math.round((p[2] + 1) * 524288);
      let h = head.has(key) ? head.get(key) : -1, v = h;
      while (v >= 0 && dot(firstN[v], fn) <= cosLimit) v = next[v];
      if (v < 0) { v = pos.length; pos.push(p); firstN.push(fn); acc.push([0, 0, 0]); next.push(h); head.set(key, v); }
      const a = acc[v]; a[0] += cr[0]; a[1] += cr[1]; a[2] += cr[2];
      idx.push(v);
    }
  }
  const P = new Float32Array(pos.length * 3), N = new Float32Array(pos.length * 3);
  pos.forEach((p, v) => { P.set(p, v * 3); const a = acc[v], l = len(a) || 1; N.set([a[0] / l, a[1] / l, a[2] / l], v * 3); });
  return { P, N, I: new Uint32Array(idx) };
}

// ------------------------------------------------------------------ the view
const VS = `#version 300 es
in vec3 p; in vec3 n;
uniform mat4 proj; uniform mat3 rot; uniform float dist;
out vec3 vn; out vec3 vp;
void main() { vec3 q = rot * p; vn = rot * n; vp = q; gl_Position = proj * vec4(q.xy, q.z - dist, 1.0); }`;
const FS = `#version 300 es
precision highp float;
in vec3 vn; in vec3 vp; uniform float dist; out vec4 o;
void main() {
  vec3 N = normalize(vn); if (!gl_FrontFacing) N = -N;
  vec3 body = vec3(208.0, 210.0, 218.0) / 255.0;
  vec3 c = body * vec3(62.0, 62.0, 66.0) / 255.0;                           // ambient
  vec3 L1 = normalize(-vec3(0.35, -0.55, -0.75)), L2 = normalize(-vec3(-0.5, 0.45, 0.6));
  c += body * vec3(205.0, 205.0, 212.0) / 255.0 * max(dot(N, L1), 0.0);     // key light from the top left
  c += body * vec3(120.0, 66.0, 30.0) / 255.0 * max(dot(N, L2), 0.0);       // warm rim from behind
  vec3 V = normalize(vec3(0.0, 0.0, dist) - vp), H = normalize(L1 + V);
  c += vec3(90.0 / 255.0) * pow(max(dot(N, H), 0.0), 40.0) * step(0.0, dot(N, L1));
  o = vec4(min(c, vec3(1.0)), 1.0);
}`;

export class GyroView {
  constructor(canvas) {
    this.canvas = canvas;
    this.current = Q.identity(); this.target = Q.identity(); this.reference = Q.identity();
    this.tilt = Q.axisAngle([1, 0, 0], 55);   // tilted towards the viewer so the face buttons show at rest
    this.count = 0; this.redraw = true;
    const gl = this.gl = canvas.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: false });
    if (!gl) return;
    const sh = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const pr = this.prog = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr);
    this.u = { proj: gl.getUniformLocation(pr, 'proj'), rot: gl.getUniformLocation(pr, 'rot'), dist: gl.getUniformLocation(pr, 'dist') };
  }
  get ok() { return !!this.gl; }
  setMesh(m) {
    const gl = this.gl; if (!gl) return;
    this.vao = gl.createVertexArray(); gl.bindVertexArray(this.vao);
    const buf = (loc, data) => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0); };
    buf(gl.getAttribLocation(this.prog, 'p'), m.P); buf(gl.getAttribLocation(this.prog, 'n'), m.N);
    const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.I, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.count = m.I.length; this.redraw = true;
  }
  setOrientation(q) { this.target = q; }
  centre() { this.reference = this.target; this.redraw = true; }
  // one animation step: ease towards the latest orientation, draw if anything changed
  frame() {
    const gl = this.gl; if (!gl || !this.count) return;
    const r = this.canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    const W = Math.max(1, Math.round(r.width * dpr)), H = Math.max(1, Math.round(r.height * dpr));
    if (this.canvas.width !== W || this.canvas.height !== H) { this.canvas.width = W; this.canvas.height = H; this.redraw = true; }
    const n = Q.slerp(this.current, this.target, 0.35);
    if (!this.redraw && Q.dist(n, this.current) < 1e-7) return;
    this.redraw = false; this.current = n;
    // the camera backs off until the whole PadBox fits (38 degrees across), and never draws it over 280 px in radius
    const fov = 38, rad = 1.05, tanH = Math.tan(fov / 2 * Math.PI / 180), tanV = tanH * r.height / Math.max(1, r.width);
    let d = rad / Math.min(tanH, tanV); d = Math.max(d, rad * r.height / (2 * 280 * tanV));
    const near = 0.1, far = d + 10;
    const proj = new Float32Array([1 / tanH, 0, 0, 0, 0, 1 / tanV, 0, 0, 0, 0, -(far + near) / (far - near), -1, 0, 0, -2 * far * near / (far - near), 0]);
    const q = Q.mul(this.tilt, Q.mul(Q.conj(this.reference), this.current));   // live turn first, then the viewing tilt
    const [x, y, z, w] = q;
    const rot = new Float32Array([
      1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w),
      2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w),
      2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)]);
    gl.viewport(0, 0, W, H); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(this.prog);
    gl.uniformMatrix4fv(this.u.proj, false, proj); gl.uniformMatrix3fv(this.u.rot, false, rot); gl.uniform1f(this.u.dist, d);
    gl.bindVertexArray(this.vao); gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_INT, 0); gl.bindVertexArray(null);
  }
}
