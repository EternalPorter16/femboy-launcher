// Modrinth: поиск модов, модпаков, ресурспаков и шейдеров; установка модов с зависимостями;
// установка .mrpack (скачанного или с диска) как новой сборки
const fs = require('fs');
const crypto = require('crypto');
const fsx = require('./fsx');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');
const instances = require('./instances');
const mods = require('./mods');
const modmeta = require('./modmeta');
const packstate = require('./packstate');
const packupdate = require('./packupdate');
const health = require('./health');
const { getJson, download, safeJoin, pool, throwIfCancelled } = require('./net');

const API = 'https://api.modrinth.com/v2';
const enc = encodeURIComponent;
const SUPPORTED = ['fabric', 'quilt', 'forge', 'neoforge'];
// Ключ загрузчика в modrinth.index.json → наш тип загрузчика
const PACK_LOADERS = { 'fabric-loader': 'fabric', 'quilt-loader': 'quilt', forge: 'forge', neoforge: 'neoforge' };
const SORTS = ['relevance', 'downloads', 'updated', 'newest', 'follows'];
function checkedFilename(name) {
  if (typeof name !== 'string' || !name || name === '.' || name === '..' || path.basename(name) !== name || /[\\/:*?"<>|\x00-\x1f]/.test(name)) throw new Error('Некорректное имя файла Modrinth');
  return name;
}

// Quilt умеет запускать и Fabric-моды
const loadersFor = (loader) => (loader === 'quilt' ? ['quilt', 'fabric'] : [loader]);

let categoriesCache = null;
async function categories(type) {
  categoriesCache ||= await getJson(`${API}/tag/category`);
  return categoriesCache
    .filter((c) => c.project_type === type && c.header !== 'resolutions' && c.header !== 'performance impact')
    .map((c) => ({ id: c.name, name: c.name }));
}

async function search({ query = '', type = 'mod', gameVersion, loader, offset = 0, category, sort }) {
  const facets = [[`project_type:${type}`]];
  if (type === 'mod') {
    if (gameVersion) facets.push([`versions:${gameVersion}`]);
    if (loader && SUPPORTED.includes(loader)) facets.push(loadersFor(loader).map((l) => `categories:${l}`));
  } else if (type === 'resourcepack' || type === 'shader') {
    if (gameVersion) facets.push([`versions:${gameVersion}`]);
  }
  if (category) facets.push([`categories:${category}`]);
  const index = SORTS.includes(sort) ? sort : query ? 'relevance' : 'downloads';
  const url = `${API}/search?query=${enc(query)}&facets=${enc(JSON.stringify(facets))}&limit=20&offset=${offset}&index=${index}`;
  const r = await getJson(url);
  return {
    total: r.total_hits,
    items: r.hits.map((h) => ({
      id: h.project_id,
      title: h.title,
      description: h.description,
      icon: h.icon_url || null,
      author: h.author,
      downloads: h.downloads,
      url: `https://modrinth.com/${h.project_type}/${h.slug}`,
    })),
  };
}

async function bestVersion(projectId, gameVersion, loaders) {
  let url = `${API}/project/${enc(projectId)}/version?game_versions=${enc(JSON.stringify([gameVersion]))}`;
  if (loaders) url += `&loaders=${enc(JSON.stringify(loaders))}`;
  const vs = await getJson(url);
  return vs.find((v) => v.version_type === 'release') || vs[0] || null;
}

const LOADER_NAMES = { fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge' };
// Какой загрузчик выбрать для ванильной сборки, если подходит несколько.
// До 1.20.1 включительно почти всё делали под Forge (NeoForge тогда только отделился), дальше — под NeoForge
const PREFERRED = ['fabric', 'quilt', 'neoforge', 'forge'];
function preferredFor(mc) {
  const m = /^1\.(\d+)(?:\.(\d+))?/.exec(mc);
  const old = m && (+m[1] < 20 || (+m[1] === 20 && (+m[2] || 0) <= 1));
  return old ? ['fabric', 'quilt', 'forge', 'neoforge'] : PREFERRED;
}

// Что нужно ресурспаку, понимаем по его содержимому: OptiFine-форматы работают только с этими модами
const PACK_FEATURES = [
  [/optifine\/cem\/|\.jem$/i, ['entity-model-features', 'entitytexturefeatures'], 'модели сущностей'],
  [/optifine\/(random|mob)\/|emissive\.properties$/i, ['entitytexturefeatures'], 'текстуры мобов'],
  [/optifine\/ctm\//i, ['continuity'], 'соединённые текстуры'],
  [/optifine\/cit\//i, ['cit-resewn'], 'особые текстуры предметов'],
];

// Загрузчики, под которые у проекта есть версии для этой версии игры
async function availableLoaders(projectId, gameVersion) {
  const vs = await getJson(`${API}/project/${enc(projectId)}/version?game_versions=${enc(JSON.stringify([gameVersion]))}`);
  return [...new Set(vs.flatMap((v) => v.loaders))];
}

// Ванильную сборку переводим на загрузчик, который поддерживает нужный мод — чтобы всё ставилось одной кнопкой
async function ensureLoader(instId, project) {
  const inst = instances.get(instId);
  if (SUPPORTED.includes(inst.loader)) return null;
  const loaders = await availableLoaders(project.id, inst.version);
  const pick = preferredFor(inst.version).find((l) => loaders.includes(l));
  if (!pick) throw new Error(`«${project.title}» нет для Minecraft ${inst.version}`);
  instances.update(instId, { loader: pick });
  return `Сборка «${inst.name}» переведена на ${LOADER_NAMES[pick]} — без загрузчика моды не работают`;
}

function noVersionError(project, inst, loaders) {
  const other = loaders.filter((l) => LOADER_NAMES[l] && !loadersFor(inst.loader).includes(l)).map((l) => LOADER_NAMES[l]);
  return new Error(
    `У «${project.title}» нет версии для ${inst.version} на ${LOADER_NAMES[inst.loader] || inst.loader}` + (other.length ? ` — есть только для ${other.join(', ')}` : '')
  );
}

// Версии проекта под игру и загрузчик: сначала релизы, потом беты (от новых к старым)
async function versionList(projectId, gameVersion, loaders) {
  const url = `${API}/project/${enc(projectId)}/version?game_versions=${enc(JSON.stringify([gameVersion]))}&loaders=${enc(JSON.stringify(loaders))}`;
  const vs = await getJson(url);
  return [...vs.filter((v) => v.version_type === 'release'), ...vs.filter((v) => v.version_type !== 'release')];
}

// Файл мода, уже стоящего в сборке из этого проекта (если есть)
function installedFile(instId, projectId) {
  return Object.entries(mods.readMeta(instId)).find(([key, m]) => !key.includes(':') && m.source === 'modrinth' && m.projectId === projectId && fs.existsSync(mods.filePath(instId, key)))?.[0];
}

// Скачиваем во временный файл и проверяем, подходит ли версия под условия родителя (например, "sodium": "0.6.x")
// или под любую другую проверку метаданных (test)
async function pickCompatible(candidates, parentOrTest) {
  const test = typeof parentOrTest === 'function' ? parentOrTest : (meta) => modmeta.satisfies(meta, parentOrTest.depends, parentOrTest.kind);
  for (const cand of candidates.slice(0, 15)) {
    const f = cand.files.find((x) => x.primary) || cand.files[0];
    const tmp = path.join(os.tmpdir(), `femboy-dep-${crypto.randomBytes(8).toString('hex')}-${checkedFilename(f.filename)}`);
    await download(f.url, tmp, { sha1: f.hashes?.sha1 });
    if (test(modmeta.readMeta(tmp))) return { version: cand, file: f, tmp };
    fs.rmSync(tmp, { force: true });
  }
  return null;
}

// Новый мод несовместим только с некоторыми версиями уже стоящего (Iris и слишком новый Sodium):
// подбираем стоящему моду версию, с которой новый уживается. Возвращает заметки о заменах или бросает ошибку
async function resolveClash(instId, newFile, newTitle) {
  const clash = health.checkNewMod(instId, newFile);
  if (!clash.hard.length) return { notes: [], soft: clash.soft };
  const newMeta = modmeta.readMeta(newFile);
  const inst = instances.get(instId);
  const meta = mods.readMeta(instId);
  const notes = [];
  const unresolved = [];
  for (const h of clash.hardMods) {
    const rec = meta[h.file];
    let picked = null;
    if (h.versionSpecific && rec?.source === 'modrinth' && rec.projectId) {
      const candidates = await versionList(rec.projectId, inst.version, loadersFor(inst.loader)).catch(() => []);
      picked = await pickCompatible(candidates, (m) => m?.id && !modmeta.conflictBetween(newMeta, m)?.hard);
    }
    if (!picked) {
      unresolved.push(h.name);
      continue;
    }
    mods.remove(instId, h.file);
    const dest = path.join(mods.dir(instId), checkedFilename(picked.file.filename));
    fsx.breakLink(dest);
    fs.copyFileSync(picked.tmp, dest);
    fs.rmSync(picked.tmp, { force: true });
    mods.record(instId, picked.file.filename, { ...rec, version: picked.version.version_number });
    notes.push(`«${h.name}» заменён на версию ${picked.version.version_number} — такую требует «${newTitle}»`);
  }
  if (unresolved.length) {
    throw new Error(`«${newTitle}» несовместим с ${unresolved.map((n) => `«${n}»`).join(', ')} — так указано в самом моде. Не ставлю, чтобы игра не сломалась`);
  }
  return { notes, soft: clash.soft };
}

// parent — метаданные мода, которому нужна эта зависимость: { title, depends, kind }
async function installMod(instId, projectId, seen = new Set(), parent = null) {
  const result = { installed: [], warnings: [], notes: [] };
  // Сначала узнаём настоящий id: projectId может быть и слагом (например «sodium»)
  const project = await getJson(`${API}/project/${enc(projectId)}`);
  const switched = await ensureLoader(instId, project);
  if (switched) result.notes.push(switched);
  const inst = instances.get(instId);
  if (seen.has(project.id)) return result;
  seen.add(project.id);

  // Уже стоит? Оставляем, если версия подходит родителю; иначе заменим на совместимую
  const existing = installedFile(instId, project.id);
  if (existing && modmeta.satisfies(modmeta.readMeta(mods.filePath(instId, existing)), parent?.depends, parent?.kind)) return result;

  const candidates = await versionList(project.id, inst.version, loadersFor(inst.loader));
  if (!candidates.length) throw noVersionError(project, inst, await availableLoaders(project.id, inst.version));
  let picked = parent?.depends?.size ? await pickCompatible(candidates, parent) : null;
  if (parent?.depends?.size && !picked) result.warnings.push(`Не нашёл версию «${project.title}», которую требует «${parent.title}» — ставлю самую свежую, игра может не запуститься`);
  if (!picked) {
    const f = candidates[0].files.find((x) => x.primary) || candidates[0].files[0];
    picked = { version: candidates[0], file: f, tmp: null };
  }

  const dest = path.join(mods.dir(instId), checkedFilename(picked.file.filename));
  if (existing) {
    mods.remove(instId, existing);
    result.notes.push(`«${project.title}» заменён на версию ${picked.version.version_number} — такую требует «${parent.title}»`);
  }
  if (picked.tmp) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fsx.breakLink(dest);
    fs.copyFileSync(picked.tmp, dest);
    fs.rmSync(picked.tmp, { force: true });
  } else {
    await download(picked.file.url, dest, { sha1: picked.file.hashes?.sha1 });
  }
  // Сам мод говорит, с чем он несовместим — не ставим то, что сломает игру (или подбираем другую версию соседа)
  let clash;
  try {
    clash = await resolveClash(instId, dest, project.title);
  } catch (e) {
    fs.rmSync(dest, { force: true });
    throw e;
  }
  result.notes.push(...clash.notes);
  if (clash.soft.length) result.warnings.push(`«${project.title}» может плохо работать вместе с ${clash.soft.map((n) => `«${n}»`).join(', ')} — так предупреждает сам мод`);
  mods.record(instId, picked.file.filename, {
    source: 'modrinth',
    projectId: project.id,
    title: project.title,
    icon: project.icon_url || null,
    version: picked.version.version_number,
  });
  result.installed.push(project.title);

  // Условия этого мода на его собственные зависимости берём из самого jar
  const own = modmeta.readMeta(dest);
  await installDeps(instId, picked.version, result, seen, { title: project.title, depends: own?.depends, kind: own?.kind });
  await installJarDeps(instId, own, project.title, result, seen);
  return result;
}

// Не моды, а сама платформа — их ставить не нужно
const PLATFORM_IDS = new Set(['minecraft', 'java', 'fabricloader', 'fabric-loader', 'quilt_loader', 'quilt_base', 'forge', 'neoforge', 'fml', 'javafml']);

// Зависимости, которые прописаны только внутри jar (на сайте их автор не указал): ищем мод на Modrinth по его id
async function installJarDeps(instId, own, title, result, seen = new Set()) {
  if (!own?.depends?.size) return;
  // Всё, что уже есть в сборке: id модов, их provides и то, что они везут внутри себя
  const installedIds = new Set();
  for (const m of mods.list(instId)) {
    const meta = modmeta.readMeta(mods.filePath(instId, m.file));
    if (!meta) continue;
    installedIds.add(meta.id);
    for (const p of meta.provides || []) installedIds.add(p);
  }
  for (const p of own.provides || []) installedIds.add(p);
  for (let id of own.depends.keys()) {
    if (PLATFORM_IDS.has(id) || installedIds.has(id)) continue;
    // Отдельные модули Fabric API (fabric-resource-loader-v0 и т.п.) — это сам Fabric API
    if (/^fabric(-|$)/.test(id) && id !== 'fabric-api') {
      if (installedIds.has('fabric-api') || installedIds.has('fabric')) continue;
      id = 'fabric-api';
    }
    if (installedIds.has(id)) continue;
    installedIds.add(id);
    try {
      merge(result, await installMod(instId, id, seen, { title, depends: own.depends, kind: own.kind }));
    } catch (e) {
      result.warnings.push(`«${title}» нужен мод «${id}», но автоматически поставить его не вышло: ${e.message.replace(/ — https.*/, '')}`);
    }
  }
}

// Обязательные зависимости версии ставим как моды — совместимых версий под игру, загрузчик и условия родителя
async function installDeps(instId, version, result, seen = new Set(), parent = null) {
  for (const dep of version.dependencies.filter((d) => d.dependency_type === 'required')) {
    try {
      const depId = dep.project_id || (await getJson(`${API}/version/${enc(dep.version_id)}`)).project_id;
      merge(result, await installMod(instId, depId, seen, parent));
    } catch (e) {
      result.warnings.push(e.message);
    }
  }
}

function merge(into, from) {
  into.installed.push(...from.installed);
  into.warnings.push(...from.warnings);
  into.notes.push(...(from.notes || []));
}

// Шейдерам нужен Iris (Fabric/Quilt/NeoForge) или Oculus (Forge). Проверяем ДО установки шейдера:
// если под эту версию игры их нет — шейдер ставить бессмысленно, честно говорим об этом
async function ensureShaderMod(instId, result) {
  let inst = instances.get(instId);
  const candidates = inst.loader === 'forge' ? ['oculus'] : inst.loader === 'vanilla' ? ['iris', 'oculus'] : ['iris', 'oculus'];
  for (const slug of candidates) {
    const loaders = await availableLoaders(slug, inst.version).catch(() => []);
    const usable = inst.loader === 'vanilla' ? preferredFor(inst.version).find((l) => loaders.includes(l)) : loadersFor(inst.loader).some((l) => loaders.includes(l)) && inst.loader;
    if (!usable) continue;
    if (inst.loader === 'vanilla') {
      instances.update(instId, { loader: usable });
      result.notes.push(`Сборка «${inst.name}» переведена на ${LOADER_NAMES[usable]} — шейдерам нужен ${slug === 'iris' ? 'Iris' : 'Oculus'}`);
      inst = instances.get(instId);
    }
    merge(result, await installMod(instId, slug));
    return;
  }
  throw new Error(`Для шейдеров нужен Iris или Oculus, но под ${inst.version} (${LOADER_NAMES[inst.loader] || 'ванилла'}) их пока нет — шейдер не заработает`);
}

// Ресурспак или шейдер: файл в нужную папку сборки + всё, что ему нужно для работы
async function installAsset(instId, projectId, kind) {
  const result = { installed: [], warnings: [], notes: [] };
  const project = await getJson(`${API}/project/${enc(projectId)}`);
  const inst = instances.get(instId);
  const version = await bestVersion(project.id, inst.version);
  if (!version) throw new Error(`У «${project.title}» нет версии для Minecraft ${inst.version}`);
  // Шейдеры для Iris/OptiFine требуют Iris; «ванильные» (core shaders) работают и без него
  const needsShaderMod = kind === 'shader' && version.loaders.some((l) => ['iris', 'optifine', 'canvas'].includes(l));
  if (needsShaderMod) await ensureShaderMod(instId, result);
  if (!mods.hasProject(instId, 'modrinth', project.id, kind)) {
    const file = version.files.find((f) => f.primary) || version.files[0];
    const dest = path.join(mods.dir(instId, kind), checkedFilename(file.filename));
    await download(file.url, dest, { sha1: file.hashes?.sha1 });
    mods.record(instId, file.filename, { source: 'modrinth', projectId: project.id, title: project.title, icon: project.icon_url || null, version: version.version_number }, kind);
    result.installed.push(project.title);
    if (kind === 'resourcepack') await installPackFeatures(instId, dest, project.title, result);
  }
  // Зависимости, которые автор указал явно
  await installDeps(instId, version, result);
  return result;
}

// Ресурспак в формате OptiFine (модели, анимации, соединённые текстуры) без нужных модов выглядит как обычный.
// Смотрим, что внутри архива, и ставим моды, которые это умеют
async function installPackFeatures(instId, file, title, result) {
  let names;
  try {
    names = new AdmZip(file).getEntries().map((e) => e.entryName);
  } catch {
    return; // не zip (например, папка) — пропускаем
  }
  const need = [];
  for (const [re, slugs, what] of PACK_FEATURES) {
    if (names.some((n) => re.test(n))) need.push(...slugs.map((s) => [s, what]));
  }
  const seen = new Set();
  for (const [slug, what] of need) {
    if (seen.has(slug)) continue;
    seen.add(slug);
    try {
      merge(result, await installMod(instId, slug));
    } catch (e) {
      result.warnings.push(`Ресурспаку «${title}» для «${what}» нужен мод ${slug}, но он не поставился: ${e.message}`);
    }
  }
}

function install(instId, projectId, kind = 'mod') {
  return kind === 'mod' ? installMod(instId, projectId) : installAsset(instId, projectId, kind);
}

// Свежая версия модпака: сначала релизы
async function latestPackVersion(projectId) {
  const versions = await getJson(`${API}/project/${enc(projectId)}/version`);
  return versions.find((v) => v.version_type === 'release') || versions[0] || null;
}

async function downloadPack(version, title, progress) {
  const packFile = version.files.find((f) => f.primary) || version.files[0];
  const tmp = path.join(os.tmpdir(), `femboy-${Date.now()}.mrpack`);
  await download(packFile.url, tmp, {
    sha1: packFile.hashes?.sha1,
    onProgress: (got, total) => progress(`Качаю модпак «${title}» ${version.version_number}…`, total ? (got / total) * 100 : null),
  });
  return tmp;
}

async function installModpack(projectId, progress) {
  progress('Ищу подходящую версию модпака…', null);
  const [project, version] = await Promise.all([getJson(`${API}/project/${enc(projectId)}`), latestPackVersion(projectId)]);
  if (!version) throw new Error(`У «${project.title}» нет версий`);
  const tmp = await downloadPack(version, project.title, progress);
  try {
    return await installModpackFile(tmp, progress, {
      name: project.title,
      iconUrl: project.icon_url || null,
      pack: { source: 'modrinth', projectId: project.id, versionId: version.id, version: version.version_number },
    });
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

function readIndex(file) {
  const zip = new AdmZip(file);
  const index = JSON.parse(zip.readAsText('modrinth.index.json') || 'null');
  if (!index) throw new Error('Это не модпак Modrinth (нет modrinth.index.json)');
  const deps = index.dependencies || {};
  if (!deps.minecraft) throw new Error('В модпаке не указана версия Minecraft');
  const key = Object.keys(PACK_LOADERS).find((k) => deps[k]);
  return { zip, index, mc: deps.minecraft, loader: key ? PACK_LOADERS[key] : 'vanilla', loaderVersion: key ? deps[key] : null };
}

// Раскладываем файлы .mrpack по папке сборки. updating — обновление поверх старой версии
async function applyMrpack(instId, { zip, index }, progress, updating = false, finalize = () => {}) {
  const gameDir = instances.gameDir(instId);
  const files = index.files.filter((f) => f.env?.client !== 'unsupported' && !(updating && packstate.isWorldPath(f.path)));
  const update = updating ? packupdate.begin(instId) : null;
  try {
    const stale = updating ? packstate.staleFiles(instId, files.map((f) => f.path)) : [];
    const removed = stale.filter((rel) => !rel.endsWith('.disabled')).length;
    let done = 0;
    await pool(files, 6, async (f) => {
      const dest = safeJoin(gameDir, f.path);
      if (!packstate.upToDate(dest, f.hashes?.sha1)) await download(f.downloads[0], update ? update.path(f.path) : dest, { sha1: f.hashes?.sha1 });
      progress(`${updating ? 'Обновляю' : 'Качаю'} моды: ${++done} / ${files.length}`, (done / files.length) * 100);
    });

    progress('Распаковываю настройки модпака…', null);
    const entries = zip.getEntries();
    for (const prefix of ['overrides/', 'client-overrides/']) for (const e of entries) {
      if (e.isDirectory || !e.entryName.startsWith(prefix)) continue;
      const rel = e.entryName.slice(prefix.length);
      const dest = safeJoin(gameDir, rel);
      if (!packstate.shouldWriteOverride(dest, rel, updating)) continue;
      const target = update ? update.path(rel) : dest;
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fsx.breakLink(target);
      fs.writeFileSync(target, e.getData());
    }
    throwIfCancelled();
    update?.commit(stale);
    packstate.write(instId, files.map((f) => f.path));
    finalize();
    update?.finish();
    return { removed, total: files.length };
  } catch (e) {
    update?.abort();
    throw e;
  }
}

// Установка .mrpack с диска (импорт или скачанный модпак)
async function installModpackFile(file, progress, meta = {}) {
  const pack = readIndex(file);
  const inst = instances.create({
    name: meta.name || pack.index.name || 'Модпак',
    version: pack.mc,
    loader: pack.loader,
    loaderVersion: pack.loaderVersion,
    icon: '📦',
    iconUrl: meta.iconUrl || null,
  });
  try {
    await applyMrpack(inst.id, pack, progress);
    if (meta.pack) instances.touch(inst.id, { pack: meta.pack });
    return { instance: instances.get(inst.id), warnings: [] };
  } catch (e) {
    instances.remove(inst.id);
    throw e;
  }
}

// Есть ли новая версия модпака, из которого сделана сборка
async function checkModpackUpdate(instId) {
  const p = instances.get(instId).pack;
  const latest = await latestPackVersion(p.projectId);
  if (!latest || latest.id === p.versionId) return { available: false, current: p.version };
  return { available: true, current: p.version, latest: latest.version_number };
}

async function updateModpack(instId, progress) {
  packupdate.recover(instId);
  const inst = instances.get(instId);
  const latest = await latestPackVersion(inst.pack.projectId);
  if (!latest || latest.id === inst.pack.versionId) return { updated: false };
  const tmp = await downloadPack(latest, inst.name, progress);
  try {
    const pack = readIndex(tmp);
    const res = await applyMrpack(instId, pack, progress, true, () => {
      instances.update(instId, { version: pack.mc, loader: pack.loader });
      instances.touch(instId, { loaderVersion: pack.loaderVersion, pack: { ...inst.pack, versionId: latest.id, version: latest.version_number } });
    });
    return { updated: true, from: inst.pack.version, to: latest.version_number, ...res };
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

module.exports = { search, categories, install, installMod, installJarDeps, resolveClash, installModpack, installModpackFile, checkModpackUpdate, updateModpack, bestVersion, ensureShaderMod, installPackFeatures, preferredFor, versionList, loadersFor, LOADER_NAMES, API };
