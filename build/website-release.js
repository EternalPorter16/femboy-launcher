// После успешной публикации лаунчера обновляет downloads.json и собирает сайт.
// Ничего не выкладывает в Firebase и не меняет установщики.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const yaml = require('js-yaml'); // Установлен вместе с инструментами сборки лаунчера.
const notes = require('../src/renderer/updatenotes.js');
const { buildHistory } = require('./website-history.js');

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temp, text, { flag: 'wx' });
    fs.renameSync(temp, file);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

async function digest(file) {
  if (!fs.lstatSync(file).isFile()) throw new Error(`Not a regular file: ${path.basename(file)}`);
  const sha256 = createHash('sha256');
  const sha512 = createHash('sha512');
  let size = 0;
  for await (const chunk of fs.createReadStream(file)) {
    size += chunk.length;
    sha256.update(chunk);
    sha512.update(chunk);
  }
  if (!size) throw new Error(`Empty installer: ${path.basename(file)}`);
  return { sizeBytes: size, sha256: sha256.digest('hex'), sha512: sha512.digest('base64') };
}

async function syncRelease(root, { outDir = 'dist-release', dryRun = false } = {}) {
  const dir = path.resolve(root, outDir);
  const manifest = yaml.load(fs.readFileSync(path.join(dir, 'latest.yml'), 'utf8'));
  const { version: packageVersion } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const version = manifest?.version;
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version) || version !== packageVersion) {
    throw new Error('Release version does not match package.json');
  }
  const date = new Date(manifest.releaseDate);
  if (!manifest.releaseDate || !Number.isFinite(date.getTime())) throw new Error('Missing or invalid releaseDate');
  const configPath = path.join(root, 'website', 'src', 'config', 'downloads.json');
  const original = fs.readFileSync(configPath, 'utf8');
  const config = JSON.parse(original);
  if (!config.files?.setup || !config.files?.portable) throw new Error('Missing website download options');
  const changedVersion = config.release?.version !== version;
  const files = {};
  for (const id of ['setup', 'portable']) {
    const fileName = `FemboyLauncher-${id === 'setup' ? 'Setup' : 'Portable'}-${version}.exe`;
    const hash = await digest(path.join(dir, fileName));
    if (id === 'setup') {
      const entry = manifest.files?.find((f) => f.url === fileName);
      if (!entry || entry.size !== hash.sizeBytes || entry.sha512 !== hash.sha512 ||
          manifest.path !== fileName || manifest.sha512 !== hash.sha512) {
        throw new Error('Setup installer does not match latest.yml');
      }
    }
    if (changedVersion && config.files[id].url) {
      throw new Error('Fixed website file URLs need review for a new version; use Yandex or a URL template');
    }
    files[id] = { ...config.files[id], fileName: `FemboyLauncher-${id === 'setup' ? 'Setup' : 'Portable'}-{version}.exe`, sizeBytes: hash.sizeBytes, sha256: hash.sha256 };
  }
  const highlights = !changedVersion && Array.isArray(config.release.highlights)
    ? config.release.highlights
    : notes.parse(manifest.releaseNotes, 'ru').map((item) => item[1]);
  const next = {
    ...config,
    release: { ...config.release, version, date: date.toISOString().slice(0, 10), highlights },
    files: { ...config.files, ...files },
  };
  const text = `${JSON.stringify(next, null, 2)}\n`;
  const historyPath = path.join(root, 'website/src/data/releases.json');
  const history = buildHistory(root, { version, date: next.release.date, releaseNotes: manifest.releaseNotes });
  const historyText = `${JSON.stringify(history, null, 2)}\n`;
  const oldHistory = fs.existsSync(historyPath) ? fs.readFileSync(historyPath, 'utf8').replace(/\r\n/g, '\n') : '';
  const configChanged = text !== original.replace(/\r\n/g, '\n');
  const historyChanged = historyText !== oldHistory;
  const changed = configChanged || historyChanged;
  if (!dryRun) {
    if (historyChanged) writeAtomic(historyPath, historyText);
    if (configChanged) writeAtomic(configPath, text);
  }
  return { version, changed, config: next, history, dryRun };
}

if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    if (args.some((a) => a.startsWith('--') && !['--dry-run', '--build'].includes(a))) throw new Error('Unknown option');
    const dryRun = args.includes('--dry-run');
    if (dryRun && args.includes('--build')) throw new Error('--dry-run cannot be combined with --build');
    const root = path.join(__dirname, '..');
    const result = await syncRelease(root, { outDir: args.find((a) => !a.startsWith('--')) || 'dist-release', dryRun });
    console.log(`Website release ${result.version}: ${dryRun ? 'checked without writing' : result.changed ? 'release data updated' : 'release data already current'}.`);
    if (!dryRun && args.includes('--build')) {
      const win = process.platform === 'win32';
      const run = spawnSync(win ? (process.env.ComSpec || 'cmd.exe') : 'npm', win ? ['/d', '/c', 'npm run build'] : ['run', 'build'], {
        cwd: path.join(root, 'website'), stdio: 'inherit', env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1' },
      });
      if (run.error || run.status !== 0) throw new Error('Website build failed; do not deploy the old dist folder');
      console.log('Website build is ready. release.bat deploys it automatically; standalone retry: build\\deploy-website.bat');
    }
  })().catch((e) => { console.error(`Website preparation failed: ${e.message}`); process.exitCode = 1; });
}

module.exports = { syncRelease };
