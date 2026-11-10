'use strict';
// Резервный канал GitHub: build/publish-github.ps1 (проверка в режиме -DryRun, без сети, git и токена)
// и место шага в release.bat. Настоящий токен и настоящий GitHub не трогаются.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REAL = path.join(__dirname, '..');
const win = process.platform === 'win32';

function project(t, { files = true, slug = 'owner/repo' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ghreserve-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'build')); fs.mkdirSync(path.join(root, 'dist-release'));
  fs.copyFileSync(path.join(REAL, 'build/publish-github.ps1'), path.join(root, 'build/publish-github.ps1'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '9.9.9', updates: { github: slug, downloadPage: 'https://example.test/#download' } }));
  fs.writeFileSync(path.join(root, 'build/release-notes.md'), '- **Новое** — проверка\n');
  if (files) for (const f of ['Setup', 'Portable']) fs.writeFileSync(path.join(root, `dist-release/FemboyLauncher-${f}-9.9.9.exe`), 'x'.repeat(10));
  return root;
}
const run = (root) => spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'build/publish-github.ps1'), '-Out', 'dist-release', '-DryRun'],
  { cwd: root, encoding: 'utf8', timeout: 30000, windowsHide: true, env: { ...process.env, LOCALAPPDATA: path.join(root, 'nolocal') } });

test('dry-run: показывает репозиторий, тег и оба файла, ничего не отправляя', { skip: !win }, (t) => {
  const r = run(project(t));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /repo owner\/repo, tag v9\.9\.9/);
  assert.match(r.stdout, /FemboyLauncher-Setup-9\.9\.9\.exe \(10 bytes\)/);
  assert.match(r.stdout, /FemboyLauncher-Portable-9\.9\.9\.exe \(10 bytes\)/);
});
test('нет установщика — отказ с кодом 1', { skip: !win }, (t) => {
  const r = run(project(t, { files: false }));
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /Missing file/);
});
test('кривой updates.github — отказ с кодом 1', { skip: !win }, (t) => {
  const r = run(project(t, { slug: 'not a slug' }));
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /owner\/repo/);
});
test('без сохранённого токена шаг пропускается без ошибки и без сети', { skip: !win }, (t) => {
  const root = project(t);
  const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'build/publish-github.ps1'), '-Out', 'dist-release'],
    { cwd: root, encoding: 'utf8', timeout: 30000, windowsHide: true, env: { ...process.env, LOCALAPPDATA: path.join(root, 'nolocal') } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /skipped: no token saved/);
});
test('настоящий проект: release.bat зовёт шаг последним, после сайта, сбой не останавливает выпуск', () => {
  const bat = fs.readFileSync(path.join(REAL, 'release.bat'), 'utf8');
  const gh = bat.indexOf('publish-github.ps1');
  assert.ok(gh > bat.indexOf('website-release.js') && gh > bat.indexOf('publish-yandex.ps1'));
  assert.match(bat, /publish-github\.ps1 -Out dist-release \|\| echo WARNING/);
  assert.ok(!bat.includes('GH_TOKEN'), 'токен через переменную окружения больше не используется');
  assert.ok(bat.includes('set PUBLISH=never') && !/--publish always|PUBLISH=always/.test(bat), 'electron-builder сам ничего не публикует');
  for (const f of ['publish-github.ps1', 'setup-github-token.ps1']) assert.ok(/^[\x00-\x7f]*$/.test(fs.readFileSync(path.join(REAL, 'build', f), 'utf8')), f + ': только ASCII');
});
