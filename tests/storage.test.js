const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { profile, put, blockInternet } = require('./helpers');

const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');
const exists = (...p) => fs.existsSync(path.join(...p));

// Папка игры с одной сборкой 1.21.1: профиль версии, нужная и ненужная библиотеки, индекс ресурсов, а ещё старые логи в общей папке
// (до версии, где Java стала запускаться в папке сборки) и логи самой сборки и самого лаунчера, которые чистка трогать не должна
function setup(t, { oldLogs = true } = {}) {
  const unblock = blockInternet();
  const p = profile();
  t.after(() => {
    unblock();
    p.done();
  });
  const instances = p.load('core/instances');
  const inst = instances.create({ name: 'Т', version: '1.21.1', loader: 'vanilla' });
  const root = p.store.paths().root;
  const used = 'org/example/used/1/used-1.jar';
  put(root, {
    'versions/1.21.1/1.21.1.json': JSON.stringify({
      id: '1.21.1',
      type: 'release',
      releaseTime: '2024-08-08T12:24:45+00:00',
      javaVersion: { majorVersion: 21, component: 'java-runtime-delta' },
      downloads: { client: { sha1: sha1('c'), size: 1, url: 'https://example.invalid/c.jar' } },
      libraries: [{ name: 'x:used:1', downloads: { artifact: { path: used, url: 'https://example.invalid/u.jar', sha1: sha1('u'), size: 1 } } }],
      assetIndex: { id: '17', sha1: sha1('i'), size: 1, url: 'https://example.invalid/17.json' },
    }),
    'versions/1.21.1/1.21.1.jar': 'client',
    [`libraries/${used}`]: 'used library',
    'libraries/org/example/unused/9/unused-9.jar': 'unused library '.repeat(10),
    'assets/indexes/17.json': JSON.stringify({ objects: {} }),
  });
  if (oldLogs) {
    put(root, {
      'logs/latest.log': 'старый лог '.repeat(50),
      'logs/2026-10-27-1.log.gz': 'gz '.repeat(40),
      'crash-reports/crash-2026-10-27.txt': 'crash '.repeat(30),
      'hs_err_pid4242.log': 'hs_err '.repeat(20),
    });
  }
  // Это трогать нельзя: логи самой сборки, лог лаунчера, похожие по названию файлы
  put(instances.gameDir(inst.id), { 'logs/latest.log': 'лог сборки', 'crash-reports/crash-1.txt': 'вылет сборки', 'hs_err_pid77.log': 'вылет Java сборки' });
  put(p.dir, { 'logs/launcher.log': 'лог лаунчера' });
  put(root, { 'hs_err_pid.log': 'не по шаблону', 'hs_err_pid12.txt': 'не по шаблону', 'logs-keep.txt': 'не папка logs', 'options.txt': 'x' });
  return { p, root, inst, instances, storage: p.load('core/storage') };
}
const B = (s, n) => Buffer.byteLength(s) * n; // размер файла в байтах: русские буквы в UTF-8 занимают по два
const SIZE = { logs: B('старый лог ', 50) + B('gz ', 40), crash: B('crash ', 30), hs: B('hs_err ', 20) };

test('старые логи в общей папке игры — отдельная категория: две папки и файлы hs_err, с общим размером', async (t) => {
  const { storage } = setup(t);
  const cat = (await storage.scan()).categories.find((c) => c.id === 'logs');
  assert.ok(cat, 'категория «logs» есть');
  assert.equal(cat.name, 'Старые логи игры');
  assert.equal(cat.count, 3, 'папка logs, папка crash-reports и один файл hs_err');
  assert.equal(cat.free, SIZE.logs + SIZE.crash + SIZE.hs);
  assert.equal(cat.total, cat.free, 'всё, что тут лежит, можно убрать');
});

test('чистка «logs» убирает только их: логи сборки и лаунчера, библиотеки, версии, ресурсы и файлы с похожими названиями на месте', async (t) => {
  const { storage, root, p, instances, inst } = setup(t);
  const r = await storage.clean(['logs']);
  assert.equal(r.freed, SIZE.logs + SIZE.crash + SIZE.hs);
  for (const gone of ['logs', 'crash-reports', 'hs_err_pid4242.log']) assert.ok(!exists(root, gone), gone);
  for (const kept of ['hs_err_pid.log', 'hs_err_pid12.txt', 'logs-keep.txt', 'options.txt', 'versions/1.21.1/1.21.1.jar', 'libraries/org/example/used/1/used-1.jar', 'libraries/org/example/unused/9/unused-9.jar', 'assets/indexes/17.json']) assert.ok(exists(root, kept), kept);
  const g = instances.gameDir(inst.id);
  for (const kept of ['logs/latest.log', 'crash-reports/crash-1.txt', 'hs_err_pid77.log']) assert.ok(exists(g, kept), `у сборки: ${kept}`);
  assert.ok(exists(p.dir, 'logs', 'launcher.log'), 'лог самого лаунчера');
});

test('других категорий чистка логов не затрагивает, а чистка библиотек не трогает логи', async (t) => {
  const { storage, root } = setup(t);
  await storage.clean(['libraries']);
  assert.ok(!exists(root, 'libraries/org/example/unused/9/unused-9.jar'), 'ненужная библиотека убрана');
  assert.ok(exists(root, 'libraries/org/example/used/1/used-1.jar'));
  assert.ok(exists(root, 'logs/latest.log') && exists(root, 'crash-reports') && exists(root, 'hs_err_pid4242.log'), 'логи остались');
});

test('старых логов нет — категории в списке нет вообще, а чистка «logs» ничего не делает', async (t) => {
  const { storage, root } = setup(t, { oldLogs: false });
  const cats = (await storage.scan()).categories;
  assert.ok(!cats.some((c) => c.id === 'logs'));
  const r = await storage.clean(['logs']);
  assert.equal(r.freed, 0);
  assert.ok(exists(root, 'options.txt'));
});

test('вторая чистка ничего не находит и не падает; после чистки категория исчезает из списка', async (t) => {
  const { storage } = setup(t);
  await storage.clean(['logs']);
  assert.ok(!(await storage.scan()).categories.some((c) => c.id === 'logs'));
  assert.deepEqual(await storage.clean(['logs']), { freed: 0 });
});
