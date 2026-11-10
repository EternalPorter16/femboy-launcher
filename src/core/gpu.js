// Видеокарта для игры. На ноутбуках с двумя видеокартами Windows часто запускает Java на встроенной, и Minecraft тормозит,
// хотя рядом лежит мощная. Выбор хранится в «Параметрах графики» Windows: на каждую программу своя запись в реестре пользователя
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const store = require('./store');

const KEY = 'HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences';
const HIGH = 2; // 0 — решает Windows, 1 — экономия энергии, 2 — высокая производительность
const supported = process.platform === 'win32';

function reg(args) {
  return new Promise((resolve) => execFile('reg.exe', args, { windowsHide: true, timeout: 10000 }, (err, out) => resolve({ ok: !err, out: String(out || '') })));
}

// Значение записи целиком: «GpuPreference=2;» и, бывает, чужие настройки рядом — их сохраняем
async function read(exe) {
  const r = await reg(['query', KEY, '/v', exe]);
  return r.ok ? (r.out.match(/REG_SZ\s+(.*?)\s*$/m)?.[1] ?? '') : null;
}
const prefOf = (value) => {
  const m = /(?:^|;)GpuPreference=(\d)/i.exec(value || '');
  return m ? Number(m[1]) : null;
};
const withPref = (value, pref) => {
  const rest = (value || '').split(';').filter((s) => s && !/^GpuPreference=/i.test(s));
  return rest.length || pref != null ? [...rest, ...(pref != null ? [`GpuPreference=${pref}`] : [])].join(';') + ';' : '';
};
async function write(exe, value) {
  const r = value ? await reg(['add', KEY, '/v', exe, '/t', 'REG_SZ', '/d', value, '/f']) : await reg(['delete', KEY, '/v', exe, '/f']);
  if (!r.ok && value) throw new Error('Windows не дала записать настройку видеокарты');
}

// Java, которые знает лаунчер: свои (скачанные) и те, что указаны вручную и уже запускались
function known() {
  const dir = store.paths().java;
  const own = fs.existsSync(dir)
    ? fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => path.join(dir, e.name, 'bin', 'javaw.exe'))
        .filter((p) => fs.existsSync(p))
    : [];
  return [...new Set([...own, ...Object.keys(store.get().gpuPrev || {})])];
}

// Что видно в «Параметрах графики» сейчас: сколько Java-программ уже на мощной видеокарте
async function state() {
  if (!supported) return { supported, paths: 0, high: 0 };
  const list = known();
  const prefs = await Promise.all(list.map(async (p) => prefOf(await read(p))));
  return { supported, paths: list.length, high: prefs.filter((p) => p === HIGH).length };
}

// Включить или вернуть как было. Прежнее значение запоминаем, чтобы выключение не стёрло то, что человек выставил сам
async function apply(on) {
  if (!supported) return;
  const data = store.get();
  data.gpuPrev = data.gpuPrev || {};
  for (const exe of known()) {
    const cur = await read(exe);
    if (on) {
      if (!(exe in data.gpuPrev)) data.gpuPrev[exe] = cur;
      if (prefOf(cur) !== HIGH) await write(exe, withPref(cur, HIGH));
    } else if (exe in data.gpuPrev) {
      // Возвращаем то, что было до нас; если запись изменили без нас, не трогаем
      if (prefOf(cur) === HIGH) await write(exe, withPref(cur, prefOf(data.gpuPrev[exe])));
      delete data.gpuPrev[exe];
    }
  }
  store.save();
}

// Перед запуском: у этой Java (может быть своей, указанной вручную) должна стоять мощная видеокарта
async function ensure(javaPath) {
  if (!supported || !javaPath) return;
  const exe = path.resolve(javaPath);
  const cur = await read(exe);
  if (prefOf(cur) === HIGH) return;
  const data = store.get();
  data.gpuPrev = data.gpuPrev || {};
  if (!(exe in data.gpuPrev)) data.gpuPrev[exe] = cur;
  store.save();
  await write(exe, withPref(cur, HIGH));
}

module.exports = { state, apply, ensure, read, write, prefOf, withPref, KEY };
