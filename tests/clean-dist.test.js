const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REAL = path.join(__dirname, '..');
const { clean } = require('../build/clean-dist.js');

// Три файла версии, как их кладёт electron-builder (blockmap идёт только к Setup)
const installer = (v) => [`FemboyLauncher-Setup-${v}.exe`, `FemboyLauncher-Setup-${v}.exe.blockmap`, `FemboyLauncher-Portable-${v}.exe`];
const put = (dir, name, size = name.length) => fs.writeFileSync(path.join(dir, name), Buffer.alloc(size, 'x'));
const list = (dir) => fs.readdirSync(dir).sort();

// Папка сборки: установщики старых версий и текущей, latest.yml, лишние файлы и папки (как win-unpacked)
function build(t, { old = [], current = '2.0.0', extra = [], dirs = [] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'femboy-clean-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const v of [...old, current]) for (const n of installer(v)) put(dir, n);
  put(dir, 'latest.yml');
  for (const n of extra) put(dir, n);
  for (const d of dirs) {
    fs.mkdirSync(path.join(dir, d), { recursive: true });
    put(path.join(dir, d), 'inner.txt');
  }
  return dir;
}

test('убирает установщики всех версий, кроме текущей (Setup, Portable и .blockmap); текущая версия и latest.yml остаются', (t) => {
  const old = ['0.7.0', '0.8.4', '1.9.0'];
  const dir = build(t, { old });
  const r = clean(dir, '2.0.0');
  const gone = old.flatMap(installer).sort();
  assert.equal(r.refused, null);
  assert.deepEqual(r.failed, []);
  assert.deepEqual(r.removed.map((x) => x.name).sort(), gone);
  assert.deepEqual(list(dir), [...installer('2.0.0'), 'latest.yml'].sort());
  assert.deepEqual([...r.kept].sort(), installer('2.0.0').sort());
  assert.equal(r.removed.reduce((s, x) => s + x.size, 0), gone.reduce((s, n) => s + n.length, 0), 'размеры убранных файлов посчитаны верно');
});

test('всё остальное не трогается: latest.yml, служебные файлы electron-builder, win-unpacked, чужие файлы и похожие имена', (t) => {
  const extra = [
    'builder-debug.yml', 'builder-effective-config.yaml', 'notes.txt', 'OtherApp-Setup-1.0.0.exe', 'FemboyLauncher-Setup-1.0.0.exe.bak',
    'FemboyLauncher-Setup-latest.exe', 'FemboyLauncher-Setup-1.0.exe', 'FemboyLauncher-Setup-1.0.0.exe.blockmap.old', 'femboylauncher-setup-0.5.0.exe',
    'FemboyLauncher-Update-1.0.0.exe', 'FemboyLauncher-Setup-1.0.0.msi',
  ];
  const dirs = ['win-unpacked', '.icon-ico'];
  const dir = build(t, { old: ['1.0.0'], extra, dirs });
  const r = clean(dir, '2.0.0');
  assert.deepEqual(r.removed.map((x) => x.name).sort(), installer('1.0.0').sort(), 'убраны только установщики старой версии');
  assert.deepEqual(list(dir), [...installer('2.0.0'), 'latest.yml', ...extra, ...dirs].sort());
  assert.ok(fs.existsSync(path.join(dir, 'win-unpacked', 'inner.txt')), 'внутри win-unpacked ничего не тронуто');
});

test('папка с именем установщика не удаляется: убираются только обычные файлы', (t) => {
  const dir = build(t, { dirs: ['FemboyLauncher-Setup-1.0.0.exe', 'FemboyLauncher-Portable-1.0.0.exe'] });
  const r = clean(dir, '2.0.0');
  assert.deepEqual(r.removed, []);
  assert.deepEqual(r.failed, []);
  assert.ok(fs.existsSync(path.join(dir, 'FemboyLauncher-Setup-1.0.0.exe', 'inner.txt')));
  assert.ok(fs.existsSync(path.join(dir, 'FemboyLauncher-Portable-1.0.0.exe', 'inner.txt')));
});

test('нет файлов текущей версии (сборка не удалась или папка не та): отказ, и ничего не удалено', (t) => {
  for (const missing of ['FemboyLauncher-Setup-2.0.0.exe', 'FemboyLauncher-Portable-2.0.0.exe', 'latest.yml']) {
    const dir = build(t, { old: ['1.0.0'] });
    fs.rmSync(path.join(dir, missing));
    const before = list(dir);
    const r = clean(dir, '2.0.0');
    assert.ok(r.refused && r.refused.includes(missing), `${missing}: отказ называет недостающее`);
    assert.deepEqual(r.removed, [], missing);
    assert.deepEqual(list(dir), before, missing);
  }
});

test('пробный режим: говорит, что убрал бы, но ничего не удаляет', (t) => {
  const dir = build(t, { old: ['1.0.0', '1.5.0'] });
  const before = list(dir);
  const r = clean(dir, '2.0.0', { dryRun: true });
  assert.equal(r.dryRun, true);
  assert.deepEqual(r.removed.map((x) => x.name).sort(), ['1.0.0', '1.5.0'].flatMap(installer).sort());
  assert.deepEqual(list(dir), before);
});

test('один файл убрать не вышло (занят антивирусом, например): остальные убираются, а сбой попадает в отчёт', (t) => {
  const dir = build(t, { old: ['1.0.0', '1.5.0'] });
  const stuck = 'FemboyLauncher-Setup-1.5.0.exe';
  const realUnlink = fs.unlinkSync;
  t.after(() => { fs.unlinkSync = realUnlink; });
  fs.unlinkSync = (p) => {
    if (path.basename(String(p)) === stuck) throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' });
    return realUnlink(p);
  };
  const r = clean(dir, '2.0.0');
  fs.unlinkSync = realUnlink;
  assert.deepEqual(r.failed.map((f) => [f.name, f.error]), [[stuck, 'EBUSY']]);
  assert.equal(r.removed.length, installer('1.0.0').length + installer('1.5.0').length - 1);
  assert.ok(!r.removed.some((x) => x.name === stuck), 'не убранный файл в списке убранных не значится');
  assert.deepEqual(list(dir), [...installer('2.0.0'), 'latest.yml', stuck].sort());
});

test('версия не указана или похожа на мусор: отказ, ничего не удалено', (t) => {
  const dir = build(t, { old: ['1.0.0'] });
  // файлы «текущей» версии 2.0 существуют, так что отказывает именно проверка записи версии, а не поиск файлов
  put(dir, 'FemboyLauncher-Setup-2.0.exe');
  put(dir, 'FemboyLauncher-Portable-2.0.exe');
  const before = list(dir);
  for (const v of [undefined, null, '', ' ', '*', '2', '2.0', 'latest', '../2.0.0', '2.0.0\\..\\x', '2.0.0 ']) {
    const r = clean(dir, v);
    assert.ok(r.refused, JSON.stringify(v));
    assert.deepEqual(r.removed, [], JSON.stringify(v));
  }
  assert.deepEqual(list(dir), before);
});

test('папки нет: понятный отказ, без исключения', () => {
  const r = clean(path.join(os.tmpdir(), `femboy-no-such-folder-${process.pid}`), '2.0.0');
  assert.match(r.refused, /not found/i);
  assert.deepEqual(r.removed, []);
});

test('предварительные версии: «1.1.0-beta.1» — отдельная версия, а текущая «1.1.0-beta.2» (или «1.1.0») остаётся', (t) => {
  const old = ['1.0.0', '1.1.0-beta.1', '1.1.0'];
  const dir = build(t, { old, current: '1.1.0-beta.2' });
  const r = clean(dir, '1.1.0-beta.2');
  assert.equal(r.refused, null);
  assert.deepEqual(list(dir), [...installer('1.1.0-beta.2'), 'latest.yml'].sort());
  const dir2 = build(t, { old: ['1.1.0-beta.1', '1.1.0-beta.2'], current: '1.1.0' });
  clean(dir2, '1.1.0');
  assert.deepEqual(list(dir2), [...installer('1.1.0'), 'latest.yml'].sort());
});

// ---- запуск из командной строки, как это делает release.bat: node build\clean-dist.js dist-release ----
// Временный «проект»: package.json, build/clean-dist.js и dist-release с установщиками
function project(t, { version = '2.0.0', old = ['1.0.0', '1.9.0'], withCurrent = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'femboy-cleancli-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'build'));
  fs.mkdirSync(path.join(root, 'dist-release'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'x', version }));
  fs.copyFileSync(path.join(REAL, 'build', 'clean-dist.js'), path.join(root, 'build', 'clean-dist.js'));
  const dir = path.join(root, 'dist-release');
  for (const v of [...old, ...(withCurrent ? [version] : [])]) for (const n of installer(v)) put(dir, n, 1024);
  if (withCurrent) put(dir, 'latest.yml');
  return { root, dir, script: path.join(root, 'build', 'clean-dist.js') };
}
const run = (p, ...args) => spawnSync(process.execPath, [p.script, ...args], { cwd: p.root, encoding: 'utf8' });
const ASCII = /^[\x00-\x7f]*$/;

test('из командной строки: версия берётся из package.json, старые установщики убираются, код 0, вывод по-английски (cmd путает кириллицу)', (t) => {
  const p = project(t);
  const r = run(p, 'dist-release');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /dist-release: removed 6 file\(s\), 0\.0 MB \(kept version 2\.0\.0\)/);
  assert.deepEqual(list(p.dir), [...installer('2.0.0'), 'latest.yml'].sort());
  assert.match(r.stdout + r.stderr, ASCII);
});

test('из командной строки: --dry-run только сообщает, что убрал бы', (t) => {
  const p = project(t);
  const before = list(p.dir);
  const r = run(p, 'dist-release', '--dry-run');
  assert.equal(r.status, 0);
  assert.match(r.stdout, /would remove 6 file\(s\)/);
  assert.deepEqual(list(p.dir), before);
  const r2 = run(p, '--dry-run', 'dist-release');
  assert.match(r2.stdout, /would remove 6 file\(s\)/, 'порядок аргументов не важен');
});

test('из командной строки: нечего убирать — так и сказано, код 0', (t) => {
  const p = project(t, { old: [] });
  const r = run(p, 'dist-release');
  assert.equal(r.status, 0);
  assert.match(r.stdout, /nothing to remove \(current version 2\.0\.0\)/);
});

test('из командной строки: нет текущей сборки — отказ с кодом 1 (release.bat пишет «не почищено»), и ничего не удалено', (t) => {
  const p = project(t, { withCurrent: false });
  const before = list(p.dir);
  const r = run(p, 'dist-release');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /Not cleaning dist-release: /);
  assert.deepEqual(list(p.dir), before);
  assert.match(r.stdout + r.stderr, ASCII);
});

test('из командной строки: без папки или с несуществующей — понятное сообщение и код 1, а не стек ошибки', (t) => {
  const p = project(t);
  const before = list(p.dir);
  let r = run(p);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /Usage: node build\/clean-dist\.js/);
  r = run(p, 'no-such-folder');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /Not cleaning no-such-folder: .*not found/);
  assert.ok(!/\n\s+at /.test(r.stdout + r.stderr), 'стека ошибки нет');
  assert.deepEqual(list(p.dir), before);
});

test('настоящий проект: скрипт на месте, release.bat зовёт его ПОСЛЕ выкладки на Диск, сбой чистки выпуск не останавливает', () => {
  assert.ok(fs.existsSync(path.join(REAL, 'build', 'clean-dist.js')));
  const bat = fs.readFileSync(path.join(REAL, 'release.bat'), 'utf8');
  const publish = bat.indexOf('publish-yandex.ps1');
  const cleanAt = bat.indexOf('build\\clean-dist.js');
  const s3 = bat.indexOf('publish-s3.ps1 -Out');
  assert.ok(s3 >= 0 && s3 < publish, 'основной S3 публикуется перед резервным Диском');
  assert.ok(bat.indexOf('publish-s3.ps1 -Check') < bat.indexOf('call npx electron-builder'), 'доступ S3 проверяется до сборки');
  assert.ok(publish >= 0 && cleanAt > publish, 'порядок: выкладка → чистка');
  assert.match(bat.slice(publish, bat.indexOf('\n', publish)), /\|\| \(pause & exit \/b 1\)/, 'неудачная выкладка выходит из скрипта до чистки');
  const line = bat.slice(cleanAt, bat.indexOf('\n', cleanAt));
  assert.match(line, /^build\\clean-dist\.js dist-release \|\| echo /, 'чистится папка, куда собирает electron-builder; сбой только пишется в окно');
  assert.ok(!/exit|pause/.test(line), 'чистка не останавливает выпуск и не ждёт клавишу');
  const tail = bat.slice(cleanAt);
  const websiteAt = bat.indexOf('build\\website-release.js');
  assert.ok(websiteAt > cleanAt, 'подготовка сайта выполняется после успешной выкладки и чистки');
  assert.match(bat.slice(websiteAt, bat.indexOf('\n', websiteAt)), /--build && call build\\deploy-website\.bat \|\| echo WARNING:/, 'ошибка сайта явно сообщается, но не отменяет выпуск лаунчера');
  assert.ok(bat.indexOf('\nver >nul', websiteAt) > websiteAt, 'после дополнительного шага код выхода выпуска сбрасывается');
  assert.ok(tail.indexOf('\nver >nul') > 0 && tail.indexOf('\nver >nul') < tail.lastIndexOf('pause'), 'после чистки код выхода сбрасывается: выпуск удался, и неудачная чистка не должна оставить ошибку');
  assert.equal(bat.match(/--config\.directories\.output=(\S+)/)[1], 'dist-release');
  assert.ok(!bat.includes('\r') && ASCII.test(bat), 'release.bat: только ASCII и переводы строк LF');
});
