// Shared UI pieces for every page: the line icons (the desktop apps' Icons, as SVG on the same 24x24 grid),
// small DOM builders for the styled controls, and colors.

const I = {
  download: '<path d="M12 3.5v11M7.5 10l4.5 4.5 4.5-4.5M4 15v5h16v-5"/>',
  upload: '<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M4 15v5h16v-5"/>',
  save: '<path d="M4 4h12.5L20 7.5V20H4z"/><path d="M8 4v5h7V4"/><rect x="7.5" y="13" width="9" height="7"/>',
  reset: '<path d="M17.2 3.8l.4 4.1-4 .5"/><path d="M16.9 7.1A7 7 0 1 1 12 5"/>',
  gamepad: '<path d="M6.5 7h11a4.5 6 0 0 1 0 12l-2-2.5h-7l-2 2.5a4.5 6 0 0 1 0-12z"/><path d="M5.5 12h4M7.5 10v4"/><circle cx="16.2" cy="11" r="1.2" fill="currentColor" stroke="none"/><circle cx="18.4" cy="13.4" r="1.2" fill="currentColor" stroke="none"/>',
  stick: '<circle cx="12" cy="6.5" r="3.5" fill="currentColor" stroke="none"/><path d="M12 10v6"/><ellipse cx="12" cy="18" rx="7.5" ry="3"/>',
  trigger: '<path d="M5 9a7 5 0 0 1 14 0v11H5z"/><path d="M8.5 13.5h7"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8l1.6 2.7 3-.9.9 3 2.7 1.6-1.4 2.8 1.4 2.8-2.7 1.6-.9 3-3-.9L12 21.2l-1.6-2.7-3 .9-.9-3-2.7-1.6L5.2 12 3.8 9.2l2.7-1.6.9-3 3 .9z"/>',
  cloud: '<path d="M6.5 18a4 4 0 0 1-.3-8 5.5 5.5 0 0 1 10.7-1.3A4.5 4.5 0 0 1 17.5 18"/><path d="M12 21v-8.5M9 15.5l3-3 3 3"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none"/><path d="M12 1.5V5M12 19v3.5M1.5 12H5M19 12h3.5"/>',
  cursor: '<path d="M5 3v16l4.4-4 3 6.2 2.8-1.4-3-6.1 5.8-.5z"/>',
  sun: '<circle cx="12" cy="12" r="4.5"/><path d="M19.3 12H22M16.9 16.9l1.9 1.9M12 19.3V22M7.1 16.9l-1.9 1.9M4.7 12H2M7.1 7.1 5.2 5.2M12 4.7V2M16.9 7.1l1.9-1.9"/>',
  bulb: '<path d="M7.3 12.4A5.5 5.5 0 1 1 16.7 12.4L14.5 16h-5z"/><path d="M9.8 19h4.4M10.8 21.6h2.4"/>',
  info: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="8" r="1.2" fill="currentColor" stroke="none"/><path d="M12 11v6"/>',
  plug: '<path d="M9.5 3v4.5M14.5 3v4.5M6.5 7.5h11V11a5.5 4.75 0 0 1-11 0zM12 16v5"/>',
  unplug: '<path d="M9.5 3v4.5M14.5 3v4.5M6.5 7.5h11V11a5.5 4.75 0 0 1-11 0zM12 16v5M4 20 20 4"/>',
  plus: '<path d="M12 6v12M6 12h12"/>',
  bolt: '<path d="M13.5 2.5 5.5 13.5h6l-1 8 8-11h-6z"/>',
  sliders: '<path d="M4 7h16M4 12h16M4 17h16"/><circle cx="15.2" cy="7" r="2.2" fill="currentColor" stroke="none"/><circle cx="8.7" cy="12" r="2.2" fill="currentColor" stroke="none"/><circle cx="13.7" cy="17" r="2.2" fill="currentColor" stroke="none"/>',
  usb: '<path d="M12 21V4M9 7l3-3 3 3M12 17l-5-3v-3M12 14l5-3V8"/><circle cx="7" cy="10" r="1.4" fill="currentColor" stroke="none"/><rect x="15.8" y="6.2" width="2.4" height="2.4" fill="currentColor" stroke="none"/><circle cx="12" cy="20" r="1.6" fill="currentColor" stroke="none"/>',
  gyro: '<ellipse cx="12" cy="12" rx="9" ry="3.6"/><ellipse cx="12" cy="12" rx="3.6" ry="9"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/>',
  rumble: '<rect x="8" y="5" width="8" height="14" rx="2"/><path d="M4.5 8.5v7M2 10.5v3M19.5 8.5v7M22 10.5v3"/>',
  serial: '<rect x="3.5" y="7" width="17" height="10" rx="2"/><circle cx="8" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="16" cy="12" r="1" fill="currentColor" stroke="none"/>',
};

export function icon(name, cls) {
  const s = I[name];
  if (!s) return '';
  return `<svg class="${cls || ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${s}</svg>`;
}

// The icon a button gets from its text (like the desktop apps' Icons.ForText).
export function iconForText(text) {
  const t = (text || '').toUpperCase();
  if (t.includes('UPDATE FIRMWARE')) return 'download';
  if (t.includes('RESTART AS CONTROLLER')) return 'gamepad';
  if (t.includes('RESTART TO PREVIEW') || t.startsWith('RESET') || t.startsWith('UNDO')) return 'reset';
  if (t.startsWith('SAVE')) return 'save';
  if (t.startsWith('DISCONNECT')) return 'unplug';
  if (t.startsWith('CONNECT')) return 'plug';
  if (t.startsWith('EXPORT')) return 'upload';
  if (t.startsWith('IMPORT')) return 'download';
  if (t.startsWith('CALIBRATE')) return 'target';
  return null;
}

// el('div.card', {text, html, on:{click}, ...attrs}, children)
export function el(tag, props, children) {
  const m = tag.match(/^([a-z0-9]+)((?:[.#][\w-]+)*)$/i);
  const e = document.createElement(m ? m[1] : 'div');
  if (m && m[2]) for (const part of m[2].match(/[.#][\w-]+/g)) {
    if (part[0] === '.') e.classList.add(part.slice(1)); else e.id = part.slice(1);
  }
  props = props || {};
  for (const k in props) {
    const v = props[k];
    if (v === undefined || v === null) continue;
    if (k === 'text') e.textContent = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k === 'on') for (const ev in v) e.addEventListener(ev, v[ev]);
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k in e && k !== 'list') e[k] = v;
    else e.setAttribute(k, v);
  }
  for (const c of [].concat(children || [])) if (c != null) e.append(c);
  return e;
}

export function button(text, opts) {
  opts = opts || {};
  const b = el('button.btn' + (opts.primary ? '.primary' : '') + (opts.cls ? '.' + opts.cls : ''), { type: 'button', title: opts.title });
  setButtonText(b, text, opts.icon);
  if (opts.onclick) b.addEventListener('click', opts.onclick);
  if (opts.disabled) b.disabled = true;
  return b;
}
export function setButtonText(b, text, iconName) {
  const ic = iconName === '' ? null : (iconName || iconForText(text));
  b.innerHTML = (ic ? icon(ic) : '') + `<span>${esc(text)}</span>`;
}

export function card(title, iconName, children) {
  const c = el('div.card');
  if (title != null) c.append(el('h2', { html: (iconName ? icon(iconName) : '') + `<span>${esc(title)}</span>` }));
  for (const ch of [].concat(children || [])) if (ch) c.append(ch);
  return c;
}

export function toggle(text, onchange) {
  const input = el('input', { type: 'checkbox' });
  const lab = el('label.toggle', {}, [input, el('span.pill'), el('span.t', { text })]);
  const api = {
    el: lab, input,
    get checked() { return input.checked; },
    set checked(v) { input.checked = !!v; },
    set disabled(v) { input.disabled = !!v; lab.classList.toggle('disabled', !!v); },
    set text(v) { lab.querySelector('.t').textContent = v; },
  };
  input.addEventListener('change', () => onchange && onchange(input.checked));
  return api;
}

export function slider(caption, min, max, format, onchange) {
  const val = el('b');
  const input = el('input', { type: 'range', min, max, step: 1 });
  const wrap = el('label.slider', {}, [el('div.top', {}, [el('span.c', { text: caption }), val]), input]);
  const paint = () => {
    const v = +input.value;
    val.textContent = format ? format(v) : String(v);
    const p = max > min ? (v - min) / (max - min) * 100 : 0;
    input.style.setProperty('--p', p + '%');
  };
  input.addEventListener('input', () => { paint(); onchange && onchange(+input.value); });
  const api = {
    el: wrap, input,
    get value() { return +input.value; },
    set value(v) { input.value = v; paint(); },
    set max(v) { input.max = v; max = v; paint(); },
    set disabled(v) { input.disabled = !!v; wrap.classList.toggle('disabled', !!v); },
    set caption(v) { wrap.querySelector('.c').textContent = v; },
  };
  paint();
  return api;
}

export function combo(items, onchange, width) {
  const s = el('select.combo', { style: width ? { width: width + 'px' } : null });
  setItems(s, items);
  s.addEventListener('change', () => onchange && onchange(s.selectedIndex, s.value));
  return s;
}
export function setItems(s, items) {
  s.innerHTML = '';
  items.forEach((it, i) => {
    const o = document.createElement('option');
    if (typeof it === 'object') { o.value = it.value; o.textContent = it.text; } else { o.value = i; o.textContent = it; }
    s.append(o);
  });
}

export function swatchRow(colors, onpick, oncustom) {
  const row = el('div.swatches');
  for (const c of colors) {
    const b = el('button.swatch', { type: 'button', title: hex(c) });
    b.style.setProperty('--c', hex(c));
    b.addEventListener('click', () => onpick(c));
    row.append(b);
  }
  if (oncustom) {
    const b = el('button.swatch.custom', { type: 'button', title: 'Another color...', html: icon('plus') });
    b.addEventListener('click', () => pickColor(0xff6800, oncustom));
    row.append(b);
  }
  return row;
}

// Opens the browser's color picker; calls back with 0xRRGGBB.
export function pickColor(current, cb) {
  const inp = el('input', { type: 'color', value: hex(current), style: { position: 'fixed', left: '-100px', top: '0' } });
  document.body.append(inp);
  inp.addEventListener('change', () => { cb(parseInt(inp.value.slice(1), 16)); inp.remove(); });
  inp.addEventListener('blur', () => setTimeout(() => inp.remove(), 500));
  inp.click();
}

export const hex = c => '#' + (c & 0xffffff).toString(16).padStart(6, '0');
export function readable(c) { const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255; return (r * 299 + g * 587 + b * 114) / 1000 > 140 ? '#101012' : '#ffffff'; }
export function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])); }
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// A small modal dialog (Update Firmware, confirmations).
export function dialog(title, sub, iconName, body, buttons) {
  const d = el('dialog');
  d.append(el('div.dhead', { html: `${icon(iconName || 'info')}<div><div class="t">${esc(title)}</div><div class="s">${esc(sub || '')}</div></div>` }));
  d.append(el('div.dbody', {}, body));
  const foot = el('div.dfoot');
  for (const b of buttons || []) foot.append(b);
  d.append(foot);
  document.body.append(d);
  d.addEventListener('close', () => d.remove());
  d.showModal();
  return d;
}

export function confirmBox(title, text, okText) {
  return new Promise(res => {
    let d;
    const ok = button(okText || 'CONTINUE', { primary: true, icon: '', onclick: () => { d.close(); res(true); } });
    const no = button('CANCEL', { icon: '', onclick: () => { d.close(); res(false); } });
    d = dialog(title, '', 'info', el('p', { text, style: { margin: 0, color: 'var(--soft)' } }), [ok, no]);
    d.addEventListener('cancel', () => res(false));
  });
}

// Loads an image once.
const imgCache = {};
export function image(src) {
  if (!imgCache[src]) imgCache[src] = new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  return imgCache[src];
}

// Downloads text as a file.
export function download(name, text, type) {
  const a = el('a', { href: URL.createObjectURL(new Blob([text], { type: type || 'application/json' })), download: name });
  document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// Asks for a file; resolves with its text (or null).
export function openFile(accept) {
  return new Promise(res => {
    const inp = el('input', { type: 'file', accept, style: { display: 'none' } });
    document.body.append(inp);
    inp.addEventListener('change', async () => { const f = inp.files[0]; inp.remove(); res(f ? await f.text() : null); });
    inp.click();
  });
}
