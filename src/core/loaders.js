// Версии загрузчиков (Fabric, Quilt, Forge, NeoForge) под версию игры: из них человек выбирает в настройках сборки.
// После первого запуска лаунчер запоминает поставленную версию в сборке, чтобы новый выход загрузчика не ломал моды;
// здесь можно выбрать и более свежую (её требует мод), и более старую (её требует модпак)
const fs = require('fs');
const instances = require('./instances');
const mods = require('./mods');
const modmeta = require('./modmeta');
const forge = require('./forge');
const { getJson } = require('./net');

const NAMES = { fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge' };
const META = { fabric: 'https://meta.fabricmc.net/v2/versions/loader', quilt: 'https://meta.quiltmc.org/v3/versions/loader' };
const MAX = 150; // дальше идут версии пятилетней давности, а список в окне должен остаться удобным
const TTL = 10 * 60 * 1000;

const PRE = { alpha: 0, beta: 1, pre: 2, rc: 3 };
function parse(v) {
  const s = String(v);
  const core = (/^\d+(?:\.\d+)*/.exec(s)?.[0] || '0').split('.').map(Number);
  const pre = /[-.](alpha|beta|pre|rc)(?:[.-]?(\d+))?/i.exec(s);
  const build = /\+build\.(\d+)/.exec(s);
  return { core, pre: pre ? { rank: PRE[pre[1].toLowerCase()], n: +pre[2] || 0 } : null, build: build ? +build[1] : 0 };
}

// Новые раньше старых: 0.16.10 раньше 0.16.9, а релиз раньше своих бета-версий (0.30.0 раньше 0.30.0-beta.8)
function compareDesc(a, b) {
  const A = parse(a);
  const B = parse(b);
  for (let i = 0; i < Math.max(A.core.length, B.core.length); i++) if ((A.core[i] || 0) !== (B.core[i] || 0)) return (B.core[i] || 0) - (A.core[i] || 0);
  if (!A.pre !== !B.pre) return A.pre ? 1 : -1;
  if (A.pre && B.pre && (A.pre.rank !== B.pre.rank || A.pre.n !== B.pre.n)) return B.pre.rank - A.pre.rank || B.pre.n - A.pre.n;
  return B.build - A.build;
}

// Списки с сервера держим в памяти недолго: окно настроек часто открывают подряд, а загрузчик выходит не каждую минуту.
// Сбои не запоминаем
const cache = new Map();
async function cached(key, fn) {
  const c = cache.get(key);
  if (c && Date.now() - c.at < TTL) return c.data;
  const data = await fn();
  cache.set(key, { at: Date.now(), data });
  return data;
}

// Версии загрузчика под игру mc, новые первыми: [{ version, beta, tag }]. tag — «recommended» или «latest» у той, что
// сам загрузчик (или мы) считаем подходящей по умолчанию
async function list(loader, mc) {
  if (!NAMES[loader]) throw new Error('Неизвестный загрузчик ' + loader);
  if (!/^[\w.+-]{1,40}$/.test(String(mc))) throw new Error('Некорректная версия игры');
  const raw = await cached(`${loader}:${mc}`, async () => {
    if (META[loader]) {
      // Fabric на неизвестную игру отвечает пустым списком, Quilt — ошибкой 404: для человека это одно и то же
      const rows = await getJson(`${META[loader]}/${encodeURIComponent(mc)}`).catch((e) => {
        if (e.status === 404) return [];
        throw e;
      });
      if (!rows.length) throw new Error(`${NAMES[loader]} не поддерживает ${mc}`);
      return { versions: rows.map((r) => r.loader.version), recommended: null, latest: null };
    }
    return forge.versionList(loader, mc);
  });
  const sorted = [...new Set(raw.versions)].sort(compareDesc).slice(0, MAX);
  // «Последней» без подсказок загрузчика считаем самую новую не бета-версию
  const latest = raw.latest || sorted.find((v) => !parse(v).pre) || sorted[0];
  return sorted.map((version) => ({ version, beta: !!parse(version).pre, tag: version === raw.recommended ? 'recommended' : version === latest ? 'latest' : '' }));
}

// Моды, которым нужна более свежая версия загрузчика, чем выбрана (из их собственных описаний). Только Fabric и Quilt:
// у Forge и NeoForge условия на загрузчик в описании мода не читаются
function check(instId, loader, version) {
  const id = { fabric: 'fabricloader', quilt: 'quilt_loader' }[loader];
  if (!id || !version || !fs.existsSync(mods.dir(instId))) return [];
  const out = [];
  for (const m of mods.list(instId).filter((x) => x.enabled)) {
    const meta = modmeta.readMeta(mods.filePath(instId, m.file));
    const need = meta?.depends?.get(id);
    if (need !== undefined && !modmeta.matches(version, need, 'fabric')) out.push({ title: m.title || meta.name || m.file, need: [].concat(need).join(' или ') });
  }
  return out;
}

module.exports = { list, check, compareDesc };
