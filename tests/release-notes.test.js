const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REAL = path.join(__dirname, '..');
const WHATSNEW = `window.CHANGELOG = [
  { version: '2.0.0', ru: [['🌸', 'Новое', 'раз — два'], ['🐾', 'Ещё', 'три']], en: [['🌸', 'New', 'one — two'], ['🐾', 'More', 'three']] },
  { version: '1.9.0', ru: [['🧹', 'Старое', 'было'], ], en: [['🧹', 'Old', 'was']] },
];
`;

// Временный «проект»: package.json, whatsnew.js, updatenotes.js и build/ со скриптом — как в настоящем
function project(t, { version = '2.0.0', whatsnew = WHATSNEW } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'femboy-notes-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'src', 'renderer'), { recursive: true });
  fs.mkdirSync(path.join(root, 'build'), { recursive: true });
  if (version !== null) fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'x', version }));
  fs.writeFileSync(path.join(root, 'src', 'renderer', 'whatsnew.js'), whatsnew);
  fs.copyFileSync(path.join(REAL, 'src', 'renderer', 'updatenotes.js'), path.join(root, 'src', 'renderer', 'updatenotes.js'));
  fs.copyFileSync(path.join(REAL, 'build', 'release-notes.js'), path.join(root, 'build', 'release-notes.js'));
  return { root, file: path.join(root, 'build', 'release-notes.md'), script: path.join(root, 'build', 'release-notes.js') };
}
const load = (root) => require(path.join(root, 'build', 'release-notes.js'));

test('для версии из package.json берётся её запись «Что нового»: файл заметок написан и читается лаунчером на обоих языках', (t) => {
  const { root, file } = project(t);
  const r = load(root).generate(root);
  assert.deepEqual([r.version, r.written], ['2.0.0', true]);
  const UpdateNotes = require(path.join(root, 'src', 'renderer', 'updatenotes.js'));
  const md = fs.readFileSync(file, 'utf8');
  assert.deepEqual(UpdateNotes.parse(md, 'ru').map((i) => i[1]), ['Новое', 'Ещё']);
  assert.deepEqual(UpdateNotes.parse(md, 'en').map((i) => i[1]), ['New', 'More']);
  assert.ok(!md.includes('Старое'), 'записи других версий в заметки не попадают');
});

test('записи для этой версии нет — файла нет, а заметки прошлого выпуска, оставшиеся в build, удаляются (чужие заметки не уйдут в новый latest.yml)', (t) => {
  const { root, file } = project(t, { version: '3.0.0' });
  fs.writeFileSync(file, '- 🧹 **Прошлое** — заметки прошлой версии');
  const r = load(root).generate(root);
  assert.deepEqual([r.version, r.written], ['3.0.0', false]);
  assert.ok(!fs.existsSync(file));
});

test('whatsnew.js сломан или в package.json нет версии: ошибка, и старые заметки всё равно удалены', (t) => {
  for (const opts of [{ whatsnew: 'window.CHANGELOG = [ {' }, { version: null }]) {
    const { root, file } = project(t, opts);
    fs.writeFileSync(file, '- 🧹 **Прошлое** — старое');
    assert.throws(() => load(root).generate(root));
    assert.ok(!fs.existsSync(file), JSON.stringify(Object.keys(opts)));
  }
});

test('из командной строки скрипт никогда не падает (код 0): заметки не должны останавливать выпуск; о результате пишет понятно', (t) => {
  const ok = project(t);
  let r = spawnSync(process.execPath, [ok.script], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Release notes for 2\.0\.0/);
  assert.ok(fs.existsSync(ok.file));
  const none = project(t, { version: '3.0.0' });
  r = spawnSync(process.execPath, [none.script], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /No .What.s new. entry for 3\.0\.0/);
  const broken = project(t, { whatsnew: 'сломано{' });
  r = spawnSync(process.execPath, [broken.script], { encoding: 'utf8' });
  assert.equal(r.status, 0, 'сломанный whatsnew.js выпуск не останавливает');
  assert.match(r.stdout, /Release notes were not generated/);
  assert.ok(!fs.existsSync(broken.file));
});

test('настоящий проект: скрипт на месте, а release.bat убирает старые заметки и запускает его до сборки (но после тестов)', () => {
  assert.ok(fs.existsSync(path.join(REAL, 'build', 'release-notes.js')));
  const bat = fs.readFileSync(path.join(REAL, 'release.bat'), 'utf8');
  const test = bat.indexOf('call npm test');
  const del = bat.search(/del .*release-notes\.md/i);
  const gen = bat.indexOf('build\\release-notes.js');
  const builder = bat.indexOf('npx electron-builder');
  assert.ok(test >= 0 && del > test && gen > del && builder > gen, 'порядок: тесты → удалить старые заметки → создать новые → сборка');
  assert.match(bat.slice(gen, bat.indexOf('\n', gen)), /\|\|/, 'сбой скрипта заметок не останавливает выпуск');
});
