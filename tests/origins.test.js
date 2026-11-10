const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { profile, put } = require('./helpers');

const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');

// Подменяем только запрос к Modrinth: version_files отвечает «знаю» для файлов из known, остальное — нет
function setup(t, { known = [], offline = false } = {}) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (!/api\.modrinth\.com\/v2\/version_files$/.test(u)) return real(url, opts);
    calls.push(JSON.parse(opts.body));
    if (offline) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
    const hashes = JSON.parse(opts.body).hashes;
    const out = Object.fromEntries(hashes.filter((h) => known.includes(h)).map((h) => [h, { project_id: 'P' + h.slice(0, 4), version_number: '1.0' }]));
    return new Response(JSON.stringify(out), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const p = profile();
  t.after(() => {
    globalThis.fetch = real;
    p.done();
  });
  const instances = p.load('core/instances');
  const inst = instances.create({ name: 'Т', version: '1.20.1', loader: 'fabric' });
  const g = instances.gameDir(inst.id);
  return { p, inst, g, calls, origins: p.load('core/origins'), mods: p.load('core/mods'), instances };
}

test('известный файл — Modrinth, чужой — неизвестный источник, а поставленный лаунчером спрашивать не нужно', async (t) => {
  const { inst, g, calls, origins, mods } = setup(t, { known: [sha1('modrinth-file')] });
  put(g, { 'mods/known.jar': 'modrinth-file', 'mods/stranger.jar': 'from-some-site', 'mods/mine.jar': 'installed-by-launcher', 'mods/off.jar.disabled': 'disabled-stranger' });
  mods.record(inst.id, 'mine.jar', { source: 'modrinth', projectId: 'X', title: 'Мой мод' });
  const r = await origins.check(inst.id);
  assert.deepEqual(r, { 'known.jar': 'modrinth', 'stranger.jar': 'unknown', 'mine.jar': 'modrinth', 'off.jar': 'unknown' });
  assert.equal(calls.length, 1, 'один запрос на все файлы');
  assert.deepEqual(calls[0].hashes.sort(), [sha1('modrinth-file'), sha1('from-some-site'), sha1('disabled-stranger')].sort(), 'хэши лаунчерных модов не отправляем: их источник и так известен');
  assert.equal(calls[0].algorithm, 'sha1');
});

test('результат запоминается: повторная проверка без запросов; изменённый файл проверяется заново', async (t) => {
  const { inst, g, calls, origins } = setup(t, { known: [] });
  put(g, { 'mods/a.jar': 'aaa', 'mods/b.jar': 'bbb' });
  await origins.check(inst.id);
  assert.equal(calls.length, 1);
  await origins.check(inst.id);
  assert.equal(calls.length, 1, 'всё в кэше');
  await new Promise((r) => setTimeout(r, 20));
  put(g, { 'mods/a.jar': 'aaa-changed' });
  const r = await origins.check(inst.id);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].hashes, [sha1('aaa-changed')], 'проверяется только изменившийся файл');
  assert.equal(r['b.jar'], 'unknown');
});

test('неизвестные перепроверяются через неделю, а удалённые файлы из кэша уходят', async (t) => {
  const { inst, g, calls, origins, instances } = setup(t, { known: [] });
  put(g, { 'mods/a.jar': 'aaa', 'mods/gone.jar': 'ggg' });
  await origins.check(inst.id);
  const file = path.join(instances.dirOf(inst.id), 'origins.json');
  const cache = JSON.parse(fs.readFileSync(file, 'utf8'));
  cache['a.jar'].at = Date.now() - 8 * 24 * 3600e3;
  fs.writeFileSync(file, JSON.stringify(cache));
  fs.rmSync(path.join(g, 'mods/gone.jar'));
  await origins.check(inst.id);
  assert.equal(calls.length, 2, 'неделя прошла — спросили снова');
  assert.deepEqual(calls[1].hashes, [sha1('aaa')]);
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(file, 'utf8'))), ['a.jar'], 'записи о пропавшем файле нет');
});

test('нет связи: ничего не помечаем «неизвестным» и ничего не запоминаем', async (t) => {
  const { inst, g, origins, instances } = setup(t, { offline: true });
  put(g, { 'mods/a.jar': 'aaa' });
  const r = await origins.check(inst.id);
  assert.deepEqual(r, { 'a.jar': 'unchecked' });
  assert.equal(fs.existsSync(path.join(instances.dirOf(inst.id), 'origins.json')), false);
});

test('пустая сборка: запросов нет', async (t) => {
  const { inst, calls, origins } = setup(t);
  assert.deepEqual(await origins.check(inst.id), {});
  assert.equal(calls.length, 0);
});
