// Список версий Minecraft, проверка клиента и установка Fabric/Quilt
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getJson, download } = require('./net');
const store = require('./store');
const fsx = require('./fsx');
const diskspace = require('./diskspace');

const MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const FABRIC = 'https://meta.fabricmc.net/v2/versions/loader';

// Список версий Mojang лежит ещё и на диске: без интернета лаунчер показывает прошлый список, а не пустое окно.
// В памяти держим час; если связи не было, повторяем попытку через минуту
const MANIFEST_TTL = 60 * 60 * 1000;
const MANIFEST_RETRY = 60 * 1000;
let mem = null; // { data, at, offline }
const jsonCache = new Map();

const manifestFile = () => path.join(store.baseDir(), 'cache', 'version_manifest_v2.json');

function readManifestFile() {
  const file = manifestFile();
  const r = fsx.readJson(file);
  if (!r.ok || !Array.isArray(r.data?.versions) || !r.data.latest) return null;
  try {
    return { data: r.data, at: fs.statSync(file).mtimeMs };
  } catch {
    return null;
  }
}

async function manifest() {
  if (mem && Date.now() - mem.at < (mem.offline ? MANIFEST_RETRY : MANIFEST_TTL)) return mem.data;
  const disk = mem ? { data: mem.data, at: mem.at } : readManifestFile();
  if (!mem && disk && Date.now() - disk.at < MANIFEST_TTL) {
    mem = { data: disk.data, at: disk.at };
    return mem.data;
  }
  try {
    // Есть прошлый список — ждём новый недолго: без связи не заставляем человека сидеть над «Загрузка…»
    const data = await getJson(MANIFEST, null, disk ? { timeoutMs: 5000, attempts: 1 } : undefined);
    mem = { data, at: Date.now() };
    try {
      fsx.writeJsonAtomic(manifestFile(), data, false);
    } catch {}
    return data;
  } catch (e) {
    if (e.cancelled || !disk) throw e;
    mem = { data: disk.data, at: Date.now(), offline: true };
    return disk.data;
  }
}

async function listMinecraft() {
  const m = await manifest();
  return {
    latest: m.latest,
    versions: m.versions.map((v) => ({ id: v.id, type: v.type, releaseTime: v.releaseTime })),
  };
}

async function info(id) {
  const v = (await manifest()).versions.find((x) => x.id === id);
  if (!v) throw new Error(`Версия ${id} не найдена`);
  return v;
}

// Профиль версии, который уже лежит в папке игры: игра запускалась, значит интернет за ним больше не нужен
function localVersionJson(id) {
  const r = fsx.readJson(path.join(store.paths().root, 'versions', id, id + '.json'));
  const j = r.data;
  // Только обычный профиль Mojang: у загрузчиков (inheritsFrom) и недописанных файлов другой вид
  return r.ok && j && j.id === id && !j.inheritsFrom && j.downloads?.client?.url && Array.isArray(j.libraries) ? j : null;
}

// Профиль версии на диске мог оборваться при записи (выключили свет): игра потом падает на его чтении. Битый файл убираем,
// а ensureClientJar кладёт на его место новый. Отвечает, был ли файл битым
function dropBrokenProfile(id) {
  const file = path.join(store.paths().root, 'versions', id, id + '.json');
  if (!fs.existsSync(file) || localVersionJson(id)) return false;
  fs.rmSync(file, { force: true });
  jsonCache.delete(id);
  return true;
}

async function versionJson(id) {
  if (jsonCache.has(id)) return jsonCache.get(id);
  const json = localVersionJson(id) || (await getJson((await info(id)).url));
  jsonCache.set(id, json);
  return json;
}

// Тип и дата выхода версии. Они есть и в профиле на диске, так что при запуске в список версий (то есть в сеть) не ходим
async function versionMeta(id) {
  const local = localVersionJson(id);
  return local?.type && local.releaseTime ? { id, type: local.type, releaseTime: local.releaseTime } : info(id);
}

function sha1File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha1');
    fs.createReadStream(file)
      .on('data', (d) => hash.update(d))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });
}

// Клиент игры мог докачаться не до конца (обрыв сети) — тогда и игра, и установщик Forge падают. Сверяем хэш и перекачиваем
async function ensureClientJar(root, id, onProgress) {
  const { downloads } = await versionJson(id);
  const jar = path.join(root, 'versions', id, id + '.jar');
  // Профиль версии кладём рядом: тогда движок запуска не ходит за ним в сеть
  const jsonFile = path.join(root, 'versions', id, id + '.json');
  if (!fs.existsSync(jsonFile)) fsx.writeJsonAtomic(jsonFile, await versionJson(id), false);
  if (fs.existsSync(jar) && (await sha1File(jar)) === downloads.client.sha1) return false;
  await diskspace.ensure(root, downloads.client.size);
  await download(downloads.client.url, jar, { sha1: downloads.client.sha1, onProgress });
  return true;
}

async function javaInfo(id) {
  const j = await versionJson(id);
  return { major: j.javaVersion?.majorVersion || 8, component: j.javaVersion?.component || 'jre-legacy' };
}

const LOADER_META = { fabric: FABRIC, quilt: 'https://meta.quiltmc.org/v3/versions/loader' };
const LOADER_NAMES = { fabric: 'Fabric', quilt: 'Quilt' };

// Сравнение версий вида 0.16.10 / 0.20.0-beta.9 (по числам, по убыванию)
function compareDesc(a, b) {
  const pa = a.split(/[.+-]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.split(/[.+-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pb[i] || 0) - (pa[i] || 0);
  }
  return 0;
}

// Последняя стабильная версия Fabric/Quilt для версии игры
async function latestLoader(mcVersion, loaderType) {
  const base = LOADER_META[loaderType];
  if (!base) throw new Error('Неизвестный загрузчик ' + loaderType);
  const loaders = await getJson(`${base}/${encodeURIComponent(mcVersion)}`);
  if (!loaders.length) throw new Error(`${LOADER_NAMES[loaderType]} не поддерживает ${mcVersion}`);
  const stable = loaders
    .map((l) => l.loader)
    .filter((l) => l.stable ?? !/beta|pre|rc|alpha/i.test(l.version))
    .sort((a, b) => compareDesc(a.version, b.version));
  return (stable[0] || loaders[0].loader).version;
}

// Имя профиля Fabric/Quilt в versions/: так его называет и сам загрузчик
const loaderId = (loaderType, mcVersion, version) => `${loaderType}-loader-${version}-${mcVersion}`;

// Кладёт профиль Fabric/Quilt в versions/<id>/<id>.json и возвращает { id для version.custom, версия загрузчика }
async function installLoader(root, mcVersion, loaderType, loaderVersion) {
  const base = LOADER_META[loaderType];
  if (!base) throw new Error('Неизвестный загрузчик ' + loaderType);
  const version = loaderVersion || (await latestLoader(mcVersion, loaderType));
  // Профиль уже есть — в сеть не идём (так сборка запускается и без интернета)
  const knownId = loaderId(loaderType, mcVersion, version);
  if (fs.existsSync(path.join(root, 'versions', knownId, knownId + '.json'))) return { id: knownId, version };
  const profile = await getJson(`${base}/${encodeURIComponent(mcVersion)}/${encodeURIComponent(version)}/profile/json`).catch((e) => {
    // Версию выбрали руками (или она из старого модпака), а такой у загрузчика нет: говорим об этом, а не «HTTP 404»
    if (e.status === 404) throw new Error(`${LOADER_NAMES[loaderType]} ${version} для Minecraft ${mcVersion} не найден — выбери другую версию загрузчика в настройках сборки`);
    throw e;
  });
  fsx.writeJsonAtomic(path.join(root, 'versions', profile.id, profile.id + '.json'), profile);
  return { id: profile.id, version };
}

module.exports = { listMinecraft, info, versionMeta, versionJson, javaInfo, installLoader, latestLoader, ensureClientJar, dropBrokenProfile, loaderId, LOADER_NAMES };
