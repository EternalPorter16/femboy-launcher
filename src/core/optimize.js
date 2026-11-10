// «Оптимизация»: моды для скорости. «Основа» ставится сразу, остальное — по желанию. Под каждый загрузчик и версию игры берём
// только то, что для них вышло: на Forge нет Sodium — там вместо него Embeddium, а FastQuit есть только на Fabric
const fs = require('fs');
const instances = require('./instances');
const mods = require('./mods');
const modmeta = require('./modmeta');
const modrinth = require('./modrinth');
const { pool } = require('./net');

const SUPPORTED = ['fabric', 'quilt', 'forge', 'neoforge'];
const alt = (slug, id, name, modId) => ({ slug, id, name, modId });

// alts — равноценные варианты: берём первый, который есть под загрузчик и версию. needs — нужен именно Sodium
const CATALOG = [
  {
    key: 'render', core: true, title: 'Быстрая отрисовка',
    alts: [alt('sodium', 'AANobbMI', 'Sodium', 'sodium'), alt('embeddium', 'sk9rgfiA', 'Embeddium', 'embeddium')],
    desc: 'Главный ускоритель: заменяет отрисовку игры. Кадров заметно больше, подвисаний меньше.',
  },
  { key: 'lithium', core: true, title: 'Игровая логика', alts: [alt('lithium', 'gvQqBUqZ', 'Lithium', 'lithium')], desc: 'Ускоряет мобов, блоки и тики — меньше лагов в мире.' },
  { key: 'ferrite', core: true, title: 'Память', alts: [alt('ferrite-core', 'uXXizFIs', 'FerriteCore', 'ferritecore')], desc: 'Экономит оперативную память — заметно, когда модов много.' },
  { key: 'culling', core: true, title: 'Невидимое', alts: [alt('entityculling', 'NNAgCjsB', 'Entity Culling', 'entityculling')], desc: 'Не рисует тех, кого не видно за стеной: больше кадров на фермах и в деревнях.' },
  { key: 'immediate', core: true, title: 'Интерфейс', alts: [alt('immediatelyfast', '5ZwdcRci', 'ImmediatelyFast', 'immediatelyfast')], desc: 'Ускоряет отрисовку меню, текста и сундуков.' },
  { key: 'modernfix', core: true, title: 'Запуск и баги', alts: [alt('modernfix', 'nmDcB62a', 'ModernFix', 'modernfix')], desc: 'Быстрее загрузка игры, меньше памяти, исправляет частые баги.' },
  { key: 'dynamicfps', title: 'Свёрнутая игра', alts: [alt('dynamic-fps', 'LQ3K71Q1', 'Dynamic FPS', 'dynamicfps')], desc: 'Когда окно игры не в фокусе, сбавляет кадры и нагрузку: тише вентиляторы, дольше батарея.' },
  { key: 'moreculling', title: 'Ещё меньше лишнего', alts: [alt('moreculling', '51shyZVL', 'More Culling', 'moreculling')], desc: 'Прячет ещё больше невидимого — прибавка кадров в закрытых местах.' },
  { key: 'sodiumextra', title: 'Настройки графики', needs: 'sodium', alts: [alt('sodium-extra', 'PtjYWJkn', 'Sodium Extra', 'sodiumextra')], desc: 'Дополнение к Sodium: облака, частицы, анимации и другие настройки графики.' },
  { key: 'reeses', title: 'Меню видео', needs: 'sodium', alts: [alt('reeses-sodium-options', 'Bh37bMuy', 'Reese’s Sodium Options', 'reesessodiumoptions')], desc: 'Красивое меню видеонастроек для Sodium.' },
  { key: 'ixeris', title: 'Мышь и окно', alts: [alt('ixeris', 'p8RJPJIC', 'Ixeris', 'ixeris')], desc: 'Отзывчивее мышь и окно: ввод обрабатывается отдельным потоком.' },
  { key: 'scalablelux', title: 'Освещение', alts: [alt('scalablelux', 'Ps1zyz6x', 'ScalableLux', 'scalablelux')], desc: 'Быстрее обновляется свет — меньше подвисаний при стройке и загрузке мира.' },
  { key: 'fastquit', title: 'Быстрый выход', alts: [alt('fastquit', 'x1hIzbuY', 'FastQuit', 'fastquit')], desc: 'Выход в меню сразу, а мир сохраняется в фоне.' },
];

const norm = (s) => String(s || '').toLowerCase().replace(/[-_\s]/g, '');

// Что из каталога уже стоит в сборке (включённое): по проекту Modrinth, а для чужих файлов — по id мода внутри jar
function installedIn(instId) {
  const have = new Map(); // id проекта или id мода → название файла
  for (const m of mods.list(instId)) {
    if (!m.enabled) continue;
    if (m.source === 'modrinth' && m.projectId) have.set(String(m.projectId), m.file);
    else {
      const meta = modmeta.readMeta(mods.filePath(instId, m.file));
      if (meta?.id) have.set('mod:' + norm(meta.id), m.file);
    }
  }
  return (a) => have.get(a.id) || have.get('mod:' + norm(a.modId)) || null;
}

const cache = new Map(); // «проект|версия|загрузчики» → { at, list }: список версий не меняется за минуты, а окно можно открывать часто
async function versionsOf(id, version, loaders) {
  const key = `${id}|${version}|${loaders}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.list;
  // Окно «Оптимизация» не должно висеть, если Modrinth молчит: через 10 секунд считаем, что связи нет
  const list = await Promise.race([modrinth.versionList(id, version, loaders), new Promise((_, no) => setTimeout(() => no(new Error('таймаут')), 10000))]);
  cache.set(key, { at: Date.now(), list });
  return list;
}

// Что подходит этой сборке: у каждого пункта — состояние installed | available | missing (+ причина)
async function plan(instId, onlyKeys) {
  const inst = instances.get(instId);
  const base = { loader: inst.loader, version: inst.version };
  if (!SUPPORTED.includes(inst.loader)) return { ...base, vanilla: true, items: [] };
  const loaders = modrinth.loadersFor(inst.loader);
  const has = installedIn(instId);
  const catalog = CATALOG.filter((i) => !onlyKeys || onlyKeys.includes(i.key));
  const items = new Array(catalog.length);
  await pool(catalog, catalog.length, async (item, n) => {
    const pub = { key: item.key, core: !!item.core, title: item.title, desc: item.desc };
    const stands = item.alts.find((a) => has(a));
    if (stands) return (items[n] = { ...pub, state: 'installed', name: stands.name });
    let offline = false;
    for (const a of item.alts) {
      const list = await versionsOf(a.id, inst.version, loaders).catch(() => null);
      if (list === null) offline = true; // не достучались до Modrinth — это не значит, что версии нет
      else if (list.length) return (items[n] = { ...pub, state: 'available', name: a.name, slug: a.slug, version: list[0].version_number });
    }
    items[n] = offline
      ? { ...pub, state: 'unknown', name: item.alts[0].name, reason: 'не удалось проверить' }
      : { ...pub, state: 'missing', name: item.alts[0].name, reason: `нет для ${modrinth.LOADER_NAMES[inst.loader]} ${inst.version}` };
  });
  if (items.length && items.every((i) => i?.state === 'unknown')) throw new Error('Нет связи с Modrinth — проверь интернет и попробуй ещё раз');
  // Дополнения к Sodium без самого Sodium бесполезны (на Forge вместо него Embeddium): их не предлагаем
  const render = items.find((i) => i?.key === 'render');
  for (const item of items) {
    const def = CATALOG.find((c) => c.key === item.key);
    if (def.needs === 'sodium' && item.state === 'available' && render && render.name !== 'Sodium') Object.assign(item, { state: 'missing', reason: 'работает только с Sodium' });
  }
  return { ...base, items: items.filter(Boolean) };
}

// Поставить выбранное; без выбора — всю «Основу», что есть под эту сборку
async function run(instId, keys, progress = () => {}) {
  const inst = instances.get(instId);
  if (!SUPPORTED.includes(inst.loader)) throw new Error('Оптимизация ставит моды — включи в сборке Fabric или другой загрузчик');
  const wanted = keys?.length ? keys : CATALOG.filter((i) => i.core).map((i) => i.key);
  const pl = await plan(instId, wanted);
  const todo = pl.items.filter((i) => i.state === 'available');
  const result = { installed: [], warnings: [], notes: [], skipped: pl.items.filter((i) => i.state === 'missing' || i.state === 'unknown').map((i) => `${i.name} (${i.reason})`) };
  for (const [n, item] of todo.entries()) {
    progress(`Ставлю: ${item.name} (${n + 1} / ${todo.length})`, (n / todo.length) * 100);
    try {
      const r = await modrinth.installMod(instId, item.slug);
      for (const k of ['installed', 'warnings', 'notes']) result[k].push(...r[k]);
    } catch (e) {
      result.skipped.push(`${item.name}: ${e.message}`);
    }
  }
  return result;
}

// Сколько пунктов «Основы» ещё не стоит (без сети, по файлам): для подсказки «ускорь игру»
function coreMissing(instId) {
  const has = installedIn(instId);
  return CATALOG.filter((i) => i.core && !i.alts.some((a) => has(a))).map((i) => i.alts[0].name);
}

module.exports = { plan, run, coreMissing, CATALOG };
