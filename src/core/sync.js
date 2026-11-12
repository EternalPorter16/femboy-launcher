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
//
// Отдельная папка протокола 2 (`Femboy Launcher Sync/v2`). Лаунчер 0.10.2 и раньше синхронизирует `Femboy Launcher Sync/instances`
// по своим правилам и из всей папки облака проверяет только существование файла `deleted/<id>`: есть — сборку целиком пропускает.
// Защитить прежнюю папку одной таким файлом нельзя: старый клиент, уже начавший проход, доделывает его, а программа облака
// приносит файлы в любом порядке. Поэтому протокол 2 живёт отдельно и данных прежней папки не берёт вовсе.
//  - Линии. Облачная копия сборки — папка `v2/lines/<id>.<устройство>.<время>` («линия»); какая из них текущая, говорит
//    указатель `v2/instances/<id>/line.json`. Новая линия (первая отдача, перевод, «Восстановить облако») целиком
//    заливается и проверяется, и только потом пишется указатель. Две одновременные новые линии не смешивают файлы:
//    каждая в своей папке, а указатель выбирает одну.
//  - База доверяется целиком только для той линии, с которой она записана. Для другой линии (и для базы прежней папки)
//    верны лишь записи, совпавшие со снимком-основанием линии (`.femboy-origin.json` — что было залито при её создании);
//    остальное без базы: расхождение — конфликт с копией рядом, а не перезапись.
//  - Перевод из прежней папки (только кнопкой). Источник — закрытое локальное состояние этого компьютера, а не снимок
//    прежнего облака. До любых изменений прежняя копия сверяется с базой и файлами этого компьютера: есть изменения
//    другого компьютера, которых здесь нет, — перевод останавливается (без них — только отдельным подтверждением).
//    Затем ограда `deleted/<id>` = {"fence":"v2"} (0.10.2 перестаёт трогать сборку), новая линия из локальных файлов,
//    проверка, что ни локальные файлы, ни прежняя копия не менялись, и указатель. Прежняя копия не меняется.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('./store');
const instances = require('./instances');
const trash = require('./trash');
const fsx = require('./fsx');

const ROOT_NAME = 'Femboy Launcher Sync';
const SPACE = 'v2';
const BASE = 'sync-base.json';
const WAIT = 'sync-wait.json';
const MANIFEST = '.femboy-sync.json';
const ORIGIN = '.femboy-origin.json';
const POINTER = 'line.json';
const TMP_SUFFIX = '.femboy-sync.tmp';
// Не синхронизируем: логи, отчёты о вылетах, кэши, копии миров и замки. Папки пропускаем только в корне сборки и в её
// .minecraft: мир с именем «backups» или «debug» внутри saves — обычный мир
const SKIP_DIRS = new Set(['logs', 'crash-reports', 'backups', '.pack-update', '.cache', 'natives', '.fabric', '.mixin.out', 'debug']);
const TOP_DIRS = new Set(['', '.minecraft']);
const SKIP_FILES = new Set(['session.lock', 'usercache.json', 'usernamecache.json']);
const ROOT_SKIP_FILES = new Set([BASE, WAIT, MANIFEST, ORIGIN]);
const TOLERANCE = 2000; // облака округляют время изменения файла
const EXACT = 2; // «то же время»: копия сохраняет время файла с точностью до миллисекунды
const HASH_CAP = 64 * 1024 * 1024; // sha1 считаем только у файлов не больше этого размера
const JOURNAL_KEEP = 180 * 24 * 3600 * 1000;

const legacyRoot = () => {
  const dir = store.get().settings.syncDir;
  return dir ? path.join(dir, ROOT_NAME) : null;
};
const cloudRoot = () => {
  const root = legacyRoot();
  return root ? path.join(root, SPACE) : null;
};
const pointerOf = (id) => path.join(cloudRoot(), 'instances', id, POINTER);
const lineDir = (line) => path.join(cloudRoot(), 'lines', line);
const tombstone = (id) => path.join(cloudRoot(), 'deleted', id);
const legacyOf = (id) => path.join(legacyRoot(), 'instances', id);
const fenceOf = (id) => path.join(legacyRoot(), 'deleted', id);
const at = (root, rel) => path.join(root, ...rel.split('/'));
const pad = (n) => String(n).padStart(2, '0');
const sha1Of = (e) => (e && e.sha1) || undefined;

const BUSY_OTHER = 'Облако ещё обновляется: другой компьютер не закончил отдачу этой сборки. Ничего не изменено; подожди, пока программа облака закончит, и повтори. Если не проходит, запусти синхронизацию на том компьютере.';
const BUSY_FILES = 'Облако ещё обновляется: файлы в облаке не совпадают с его описанием (программа облака не докачала их или другой компьютер не закончил). Ничего не изменено; подожди, пока программа облака закончит, и повтори.';
const BUSY_LEGACY = 'Прежняя копия сборки в облаке менялась во время перевода (на другом компьютере ещё работает старый лаунчер или программа облака не докачала файлы). Перевод не закончен, ничего не потеряно; закрой лаунчер на других компьютерах, подожди, пока программа облака закончит, и повтори.';
const BUSY_LOCAL = 'Файлы сборки на этом компьютере менялись во время отдачи в облако (например, шла игра). Облако не изменено, ничего не потеряно; закрой игру и повтори.';
const LEGACY = 'Облако ещё в старом формате (лаунчер 0.10.2 и раньше), синхронизация приостановлена. Ничего не изменено; нажми «Перевести облако на новый формат…» в настройках синхронизации.';
const ONLY_LEGACY = 'Сборка есть только в прежней папке облака. Перевести её может компьютер, на котором она есть, после обновления лаунчера там. Ничего не изменено.';
const MERGED = 'Эту сборку уже перевёл или восстановил другой компьютер: облачная копия взята оттуда, отличия этого компьютера сохранены рядом как конфликтные копии.';
const busyError = (msg) => Object.assign(new Error(msg), { code: 'CLOUD_BUSY' });
const legacyError = () => Object.assign(new Error(LEGACY), { code: 'CLOUD_LEGACY' });
// Перевод остановлен: в прежней папке есть изменения другого компьютера, которых нет здесь (units — миры и файлы)
const aheadError = (units) => {
  const what = units.slice(0, 6).map((k) => (/^(?:\.minecraft\/)?saves\/[^/]+$/.test(k) ? `мир «${k.split('/').pop()}»` : `файл «${k}»`)).join(', ') + (units.length > 6 ? ' и другие' : '');
  return Object.assign(new Error(`в прежней папке облака есть изменения с другого компьютера, которых нет здесь: ${what}. Сборка не переведена, ничего не изменено.`), { code: 'CLOUD_AHEAD' });
};

// Текущая линия сборки: null — в новой папке её нет. Нечитаемый указатель — облако ещё обновляется (ничего не трогаем)
const LINE_RE = /^[\w-]+\.[\w-]+\.\d+$/;
function currentLine(id) {
  const r = fsx.readJson(pointerOf(id));
  if (!r.exists) return null;
  const line = r.ok && r.data && r.data.line;
  if (typeof line !== 'string' || !LINE_RE.test(line) || !line.startsWith(`${id}.`)) throw busyError(BUSY_FILES);
  return line;
}
// Облачная копия сборки для чтения (имя для сообщений): папка текущей линии или null
function cloudOf(id) {
  try {
    const line = currentLine(id);
    return line ? lineDir(line) : null;
  } catch {
    return null;
  }
}

// Файл deleted/<id> прежней папки: 'none' — нет, 'fence' — наша ограда от старых версий, 'deleted' — настоящее удаление
// (так его пишут forget и 0.10.2: время, а не метка; нечитаемое содержимое тоже считаем удалением — сборку не трогаем)
function legacyMark(id) {
  let text;
  try {
    text = fs.readFileSync(fenceOf(id), 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return 'none';
    throw e;
  }
  try {
    if (JSON.parse(text).fence === SPACE) return 'fence';
  } catch {}
  return 'deleted';
}
const deletedElsewhere = (id) => fs.existsSync(tombstone(id)) || legacyMark(id) === 'deleted';
// В новой папке сборки нет, а в прежней она есть (и не удалена): синхронизация ждёт явного перевода. Ограда без указателя —
// перевод начат, но не закончен (здесь или на другом компьютере): тоже ждёт, повтор начнёт его заново
const needsMigration = (id) => !fs.existsSync(pointerOf(id)) && fs.existsSync(legacyOf(id)) && legacyMark(id) !== 'deleted';

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
  return { state: 'ok', files: r.data.files, gen: r.data.gen || 0, space: r.data.space || null, line: r.data.space === SPACE && typeof r.data.line === 'string' ? r.data.line : null };
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

const sameTree = (a, b) => Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([rel, e]) => b[rel] && b[rel].size === e.size && b[rel].mtime === e.mtime);

// Перевод: что в прежней копии изменил другой компьютер, а здесь этого нет. Файл прежней копии не совпадает с базой этого
// компьютера (последним, что он синхронизировал) и не совпадает с его файлом сейчас. Единица — мир целиком или файл
async function legacyAhead(id, local, P, base) {
  const L = scanTree(local, true);
  const B = base.state === 'ok' ? base.files : {};
  const near = (a, b) => !!a && !!b && a.size === b.size && Math.abs(a.mtime - b.mtime) <= TOLERANCE;
  const units = new Set();
  for (const rel of new Set([...Object.keys(P), ...Object.keys(B)])) {
    const p = P[rel];
    const l = L[rel];
    if (p ? near(p, B[rel]) : !B[rel]) continue; // там то же, что здесь синхронизировали в последний раз
    const here = p ? !!l && l.size === p.size && (Math.abs(l.mtime - p.mtime) <= EXACT || (await sha1File(at(local, rel))) === (await sha1File(at(legacyOf(id), rel)))) : !l;
    if (!here) units.add(unitKey(rel));
  }
  return [...units].sort();
}

// Свои старые линии этой сборки (прерванные отдачи, проигравший одновременный перевод) — в «Корзину» папки синхронизации
function retireOwnLines(id, keep, dev) {
  let list = [];
  try {
    list = fs.readdirSync(path.join(cloudRoot(), 'lines'));
  } catch {
    return;
  }
  for (const name of list) {
    if (name === keep || !name.startsWith(`${id}.${dev}.`)) continue;
    try {
      fs.mkdirSync(path.join(cloudRoot(), 'Корзина'), { recursive: true });
      fs.renameSync(lineDir(name), path.join(cloudRoot(), 'Корзина', name));
    } catch {} // занята — уберём в следующий раз
  }
}

const worldPrefix = (rel) => /^((?:\.minecraft\/)?saves\/[^/]+)\//.exec(rel)?.[1] || null;
const unitKey = (rel) => worldPrefix(rel) || rel;
const stampOf = (d = new Date()) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
const shortStamp = (d = new Date()) => `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${pad(d.getHours())}-${pad(d.getMinutes())}`;

// Одна сборка: local — папка сборки у нас, cloud — её текущая линия в облаке.
// migrate — явный перевод из прежней папки (force — без изменений другого компьютера), publish — «Восстановить облако»
async function syncOne(id, { migrate = false, force = false, publish = false } = {}) {
  const root = cloudRoot();
  if (!root) return null;
  if (deletedElsewhere(id)) return null; // сборку удалили на одном из компьютеров
  if (trash.has(id)) return null; // сборка в корзине: пока её можно вернуть, облако её не воскрешает и не трогает
  const local = instances.dirOf(id);
  if (fs.existsSync(path.join(local, '.pack-update'))) throw new Error('Сначала заверши или восстанови обновление модпака');
  const myDev = deviceId();
  const baseFile = path.join(local, BASE);
  const now = Date.now();
  const stamp = stampOf(new Date(now));
  const stat = { up: 0, down: 0, removed: 0, conflicts: [], warnings: [] };

  // ---- какая линия: текущая по указателю или новая из локальных файлов ----
  const line = publish ? null : currentLine(id);
  let fresh = null;
  let legacySnap = null;
  if (!line) {
    if (!publish && needsMigration(id)) {
      if (!migrate) throw legacyError();
      if (!fs.existsSync(path.join(local, 'instance.json'))) throw new Error(ONLY_LEGACY);
      legacySnap = scanTree(legacyOf(id), true);
      if (!force) {
        const ahead = await legacyAhead(id, local, legacySnap, readBase(baseFile));
        if (ahead.length) throw aheadError(ahead);
      }
      // ограда до любых данных нового формата: 0.10.2 больше не забирает, не отдаёт и не удаляет эту сборку
      if (legacyMark(id) === 'none') fsx.writeJsonAtomic(fenceOf(id), { fence: SPACE, dev: myDev, at: now }, false);
      stat.migrated = true;
    } else if (!fs.existsSync(local)) return null; // сборки нет ни здесь, ни в облаке
    fresh = `${id}.${myDev}.${now}`;
  }
  const cloud = lineDir(line || fresh);

  recoverStage(local, stamp);
  sweepTmp(local);

  const baseInfo = readBase(baseFile);
  if (baseInfo.state === 'corrupt') stat.warnings.push('Список синхронизации на этом компьютере повреждён. Ничего не удалено и не перезаписано: расхождения сохранены как конфликты.');
  let reliable = baseInfo.state === 'ok';
  let bF = baseInfo.files;
  const trusted = !!line && reliable && baseInfo.line === line;
  if (line && reliable && !trusted) {
    // База от другой линии или от прежней папки. Целиком годится, только если она — более ранняя точка той линии, из которой
    // создана эта (история внутри линии последовательна, поколение не больше). Иначе — записи, совпавшие со снимком-основанием,
    // а для базы прежней папки ещё записи о файлах, которые в прежней папке не менялись с перевода (перевод прошёл сверку,
    // значит, тогдашнее содержимое — предок новой линии). Остальное без базы: расхождение — конфликт рядом, не перезапись
    const o = fsx.readJson(path.join(cloud, ORIGIN));
    const od = o.ok && o.data && typeof o.data === 'object' ? o.data : {};
    const origin = od.files && typeof od.files === 'object' ? od.files : {};
    const prev = od.prev && typeof od.prev === 'object' ? od.prev : null;
    if (!(baseInfo.line && prev && prev.line === baseInfo.line && baseInfo.gen <= Number(prev.gen))) {
      reliable = false;
      const P = baseInfo.space !== SPACE && od.legacy && typeof od.legacy === 'object' ? od.legacy : null;
      const Pnow = P ? scanTree(legacyOf(id), true) : null;
      const near = (a, b) => a.size === b.size && Math.abs(a.mtime - b.mtime) <= TOLERANCE;
      bF = Object.fromEntries(Object.entries(bF).filter(([rel, b]) => {
        const e = origin[rel];
        if (e && b && near(e, b) && (!e.sha1 || !b.sha1 || e.sha1 === b.sha1)) return true;
        return !!P && (P[rel] ? !!Pnow[rel] && near(P[rel], Pnow[rel]) : !Pnow[rel]);
      }));
    }
  }
  const baseGen = trusted ? baseInfo.gen : 0;
  // Read both complete inventories before changing anything. An unreadable
  // subtree must not be mistaken for files deleted on the other computer.
  const L = scanTree(local, true);
  const L0 = { ...L };
  const C = scanTree(cloud, true);
  let cloudExists = true;
  try {
    fs.statSync(cloud);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    cloudExists = false;
  }
  if (line && !cloudExists) throw busyError(BUSY_FILES); // указатель уже есть, а файлы линии ещё не доехали
  if (!cloudExists) bF = {}; // новая линия — отдаём всё
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
        if ((M.gen || 0) < baseGen) problems.push('облако старее последней синхронизации');
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
    } else problems.push('манифест облака пропал'); // у линии он есть с самого начала
  }
  // Целостность облака не подтверждена (pending, несовпадение с манифестом): ничего не принимаем и не отдаём, сколько бы это ни длилось
  if (problems.length) throw busyError(problems.length === 1 && problems[0] === 'pending' ? BUSY_OTHER : BUSY_FILES);
  if (cloudExists) sweepTmp(cloud);
  const J = { ...(M ? M.deleted : {}) };
  // Поколение сравнивается только внутри одной линии; новая начинает с нуля
  const oldGen = M ? M.gen || 0 : 0;

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
    if (fresh) {
      // Новая линия засчитывается, только если источник был закрыт: локальные файлы не менялись во время отдачи,
      // а прежняя копия (при переводе) — с момента сверки. Иначе указатель не пишется и линию никто не увидит
      if (!sameTree(L0, L2)) throw busyError(BUSY_LOCAL);
      if (legacySnap && !sameTree(legacySnap, scanTree(legacyOf(id), true))) throw busyError(BUSY_LEGACY);
      // снимок-основание: что залито; от какой точки какой линии (для базы других ПК); прежняя копия при переводе со сверкой
      const prev = baseInfo.state === 'ok' && baseInfo.line ? { line: baseInfo.line, gen: baseInfo.gen } : null;
      fsx.writeJsonAtomic(path.join(cloud, ORIGIN), { v: 2, dev: myDev, at: now, files, prev, ...(legacySnap && !force && { legacy: legacySnap }) }, false);
    }
    const changed = cloudChanges || !M || M.pending || JSON.stringify(Object.keys(deleted).sort()) !== JSON.stringify(Object.keys(J).sort());
    if (changed) fsx.writeJsonAtomic(path.join(cloud, MANIFEST), { v: 2, gen: newGen, at: now, dev: myDev, files, deleted }, false);
  }
  if (fresh) {
    // Указатель — последним из облачных записей. Если другой компьютер успел создать линию раньше (одновременный перевод
    // или первая отдача), его линия остаётся текущей, а эта сборка сверяется с ней как обычно, с прежней базой: свои
    // отличия уходят в неё, общие изменения — конфликтной копией рядом. «Восстановить облако» заменяет указатель намеренно
    if (!publish && fs.existsSync(pointerOf(id))) {
      const merged = await syncOne(id);
      merged.warnings.unshift(MERGED);
      return { ...merged, ...(stat.migrated && { migrated: true }) };
    }
    fs.mkdirSync(path.dirname(pointerOf(id)), { recursive: true });
    fsx.writeJsonAtomic(pointerOf(id), { line: fresh, dev: myDev, at: now }, false);
  }
  fsx.writeJsonAtomic(baseFile, { v: 2, space: SPACE, line: line || fresh, at: now, gen: newGen, files: newBase }, false);
  retireOwnLines(id, line || fresh, myDev);
  return stat;
}

// Имя сборки для сообщений: у нас, а если её ещё нет — из облачной копии
function nameOf(id) {
  try {
    const n = instances.get(id)?.name;
    if (n) return n;
  } catch {}
  for (const dir of [cloudOf(id), legacyOf(id)]) {
    try {
      const n = JSON.parse(fs.readFileSync(path.join(dir, 'instance.json'), 'utf8')).name;
      if (n) return n;
    } catch {}
  }
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

// Явный выход из «облако ещё обновляется»: наше состояние становится новой линией, указатель переключается на неё, и только
// потом прежняя линия уходит в «Корзину» папки синхронизации (не стирается). Обрыв до переключения оставляет облако
// прежним. Другие компьютеры ничего не теряют: их база относится к прежней линии, поэтому их отличия сохраняются рядом
// как конфликтные копии. Только по выбору человека, автоматически не вызывается.
async function publishLocal(id) {
  const root = cloudRoot();
  if (!root) throw new Error('Сначала выбери папку облака');
  if (!fs.existsSync(store.get().settings.syncDir)) throw new Error('Папка облака не найдена — проверь, что программа облака установлена');
  instances.get(id); // «Сборка не найдена», если её здесь нет
  if (trash.has(id)) throw new Error('Сборка в корзине: сначала верни её, потом восстанавливай облако');
  if (deletedElsewhere(id)) throw new Error('Сборка удалена на другом компьютере: восстановить для неё облако нельзя');
  if (needsMigration(id)) throw legacyError(); // сначала явный перевод: иначе прежняя копия осталась бы без ограды
  if (fs.existsSync(path.join(instances.dirOf(id), '.pack-update'))) throw new Error('Сначала заверши или восстанови обновление модпака');
  const old = cloudOf(id); // нечитаемый указатель тоже заменяем
  const r = await syncInstance(id, { publish: true });
  if (old && fs.existsSync(old)) {
    try {
      fs.mkdirSync(path.join(root, 'Корзина'), { recursive: true });
      fs.renameSync(old, path.join(root, 'Корзина', path.basename(old)));
    } catch {
      // занята программой облака: облако уже восстановлено, прежняя копия просто осталась на месте
      r.warnings.push(`Прежняя облачная копия занята другой программой и осталась в папке облака: ${path.basename(old)}. Облако восстановлено.`);
    }
  }
  return r;
}

// Сборки в папке облака: имя папки = id, внутри marker (instance.json в прежней папке, line.json в новой)
function cloudIds(root, marker) {
  let list = [];
  try {
    list = fs.readdirSync(path.join(root, 'instances'));
  } catch {}
  return list.filter((d) => /^[\w-]+$/.test(d) && fs.existsSync(path.join(root, 'instances', d, marker)));
}

// Все сборки: свои отдаём, новые из облака (созданные на другом компьютере) забираем. migrate — явный перевод прежней папки,
// force — перевести и те сборки, где в прежней папке есть изменения другого компьютера (они там и останутся)
async function syncAll(isRunning = () => false, { migrate = false, force = false } = {}) {
  const root = cloudRoot();
  if (!root) throw new Error('Сначала выбери папку облака');
  if (!fs.existsSync(store.get().settings.syncDir)) throw new Error('Папка облака не найдена — проверь, что программа облака установлена');
  fs.mkdirSync(path.join(root, 'instances'), { recursive: true });
  const ids = new Set([...instances.list().map((i) => i.id), ...cloudIds(root, POINTER), ...cloudIds(legacyRoot(), 'instance.json')]);
  const total = { up: 0, down: 0, removed: 0, instances: 0, migrated: 0, errors: [], conflicts: [], warnings: [], skipped: [], ahead: [] };
  const legacy = [];
  for (const id of ids) {
    if (isRunning(id)) {
      total.skipped.push(nameOf(id));
      continue;
    }
    try {
      if (deletedElsewhere(id)) {
        if (fs.existsSync(instances.dirOf(id)) && !trash.has(id)) total.warnings.push(`«${nameOf(id)}»: сборка удалена на другом компьютере, здесь она осталась и больше не синхронизируется.`);
        continue;
      }
      const s = await syncOne(id, { migrate, force });
      if (!s) continue;
      total.instances++;
      if (s.migrated) total.migrated++;
      for (const k of ['up', 'down', 'removed']) total[k] += s[k];
      total.conflicts.push(...s.conflicts.map((c) => `«${nameOf(id)}»: ${c}`));
      total.warnings.push(...s.warnings.map((w) => `«${nameOf(id)}»: ${w}`));
    } catch (e) {
      if (e.code === 'CLOUD_LEGACY') legacy.push(`«${nameOf(id)}»`);
      else if (e.code === 'CLOUD_AHEAD') total.ahead.push(`«${nameOf(id)}»: ${e.message}`);
      else total.errors.push(`${nameOf(id)}: ${e.message}`);
    }
  }
  if (legacy.length) total.errors.push(`${legacy.join(', ')}: ${LEGACY}`);
  const problems = [...total.errors, ...total.ahead];
  record(problems.length ? problems.join('\n') : null, '*');
  return total;
}

// Сборку удалили у нас: облачные копии (новая и прежняя) убираем в «Корзину» своих папок, другие компьютеры их не вернут
function forget(id) {
  if (!cloudRoot()) return;
  const now = Date.now();
  const pointerDir = path.dirname(pointerOf(id));
  if (fs.existsSync(pointerDir)) {
    const cloud = cloudOf(id);
    fs.mkdirSync(path.dirname(tombstone(id)), { recursive: true });
    fs.writeFileSync(tombstone(id), String(now));
    fs.mkdirSync(path.join(cloudRoot(), 'Корзина'), { recursive: true });
    if (cloud && fs.existsSync(cloud)) fs.renameSync(cloud, path.join(cloudRoot(), 'Корзина', `${id}-${now}`));
    fs.rmSync(pointerDir, { recursive: true, force: true });
  }
  if (fs.existsSync(legacyOf(id))) {
    fs.mkdirSync(path.dirname(fenceOf(id)), { recursive: true });
    fs.writeFileSync(fenceOf(id), String(now));
    fs.mkdirSync(path.join(legacyRoot(), 'Корзина'), { recursive: true });
    fs.renameSync(legacyOf(id), path.join(legacyRoot(), 'Корзина', `${id}-${now}`));
  }
}

// legacy — сколько сборок ждут перевода из прежней папки (для кнопки в настройках)
function status() {
  const d = store.get();
  let legacy = 0;
  if (legacyRoot()) {
    for (const id of cloudIds(legacyRoot(), 'instance.json')) {
      try {
        if (!trash.has(id) && needsMigration(id)) legacy++;
      } catch {}
    }
  }
  return { dir: d.settings.syncDir || '', at: d.syncedAt || null, error: d.syncError || '', errorId: d.syncErrorId || null, legacy };
}

// Синхронизации идут строго по очереди — две одновременные могли бы перепутать файлы
let chain = Promise.resolve();
const serial = (fn) => (...args) => (chain = chain.catch(() => {}).then(() => fn(...args)));

module.exports = {
  syncInstance: serial(syncInstance),
  syncAll: serial(syncAll),
  migrate: serial((isRunning, force = false) => syncAll(isRunning, { migrate: true, force: !!force })),
  publishLocal: serial(publishLocal),
  forget,
  status,
  ROOT_NAME,
  SPACE,
};
