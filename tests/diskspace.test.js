const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { profile } = require('./helpers');
const { ASSETS, setup: baseSetup } = require('./gamefiles-fixture');

const MB = 1048576;
// Подменяем ответ системы о свободном месте: free — сколько байт свободно (null — система не отвечает); calls — сколько раз спросили и о какой папке
function disk(t, free) {
  const real = fs.promises.statfs;
  const calls = [];
  fs.promises.statfs = async (dir) => {
    calls.push(dir);
    if (free === null) throw new Error('statfs не поддерживается');
    return { bavail: free, bsize: 1 };
  };
  t.after(() => (fs.promises.statfs = real));
  return calls;
}
const load = (t) => {
  const p = profile();
  t.after(() => p.done());
  return { p, diskspace: p.load('core/diskspace') };
};

test('свободное место узнаётся для существующей папки и для ещё не созданной (берётся ближайшая папка выше)', async (t) => {
  const { p, diskspace } = load(t);
  assert.ok((await diskspace.free(p.dir)) > 0);
  assert.ok((await diskspace.free(path.join(p.dir, 'нет', 'такой', 'папки'))) > 0);
});

test('места хватает с запасом: ничего не происходит', async (t) => {
  const { diskspace } = load(t);
  disk(t, 5000 * MB);
  await diskspace.ensure(os_tmp(), 100 * MB);
});

test('места не хватает: понятная ошибка с цифрами и подсказкой, что делать', async (t) => {
  const { diskspace } = load(t);
  disk(t, 150 * MB);
  await assert.rejects(diskspace.ensure(os_tmp(), 100 * MB), (e) => {
    assert.match(e.message, /^На диске не хватает места для загрузки: нужно около \d+ МБ, свободно 150 МБ\./);
    assert.match(e.message, /Освободить место/);
    return true;
  });
});

test('нужно столько, сколько свободно, плюс запас на распаковку: запас учитывается', async (t) => {
  const { diskspace } = load(t);
  disk(t, 1000 * MB);
  await diskspace.ensure(os_tmp(), 700 * MB); // 700 + запас ещё влезает
  await assert.rejects(diskspace.ensure(os_tmp(), 990 * MB), /не хватает места/);
});

test('система о месте не отвечает: загрузке не мешаем', async (t) => {
  const { diskspace } = load(t);
  disk(t, null);
  await diskspace.ensure(os_tmp(), 10000 * MB);
});

test('качать нечего (ноль, пусто, не число): к системе даже не обращаемся', async (t) => {
  const { diskspace } = load(t);
  const calls = disk(t, 1);
  for (const need of [0, -5, NaN, undefined, null]) await diskspace.ensure(os_tmp(), need);
  assert.equal(calls.length, 0);
});

// Загрузки: докачка файлов игры и клиент проверяют место до первого запроса
test('докачка файлов игры при нехватке места: ни одного запроса и ни одного файла, ошибка понятная', async (t) => {
  const { p, root, net } = baseSetup(t);
  disk(t, 1 * MB);
  const gamefiles = p.load('core/gamefiles');
  const { VANILLA } = require('./gamefiles-fixture');
  const big = { ...VANILLA, assetIndex: { ...VANILLA.assetIndex } };
  await assert.rejects(gamefiles.prefetch(root, bigSized(big), null, () => {}), /не хватает места/);
  assert.equal(net.calls.length, 0, 'до проверки места в сеть не ходили');
  assert.ok(!fs.existsSync(path.join(root, 'libraries')) || fs.readdirSync(path.join(root, 'libraries')).length === 0);
});

test('ресурсы игры не влезают (библиотеки маленькие): библиотеки скачались, а перед ресурсами — ошибка про место, ресурсы не тронуты', async (t) => {
  const { p, root, net, served } = baseSetup(t);
  const { INDEX, VANILLA, sha1 } = require('./gamefiles-fixture');
  const big = JSON.parse(INDEX.toString());
  for (const o of Object.values(big.objects)) o.size = 600 * MB; // по индексу каждый ресурс огромный
  const idx = Buffer.from(JSON.stringify(big));
  served.set(VANILLA.assetIndex.url, idx);
  const vanilla = { ...VANILLA, assetIndex: { ...VANILLA.assetIndex, sha1: sha1(idx), size: idx.length } };
  disk(t, 1000 * MB);
  await assert.rejects(p.load('core/gamefiles').prefetch(root, vanilla, null, () => {}), /не хватает места/);
  assert.ok(net.calls.some((u) => u.startsWith('https://libraries.example/')), 'библиотеки скачались');
  assert.ok(!net.calls.some((u) => u.startsWith('https://resources.download.minecraft.net/')), 'до ресурсов дело не дошло');
});

test('докачка файлов игры, когда места хватает: качает как обычно', async (t) => {
  const { p, root, net } = baseSetup(t);
  disk(t, 100000 * MB);
  const r = await p.load('core/gamefiles').prefetch(root, require('./gamefiles-fixture').VANILLA, null, () => {});
  assert.equal(r.assets.fixed, Object.keys(ASSETS).length);
  assert.ok(net.calls.length > 0);
});

test('докачка, когда качать нечего (всё на месте): место не проверяется', async (t) => {
  const { p, root } = baseSetup(t);
  const calls = disk(t, 100000 * MB);
  const gamefiles = p.load('core/gamefiles');
  const { VANILLA } = require('./gamefiles-fixture');
  await gamefiles.prefetch(root, VANILLA, null, () => {});
  calls.length = 0;
  await gamefiles.prefetch(root, VANILLA, null, () => {});
  assert.equal(calls.length, 0);
});

test('клиент игры: при нехватке места не качается', async (t) => {
  const { p, root, net, served } = baseSetup(t);
  const client = Buffer.from('client jar bytes'.repeat(100));
  const sha1 = require('crypto').createHash('sha1').update(client).digest('hex');
  const vjson = { id: '1.21.1', type: 'release', releaseTime: '2024-08-08T12:24:45+00:00', downloads: { client: { sha1, size: 500 * MB, url: 'https://piston-data.example/client.jar' } }, libraries: [] };
  served.set('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json', Buffer.from(JSON.stringify({ latest: { release: '1.21.1', snapshot: '1.21.1' }, versions: [{ id: '1.21.1', type: 'release', releaseTime: vjson.releaseTime, url: 'https://piston-meta.example/1.21.1.json' }] })));
  served.set('https://piston-meta.example/1.21.1.json', Buffer.from(JSON.stringify(vjson)));
  served.set('https://piston-data.example/client.jar', client);
  disk(t, 100 * MB);
  await assert.rejects(p.load('core/versions').ensureClientJar(root, '1.21.1'), /не хватает места/);
  assert.ok(!net.calls.includes('https://piston-data.example/client.jar'));
  assert.ok(!fs.existsSync(path.join(root, 'versions', '1.21.1', '1.21.1.jar')));
});

// Размеры в профиле версии — то, по чему лаунчер знает, сколько скачивать: делаем их огромными
function bigSized(v) {
  return { ...v, libraries: v.libraries.map((l) => ({ ...l, downloads: { artifact: { ...l.downloads.artifact, size: 400 * MB } } })) };
}
function os_tmp() {
  return require('os').tmpdir();
}
