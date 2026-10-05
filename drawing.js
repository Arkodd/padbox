// The PadBox GS drawing of the Figma design (PadBox Software, frame 1 / 2): the tracing's geometry filled - a light
// body, a grey grip, dark rounded buttons - as SVG, so every button is its own clickable shape.
// Coordinates are the tracing's (1530 x 1200); the design shows it at 0.428 scale.
// The GS Essential is drawn from its own tracing (PadBoxGS-Tracing-Essential.svg). The GS Platform has no vector tracing
// yet, so it is EXTRAPOLATED: the Essential's body, grip, bumper and menu buttons moved and scaled onto the Platform's
// raster tracing (assets/gs_platform_trace.png - its outline's bounds give the fit), and its stick, D-pad and 13 round
// buttons put where that tracing has them (js/gp/model.js gsPlatform). To be replaced by the Platform's real tracing.

import { SHAPES } from './gs-essential-shapes.js';

const NS = 'http://www.w3.org/2000/svg';
const C = {
  body: '#dfdfdf', grip: '#9d9d9d', btn: '#3d3d3d', edge: '#262626', icon: '#ababab',
  selected: '#d75700', pressed: '#fe6805', callout: '#c5c5c5', stickRing: '#262626', stickInner: '#5e5e5e',
  label: '#e4e4e4', labelOnBody: '#5a5a5a', labelOnDark: '#bdbdbd',
};

// The arrow drawn for a D-pad direction: pointing up, 1 unit tall, centred on 0,0; turned for the other directions
const ARROW = 'M0 -.5L.46 -.04H.17V.5H-.17V-.04H-.46Z';
const TURN = { Up: 0, Right: 90, Down: 180, Left: 270 };

// Each board: its round buttons [pin, x, y] and their radius, its sticks [click pin or -1, x, y, size], and where the
// Essential's shapes go (a transform for the body with grip and bumper, one for the menu buttons, a shift for the D-pad)
const BOARDS = {
  essential: {
    name: 'PadBox GS Essential', R: 79,
    // 1P 2P 3P 4P, 1K 2K 3K 4K (configs/PadboxGSEssential)
    round: [[10, 666, 372], [11, 834, 296], [12, 1021, 296], [13, 1200, 347], [6, 682, 557], [7, 851, 480], [8, 1037, 480], [9, 1216, 531]],
    sticks: [[18, 415, 422, 1], [19, 561, 763, 1]],
    body: '', menu: '', dpad: [0, 0], bumperLabel: [297, 58],
  },
  platform: {
    name: 'PadBox GS Platform', R: 79 * 78 / 81,
    // 1P 2P 3P 4P, 1K 2K 3K 4K, then the C-stick (up, right, left, down) and the A button (configs/PadboxGSPlatform)
    round: [[10, 795, 349], [11, 958, 275], [12, 1137, 275], [13, 1310, 324], [6, 815, 528], [7, 977, 454], [8, 1157, 454], [9, 1330, 503],
      [27, 697, 706], [19, 865, 738], [26, 579, 835], [18, 641, 1002], [15, 760, 873]],
    sticks: [[-1, 244, 262, 56 / 58]],   // its only stick, top left; it has no click
    // outline bounds: Essential x 42..1487 y 76..1123, Platform x 33..1490 y 59..1113
    body: 'matrix(1.0075 0 0 1.0075 -9.3 -17.6)',
    // the menu buttons' centres: Essential 556.5..743.4 at y 162.9, Platform 552.4..734.6 at y 147.3
    menu: 'matrix(.9749 0 0 .9749 9.87 -11.51)',
    dpad: [166, 123],   // the D-pad's centre: Essential 263,268 - Platform 429,391
    bumperLabel: [289.9, 40.8],
  },
};


function el(name, attrs, parent) {
  const e = document.createElementNS(NS, name);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.append(e);
  return e;
}

// Builds the drawing. onPick(pin) when a button is clicked; tip(pin) = the hover text; label(pin) = the short name
// written on the button (its function; '' for none - the redesign writes nothing on the D-pad, sticks and bumper while
// they do what they're for, so the apps return '' for those).
export function buildDrawing(onPick, tip, label, board) {
  const B = BOARDS[board] || BOARDS.essential, k = B.R / 79;   // k: the round buttons' size against the Essential's
  const svg = el('svg', { viewBox: B.viewBox || '0 0 1530 1200', class: 'pad-drawing', role: 'img', 'aria-label': B.name });
  const defs = el('defs', {}, svg);
  const parts = {};   // pin -> [shapes]
  const add = (pin, shape) => {
    shape.classList.add('pad-btn');
    shape.dataset.pin = pin;
    shape.addEventListener('click', () => onPick(pin));
    const t = el('title', {}, shape); t.textContent = tip(pin);
    (parts[pin] = parts[pin] || []).push(shape);
    return shape;
  };
  let dpadLabels, trig = null, trigBox = null;
  // The tracing's body outline stops short of its top-left corner; the other line (plateEdge) finishes it: it runs from
  // the top edge round the D-pad's bulge and back under the left stick to the notch - the edge between the light top
  // and the grey grip. So the silhouette is the outline plus that line closed on itself.
  const plateEdge = SHAPES.bumperTab[1];
  const clip = el('clipPath', { id: 'bodyClip' }, defs);
  el('path', { d: SHAPES.body }, clip);
  el('path', { d: plateEdge + ' Z' }, clip);

  // body: all grey (the grip), then the light top: everything right of plateEdge
  const body = el('g', { 'clip-path': 'url(#bodyClip)', transform: B.body }, svg);   // (the clip follows the transform)
  el('rect', { x: -100, y: -100, width: 1800, height: 1400, fill: C.grip }, body);
  el('path', { d: plateEdge + ' L 364,1300 L 1700,1300 L 1700,-100 L 229,-100 Z', fill: C.body }, body);

  // bumper: the tab on top of the body (NB1). It's the button: the GS has no trigger, so no other shape for it.
  add(22, svg.insertBefore(el('path', { d: SHAPES.bumperTab[0] + ' Z', fill: C.btn, stroke: C.callout, 'stroke-width': '4', 'stroke-linejoin': 'round', transform: B.body }), body));   // behind the body, which hides its bottom

  // D-pad: the four arms of the tracing
  const DP = { up: 2, down: 3, left: 5, right: 4 };
  // (each arm of the tracing is an outline ring: its outer edge only, so the arm is solid)
  const outer = d => d.slice(0, d.search(/[Mm]/g) === 0 ? 1 + d.slice(1).search(/[Mm]/) : d.length);
  const dpad = el('g', { transform: `translate(${B.dpad[0]} ${B.dpad[1]})` }, svg);
  for (const d of ['up', 'down', 'left', 'right']) add(DP[d], el('path', { d: outer(SHAPES.dpad[d]), fill: C.btn, stroke: C.edge, 'stroke-width': '4.5', 'stroke-linejoin': 'round' }, dpad));

  // menu buttons (tilted pills) and their icons: Start, Select, Home, Touchpad
  const menu = el('g', { transform: B.menu }, svg);
  [17, 16, 20, 21].forEach((pin, i) => {
    const r = SHAPES.menuPills[i];
    const g = add(pin, el('g', {}, menu));
    el('rect', { x: r.x, y: r.y, width: r.w, height: r.h, rx: r.rx, ry: r.rx, transform: r.t, fill: C.btn }, g);
    for (const d of SHAPES.menuIconsSolid[i]) el('path', { d, fill: C.icon }, menu);
  });
  dpadLabels = [[2, 263.7, 211], [3, 263.7, 327], [5, 206, 268.7], [4, 322, 268.7]].map(([pin, x, y]) => [pin, x + B.dpad[0], y + B.dpad[1]]);

  // sticks: a dark ring with the cap inside; clicking one = its click (L3 / R3), if it has one. The redesign (GS Essential
  // Redesign) draws them still, so the GS has no live dot on them (the STICKS page shows where they are).
  const dots = [];   // the live position of each stick
  B.sticks.forEach(([pin, x, y, sz]) => {
    const g = el('g', {}, svg);
    if (pin >= 0) add(pin, g);
    el('circle', { cx: x, cy: y, r: 54 * sz, fill: C.stickRing }, g);
    el('circle', { cx: x, cy: y, r: 44 * sz, fill: C.btn, stroke: C.stickInner, 'stroke-width': '3' }, g);
    if (!B.m) return;
    const dot = el('circle', { cx: x, cy: y, r: 15 * sz, fill: C.pressed, stroke: C.edge, 'stroke-width': '3', 'pointer-events': 'none' }, svg);
    dots.push({ dot, x, y, travel: 34 * sz });
  });

  // the round buttons (face buttons, and the Platform's C-stick and A)
  // each round button's LED, shown around it as in the design (image.png, measured pixel by pixel): a solid band of the
  // LED color about 2 px wide right at the button's edge (over its dark outline), then the color fading out linearly
  // over about 8 px. The glows go under every button (neighbours' glows overlap), the bands on top of the outlines.
  // In drawing units (0.428 px each), for the Essential's buttons: band 76.5..81.3, fade to 100.6 (k times that for others).
  const leds = {};   // pin -> { stops, glow, band }
  for (const [pin, x, y] of B.round) {
    const grad = el('radialGradient', { id: 'led' + pin, gradientUnits: 'userSpaceOnUse', cx: x, cy: y, r: 100.6 * k }, defs);
    const stops = [el('stop', { offset: 0.808, 'stop-opacity': 1 }, grad), el('stop', { offset: 1, 'stop-opacity': 0 }, grad)];
    const glow = el('circle', { cx: x, cy: y, r: 100.6 * k, fill: 'url(#led' + pin + ')', 'pointer-events': 'none', visibility: 'hidden' }, svg);
    leds[pin] = { stops, glow, x, y };
  }
  // a thin dark edge on the face buttons, as in the redesign; a lit LED's band covers it
  for (const [pin, x, y] of B.round) add(pin, el('circle', { cx: x, cy: y, r: B.R - 2 * k, fill: C.btn, stroke: C.edge, 'stroke-width': 4 * k }, svg));
  for (const [pin, x, y] of B.round) leds[pin].band = el('circle', { cx: x, cy: y, r: 78.9 * k, fill: 'none', 'stroke-width': 4.8 * k, 'pointer-events': 'none', visibility: 'hidden' }, svg);
  // color(pin) = the LED's color as '#rrggbb', or null for none
  function setLeds(color) {
    for (const pin in leds) {
      const L = leds[pin], c = color(+pin), vis = c ? 'visible' : 'hidden';
      if (c && L.c !== c) { for (const st of L.stops) st.setAttribute('stop-color', c); L.band.setAttribute('stroke', c); }
      L.c = c; L.glow.setAttribute('visibility', vis); L.band.setAttribute('visibility', vis);
    }
  }

  // the labels: each button's function written on it (the sticks' under them), drawn last so nothing covers them
  const labels = [];   // [pin, text]
  const text = (pin, x, y, size, fill) => {
    const t = el('text', { x, y, 'font-size': size, fill, class: 'pad-label', 'text-anchor': 'middle', 'dominant-baseline': 'central', 'pointer-events': 'none' }, svg);
    const a = el('path', { d: ARROW, fill, 'pointer-events': 'none', visibility: 'hidden' }, svg);
    labels.push([pin, t, a, x, y, size]);
  };
  for (const [pin, x, y] of B.round) text(pin, x, y, 42 * k, C.label);
  for (const [pin, x, y] of dpadLabels) text(pin, x, y, 21, C.label);
  text(22, B.bumperLabel[0], B.bumperLabel[1], 28, C.labelOnDark);   // above the bumper tab, which is mostly hidden behind the body
  for (const [pin, x, y, sz] of B.sticks) if (pin >= 0) text(pin, x, y + 83 * sz, 30, C.labelOnBody);
  if (trigBox) text(44, trigBox.x + trigBox.w / 2, trigBox.y + 33, 24, C.label);   // the trigger's function, above its percentage
  // a D-pad direction is drawn as an arrow, anything else as text
  const paintLabels = () => {
    for (const [pin, t, a, x, y, size] of labels) {
      const v = label ? label(pin) : '', turn = TURN[v];
      // "R 10%": the amount small under the name, as in the GS Platform design
      const two = turn === undefined && /^(.+) (\d+%)$/.exec(v);
      if (two) {
        t.textContent = '';
        el('tspan', { x, dy: -size * 0.12 }, t).textContent = two[1];
        el('tspan', { x, dy: size * 0.62, 'font-size': size * 0.42 }, t).textContent = two[2];
      } else t.textContent = turn === undefined ? v : '';
      a.setAttribute('visibility', turn === undefined ? 'hidden' : 'visible');
      if (turn !== undefined) a.setAttribute('transform', `translate(${x} ${y}) rotate(${turn}) scale(${size * 0.95})`);
    }
  };
  paintLabels();

  // live state: the selected button in orange, a pressed one in the brighter orange
  const fillOf = s => s.classList.contains('pad-trigger') ? s.querySelector('path') : s.tagName === 'g' ? (s.querySelector('rect') || s.querySelectorAll('circle')[1]) : s;   // a stick: its cap
  function set(selected, isPressed) {
    for (const pin in parts) {
      const on = isPressed(+pin), sel = +pin === selected;
      for (const s of parts[pin]) {
        const f = fillOf(s);
        if (f) f.setAttribute('fill', on ? C.pressed : sel ? C.selected : C.btn);
        s.classList.toggle('sel', sel);
      }
    }
  }
  function refreshTips() { for (const pin in parts) for (const s of parts[pin]) s.querySelector('title').textContent = tip(+pin); paintLabels(); }
  // each stick's position, -1..1 (y up): the dot travels inside the ring
  function setSticks(pos) {
    dots.forEach((d, i) => {
      let [nx, ny] = pos[i] || [0, 0]; const m = Math.hypot(nx, ny); if (m > 1) { nx /= m; ny /= m; }
      d.dot.setAttribute('cx', d.x + nx * d.travel); d.dot.setAttribute('cy', d.y - ny * d.travel);
    });
  }
  // the analog trigger, 0..1 (only on a board that has one; null shows it empty, with no number). analog: its function is an
  // analog output (shown 0..100%); if not, it's shown as a plain button (pass 1 while pressed, 0 when not)
  function setTrigger(level, analog = true) { if (trig) trig(level, analog); }
  return { svg, set, setSticks, setLeds, refreshTips, setTrigger };
}
