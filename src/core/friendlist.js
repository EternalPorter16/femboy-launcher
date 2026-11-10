// Белый список для друзей без лицензии. У игрока без лицензии UUID считается от ника с учётом регистра букв
// (UUID.nameUUIDFromBytes("OfflinePlayer:" + ник)), а команда /whitelist add считает его от ника в нижнем регистре.
// Поэтому друг с заглавными буквами в нике не проходил: «Вас нет в белом списке», хотя игра отвечала «ник добавлен».
// Здесь список пишется файлом whitelist.json в папке сборки; мод LAN World Plug-n-Play подхватывает его, когда мир открывают по сети.
const fs = require('fs');
const path = require('path');
const fsx = require('./fsx');
const net = require('./net');
const { offlineUUID } = require('./accounts');

const NAME_RE = /^[A-Za-z0-9_]{3,16}$/;
const dashed = (id) => String(id).replace(/-/g, '').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5').toLowerCase();

// Лицензионный аккаунт с таким ником: { uuid, name }; null — такого нет. Нет связи — исключение
async function premiumProfile(nick, getJson = net.getJson) {
  try {
    const r = await getJson(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(nick)}`, undefined, { timeoutMs: 8000, attempts: 1 }); // первый запрос после старта сети бывает долгим
    return r?.id && r?.name ? { uuid: dashed(r.id), name: r.name } : null;
  } catch (e) {
    if (e.status === 404 || e instanceof SyntaxError) return null; // «нет такого ника»; пустой ответ 204 разбирается как SyntaxError
    throw e;
  }
}

const UUID_RE = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

// Друзья приходят просто никами или записями из списка друзей: { nick, offline, uuid }. У записи «без лицензии» (offline: true)
// настоящего UUID быть не может, а сохранённый UUID друга с лицензией (uuid) избавляет от запроса к Mojang
function normalize(entries) {
  const seen = new Set();
  const out = [];
  for (const e of Array.isArray(entries) ? entries : []) {
    const rec = typeof e === 'string' ? { nick: e } : e && typeof e === 'object' ? e : null;
    const name = String(rec?.nick ?? rec?.name ?? '').trim();
    if (!rec || !NAME_RE.test(name) || seen.has(name)) continue;
    seen.add(name);
    out.push({ name, offline: rec.offline === true ? true : rec.offline === false ? false : undefined, uuid: UUID_RE.test(String(rec.uuid || '')) ? dashed(rec.uuid) : null });
  }
  return out;
}

// Записывает друзей в <папка сборки>/whitelist.json. Каждому — UUID от ника как есть. Другу с лицензией — ещё и настоящий UUID:
// сохранённый в записи или, если попросили (lookup), узнанный у Mojang по нику. Другу «без лицензии» настоящий UUID не пишется:
// иначе в мир зашёл бы посторонний, у кого такой ник занят лицензионным аккаунтом. Чужие записи остаются, убирается только та, что
// оставляет команда игры (UUID от ника в нижнем регистре). Возвращает, что изменилось
async function sync(gameDir, entries, { lookup = false, getJson } = {}) {
  const items = normalize(entries);
  const names = items.map((i) => i.name);
  const out = { added: [], removed: [], premium: [], unchecked: [] };
  if (!names.length) return out;
  const wanted = items.map((i) => ({ uuid: offlineUUID(i.name), name: i.name }));
  const asking = [];
  for (const i of items) {
    if (i.offline === true) continue;
    if (i.uuid) {
      wanted.push({ uuid: i.uuid, name: i.name });
      out.premium.push(i.name);
    } else if (lookup) asking.push(i.name);
  }
  await Promise.all(
    asking.map(async (n) => {
      try {
        const p = await premiumProfile(n, getJson);
        if (p) {
          wanted.push(p);
          out.premium.push(n);
        }
      } catch {
        out.unchecked.push(n);
      }
    })
  );
  const file = path.join(gameDir, 'whitelist.json');
  const read = fsx.readJson(file);
  if (read.exists && !read.ok) fs.copyFileSync(file, `${file}.broken`); // файл не читается: старое оставляем рядом, а не теряем
  const list = read.ok && Array.isArray(read.data) ? read.data.filter((e) => e && typeof e === 'object') : [];
  const uuidOf = (e) => String(e.uuid || '').toLowerCase();
  const keep = new Set(wanted.map((w) => w.uuid));
  const stale = new Set(names.filter((n) => n !== n.toLowerCase()).map((n) => offlineUUID(n.toLowerCase())));
  const next = list.filter((e) => {
    const drop = stale.has(uuidOf(e)) && !keep.has(uuidOf(e));
    if (drop) out.removed.push(e.name);
    return !drop;
  });
  const have = new Set(next.map(uuidOf));
  for (const w of wanted) {
    if (have.has(w.uuid)) continue;
    next.push(w);
    have.add(w.uuid);
    out.added.push(w.name);
  }
  if (out.added.length || out.removed.length) fsx.writeJsonAtomic(file, next);
  return out;
}

const entryName = (e) => (e && typeof e === 'object' ? e.name || e.uuid || null : null);

// Что сейчас в whitelist.json: ники по порядку (у записи без ника — её UUID). Нет файла или он испорчен — пусто
function names(gameDir) {
  const r = fsx.readJson(path.join(gameDir, 'whitelist.json'));
  return r.ok && Array.isArray(r.data) ? r.data.map(entryName).filter(Boolean) : [];
}

// Белый список живёт один мир: когда мир закрыт (и когда закрыта игра), файл очищается, чтобы друзья не заходили в каждый следующий
// мир сами. Прежний непустой список остаётся рядом, в whitelist.json.bak (только последний). Возвращает, сколько записей убрано и чьи
function clear(gameDir) {
  const file = path.join(gameDir, 'whitelist.json');
  const read = fsx.readJson(file);
  if (!read.exists) return { cleared: 0, names: [] };
  if (!read.ok || !Array.isArray(read.data)) {
    fs.copyFileSync(file, `${file}.broken`); // файл не читается: старое оставляем рядом, а не теряем
    fsx.writeJsonAtomic(file, []);
    return { cleared: 0, names: [] };
  }
  if (!read.data.length) return { cleared: 0, names: [] };
  try {
    fs.copyFileSync(file, `${file}.bak`);
  } catch {} // копия — подстраховка: очистке она не мешает
  fsx.writeJsonAtomic(file, []);
  return { cleared: read.data.length, names: [...new Set(read.data.map(entryName).filter(Boolean))] }; // у друга с лицензией две записи под одним ником
}

module.exports = { sync, premiumProfile, names, clear, NAME_RE };
