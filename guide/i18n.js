// The guide in the Configurator's languages (../js/i18n.js: the same choice, kept in this browser; ?lang=ja opens it in one).
// The page is written in English; lang/<code>.js gives each block of text in that language: on the left the English text
// as it reads (without its tags, spaces collapsed), on the right the HTML shown instead. A block that isn't there stays
// in English (button names, firmware names). The screenshots show the English Configurator.
import { lang, LANGS, setLang } from '../js/i18n.js';

const norm = s => s.replace(/\s+/g, ' ').trim();
const SKIP = new Set(['SVG', 'SCRIPT', 'STYLE', 'IMG', 'SELECT']);
// the blocks of text: every element with text of its own (its inline tags included), outermost first
export function blocks(root, out = []) {
  for (const e of root.children) {
    if (SKIP.has(e.tagName.toUpperCase())) continue;
    if ([...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) out.push(e); else blocks(e, out);
  }
  return out;
}

const menu = document.getElementById('lang');
for (const [value, text] of LANGS) menu.append(Object.assign(document.createElement('option'), { value, textContent: text }));
menu.value = lang;
menu.addEventListener('change', () => setLang(menu.value));

try {
  if (lang !== 'en') {
    const dict = (await import('./lang/' + lang + '.js')).default;
    const dev = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    for (const e of blocks(document.body)) {
      const k = norm(e.textContent), v = dict[k];
      if (v != null) e.innerHTML = v;
      else if (dev && /[a-z]{3} [a-z]{2}/.test(k)) console.warn('[i18n] the guide in ' + lang + ' has no text for: ' + k);
    }
    if (dict[document.title]) document.title = dict[document.title];
  }
} catch (e) { }
document.documentElement.classList.remove('i18n-wait');
