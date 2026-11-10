// CurseForge: работает с личным API-ключом пользователя (console.curseforge.com) — без ключа API закрыт
const fs = require('fs');
const fsx = require('./fsx');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');
const store = require('./store');
const instances = require('./instances');
const mods = require('./mods');
const modmeta = require('./modmeta');
const packstate = require('./packstate');
const packupdate = require('./packupdate');
const { getJson, postJson, download, safeJoin, pool, throwIfCancelled } = require('./net');

const API = 'https://api.curseforge.com/v1';
const GAME = 432;
const CLASS = { mod: 6, modpack: 4471, resourcepack: 12, shader: 6552 };
const KIND_NAMES = { 6: 'мод', 4471: 'модпак', 12: 'ресурспак', 6552: 'шейдер' };
const LOADER = { forge: 1, fabric: 4, quilt: 5, neoforge: 6 };
const FOLDER_BY_CLASS = { 6: 'mods', 12: 'resourcepacks', 6552: 'shaderpacks' };
// Поля сортировки CurseForge: 2 — популярность, 3 — дата обновления, 6 — скачивания, 11 — дата выхода
const SORTS = { relevance: 1, downloads: 6, updated: 3, newest: 11, follows: 2 };
const REQUIRED = 3;
const enc = encodeURIComponent;

function headers() {
  const key = store.get().settings.cfApiKey?.trim();
  if (!key) throw new Error('Для CurseForge нужен API-ключ — добавь его в Настройках');
  return { 'x-api-key': key };
}

const cf = (url) => getJson(API + url, headers());
const sha1Of = (file) => file.hashes?.find((h) => h.algo === 1)?.value;

function blockedMessage(name, url) {
  return `Автор «${name}» запретил скачивание из сторонних лаунчеров — скачай вручную: ${url || 'curseforge.com'}`;
}

const toItem = (m) => ({
  id: String(m.id),
  title: m.name,
  description: m.summary,
  icon: m.logo?.thumbnailUrl || null,
  author: m.authors?.[0]?.name || '',
  downloads: m.downloadCount,
  url: m.links?.websiteUrl || null,
});

// ID проекта: просто число или ссылка, в которой есть число (Project ID на странице мода)
const projectIdFrom = (query) => /^\s*(\d{3,})\s*$/.exec(query)?.[1] || /(?:projects?\/|projectId=|\/)(\d{4,})(?:\b|$)/.exec(query)?.[1];

const categoryCache = new Map();
async function categories(type) {
  if (!categoryCache.has(type)) {
    const list = (await cf(`/categories?gameId=${GAME}&classId=${CLASS[type]}`)).data;
    categoryCache.set(type, list.filter((c) => !c.isClass).map((c) => ({ id: String(c.id), name: c.name })).sort((a, b) => a.name.localeCompare(b.name)));
  }
  return categoryCache.get(type);
}

async function search({ query = '', type = 'mod', gameVersion, loader, offset = 0, category, sort }) {
  const byId = projectIdFrom(query);
  if (byId) {
    const m = (await cf(`/mods/${byId}`)).data;
    if (m.gameId !== GAME) throw new Error(`Проект ${byId} — не для Minecraft`);
    if (m.classId !== CLASS[type]) {
      throw new Error(`«${m.name}» — это ${KIND_NAMES[m.classId] || 'другой тип проекта'}, переключи вкладку сверху`);
    }
    return { total: 1, items: [toItem(m)] };
  }

  const sortField = SORTS[sort] || (query ? 1 : 2);
  let url = `/mods/search?gameId=${GAME}&classId=${CLASS[type]}&searchFilter=${enc(query)}&sortField=${sortField}&sortOrder=desc&pageSize=20&index=${offset}`;
  if (type !== 'modpack' && gameVersion) url += `&gameVersion=${enc(gameVersion)}`;
  if (type === 'mod' && LOADER[loader]) url += `&modLoaderType=${LOADER[loader]}`;
  if (category) url += `&categoryId=${enc(category)}`;
  try {
    const r = await cf(url);
    return { total: Math.min(r.pagination?.totalCount || 0, 9980), items: r.data.map(toItem) };
  } catch (e) {
    // Обычные ключи из console.curseforge.com не имеют права на поиск (403), но установка по ID работает
    if (/HTTP 403/.test(e.message)) return { total: 0, items: [], searchBlocked: true };
    throw e;
  }
}

async function bestFile(modId, gameVersion, loader) {
  let url = `/mods/${enc(modId)}/files?pageSize=50`;
  if (gameVersion) url += `&gameVersion=${enc(gameVersion)}`;
  if (LOADER[loader]) url += `&modLoaderType=${LOADER[loader]}`;
  const files = (await cf(url)).data.sort((a, b) => new Date(b.fileDate) - new Date(a.fileDate));
  return files.find((f) => f.releaseType === 1) || files[0] || null;
}

// Загрузчики, под которые у мода есть файлы для этой версии игры (CurseForge пишет их в gameVersions)
async function availableLoaders(modId, gameVersion) {
  const files = (await cf(`/mods/${enc(modId)}/files?pageSize=50&gameVersion=${enc(gameVersion)}`)).data;
  const names = new Set(files.flatMap((f) => f.gameVersions.map((g) => g.toLowerCase())));
  return Object.keys(LOADER).filter((l) => names.has(l));
}

// Ванильную сборку переводим на загрузчик, который поддерживает мод
async function ensureLoader(instId, mod) {
  const inst = instances.get(instId);
  if (LOADER[inst.loader]) return null;
  const { preferredFor, LOADER_NAMES } = require('./modrinth');
  const loaders = await availableLoaders(mod.id, inst.version);
  const chosen = preferredFor(inst.version).find((l) => loaders.includes(l));
  if (!chosen) throw new Error(`«${mod.name}» нет для Minecraft ${inst.version}`);
  instances.update(instId, { loader: chosen });
  return `Сборка «${inst.name}» переведена на ${LOADER_NAMES[chosen]} — без загрузчика моды не работают`;
}

// Файлы мода под игру и загрузчик: сначала релизы, потом беты (от новых к старым)
async function fileList(modId, gameVersion, loader) {
  let url = `/mods/${enc(modId)}/files?pageSize=50&gameVersion=${enc(gameVersion)}`;
  if (LOADER[loader]) url += `&modLoaderType=${LOADER[loader]}`;
  const files = (await cf(url)).data.sort((a, b) => new Date(b.fileDate) - new Date(a.fileDate));
  return [...files.filter((f) => f.releaseType === 1), ...files.filter((f) => f.releaseType !== 1)];
}

function installedFile(instId, modId) {
  return Object.entries(mods.readMeta(instId)).find(([key, m]) => !key.includes(':') && m.source === 'curseforge' && String(m.projectId) === modId && fs.existsSync(mods.filePath(instId, key)))?.[0];
}

// Подбираем файл, который подходит под условия родителя из его jar (например "sodium": "0.6.x")
async function pickCompatible(files, parent) {
  for (const f of files.filter((x) => x.downloadUrl).slice(0, 15)) {
    const tmp = path.join(os.tmpdir(), `femboy-dep-${Date.now()}-${path.basename(f.fileName)}`);
    await download(f.downloadUrl, tmp, { sha1: sha1Of(f) });
    if (modmeta.satisfies(modmeta.readMeta(tmp), parent.depends, parent.kind)) return { file: f, tmp };
    fs.rmSync(tmp, { force: true });
  }
  return null;
}

// parent — метаданные мода, которому нужна эта зависимость: { title, depends, kind }
async function installMod(instId, modId, seen = new Set(), parent = null) {
  const result = { installed: [], warnings: [], notes: [] };
  modId = String(modId);
  const mod = (await cf(`/mods/${enc(modId)}`)).data;
  const switched = await ensureLoader(instId, mod);
  if (switched) result.notes.push(switched);
  const inst = instances.get(instId);
  if (seen.has(modId)) return result;
  seen.add(modId);

  // Уже стоит? Оставляем, если версия подходит родителю; иначе заменим на совместимую
  const existing = installedFile(instId, modId);
  if (existing && modmeta.satisfies(modmeta.readMeta(mods.filePath(instId, existing)), parent?.depends, parent?.kind)) return result;

  const files = await fileList(modId, inst.version, inst.loader);
  if (!files.length) {
    const other = (await availableLoaders(modId, inst.version)).filter((l) => l !== inst.loader);
    throw new Error(`У «${mod.name}» нет файла для ${inst.version} (${inst.loader})${other.length ? ` — есть только для ${other.join(', ')}` : ''}`);
  }
  let picked = parent?.depends?.size ? await pickCompatible(files, parent) : null;
  if (parent?.depends?.size && !picked) result.warnings.push(`Не нашёл версию «${mod.name}», которую требует «${parent.title}» — ставлю самую свежую, игра может не запуститься`);
  if (!picked) picked = { file: files[0], tmp: null };
  if (!picked.file.downloadUrl) throw new Error(blockedMessage(mod.name, mod.links?.websiteUrl));

  const name = path.basename(picked.file.fileName);
  const dest = path.join(mods.dir(instId), name);
  if (existing) {
    mods.remove(instId, existing);
    result.notes.push(`«${mod.name}» заменён на ${picked.file.displayName} — такую версию требует «${parent.title}»`);
  }
  if (picked.tmp) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fsx.breakLink(dest);
    fs.copyFileSync(picked.tmp, dest);
    fs.rmSync(picked.tmp, { force: true });
  } else {
    await download(picked.file.downloadUrl, dest, { sha1: sha1Of(picked.file) });
  }
  let clash;
  try {
    clash = await require('./modrinth').resolveClash(instId, dest, mod.name);
  } catch (e) {
    fs.rmSync(dest, { force: true });
    throw e;
  }
  result.notes.push(...clash.notes);
  if (clash.soft.length) result.warnings.push(`«${mod.name}» может плохо работать вместе с ${clash.soft.map((n) => `«${n}»`).join(', ')} — так предупреждает сам мод`);
  mods.record(instId, name, {
    source: 'curseforge',
    projectId: modId,
    title: mod.name,
    icon: mod.logo?.thumbnailUrl || null,
    version: picked.file.displayName,
  });
  result.installed.push(mod.name);

  const own = modmeta.readMeta(dest);
  await installDeps(instId, picked.file, result, seen, { title: mod.name, depends: own?.depends, kind: own?.kind });
  // На CurseForge авторы часто не указывают зависимости — берём их из самого jar и ищем на Modrinth
  await require('./modrinth').installJarDeps(instId, own, mod.name, result);
  return result;
}

// Обязательные зависимости файла ставим как моды — совместимых версий под игру, загрузчик и условия родителя
async function installDeps(instId, file, result, seen = new Set(), parent = null) {
  for (const dep of file.dependencies.filter((d) => d.relationType === REQUIRED)) {
    try {
      const sub = await installMod(instId, dep.modId, seen, parent);
      result.installed.push(...sub.installed);
      result.warnings.push(...sub.warnings);
      result.notes.push(...sub.notes);
    } catch (e) {
      result.warnings.push(e.message);
    }
  }
}

// Ресурспак или шейдер + всё, что ему нужно. Iris/Oculus для шейдеров берём с Modrinth — там он надёжнее
async function installAsset(instId, modId, kind) {
  const result = { installed: [], warnings: [], notes: [] };
  const inst = instances.get(instId);
  const [mod, file] = await Promise.all([cf(`/mods/${enc(modId)}`).then((r) => r.data), bestFile(modId, inst.version)]);
  if (!file) throw new Error(`У «${mod.name}» нет файла для Minecraft ${inst.version}`);
  if (!file.downloadUrl) throw new Error(blockedMessage(mod.name, mod.links?.websiteUrl));
  // До установки шейдера проверяем и ставим Iris/Oculus: без них шейдер не заработает
  if (kind === 'shader') await require('./modrinth').ensureShaderMod(instId, result);
  if (!mods.hasProject(instId, 'curseforge', String(modId), kind)) {
    const name = path.basename(file.fileName);
    const dest = path.join(mods.dir(instId, kind), name);
    await download(file.downloadUrl, dest, { sha1: sha1Of(file) });
    mods.record(instId, name, { source: 'curseforge', projectId: String(modId), title: mod.name, icon: mod.logo?.thumbnailUrl || null, version: file.displayName }, kind);
    result.installed.push(mod.name);
    if (kind === 'resourcepack') await require('./modrinth').installPackFeatures(instId, dest, mod.name, result);
  }
  await installDeps(instId, file, result);
  return result;
}

function install(instId, modId, kind = 'mod') {
  return kind === 'mod' ? installMod(instId, modId) : installAsset(instId, modId, kind);
}

async function downloadPack(mod, file, progress) {
  if (!file.downloadUrl) throw new Error(blockedMessage(mod.name, mod.links?.websiteUrl));
  const tmp = path.join(os.tmpdir(), `femboy-${Date.now()}.zip`);
  await download(file.downloadUrl, tmp, {
    sha1: sha1Of(file),
    onProgress: (got, total) => progress(`Качаю модпак «${mod.name}» ${file.displayName}…`, total ? (got / total) * 100 : null),
  });
  return tmp;
}

async function installModpack(modId, progress) {
  progress('Ищу подходящую версию модпака…', null);
  const mod = (await cf(`/mods/${enc(modId)}`)).data;
  const file = await bestFile(modId);
  if (!file) throw new Error(`У «${mod.name}» нет файлов`);
  const tmp = await downloadPack(mod, file, progress);
  try {
    return await installModpackFile(tmp, progress, {
      name: mod.name,
      iconUrl: mod.logo?.thumbnailUrl || null,
      pack: { source: 'curseforge', projectId: String(mod.id), fileId: file.id, version: file.displayName },
    });
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

function readManifest(file) {
  const zip = new AdmZip(file);
  const manifest = JSON.parse(zip.readAsText('manifest.json') || 'null');
  if (!manifest?.minecraft) throw new Error('Это не модпак CurseForge (нет manifest.json)');
  const primary = (manifest.minecraft.modLoaders.find((l) => l.primary) || manifest.minecraft.modLoaders[0])?.id || '';
  const [, loader, loaderVersion] = /^(fabric|quilt|forge|neoforge)-(.+)$/.exec(primary) || [];
  if (!loader) throw new Error(`Не понимаю загрузчик модпака: ${primary || 'не указан'}`);
  const wanted = manifest.files.filter((f) => f.required !== false);
  if (wanted.length) headers(); // без ключа CurseForge моды из такого модпака не скачать — проверяем заранее
  return { zip, manifest, wanted, mc: manifest.minecraft.version, loader, loaderVersion };
}

// Раскладываем файлы zip-модпака по папке сборки. updating — обновление поверх старой версии
async function applyCfPack(instId, { zip, manifest, wanted }, progress, updating = false, finalize = () => {}) {
  const gameDir = instances.gameDir(instId);
  progress('Получаю список модов…', null);
  const files = wanted.length ? (await postJson(`${API}/mods/files`, { fileIds: wanted.map((f) => f.fileID) }, headers())).data : [];
  const projects = files.length ? (await postJson(`${API}/mods`, { modIds: [...new Set(files.map((f) => f.modId))] }, headers())).data : [];
  const byId = new Map(projects.map((p) => [p.id, p]));
  const relOf = (f) => `${FOLDER_BY_CLASS[byId.get(f.modId)?.classId] || 'mods'}/${path.basename(f.fileName)}`;

  const warnings = [];
  const downloadable = files.filter((f) => {
    if (f.downloadUrl) return true;
    const p = byId.get(f.modId);
    warnings.push(blockedMessage(p?.name || f.displayName, p?.links?.websiteUrl));
    return false;
  });
  const update = updating ? packupdate.begin(instId) : null;
  try {
    const stale = updating ? packstate.staleFiles(instId, files.map(relOf)) : [];
    const removed = stale.filter((rel) => !rel.endsWith('.disabled')).length;
    const records = [];

    let done = 0;
    await pool(downloadable, 6, async (f) => {
      const p = byId.get(f.modId);
      const rel = relOf(f);
      const dest = safeJoin(gameDir, rel);
      if (!packstate.upToDate(dest, sha1Of(f))) await download(f.downloadUrl, update ? update.path(rel) : dest, { sha1: sha1Of(f) });
      if (rel.startsWith('mods/') && p) {
        records.push(() => mods.record(instId, path.basename(rel), { source: 'curseforge', projectId: String(p.id), title: p.name, icon: p.logo?.thumbnailUrl || null, version: f.displayName }));
      }
      progress(`${updating ? 'Обновляю' : 'Качаю'} моды: ${++done} / ${downloadable.length}`, (done / downloadable.length) * 100);
    });

    progress('Распаковываю настройки модпака…', null);
    const prefix = (manifest.overrides || 'overrides') + '/';
    for (const e of zip.getEntries()) {
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
    records.forEach((record) => record());
    packstate.write(instId, files.map(relOf));
    finalize();
    update?.finish();
    return { warnings, removed, total: files.length };
  } catch (e) {
    update?.abort();
    throw e;
  }
}

// Установка zip-модпака CurseForge с диска (импорт или скачанный)
async function installModpackFile(file, progress, meta = {}) {
  const pack = readManifest(file);
  const inst = instances.create({
    name: meta.name || pack.manifest.name || 'Модпак',
    version: pack.mc,
    loader: pack.loader,
    loaderVersion: pack.loaderVersion,
    icon: '📦',
    iconUrl: meta.iconUrl || null,
  });
  try {
    const { warnings } = await applyCfPack(inst.id, pack, progress);
    if (meta.pack) instances.touch(inst.id, { pack: meta.pack });
    return { instance: instances.get(inst.id), warnings };
  } catch (e) {
    instances.remove(inst.id);
    throw e;
  }
}

async function checkModpackUpdate(instId) {
  const p = instances.get(instId).pack;
  const latest = await bestFile(p.projectId);
  if (!latest || latest.id === p.fileId) return { available: false, current: p.version };
  return { available: true, current: p.version, latest: latest.displayName };
}

async function updateModpack(instId, progress) {
  packupdate.recover(instId);
  const inst = instances.get(instId);
  const mod = (await cf(`/mods/${enc(inst.pack.projectId)}`)).data;
  const latest = await bestFile(inst.pack.projectId);
  if (!latest || latest.id === inst.pack.fileId) return { updated: false };
  const tmp = await downloadPack(mod, latest, progress);
  try {
    const pack = readManifest(tmp);
    const res = await applyCfPack(instId, pack, progress, true, () => {
      instances.update(instId, { version: pack.mc, loader: pack.loader });
      instances.touch(instId, { loaderVersion: pack.loaderVersion, pack: { ...inst.pack, fileId: latest.id, version: latest.displayName } });
    });
    return { updated: true, from: inst.pack.version, to: latest.displayName, ...res };
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

module.exports = { search, categories, install, installMod, installModpack, installModpackFile, checkModpackUpdate, updateModpack, bestFile, sha1Of };
