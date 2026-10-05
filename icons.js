// The design's own icons (Figma "PadBox Software"), redrawn on a 24 x 24 grid to match the reference shapes.
// Line icons are thin (1.5); the side-menu, save and gamepad icons are solid.

const line = d => `<g fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${d}</g>`;

// 8-tooth gear with a round hole, as one even-odd path
function gear() {
  const R = 10.4, r = 7.9, n = 8, pts = [];
  for (let i = 0; i < n; i++) {
    const a = i * 2 * Math.PI / n, w = 0.2, g = 0.3; // half-widths of the tooth top and the tooth root, in radians
    for (const [rad, ang] of [[r, a - g], [R, a - w], [R, a + w], [r, a + g]]) pts.push((12 + rad * Math.sin(ang)).toFixed(2) + ' ' + (12 - rad * Math.cos(ang)).toFixed(2));
  }
  return `<path fill="currentColor" fill-rule="evenodd" d="M${pts.join('L')}Z M12 8.4a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2z"/>`;
}

const I = {
  download: line('<path d="M12 4.5v10M8.3 11l3.7 3.7 3.7-3.7M6 15.5v3.5h12v-3.5"/>'),
  save: '<path fill="currentColor" fill-rule="evenodd" d="M5.5 3.5h11l4 4v11.5a1.5 1.5 0 0 1-1.5 1.5H5.5A1.5 1.5 0 0 1 4 19V5a1.5 1.5 0 0 1 1.5-1.5zM7.5 5v4h8V5zM12 11.6a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 0 0 0-5.2z"/>',
  // "Restart to Preview LED": a dome light on its base with four rays (traced from FOR NEW UI/Backup idea.png)
  beacon: '<g transform="translate(12 12.05) scale(1.667) translate(-12 -12.05)">'
    + '<g fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"><path d="M6.2 9.8l1.4 1.3M8.7 8l1.1 1.5M15.1 8L14 9.5M17.7 9.8l-1.4 1.3"/></g>'
    + '<path fill="currentColor" d="M7.85 13.2v-.9a1.5 1.5 0 0 1 1.5-1.5h5.25a1.5 1.5 0 0 1 1.5 1.5v.9zM6 16.1V15a1.2 1.2 0 0 1 1.2-1.2h9.6A1.2 1.2 0 0 1 18 15v1.1z"/></g>',
  // the trigger, motion sensor (a gyroscope) and rumble pages
  trigger: '<path fill="currentColor" d="M6.5 20.5v-9a5.5 5.5 0 0 1 11 0v9z"/><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" d="M9.5 3.5c1.6-1 3.4-1 5 0"/>',
  gyro: '<g fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8.2"/><ellipse cx="12" cy="12" rx="8.2" ry="3.3" transform="rotate(-30 12 12)"/></g><circle cx="12" cy="12" r="2.4" fill="currentColor"/>',
  rumble: '<rect x="8" y="3.5" width="8" height="17" rx="2.2" fill="currentColor"/><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4.8 8v8M2.2 10v4M19.2 8v8M21.8 10v4"/></g>',
  refresh: line('<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4.5 8.9"/><path d="M4.5 4.6v4.3h4.3"/>'),
  sync: line('<path d="M19 10.5a7 7 0 0 0-12.6-3L5 9"/><path d="M5 4.8V9h4.2"/><path d="M5 13.5a7 7 0 0 0 12.6 3L19 15"/><path d="M19 19.2V15h-4.2"/>'),
  plus: line('<path d="M12 7v10M7 12h10"/>'),
  gamepad: '<path fill="currentColor" fill-rule="evenodd" d="M6.8 4.5h10.4c2.5 0 4.3 1.6 4.9 4.1l1.5 7c.5 2.6-1 4.9-3.3 4.9-1.4 0-2.4-.8-3.1-2l-1.3-2.2H8.1l-1.3 2.2c-.7 1.2-1.7 2-3.1 2-2.3 0-3.8-2.3-3.3-4.9l1.5-7C2.5 6.1 4.3 4.5 6.8 4.5zM6.2 8.2v2H4.2v1.7h2v2h1.7v-2h2v-1.7h-2v-2zM16.6 8.3a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5zM14.4 11.1a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5z"/>',
  stick: '<g fill="currentColor"><circle cx="12" cy="5.4" r="3"/><rect x="11.1" y="7.5" width="1.8" height="8.5"/><path d="M4.5 20.5v-1.3c0-1.8 1.6-3.7 3.8-3.7h7.4c2.2 0 3.8 1.9 3.8 3.7v1.3z"/></g>',
  gear: gear(),
  // traced pixel by pixel from the design: three round lobes, and a circular arrow hanging out of the cloud's bottom
  // with a "<" head at its top left, cut out of the cloud by a thin gap (in the reference's own 32 x 32 crop)
  cloud: '<g transform="translate(12 12) scale(.889) translate(-16 -20)">'
    + '<mask id="cloud-cut" maskUnits="userSpaceOnUse" x="0" y="0" width="32" height="40"><rect width="32" height="40" fill="#fff"/>'
    + '<g fill="none" stroke="#000" stroke-linecap="round" stroke-linejoin="round"><circle cx="16.5" cy="25.1" r="6.4" fill="#000" stroke="none"/><path d="M16.6 16.7L13.2 20.6 16.4 24" stroke-width="4.1"/></g></mask>'
    + '<g fill="currentColor" mask="url(#cloud-cut)"><circle cx="10.2" cy="21.1" r="5.2"/><circle cx="14.4" cy="14.5" r="6.8"/><circle cx="21.4" cy="19.5" r="6.6"/></g>'
    + '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M14.21 21.58A4.2 4.2 0 1 1 12.55 23.66" stroke-width="2.3"/><path d="M16.6 16.7L13.2 20.6 16.4 24" stroke-width="1.7"/></g></g>',
  // the redesign (GS Essential Redesign): Disconnect, Save, Calibrate, the backup page's buttons and its history's actions
  power: line('<path d="M12 3.8v7.4"/><path d="M7.4 6.6a7.2 7.2 0 1 0 9.2 0"/>'),
  check: line('<path d="M5.5 12.5l4.2 4.2 8.8-9.4"/>'),
  target: line('<circle cx="12" cy="12" r="7.6"/><path d="M12 8.6v6.8M8.6 12h6.8"/>'),
  upload: line('<path d="M12 15.5v-10M8.3 9.2L12 5.5l3.7 3.7M6 15.5v3.5h12v-3.5"/>'),
  pencil: line('<path d="M15.2 5.3l3.5 3.5L9 18.5l-4.2.7.7-4.2z"/><path d="M13.2 7.3l3.5 3.5"/>'),
  trash: line('<path d="M5 7h14M10 7V5h4v2M6.8 7l.8 12h8.8l.8-12M10.2 10.5v5.5M13.8 10.5v5.5"/>'),
  restore: line('<path d="M4.8 12a7.2 7.2 0 1 0 2.1-5.1L4.8 9"/><path d="M4.8 4.8V9H9"/><path d="M12 8.2V12l2.6 1.8"/>'),
  bolt: '<path fill="currentColor" d="M13.6 2.5L5.8 13.4h5.3l-1.6 8.1 8.6-11.6h-5.6z"/>',
  click: '<g fill="none"stroke="currentColor" stroke-width="1.25" stroke-linecap="round" opacity=".85"><path d="M9.5 2.8v3.6M3.6 5.2l2.5 2.5M2.2 10.6h3.6M15.4 5.2l-2.5 2.5M3.8 16.3l2.5-2.5"/></g><path fill="currentColor" opacity=".72" d="M9.6 8.6l12 7.3-5.6.9-2.8 6.6z"/>',
};

export function dicon(name, cls) {
  return `<svg class="${cls || ''}" viewBox="0 0 24 24">${I[name] || ''}</svg>`;
}
