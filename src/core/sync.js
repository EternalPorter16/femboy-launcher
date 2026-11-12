// Синхронизация сборок через папку облака (Яндекс.Диск, OneDrive, Google Drive…): лаунчер держит в ней копию
// каждой сборки, а программа облака переносит её на другие компьютеры. Аккаунты и настройки лаунчера в облако не попадают.
//
// Протокол (версия 2). Облако не умеет транзакций, поэтому порядок записи такой, чтобы любой обрыв можно было дожать:
//  - В облачной папке сборки лежит манифест `.femboy-sync.json`: поколение `gen`, список файлов {размер, время, sha1}
//    и журнал удалений `deleted` {путь → что именно удалили}. Манифест пишется атомарно (tmp + rename).
//  - Перед первым изменением облака пишется манифест с пометкой `pending` (кто отдаёт), после всех файлов — окончательный
//    манифест без пометки. Другой компьютер при `pending` не трогает сборку («облако ещё обновляется»); тот, кто отдавал,
//    при следующем запуске просто доводит дело до конца (он узнаёт себя по идентификатору устройства).
//  - Без `pending` файлы облака обязаны совпасть с манифестом (клиент облака мог не докачать). Иначе остановка ДО любых
//    изменений, `syncedAt` не обновляется. Тайм-аута нет: пока целостность облака не подтверждена, сборка не трогается
//    (безопасный выход — только явное действие publishLocal: «отдать моё состояние в облако»).
//  - Локальная база `sync-base.json` (последнее согласованное состояние) пишется атомарно. Нечитаемая или отсутствующая база
//    не считается пустой «с отключённой защитой»: без базы ничего не удаляется без доказательства (совпадение с записью
//    журнала по sha1), а расхождение файлов — это конфликт, а не победа более свежего.
//  - Изменённость файла: размер/время, а при совпадении размера и близком (до 2 с) времени — по sha1 (считаем только тогда).
//    Файл, совпадающий с облачным по sha1, не изменение и не конфликт.
//  - Единица синхронизации мира — папка мира (`saves/<имя>`), остального — файл. Если единицу менял кто-то один, переносится
//    она целиком. Если с обеих сторон — конфликт: местная версия остаётся, облачная сохраняется рядом
//    (`<мир> (конфликт ДД.ММ ЧЧ-ММ)` / `<файл>.sync-conflict-<время>`), человеку приходит сообщение.
//  - Удаления: удалённый здесь файл удаляется в облаке и попадает в журнал; на другом ПК он перемещается в
//    `backups/.sync-removed/<время>/…`, а не стирается. «Удалён там, изменён здесь» — не удаление: правка остаётся.
//  - Приём: файлы сначала копируются в `backups/.sync-stage`, потом быстрыми rename встают на место по записанному плану;
//    прерванный план доводится при следующем запуске.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('./store');
const instances = require('./instances');
const trash = require('./trash');
const fsx = require('./fsx');

const ROOT_NAME = 'Femboy Launcher Sync';
const BASE = 'sync-base.json';
const WAIT = 'sync-wait.json';
const MANIFEST = '.femboy-sync.json';
const TMP_SUFFIX = '.femboy-sync.tmp';
// Не синхронизируем: логи, отчёты о вылетах, кэши, копии миров и замки. Папки пропускаем только в корне сборки и в её
// .minecraft: мир с именем «backups» или «debug» внутри saves — обычный мир
const SKIP_DIRS = new Set(['logs', 'crash-reports', 'backups', '.pack-update', '.cache', 'natives', '.fabric', '.mixin.out', 'debug']);
const TOP_DIRS = new Set(['', '.minecraft']);
const SKIP_FILES = new Set(['session.lock', 'usercache.json', 'usernamecache.json']);
const ROOT_SKIP_FILES = new Set([BASE, WAIT, MANIFEST]);
const TOLERANCE = 2000; // облака округляют время изменения файла
const EXACT = 2; // «то же время»: копия сохраняет время файла с точностью до миллисекунды
const HASH_CAP = 64 * 1024 * 1024; // sha1 считаем только у файлов не больше этого размера
const JOURNAL_KEEP = 180 * 24 * 3600 * 1000;

const cloudRoot = () => {
  const dir = store.get().settings.syncDir;
  return dir ? path.join(dir, ROOT_NAME) : null;
};
const cloudOf = (id) => path.join(cloudRoot(), 'instances', id);
const tombstone = (id) => path.join(cloudRoot(), 'deleted', id);
const at = (root, rel) => path.join(root, ...rel.split('/'));
const pad = (n) => String(n).padStart(2, '0');
const sha1Of = (e) => (e && e.sha1) || undefined;

const BUSY_OTHER = 'Облако ещё обновляется: другой компьютер не закончил отдачу этой сборки. Ничего не изменено; подожди, пока программа облака закончит, и повтори. Если не проходит, запусти синхронизацию на том компьютере.';
const BUSY_FILES = 'Облако ещё обновляется: файлы в облаке не совпадают с его описанием (программа облака не докачала их или другой компьютер не закончил). Ничего не изменено; подожди, пока программа облака закончит, и повтори.';
const busyError = (msg) => Object.assign(new Error(msg), { code: 'CLOUD_BUSY' });

// Файлы папки: rel → { size, mtime }. Ссылки на папки других лаунчеров (перенос «на месте») пропускаем
function scanTree(root, allowMissingRoot = false) {
  const out = {};
  const walk = (dir, rel) => {
    let list;
    try {
      list = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      if (allowMissingRoot && dir === root && e.code === 'ENOENT') return;
      throw new Error('Не удалось прочитать все файлы синхронизации. Данные не удалены; проверь доступ к папкам.', { cause: e });
    }
    for (const e of list) {
      if (e.isSymbolicLink()) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!(TOP_DIRS.has(rel) && SKIP_DIRS.has(e.name))) walk(path.join(dir, e.name), r);
      } else if (e.isFile() && !SKIP_FILES.has(e.name) && !(rel === '' && ROOT_SKIP_FILES.has(e.name)) && !e.name.endsWith('.log') && !e.name.endsWith('.tmp')) {
        try {
          const st = fs.statSync(path.join(dir, e.name));
          out[r] = { size: st.size, mtime: Math.round(st.mtimeMs) };
        } catch (e) {
          throw new Error('Не удалось прочитать все файлы синхронизации. Данные не удалены; проверь доступ к папкам.', { cause: e });
        }
      }
    }
  };
  walk(root, '');
  return out;
}

// Хвосты прерванного копирования (*.femboy-sync.tmp) убираем при каждом проходе
function sweepTmp(root) {
  const walk = (dir, rel) => {
    let list;
    try {
      list = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of list) {
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        if (!(TOP_DIRS.has(rel) && SKIP_DIRS.has(e.name))) walk(path.join(dir, e.name), rel ? `${rel}/${e.name}` : e.name);
      } else if (e.name.endsWith(TMP_SUFFIX)) fs.rmSync(path.join(dir, e.name), { force: true });
    }
  };
  walk(root, '');
}

function sha1File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha1');
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('error', reject).on('end', () => resolve(h.digest('hex')));
  });
}

// Копируем без блокировки окна (миры бывают большими). Возвращает sha1 копии (или null у больших файлов).
// Файл, изменившийся во время копирования, в облако/из облака не попадает: копия могла получиться «рваной»
async function copy(from, to, hash = true) {
  await fs.promises.mkdir(path.dirname(to), { recursive: true });
  const tmp = to + TMP_SUFFIX;
  try {
    const before = await fs.promises.stat(from);
    await fs.promises.copyFile(from, tmp);
    const after = await fs.promises.stat(from);
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw new Error(`Файл «${path.basename(from)}» изменился во время копирования. Повтори синхронизацию.`);
    await fs.promises.utimes(tmp, before.atime, before.mtime); // одинаковое время с обеих сторон — так видно, что файл не менялся
    const sha1 = hash && before.size <= HASH_CAP ? await sha1File(tmp) : null;
    await fs.promises.rename(tmp, to);
    return sha1;
  } catch (e) {
    await fs.promises.rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
}

// Пустые папки за собой тоже убираем
function pruneEmpty(file, root) {
  for (let d = path.dirname(file); d.startsWith(root + path.sep) && d !== root; d = path.dirname(d)) {
    try {
      if (fs.readdirSync(d).length) break;
      fs.rmdirSync(d);
    } catch {
      break;
    }
  }
}

function moveFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try {
    fsx.renameRetry(from, to);
  } catch (e) {
    if (e.code !== 'EXDEV') throw e;
    fs.copyFileSync(from, to);
    fs.rmSync(from, { force: true });
  }
}

// Локальное удаление по журналу облака: файл уходит в backups/.sync-removed, а не стирается
function removeLocal(local, rel, stamp) {
  const file = at(local, rel);
  if (!fs.existsSync(file)) return;
  moveFile(file, path.join(local, 'backups', '.sync-removed', stamp, ...rel.split('/')));
  pruneEmpty(file, local);
}

// ---- приём через промежуточную папку ----
const stageDir = (local) => path.join(local, 'backups', '.sync-stage');
function applyStage(local, plan, stamp) {
  const stage = stageDir(local);
  for (const rel of plan.files || []) {
    const s = path.join(stage, 'files', ...rel.split('/'));
    if (fs.existsSync(s)) moveFile(s, at(local, rel));
  }
  for (const rel of plan.removals || []) removeLocal(local, rel, stamp);
  fs.rmSync(stage, { recursive: true, force: true });
}
// Прерванный приём: если план записан — доводим, если нет — недокачанное выбрасываем (облако отдаст заново)
function recoverStage(local, stamp) {
  const stage = stageDir(local);
  if (!fs.existsSync(stage)) return;
  const plan = fsx.readJson(path.join(stage, 'plan.json'));
  if (plan.ok && plan.data && Array.isArray(plan.data.files)) applyStage(local, plan.data, stamp);
  else fs.rmSync(stage, { recursive: true, force: true });
}

// ---- локальная база и манифест ----
function readBase(file) {
  const r = fsx.readJson(file);
  if (!r.exists) return { state: 'missing', files: {}, gen: 0 };
  if (!r.ok || !r.data || typeof r.data.files !== 'object' || !r.data.files || Array.isArray(r.data.files)) return { state: 'corrupt', files: {}, gen: 0 };
  return { state: 'ok', files: r.data.files, gen: r.data.gen || 0 };
}
function readManifest(cloud) {
  const r = fsx.readJson(path.join(cloud, MANIFEST));
  if (!r.exists) return { state: 'missing' };
  if (!r.ok || !r.data || typeof r.data.files !== 'object' || !r.data.files) return { state: 'corrupt' };
  return { state: 'ok', m: { ...r.data, deleted: r.data.deleted && typeof r.data.deleted === 'object' ? r.data.deleted : {} } };
}
function deviceId() {
  const d = store.get();
  if (!d.syncDevice) {
    d.syncDevice = crypto.randomUUID();
    store.save();
  }
  return d.syncDevice;
}

const worldPrefix = (rel) => /^((?:\.minecraft\/)?saves\/[^/]+)\//.exec(rel)?.[1] || null;
const unitKey = (rel) => worldPrefix(rel) || rel;
const stampOf = (d = new Date()) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
const shortStamp = (d = new Date()) => `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${pad(d.getHours())}-${pad(d.getMinutes())}`;

// Одна сборка: local — папка сборки у нас, cloud — её копия в облаке
async function syncOne(id, { genFloor = 0 } = {}) {
  const root = cloudRoot();
  if (!root) return null;
  if (fs.existsSync(tombstone(id))) return null; // сборку удалили на одном из компьютеров
  if (trash.has(id)) return null; // сборка в корзине: пока её можно вернуть, облако её не воскрешает и не трогает
  const local = instances.dirOf(id);
  if (fs.existsSync(path.join(local, '.pack-update'))) throw new Error('Сначала заверши или восстанови обновление модпака');
  const cloud = cloudOf(id);
  const baseFile = path.join(local, BASE);
  const now = Date.now();
  const stamp = stampOf(new Date(now));
  const myDev = deviceId();
  const stat = { up: 0, down: 0, removed: 0, conflicts: [], warnings: [] };

  recoverStage(local, stamp);
  sweepTmp(local);

  const baseInfo = readBase(baseFile);
  if (baseInfo.state === 'corrupt') stat.warnings.push('Список синхронизации на этом компьютере повреждён. Ничего не удалено и не перезаписано: расхождения сохранены как конфликты.');
  let reliable = baseInfo.state === 'ok';
  let bF = baseInfo.files;
  // Read both complete inventories before changing anything. An unreadable
  // subtree must not be mistaken for files deleted on the other computer.
  const L = scanTree(local, true);
  const C = scanTree(cloud, true);
  let cloudExists = true;
  try {
    fs.statSync(cloud);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    cloudExists = false;
  }
  if (!cloudExists) bF = {}; // облачной копии нет вовсе — отдаём всё
  // Обрезанный (нулевой длины) instance.json в облако не отдаём: считаем, что его у нас нет, и берём целый из облака
  if (L['instance.json'] && L['instance.json'].size === 0) {
    delete L['instance.json'];
    bF = { ...bF };
    delete bF['instance.json'];
  }

  // ---- облако в согласованном состоянии? ----
  const mInfo = cloudExists ? readManifest(cloud) : { state: 'missing' };
  let M = mInfo.state === 'ok' ? mInfo.m : null;
  const hasCloudFiles = Object.keys(C).length > 0;
  const hashMemo = new Map();
  const hashOf = (side, root0, rel, e) => {
    if (!e || e.size > HASH_CAP) return Promise.resolve(null);
    const k = `${side}:${rel}`;
    if (!hashMemo.has(k)) hashMemo.set(k, sha1File(at(root0, rel)).catch(() => null));
    return hashMemo.get(k);
  };
  const problems = [];
  if (cloudExists) {
    if (mInfo.state === 'corrupt') problems.push('манифест облака не читается');
    else if (M) {
      if (M.pending && M.pending.dev !== myDev) problems.push('pending');
      else if (!M.pending) {
        if ((M.gen || 0) < baseInfo.gen) problems.push('облако старее последней синхронизации');
        for (const [rel, e] of Object.entries(M.files)) {
          const c = C[rel];
          if (!c || c.size !== e.size) problems.push(rel);
          else if (e.sha1 && Math.abs(c.mtime - e.mtime) > TOLERANCE) {
            const h = await hashOf('C', cloud, rel, c);
            if (h && h !== e.sha1) problems.push(rel);
          }
        }
        for (const rel of Object.keys(C)) if (!M.files[rel]) problems.push(`+${rel}`);
      }
    } else if (baseInfo.gen > 0) problems.push('манифест облака пропал');
  }
  // Целостность облака не подтверждена (pending, несовпадение с манифестом): ничего не принимаем и не отдаём, сколько бы это ни длилось
  if (problems.length) throw busyError(problems.length === 1 && problems[0] === 'pending' ? BUSY_OTHER : BUSY_FILES);
  if (cloudExists) sweepTmp(cloud);
  const J = { ...(M ? M.deleted : {}) };
  // Облачной копии (манифеста) нет: начинается новая линия облака (первая отдача, пропавшая копия, явный выход publishLocal).
  // Её поколение не должно оказаться ниже базы другого компьютера, иначе тот навсегда увидит «облако старее последней
  // синхронизации»: берём не меньше своей базы, прежнего манифеста (genFloor) и текущего времени в мс (база любого ПК от
  // прежней линии — небольшой счётчик или более раннее время). Это же поколение несёт пометка pending, чтобы прерванная
  // отдача новой линии доводилась без отката.
  const oldGen = M ? M.gen || 0 : Math.max(baseInfo.gen, Number(genFloor) || 0, now);

  // ---- сравнение ----
  const hashL = (rel) => {
    const l = L[rel];
    const b = bF[rel];
    if (b && b.sha1 && l && b.size === l.size && Math.abs(b.mtime - l.mtime) <= EXACT) return Promise.resolve(b.sha1);
    return hashOf('L', local, rel, l);
  };
  const hashC = (rel) => {
    const c = C[rel];
    const e = M && M.files[rel];
    if (e && e.sha1 && c && e.size === c.size && Math.abs(e.mtime - c.mtime) <= EXACT) return Promise.resolve(e.sha1);
    return hashOf('C', cloud, rel, c);
  };
  // изменился ли файл x по сравнению с записью базы b
  const changedVs = async (x, b, hashFn) => {
    if (!b || x.size !== b.size) return true;
    const dt = Math.abs(x.mtime - b.mtime);
    if (dt <= EXACT) return false;
    if (b.sha1) {
      const h = await hashFn();
      if (h) return h !== b.sha1;
    }
    return dt > TOLERANCE;
  };
  const identical = async (rel) => {
    const l = L[rel];
    const c = C[rel];
    if (!l || !c || l.size !== c.size) return false;
    const dt = Math.abs(l.mtime - c.mtime);
    if (dt <= EXACT) return true;
    const [a, b] = await Promise.all([hashL(rel), hashC(rel)]);
    return a && b ? a === b : dt <= TOLERANCE;
  };
  const matchesEntry = async (rel, j) => {
    const l = L[rel];
    if (l.size !== j.size) return false;
    const dt = Math.abs(l.mtime - j.mtime);
    if (dt <= EXACT) return true;
    if (j.sha1) {
      const h = await hashL(rel);
      if (h) return h === j.sha1;
    }
    return dt <= TOLERANCE;
  };
  const classify = async (rel) => {
    const l = L[rel];
    const c = C[rel];
    const b = bF[rel];
    const j = J[rel];
    let lS = l ? (b ? ((await changedVs(l, b, () => hashL(rel))) ? 'mod' : 'same') : 'mod') : b ? 'del' : 'none';
    let cS = c ? (b ? ((await changedVs(c, b, () => hashC(rel))) ? 'mod' : 'same') : 'mod') : b && j ? 'del' : 'none';
    // без надёжной базы удаление по журналу принимаем, только если наш файл — ровно та версия, что удалили
    if (!reliable && l && !c && j && (await matchesEntry(rel, j))) [lS, cS] = ['same', 'del'];
    if (l && c && (await identical(rel))) [lS, cS] = ['same', 'same'];
    return { lS, cS };
  };

  // единицы: мир целиком или отдельный файл
  const units = new Map();
  for (const rel of new Set([...Object.keys(L), ...Object.keys(C), ...Object.keys(bF), ...Object.keys(J)])) {
    const k = unitKey(rel);
    if (!units.has(k)) units.set(k, []);
    units.get(k).push(rel);
  }

  const ops = { up: [], down: [], rmLocal: [], rmCloud: [] };
  const conflictsToSave = [];
  const names = (list) => list.slice(0, 5).join(', ') + (list.length > 5 ? '…' : '');
  for (const [key, rels] of units) {
    const st = {};
    for (const rel of rels) st[rel] = await classify(rel);
    const some = (side, v) => rels.some((r) => st[r][side] === v);
    const lMod = some('lS', 'mod');
    const lDel = some('lS', 'del');
    const cMod = some('cS', 'mod');
    const cDel = some('cS', 'del');
    const isWorld = !!worldPrefix(rels[0]);
    let mode;
    if (lMod && cMod) mode = 'conflict';
    else if (lMod) mode = 'push';
    else if (cMod) mode = 'pull';
    else if (cDel) mode = 'pull';
    else mode = 'push';
    const label = isWorld ? `Мир «${key.split('/').pop()}»` : `Файл «${key}»`;
    if (mode === 'pull' && lDel && cMod && rels.some((r) => !L[r] && C[r])) stat.conflicts.push(`${label}: удалён здесь, но изменён на другом компьютере. Оставлена изменённая версия.`);
    if (mode === 'push' && cDel && lMod) stat.conflicts.push(`${label}: удалён на другом компьютере, но изменён здесь. Оставлена твоя версия.`);
    if (mode === 'conflict') {
      conflictsToSave.push({ key, rels, isWorld, label });
      mode = 'push'; // местная версия остаётся и уходит в облако; облачную сохраним рядом
    }
    for (const rel of rels) {
      const l = L[rel];
      const c = C[rel];
      if (l && c) {
        if (!(await identical(rel))) (mode === 'push' ? ops.up : ops.down).push(rel);
      } else if (l) {
        if (mode === 'pull' && st[rel].cS === 'del') ops.rmLocal.push(rel);
        else ops.up.push(rel); // нет в облаке и нет в журнале удалений: не удаляем, а возвращаем в облако
      } else if (c) {
        if (mode === 'push') ops.rmCloud.push(rel);
        else ops.down.push(rel);
      }
    }
  }

  // ---- конфликты: облачную версию сохраняем рядом, местная остаётся ----
  const saveBeside = async (rel, newRel) => {
    await copy(at(cloud, rel), at(local, newRel), false);
    const st = fs.statSync(at(local, newRel));
    L[newRel] = { size: st.size, mtime: Math.round(st.mtimeMs) };
    ops.up.push(newRel);
  };
  const sameCopy = (rel, candRel) => L[candRel] && L[candRel].size === C[rel].size && Math.abs(L[candRel].mtime - C[rel].mtime) <= EXACT;
  for (const cf of conflictsToSave) {
    const cloudRels = cf.rels.filter((r) => C[r]);
    if (cf.isWorld) {
      const prefix = worldPrefix(cf.rels.find((r) => worldPrefix(r)));
      const cand = [...new Set(Object.keys(L).map((r) => worldPrefix(r)).filter((p) => p && p.startsWith(`${prefix} (конфликт `)))].find((p) => cloudRels.every((r) => sameCopy(r, p + r.slice(prefix.length))));
      let target = cand;
      if (!target) {
        const base0 = `${prefix} (конфликт ${shortStamp(new Date(now))})`;
        target = base0;
        for (let n = 2; Object.keys(L).some((r) => r.startsWith(`${target}/`)); n++) target = `${base0}, ${n}`;
        for (const r of cloudRels) await saveBeside(r, target + r.slice(prefix.length));
      }
      stat.conflicts.push(`Мир «${prefix.split('/').pop()}»: изменён на обоих компьютерах. Здесь оставлена твоя версия, облачная сохранена как мир «${target.split('/').pop()}».`);
    } else {
      const rel = cf.key;
      const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/') + 1) : '';
      const name = rel.slice(dir.length);
      const cand = Object.keys(L).find((r) => r.startsWith(`${dir}${name}.sync-conflict-`) && sameCopy(rel, r));
      let target = cand;
      if (!target && C[rel]) {
        target = `${rel}.sync-conflict-${stamp}`;
        for (let n = 2; L[target]; n++) target = `${rel}.sync-conflict-${stamp}-${n}`;
        await saveBeside(rel, target);
      }
      if (target) stat.conflicts.push(`Файл «${rel}»: изменён на обоих компьютерах. Здесь оставлена твоя версия, облачная сохранена как «${target.slice(dir.length)}».`);
    }
  }
  ops.up = [...new Set(ops.up)];

  // ---- приём: во временную папку ----
  const stage = stageDir(local);
  fs.rmSync(stage, { recursive: true, force: true });
  for (const rel of ops.down) await copy(at(cloud, rel), path.join(stage, 'files', ...rel.split('/')), false);

  // ---- отдача ----
  const known = new Map(); // rel → sha1 содержимого, которое теперь лежит и у нас, и в облаке
  const cloudChanges = ops.up.length + ops.rmCloud.length > 0;
  const manifestBase = () => ({ v: 2, gen: oldGen, at: now, dev: myDev, files: M ? M.files : {}, deleted: J });
  if (cloudChanges) {
    fs.mkdirSync(cloud, { recursive: true });
    fsx.writeJsonAtomic(path.join(cloud, MANIFEST), { ...manifestBase(), pending: { dev: myDev, at: now } }, false);
  }
  const removedNow = {};
  for (const rel of ops.up) {
    const sha1 = await copy(at(local, rel), at(cloud, rel));
    if (sha1) known.set(rel, sha1);
    stat.up++;
  }
  for (const rel of ops.rmCloud) {
    const c = C[rel];
    const e = M && M.files[rel];
    const sha1 = e && e.sha1 && e.size === c.size && Math.abs(e.mtime - c.mtime) <= EXACT ? e.sha1 : await hashC(rel);
    removedNow[rel] = { size: c.size, mtime: c.mtime, ...(sha1 && { sha1 }) };
    fs.rmSync(at(cloud, rel), { force: true });
    pruneEmpty(at(cloud, rel), cloud);
    stat.removed++;
  }

  // ---- применяем принятое ----
  if (ops.down.length || ops.rmLocal.length) {
    fs.mkdirSync(stage, { recursive: true });
    fsx.writeJsonAtomic(path.join(stage, 'plan.json'), { files: ops.down, removals: ops.rmLocal }, false);
    applyStage(local, { files: ops.down, removals: ops.rmLocal }, stamp);
    stat.down += ops.down.length;
    stat.removed += ops.rmLocal.length;
  } else fs.rmSync(stage, { recursive: true, force: true });

  // ---- итог: манифест облака, потом локальная база ----
  fs.mkdirSync(local, { recursive: true });
  const L2 = scanTree(local, true);
  const newBase = {};
  for (const [rel, l] of Object.entries(L2)) {
    const old = bF[rel];
    let sha1 = old && old.sha1 && old.size === l.size && Math.abs(old.mtime - l.mtime) <= EXACT ? old.sha1 : known.get(rel);
    if (!sha1 && l.size <= HASH_CAP) sha1 = await sha1File(at(local, rel)).catch(() => undefined);
    newBase[rel] = { size: l.size, mtime: l.mtime, ...(sha1 && { sha1 }) };
  }
  let newGen = oldGen;
  if (cloudExists || cloudChanges) {
    const C2 = scanTree(cloud, true);
    const files = {};
    for (const [rel, c] of Object.entries(C2)) {
      const e = M && M.files[rel];
      const b = newBase[rel];
      let sha1 = e && e.sha1 && e.size === c.size && Math.abs(e.mtime - c.mtime) <= EXACT ? e.sha1 : undefined;
      if (!sha1 && b && b.size === c.size && Math.abs(b.mtime - c.mtime) <= EXACT) sha1 = sha1Of(b);
      files[rel] = { size: c.size, mtime: c.mtime, ...(sha1 && { sha1 }) };
    }
    newGen = oldGen + (cloudChanges || !M ? 1 : 0);
    const deleted = {};
    for (const [rel, j] of Object.entries({ ...J, ...Object.fromEntries(Object.entries(removedNow).map(([r, e]) => [r, { ...e, gen: newGen, at: now }])) })) {
      if (!files[rel] && now - (j.at || now) < JOURNAL_KEEP) deleted[rel] = j;
    }
    const changed = cloudChanges || !M || M.pending || JSON.stringify(Object.keys(deleted).sort()) !== JSON.stringify(Object.keys(J).sort());
    if (changed) fsx.writeJsonAtomic(path.join(cloud, MANIFEST), { v: 2, gen: newGen, at: now, dev: myDev, files, deleted }, false);
  }
  fsx.writeJsonAtomic(baseFile, { v: 2, at: now, gen: newGen, files: newBase }, false);
  return stat;
}

// Имя сборки для сообщений: у нас, а если её ещё нет — из облачной копии
function nameOf(id) {
  try {
    const n = instances.get(id)?.name;
    if (n) return n;
  } catch {}
  try {
    const n = JSON.parse(fs.readFileSync(path.join(cloudOf(id), 'instance.json'), 'utf8')).name;
    if (n) return n;
  } catch {}
  return id;
}

// Итог последней попытки: syncedAt — только если ошибок не было; syncError — что пошло не так (для окна)
function record(error, idSource) {
  try {
    const d = store.get();
    if (error) {
      d.syncError = error;
      d.syncErrorId = idSource || null;
    } else if (!d.syncErrorId || d.syncErrorId === idSource || idSource === '*') {
      d.syncError = '';
      d.syncErrorId = null;
      d.syncedAt = Date.now();
    }
    store.save();
  } catch {}
}

// Одна сборка (запуск игры, после игры): при ошибке помечаем её для окна
async function syncInstance(id, opts) {
  try {
    const r = await syncOne(id, opts);
    if (r) record(null, id);
    return r;
  } catch (e) {
    record(`${nameOf(id)}: ${e.message}`, id);
    throw e;
  }
}

// Явный выход из «облако ещё обновляется»: облачная копия сборки уходит в «Корзину» папки синхронизации (не стирается),
// а наше состояние отдаётся как новая облачная копия. Только по выбору человека, автоматически не вызывается.
// Всё, из-за чего отдача не состоится, проверяем ДО переноса облачной копии: иначе облако осталось бы без сборки.
async function publishLocal(id) {
  const root = cloudRoot();
  if (!root) throw new Error('Сначала выбери папку облака');
  if (!fs.existsSync(store.get().settings.syncDir)) throw new Error('Папка облака не найдена — проверь, что программа облака установлена');
  instances.get(id); // «Сборка не найдена», если её здесь нет
  if (trash.has(id)) throw new Error('Сборка в корзине: сначала верни её, потом восстанавливай облако');
  if (fs.existsSync(tombstone(id))) throw new Error('Сборка удалена на другом компьютере: восстановить для неё облако нельзя');
  if (fs.existsSync(path.join(instances.dirOf(id), '.pack-update'))) throw new Error('Сначала заверши или восстанови обновление модпака');
  let genFloor = 0;
  if (fs.existsSync(cloudOf(id))) {
    const m = readManifest(cloudOf(id));
    if (m.state === 'ok') genFloor = Number(m.m.gen) || 0; // новая линия облака — выше прежней, даже если часы этого ПК отстают
    const dest = path.join(root, 'Корзина', `${id}-${Date.now()}`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    try {
      fs.renameSync(cloudOf(id), dest);
    } catch (e) {
      // Файл облачной копии открыт другой программой (часто — самой программой облака): ничего не перенесено и не изменено
      if (['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw Object.assign(new Error('Облачная копия сборки сейчас занята другой программой (например, программой облака). Ничего не изменено; подожди немного и повтори.'), { cause: e });
      throw e;
    }
  }
  return syncInstance(id, { genFloor });
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
  const total = { up: 0, down: 0, removed: 0, instances: 0, errors: [], conflicts: [], warnings: [], skipped: [] };
  for (const id of ids) {
    if (isRunning(id)) {
      total.skipped.push(nameOf(id));
      continue;
    }
    try {
      if (fs.existsSync(tombstone(id))) {
        if (fs.existsSync(instances.dirOf(id)) && !trash.has(id)) total.warnings.push(`«${nameOf(id)}»: сборка удалена на другом компьютере, здесь она осталась и больше не синхронизируется.`);
        continue;
      }
      const s = await syncOne(id);
      if (!s) continue;
      total.instances++;
      for (const k of ['up', 'down', 'removed']) total[k] += s[k];
      total.conflicts.push(...s.conflicts.map((c) => `«${nameOf(id)}»: ${c}`));
      total.warnings.push(...s.warnings.map((w) => `«${nameOf(id)}»: ${w}`));
    } catch (e) {
      total.errors.push(`${nameOf(id)}: ${e.message}`);
    }
  }
  record(total.errors.length ? total.errors.join('\n') : null, '*');
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
  const d = store.get();
  return { dir: d.settings.syncDir || '', at: d.syncedAt || null, error: d.syncError || '', errorId: d.syncErrorId || null };
}

// Синхронизации идут строго по очереди — две одновременные могли бы перепутать файлы
let chain = Promise.resolve();
const serial = (fn) => (...args) => (chain = chain.catch(() => {}).then(() => fn(...args)));

module.exports = { syncInstance: serial(syncInstance), syncAll: serial(syncAll), publishLocal: serial(publishLocal), forget, status, ROOT_NAME };
