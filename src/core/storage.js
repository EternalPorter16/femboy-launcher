// Место на диске: сколько занимают Java, версии, библиотеки и ресурсы игры, и что из этого
// не нужно ни одной сборке. Чистим только неиспользуемое и только то, что можно скачать заново.
const fs = require('fs');
const path = require('path');
const store = require('./store');
const instances = require('./instances');
const versions = require('./versions');
const gamefiles = require('./gamefiles');

// Эти библиотеки создаёт установщик Forge/NeoForge, и в профилях версий они не перечислены —
// удалять их нельзя, иначе установленный Forge перестанет запускаться
const PROTECTED_LIBS = ['net/minecraftforge/', 'net/neoforged/', 'net/minecraft/', 'cpw/', 'de/oceanlabs/'];

function size(p) {
  try {
    const st = fs.statSync(p);
    if (!st.isDirectory()) return st.size;
    return fs.readdirSync(p).reduce((s, f) => s + size(path.join(p, f)), 0);
  } catch {
    return 0;
  }
}

const dirs = (p) => (fs.existsSync(p) ? fs.readdirSync(p, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name) : []);

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

// Профиль загрузчика (versions/<id>) принадлежит сборке?
function profileBelongs(id, json, inst) {
  if (json?.inheritsFrom !== inst.version || inst.loader === 'vanilla') return false;
  const lv = inst.loaderVersion;
  const byLoader = {
    fabric: id.startsWith('fabric-loader-'),
    quilt: id.startsWith('quilt-loader-'),
    neoforge: id.startsWith('neoforge-') || (inst.version === '1.20.1' && id.includes('-forge-')),
    forge: id.includes('-forge-') && !id.startsWith('neoforge'),
  }[inst.loader];
  return !!byLoader && (!lv || id.includes(lv));
}

async function plan() {
  const { root, java: javaRoot } = store.paths();
  const insts = instances.list();
  const instanceDirs = fs.readdirSync(store.paths().instances, { withFileTypes: true }).filter((e) => e.isDirectory() || e.isSymbolicLink());
  const valid = (i) => i && typeof i === 'object' && !Array.isArray(i) && typeof i.id === 'string' && typeof i.version === 'string' && i.version.length > 0;
  const known = new Set(insts.filter(valid).map((i) => i.id));
  if (insts.some((i) => !valid(i)) || instanceDirs.some((e) => !known.has(e.name))) {
    throw new Error('Очистка остановлена: сначала восстанови настройки повреждённой сборки');
  }
  if (instanceDirs.some((e) => fs.existsSync(path.join(store.paths().instances, e.name, '.pack-update')))) {
    throw new Error('Очистка остановлена: сначала заверши или восстанови обновление модпака');
  }
  const versionsDir = path.join(root, 'versions');

  // 1. Какие версии нужны: версия игры каждой сборки и её профиль загрузчика
  const keep = new Set();
  const allVersions = dirs(versionsDir);
  const jsons = new Map(allVersions.map((v) => [v, readJson(path.join(versionsDir, v, v + '.json'))]));
  if ([...jsons.values()].some((json) => !json || typeof json !== 'object' || Array.isArray(json))) {
    throw new Error('Очистка остановлена: не удалось прочитать настройки установленной версии игры');
  }
  for (const inst of insts) {
    keep.add(inst.version);
    for (const v of allVersions) if (profileBelongs(v, jsons.get(v), inst)) keep.add(v);
  }

  // 2. Библиотеки, на которые ссылаются оставшиеся версии
  const usedLibs = new Set();
  for (const v of keep) {
    const json = jsons.get(v);
    if (!json) continue;
    for (const j of gamefiles.libraryJobsFor(root, [json])) usedLibs.add(path.normalize(j.dest));
  }
  const libsRoot = path.join(root, 'libraries');
  const libFiles = [];
  const walk = (dir) => {
    for (const e of fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else libFiles.push(p);
    }
  };
  walk(libsRoot);
  const unusedLibs = libFiles.filter((f) => {
    const rel = path.relative(libsRoot, f).split(path.sep).join('/');
    return !usedLibs.has(path.normalize(f)) && !PROTECTED_LIBS.some((p) => rel.startsWith(p));
  });

  // 3. Ресурсы игры: индексы нужных версий и объекты, на которые они ссылаются
  const assetsRoot = path.join(root, 'assets');
  const keepIndexes = new Set();
  for (const v of keep) {
    keepIndexes.add(v); // движок запуска кладёт копию индекса под именем версии
    const idx = jsons.get(v)?.assetIndex?.id;
    if (idx) keepIndexes.add(idx);
  }
  const indexFiles = fs.existsSync(path.join(assetsRoot, 'indexes')) ? fs.readdirSync(path.join(assetsRoot, 'indexes')).filter((f) => f.endsWith('.json')) : [];
  for (const v of keep) {
    const idx = jsons.get(v)?.assetIndex?.id;
    if (idx && !indexFiles.includes(`${idx}.json`) && !indexFiles.includes(`${v}.json`)) throw new Error('Очистка остановлена: не удалось прочитать список ресурсов игры');
  }
  const usedObjects = new Set();
  for (const f of indexFiles) {
    if (!keepIndexes.has(f.replace(/\.json$/, ''))) continue;
    const index = readJson(path.join(assetsRoot, 'indexes', f));
    if (!index?.objects || typeof index.objects !== 'object' || Array.isArray(index.objects)) throw new Error('Очистка остановлена: не удалось прочитать список ресурсов игры');
    for (const o of Object.values(index.objects)) {
      if (!o || typeof o.hash !== 'string' || !/^[0-9a-f]{40}$/i.test(o.hash)) throw new Error('Очистка остановлена: не удалось прочитать список ресурсов игры');
      usedObjects.add(o.hash);
    }
  }
  const unusedObjects = [];
  for (const sub of dirs(path.join(assetsRoot, 'objects'))) {
    for (const h of fs.readdirSync(path.join(assetsRoot, 'objects', sub))) if (!usedObjects.has(h)) unusedObjects.push(path.join(assetsRoot, 'objects', sub, h));
  }
  const unusedIndexes = indexFiles.filter((f) => !keepIndexes.has(f.replace(/\.json$/, ''))).map((f) => path.join(assetsRoot, 'indexes', f));

  // 4. Java: какие версии нужны сборкам (если не смогли узнать — ничего не трогаем)
  let unusedJava = [];
  try {
    const need = new Set();
    for (const inst of insts) {
      if ((inst.javaPath || '').trim()) continue;
      let { major } = await versions.javaInfo(inst.version);
      if (major === 16) major = 17;
      need.add(String(major));
    }
    unusedJava = dirs(javaRoot)
      .filter((d) => !need.has(d))
      .map((d) => path.join(javaRoot, d));
  } catch {}

  // 5. Установщики Forge, нативные библиотеки старых версий, логи установщика
  const installers = fs.existsSync(path.join(root, 'installers'))
    ? fs.readdirSync(path.join(root, 'installers')).filter((f) => !insts.some((i) => i.loaderVersion && f.startsWith(`${i.loader}-${i.version}-${i.loaderVersion}`)))
    : [];
  const natives = dirs(path.join(root, 'natives')).filter((v) => !keep.has(v));

  // 6. Логи в общей папке игры: пока Java запускалась из неё, latest.log, отчёты о вылетах и hs_err оседали здесь. Теперь у каждой сборки
  // свои (<сборка>/.minecraft/logs), и эти старые никому не нужны. Логи сборок и самого лаунчера лежат в других местах и не затрагиваются
  const oldLogs = [path.join(root, 'logs'), path.join(root, 'crash-reports'), ...(fs.existsSync(root) ? fs.readdirSync(root).filter((f) => /^hs_err_pid\d+\.log$/.test(f)).map((f) => path.join(root, f)) : [])].filter((p) => fs.existsSync(p));

  const cat = (id, name, total, items, note) => ({ id, name, total, free: items.reduce((s, p) => s + size(p), 0), count: items.length, items, note });
  return [
    cat('java', 'Java', size(javaRoot), unusedJava, 'скачивается сама, когда понадобится'),
    cat('versions', 'Версии игры и загрузчики', size(versionsDir), allVersions.filter((v) => !keep.has(v)).map((v) => path.join(versionsDir, v))),
    cat('libraries', 'Библиотеки', size(libsRoot), unusedLibs),
    cat('assets', 'Ресурсы игры (звуки, языки)', size(assetsRoot), [...unusedObjects, ...unusedIndexes]),
    cat(
      'other',
      'Установщики и временные файлы',
      size(path.join(root, 'installers')) + size(path.join(root, 'natives')) + size(path.join(root, 'installer.log')),
      [...installers.map((f) => path.join(root, 'installers', f)), ...natives.map((v) => path.join(root, 'natives', v)), path.join(root, 'installer.log')].filter((p) => fs.existsSync(p))
    ),
    ...(oldLogs.length ? [cat('logs', 'Старые логи игры', oldLogs.reduce((s, p) => s + size(p), 0), oldLogs, 'больше нигде не нужны')] : []),
  ];
}

// Обзор для интерфейса — без списков файлов
async function scan() {
  const cats = await plan();
  return {
    categories: cats.map(({ items, ...c }) => c),
    instancesSize: size(store.paths().instances),
  };
}

// Удаляем неиспользуемое по выбранным категориям. План строим заново прямо перед удалением
async function clean(ids) {
  const base = path.resolve(store.baseDir()) + path.sep;
  let freed = 0;
  for (const c of await plan()) {
    if (!ids.includes(c.id)) continue;
    for (const p of c.items) {
      if (!path.resolve(p).startsWith(base)) continue; // только внутри папки лаунчера
      freed += size(p);
      fs.rmSync(p, { recursive: true, force: true });
    }
  }
  // Пустые папки в библиотеках после удаления не нужны
  const prune = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) if (e.isDirectory()) prune(path.join(dir, e.name));
    if (dir !== path.join(store.paths().root, 'libraries') && !fs.readdirSync(dir).length) fs.rmdirSync(dir);
  };
  if (ids.includes('libraries')) prune(path.join(store.paths().root, 'libraries'));
  return { freed };
}

module.exports = { scan, clean };
