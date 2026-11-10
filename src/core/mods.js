// Установленные файлы сборки: моды (с включением/выключением и метаданными), ресурспаки и шейдеры
const fs = require('fs');
const path = require('path');
const instances = require('./instances');
const fsx = require('./fsx');

const FOLDERS = { mod: 'mods', resourcepack: 'resourcepacks', shader: 'shaderpacks' };

const dir = (id, kind = 'mod') => path.join(instances.gameDir(id), FOLDERS[kind] || 'mods');
const metaFile = (id) => path.join(instances.dirOf(id), 'mods-meta.json');

function readMeta(id) {
  const r = fsx.readJson(metaFile(id));
  return r.ok && r.data && typeof r.data === 'object' ? r.data : {};
}

function writeMeta(id, meta) {
  fsx.writeJsonAtomic(metaFile(id), meta);
}

function checkName(file, kind = 'mod') {
  const ok = kind === 'mod' ? String(file ?? '').endsWith('.jar') : true;
  if (!file || path.basename(file) !== file || file.startsWith('.') || !ok) throw new Error('Некорректное имя файла');
}

function list(id, kind = 'mod') {
  const d = dir(id, kind);
  fs.mkdirSync(d, { recursive: true });
  const meta = readMeta(id);
  if (kind !== 'mod') {
    // ресурспаки и шейдеры бывают и архивами, и папками
    return fs
      .readdirSync(d, { withFileTypes: true })
      .filter((e) => e.isDirectory() || /\.(zip|jar)$/i.test(e.name))
      .map((e) => ({ file: e.name, enabled: true, size: e.isDirectory() ? 0 : fs.statSync(path.join(d, e.name)).size, folder: e.isDirectory(), ...meta[`${kind}:${e.name}`] }))
      .sort((a, b) => (a.title || a.file).localeCompare(b.title || b.file));
  }
  return fs
    .readdirSync(d)
    .filter((f) => f.endsWith('.jar') || f.endsWith('.jar.disabled'))
    .map((f) => {
      const file = f.replace(/\.disabled$/, '');
      return { file, enabled: !f.endsWith('.disabled'), size: fs.statSync(path.join(d, f)).size, ...meta[file] };
    })
    .sort((a, b) => (a.title || a.file).localeCompare(b.title || b.file));
}

// Путь к файлу мода на диске (учитывая выключенные .disabled)
function filePath(id, file) {
  const on = path.join(dir(id), file);
  return fs.existsSync(on) ? on : on + '.disabled';
}

function setEnabled(id, file, enabled) {
  checkName(file);
  const on = path.join(dir(id), file);
  const off = on + '.disabled';
  if (enabled && fs.existsSync(off)) fs.renameSync(off, on);
  if (!enabled && fs.existsSync(on)) fs.renameSync(on, off);
}

// Закреплённый мод «Обновить моды» пропускает: человеку нужна именно эта версия (с новой сборка ломается или нужна другая).
// Отметка лежит в сведениях о моде (mods-meta.json), поэтому уходит вместе с ним при удалении
function setPinned(id, file, pinned) {
  checkName(file);
  const on = path.join(dir(id), file);
  if (!fs.existsSync(on) && !fs.existsSync(on + '.disabled')) throw new Error('Мод не найден');
  const meta = readMeta(id);
  if (pinned) meta[file] = { ...meta[file], pinned: true };
  else if (meta[file]) {
    delete meta[file].pinned;
    if (!Object.keys(meta[file]).length) delete meta[file];
  }
  writeMeta(id, meta);
}

function remove(id, file, kind = 'mod') {
  checkName(file, kind);
  const target = path.join(dir(id, kind), file);
  fs.rmSync(target, { recursive: true, force: true });
  if (kind === 'mod') fs.rmSync(target + '.disabled', { force: true });
  const meta = readMeta(id);
  delete meta[kind === 'mod' ? file : `${kind}:${file}`];
  writeMeta(id, meta);
}

function record(id, file, info, kind = 'mod') {
  const meta = readMeta(id);
  meta[kind === 'mod' ? file : `${kind}:${file}`] = info;
  writeMeta(id, meta);
}

// Проект уже стоит? Тогда не качаем повторно (например, Fabric API как зависимость)
function hasProject(id, source, projectId, kind = 'mod') {
  const meta = readMeta(id);
  return Object.entries(meta).some(([key, m]) => {
    if (m.source !== source || String(m.projectId) !== String(projectId)) return false;
    const isKind = kind === 'mod' ? !key.includes(':') : key.startsWith(kind + ':');
    if (!isKind) return false;
    const file = kind === 'mod' ? key : key.slice(kind.length + 1);
    const p = path.join(dir(id, kind), file);
    return fs.existsSync(p) || fs.existsSync(p + '.disabled');
  });
}

module.exports = { dir, list, filePath, setEnabled, setPinned, remove, record, readMeta, hasProject, FOLDERS };
