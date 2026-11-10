const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { sha1, LIBS, ASSETS, VANILLA, assetUrl, libUrl, setup: baseSetup } = require('./gamefiles-fixture');

const MC = '1.21.1';
const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const VERSION_URL = `https://piston-meta.example/${MC}.json`;
const CLIENT = Buffer.from('pretend client jar '.repeat(50));
const CLIENT_URL = 'https://piston-data.example/client.jar';
const VERSION_JSON = { id: MC, type: 'release', releaseTime: '2024-08-08T12:24:45+00:00', javaVersion: { majorVersion: 21, component: 'java-runtime-delta' }, downloads: { client: { sha1: sha1(CLIENT), size: CLIENT.length, url: CLIENT_URL } }, libraries: VANILLA.libraries, assetIndex: VANILLA.assetIndex };
const FABRIC_LIB = Buffer.from('fabric loader jar bytes');
const FABRIC_LIB_REL = 'net/fabricmc/fabric-loader/0.16.5/fabric-loader-0.16.5.jar';
const FABRIC_ID = `fabric-loader-0.16.5-${MC}`;
const FABRIC_PROFILE = { id: FABRIC_ID, inheritsFrom: MC, type: 'release', mainClass: 'net.fabricmc.loader.impl.launch.knot.KnotClient', libraries: [{ name: 'net.fabricmc:fabric-loader:0.16.5', downloads: { artifact: { path: FABRIC_LIB_REL, url: libUrl(FABRIC_LIB_REL), sha1: sha1(FABRIC_LIB), size: FABRIC_LIB.length } } }] };
const FABRIC_URL = `https://meta.fabricmc.net/v2/versions/loader/${MC}/0.16.5/profile/json`;
const json = (o) => Buffer.from(JSON.stringify(o));

function setup(t) {
  const s = baseSetup(t);
  s.served.set(MANIFEST_URL, json({ latest: { release: MC, snapshot: MC }, versions: [{ id: MC, type: 'release', releaseTime: VERSION_JSON.releaseTime, url: VERSION_URL }] }));
  s.served.set(VERSION_URL, json(VERSION_JSON));
  s.served.set(CLIENT_URL, CLIENT);
  s.served.set(FABRIC_URL, json(FABRIC_PROFILE));
  s.served.set(libUrl(FABRIC_LIB_REL), FABRIC_LIB);
  const p = s.p;
  // «Новый запуск лаунчера»: модули заново, память (кэш профилей версий) пуста
  const repair = () => {
    for (const k of Object.keys(require.cache)) if (/core[\\/](versions|repair|gamefiles)\.js$/.test(k)) delete require.cache[k];
    return p.load('core/repair');
  };
  const run = (o = {}, progress) => repair().run({ root: s.root, version: MC, loader: 'vanilla', loaderVersion: null, ...o }, { progress });
  const jar = path.join(s.root, 'versions', MC, `${MC}.jar`);
  const profile = path.join(s.root, 'versions', MC, `${MC}.json`);
  const fabricFile = path.join(s.root, 'versions', FABRIC_ID, `${FABRIC_ID}.json`);
  return { ...s, run, jar, profile, fabricFile, fabricLib: s.libFile(FABRIC_LIB_REL) };
}

test('чистая папка: клиент, профиль, библиотеки и ресурсы скачаны, в отчёте всё названо', async (t) => {
  const { run, jar, profile, assetFile } = setup(t);
  const r = await run();
  assert.deepEqual(fs.readFileSync(jar), CLIENT);
  assert.equal(JSON.parse(fs.readFileSync(profile, 'utf8')).id, MC);
  for (const b of Object.values(ASSETS)) assert.ok(fs.existsSync(assetFile(b)));
  assert.deepEqual(r, { version: MC, client: { fixed: true }, profile: { fixed: false }, loader: { name: null, state: 'vanilla' }, libraries: { checked: 2, fixed: 2 }, assets: { checked: 3, fixed: 3 } });
});

test('всё целое: повторная починка ничего не качает и обходится без сети (профиль уже на диске)', async (t) => {
  const { run, net } = setup(t);
  await run();
  net.calls.length = 0;
  net.online = false;
  const r = await run();
  assert.equal(net.calls.length, 0);
  assert.deepEqual([r.client.fixed, r.profile.fixed, r.libraries.fixed, r.assets.fixed], [false, false, 0, 0]);
  assert.deepEqual([r.libraries.checked, r.assets.checked], [2, 3]);
});

test('клиент игры повреждён (размер тот же, содержимое другое): скачивается заново', async (t) => {
  const { run, jar } = setup(t);
  await run();
  fs.writeFileSync(jar, Buffer.alloc(CLIENT.length, 'x'));
  const r = await run();
  assert.equal(r.client.fixed, true);
  assert.deepEqual(fs.readFileSync(jar), CLIENT);
});

test('ресурс повреждён тем же размером и библиотека испорчена: перекачиваются только они, цифры в отчёте верные', async (t) => {
  const { run, net, assetFile, libFile } = setup(t);
  await run();
  const [asset] = Object.values(ASSETS);
  const [lib] = Object.keys(LIBS);
  fs.writeFileSync(assetFile(asset), Buffer.alloc(asset.length, 'x'));
  fs.writeFileSync(libFile(lib), 'испорчено');
  net.calls.length = 0;
  const r = await run();
  assert.deepEqual(r.libraries, { checked: 2, fixed: 1 });
  assert.deepEqual(r.assets, { checked: 3, fixed: 1 });
  assert.deepEqual(net.calls.sort(), [assetUrl(asset), libUrl(lib)].sort());
  assert.deepEqual(fs.readFileSync(assetFile(asset)), asset);
});

test('профиль версии на диске оборван при записи: убирается и скачивается заново, об этом сказано', async (t) => {
  const { run, profile } = setup(t);
  await run();
  fs.writeFileSync(profile, '{"id":"1.21.1","libra');
  const r = await run();
  assert.equal(r.profile.fixed, true);
  assert.equal(JSON.parse(fs.readFileSync(profile, 'utf8')).id, MC);
});

test('Fabric: профиль загрузчика цел — проверяются его библиотеки; оборван — скачивается заново', async (t) => {
  const { run, fabricFile, fabricLib } = setup(t);
  const o = { loader: 'fabric', loaderVersion: '0.16.5' };
  let r = await run(o);
  assert.deepEqual(r.loader, { name: 'Fabric', state: 'fixed' }, 'на чистой папке профиля не было: он скачан');
  assert.deepEqual(fs.readFileSync(fabricLib), FABRIC_LIB, 'библиотека загрузчика проверена и лежит на месте');
  assert.equal(r.libraries.checked, 3, 'две ванильные и одна загрузчика');
  r = await run(o);
  assert.deepEqual(r.loader, { name: 'Fabric', state: 'ok' });
  fs.writeFileSync(fabricFile, '{"id":"fabric-loader');
  fs.writeFileSync(fabricLib, 'испорчено');
  r = await run(o);
  assert.deepEqual(r.loader, { name: 'Fabric', state: 'fixed' });
  assert.equal(JSON.parse(fs.readFileSync(fabricFile, 'utf8')).id, FABRIC_ID);
  assert.deepEqual(fs.readFileSync(fabricLib), FABRIC_LIB);
  assert.equal(r.libraries.fixed, 1);
});

test('Fabric, версия загрузчика ещё не выбрана (игра не запускалась): загрузчик не трогаем, в сеть за его профилем не ходим', async (t) => {
  const { run, net } = setup(t);
  const r = await run({ loader: 'fabric', loaderVersion: null });
  assert.deepEqual(r.loader, { name: 'Fabric', state: 'unknown-version' });
  assert.ok(!net.calls.some((u) => u.includes('fabricmc.net')));
});

test('Forge и NeoForge: их файлы ставит установщик при запуске — здесь не проверяются, об этом сказано', async (t) => {
  const { run } = setup(t);
  for (const [loader, name] of [['forge', 'Forge'], ['neoforge', 'NeoForge']]) {
    const r = await run({ loader, loaderVersion: '47.4.0' });
    assert.deepEqual(r.loader, { name, state: 'at-launch' });
  }
});

test('чужое не трогается: профили других версий, установщики, launcher_profiles.json и всё прочее в папке игры остаются', async (t) => {
  const { run, root } = setup(t);
  const keep = { 'launcher_profiles.json': '{"profiles":{}}', 'installers/forge-installer.jar': 'jar', 'versions/other/other.json': '{"id":"other"}', 'libraries/org/foreign/f/1/f-1.jar': 'чужая библиотека', 'assets/objects/ab/abcdef': 'чужой ресурс' };
  for (const [rel, text] of Object.entries(keep)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  await run();
  for (const [rel, text] of Object.entries(keep)) assert.equal(fs.readFileSync(path.join(root, rel), 'utf8'), text, rel);
});

test('прогресс: идут подписи про клиент, библиотеки и ресурсы, проценты — от 0 до 100', async (t) => {
  const { run, assetFile } = setup(t);
  await run();
  fs.writeFileSync(assetFile(Object.values(ASSETS)[0]), 'испорчено');
  const seen = [];
  await run({}, (label, percent) => seen.push([label, percent]));
  assert.ok(seen.some(([l]) => /клиент/i.test(l)), 'клиент');
  assert.ok(seen.some(([l]) => /Проверяю ресурсы игры/.test(l)), 'ресурсы');
  assert.ok(seen.every(([, pc]) => pc === null || (pc >= 0 && pc <= 100)));
});

test('нужно перекачать, а связи нет: честная ошибка, а не «всё в порядке»', async (t) => {
  const { run, net, jar } = setup(t);
  await run();
  fs.writeFileSync(jar, Buffer.alloc(CLIENT.length, 'x'));
  net.online = false;
  await assert.rejects(run(), /связи|fetch/i);
});
