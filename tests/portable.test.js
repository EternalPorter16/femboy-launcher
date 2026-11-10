const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { src } = require('./helpers');
const { dataDir } = require(src('core/portable'));

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'femboy-portable-')));

test('portable-сборка: данные в папке data рядом с exe, папка создаётся сама', () => {
  const dir = tmp();
  try {
    const d = dataDir({ env: { PORTABLE_EXECUTABLE_DIR: dir } });
    assert.equal(d, path.join(dir, 'data'));
    assert.ok(fs.statSync(d).isDirectory());
    assert.deepEqual(fs.readdirSync(d), [], 'проверочный файл за собой убран');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('обычный exe становится portable, если рядом лежит portable.txt', () => {
  const dir = tmp();
  try {
    assert.equal(dataDir({ env: {}, exeDir: dir, packaged: true }), null, 'без метки — обычный режим');
    fs.writeFileSync(path.join(dir, 'portable.txt'), '');
    assert.equal(dataDir({ env: {}, exeDir: dir, packaged: true }), path.join(dir, 'data'));
    assert.equal(dataDir({ env: {}, exeDir: dir, packaged: false }), null, 'при разработке метку не ищем: exe — это сам Electron');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('у кого данные уже в профиле Windows, они не переезжают молча', () => {
  const dir = tmp();
  const old = tmp();
  try {
    fs.writeFileSync(path.join(old, 'launcher.json'), '{}');
    assert.equal(dataDir({ env: { PORTABLE_EXECUTABLE_DIR: dir }, oldDataDir: old }), null, 'сборки не «пропадают»: остаёмся на прежнем месте');
    fs.mkdirSync(path.join(dir, 'data'));
    assert.equal(dataDir({ env: { PORTABLE_EXECUTABLE_DIR: dir }, oldDataDir: old }), path.join(dir, 'data'), 'человек сам создал data — это его выбор');
    fs.rmSync(path.join(old, 'launcher.json'));
    fs.rmSync(path.join(dir, 'data'), { recursive: true });
    assert.equal(dataDir({ env: { PORTABLE_EXECUTABLE_DIR: dir }, oldDataDir: old }), path.join(dir, 'data'), 'старых данных нет — настоящий portable с первого запуска');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(old, { recursive: true, force: true });
  }
});

test('писать рядом с программой нельзя — обычное место, а не падение', () => {
  const dir = tmp();
  try {
    // data — это файл, а не папка: создать каталог нельзя, как и на диске только для чтения
    fs.writeFileSync(path.join(dir, 'data'), 'я файл');
    assert.equal(dataDir({ env: { PORTABLE_EXECUTABLE_DIR: dir } }), null);
    assert.equal(dataDir({ env: {} }), null, 'без меток ничего не делаем');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
