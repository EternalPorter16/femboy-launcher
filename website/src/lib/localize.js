// Translate the shared Astro output while prerendering. The deployed pages are
// ordinary English HTML: no translation service or client-side replacement.
import { parse, serialize } from 'parse5';
import messages from '../data/en.json' with { type: 'json' };
import releases from '../data/releases.json' with { type: 'json' };

const normalise = (s) => s.trim().replace(/\s+/g, ' ');
const dictionary = new Map(Object.entries(messages));
for (const release of releases) {
  for (let i = 0; i < release.items.length; i++) {
    const en = release.itemsEn?.[i];
    if (en) {
      dictionary.set(normalise(release.items[i].title), en.title);
      dictionary.set(normalise(release.items[i].text), en.text);
    }
  }
}
const months = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
const englishMonths = ['January','February','March','April','May','June','July','August','September','October','November','December'];
export function englishText(value) {
  const key = normalise(value);
  let translated = dictionary.get(key);
  if (translated === undefined && key.startsWith('Открыть крупно: ')) translated = 'Enlarge: ' + englishText(key.slice(16));
  if (translated === undefined) {
    const date = /^(\d{1,2}) (\S+) (\d{4})$/.exec(key);
    if (date && months.includes(date[2])) translated = `${date[1]} ${englishMonths[months.indexOf(date[2])]} ${date[3]}`;
    else if (/^[,(]?\s*\d+,\d+ МБ\)?$/.test(key)) translated = key.replace(/(\d),(\d)/, '$1.$2').replace('МБ','MB');
    else if (/^(Версия|Скачать|Что нового в) [\d.]+$/.test(key)) translated = key.replace(/^Версия /,'Version ').replace(/^Скачать /,'Download ').replace(/^Что нового в /,'What’s new in ');
    else if (key.startsWith('Версия лаунчера:')) translated = key.replace(/^Версия лаунчера: ([\d.]+).*$/, 'Launcher version: $1\nWindows version and architecture:\nInstaller or Portable:\nSteps before the error:\nExact error message:\nWhat I have already tried:');
    else if (/^Femboy Launcher, \d{4}\. Шрифты/.test(key)) translated = key.replace(/\. Шрифты.*$/, '. Comfortaa, Nunito and Fredoka fonts are available under the');
  }
  if (translated === undefined) {
    if (/[А-Яа-яЁё]/.test(key)) throw new Error(`Missing English website translation: ${key}`);
    return value;
  }
  return value.slice(0, value.length - value.trimStart().length) + translated + value.slice(value.trimEnd().length);
}

export function localizeHtml(html, base = '/') {
  const tree = parse(html);
  const localized = (path) => path.startsWith(base) && !path.startsWith(base + 'en/') &&
    ['', 'releases/', 'guides/setup-or-portable/', 'guides/install-modrinth-modpack/'].includes(path.slice(base.length).split('#')[0].split('?')[0]);
  function visit(node) {
    if (['script', 'style', 'svg'].includes(node.tagName)) return;
    if (node.nodeName === '#text') node.value = englishText(node.value);
    const attrs = node.attrs || [];
    const get = (name) => attrs.find((a) => a.name === name);
    if (node.tagName === 'html') get('lang').value = 'en';
    for (const attr of attrs) {
      if (['alt','title','aria-label','aria-valuetext','data-alt','data-caption'].includes(attr.name)) attr.value = englishText(attr.value);
      if (attr.name === 'content') {
        if (get('property')?.value === 'og:locale') attr.value = 'en_US';
        else attr.value = englishText(attr.value);
      }
      if (node.tagName === 'a' && attr.name === 'href' && !get('data-language-link') && localized(attr.value)) attr.value = base + 'en/' + attr.value.slice(base.length);
    }
    for (const child of node.childNodes || []) visit(child);
  }
  visit(tree);
  return serialize(tree);
}
