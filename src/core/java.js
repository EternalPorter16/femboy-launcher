// Автоматическая загрузка нужной Java. Сначала — сборки Java от Mojang (как в официальном лаунчере и Prism,
// их CDN доступен там же, где и файлы игры), если не вышло — Eclipse Temurin с Adoptium.
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const tar = require('tar');
const store = require('./store');
const { getJson, download, pool } = require('./net');

const OS = { win32: 'windows', darwin: 'mac', linux: 'linux' }[process.platform];
const EXE = process.platform === 'win32' ? 'javaw.exe' : 'java';
const MOJANG_ALL = 'https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json';
const COMPONENT_BY_MAJOR = { 8: 'jre-legacy', 16: 'java-runtime-alpha', 17: 'java-runtime-gamma', 21: 'java-runtime-delta', 25: 'java-runtime-epsilon' };

function mojangPlatform() {
  const arm = process.arch === 'arm64';
  if (process.platform === 'win32') return arm ? 'windows-arm64' : process.arch === 'ia32' ? 'windows-x86' : 'windows-x64';
  if (process.platform === 'darwin') return arm ? 'mac-os-arm64' : 'mac-os';
  return process.arch === 'ia32' ? 'linux-i386' : 'linux';
}

function findJava(dir) {
  if (!fs.existsSync(dir)) return null;
  const stack = [[dir, 0]];
  while (stack.length) {
    const [d, depth] = stack.pop();
    const candidate = path.join(d, 'bin', EXE);
    if (fs.existsSync(candidate)) return candidate;
    if (depth < 3) {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.isDirectory()) stack.push([path.join(d, e.name), depth + 1]);
      }
    }
  }
  return null;
}

const mb = (n) => (n / 1024 / 1024).toFixed(1);

async function fromMojang(component, dir, onProgress) {
  const all = await getJson(MOJANG_ALL);
  const entry = all[mojangPlatform()]?.[component]?.[0];
  if (!entry) throw new Error(`У Mojang нет ${component} для ${mojangPlatform()}`);
  const { files } = await getJson(entry.manifest.url);
  const list = Object.entries(files).filter(([, f]) => f.type === 'file');
  const total = list.reduce((s, [, f]) => s + f.downloads.raw.size, 0);
  // Прогресс считаем по байтам, включая недокачанные файлы — иначе на большом lib/modules кажется, что всё зависло
  let got = 0;
  const partial = new Map();
  const report = () => onProgress?.(got + [...partial.values()].reduce((a, b) => a + b, 0), total);
  await pool(list, 8, async ([rel, f]) => {
    const dest = path.join(dir, rel);
    if (!dest.startsWith(dir + path.sep)) throw new Error('Небезопасный путь в Java: ' + rel);
    await download(f.downloads.raw.url, dest, {
      sha1: f.downloads.raw.sha1,
      onProgress: (bytes) => (partial.set(rel, bytes), report()),
    });
    if (f.executable && OS !== 'windows') fs.chmodSync(dest, 0o755);
    partial.delete(rel);
    got += f.downloads.raw.size;
    report();
  });
  if (OS !== 'windows') {
    for (const [rel, f] of Object.entries(files)) {
      if (f.type === 'link') fs.symlinkSync(f.target, path.join(dir, rel));
    }
  }
}

async function fromAdoptium(major, dir, onProgress) {
  const ext = OS === 'windows' ? '.zip' : '.tar.gz';
  const archive = dir + ext;
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x64';
  const url = (a) => `https://api.adoptium.net/v3/binary/latest/${major}/ga/${OS}/${a}/jre/hotspot/normal/eclipse`;
  try {
    await download(url(arch), archive, { onProgress });
  } catch (e) {
    if (arch === 'x64' || e.cancelled) throw e;
    await download(url('x64'), archive, { onProgress }); // например Java 8 на Apple Silicon
  }
  try {
    if (ext === '.zip') new AdmZip(archive).extractAllTo(dir, true);
    else await tar.x({ file: archive, cwd: dir });
  } finally {
    fs.rmSync(archive, { force: true });
  }
}

async function ensureJava(major, onProgress, component) {
  if (major === 16) [major, component] = [17, undefined]; // 17 подходит для 1.17 и есть везде
  const dir = path.join(store.paths().java, String(major));
  const existing = findJava(dir);
  if (existing) return existing;

  const report = (label) => (got, total) => onProgress?.(got, total, label);
  const tmp = dir + '.part';
  const errors = [];
  for (const [name, install] of [
    ['Mojang', () => fromMojang(component || COMPONENT_BY_MAJOR[major], tmp, report('Mojang'))],
    ['Adoptium', () => fromAdoptium(major, tmp, report('Adoptium'))],
  ]) {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
    try {
      await install();
      const exe = findJava(tmp);
      if (!exe) throw new Error('в архиве нет java');
      if (OS !== 'windows') fs.chmodSync(exe, 0o755);
      fs.rmSync(dir, { recursive: true, force: true });
      fs.renameSync(tmp, dir);
      return findJava(dir);
    } catch (e) {
      if (e.cancelled) {
        try {
          fs.rmSync(tmp, { recursive: true, force: true }); // недокачанную Java не оставляем
        } catch {}
        throw e;
      }
      errors.push(`${name}: ${e.message}`);
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  throw new Error(`Не удалось скачать Java ${major}. ${errors.join('; ')}`);
}

module.exports = { ensureJava, mb };
