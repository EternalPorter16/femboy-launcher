// Разбор src/config/downloads.json в то, что показывает раздел «Скачать».
// Здесь единственное место, где из конфига получаются адреса файлов: компоненты берут готовый результат.
//
// Откуда берётся адрес файла (по порядку):
//   1. files.<id>.url — полный адрес конкретного файла;
//   2. storage.fileUrlTemplate — шаблон адреса, в который подставляются {fileName} и {version};
//   3. иначе прямой ссылки нет, и кнопка честно ведёт в общую папку storage.folderUrl.
// Для storage.provider = 'yandex' компонент поверх этого запасного адреса добавляет
// получение свежей ссылки при нажатии (src/lib/yandex-download.js).
// Неподтверждённое не показывается: кривые дата, размер или контрольная сумма просто пропадают со страницы.

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v.trim() : '');

export function safeUrl(value) {
  const s = str(value);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

export function parseDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(value));
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return { iso: m[0], label: `${d} ${MONTHS[mo - 1]} ${y}` };
}

export function formatSize(bytes) {
  if (!Number.isSafeInteger(bytes) || bytes <= 0) return null;
  const mb = bytes / 1024 / 1024;
  return `${mb.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} МБ`;
}

// {name} → значение; в адресах значения кодируются (encode = true), в именах файлов нет
const fill = (template, vars, encode = false) =>
  template.replace(/\{(\w+)\}/g, (all, key) => (key in vars ? (encode ? encodeURIComponent(vars[key]) : vars[key]) : all));

const TITLES = {
  setup: { title: 'Установщик', action: 'Скачать установщик' },
  portable: { title: 'Portable', action: 'Скачать Portable' },
};

export function resolveDownloads(config) {
  const warnings = [];
  const cfg = isObj(config) ? config : {};
  const release = isObj(cfg.release) ? cfg.release : {};
  const storage = isObj(cfg.storage) ? cfg.storage : {};
  const files = isObj(cfg.files) ? cfg.files : {};

  const version = /^\d+\.\d+\.\d+([-+][\w.-]+)?$/.test(str(release.version)) ? str(release.version) : null;
  if (!version) warnings.push('release.version не указана или записана не как 1.2.3: версия не показывается');
  const date = parseDate(release.date);
  if (str(release.date) && !date) warnings.push('release.date записана не как ГГГГ-ММ-ДД: дата не показывается');
  const highlights = Array.isArray(release.highlights) ? release.highlights.map(str).filter(Boolean) : [];

  const storageLabel = str(storage.label) || 'хранилище файлов';
  // «где лежат файлы» для подписей: «Открыть файлы на Яндекс.Диске»
  const storageWhere = str(storage.where) || `в хранилище «${storageLabel}»`;
  const folderUrl = safeUrl(storage.folderUrl);
  if (str(storage.folderUrl) && !folderUrl) warnings.push('storage.folderUrl должен быть адресом https://');
  const template = str(storage.fileUrlTemplate);

  const options = Object.keys(TITLES).map((id) => {
    const f = isObj(files[id]) ? files[id] : {};
    const rawName = str(f.fileName);
    // Без известной версии имя с {version} было бы выдумкой, поэтому не показываем его
    const fileName = rawName && (!rawName.includes('{version}') || version) ? fill(rawName, { version: version || '' }) : null;
    let href = safeUrl(f.url);
    if (str(f.url) && !href) warnings.push(`files.${id}.url должен быть адресом https://`);
    if (!href && template && fileName) {
      href = safeUrl(fill(template, { fileName, version: version || '' }, true));
      if (!href) warnings.push('storage.fileUrlTemplate после подстановки не дал адрес https://');
    }
    const sha256 = /^[a-f0-9]{64}$/i.test(str(f.sha256)) ? str(f.sha256).toLowerCase() : null;
    if (str(f.sha256) && !sha256) warnings.push(`files.${id}.sha256 — не 64 шестнадцатеричных знака: сумма не показывается`);
    const size = formatSize(f.sizeBytes);
    return {
      id,
      ...TITLES[id],
      fileName,
      direct: Boolean(href),
      href: href || folderUrl,
      size,
      sha256,
    };
  });

  const mode = options.every((o) => o.direct) ? 'direct' : options.some((o) => o.href) ? (options.some((o) => o.direct) ? 'mixed' : 'folder') : 'none';
  if (mode === 'none') warnings.push('нет ни прямых адресов файлов, ни адреса папки: кнопки скачивания не показываются');

  return {
    version,
    date,
    highlights,
    storage: { label: storageLabel, where: storageWhere, folderUrl },
    options,
    mode,
    warnings,
  };
}
