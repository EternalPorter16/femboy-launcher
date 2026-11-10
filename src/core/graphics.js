// Графика игры одной кнопкой: правим options.txt сборки. Меняем только настройки, которые уже есть в файле, а прежние значения
// запоминаем рядом — «вернуть как было» возвращает именно их, остальное (клавиши, язык, звук) не трогается
const fs = require('fs');
const path = require('path');
const instances = require('./instances');

const FILE = 'options.txt';
const BACKUP = 'options.txt.femboy-original';

// Профили: что подкрутить. fancy — «красивая графика»: в разных версиях это fancyGraphics:true/false или graphicsMode:0/1/2
const PROFILES = {
  eco: { renderDistance: 8, simulationDistance: 6, entityDistanceScaling: 0.75, maxFps: 60, enableVsync: true, particles: 1, mipmapLevels: 2, biomeBlendRadius: 1, fancy: 0 },
  mid: { renderDistance: 12, simulationDistance: 8, entityDistanceScaling: 1, maxFps: 120, enableVsync: false, particles: 0, mipmapLevels: 4, biomeBlendRadius: 3, fancy: 1 },
  max: { renderDistance: 20, simulationDistance: 12, entityDistanceScaling: 1.5, maxFps: 260, enableVsync: false, particles: 0, mipmapLevels: 4, biomeBlendRadius: 5, fancy: 2 },
};
const SHOWN = ['renderDistance', 'simulationDistance', 'entityDistanceScaling', 'maxFps', 'enableVsync', 'particles', 'mipmapLevels', 'biomeBlendRadius', 'fancyGraphics', 'graphicsMode'];

const fileOf = (id) => path.join(instances.gameDir(id), FILE);

function parse(text) {
  const map = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^([^:]+):(.*)$/.exec(line);
    if (m) map[m[1]] = m[2];
  }
  return map;
}

// Меняет значения только у ключей, которые уже есть в тексте (значения могут содержать «:» — режем по первому)
function setKeys(text, entries) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  return text
    .split(/\r?\n/)
    .map((line) => {
      const m = /^([^:]+):/.exec(line);
      return m && Object.hasOwn(entries, m[1]) ? `${m[1]}:${entries[m[1]]}` : line;
    })
    .join(eol);
}

// Что записать в файл для профиля — только для ключей, которые там есть
function entriesFor(name, map) {
  const p = PROFILES[name];
  const e = {};
  for (const k of ['renderDistance', 'simulationDistance', 'maxFps', 'particles', 'mipmapLevels', 'biomeBlendRadius']) if (k in map) e[k] = String(p[k]);
  if ('entityDistanceScaling' in map) e.entityDistanceScaling = Number.isInteger(p.entityDistanceScaling) ? p.entityDistanceScaling.toFixed(1) : String(p.entityDistanceScaling);
  if ('enableVsync' in map) e.enableVsync = String(p.enableVsync);
  if ('fancyGraphics' in map) e.fancyGraphics = String(p.fancy > 0);
  // 0 — быстрая, 1 — красивая, 2 — «сказочная» (она самая тяжёлая: на «Красивой» её оставляем, на других — нет)
  if ('graphicsMode' in map) e.graphicsMode = String(Math.min(p.fancy, name === 'max' && map.graphicsMode === '2' ? 2 : 1));
  return e;
}

function read(id) {
  try {
    return fs.readFileSync(fileOf(id), 'utf8');
  } catch {
    return null;
  }
}

// Что сейчас в файле и на какой профиль это похоже
function state(id) {
  const text = read(id);
  if (text == null) return { exists: false, backup: false, current: {}, profile: null };
  const map = parse(text);
  const current = {};
  for (const k of SHOWN) if (k in map) current[k] = map[k];
  const same = (name) => {
    const e = entriesFor(name, map);
    const keys = Object.keys(e);
    return keys.length > 0 && keys.every((k) => (isNaN(+e[k]) ? e[k] === map[k] : +e[k] === +map[k]));
  };
  return { exists: true, backup: fs.existsSync(path.join(instances.gameDir(id), BACKUP)), current, profile: Object.keys(PROFILES).find(same) || null };
}

function write(file, text) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

function apply(id, name) {
  if (!PROFILES[name]) throw new Error('Не знаю такого набора настроек');
  const text = read(id);
  if (text == null) throw new Error('Настроек игры ещё нет — запусти сборку один раз, закрой её и возвращайся ♡');
  const backup = path.join(instances.gameDir(id), BACKUP);
  if (!fs.existsSync(backup)) fs.copyFileSync(fileOf(id), backup);
  write(fileOf(id), setKeys(text, entriesFor(name, parse(text))));
  return state(id);
}

// Возвращаем значения из копии, но только те, что мы правили; всё, что человек поменял после, остаётся
function restore(id) {
  const backup = path.join(instances.gameDir(id), BACKUP);
  if (!fs.existsSync(backup)) throw new Error('Нечего возвращать — настройки этой сборки лаунчер не менял');
  const was = parse(fs.readFileSync(backup, 'utf8'));
  const text = read(id);
  if (text != null) {
    const ours = new Set(SHOWN);
    const back = {};
    for (const k of Object.keys(was)) if (ours.has(k)) back[k] = was[k];
    write(fileOf(id), setKeys(text, back));
  }
  fs.rmSync(backup, { force: true });
  return state(id);
}

module.exports = { state, apply, restore, parse, setKeys, entriesFor, PROFILES };
