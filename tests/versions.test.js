const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { profile, put } = require('./helpers');

// Подменённый fetch: считает обращения и умеет «отключать интернет». Ставить до profile(): net.js запоминает fetch при загрузке
const MANIFEST = { latest: { release: '1.21.1', snapshot: '1.21.1' }, versions: [{ id: '1.21.1', type: 'release', releaseTime: '2024-08-08T12:24:45+00:00', url: 'https://piston-meta.mojang.com/v1/packages/x/1.21.1.json' }, { id: '1.20.1', type: 'release', releaseTime: '2023-06-12T13:25:51+00:00', url: 'https://piston-meta.mojang.com/v1/packages/x/1.20.1.json' }] };
const jarBytes = Buffer.from('pretend client jar '.repeat(100));
const jarSha = crypto.createHash('sha1').update(jarBytes).digest('hex');
const VJSON = (id) => ({ id, type: 'release', releaseTime: '2024-08-08T12:24:45+00:00', javaVersion: { majorVersion: 21, component: 'java-runtime-delta' }, downloads: { client: { sha1: jarSha, size: jarBytes.length, url: `https://piston-data.mojang.com/v1/objects/${id}/client.jar` } }, libraries: [] });

function setup(t) {
  const real = globalThis.fetch;
  const net = { online: true, calls: [] };
  globalThis.fetch = async (url) => {
    url = String(url);
    net.calls.push(url);
    if (!net.online) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
    if (/version_manifest_v2\.json$/.test(url)) return json(MANIFEST);
    const v = /packages\/x\/([\d.]+)\.json$/.exec(url);
    if (v) return json(VJSON(v[1]));
    if (/client\.jar$/.test(url)) return new Response(jarBytes, { status: 200, headers: { 'content-length': String(jarBytes.length) } });
    return new Response('nope', { status: 404 });
  };
  const p = profile();
  t.after(() => {
    globalThis.fetch = real;
    p.done();
  });
  // Каждый «запуск лаунчера» — заново загруженный модуль, у которого память пуста
  const versions = () => {
    for (const k of Object.keys(require.cache)) if (/core[\\/]versions\.js$/.test(k)) delete require.cache[k];
    return p.load('core/versions');
  };
  return { p, net, versions, cacheFile: path.join(p.dir, 'cache', 'version_manifest_v2.json') };
}

test('список версий лежит на диске: свежая копия — интернет не нужен, старая — показывается, если связи нет', async (t) => {
  const { net, versions, cacheFile } = setup(t);
  let list = await versions().listMinecraft();
  assert.equal(list.versions.length, 2);
  assert.ok(fs.existsSync(cacheFile), 'список сохранён на диск');

  net.online = false;
  net.calls.length = 0;
  list = await versions().listMinecraft();
  assert.equal(list.versions.length, 2);
  assert.equal(net.calls.length, 0, 'новый запуск лаунчера, копия свежая: в сеть не ходим');

  const old = new Date(Date.now() - 2 * 3600e3);
  fs.utimesSync(cacheFile, old, old);
  const v = versions();
  net.calls.length = 0;
  list = await v.listMinecraft();
  assert.equal(list.versions.length, 2, 'копия устарела, связи нет — старый список вместо ошибки');
  assert.ok(net.calls.length > 0 && net.calls.length <= 2, 'а перед этим пробовали обновить, но недолго');
  net.calls.length = 0;
  await v.listMinecraft();
  assert.equal(net.calls.length, 0, 'и в ту же минуту связь заново не дёргаем');

  net.online = true;
  net.calls.length = 0;
  await versions().listMinecraft();
  assert.equal(net.calls.length, 1, 'связь вернулась: список обновился');
  assert.ok(fs.statSync(cacheFile).mtimeMs > Date.now() - 5000);
});

test('ни копии, ни связи: понятная ошибка', async (t) => {
  const { net, versions } = setup(t);
  net.online = false;
  await assert.rejects(versions().listMinecraft(), /Нет связи/);
});

test('профиль версии и клиент берутся с диска: повторный запуск без интернета обходится без запросов', async (t) => {
  const { p, net, versions } = setup(t);
  const root = p.store.paths().root;
  assert.equal(await versions().ensureClientJar(root, '1.21.1'), true, 'первый запуск: профиль и клиент скачаны');
  assert.ok(fs.existsSync(path.join(root, 'versions', '1.21.1', '1.21.1.json')));

  net.online = false;
  net.calls.length = 0;
  const v = versions();
  assert.equal(await v.ensureClientJar(root, '1.21.1'), false);
  assert.equal((await v.javaInfo('1.21.1')).major, 21);
  assert.equal((await v.versionMeta('1.21.1')).type, 'release');
  assert.equal(net.calls.length, 0, 'ни одного обращения к сети');

  // клиент повреждён, а связи нет: честная ошибка, а не запуск с битым файлом
  fs.writeFileSync(path.join(root, 'versions', '1.21.1', '1.21.1.jar'), 'broken');
  await assert.rejects(versions().ensureClientJar(root, '1.21.1'), /Нет связи/);
  // профиля нового мира на диске нет и сети нет
  await assert.rejects(versions().versionJson('1.20.1'), /Нет связи/);
});

test('тип и дату версии берём из профиля на диске, а профиль загрузчика (inheritsFrom) за ванильный не считаем', async (t) => {
  const { p, net, versions } = setup(t);
  const root = p.store.paths().root;
  put(root, { 'versions/1.21.1/1.21.1.json': JSON.stringify(VJSON('1.21.1')) });
  net.online = false;
  const m = await versions().versionMeta('1.21.1');
  assert.deepEqual({ type: m.type, hasDate: !!m.releaseTime }, { type: 'release', hasDate: true });
  put(root, { 'versions/1.20.1/1.20.1.json': JSON.stringify({ ...VJSON('1.20.1'), inheritsFrom: '1.19' }) });
  net.online = true;
  net.calls.length = 0;
  const j = await versions().versionJson('1.20.1');
  assert.ok(!j.inheritsFrom && net.calls.length >= 1, 'пошли за настоящим профилем');
});
