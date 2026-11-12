// Реквизиты хостинга сайта (адрес FTP-сервера, технический адрес, логин) — только в локальном build/website-hosting.local.json вне git.
// В отслеживаемых файлах их нет; без локального файла публикация останавливается понятной ошибкой до любых сетевых действий
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const BUILD = path.join(__dirname, '..', 'build');
const read = (name) => fs.readFileSync(path.join(BUILD, name), 'utf8');

test('отслеживаемые файлы публикации не содержат адреса сервера, технического адреса и логина', () => {
  const hosting = JSON.parse(read('website-hosting.json'));
  assert.equal(hosting.activeProvider, 'spaceweb');
  const keys = JSON.stringify(Object.keys(hosting.spaceweb).sort());
  for (const k of ['host', 'previewUrl', 'login', 'user', 'username', 'password']) assert.ok(!Object.hasOwn(hosting.spaceweb, k), `${k} в website-hosting.json: ${keys}`);
  assert.equal(hosting.spaceweb.localConfig, 'build/website-hosting.local.json');
  const publisher = read('publish-spaceweb.js');
  assert.doesNotMatch(publisher, /^const (HOST|PREVIEW) = '/m, 'адрес сервера не зашит в издатель');
  assert.doesNotMatch(publisher, /swtest|temp\[\.\]|\b\d{1,3}(?:\.\d{1,3}){3}\b/, 'ни технического домена (в том числе в правилах .htaccess), ни IP');
  assert.doesNotMatch(read('setup-spaceweb-key.ps1'), /-UserName '[^']+'/, 'логин не подставлен в отслеживаемый скрипт');
  assert.match(fs.readFileSync(path.join(__dirname, '..', '.gitignore'), 'utf8'), /^build\/website-hosting\.local\.json$/m);
});

test('безопасный пример: рабочих значений нет, публикация с ним не начинается', () => {
  const { hostingConfig } = require('../build/publish-spaceweb');
  const example = path.join(BUILD, 'website-hosting.local.example.json');
  const ex = JSON.parse(fs.readFileSync(example, 'utf8'));
  assert.match(ex.host, /\.invalid$/);
  assert.match(ex.previewUrl, /\.invalid$/);
  assert.equal(ex.login, '');
  assert.ok(!Object.hasOwn(ex, 'password'));
  assert.throws(() => hostingConfig(example), /fill in a real "host"/);
});

test('локальная конфигурация: нет файла, битый JSON, пустые поля — понятные ошибки; заполненная — читается', (t) => {
  const { hostingConfig } = require('../build/publish-spaceweb');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fl-hosting-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const f = path.join(dir, 'website-hosting.local.json');
  assert.throws(() => hostingConfig(f), /Local hosting configuration is missing: copy build\/website-hosting\.local\.example\.json/);
  fs.writeFileSync(f, '{ not json');
  assert.throws(() => hostingConfig(f), /not valid JSON/);
  fs.writeFileSync(f, JSON.stringify({ host: '', previewUrl: 'https://site.fixture.test' }));
  assert.throws(() => hostingConfig(f), /fill in a real "host"/);
  fs.writeFileSync(f, JSON.stringify({ host: 'ftp.fixture.test', previewUrl: 'not a url' }));
  assert.throws(() => hostingConfig(f), /fill in a real "previewUrl"/);
  fs.writeFileSync(f, JSON.stringify({ host: 'ftp.fixture.test', previewUrl: 'https://site.fixture.test/' }));
  assert.deepEqual(hostingConfig(f), { host: 'ftp.fixture.test', preview: 'https://site.fixture.test' });
});

test('публикация без локальной конфигурации останавливается понятной ошибкой до проверки доступа и сети', (t) => {
  // Копия издателя в пустой папке: локального файла рядом нет, ключа доступа в окружении нет
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fl-hosting-run-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'build'));
  for (const name of ['publish-spaceweb.js', 'spaceweb-recovery.js']) fs.copyFileSync(path.join(BUILD, name), path.join(dir, 'build', name));
  const env = { ...process.env };
  delete env.SW_FTP_USER;
  delete env.SW_FTP_PASSWORD;
  for (const mode of ['--production', '--preview', '--check', '--status']) {
    const r = spawnSync(process.execPath, [path.join(dir, 'build', 'publish-spaceweb.js'), mode], { cwd: dir, env, encoding: 'utf8', timeout: 30000, windowsHide: true });
    assert.equal(r.status, 1, `${mode}: код выхода`);
    assert.match(r.stderr, /Local hosting configuration is missing: copy build\/website-hosting\.local\.example\.json to build\/website-hosting\.local\.json/, `${mode}: ${r.stderr}`);
    assert.doesNotMatch(r.stderr + r.stdout, /Run the local SpaceWeb access setup first|connection|ECONN|ENOTFOUND/, `${mode}: до доступа и сети не дошло`);
  }
});
