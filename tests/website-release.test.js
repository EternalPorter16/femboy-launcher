const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const yaml = require('js-yaml');
const { syncRelease } = require('../build/website-release.js');
const REAL = path.join(__dirname, '..');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'website-release-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'dist-release');
  const configPath = path.join(root, 'website/src/config/downloads.json');
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.mkdirSync(path.join(root, 'src/renderer'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/renderer/whatsnew.js'), 'window.CHANGELOG = [{version:"1.0.0",ru:[["✨","Старый выпуск","Описание"]],en:[["✨","Old release","Description"]]},{version:"9.0.0",ru:[["✨","Черновик","Не публиковать"]]}];');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '2.0.0' }));
  const setup = Buffer.from('MZ test setup');
  const portable = Buffer.from('MZ test portable');
  const fileName = 'FemboyLauncher-Setup-2.0.0.exe';
  fs.writeFileSync(path.join(dir, fileName), setup);
  fs.writeFileSync(path.join(dir, 'FemboyLauncher-Portable-2.0.0.exe'), portable);
  const sha512 = createHash('sha512').update(setup).digest('base64');
  const manifest = { version: '2.0.0', path: fileName, sha512, files: [{ url: fileName, size: setup.length, sha512 }], releaseDate: '2026-11-05T12:00:00.000Z', releaseNotes: '- ✨ **Новая возможность** — Подробности\n\n---\n\n- ✨ **New feature** — Details' };
  const config = { release: { version: '1.0.0', date: '2026-01-01', highlights: ['Старый выпуск'] }, storage: { provider: 'yandex', folderUrl: 'https://disk.yandex.ru/d/example', fileUrlTemplate: '' }, files: { setup: { url: '', sizeBytes: 1 }, portable: { url: '', sizeBytes: 1 } }, extra: 'keep' };
  const saveManifest = () => fs.writeFileSync(path.join(dir, 'latest.yml'), yaml.dump(manifest));
  const saveConfig = () => fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  saveManifest(); saveConfig();
  return { root, dir, configPath, setup, portable, manifest, config, saveManifest, saveConfig };
}
test('новый выпуск: версия, дата, SHA-256 обоих файлов, русские заголовки и сохранение хранилища', async (t) => {
  const p = fixture(t);
  const r = await syncRelease(p.root);
  assert.equal(r.config.release.version, '2.0.0');
  assert.equal(r.config.release.date, '2026-11-05');
  assert.deepEqual(r.config.release.highlights, ['Новая возможность']);
  assert.deepEqual(r.config.storage, p.config.storage);
  assert.equal(r.config.extra, 'keep');
  for (const id of ['setup', 'portable']) {
    assert.equal(r.config.files[id].sizeBytes, p[id].length);
    assert.equal(r.config.files[id].sha256, createHash('sha256').update(p[id]).digest('hex'));
    assert.ok(r.config.files[id].fileName.includes('{version}'));
  }
  assert.deepEqual(JSON.parse(fs.readFileSync(p.configPath)), r.config);
  assert.deepEqual(r.history.map((entry) => entry.version), ['2.0.0', '1.0.0']);
  assert.equal(r.history[0].items[0].title, 'Новая возможность');
  assert.equal(r.history[0].itemsEn[0].title, 'New feature');
  assert.equal(r.history[1].itemsEn[0].title, 'Old release');
  assert.equal(r.history[1].date, null, 'дата старого выпуска не выдумывается');
  assert.equal((await syncRelease(p.root)).changed, false, 'повторный запуск не переписывает конфиг');
});
test('тот же выпуск сохраняет отредактированные короткие пункты сайта', async (t) => {
  const p = fixture(t); p.config.release.version = '2.0.0'; p.saveConfig();
  assert.deepEqual((await syncRelease(p.root)).config.release.highlights, ['Старый выпуск']);
});
test('нет заметок нового выпуска: старые пункты не переносятся', async (t) => {
  const p = fixture(t); delete p.manifest.releaseNotes; p.saveManifest();
  assert.deepEqual((await syncRelease(p.root)).config.release.highlights, []);
});
test('история сохраняет прежние выпуски и известные даты, заметки текущего берутся из манифеста', async (t) => {
  const p = fixture(t);
  const file = path.join(p.root, 'website/src/data/releases.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify([
    { version: '1.0.0', date: '2026-01-01', items: [] },
    { version: '0.5.0', date: null, items: [{ icon: '✨', title: 'Давний выпуск', text: 'Сохранённая запись' }] },
  ]));
  const r = await syncRelease(p.root);
  assert.deepEqual(r.history.map((entry) => entry.version), ['2.0.0', '1.0.0', '0.5.0']);
  assert.equal(r.history[0].items[0].title, 'Новая возможность');
  assert.equal(r.history[1].date, '2026-01-01');
  assert.equal(r.history[2].items[0].text, 'Сохранённая запись');
});
test('неверный журнал не меняет конфиг скачивания и не создаёт историю', async (t) => {
  const p = fixture(t);
  fs.writeFileSync(path.join(p.root, 'src/renderer/whatsnew.js'), 'window.CHANGELOG = [{version:"bad"}];');
  const before = fs.readFileSync(p.configPath, 'utf8');
  await assert.rejects(syncRelease(p.root));
  assert.equal(fs.readFileSync(p.configPath, 'utf8'), before);
  assert.equal(fs.existsSync(path.join(p.root, 'website/src/data/releases.json')), false);
});
test('dry-run проверяет реальные хэши, но не меняет конфиг', async (t) => {
  const p = fixture(t); const before = fs.readFileSync(p.configPath, 'utf8');
  const r = await syncRelease(p.root, { dryRun: true });
  assert.equal(r.changed, true);
  assert.equal(fs.readFileSync(p.configPath, 'utf8'), before);
  assert.equal(fs.existsSync(path.join(p.root, 'website/src/data/releases.json')), false);
});
for (const [name, mutate] of Object.entries({
  'неполная сборка': p => fs.unlinkSync(path.join(p.dir, 'FemboyLauncher-Portable-2.0.0.exe')),
  'повреждённый установщик': p => fs.appendFileSync(path.join(p.dir, 'FemboyLauncher-Setup-2.0.0.exe'), 'broken'),
  'пустой Portable': p => fs.writeFileSync(path.join(p.dir, 'FemboyLauncher-Portable-2.0.0.exe'), ''),
  'другая версия в latest.yml': p => { p.manifest.version = '3.0.0'; p.saveManifest(); },
  'неверная дата': p => { p.manifest.releaseDate = 'broken'; p.saveManifest(); },
  'нет SHA-512': p => { delete p.manifest.sha512; p.saveManifest(); },
  'старый прямой адрес': p => { p.config.files.setup.url = 'https://files.example/old.exe'; p.saveConfig(); },
})) test(`ошибка ${name}: исходный конфиг остаётся целиком`, async (t) => {
  const p = fixture(t); mutate(p); const before = fs.readFileSync(p.configPath, 'utf8');
  await assert.rejects(syncRelease(p.root));
  assert.equal(fs.readFileSync(p.configPath, 'utf8'), before);
  assert.deepEqual(fs.readdirSync(path.dirname(p.configPath)), ['downloads.json']);
});

test('release.bat на копии: ошибки тестов/публикации не запускают сайт, ошибка сайта не отменяет выпуск', { skip: process.platform !== 'win32' }, (t) => {
  const p = fixture(t);
  const fakebin = path.join(p.root, 'fakebin');
  fs.mkdirSync(fakebin); fs.mkdirSync(path.join(p.root, 'build'));
  fs.writeFileSync(path.join(p.root, 'website/package.json'), '{}');
  fs.mkdirSync(path.join(p.root, 'node_modules'));
  fs.copyFileSync(path.join(REAL, 'release.bat'), path.join(p.root, 'release.bat'));
  fs.copyFileSync(path.join(REAL, 'build/deploy-website.bat'), path.join(p.root, 'build/deploy-website.bat'));
  for (const [name, text] of Object.entries({
    'firebase.cmd': '@echo off\necho deploy %*>>"%FAKELOG%"\nif not "%CD%"=="%EXPECTED_WEBSITE%" exit /b 7\nexit /b %DEPLOY_FAIL%\n',
    'npm.cmd': '@echo off\necho tests>>"%FAKELOG%"\nexit /b %TEST_FAIL%\n',
    'npx.cmd': '@echo off\necho build>>"%FAKELOG%"\nexit /b 0\n',
  })) fs.writeFileSync(path.join(fakebin, name), text);
  fs.writeFileSync(path.join(p.root, 'build/publish-s3.ps1'), 'param([string]$Out, [switch]$Check)\nif ($Check) { Add-Content -LiteralPath $env:FAKELOG -Value "s3-check"; exit ([int]$env:S3_CHECK_FAIL) }\nAdd-Content -LiteralPath $env:FAKELOG -Value "s3-publish"\nexit ([int]$env:S3_PUBLISH_FAIL)\n');
  fs.writeFileSync(path.join(p.root, 'build/publish-yandex.ps1'), 'param([string]$Out)\nAdd-Content -LiteralPath $env:FAKELOG -Value "publish"\nexit ([int]$env:PUBLISH_FAIL)\n');
  fs.writeFileSync(path.join(p.root, 'build/publish-github.ps1'), 'param([string]$Out)\nAdd-Content -LiteralPath $env:FAKELOG -Value "github"\nexit 0\n');
  fs.writeFileSync(path.join(p.root, 'build/clean-dist.js'), 'process.exit(0);');
  fs.writeFileSync(path.join(p.root, 'build/release-notes.js'), 'process.exit(0);');
  fs.writeFileSync(path.join(p.root, 'build/website-release.js'), 'require("fs").appendFileSync(process.env.FAKELOG,"website\\n");process.exit(Number(process.env.WEBSITE_FAIL));');
  const log = path.join(p.root, 'calls.log');
  for (const [testFail, s3CheckFail, s3PublishFail, publishFail, websiteFail, deployFail, expected, status] of [
    [1, 0, 0, 0, 0, 0, ['tests'], 1],
    [0, 1, 0, 0, 0, 0, ['tests', 's3-check'], 1],
    [0, 0, 1, 0, 0, 0, ['tests', 's3-check', 'build', 's3-publish'], 1],
    [0, 0, 0, 1, 0, 0, ['tests', 's3-check', 'build', 's3-publish', 'publish'], 1],
    [0, 0, 0, 0, 0, 0, ['tests', 's3-check', 'build', 's3-publish', 'publish', 'website', 'deploy deploy --only hosting --project femboy-launcher --non-interactive', 'github'], 0],
    [0, 0, 0, 0, 1, 0, ['tests', 's3-check', 'build', 's3-publish', 'publish', 'website', 'github'], 0],
    [0, 0, 0, 0, 0, 1, ['tests', 's3-check', 'build', 's3-publish', 'publish', 'website', 'deploy deploy --only hosting --project femboy-launcher --non-interactive', 'github'], 0],
  ]) {
    fs.rmSync(log, { force: true });
    const run = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'release.bat'], {
      cwd: p.root, encoding: 'utf8', input: '', timeout: 20000, windowsHide: true,
      env: { ...process.env, PATH: fakebin + path.delimiter + process.env.PATH, GH_TOKEN: '', FAKELOG: log, TEST_FAIL: String(testFail), S3_CHECK_FAIL: String(s3CheckFail), S3_PUBLISH_FAIL: String(s3PublishFail), PUBLISH_FAIL: String(publishFail), WEBSITE_FAIL: String(websiteFail), DEPLOY_FAIL: String(deployFail), EXPECTED_WEBSITE: path.join(p.root, 'website') },
    });
    assert.equal(run.status, status, run.stdout + run.stderr);
    assert.deepEqual(fs.readFileSync(log, 'utf8').trim().split(/\r?\n/), expected);
    if (websiteFail || deployFail) assert.match(run.stdout, /WARNING: Launcher is published, but website update failed/);
  }
});
