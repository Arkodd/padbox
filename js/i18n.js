// The app's languages. The code is written in English and every text shown goes through $t(): $t('Save') gives the
// chosen language's text from js/lang/<code>.js (its key is the English text itself), or the English when that
// language has none. {0}, {1}... in a text are filled from the other arguments, so each language orders them its own way:
//   $t('Made on a {0} with {1}', board, firmware)
// $tn() is the same for a name that comes from a table (a button, a function): most of those stay as they are.
// The language is the one chosen in the header's menu (kept in this browser), else the browser's, else English;
// ?lang=ja in the address opens the page in that language. tools/i18n-check.js lists what a language is missing.

export const LANGS = [['en', 'English'], ['ja', '日本語'], ['fr', 'Français'], ['es', 'Español'], ['de', 'Deutsch'], ['pt', 'Português'], ['ko', '한국어'], ['zh', '简体中文']];
const KEY = 'padbox-lang';
const HTML_LANG = { pt: 'pt-BR', zh: 'zh-Hans' };
const has = c => LANGS.some(l => l[0] === c);

function choose() {
  const q = new URLSearchParams(location.search).get('lang');
  if (q && has(q)) return q;
  try { const s = localStorage.getItem(KEY); if (s && has(s)) return s; } catch (e) { }
  for (const n of navigator.languages || [navigator.language || 'en']) {
    if (/^zh-(tw|hk|mo|hant)/i.test(n)) continue;   // Traditional Chinese readers: English rather than Simplified
    const c = n.toLowerCase().split('-')[0];
    if (has(c)) return c;
  }
  return 'en';
}

export const lang = choose();
let dict = {};
if (lang !== 'en') { try { dict = (await import('./lang/' + lang + '.js')).default; } catch (e) { } }
document.documentElement.lang = HTML_LANG[lang] || lang;

// on a local test server: each text a language doesn't have yet is named once in the console
const DEV = lang !== 'en' && (location.hostname === 'localhost' || location.hostname === '127.0.0.1'), missed = new Set();
const fill = (s, a) => a.length ? s.replace(/\{(\d)\}/g, (m, i) => +i < a.length ? a[+i] : m) : s;

export function $t(s, ...a) {
  const r = dict[s];
  if (r == null && DEV && !missed.has(s)) { missed.add(s); console.warn('[i18n] ' + lang + ' has no text for: ' + s); }
  return fill(r == null ? s : r, a);
}
export const $tn = s => { const r = dict[s]; return r == null ? s : r; };
// a text with elements in it: $tNodes('Read the {0} first', link) gives the pieces to append, the element in its place
export function $tNodes(s, ...nodes) {
  const r = dict[s];
  return (r == null ? s : r).split(/(\{\d\})/).map(p => { const m = /^\{(\d)\}$/.exec(p); return m ? nodes[+m[1]] : p; }).filter(p => p !== '' && p != null);
}

// chosen in the menu: kept, and the page opens again in it (a connected PadBox is found again by itself)
export function setLang(code) {
  if (!has(code) || code === lang) return;
  try { localStorage.setItem(KEY, code); } catch (e) { }
  const u = new URL(location.href); u.searchParams.delete('lang');
  if (u.href === location.href) location.reload(); else location.replace(u.href);
}

// a date as the language writes it ("12 Oct 2026, 17:32" in English); time: with the hour
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function niceDate(d, time = true) {
  d = new Date(d);
  if (lang !== 'en') {
    try { return new Intl.DateTimeFormat(HTML_LANG[lang] || lang, time ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }).format(d); } catch (e) { }
  }
  const p = n => String(n).padStart(2, '0');
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` + (time ? `, ${p(d.getHours())}:${p(d.getMinutes())}` : '');
}
