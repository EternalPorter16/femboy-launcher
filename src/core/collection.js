// Импорт коллекции Modrinth: ссылка → список проектов коллекции → установка выбранных в сборку теми же средствами, что и обычная установка из каталога
// (подбор версии под игру и загрузчик, зависимости, проверка несовместимости модов). Только чтение публичных данных; приватные коллекции не видны.
// Сама коллекция есть только в API v3 (в v2 такого маршрута нет), а названия, версии и загрузчики проектов берём из обычного v2 /projects
const modrinth = require('./modrinth');
const instances = require('./instances');
const { getJson } = require('./net');

const V3 = 'https://api.modrinth.com/v3';
const V2 = modrinth.API;
const MAX_PROJECTS = 300; // больше за раз не берём: это уже не «поставить коллекцию», а полкаталога
const CHUNK = 100; // сколько проектов спрашиваем одним запросом (адрес остаётся короткой строкой)
const TTL = 10 * 60e3;
const ID = /^[A-Za-z0-9]{8}$/; // коды на Modrinth — восемь знаков
const SUPPORTED = ['fabric', 'quilt', 'forge', 'neoforge'];
const KINDS = new Set(['mod', 'resourcepack', 'shader']); // что ставится прямо в сборку; модпак — отдельная сборка, ставится из «Модпаков»

// Ссылка на коллекцию в любом тексте: https://modrinth.com/collection/<id> (с /mods, ?…, #… на конце, без https://, с www), адрес API или просто код.
// Чужие сайты и похожие адреса (modrinth.com.evil.com, evilmodrinth.com) не подходят
function parseLink(text) {
  for (const raw of String(text ?? '').split(/[\s"'<>()[\]{},;«»“”‘’]+/)) {
    const token = raw.replace(/[.!?:…»]+$/, ''); // точка или восклицательный знак после ссылки в сообщении — не часть ссылки
    if (!token) continue;
    if (/^[A-Za-z0-9]{8}$/.test(token) && String(text).trim() === token) return token;
    const m = /^(?:https?:\/\/)?(?:www\.|api\.)?modrinth\.com\/(?:v[23]\/)?collection\/([A-Za-z0-9]{8})(?:[/?#].*)?$/i.exec(token);
    if (m) return m[1];
  }
  return null;
}

const short = (s, n) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, n) : '');

// Разбор ответа v3 и v2 в то, что нужно окну. Без «тела» проектов: оно длинное и окну не нужно
function normalize(id, c, found, order) {
  const byId = new Map(found.map((p) => [p.id, p]));
  const projects = [];
  let missing = 0;
  for (const id of order) {
    const p = byId.get(id);
    if (!p) {
      missing++;
      continue;
    }
    const type = typeof p.project_type === 'string' ? p.project_type : 'mod';
    projects.push({
      id: p.id,
      slug: typeof p.slug === 'string' ? p.slug : null,
      title: short(p.title, 80) || p.slug || p.id,
      type,
      icon: typeof p.icon_url === 'string' && /^https:\/\//.test(p.icon_url) ? p.icon_url : null,
      description: short(p.description, 200),
      loaders: Array.isArray(p.loaders) ? p.loaders.filter((x) => typeof x === 'string') : [],
      versions: Array.isArray(p.game_versions) ? p.game_versions.filter((x) => typeof x === 'string') : [],
      importable: KINDS.has(type),
    });
  }
  return { id, name: short(c.name, 80) || 'Коллекция', description: short(c.description, 400), missing, projects };
}

const cache = new Map(); // id → { at, data }: пока человек выбирает цель и галочки, коллекцию заново не качаем

async function fetchCollection(id) {
  let c;
  try {
    c = await getJson(`${V3}/collection/${id}`);
  } catch (e) {
    if (e.status === 404 || e.status === 400) throw new Error('Коллекция не найдена. Проверь ссылку; закрытые (приватные) коллекции лаунчер не видит');
    throw e;
  }
  if (!c || typeof c !== 'object' || !Array.isArray(c.projects)) throw new Error('Modrinth ответил не так, как ожидалось: это точно коллекция?');
  const all = [...new Set(c.projects.filter((x) => typeof x === 'string' && ID.test(x)))];
  const order = all.slice(0, MAX_PROJECTS);
  const found = [];
  for (let i = 0; i < order.length; i += CHUNK) {
    const part = order.slice(i, i + CHUNK);
    const got = await getJson(`${V2}/projects?ids=${encodeURIComponent(JSON.stringify(part))}`);
    if (Array.isArray(got)) found.push(...got.filter((p) => p && typeof p.id === 'string'));
  }
  return { ...normalize(id, c, found, order), truncated: Math.max(0, all.length - order.length) };
}

async function loadById(id, { force = false } = {}) {
  if (!ID.test(String(id))) throw new Error('Некорректный код коллекции');
  const hit = cache.get(id);
  if (!force && hit && Date.now() - hit.at < TTL) return hit.data;
  const data = await fetchCollection(id);
  cache.set(id, { at: Date.now(), data });
  while (cache.size > 5) cache.delete(cache.keys().next().value); // самую давнюю убираем
  return data;
}

function load(text, opts) {
  const id = parseLink(text);
  if (!id) return Promise.reject(new Error('Не вижу ссылки на коллекцию Modrinth: она выглядит как modrinth.com/collection/abcd1234'));
  return loadById(id, opts);
}

// Подходит ли проект под версию игры и загрузчик: ok / version (нет под эту версию) / loader (под версию есть, но не на этом загрузчике) / type (сюда не ставится).
// Решаем по спискам проекта: версия проекта с нужным сочетанием может и не найтись, это выяснится при установке. Quilt запускает и Fabric-моды
function compat(project, version, loader) {
  if (!project.importable) return 'type';
  if (!project.versions.includes(version)) return 'version';
  if (project.type !== 'mod') return 'ok'; // у ресурспаков и шейдеров «загрузчики» — другое (iris, minecraft…)
  const wanted = loader === 'quilt' ? ['quilt', 'fabric'] : SUPPORTED.includes(loader) ? [loader] : SUPPORTED; // ванильной сборке подойдёт любой: загрузчик поставится сам
  return wanted.some((l) => project.loaders.includes(l)) ? 'ok' : 'loader';
}

// Какую версию игры и какой загрузчик предложить для новой сборки: те, под которые у большинства проектов есть версия.
// releases — версии игры от новой к старой (только релизы); смотрим на самые свежие
function suggest(projects, releases) {
  const mods = projects.filter((p) => p.importable && p.type === 'mod');
  const others = projects.filter((p) => p.importable && p.type !== 'mod');
  const pool = projects.filter((p) => p.importable);
  if (!pool.length || !Array.isArray(releases) || !releases.length) return null;
  const loaders = mods.length ? SUPPORTED : ['vanilla'];
  let best = null;
  for (const loader of loaders) {
    for (const version of releases.slice(0, 12)) {
      const fits = pool.filter((p) => compat(p, version, loader) === 'ok').length;
      if (!best || fits > best.fits) best = { version, loader, fits, total: pool.length };
    }
  }
  return best && best.fits ? best : null;
}

// Ответ окну на «Показать»: коллекция и совет для новой сборки. listVersions отдаёт список версий Minecraft; нет списка (нет связи с Mojang) —
// окно просто не подскажет, что выбрать для новой сборки, а коллекцию покажет
async function show(text, listVersions) {
  const data = await load(text);
  let advice = null;
  try {
    const releases = (await listVersions()).versions.filter((v) => v.type === 'release').map((v) => v.id);
    advice = suggest(data.projects, releases);
  } catch {}
  return { ...data, suggest: advice };
}

// «Подходит ли» для каждого проекта коллекции под выбранную цель: существующая сборка ({ instance }, её версию и загрузчик даёт find) или { version, loader }
async function fits(id, target, find) {
  const data = await loadById(id);
  const t = target?.instance ? find(target.instance) : target || {};
  return Object.fromEntries(data.projects.map((p) => [p.id, compat(p, t.version, t.loader)]));
}

// Что сделать с выбранными проектами: цель — существующая сборка { instance } или новая { version, loader, name }.
// ids — какие проекты ставить (из этой коллекции). point(instId) — точка восстановления перед первой установкой в существующую сборку
async function run(id, target, ids, { progress = () => {}, point } = {}) {
  const data = await loadById(id);
  const byId = new Map(data.projects.map((p) => [p.id, p]));
  const picks = [...new Set((Array.isArray(ids) ? ids : []).filter((x) => typeof x === 'string'))].slice(0, MAX_PROJECTS);
  const failed = [];
  const queue = [];
  for (const pid of picks) {
    const p = byId.get(pid);
    if (!p) failed.push({ title: pid, error: 'такого проекта нет в этой коллекции' });
    else if (!p.importable) failed.push({ title: p.title, error: p.type === 'modpack' ? 'модпак в сборку так не ставится — модпаки ставятся из «Моды → Модпаки»' : `${p.type} в сборку так не ставится` });
    else queue.push(p);
  }
  if (!queue.length) throw new Error(failed.length ? 'Из выбранного ничего поставить нельзя' : 'Ничего не выбрано');

  let inst;
  let created = false;
  if (target?.instance) {
    inst = instances.get(target.instance);
    try {
      point?.(inst.id);
    } catch {} // точка восстановления — подстраховка, а не условие
  } else {
    if (!target?.version || !/^[\w.+-]{1,40}$/.test(String(target.version))) throw new Error('Не выбрана версия Minecraft для новой сборки');
    // длинное название (больше сорока знаков) и незнакомый загрузчик (тогда ванилла) приводит в порядок сама instances.create
    inst = instances.create({ name: short(target.name, 40) || data.name, version: String(target.version), loader: target.loader, icon: '📚' });
    created = true;
  }

  const installed = [];
  const warnings = [];
  const notes = [];
  try {
    for (const [i, p] of queue.entries()) {
      progress(`Ставлю «${p.title}» (${i + 1} / ${queue.length})…`, (i / queue.length) * 100);
      try {
        const r = await modrinth.install(inst.id, p.id, p.type);
        installed.push(...r.installed);
        warnings.push(...r.warnings);
        notes.push(...(r.notes || []));
      } catch (e) {
        if (e.cancelled) throw e; // «Отменить» останавливает всё, а не только этот проект
        failed.push({ title: p.title, error: e.message });
      }
    }
  } catch (e) {
    if (created && !installed.length) instances.remove(inst.id); // отменили, а в новую сборку ещё ничего не попало
    throw e;
  }
  if (created && !installed.length) {
    instances.remove(inst.id);
    throw new Error(`Не получилось поставить ничего: ${failed.slice(0, 3).map((f) => `«${f.title}» — ${f.error}`).join('; ')}`);
  }
  return { instance: instances.get(inst.id), created, installed: [...new Set(installed)], failed, warnings, notes };
}

module.exports = { parseLink, load, loadById, compat, suggest, show, fits, run, MAX_PROJECTS };
