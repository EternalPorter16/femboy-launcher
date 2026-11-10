// Файлы, перетащенные в окно лаунчера: моды, ресурспаки, шейдеры, модпаки и сборки Prism.
// Тип определяем по содержимому, а не только по расширению
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const fsx = require('./fsx');
const instances = require('./instances');
const mods = require('./mods');
const modmeta = require('./modmeta');
const packs = require('./packs');

const LOADER_NAMES = { fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge' };

// Какой загрузчик нужен моду — смотрим, какой файл описания лежит внутри jar
function loaderOfJar(file) {
  try {
    const zip = new AdmZip(file);
    if (zip.getEntry('quilt.mod.json')) return 'quilt';
    if (zip.getEntry('fabric.mod.json')) return 'fabric';
    if (zip.getEntry('META-INF/neoforge.mods.toml')) return 'neoforge';
    if (zip.getEntry('META-INF/mods.toml')) return 'forge';
  } catch {}
  return null;
}

function kindOfZip(file) {
  try {
    const names = new AdmZip(file).getEntries().map((e) => e.entryName);
    if (names.includes('modrinth.index.json') || names.includes('manifest.json') || names.some((n) => /(^|\/)mmc-pack\.json$/.test(n))) return 'modpack';
    if (names.some((n) => /^([^/]+\/)?shaders\//.test(n))) return 'shader';
    if (names.some((n) => /^([^/]+\/)?pack\.mcmeta$/.test(n))) return 'resourcepack';
  } catch {}
  return null;
}

function copyInto(instId, kind, src) {
  const dir = mods.dir(instId, kind);
  fs.mkdirSync(dir, { recursive: true });
  const name = path.basename(src);
  fsx.breakLink(path.join(dir, name));
  fs.copyFileSync(src, path.join(dir, name));
  return name;
}

async function handle(instId, files, progress) {
  const done = [];
  const notes = [];
  const warnings = [];
  let imported = null;

  for (const p of files) {
    const name = path.basename(p);
    try {
      const st = fs.statSync(p);
      if (st.isDirectory()) {
        if (!fs.existsSync(path.join(p, 'mmc-pack.json'))) throw new Error('это папка, но не сборка Prism/MultiMC');
        imported = (await packs.importPath(p, progress)).instance;
        done.push(`сборка «${imported.name}»`);
        continue;
      }
      const ext = path.extname(p).toLowerCase();
      if (ext === '.mrpack') {
        imported = (await packs.importPath(p, progress)).instance;
        done.push(`модпак «${imported.name}»`);
        continue;
      }
      if (!instId) throw new Error('сначала создай сборку — файл некуда положить');
      const inst = instances.get(instId);

      if (ext === '.jar') {
        const need = loaderOfJar(p);
        if (!need) throw new Error('это не мод Fabric, Quilt, Forge или NeoForge');
        // Ванильную сборку переводим на загрузчик мода; несовместимый загрузчик — предупреждаем
        if (inst.loader === 'vanilla') {
          instances.update(instId, { loader: need });
          notes.push(`Сборка «${inst.name}» переведена на ${LOADER_NAMES[need]} — этого требует мод ${name}`);
        } else if (need !== inst.loader && !(inst.loader === 'quilt' && need === 'fabric')) {
          warnings.push(`${name} — мод для ${LOADER_NAMES[need]}, а сборка на ${LOADER_NAMES[inst.loader]}: скорее всего, он не загрузится`);
        }
        const file = copyInto(instId, 'mod', p);
        let clash;
        try {
          const title = modmeta.readMeta(path.join(mods.dir(instId), file))?.name || name;
          clash = await require('./modrinth').resolveClash(instId, path.join(mods.dir(instId), file), title);
        } catch (e) {
          fs.rmSync(path.join(mods.dir(instId), file), { force: true });
          throw e;
        }
        notes.push(...clash.notes);
        if (clash.soft.length) warnings.push(`${name} может плохо работать вместе с ${clash.soft.map((n) => `«${n}»`).join(', ')}`);
        const meta = modmeta.readMeta(path.join(mods.dir(instId), file));
        mods.record(instId, file, { title: meta?.name || meta?.id || file, version: meta?.version || '' });
        done.push(`мод ${name}`);
        continue;
      }

      if (ext === '.zip') {
        const kind = kindOfZip(p);
        if (kind === 'modpack') {
          imported = (await packs.importPath(p, progress)).instance;
          done.push(`модпак «${imported.name}»`);
        } else if (kind === 'shader') {
          // Шейдеру нужен Iris — ставим его так же, как при установке из поиска
          const result = { installed: [], warnings: [], notes: [] };
          await require('./modrinth').ensureShaderMod(instId, result);
          notes.push(...result.notes);
          warnings.push(...result.warnings);
          copyInto(instId, 'shader', p);
          done.push(`шейдер ${name}${result.installed.length ? ` (+ ${result.installed.join(', ')})` : ''}`);
        } else if (kind === 'resourcepack') {
          const file = copyInto(instId, 'resourcepack', p);
          const result = { installed: [], warnings: [], notes: [] };
          await require('./modrinth').installPackFeatures(instId, path.join(mods.dir(instId, 'resourcepack'), file), name, result);
          notes.push(...result.notes);
          warnings.push(...result.warnings);
          done.push(`ресурспак ${name}${result.installed.length ? ` (+ ${result.installed.join(', ')})` : ''}`);
        } else {
          throw new Error('не понял, что это за архив — не ресурспак, не шейдер и не модпак');
        }
        continue;
      }
      throw new Error('такие файлы лаунчер не понимает');
    } catch (e) {
      warnings.push(`${name}: ${e.message}`);
    }
  }
  return { done, notes, warnings, imported };
}

module.exports = { handle };
