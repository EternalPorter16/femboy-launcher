// Синхронизация сборок через папку облака (Яндекс.Диск, OneDrive, Google Drive…): лаунчер держит в ней копию
// каждой сборки, а программа облака переносит её на другие компьютеры. Синхронизируем по файлам:
// что поменялось у нас — отдаём в облако, что поменялось в облаке — забираем; удаления тоже переносим,
// но только для файлов, которые уже были синхронизированы (снимок прошлой синхронизации — sync-base.json).
// Аккаунты и настройки лаунчера в облако не попадают.
const fs = require('fs');
const path = require('path');
const store = require('./store');
const instances = require('./instances');
const trash = require('./trash');

const ROOT_NAME = 'Femboy Launcher Sync';
const BASE = 'sync-base.json';
// Не синхронизируем: логи, отчёты о вылетах, кэши, копии миров и замки
const SKIP_DIRS = new Set(['logs', 'crash-reports', 'backups', '.cache', 'natives', '.fabric', '.mixin.out', 'debug']);
const SKIP_FILES = new Set([BASE, 'session.lock', 'usercache.json', 'usernamecache.json']);
const TOLERANCE = 2000; // облака округляют время изменения файла

const cloudRoot = () => {
  const dir = store.get().settings.syncDir;
  return dir ? path.join(dir, ROOT_NAME) : null;
};
const cloudOf = (id) => path.join(cloudRoot(), 'instances', id);
const tombstone = (id) => path.join(cloudRoot(), 'deleted', id);

// Файлы папки: rel → { size, mtime }. Ссылки на папки других лаунчеров (перенос «на месте») пропускаем
function scanTree(root) {
  const out = {};
  const walk = (dir, rel) => {
    let list;
    try {
      list = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of list) {
      if (e.isSymbolicLink()) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name), r);
      } else if (e.isFile() && !SKIP_FILES.has(e.name) && !e.name.endsWith('.log') && !e.name.endsWith('.tmp')) {
        try {
          const st = fs.statSync(path.join(dir, e.name));
          out[r] = { size: st.size, mtime: Math.round(st.mtimeMs) };
        } catch {}
      }
    }
  };
  walk(root, '');
  return out;
}

const same = (a, b) => a && b && a.size === b.size && Math.abs(a.mtime - b.mtime) <= TOLERANCE;

// Копируем без блокировки окна (миры бывают большими)
async function copy(from, to) {
  await fs.promises.mkdir(path.dirname(to), { recursive: true });
  const tmp = to + '.femboy-sync.tmp';
  await fs.promises.copyFile(from, tmp);
  const st = await fs.promises.stat(from);
  await fs.promises.utimes(tmp, st.atime, st.mtime); // одинаковое время с обеих сторон — так видно, что файл не менялся
  await fs.promises.rename(tmp, to);
}

function removeFile(file, root) {
  fs.rmSync(file, { force: true });
  // пустые папки за собой тоже убираем
  for (let d = path.dirname(file); d.startsWith(root + path.sep) && d !== root; d = path.dirname(d)) {
    try {
      if (fs.readdirSync(d).length) break;
      fs.rmdirSync(d);
    } catch {
      break;
    }
  }
}

// Одна сборка: local — папка сборки у нас, cloud — её копия в облаке
async function syncInstance(id) {
  const root = cloudRoot();
  if (!root) return null;
  if (fs.existsSync(tombstone(id))) return null; // сборку удалили на одном из компьютеров
  if (trash.has(id)) return null; // сборка в корзине: пока её можно вернуть, облако её не воскрешает и не трогает
  const local = instances.dirOf(id);
  const cloud = cloudOf(id);
  const baseFile = path.join(local, BASE);
  let base = {};
  try {
    base = JSON.parse(fs.readFileSync(baseFile, 'utf8')).files || {};
  } catch {}
  // Облачной копии нет вовсе (первый раз или её убрали) — просто отдаём всё, ничего не удаляя
  if (!fs.existsSync(cloud)) base = {};
  const L = scanTree(local);
  const C = scanTree(cloud);
  const stat = { up: 0, down: 0, removed: 0 };
  for (const rel of new Set([...Object.keys(L), ...Object.keys(C)])) {
    const l = L[rel];
    const c = C[rel];
    const b = base[rel];
    const lp = path.join(local, ...rel.split('/'));
    const cp = path.join(cloud, ...rel.split('/'));
    if (l && c) {
      if (same(l, c)) continue;
      const lChanged = !same(l, b);
      const cChanged = !same(c, b);
      // Поменялось с одной стороны — берём оттуда; с обеих — побеждает более свежий файл
      if ((lChanged && !cChanged) || (lChanged && cChanged && l.mtime >= c.mtime)) (await copy(lp, cp), stat.up++);
      else (await copy(cp, lp), stat.down++);
    } else if (l) {
      if (b && same(l, b)) (removeFile(lp, local), stat.removed++); // удалили на другом компьютере
      else (await copy(lp, cp), stat.up++);
    } else if (c) {
      if (b && same(c, b)) (removeFile(cp, cloud), stat.removed++); // удалили у нас
      else (await copy(cp, lp), stat.down++);
    }
  }
  fs.mkdirSync(local, { recursive: true });
  fs.writeFileSync(baseFile, JSON.stringify({ at: Date.now(), files: scanTree(local) }));
  return stat;
}

// Все сборки: свои отдаём, новые из облака (созданные на другом компьютере) забираем
async function syncAll(isRunning = () => false) {
  const root = cloudRoot();
  if (!root) throw new Error('Сначала выбери папку облака');
  if (!fs.existsSync(store.get().settings.syncDir)) throw new Error('Папка облака не найдена — проверь, что программа облака установлена');
  fs.mkdirSync(path.join(root, 'instances'), { recursive: true });
  const ids = new Set(instances.list().map((i) => i.id));
  for (const d of fs.readdirSync(path.join(root, 'instances'))) {
    if (/^[\w-]+$/.test(d) && fs.existsSync(path.join(root, 'instances', d, 'instance.json'))) ids.add(d);
  }
  const total = { up: 0, down: 0, removed: 0, instances: 0, errors: [] };
  for (const id of ids) {
    if (isRunning(id)) continue;
    try {
      const s = await syncInstance(id);
      if (!s) continue;
      total.instances++;
      for (const k of ['up', 'down', 'removed']) total[k] += s[k];
    } catch (e) {
      total.errors.push(`${id}: ${e.message}`);
    }
  }
  store.get().syncedAt = Date.now();
  store.save();
  return total;
}

// Сборку удалили у нас: облачную копию убираем в «Корзину» папки синхронизации, другие компьютеры её не вернут
function forget(id) {
  const root = cloudRoot();
  if (!root || !fs.existsSync(cloudOf(id))) return;
  fs.mkdirSync(path.join(root, 'deleted'), { recursive: true });
  fs.writeFileSync(tombstone(id), String(Date.now()));
  const trash = path.join(root, 'Корзина', `${id}-${Date.now()}`);
  fs.mkdirSync(path.dirname(trash), { recursive: true });
  fs.renameSync(cloudOf(id), trash);
}

function status() {
  return { dir: store.get().settings.syncDir || '', at: store.get().syncedAt || null };
}

// Синхронизации идут строго по очереди — две одновременные могли бы перепутать файлы
let chain = Promise.resolve();
const serial = (fn) => (...args) => (chain = chain.catch(() => {}).then(() => fn(...args)));

module.exports = { syncInstance: serial(syncInstance), syncAll: serial(syncAll), forget, status, ROOT_NAME };
