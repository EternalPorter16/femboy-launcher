// «Объединить одинаковые моды» (core/dedupe.js): одинаковые файлы в разных сборках становятся одним файлом на диске (жёсткие ссылки)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { profile } = require('./helpers');

function setup(t) {
  const p = profile();
  t.after(() => p.done());
  const instances = p.load('core/instances');
  const mods = p.load('core/mods');
  const dedupe = p.load('core/dedupe');
  const mk = (name) => instances.create({ name, version: '1.21.1', loader: 'fabric' });
  const put = (inst, file, content) => {
    fs.mkdirSync(mods.dir(inst.id), { recursive: true });
    fs.writeFileSync(path.join(mods.dir(inst.id), file), content);
    return path.join(mods.dir(inst.id), file);
  };
  return { p, instances, mods, dedupe, mk, put, fsx: p.load('core/fsx') };
}
const body = (tag, n = 4000) => Buffer.from(tag.repeat(Math.ceil(n / tag.length)).slice(0, n));
const ino = (f) => fs.statSync(f, { bigint: true }).ino;
const same = (a, b) => ino(a) === ino(b);

test('одинаковые моды в разных сборках находятся по размеру и хэшу; разные, мелкие и уже общие не в счёте', async (t) => {
  const w = setup(t);
  const a = w.mk('A');
  const b = w.mk('B');
  w.put(a, 'sodium.jar', body('sodium'));
  w.put(b, 'sodium.jar', body('sodium'));
  w.put(a, 'iris.jar', body('iris'));
  w.put(b, 'iris.jar', body('IRIS')); // тот же размер, другое содержимое
  w.put(a, 'tiny.jar', body('t', 100));
  w.put(b, 'tiny.jar', body('t', 100));
  w.put(a, 'notes.txt', body('x'));
  w.put(b, 'notes.txt', body('x'));
  const r = await w.dedupe.scan();
  assert.equal(r.files, 1);
  assert.equal(r.saved, 4000);
  assert.deepEqual(r.examples.map((e) => [e.name, e.copies]), [['sodium.jar', 2]]);
});

test('объединение: файлы становятся одним (одно и то же место на диске), имена и содержимое прежние, второй раз ничего не делает', async (t) => {
  const w = setup(t);
  const a = w.mk('A');
  const b = w.mk('B');
  const c = w.mk('C');
  const fa = w.put(a, 'lithium.jar', body('lithium'));
  const fb = w.put(b, 'renamed-lithium.jar.disabled', body('lithium')); // выключенный мод с другим именем — тот же мод
  const fc = w.put(c, 'lithium.jar', body('lithium'));
  assert.equal((await w.dedupe.scan()).saved, 8000);
  const r = await w.dedupe.apply();
  assert.deepEqual([r.linked, r.skipped, r.freed], [2, 0, 8000]);
  assert.ok(same(fa, fb) && same(fa, fc));
  assert.deepEqual(fs.readFileSync(fb), body('lithium'));
  assert.equal(fs.readdirSync(mods(w, b)).join(), 'renamed-lithium.jar.disabled', 'временных файлов не осталось');
  const again = await w.dedupe.apply();
  assert.deepEqual([again.linked, again.freed], [0, 0]);
  assert.deepEqual(await w.dedupe.scan(), { saved: 0, files: 0, examples: [] });
});
function mods(w, inst) {
  return w.mods.dir(inst.id);
}

test('сборка, в которой сейчас идёт игра, не трогается', async (t) => {
  const w = setup(t);
  const a = w.mk('A');
  const b = w.mk('B');
  const c = w.mk('C');
  const fa = w.put(a, 'x.jar', body('x'));
  const fb = w.put(b, 'x.jar', body('x'));
  const fc = w.put(c, 'x.jar', body('x'));
  const r = await w.dedupe.apply({ busy: [b.id] });
  assert.equal(r.skipped, 1);
  assert.equal(r.linked, 1);
  assert.ok(same(fa, fc), 'остальные объединены');
  assert.ok(!same(fb, fa) && !same(fb, fc), 'файл занятой сборки остался сам по себе');
});

test('имя файла, у которого есть другие имена (например, в точке восстановления), не считается освобождённым местом', async (t) => {
  const w = setup(t);
  const a = w.mk('A');
  const b = w.mk('B');
  w.put(a, 'x.jar', body('x'));
  const fb = w.put(b, 'x.jar', body('x'));
  fs.linkSync(fb, path.join(w.p.dir || path.dirname(fb), 'snapshot-copy.jar')); // другое имя того же файла вне сборок
  const s = await w.dedupe.scan();
  assert.equal(s.files, 1);
  assert.equal(s.saved, 0, 'файл B всё равно останется на диске под другим именем');
  fs.rmSync(path.join(path.dirname(fb), 'snapshot-copy.jar'), { force: true });
});

test('если ссылку сделать не вышло (другой диск), файл остаётся как был, временного файла нет, это считается пропуском', async (t) => {
  const w = setup(t);
  const a = w.mk('A');
  const b = w.mk('B');
  w.put(a, 'x.jar', body('x'));
  const fb = w.put(b, 'x.jar', body('x'));
  const realLink = fs.linkSync;
  fs.linkSync = () => {
    throw Object.assign(new Error('EXDEV'), { code: 'EXDEV' }); // другой диск
  };
  t.after(() => (fs.linkSync = realLink));
  const r = await w.dedupe.apply();
  assert.deepEqual([r.linked, r.skipped, r.freed], [0, 1, 0]);
  assert.deepEqual(fs.readdirSync(mods(w, b)), ['x.jar']);
  assert.deepEqual(fs.readFileSync(fb), body('x'));
});

test('запись поверх общего файла сначала снимает имя: мод в другой сборке не меняется', async (t) => {
  const w = setup(t);
  const a = w.mk('A');
  const b = w.mk('B');
  const fa = w.put(a, 'x.jar', body('x'));
  const fb = w.put(b, 'x.jar', body('x'));
  await w.dedupe.apply();
  assert.ok(same(fa, fb));
  w.fsx.breakLink(fb);
  fs.writeFileSync(fb, 'новый мод');
  assert.deepEqual(fs.readFileSync(fa), body('x'), 'у соседа прежнее содержимое');
  w.fsx.breakLink(path.join(mods(w, a), 'нет-такого.jar')); // нет файла — не ошибка
});

test('прямая запись поверх мода сначала снимает общее имя', () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
  // Download now renames a verified temporary file; hardlink preservation is
  // exercised behaviorally in audit-download-safety.test.js.
  assert.equal((read('core/modrinth.js').match(/fsx\.breakLink\((?:dest|target)\);\s*fs\.(copyFileSync|writeFileSync)/g) || []).length, 3, 'Modrinth: два копирования и распаковка модпака');
  assert.equal((read('core/curseforge.js').match(/fsx\.breakLink\((?:dest|target)\);\s*fs\.(copyFileSync|writeFileSync)/g) || []).length, 2, 'CurseForge');
  assert.match(read('core/dropin.js'), /fsx\.breakLink\(path\.join\(dir, name\)\);\s*fs\.copyFileSync/, 'перетаскивание файла');
});

test('если занята сборка с главным файлом, группа не трогается целиком', async (t) => {
  const w = setup(t);
  const a = w.mk('A');
  const b = w.mk('B');
  const fa = w.put(a, 'x.jar', body('x'));
  const fb = w.put(b, 'x.jar', body('x'));
  const r = await w.dedupe.apply({ busy: [a.id] });
  assert.deepEqual([r.linked, r.skipped], [0, 1]);
  assert.ok(!same(fa, fb));
});

test('если подменить файл не вышло (занят), временная ссылка убирается и ничего не меняется', async (t) => {
  const w = setup(t);
  const a = w.mk('A');
  const b = w.mk('B');
  const fa = w.put(a, 'x.jar', body('x'));
  const fb = w.put(b, 'x.jar', body('x'));
  const realRename = fs.renameSync;
  fs.renameSync = () => {
    throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' });
  };
  t.after(() => (fs.renameSync = realRename));
  const r = await w.dedupe.apply();
  fs.renameSync = realRename;
  assert.deepEqual([r.linked, r.skipped, r.freed], [0, 1, 0]);
  assert.deepEqual(fs.readdirSync(mods(w, b)), ['x.jar'], 'временной ссылки нет');
  assert.ok(!same(fa, fb));
});
