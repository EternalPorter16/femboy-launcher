// Скины оффлайн-аккаунтов: проверка PNG, хранение, загрузка скина по нику (Mojang → Ely.by)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('./store');
const { getJson, netFetch } = require('./net');

// Читаем размер из заголовка PNG (IHDR), чтобы не тащить библиотеку картинок
function pngSize(buf) {
  const sig = '89504e470d0a1a0a';
  if (buf.length < 24 || buf.subarray(0, 8).toString('hex') !== sig || buf.subarray(12, 16).toString() !== 'IHDR') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function validate(buf) {
  const size = pngSize(buf);
  if (!size) throw new Error('Это не PNG-картинка');
  if (size.width !== 64 || (size.height !== 64 && size.height !== 32)) {
    throw new Error(`Скин должен быть 64×64 (или старый 64×32), а этот ${size.width}×${size.height}`);
  }
  if (buf.length > 256 * 1024) throw new Error('Файл скина слишком большой');
}

const fromDataUrl = (dataUrl) => {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl));
  if (!m) throw new Error('Ожидалась PNG-картинка');
  return Buffer.from(m[1], 'base64');
};

const toDataUrl = (buf) => 'data:image/png;base64,' + buf.toString('base64');

function findOffline(accountId) {
  const acc = store.get().accounts.find((a) => a.id === accountId);
  if (!acc) throw new Error('Аккаунт не найден');
  if (acc.type !== 'offline') throw new Error('Скин лицензии меняется на minecraft.net');
  return acc;
}

// Кладёт скин в папку лаунчера и записывает его в аккаунт (у Ely.by он нужен только для аватарки в лаунчере)
function put(acc, dataUrl, model) {
  const buf = fromDataUrl(dataUrl);
  validate(buf);
  const dir = store.paths().skins;
  fs.mkdirSync(dir, { recursive: true });
  const file = `${acc.id}.png`;
  fs.writeFileSync(path.join(dir, file), buf);
  acc.skin = { file, model: model === 'slim' ? 'slim' : 'classic', hash: crypto.createHash('sha256').update(buf).digest('hex') };
  store.save();
}

function save(accountId, dataUrl, model) {
  put(findOffline(accountId), dataUrl, model);
}

// Убирает скин аккаунта любого типа (файл и запись)
function drop(acc) {
  if (acc.skin) fs.rmSync(path.join(store.paths().skins, acc.skin.file), { force: true });
  delete acc.skin;
}

function reset(accountId) {
  drop(findOffline(accountId));
  store.save();
}

function read(acc) {
  if (!acc.skin) return null;
  try {
    return { data: toDataUrl(fs.readFileSync(path.join(store.paths().skins, acc.skin.file))), model: acc.skin.model };
  } catch {
    return null;
  }
}

async function fetchPng(url) {
  // Адреса текстур бывают с http, а скины всегда берём по https (кроме своей машины: так проверяется вход без настоящего сервера)
  const res = await netFetch(url.replace(/^http:\/\/(?!127\.0\.0\.1[:/]|localhost[:/])/, 'https://'), { headers: { 'User-Agent': 'FemboyLauncher/0.2.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  validate(buf);
  return buf;
}

function decodeTextures(profile) {
  const prop = profile.properties?.find((p) => p.name === 'textures');
  return prop ? JSON.parse(Buffer.from(prop.value, 'base64').toString('utf8')).textures : null;
}

// Скин любого игрока по нику: сначала лицензия Mojang, потом Ely.by
async function fromName(name) {
  name = String(name || '').trim();
  if (!/^\w{2,16}$/.test(name)) throw new Error('Ник: 2–16 символов, латиница, цифры и _');
  const errors = [];
  try {
    const { id } = await getJson(`https://api.mojang.com/users/profiles/minecraft/${name}`);
    const skin = decodeTextures(await getJson(`https://sessionserver.mojang.com/session/minecraft/profile/${id}`))?.SKIN;
    if (!skin) throw new Error('у игрока стандартный скин');
    return { data: toDataUrl(await fetchPng(skin.url)), model: skin.metadata?.model === 'slim' ? 'slim' : 'classic', source: 'Mojang' };
  } catch (e) {
    errors.push('Mojang: ' + e.message.replace(/ — https.*/, ''));
  }
  try {
    const t = await getJson(`https://skinsystem.ely.by/textures/${name}`);
    if (!t?.SKIN) throw new Error('нет скина');
    return { data: toDataUrl(await fetchPng(t.SKIN.url)), model: t.SKIN.metadata?.model === 'slim' ? 'slim' : 'classic', source: 'Ely.by' };
  } catch (e) {
    errors.push('Ely.by: ' + e.message.replace(/ — https.*/, ''));
  }
  throw new Error(`Скин «${name}» не найден (${errors.join('; ')})`);
}

// Скин игрока Ely.by (по нику) — для аватарки аккаунта. Нет скина — ошибка, и остаётся стандартный
async function fromEly(name) {
  // Аватарка не стоит долгого ожидания: два коротких захода, и хватит
  const t = await getJson(`${require('./elyby').skinsBase()}/textures/${encodeURIComponent(name)}`, null, { attempts: 2, timeoutMs: 8000 });
  if (!t?.SKIN) throw new Error('у игрока стандартный скин');
  return { data: toDataUrl(await fetchPng(t.SKIN.url)), model: t.SKIN.metadata?.model === 'slim' ? 'slim' : 'classic' };
}

module.exports = { save, reset, read, fromName, fromEly, put, drop };
