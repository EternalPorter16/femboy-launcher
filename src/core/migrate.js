// Перенос сборки на новую версию Minecraft. Рядом со старой сборкой появляется копия: настройки, ресурспаки, шейдеры и (по
// желанию) миры те же, а моды заменены версиями под новую игру. Старая сборка не меняется ни в чём. Чего под новую версию
// нет, в копию не попадает, но остаётся в отчёте: человек сразу видит, чего не хватает
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const instances = require('./instances');
const mods = require('./mods');
const modmeta = require('./modmeta');
const versions = require('./versions');
const forge = require('./forge');
const health = require('./health');
const modrinth = require('./modrinth');
const curseforge = require('./curseforge');
const javafind = require('./javafind');
const worlds = require('./worlds');
const store = require('./store');
const fsx = require('./fsx');
const net = require('./net');

const MR = 'https://api.modrinth.com/v2';
const enc = encodeURIComponent;

// Что не переносим в копию. Моды заводим заново, логи и кэши загрузчика привязаны к старой версии игры,
// а списки файлов модпака и источников модов относятся только к старой сборке
const SKIP_ROOT = new Set(['instance.json', 'mods-meta.json', 'origins.json', 'pack-files.json', 'migration.json', 'bisect.json', 'backups']);
const SKIP_GAME = new Set(['mods', 'logs', 'crash-reports', '.fabric', '.mixin.out', 'debug']);

function sha1File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha1');
    fs.createReadStream(file)
      .on('data', (d) => hash.update(d))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });
}

// Загрузчик под новую версию должен быть: без него моды ставить некуда. Возвращает его версию (для показа)
async function checkTarget(inst, target) {
  if (!target || typeof target !== 'string') throw new Error('Выбери версию Minecraft');
  if (target === inst.version) throw new Error('Сборка уже на этой версии');
  await versions.info(target);
  if (versions.LOADER_NAMES[inst.loader]) return versions.latestLoader(target, inst.loader);
  if (forge.NAMES[inst.loader]) return forge.latestVersion(inst.loader, target);
  return null;
}

const requiredDeps = (ver) => (ver.dependencies || []).filter((d) => d.dependency_type === 'required' && d.project_id).map((d) => d.project_id);

// Названия и значки проектов Modrinth одним запросом (пачками): нужны, чтобы в списке были имена, а не имена файлов
async function projectInfo(ids) {
  const info = new Map();
  const list = [...new Set(ids)];
  for (let i = 0; i < list.length; i += 50) {
    net.throwIfCancelled();
    try {
      for (const p of await net.getJson(`${MR}/projects?ids=${enc(JSON.stringify(list.slice(i, i + 50)))}`)) info.set(p.id, p);
    } catch (e) {
      if (e.cancelled) throw e; // названия — удобство, без них перенос не страдает
    }
  }
  return info;
}

// Что станет с каждым модом на новой версии: обновится (update), подойдёт как есть (same), не нашёлся под неё (missing)
// или не опознан (unknown). Заодно считаем библиотеки, которые нужны новым версиям, а в сборке их нет (extras)
// light — только статусы (для значка «пора на новую версию?»): без CurseForge, названий, значков и библиотек, то есть два запроса к Modrinth
async function analyze(inst, target, { light = false } = {}) {
  if (inst.loader === 'vanilla' || !fs.existsSync(mods.dir(inst.id))) return { items: [], extras: [] }; // и папку модов в старой сборке не создаём
  const items = mods.list(inst.id).map((m) => ({ file: m.file, enabled: m.enabled, title: m.title || null, icon: m.icon || null, from: m.version || null, source: m.source || null, projectId: m.projectId || null, status: null }));
  if (!items.length) return { items: [], extras: [] };
  await net.pool(items, 4, async (it) => {
    it.sha1 = await sha1File(mods.filePath(inst.id, it.file));
  });
  const byHash = new Map();
  for (const it of items) byHash.set(it.sha1, [...(byHash.get(it.sha1) || []), it]);

  // Modrinth ищет по хэшу файла: так находятся и моды, поставленные вручную
  const found = await net.postJson(`${MR}/version_files/update`, { hashes: [...byHash.keys()], algorithm: 'sha1', loaders: modrinth.loadersFor(inst.loader), game_versions: [target] });
  for (const [hash, ver] of Object.entries(found || {})) {
    const file = ver.files?.find((f) => f.primary) || ver.files?.[0];
    if (!file) continue;
    const same = ver.files.some((f) => f.hashes?.sha1 === hash);
    for (const it of byHash.get(hash) || []) {
      Object.assign(it, { status: same ? 'same' : 'update', source: 'modrinth', projectId: ver.project_id, to: ver.version_number, url: file.url, filename: file.filename, fileSha1: file.hashes?.sha1, deps: requiredDeps(ver) });
      if (same) it.from ||= ver.version_number;
    }
  }

  // Моды с CurseForge (если есть ключ): ищем по сохранённому id проекта
  if (!light && store.get().settings.cfApiKey) {
    for (const it of items.filter((i) => !i.status && i.source === 'curseforge' && i.projectId)) {
      net.throwIfCancelled();
      try {
        const f = await curseforge.bestFile(it.projectId, target, inst.loader);
        if (f?.downloadUrl) Object.assign(it, { status: 'update', to: f.displayName, url: f.downloadUrl, filename: path.basename(f.fileName), fileSha1: curseforge.sha1Of(f), deps: [] });
        else Object.assign(it, { status: 'missing', reason: f ? 'автор запретил скачивание в лаунчерах' : null });
      } catch (e) {
        if (e.cancelled) throw e; // не вышло спросить — решим ниже, как для неопознанного
      }
    }
  }

  // Остальные: Modrinth такой файл знает (значит, под новую версию мода просто нет) или это неизвестный мод
  const left = items.filter((i) => !i.status);
  if (left.length) {
    const known = await net.postJson(`${MR}/version_files`, { hashes: [...new Set(left.map((i) => i.sha1))], algorithm: 'sha1' });
    for (const it of left) {
      const k = known?.[it.sha1];
      if (k) {
        Object.assign(it, { status: 'missing', source: 'modrinth', projectId: k.project_id });
        continue;
      }
      // Не с Modrinth: смотрим, что про себя говорит сам мод. Заявлена поддержка новой версии — оставляем включённым
      const jar = modmeta.readMeta(mods.filePath(inst.id, it.file));
      const wants = jar?.depends?.get('minecraft');
      it.name = jar?.name || null;
      it.status = wants !== undefined && modmeta.matches(target, wants, jar.kind) ? 'same' : 'unknown';
      if (it.status === 'same') it.declared = true;
    }
  }

  if (light) return { items, extras: [] };

  // Библиотеки, которые нужны новым версиям модов, а в сборке их нет. Проверяем, что они вообще есть под новую версию
  const present = new Set(items.filter((i) => i.status === 'update' || i.status === 'same').map((i) => i.projectId).filter(Boolean));
  const wanted = new Map();
  for (const it of items) {
    for (const id of it.deps || []) {
      if (present.has(id)) continue;
      wanted.set(id, [...(wanted.get(id) || []), it]);
    }
  }
  const info = await projectInfo([...items.filter((i) => !i.title && i.projectId && i.source === 'modrinth').map((i) => i.projectId), ...wanted.keys()]);
  for (const it of items) {
    const p = info.get(it.projectId);
    it.title ||= p?.title || it.name || it.file.replace(/\.jar$/i, '');
    it.icon ||= p?.icon_url || null;
  }
  const extras = [];
  for (const [projectId, by] of [...wanted].slice(0, 30)) {
    net.throwIfCancelled();
    let available = true;
    try {
      available = (await modrinth.versionList(projectId, target, modrinth.loadersFor(inst.loader))).length > 0;
    } catch (e) {
      if (e.cancelled) throw e;
    }
    extras.push({ projectId, title: info.get(projectId)?.title || projectId, requiredBy: by, available });
  }
  return { items, extras };
}

const pub = (it) => ({ file: it.file, title: it.title, icon: it.icon, enabled: it.enabled, status: it.status, from: it.from, to: it.status === 'update' ? it.to : null, declared: !!it.declared, reason: it.reason || null, error: it.error || null });

function worldStats(instId) {
  try {
    const list = worlds.list(instId);
    return { count: list.length, size: list.reduce((s, w) => s + w.size, 0) };
  } catch {
    return { count: 0, size: 0 };
  }
}

// Сколько ресурспаков или шейдеров: mods.list создаёт папку, если её нет, а смотреть старую сборку надо, ничего в ней не трогая
const packCount = (instId, kind) => (fs.existsSync(mods.dir(instId, kind)) ? mods.list(instId, kind).length : 0);

// Своя Java в сборке может не подойти новой версии игры (с 1.20.5 нужна Java 21): предупреждаем заранее
async function javaNote(inst, target) {
  if (!inst.javaPath) return null;
  try {
    const { major } = await versions.javaInfo(target);
    const r = await javafind.check(inst.javaPath, major);
    return r.level === 'ok' ? null : { level: r.level, message: r.message };
  } catch (e) {
    if (e.cancelled) throw e;
    return null;
  }
}

const counts = (items) => {
  const c = { total: items.length, update: 0, same: 0, missing: 0, unknown: 0, failed: 0 };
  for (const it of items) c[it.status]++;
  return c;
};

// Что получится, если перенести сборку на версию target. Ничего не меняет и не скачивает
async function plan(instId, target) {
  const inst = instances.get(instId);
  const loaderVersion = await checkTarget(inst, target);
  const { items, extras } = await analyze(inst, target);
  return {
    from: inst.version,
    to: target,
    loader: inst.loader,
    loaderVersion,
    mods: items.map(pub),
    extras: extras.map((e) => ({ projectId: e.projectId, title: e.title, requiredBy: [...new Set(e.requiredBy.map((i) => i.title))], available: e.available })),
    counts: counts(items),
    worlds: worldStats(instId),
    packs: { resourcepack: packCount(instId, 'resourcepack'), shader: packCount(instId, 'shader') },
    java: await javaNote(inst, target),
  };
}

// Сколько модов сборки уже вышло под версию target: те же статусы и числа, что в плане, но без названий, библиотек, миров, Java и CurseForge
// (его моды считаются неопознанными). Для значка «пора на новую версию?» (core/readiness.js). Ничего не меняет и не скачивает
async function quick(instId, target) {
  const inst = instances.get(instId);
  if (!target || typeof target !== 'string' || target === inst.version) throw new Error('Сборка уже на этой версии');
  return counts((await analyze(inst, target, { light: true })).items);
}

// «Шейдеры (1.20.1)» → «Шейдеры (1.21.4)», а не «Шейдеры (1.20.1) (1.21.4)»; имя сборки не длиннее 40 знаков
function copyName(name, target) {
  const suffix = ` (${target})`;
  const base = String(name).replace(/\s*\(\d+(\.\d+)*\)\s*$/, '').trim() || 'Сборка';
  return base.slice(0, 40 - suffix.length).trimEnd() + suffix;
}

// Копирует дерево папок, пропуская то, что не принимает accept(части пути). fs.cp для этого не годится: в Node самого Электрона
// на Windows он отдаёт фильтру пути вида «\\?\C:\…» и по ним не понять, что именно копируется. Здесь части пути известны сами,
// заодно «Отменить» срабатывает после каждого файла. Ссылки раскрываем в настоящие файлы: иначе миры копии оказались бы
// общими со старой сборкой. Даты файлов сохраняем: по level.dat видно, когда играли в мир
async function copyTree(from, to, accept, onFile, rel = []) {
  for (const e of await fs.promises.readdir(path.join(from, ...rel), { withFileTypes: true })) {
    const next = [...rel, e.name];
    if (!accept(next)) continue;
    net.throwIfCancelled();
    const src = path.join(from, ...next);
    const dest = path.join(to, ...next);
    let st;
    try {
      st = await fs.promises.stat(src);
    } catch {
      continue; // битая ссылка: копировать нечего
    }
    if (st.isDirectory()) {
      await fs.promises.mkdir(dest, { recursive: true });
      await copyTree(from, to, accept, onFile, next);
    } else if (st.isFile()) {
      await fs.promises.copyFile(src, dest);
      await fs.promises.utimes(dest, st.atime, st.mtime).catch(() => {});
      onFile();
    }
  }
}

// Файлы сборки в копию: настройки, ресурспаки, шейдеры, серверы, миры (если нужны)
async function copyFiles(fromId, toId, { worlds: withWorlds, progress }) {
  const from = instances.dirOf(fromId);
  const to = instances.dirOf(toId);
  const accept = (rel) => {
    if (rel.length === 1 && SKIP_ROOT.has(rel[0])) return false;
    if (rel[0] === '.minecraft') {
      if (rel.length === 2 && (SKIP_GAME.has(rel[1]) || (rel[1] === 'saves' && !withWorlds))) return false;
      const last = rel[rel.length - 1];
      if (last === 'session.lock' || /^hs_err_pid.*\.log$/.test(last)) return false; // замок мира держит игра, в копии он не нужен
    }
    return true;
  };
  let n = 0;
  await copyTree(from, to, accept, () => ++n % 40 === 0 && progress(`Копирую файлы сборки… (${n})`, null));
  // Записи о ресурспаках и шейдерах (откуда они) переезжают вместе с файлами, а моды запишутся заново
  const keep = Object.fromEntries(Object.entries(mods.readMeta(fromId)).filter(([key]) => key.includes(':')));
  if (Object.keys(keep).length) fsx.writeJsonAtomic(path.join(to, 'mods-meta.json'), keep);
}

// Моды в копию: новые версии качаем, подходящие копируем, неопознанные кладём выключенными (чтобы человек сам решил)
async function placeMods(inst, copy, items, progress) {
  const dir = mods.dir(copy.id);
  fs.mkdirSync(dir, { recursive: true });
  const meta = mods.readMeta(inst.id);
  const todo = items.filter((it) => it.status !== 'missing');
  let done = 0;
  await net.pool(todo, 4, async (it) => {
    const old = meta[it.file] || {};
    try {
      if (it.status === 'update') {
        net.safeJoin(dir, it.filename); // имя файла от сервера не должно выводить за папку модов
        const dest = path.join(dir, it.filename + (it.enabled ? '' : '.disabled'));
        await net.download(it.url, dest, { sha1: it.fileSha1 });
        it.placed = it.filename;
        mods.record(copy.id, it.filename, { ...old, source: it.source, projectId: it.projectId, title: it.title, icon: it.icon, version: it.to });
      } else {
        const on = it.enabled && it.status === 'same';
        fs.copyFileSync(mods.filePath(inst.id, it.file), path.join(dir, it.file + (on ? '' : '.disabled')));
        it.placed = it.file;
        if (it.status === 'same' && it.source === 'modrinth') mods.record(copy.id, it.file, { ...old, source: 'modrinth', projectId: it.projectId, title: it.title, icon: it.icon, version: it.from || it.to });
        else if (old.source || old.title) mods.record(copy.id, it.file, { ...old });
      }
    } catch (e) {
      if (e.cancelled) throw e;
      // Один не скачавшийся мод не должен губить весь перенос: он попадёт в отчёт как «не вышло»
      Object.assign(it, { status: 'failed', error: String(e.message).replace(/ — https?:.*$/, '') });
    }
    progress(`Переношу моды (${++done} / ${todo.length})…`, (done / todo.length) * 100);
  });
}

const merge = (into, from) => {
  for (const k of ['installed', 'warnings', 'notes']) into[k].push(...(from[k] || []));
};

// Нужные библиотеки: сначала те, что указаны на Modrinth, потом недостающее по описаниям самих модов (как кнопка «Поставить недостающее»)
async function completeDeps(copy, items, extras, result, progress) {
  const seen = new Set();
  const dir = mods.dir(copy.id);
  // Библиотека нужна, только пока у неё есть хоть один мод, который доехал до копии
  const ready = extras.filter((e) => e.available && e.requiredBy.some((it) => it.status !== 'failed'));
  for (const [i, ex] of ready.entries()) {
    net.throwIfCancelled();
    progress(`Ставлю нужные библиотеки (${i + 1} / ${ready.length})…`, null);
    const by = ex.requiredBy.find((it) => it.placed && it.status !== 'failed');
    const own = by && modmeta.readMeta(path.join(dir, by.placed + (by.enabled && by.status !== 'unknown' ? '' : '.disabled')));
    try {
      merge(result, await modrinth.installMod(copy.id, ex.projectId, seen, by ? { title: by.title, depends: own?.depends, kind: own?.kind } : null));
    } catch (e) {
      if (e.cancelled) throw e;
      result.warnings.push(e.message);
    }
  }
  for (const ex of extras.filter((e) => !e.available)) result.warnings.push(`Нужна библиотека «${ex.title}», но под эту версию её пока нет`);
  const tried = new Set();
  for (let pass = 0; pass < 2; pass++) {
    const need = health.check(copy.id).missing.filter((m) => !m.wrongVersion && !tried.has(m.id));
    if (!need.length) break;
    for (const m of need.slice(0, 20)) {
      net.throwIfCancelled();
      tried.add(m.id);
      progress(`Ставлю недостающее: ${m.id}…`, null);
      try {
        merge(result, await modrinth.installMod(copy.id, m.id, seen, { title: m.by, depends: new Map([[m.id, m.pred]]), kind: m.kind }));
      } catch (e) {
        if (e.cancelled) throw e;
        result.warnings.push(`${m.id}: ${String(e.message).replace(/ — https?:.*$/, '')}`);
      }
    }
  }
}

const fmtSize = (b) => (b >= 1073741824 ? (b / 1073741824).toFixed(1) + ' ГБ' : Math.max(1, Math.round(b / 1048576)) + ' МБ');
const SPARE = 300 * 1048576; // запас на моды и настройки: сами они весят немного, но скачиваются во время переноса

// Копия миров может весить гигабайты: «не хватает места» лучше сказать сразу, чем упасть на середине копирования
function checkSpace(instId, withWorlds) {
  const need = (withWorlds ? worldStats(instId).size : 0) + SPARE;
  let free;
  try {
    const st = fs.statfsSync(instances.dirOf(instId));
    free = st.bavail * st.bsize;
  } catch {
    return; // свободное место узнать не вышло — не мешаем
  }
  if (free < need) throw new Error(`На диске не хватает места для копии: нужно около ${fmtSize(need)}, свободно ${fmtSize(free)}`);
}

// Создаёт копию сборки на версии target. progress(подпись, процент|null). При отмене или сбое копия удаляется целиком
async function run(instId, target, { worlds: withWorlds = true } = {}, progress = () => {}) {
  const inst = instances.get(instId);
  progress(`Смотрю, что есть под ${target}…`, null);
  await checkTarget(inst, target);
  checkSpace(instId, withWorlds);
  const { items, extras } = await analyze(inst, target);
  net.throwIfCancelled();

  progress('Создаю копию сборки…', null);
  const copy = instances.create({ ...inst, name: copyName(inst.name, target), version: target, loaderVersion: null });
  try {
    await copyFiles(inst.id, copy.id, { worlds: withWorlds, progress });
    await placeMods(inst, copy, items, progress);
    const result = { installed: [], warnings: [], notes: [] };
    if (inst.loader !== 'vanilla') await completeDeps(copy, items, extras, result, progress);
    progress('Проверяю сборку…', null);
    const h = health.check(copy.id);
    const report = {
      from: { id: inst.id, name: inst.name, version: inst.version },
      to: target,
      at: Date.now(),
      counts: counts(items),
      mods: items.map(pub),
      installed: result.installed,
      warnings: result.warnings,
      notes: result.notes,
      worlds: withWorlds ? worldStats(inst.id) : null,
      health: { conflicts: h.conflicts.length, missing: h.missing.length, duplicates: h.duplicates.length },
    };
    fsx.writeJsonAtomic(path.join(instances.dirOf(copy.id), 'migration.json'), report);
    instances.touch(copy.id, { playtime: 0, lastPlayed: null, migratedFrom: { id: inst.id, name: inst.name, version: inst.version, at: report.at } });
    return { instance: instances.get(copy.id), report };
  } catch (e) {
    try {
      instances.remove(copy.id);
    } catch {}
    throw e;
  }
}

// Отчёт о переносе, если эта сборка получилась переносом
function report(instId) {
  const r = fsx.readJson(path.join(instances.dirOf(instId), 'migration.json'));
  return r.ok ? r.data : null;
}

module.exports = { plan, quick, run, report, copyName };
