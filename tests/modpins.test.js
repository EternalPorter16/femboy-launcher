const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { profile, put } = require('./helpers');

const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');

// Подменённый Modrinth: на каждый присланный хэш отвечает «есть версия 2.0» и отдаёт её файл; calls — что у него спрашивали
function setup(t) {
  const real = globalThis.fetch;
  const calls = [];
  const served = new Map();
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (/api\.modrinth\.com\/v2\/version_files\/update$/.test(u)) {
      const body = JSON.parse(opts.body);
      calls.push(body);
      const out = {};
      for (const h of body.hashes) {
        const file = `new-${h.slice(0, 8)}.jar`;
        const bytes = Buffer.from('новая версия ' + h);
        served.set(`https://cdn.modrinth.com/${file}`, bytes);
        out[h] = { name: 'Новая ' + h.slice(0, 4), version_number: '2.0', project_id: 'P' + h.slice(0, 4), files: [{ primary: true, url: `https://cdn.modrinth.com/${file}`, filename: file, hashes: { sha1: sha1(bytes) } }] };
      }
      return new Response(JSON.stringify(out), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    const project = /api\.modrinth\.com\/v2\/project\/(\w+)$/.exec(u);
    if (project) return new Response(JSON.stringify({ title: 'Проект ' + project[1], icon_url: null }), { status: 200, headers: { 'content-type': 'application/json' } });
    const bytes = served.get(u);
    if (bytes) return new Response(bytes, { status: 200, headers: { 'content-length': String(bytes.length) } });
    return new Response('нет', { status: 404 }); // в настоящую сеть тесты не ходят
  };
  const p = profile();
  t.after(() => {
    globalThis.fetch = real;
    p.done();
  });
  const instances = p.load('core/instances');
  const inst = instances.create({ name: 'Т', version: '1.20.1', loader: 'fabric' });
  const g = instances.gameDir(inst.id);
  put(g, { 'mods/a.jar': 'aaa', 'mods/b.jar': 'bbb', 'mods/off.jar.disabled': 'ooo' });
  const metaFile = path.join(instances.dirOf(inst.id), 'mods-meta.json');
  const saved = () => (fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, 'utf8')) : {});
  return { p, inst, g, calls, saved, mods: p.load('core/mods'), modupdates: p.load('core/modupdates') };
}

test('закрепление мода: запоминается в файле сборки и видно в списке модов, снимается обратно', (t) => {
  const { inst, mods, saved } = setup(t);
  assert.ok(mods.list(inst.id).every((m) => !m.pinned));
  mods.setPinned(inst.id, 'a.jar', true);
  assert.equal(mods.list(inst.id).find((m) => m.file === 'a.jar').pinned, true);
  assert.equal(mods.list(inst.id).find((m) => m.file === 'b.jar').pinned, undefined, 'другие моды не затронуты');
  assert.equal(saved()['a.jar'].pinned, true);
  mods.setPinned(inst.id, 'a.jar', false);
  assert.ok(mods.list(inst.id).every((m) => !m.pinned));
  assert.deepEqual(saved(), {}, 'после снятия пометки у мода без других сведений в файле не остаётся ничего');
});

test('закрепить можно и выключенный мод; чужие сведения о моде (название, значок) остаются', (t) => {
  const { inst, mods, saved } = setup(t);
  mods.record(inst.id, 'b.jar', { source: 'modrinth', projectId: 'X', title: 'Мой мод', version: '1.2' });
  mods.setPinned(inst.id, 'b.jar', true);
  mods.setPinned(inst.id, 'off.jar', true);
  assert.deepEqual(saved()['b.jar'], { source: 'modrinth', projectId: 'X', title: 'Мой мод', version: '1.2', pinned: true });
  assert.equal(mods.list(inst.id).find((m) => m.file === 'off.jar').pinned, true);
  mods.setPinned(inst.id, 'b.jar', false);
  assert.deepEqual(saved()['b.jar'], { source: 'modrinth', projectId: 'X', title: 'Мой мод', version: '1.2' });
});

test('закрепить то, чего нет, или файл с неверным именем нельзя: понятная ошибка, ничего не записывается', (t) => {
  const { inst, mods, saved } = setup(t);
  assert.throws(() => mods.setPinned(inst.id, 'нет.jar', true), /Мод не найден/);
  for (const bad of ['', '../a.jar', 'sub/a.jar', '.hidden.jar', 'a.zip', undefined]) assert.throws(() => mods.setPinned(inst.id, bad, true), /Некорректное имя файла/, String(bad));
  assert.deepEqual(saved(), {});
});

test('удалили мод — вместе с ним уходит и закрепление', (t) => {
  const { inst, g, mods, saved } = setup(t);
  mods.setPinned(inst.id, 'a.jar', true);
  mods.remove(inst.id, 'a.jar');
  assert.ok(!fs.existsSync(path.join(g, 'mods', 'a.jar')));
  assert.deepEqual(saved(), {});
});

test('«Обновить моды» не спрашивает про закреплённые и не предлагает их обновить', async (t) => {
  const { inst, calls, mods, modupdates } = setup(t);
  mods.setPinned(inst.id, 'a.jar', true);
  const ups = await modupdates.check(inst.id);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].hashes.sort(), [sha1('bbb'), sha1('ooo')].sort(), 'хэш закреплённого мода не отправляется');
  assert.deepEqual(ups.map((u) => u.file).sort(), ['b.jar', 'off.jar']);
  mods.setPinned(inst.id, 'a.jar', false);
  const again = await modupdates.check(inst.id);
  assert.deepEqual(again.map((u) => u.file).sort(), ['a.jar', 'b.jar', 'off.jar'], 'открепили — мод снова обновляется');
});

test('закреплены все моды: к Modrinth не обращаемся, обновлять нечего', async (t) => {
  const { inst, calls, mods, modupdates } = setup(t);
  for (const f of ['a.jar', 'b.jar', 'off.jar']) mods.setPinned(inst.id, f, true);
  assert.deepEqual(await modupdates.check(inst.id), []);
  assert.equal(calls.length, 0);
});

test('установка обновлений трогает только найденное: закреплённый мод остаётся прежним файлом', async (t) => {
  const { inst, g, mods, modupdates } = setup(t);
  mods.setPinned(inst.id, 'a.jar', true);
  await modupdates.check(inst.id);
  const r = await modupdates.apply(inst.id);
  assert.equal(r.failed.length, 0);
  assert.equal(fs.readFileSync(path.join(g, 'mods', 'a.jar'), 'utf8'), 'aaa', 'закреплённый мод не тронут');
  assert.ok(!fs.existsSync(path.join(g, 'mods', `new-${sha1('aaa').slice(0, 8)}.jar`)));
  assert.ok(!fs.existsSync(path.join(g, 'mods', 'b.jar')), 'прежний файл незакреплённого мода заменён новым');
  assert.ok(fs.existsSync(path.join(g, 'mods', `new-${sha1('bbb').slice(0, 8)}.jar`)));
  assert.equal(mods.list(inst.id).find((m) => m.file === 'a.jar').pinned, true, 'закрепление осталось');
});
