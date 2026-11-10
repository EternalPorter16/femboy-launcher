// Точки восстановления сборки: снимок модов, папки config и версии загрузчика, чтобы неудачное обновление мода или
// модпака откатывалось одним кликом. Моды попадают в снимок жёсткими ссылками (мгновенно и без лишнего места: jar никто
// не правит «на месте»), config копируется (его игра переписывает на месте). Лежат снимки вне папки сборки, поэтому в
// облачную синхронизацию, экспорт и копию сборки не попадают
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('./store');
const instances = require('./instances');
const fsx = require('./fsx');

const MAX_AUTO = 8; // автоматических точек на сборку
const MAX_ALL = 20; // всего, вместе с сохранёнными вручную («Последний удачный запуск» в эти лимиты не входит)
const FIELDS = ['version', 'loader', 'loaderVersion', 'pack']; // версия загрузчика и модпака должна откатываться вместе с модами
const META_FILES = ['mods-meta.json', 'pack-files.json']; // наши записи о том, что откуда поставлено
const ID_RE = /^\d{8}-\d{6}-[a-f0-9]{4}$/;
const GOOD_REASON = 'Последний удачный запуск';
let lastTime = 0;

const isGood = (s) => s.kind === 'good';
const isJar = (rel) => /\.jar(\.disabled)?$/i.test(rel); // что в папке mods считается модом (как во вкладке «Моды»); кэши и заметки модов — нет

const rootOf = (instId) => path.join(store.baseDir(), 'snapshots', instId);
const dirOf = (instId, snapId) => path.join(rootOf(instId), snapId);

function checkId(snapId) {
  if (!ID_RE.test(String(snapId))) throw new Error('Некорректная точка восстановления');
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${crypto.randomBytes(2).toString('hex')}`;
}

// Переносит папку целиком. link: жёсткими ссылками, а если файловая система их не умеет (другой диск, не NTFS), копией.
// Копия сохраняет время изменения, чтобы одинаковое содержимое давало одинаковый «отпечаток»
function copyTree(from, to, link) {
  let files = 0;
  let bytes = 0;
  const walk = (src, dst) => {
    fs.mkdirSync(dst, { recursive: true });
    for (const e of fs.readdirSync(src, { withFileTypes: true })) {
      const s = path.join(src, e.name);
      const d = path.join(dst, e.name);
      if (e.isDirectory()) walk(s, d);
      else if (e.isFile()) {
        const st = fs.statSync(s);
        let linked = false;
        if (link) {
          try {
            fs.linkSync(s, d);
            linked = true;
          } catch {}
        }
        if (!linked) {
          fs.copyFileSync(s, d);
          fs.utimesSync(d, st.atime, st.mtime);
        }
        files++;
        bytes += st.size;
      }
    }
  };
  if (fs.existsSync(from)) walk(from, to);
  return { files, bytes };
}

// { 'подпапка/файл.jar': размер } — по ней сравниваем состояние и считаем, что изменилось
function listTree(root) {
  const out = {};
  const walk = (dir, rel) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) walk(path.join(dir, e.name), `${rel}${e.name}/`);
      else if (e.isFile()) {
        try {
          const st = fs.statSync(path.join(dir, e.name));
          out[`${rel}${e.name}`] = [st.size, Math.round(st.mtimeMs)];
        } catch {}
      }
    }
  };
  walk(root, '');
  return out;
}

const pick = (inst) => Object.fromEntries(FIELDS.map((k) => [k, inst[k] ?? null]));

const flat = (t) => Object.entries(t).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}|${v[0]}|${v[1]}`).join('\n');

function fingerprint(instId, inst) {
  const g = instances.gameDir(instId);
  const metas = META_FILES.map((f) => {
    try {
      return fs.readFileSync(path.join(instances.dirOf(instId), f), 'utf8');
    } catch {
      return '';
    }
  });
  return crypto.createHash('sha1').update(['packs-v2', ...['mods', 'config', 'resourcepacks', 'shaderpacks'].map((name) => flat(listTree(path.join(g, name)))), JSON.stringify(pick(inst)), ...metas].join('\n#\n')).digest('hex');
}

function read(instId, snapId) {
  checkId(snapId);
  const r = fsx.readJson(path.join(dirOf(instId, snapId), 'snapshot.json'));
  if (!r.ok || r.data?.id !== snapId) throw new Error('Точка восстановления не найдена');
  return r.data;
}

// Что изменилось в модах с тех пор, как сделана точка
function diffNow(instId, info) {
  const now = listTree(path.join(instances.gameDir(instId), 'mods'));
  const was = info.modFiles || {};
  let added = 0;
  let changed = 0;
  for (const [k, v] of Object.entries(now)) {
    if (!(k in was)) added++;
    else if (was[k] !== v[0]) changed++;
  }
  const removed = Object.keys(was).filter((k) => !(k in now)).length;
  return { added, removed, changed };
}

// Отпечаток только модов и версий, без config (его игра переписывает сама): по нему видно, менялись ли моды за время игры
function modsSig(instId) {
  const inst = instances.get(instId);
  const jars = Object.fromEntries(Object.entries(listTree(path.join(instances.gameDir(instId), 'mods'))).filter(([k]) => isJar(k)));
  return crypto.createHash('sha1').update([flat(jars), JSON.stringify(pick(inst))].join('\n#\n')).digest('hex');
}

// Записи о точках как лежат на диске (с отпечатком), новые первыми
function rawList(instId) {
  let names = [];
  try {
    names = fs.readdirSync(rootOf(instId));
  } catch {
    return [];
  }
  const out = [];
  for (const n of names) {
    if (!ID_RE.test(n)) continue; // «.part» от прерванного снимка и прочее
    try {
      out.push(read(instId, n));
    } catch {}
  }
  // По времени, а не по имени: имя точно до секунды, а точки бывают чаще
  return out.sort((a, b) => b.time - a.time || (a.id < b.id ? 1 : -1));
}

// Точки сборки для интерфейса: без отпечатка, зато с тем, что в модах изменилось с тех пор. «Последний удачный запуск» закреплён сверху
function list(instId) {
  instances.get(instId);
  const all = rawList(instId).map(({ sig, modFiles, ...info }) => ({ ...info, diff: diffNow(instId, { modFiles }) }));
  return [...all.filter(isGood), ...all.filter((s) => !isGood(s))];
}

// Лишнее удаляем, но ту точку, к которой сейчас откатываемся (keep), не трогаем. «Последний удачный запуск» не удаляем никогда
function prune(instId, keep = []) {
  const all = rawList(instId).filter((s) => !isGood(s));
  const drop = all.filter((s) => s.auto).slice(MAX_AUTO);
  drop.push(...all.filter((s) => !drop.includes(s)).slice(MAX_ALL));
  for (const s of drop) if (!keep.includes(s.id)) fs.rmSync(dirOf(instId, s.id), { recursive: true, force: true });
}

// reason — что сейчас будет делаться («Перед обновлением модов»); auto: лаунчер сделал сам, а не человек.
// Если с прошлой точки ничего не изменилось, новую не плодим (force отключает эту проверку). «Последний удачный запуск» за
// «прошлую точку» не считается: его со временем заменят, а точка «перед обновлением» должна остаться
function create(instId, reason, { auto = true, force = false, keep = [] } = {}) {
  const inst = instances.get(instId);
  const sig = fingerprint(instId, inst);
  if (!force) {
    const last = rawList(instId).find((s) => !isGood(s));
    if (last?.sig === sig) {
      const { sig: _s, modFiles, ...info } = last;
      return { ...info, diff: diffNow(instId, { modFiles }), reused: true };
    }
  }
  return build(instId, inst, sig, reason, { auto, keep });
}

// Собирает точку во временной папке и ставит её на место. kind: 'good' — «Последний удачный запуск»
function build(instId, inst, sig, reason, { auto, keep = [], kind }) {
  const g = instances.gameDir(instId);
  const id = stamp();
  const dir = dirOf(instId, id);
  const tmp = dir + '.part';
  fs.rmSync(tmp, { recursive: true, force: true });
  try {
    const m = copyTree(path.join(g, 'mods'), path.join(tmp, 'mods'), true);
    const c = copyTree(path.join(g, 'config'), path.join(tmp, 'config'), false);
    for (const name of ['resourcepacks', 'shaderpacks']) copyTree(path.join(g, name), path.join(tmp, name), false);
    for (const f of META_FILES) {
      const src = path.join(instances.dirOf(instId), f);
      if (fs.existsSync(src)) {
        fs.mkdirSync(path.join(tmp, 'meta'), { recursive: true });
        fs.copyFileSync(src, path.join(tmp, 'meta', f));
      }
    }
    const modFiles = Object.fromEntries(Object.entries(listTree(path.join(tmp, 'mods'))).map(([k, v]) => [k, v[0]]));
    lastTime = Math.max(Date.now(), lastTime + 1); // время строго растёт: так «новая» и «старая» точки не путаются
    const info = { id, time: lastTime, reason: String(reason || 'Точка восстановления').slice(0, 80), auto: !!auto, ...(kind ? { kind } : {}), extraPacks: true, sig, mods: m.files, modsBytes: m.bytes, configFiles: c.files, configBytes: c.bytes, modFiles, instance: pick(inst) };
    fsx.writeJsonAtomic(path.join(tmp, 'snapshot.json'), info, false);
    fs.renameSync(tmp, dir);
    prune(instId, keep);
    const { sig: _s, modFiles: _m, ...rest } = info;
    return { ...rest, diff: { added: 0, removed: 0, changed: 0 } };
  } catch (e) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw e;
  }
}

// «Последний удачный запуск»: особая точка, одна на сборку. Её делают после нормального выхода из игры (решает core/game.js).
// Состояние то же, что в прошлой удачной точке, — меняется только время, иначе собирается новая, и лишь после этого прежняя
// удаляется, так что сбой записи удачную точку не теряет
function markGood(instId) {
  const inst = instances.get(instId);
  const sig = fingerprint(instId, inst);
  const old = rawList(instId).filter(isGood);
  let made;
  if (old[0]?.sig === sig) {
    const { sig: _s, modFiles, ...info } = old[0];
    const time = Math.max(Date.now(), old[0].time + 1);
    lastTime = Math.max(lastTime, time);
    fsx.writeJsonAtomic(path.join(dirOf(instId, old[0].id), 'snapshot.json'), { ...old[0], time }, false);
    made = { ...info, time, diff: diffNow(instId, { modFiles }), refreshed: true };
    old.shift();
  } else {
    made = build(instId, inst, sig, GOOD_REASON, { auto: false, kind: 'good' });
  }
  for (const o of old) fs.rmSync(dirOf(instId, o.id), { recursive: true, force: true });
  return made;
}

// Как мод видит игра: включённые файлы (имя без .disabled → размер) и выключенные. Файл, который был и остался выключенным,
// игру не меняет, поэтому в сравнение не попадает
function modState(files) {
  const on = new Map();
  const off = new Set();
  for (const [k, size] of Object.entries(files)) {
    if (!isJar(k)) continue;
    if (/\.disabled$/i.test(k)) off.add(k.replace(/\.disabled$/i, ''));
    else on.set(k, size);
  }
  return { on, off };
}

const packLabel = (p) => (p ? String(p.version ?? p.projectId ?? p.source ?? '?') : null);

// По алфавиту без учёта регистра, а порядок выдачи файловой системы не важен: человек читает список, а не папку
const byName = (a, b) => {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? -1 : x > y ? 1 : a < b ? -1 : a > b ? 1 : 0;
};

// Что изменилось с последнего удачного запуска: имена модов (добавлены / включены / изменены / убраны / выключены) и смена версии игры,
// загрузчика, его версии и модпака. null — удачной точки ещё нет. config в сравнение не входит: игра переписывает его сама
function sinceGood(instId) {
  const inst = instances.get(instId);
  const good = rawList(instId).find(isGood);
  if (!good) return null;
  const was = modState(good.modFiles || {});
  const now = modState(Object.fromEntries(Object.entries(listTree(path.join(instances.gameDir(instId), 'mods'))).map(([k, v]) => [k, v[0]])));
  const mods = { added: [], enabled: [], changed: [], removed: [], disabled: [] };
  for (const [k, size] of now.on) {
    if (!was.on.has(k)) (was.off.has(k) ? mods.enabled : mods.added).push(k);
    else if (was.on.get(k) !== size) mods.changed.push(k);
  }
  for (const k of was.on.keys()) if (!now.on.has(k)) (now.off.has(k) ? mods.disabled : mods.removed).push(k);
  for (const names of Object.values(mods)) names.sort(byName);
  const instance = {};
  const cur = pick(inst);
  for (const f of FIELDS) {
    const from = good.instance?.[f] ?? null;
    if (JSON.stringify(from) === JSON.stringify(cur[f])) continue;
    instance[f] = f === 'pack' ? { from: packLabel(from), to: packLabel(cur[f]) } : { from, to: cur[f] };
  }
  const any = Object.values(mods).some((names) => names.length > 0) || Object.keys(instance).length > 0;
  return { id: good.id, time: good.time, any, mods, instance };
}

function clearDir(dir) {
  for (const n of fs.readdirSync(dir)) fs.rmSync(path.join(dir, n), { recursive: true, force: true });
}

// Подменяет папку целиком: собираем новую рядом и меняем местами, так что при сбое остаётся прежняя
function swapDir(from, to, link) {
  const tmp = `${to}.restore`;
  const old = `${to}.old`;
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(old, { recursive: true, force: true });
  let isLink = false;
  try {
    isLink = fs.lstatSync(to).isSymbolicLink();
  } catch {}
  if (isLink) {
    // Папка подключена «на месте» из другого лаунчера: саму ссылку не трогаем, меняем содержимое
    clearDir(to);
    copyTree(from, to, link);
    return;
  }
  if (fs.existsSync(from)) copyTree(from, tmp, link);
  else fs.mkdirSync(tmp, { recursive: true });
  const had = fs.existsSync(to);
  try {
    if (had) fsx.renameRetry(to, old);
    fsx.renameRetry(tmp, to);
  } catch (e) {
    try {
      if (had && !fs.existsSync(to)) fs.renameSync(old, to);
    } catch {}
    fs.rmSync(tmp, { recursive: true, force: true });
    throw new Error(`Не получилось подменить папку ${path.basename(to)}: ${e.message}`);
  }
  try {
    fs.rmSync(old, { recursive: true, force: true });
  } catch {}
}

// Возвращает сборку к точке. Перед этим сохраняет нынешнее состояние, так что и откат можно отменить
function restore(instId, snapId) {
  const info = read(instId, snapId);
  const dir = dirOf(instId, snapId);
  const g = instances.gameDir(instId);
  const before = create(instId, 'Перед откатом', { auto: true, force: true, keep: [snapId] });
  swapDir(path.join(dir, 'mods'), path.join(g, 'mods'), true);
  swapDir(path.join(dir, 'config'), path.join(g, 'config'), false);
  // Legacy snapshots never covered these directories: do not erase them when
  // restoring an old point that did not record their presence or absence.
  if (info.extraPacks) for (const name of ['resourcepacks', 'shaderpacks']) swapDir(path.join(dir, name), path.join(g, name), false);
  for (const f of META_FILES) {
    const src = path.join(dir, 'meta', f);
    const dst = path.join(instances.dirOf(instId), f);
    if (fs.existsSync(src)) fsx.writeFileAtomic(dst, fs.readFileSync(src));
    else fs.rmSync(dst, { force: true });
  }
  instances.touch(instId, info.instance);
  return { restored: info, before };
}

function remove(instId, snapId) {
  instances.get(instId);
  checkId(snapId);
  fs.rmSync(dirOf(instId, snapId), { recursive: true, force: true });
}

// Сборку удалили — её точки больше не нужны
function removeAll(instId) {
  if (/^[\w-]+$/.test(instId)) fs.rmSync(rootOf(instId), { recursive: true, force: true });
}

module.exports = { create, list, restore, remove, removeAll, markGood, sinceGood, modsSig, MAX_AUTO, MAX_ALL };
