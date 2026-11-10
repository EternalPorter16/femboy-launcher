// Заметки об обновлении: «Что нового» новой версии. Сборка кладёт их в latest.yml (build/release-notes.js делает из записи whatsnew.js файл
// build/release-notes.md, а electron-builder переносит его в latest.yml), лаунчер показывает их перед обновлением. Формат — обычный markdown:
// пункт на строку («- 🧹 **Название** — текст»), сначала русский блок, потом строка «---», потом английский. Файл один и для сборки (Node),
// и для окна лаунчера (обычный скрипт)
(function (root) {
  const MAX_ITEMS = 30;
  const MAX_TEXT = 1500; // настоящие пункты «Что нового» до тысячи знаков; больше — уже не заметка
  const clean = (s) => String(s ?? '').replace(/[\r\n]+/g, ' ').replace(/\*\*/g, '').trim();
  const LINE = /^\s*[-*]\s+(\S+)\s+\*\*(.+?)\*\*\s+[—–-]\s+(.+?)\s*$/;

  // entry — запись из whatsnew.js: { ru: [[значок, название, текст], …], en: [...] }
  function render(entry) {
    const block = (items) => (items || []).map(([icon, title, text]) => `- ${clean(icon)} **${clean(title)}** — ${clean(text)}`).join('\n');
    return `${block(entry.ru)}\n\n---\n\n${block(entry.en)}\n`;
  }

  const items = (text) =>
    String(text)
      .split(/\r?\n/)
      .map((l) => LINE.exec(l))
      .filter(Boolean)
      .slice(0, MAX_ITEMS)
      .map((m) => [m[1], m[2], m[3].length > MAX_TEXT ? m[3].slice(0, MAX_TEXT - 1) + '…' : m[3]]);

  // notes — то, что пришло в latest.yml (строка; у GitHub — список { version, note }); lang — 'ru' или 'en'. Не разобралось — пустой список
  function parse(notes, lang = 'ru') {
    if (Array.isArray(notes)) return items(notes.map((n) => (typeof n === 'string' ? n : n?.note || '')).join('\n'));
    if (typeof notes !== 'string') return [];
    const [ru = '', en = ''] = notes.split(/^-{3,}\s*$/m);
    const [first, second] = lang === 'en' ? [items(en), items(ru)] : [items(ru), items(en)];
    return first.length ? first : second;
  }

  const api = { render, parse };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.UpdateNotes = api;
})(typeof window !== 'undefined' ? window : globalThis);
