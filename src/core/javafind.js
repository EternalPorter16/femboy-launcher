// Поиск установленных Java и проверка, подходит ли выбранная игре. Версию берём из файла release рядом с java
// (так быстро и без запуска), а если его нет, спрашиваем у самой java: java -version
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const store = require('./store');

const WIN = process.platform === 'win32';
const GUI = WIN ? 'javaw.exe' : 'java';
const CON = WIN ? 'java.exe' : 'java';
const VENDORS = ['Java', 'Eclipse Adoptium', 'Eclipse Foundation', 'Microsoft', 'Zulu', 'BellSoft', 'Amazon Corretto', 'Semeru', 'AdoptOpenJDK', 'OpenJDK', 'Temurin', 'GraalVM', 'Liberica'];

// «1.8.0_391» → 8, «17.0.9» → 17, «25-ea» → 25
function majorOf(version) {
  const m = /^(\d+)(?:\.(\d+))?/.exec(String(version || ''));
  if (!m) return null;
  return m[1] === '1' && m[2] ? +m[2] : +m[1];
}

// Файл release в папке Java: JAVA_VERSION="17.0.9", IMPLEMENTOR="Eclipse Adoptium", OS_ARCH="x86_64", IMAGE_TYPE="JDK"
function parseRelease(text) {
  const get = (k) => new RegExp(`^${k}="?([^"\\r\\n]*)"?`, 'm').exec(text)?.[1];
  const version = get('JAVA_VERSION');
  if (!version) return null;
  const arch = get('OS_ARCH') || '';
  return { version, major: majorOf(version), vendor: get('IMPLEMENTOR') || get('IMPLEMENTOR_VERSION') || '', bits: /64|aarch64|arm64/i.test(arch) ? 64 : arch ? 32 : 64, type: /jre/i.test(get('IMAGE_TYPE') || '') && !/jdk/i.test(get('IMAGE_TYPE') || '') ? 'JRE' : 'JDK' };
}

// Вывод java -version (идёт в stderr): openjdk version "21.0.4" ... / OpenJDK 64-Bit Server VM
function parseVersionOutput(text) {
  const version = /version "([^"]+)"/.exec(text)?.[1];
  if (!version) return null;
  // Сначала конкретные сборки (Temurin, Zulu…): слово OpenJDK в начале вывода есть почти у всех
  const vendor = /(Temurin|Zulu|Corretto|Microsoft|Semeru|GraalVM|Liberica)/i.exec(text)?.[1] || /(OpenJDK|Java\(TM\))/i.exec(text)?.[1] || '';
  return { version, major: majorOf(version), vendor, bits: /64-Bit/i.test(text) ? 64 : 32, type: 'JDK' };
}

const exists = (p) => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};

// Папки, внутри которых (на глубину до depth) лежит bin/javaw.exe, то есть домашние папки Java
function scanRoot(root, depth = 2) {
  const out = [];
  const walk = (dir, left) => {
    if (exists(path.join(dir, 'bin', GUI)) || exists(path.join(dir, 'bin', CON))) return out.push(dir);
    if (left <= 0) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) if (e.isDirectory() && e.name !== 'bin' && e.name !== 'lib') walk(path.join(dir, e.name), left - 1);
  };
  walk(root, depth);
  return out;
}

const exeOf = (home) => {
  const gui = path.join(home, 'bin', GUI);
  return exists(gui) ? gui : path.join(home, 'bin', CON);
};

const cache = new Map(); // путь + время изменения → результат

function ask(exe) {
  const con = path.join(path.dirname(exe), CON);
  return new Promise((resolve) => {
    try {
      execFile(exists(con) ? con : exe, ['-version'], { timeout: 6000, windowsHide: true }, (err, stdout, stderr) => resolve(parseVersionOutput(`${stderr}\n${stdout}`)));
    } catch {
      resolve(null); // файл не запускается (не программа): spawn бросает ошибку сразу, а не в колбэк
    }
  });
}

// Что за Java лежит по этому пути: { path, home, version, major, vendor, bits, type } или null, если это не Java
async function probe(exe) {
  if (!exists(exe)) return null;
  const key = `${exe}|${fs.statSync(exe).mtimeMs}`;
  if (cache.has(key)) return cache.get(key);
  const home = path.dirname(path.dirname(exe));
  let info = null;
  try {
    info = parseRelease(fs.readFileSync(path.join(home, 'release'), 'utf8'));
  } catch {}
  if (!info) info = await ask(exe);
  const res = info && info.major ? { path: exe, home, ...info } : null;
  cache.set(key, res);
  return res;
}

// Пользователь мог вписать папку Java или кавычки: приводим к файлу
function normalize(p) {
  let v = String(p || '').trim().replace(/^"(.*)"$/, '$1');
  try {
    if (fs.statSync(v).isDirectory()) v = exeOf(path.basename(v).toLowerCase() === 'bin' ? path.dirname(v) : v);
  } catch {}
  return v;
}

// Все Java, которые нашлись на компьютере, новые первыми. opts нужен тестам: свои папки вместо настоящих
async function find(opts = {}) {
  const env = opts.env || process.env;
  const places = [];
  const add = (root, source, depth) => places.push({ root, source, depth });
  if (opts.roots) opts.roots.forEach((r) => add(r, 'system', 3));
  else {
    add(store.paths().java, 'launcher', 3);
    for (const k of ['JAVA_HOME', 'JDK_HOME', 'JRE_HOME']) if (env[k]) add(env[k], 'JAVA_HOME', 0);
    const pfs = [env.ProgramFiles, env['ProgramFiles(x86)'], env.ProgramW6432].filter(Boolean);
    for (const pf of pfs) for (const v of VENDORS) add(path.join(pf, v), 'system', 2);
    if (env.LOCALAPPDATA) {
      add(path.join(env.LOCALAPPDATA, 'Programs', 'Eclipse Adoptium'), 'system', 2);
      add(path.join(env.LOCALAPPDATA, 'Packages', 'Microsoft.4297127D64EC6_8wekyb3d8bbwe', 'LocalCache', 'Local', 'runtime'), 'Minecraft', 4);
    }
    if (env.APPDATA) add(path.join(env.APPDATA, '.minecraft', 'runtime'), 'Minecraft', 4);
    if (env.USERPROFILE) add(path.join(env.USERPROFILE, '.jdks'), 'system', 2);
    for (const dir of String(env.PATH || env.Path || '').split(path.delimiter)) if (dir && exists(path.join(dir, CON))) add(path.dirname(dir), 'PATH', 0);
  }
  const homes = new Map(); // настоящий путь → источник
  for (const p of places) {
    for (const h of scanRoot(p.root, p.depth)) {
      let real = h;
      try {
        real = fs.realpathSync(h);
      } catch {}
      if (!homes.has(real.toLowerCase())) homes.set(real.toLowerCase(), { home: real, source: p.source });
    }
  }
  const found = await Promise.all([...homes.values()].map(async ({ home, source }) => {
    const info = await probe(exeOf(home));
    return info && { ...info, source };
  }));
  return found.filter(Boolean).sort((a, b) => b.major - a.major || String(b.version).localeCompare(String(a.version), undefined, { numeric: true }));
}

// Подходит ли выбранная Java игре, которой нужна Java requiredMajor. level: ok | warn | bad
async function check(javaPath, requiredMajor) {
  const exe = normalize(javaPath);
  const info = await probe(exe);
  if (!info) return { level: 'bad', message: exists(exe) ? 'Не получилось узнать версию этой Java — похоже, это не Java' : 'Java по этому пути не найдена — выбери другую или оставь поле пустым' };
  const who = `Java ${info.major}${info.vendor ? ` · ${info.vendor}` : ''}`;
  const res = { path: exe, major: info.major, version: info.version, vendor: info.vendor, bits: info.bits };
  if (requiredMajor && info.major < requiredMajor) return { ...res, level: 'bad', message: `Игре нужна Java ${requiredMajor} или новее, а здесь Java ${info.major}: игра не запустится` };
  if (info.bits === 32) return { ...res, level: 'warn', message: `${who}: 32-битная Java не даст выделить игре больше 1,5 ГБ памяти` };
  if (requiredMajor && info.major > requiredMajor) return { ...res, level: 'warn', message: `${who}: игра рассчитана на Java ${requiredMajor}, с модами (особенно с Forge) на более новой может не запускаться. Надёжнее оставить «Авто»` };
  return { ...res, level: 'ok', message: requiredMajor ? `${who}: подходит игре ✓` : who };
}

module.exports = { find, probe, check, normalize, majorOf, parseRelease, parseVersionOutput, scanRoot };
