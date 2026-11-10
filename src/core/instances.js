// Сборки (instances): у каждой своя папка игры — свои миры, моды, настройки
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('./store');
const fsx = require('./fsx');

const dirOf = (id) => path.join(store.paths().instances, id);
const fileOf = (id) => path.join(dirOf(id), 'instance.json');

function list() {
  const root = store.paths().instances;
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => fsx.readJson(fileOf(e.name)).data) // занятый на миг файл читается со второй попытки, а не пропадает из списка
    .filter(Boolean);
}

function get(id) {
  if (!/^[\w-]+$/.test(id)) throw new Error('Некорректный id сборки');
  const r = fsx.readJson(fileOf(id));
  if (!r.ok) throw new Error('Сборка не найдена');
  return r.data;
}

// Пишем «целиком или никак»: сбой посреди записи не оставит сборку с обрезанным instance.json
function write(inst) {
  fsx.writeJsonAtomic(fileOf(inst.id), inst);
  return inst;
}

function clean(data) {
  const out = {};
  if (data.name !== undefined) out.name = String(data.name).trim().slice(0, 40) || 'Сборка';
  if (data.version !== undefined) out.version = String(data.version);
  if (data.loader !== undefined) out.loader = ['fabric', 'quilt', 'forge', 'neoforge'].includes(data.loader) ? data.loader : 'vanilla';
  if (data.loaderVersion !== undefined) out.loaderVersion = /^[\w.+-]{1,40}$/.test(data.loaderVersion || '') ? data.loaderVersion : null;
  if (data.icon !== undefined) out.icon = String(data.icon).slice(0, 8);
  if (data.iconUrl !== undefined) out.iconUrl = /^https:\/\/(cdn\.modrinth\.com|media\.forgecdn\.net)\//.test(data.iconUrl || '') ? data.iconUrl : null;
  if (data.color !== undefined) out.color = /^#[0-9a-f]{6}$/i.test(data.color) ? data.color : '#ffd1e8';
  if (data.maxRam !== undefined) out.maxRam = Number(data.maxRam) >= 512 ? Math.floor(Number(data.maxRam)) : null;
  if (data.follow !== undefined) out.follow = data.follow && Number.isFinite(data.follow.at) && Number.isInteger(data.follow.mods) && data.follow.mods >= 0 ? { at: Math.floor(data.follow.at), mods: data.follow.mods } : null;
  if (data.group !== undefined) out.group = String(data.group || '').trim().slice(0, 30);
  if (data.javaPath !== undefined) out.javaPath = String(data.javaPath || '').trim().slice(0, 500);
  if (data.jvmArgs !== undefined) out.jvmArgs = String(data.jvmArgs || '').trim().slice(0, 1000);
  if (data.window !== undefined) {
    const w = data.window || {};
    const num = (v) => (Number(v) >= 320 && Number(v) <= 8192 ? Math.floor(Number(v)) : null);
    out.window = { width: num(w.width), height: num(w.height), fullscreen: !!w.fullscreen };
  }
  if (data.servers !== undefined) {
    out.servers = (Array.isArray(data.servers) ? data.servers : [])
      .filter((s) => s && /^[\w.-]+(:\d{1,5})?$/.test(String(s.address || '').trim()))
      .slice(0, 50)
      .map((s) => ({ name: String(s.name || s.address).slice(0, 40), address: String(s.address).trim() }));
  }
  return out;
}

function create(data) {
  const fields = clean(data);
  if (!fields.version) throw new Error('Выбери версию');
  const slug = (fields.name || 'instance').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20);
  const id = `${slug || 'instance'}-${crypto.randomBytes(3).toString('hex')}`;
  return write({ id, name: 'Сборка', loader: 'vanilla', icon: '🌸', color: '#ffd1e8', maxRam: null, ...fields, createdAt: Date.now(), lastPlayed: null, playtime: 0 });
}

function update(id, data) {
  const cur = get(id);
  const next = { ...cur, ...clean(data), id };
  // Версия загрузчика подходит только к своей версии игры и своему загрузчику: при смене сбрасываем её, если не передали новую
  if ((next.version !== cur.version || next.loader !== cur.loader) && data.loaderVersion === undefined) next.loaderVersion = null;
  return write(next);
}

function touch(id, patch) {
  return write({ ...get(id), ...patch, id });
}

function remove(id) {
  get(id);
  // Сначала снимаем ссылки на папки других лаунчеров (перенос «на месте») — их данные не наши
  require('./otherlaunchers').unlinkShared(dirOf(id));
  fs.rmSync(dirOf(id), { recursive: true, force: true });
}

const gameDir = (id) => {
  get(id);
  return path.join(dirOf(id), '.minecraft');
};

module.exports = { list, get, create, update, touch, remove, gameDir, dirOf };
