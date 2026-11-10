// Импорт и экспорт сборок: .mrpack (Modrinth), zip CurseForge, папка Prism/MultiMC; копия сборки
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const instances = require('./instances');
const mods = require('./mods');
const versions = require('./versions');
const forge = require('./forge');
const modrinth = require('./modrinth');
const curseforge = require('./curseforge');
const { postJson } = require('./net');

const PACK_KEY = { fabric: 'fabric-loader', quilt: 'quilt-loader', forge: 'forge', neoforge: 'neoforge' };
// Что из папки сборки кладём в экспорт: настройки модов и игры. Миры — нет.
// Моды, ресурспаки и шейдеры обрабатываются отдельно: что есть на Modrinth — уходит ссылкой
const EXPORT_DIRS = ['config', 'defaultconfigs', 'kubejs'];
const LINKABLE = ['mods', 'resourcepacks', 'shaderpacks'];
const EXPORT_FILES = ['options.txt', 'servers.dat'];

const hash = (algo, buf) => crypto.createHash(algo).update(buf).digest('hex');

async function loaderVersion(inst) {
  if (inst.loaderVersion) return inst.loaderVersion;
  if (versions.LOADER_NAMES[inst.loader]) return versions.latestLoader(inst.version, inst.loader);
  if (forge.NAMES[inst.loader]) return forge.latestVersion(inst.loader, inst.version);
  return null;
}

// Экспорт в .mrpack: моды, которые есть на Modrinth, идут ссылками; остальное — файлами внутри архива
async function exportMrpack(instId, outFile, progress = () => {}) {
  const inst = instances.get(instId);
  const gameDir = instances.gameDir(instId);
  progress('Собираю список модов, ресурспаков и шейдеров…', null);
  const zip = new AdmZip();
  const candidates = []; // { rel: 'mods/x.jar', buf }
  for (const folder of LINKABLE) {
    const dir = path.join(gameDir, folder);
    if (!fs.existsSync(dir)) continue;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (folder !== 'mods') zip.addLocalFolder(path.join(dir, e.name), `overrides/${folder}/${e.name}`); // распакованный ресурспак
      } else if (folder === 'mods' ? e.name.endsWith('.jar') : /\.(zip|jar)$/i.test(e.name)) {
        candidates.push({ rel: `${folder}/${e.name}`, buf: fs.readFileSync(path.join(dir, e.name)) });
      }
    }
  }
  const bySha1 = new Map(candidates.map((c) => [hash('sha1', c.buf), c]));
  let known = {};
  if (bySha1.size) {
    try {
      known = await postJson(`${modrinth.API}/version_files`, { hashes: [...bySha1.keys()], algorithm: 'sha1' });
    } catch {}
  }

  const files = [];
  for (const [sha1, { rel, buf }] of bySha1) {
    const f = known[sha1]?.files.find((x) => x.hashes.sha1 === sha1);
    if (f) files.push({ path: rel, hashes: { sha1, sha512: hash('sha512', buf) }, env: { client: 'required', server: rel.startsWith('mods/') ? 'required' : 'unsupported' }, downloads: [f.url], fileSize: buf.length });
    else zip.addFile(`overrides/${rel}`, buf);
  }
  progress('Добавляю настройки…', null);
  for (const d of EXPORT_DIRS) if (fs.existsSync(path.join(gameDir, d))) zip.addLocalFolder(path.join(gameDir, d), `overrides/${d}`);
  for (const f of EXPORT_FILES) if (fs.existsSync(path.join(gameDir, f))) zip.addLocalFile(path.join(gameDir, f), 'overrides');

  const dependencies = { minecraft: inst.version };
  const lv = await loaderVersion(inst);
  if (PACK_KEY[inst.loader] && lv) dependencies[PACK_KEY[inst.loader]] = lv;
  zip.addFile(
    'modrinth.index.json',
    Buffer.from(JSON.stringify({ formatVersion: 1, game: 'minecraft', versionId: '1.0.0', name: inst.name, summary: 'Сборка из Femboy Launcher', files, dependencies }, null, 2))
  );
  progress('Сохраняю архив…', null);
  zip.writeZip(outFile);
  return { file: outFile, linked: files.length, embedded: bySha1.size - files.length };
}

// Импорт: .mrpack / zip CurseForge / zip или папка Prism-MultiMC
async function importPath(p, progress = () => {}) {
  if (fs.statSync(p).isDirectory()) return importPrism(p, progress);
  const zip = new AdmZip(p);
  if (zip.getEntry('modrinth.index.json')) return modrinth.installModpackFile(p, progress);
  if (zip.getEntry('manifest.json')) return curseforge.installModpackFile(p, progress);
  const cfg = zip.getEntries().find((e) => /(^|\/)mmc-pack\.json$/.test(e.entryName));
  if (cfg) {
    const tmp = path.join(require('os').tmpdir(), `femboy-import-${Date.now()}`);
    try {
      zip.extractAllTo(tmp, true);
      return await importPrism(path.join(tmp, path.dirname(cfg.entryName)), progress);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
  throw new Error('Не понимаю этот файл: нужен .mrpack, zip модпака CurseForge или экспорт Prism/MultiMC');
}

// Сборка Prism/MultiMC: версии берём из mmc-pack.json, файлы игры — из .minecraft
const PRISM_LOADERS = { 'net.fabricmc.fabric-loader': 'fabric', 'org.quiltmc.quilt-loader': 'quilt', 'net.minecraftforge': 'forge', 'net.neoforged': 'neoforge' };
async function importPrism(dir, progress) {
  const pack = JSON.parse(fs.readFileSync(path.join(dir, 'mmc-pack.json'), 'utf8'));
  const mc = pack.components.find((c) => c.uid === 'net.minecraft');
  if (!mc) throw new Error('В сборке Prism не указана версия Minecraft');
  const loaderComp = pack.components.find((c) => PRISM_LOADERS[c.uid]);
  let name = path.basename(dir);
  try {
    name = /^name=(.+)$/m.exec(fs.readFileSync(path.join(dir, 'instance.cfg'), 'utf8'))?.[1] || name;
  } catch {}
  const src = ['.minecraft', 'minecraft'].map((d) => path.join(dir, d)).find((d) => fs.existsSync(d));
  const inst = instances.create({ name, version: mc.version, loader: loaderComp ? PRISM_LOADERS[loaderComp.uid] : 'vanilla', loaderVersion: loaderComp?.version || null, icon: '📦' });
  try {
  if (src) {
    progress('Копирую файлы сборки…', null);
    fs.cpSync(src, instances.gameDir(inst.id), { recursive: true, dereference: true });
  }
  return { instance: instances.get(inst.id), warnings: [] };
  } catch (e) {
    instances.remove(inst.id);
    throw e;
  }
}

function duplicate(instId) {
  const inst = instances.get(instId);
  if (fs.existsSync(path.join(instances.dirOf(instId), '.pack-update'))) throw new Error('Сначала заверши или восстанови обновление модпака');
  const copy = instances.create({ ...inst, name: `${inst.name} (копия)`.slice(0, 40) });
  const source = instances.dirOf(instId);
  try {
  fs.cpSync(instances.dirOf(instId), instances.dirOf(copy.id), {
    recursive: true,
    dereference: true,
    filter: (s) => {
      const rel = path.relative(path.toNamespacedPath(source), path.toNamespacedPath(s));
      if (!rel) return true;
      const [first] = rel.split(path.sep);
      return !['instance.json', 'bisect.json', 'backups', '.pack-update'].includes(first);
    },
  });
  return instances.touch(copy.id, { playtime: 0, lastPlayed: null });
  } catch (e) {
    instances.remove(copy.id);
    throw e;
  }
}

module.exports = { exportMrpack, importPath, duplicate };
