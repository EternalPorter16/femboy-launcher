const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { profile, put, blockInternet } = require('./helpers');

const EXE = process.platform === 'win32' ? 'javaw.exe' : 'java';

function fakeJava(root, name, version) {
  const home = path.join(root, name);
  put(home, { [`bin/${EXE}`]: '', release: `IMPLEMENTOR="Test"\nJAVA_VERSION="${version}"\nOS_ARCH="x86_64"\n` });
  return path.join(home, 'bin', EXE);
}

// Запуск без сети: профиль версии лежит на диске (как после первого запуска), Java подсовываем свою, ненастоящую
function setup(t, javaVersion) {
  const unblock = blockInternet();
  const p = profile();
  t.after(() => {
    unblock();
    p.done();
  });
  const accounts = p.load('core/accounts');
  const instances = p.load('core/instances');
  accounts.addOffline('JavaTester');
  const exe = fakeJava(path.join(p.dir, 'jvm'), 'j', javaVersion);
  const inst = instances.create({ name: 'Java test', version: '1.21.1', loader: 'vanilla', javaPath: exe });
  const root = p.store.paths().root;
  put(root, {
    'versions/1.21.1/1.21.1.json': JSON.stringify({ id: '1.21.1', type: 'release', releaseTime: '2024-08-08T12:24:45+00:00', javaVersion: { majorVersion: 21, component: 'java-runtime-delta' }, downloads: { client: { sha1: '0'.repeat(40), size: 1, url: 'https://example.invalid/client.jar' } }, libraries: [] }),
  });
  const events = [];
  const ui = { status: (s) => events.push(s), progress: () => {}, log: (l) => events.push('log: ' + l), notice: () => {}, started: () => {}, closed: () => {} };
  return { p, inst, ui, events, game: p.load('core/game') };
}

test('слишком старая своя Java: игра не запускается, а человек получает понятную причину (и совет)', async (t) => {
  const { game, inst, ui, events } = setup(t, '17.0.9');
  const e = await game.launch(inst.id, ui, {}).catch((x) => x);
  assert.match(e.message, /^Игре нужна Java 21 или новее, а здесь Java 17: игра не запустится\. Выбери другую Java/);
  assert.ok(!events.some((s) => /Скачиваю|Проверяю файлы игры/.test(s)), 'до скачивания клиента дело не дошло');
});

test('несуществующая Java: понятная ошибка, а не вылет движка запуска', async (t) => {
  const { game, inst, ui, p } = setup(t, '21.0.4');
  p.load('core/instances').update(inst.id, { javaPath: path.join(p.dir, 'нет', 'bin', EXE) });
  const e = await game.launch(inst.id, ui, {}).catch((x) => x);
  assert.match(e.message, /Java по этому пути не найдена/);
});

test('подходящая Java проходит проверку, более новая — с предупреждением в консоли', async (t) => {
  for (const [version, warn] of [['21.0.4', false], ['25.0.1', true]]) {
    const { game, inst, ui, events, p } = setup(t, version);
    // Как только игра берётся за файлы (то есть Java принята), отменяем запуск: дальше нужна сеть, а она здесь не нужна
    const net = p.load('core/net');
    const token = net.cancelToken();
    const status = ui.status;
    ui.status = (s) => (status(s), /Проверяю файлы игры/.test(s) && token.cancel());
    const e = await net.runCancellable(token, () => game.launch(inst.id, ui, {})).catch((x) => x);
    assert.equal(e.cancelled, true, `Java ${version} принята, запуск дошёл до проверки файлов игры`);
    assert.equal(events.some((s) => /рассчитана на Java 21/.test(s)), warn, `предупреждение про более новую Java: ${warn}`);
    assert.ok(events.includes(`log: Java: ${inst.javaPath}`));
  }
});

test('общая Java из настроек проверяется так же', async (t) => {
  const { game, inst, ui, p } = setup(t, '8.0.1');
  const instances = p.load('core/instances');
  const exe = inst.javaPath;
  instances.update(inst.id, { javaPath: '' });
  p.store.updateSettings({ javaPath: exe });
  fs.writeFileSync(path.join(path.dirname(path.dirname(exe)), 'release'), 'JAVA_VERSION="1.8.0_391"\nOS_ARCH="x86_64"\n');
  const e = await game.launch(inst.id, ui, {}).catch((x) => x);
  assert.match(e.message, /Игре нужна Java 21 или новее, а здесь Java 8/);
});
