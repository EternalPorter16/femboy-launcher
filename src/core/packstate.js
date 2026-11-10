// Какие файлы сборки принадлежат модпаку — чтобы при обновлении удалять только их, а не моды игрока
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const instances = require('./instances');
const { safeJoin } = require('./net');
const fsx = require('./fsx');

// Эти файлы игрок обычно настраивает под себя — при обновлении модпака не перезаписываем, если они уже есть
const KEEP_USER = new Set(['options.txt', 'servers.dat', 'optionsof.txt', 'optionsshaders.txt']);
const normalized = (rel) => path.posix.normalize(rel.replace(/\\/g, '/')).toLowerCase();
// Worlds become player data after initial installation, even if an older pack
// listed them as managed downloads. Updates must neither write nor remove them.
const isWorldPath = (rel) => {
  const name = normalized(rel);
  return name === 'saves' || name.startsWith('saves/');
};

const listFile = (id) => path.join(instances.dirOf(id), 'pack-files.json');

function read(id) {
  try {
    return JSON.parse(fs.readFileSync(listFile(id), 'utf8'));
  } catch {
    return [];
  }
}

function write(id, files) {
  fsx.writeJsonAtomic(listFile(id), [...new Set(files.map((f) => f.replace(/\\/g, '/')))]);
}

// Plan removals without touching the working pack while downloads are staged.
function staleFiles(id, newFiles) {
  const keep = new Set(newFiles.map(normalized));
  const gameDir = instances.gameDir(id);
  const files = [];
  for (const rel of read(id)) {
    if (isWorldPath(rel) || keep.has(normalized(rel))) continue;
    const dest = safeJoin(gameDir, rel);
    if (fs.existsSync(dest)) files.push(rel);
    if (fs.existsSync(dest + '.disabled')) files.push(rel + '.disabled');
  }
  return files;
}

// Убираем файлы прошлой версии модпака, которых нет в новой
function removeStale(id, newFiles) {
  const keep = new Set(newFiles.map((f) => f.replace(/\\/g, '/')));
  const gameDir = instances.gameDir(id);
  let removed = 0;
  for (const rel of read(id)) {
    if (isWorldPath(rel)) continue;
    if (keep.has(rel)) continue;
    try {
      const p = safeJoin(gameDir, rel);
      if (fs.existsSync(p)) (fs.rmSync(p, { force: true }), removed++);
      if (fs.existsSync(p + '.disabled')) fs.rmSync(p + '.disabled', { force: true });
    } catch {}
  }
  return removed;
}

// Файл уже на месте и совпадает по хэшу — качать заново не нужно
function upToDate(file, sha1) {
  try {
    return !!sha1 && crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex') === sha1.toLowerCase();
  } catch {
    return false;
  }
}

// Писать ли файл из overrides: при обновлении не трогаем личные настройки игрока
function shouldWriteOverride(dest, rel, updating) {
  return !(updating && (isWorldPath(rel) || (KEEP_USER.has(normalized(rel)) && fs.existsSync(dest))));
}

module.exports = { read, write, removeStale, staleFiles, upToDate, shouldWriteOverride, isWorldPath };
