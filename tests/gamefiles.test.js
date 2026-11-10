const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { sha1, LIBS, ASSETS, INDEX, VANILLA, assetUrl, libUrl, setup: baseSetup } = require('./gamefiles-fixture');

function setup(t) {
  const s = baseSetup(t);
  const prefetch = (opts) => s.p.load('core/gamefiles').prefetch(s.root, VANILLA, null, () => {}, opts);
  return { ...s, prefetch };
}

test('чистая папка: библиотеки, индекс и ресурсы скачиваются, и всё лежит на своих местах', async (t) => {
  const { root, net, prefetch, libFile, assetFile } = setup(t);
  const r = await prefetch();
  for (const [rel, b] of Object.entries(LIBS)) assert.deepEqual(fs.readFileSync(libFile(rel)), b);
  for (const b of Object.values(ASSETS)) assert.deepEqual(fs.readFileSync(assetFile(b)), b);
  assert.deepEqual(fs.readFileSync(path.join(root, 'assets', 'indexes', '17.json')), INDEX);
  assert.equal(net.calls.length, 2 + 1 + 3, 'библиотеки, индекс и ресурсы — по одному запросу');
  assert.deepEqual(r, { libraries: { checked: 2, fixed: 2 }, assets: { checked: 3, fixed: 3 } });
});

test('всё уже на месте: ни одного обращения к сети, в итоге ничего не исправлено', async (t) => {
  const { net, prefetch } = setup(t);
  await prefetch();
  net.calls.length = 0;
  const r = await prefetch();
  assert.equal(net.calls.length, 0);
  assert.deepEqual(r, { libraries: { checked: 2, fixed: 0 }, assets: { checked: 3, fixed: 0 } });
});

test('библиотека с неверным хэшем перекачивается, верная не трогается', async (t) => {
  const { net, prefetch, libFile } = setup(t);
  await prefetch();
  const [bad, good] = Object.keys(LIBS);
  fs.writeFileSync(libFile(bad), 'испорчено');
  net.calls.length = 0;
  const r = await prefetch();
  assert.deepEqual(fs.readFileSync(libFile(bad)), LIBS[bad]);
  assert.deepEqual(net.calls, [libUrl(bad)], 'только про испорченную');
  assert.equal(r.libraries.fixed, 1);
  assert.deepEqual(fs.readFileSync(libFile(good)), LIBS[good]);
});

test('ресурса нет — докачивается; индекс ресурсов повреждён — скачивается заново', async (t) => {
  const { root, net, prefetch, assetFile } = setup(t);
  await prefetch();
  const [first, second] = Object.values(ASSETS);
  fs.rmSync(assetFile(first));
  fs.writeFileSync(path.join(root, 'assets', 'indexes', '17.json'), '{"объекты":');
  net.calls.length = 0;
  const r = await prefetch();
  assert.deepEqual(fs.readFileSync(assetFile(first)), first);
  assert.deepEqual(net.calls.sort(), [VANILLA.assetIndex.url, assetUrl(first)].sort());
  assert.deepEqual(r.assets, { checked: 3, fixed: 1 });
  assert.deepEqual(fs.readFileSync(assetFile(second)), second);
});

test('ресурс оборван на середине (размер не тот) — докачивается уже при обычном запуске', async (t) => {
  const { net, prefetch, assetFile } = setup(t);
  await prefetch();
  const [cut] = Object.values(ASSETS);
  fs.writeFileSync(assetFile(cut), cut.subarray(0, 5));
  net.calls.length = 0;
  const r = await prefetch();
  assert.deepEqual(fs.readFileSync(assetFile(cut)), cut);
  assert.deepEqual(net.calls, [assetUrl(cut)]);
  assert.equal(r.assets.fixed, 1);
});

test('обычный запуск не читает ресурсы целиком: файл того же размера с другим содержимым остаётся (быстрый запуск)', async (t) => {
  const { net, prefetch, assetFile } = setup(t);
  await prefetch();
  const [victim] = Object.values(ASSETS);
  fs.writeFileSync(assetFile(victim), Buffer.alloc(victim.length, 'x'));
  net.calls.length = 0;
  const r = await prefetch();
  assert.equal(net.calls.length, 0);
  assert.equal(r.assets.fixed, 0);
});

test('глубокая проверка (починка): ресурс того же размера, но с другим содержимым, находится и перекачивается', async (t) => {
  const { net, prefetch, assetFile } = setup(t);
  await prefetch();
  const [victim, other] = Object.values(ASSETS);
  fs.writeFileSync(assetFile(victim), Buffer.alloc(victim.length, 'x'));
  net.calls.length = 0;
  const r = await prefetch({ deep: true });
  assert.deepEqual(fs.readFileSync(assetFile(victim)), victim);
  assert.deepEqual(net.calls, [assetUrl(victim)], 'про целые ресурсы в сеть не ходим');
  assert.deepEqual(r.assets, { checked: 3, fixed: 1 });
  assert.deepEqual(fs.readFileSync(assetFile(other)), other);
});

test('глубокая проверка целой папки: исправлять нечего — ни одного запроса', async (t) => {
  const { net, prefetch } = setup(t);
  await prefetch();
  net.calls.length = 0;
  const r = await prefetch({ deep: true });
  assert.equal(net.calls.length, 0);
  assert.deepEqual(r, { libraries: { checked: 2, fixed: 0 }, assets: { checked: 3, fixed: 0 } });
});

test('прогресс: подписи про библиотеки и ресурсы идут, а проценты — от 0 до 100', async (t) => {
  const { p, root } = setup(t);
  const seen = [];
  await p.load('core/gamefiles').prefetch(root, VANILLA, null, (label, percent) => seen.push([label, percent]));
  assert.ok(seen.some(([l]) => /библиотеки/.test(l)) && seen.some(([l]) => /ресурсы/.test(l)));
  assert.ok(seen.every(([, pc]) => pc === null || (pc >= 0 && pc <= 100)));
});

test('один и тот же ресурс под двумя именами в индексе качается и считается один раз', async (t) => {
  const { p, root, net, served } = setup(t);
  const dup = { ...JSON.parse(INDEX.toString()) };
  dup.objects['minecraft/sounds/copy.ogg'] = dup.objects['minecraft/sounds/a.ogg'];
  const idx = Buffer.from(JSON.stringify(dup));
  const vanilla = { ...VANILLA, assetIndex: { ...VANILLA.assetIndex, sha1: sha1(idx), size: idx.length } };
  served.set(VANILLA.assetIndex.url, idx);
  const r = await p.load('core/gamefiles').prefetch(root, vanilla, null, () => {});
  assert.deepEqual(r.assets, { checked: 3, fixed: 3 });
  assert.equal(net.calls.filter((u) => u === assetUrl(ASSETS['minecraft/sounds/a.ogg'])).length, 1);
});

test('нет связи, а перекачать нужно: ошибка про связь, а не тихий пропуск', async (t) => {
  const { net, prefetch, libFile } = setup(t);
  await prefetch();
  fs.writeFileSync(libFile(Object.keys(LIBS)[0]), 'испорчено');
  net.online = false;
  await assert.rejects(prefetch(), /связи|fetch/i);
});

test('профиль загрузчика (custom) добавляет свои библиотеки к ванильным, повторы не качаются дважды', async (t) => {
  const { p, root, served } = setup(t);
  const extra = Buffer.from('loader library bytes');
  const rel = 'net/loader/lib/1.0/lib-1.0.jar';
  served.set(libUrl(rel), extra);
  const custom = { libraries: [{ name: 'a:b:1', downloads: { artifact: { path: rel, url: libUrl(rel), sha1: sha1(extra), size: extra.length } } }, VANILLA.libraries[0]] };
  const r = await p.load('core/gamefiles').prefetch(root, VANILLA, custom, () => {});
  assert.equal(r.libraries.checked, 3, 'две ванильные и одна своя, общая считается один раз');
  assert.deepEqual(fs.readFileSync(path.join(root, 'libraries', rel)), extra);
});
