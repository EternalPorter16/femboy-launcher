const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { profile, put } = require('./helpers');

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });

// Подменённые серверы загрузчиков. state.offline / state.promos500 включают сбои; calls считает обращения
function setup(t, state = {}) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    calls.push(u);
    if (state.offline) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
    const meta = /meta\.(fabricmc\.net|quiltmc\.org)\/v\d\/versions\/loader\/([\w.]+)$/.exec(u);
    if (meta) {
      if (meta[2] === '1.99') return json([]);
      if (meta[2] === '1.12.2' && meta[1] === 'quiltmc.org') return new Response('Not Found', { status: 404 });
      const rows = meta[1] === 'quiltmc.org' ? ['0.30.0-beta.8', '0.19.5', '0.30.0', '0.30.0-beta.2', '0.19.10'] : ['0.16.9', '0.20.1', '0.16.10', '0.15.11', '0.20.0-beta.1', '0.10.6+build.214'];
      return json(rows.map((v) => ({ loader: { version: v, stable: false } })));
    }
    if (/maven-metadata\.json$/.test(u)) return json({ '1.20.1': ['1.20.1-47.4.9', '1.20.1-47.4.28', '1.20.1-47.4.10', '1.20.1-47.4.28-weird'], '1.7.10': ['1.7.10-10.13.4.1614-1.7.10'], '1.12.2': ['1.12.2-14.23.5.2860', '1.12.2-14.23.5.2864'] });
    if (/promotions_slim\.json$/.test(u)) return state.promos500 ? new Response('упало', { status: 500 }) : json({ promos: { '1.20.1-recommended': '47.4.28', '1.20.1-latest': '47.4.28' } });
    if (/net\/neoforged\/(neoforge|forge)$/.test(u)) return json({ versions: /\/forge$/.test(u) ? ['1.20.1-47.1.5', '1.20.1-47.1.106'] : ['20.4.1', '21.0.1', '21.1.0-beta', '21.1.5', '21.1.77', '21.1.101', '21.10.3', '26.3.0.99'] });
    if (/\/profile\/json$/.test(u) || /-installer\.jar$/.test(u)) return new Response('нет такой версии', { status: 404 });
    return new Response('нет', { status: 404 });
  };
  const p = profile();
  t.after(() => {
    globalThis.fetch = real;
    p.done();
  });
  return { p, calls, loaders: p.load('core/loaders'), state };
}
const versionsOf = (r) => r.map((x) => x.version);

test('порядок версий: по числам, а не по буквам; релиз выше своих бета-версий', (t) => {
  const { loaders } = setup(t);
  const sort = (a) => [...a].sort(loaders.compareDesc);
  assert.deepEqual(sort(['0.16.9', '0.16.10', '0.2.0', '0.16.1']), ['0.16.10', '0.16.9', '0.16.1', '0.2.0']);
  assert.deepEqual(sort(['0.30.0-beta.2', '0.30.0', '0.30.0-beta.8', '0.29.9']), ['0.30.0', '0.30.0-beta.8', '0.30.0-beta.2', '0.29.9']);
  assert.deepEqual(sort(['21.1.0-beta', '21.1.77', '21.1.5', '21.1.101']), ['21.1.101', '21.1.77', '21.1.5', '21.1.0-beta']);
  assert.deepEqual(sort(['0.10.6+build.214', '0.10.6+build.213', '0.10.7']), ['0.10.7', '0.10.6+build.214', '0.10.6+build.213']);
  assert.deepEqual(sort(['1.0-rc.1', '1.0-beta.9', '1.0-pre.2', '1.0-alpha.3']), ['1.0-rc.1', '1.0-pre.2', '1.0-beta.9', '1.0-alpha.3']);
});

test('Fabric: версии под игру, новые первыми; последней считается новейшая не бета-версия', async (t) => {
  const { loaders } = setup(t);
  const r = await loaders.list('fabric', '1.21.1');
  assert.deepEqual(versionsOf(r), ['0.20.1', '0.20.0-beta.1', '0.16.10', '0.16.9', '0.15.11', '0.10.6+build.214']);
  assert.deepEqual(r.filter((x) => x.beta).map((x) => x.version), ['0.20.0-beta.1']);
  assert.deepEqual(r.filter((x) => x.tag).map((x) => [x.version, x.tag]), [['0.20.1', 'latest']]);
  await assert.rejects(loaders.list('fabric', '1.99'), /Fabric не поддерживает 1\.99/);
});

test('Quilt: беты вперемешку с релизами выстраиваются правильно', async (t) => {
  const { loaders } = setup(t);
  const r = await loaders.list('quilt', '1.21.1');
  assert.deepEqual(versionsOf(r), ['0.30.0', '0.30.0-beta.8', '0.30.0-beta.2', '0.19.10', '0.19.5']);
  assert.equal(r.find((x) => x.tag === 'latest').version, '0.30.0');
  await assert.rejects(loaders.list('quilt', '1.12.2'), /^Error: Quilt не поддерживает 1\.12\.2$/, 'сервер Quilt отвечает 404 — для человека это «не поддерживает»');
});

test('Forge: версии игры и загрузчика разделяются, «рекомендуемая» берётся у самого Forge, мусор отбрасывается', async (t) => {
  const { loaders } = setup(t);
  const r = await loaders.list('forge', '1.20.1');
  assert.deepEqual(versionsOf(r), ['47.4.28', '47.4.10', '47.4.9'], 'версия с хвостом «-weird» не берётся');
  assert.deepEqual(r.filter((x) => x.tag).map((x) => [x.version, x.tag]), [['47.4.28', 'recommended']]);
  assert.deepEqual(versionsOf(await loaders.list('forge', '1.12.2')), ['14.23.5.2864', '14.23.5.2860']);
  await assert.rejects(loaders.list('forge', '1.7.10'), /Forge для 1\.7\.10 не найден/, 'у совсем старых игр версии в другом виде — их не предлагаем');
  await assert.rejects(loaders.list('forge', '9.9'), /Forge для 9\.9 не найден/);
});

test('Forge: без подсказок «рекомендуемая» (сервер подсказок упал) список всё равно есть, «последняя» — новейшая', async (t) => {
  const { loaders } = setup(t, { promos500: true });
  const r = await loaders.list('forge', '1.20.1');
  assert.deepEqual(versionsOf(r), ['47.4.28', '47.4.10', '47.4.9']);
  assert.deepEqual(r.filter((x) => x.tag).map((x) => [x.version, x.tag]), [['47.4.28', 'latest']]);
});

test('NeoForge: версии по номеру игры (1.21.1 → 21.1.x, 26.3 → 26.3.x), для 1.20.1 — старое имя пакета', async (t) => {
  const { loaders } = setup(t);
  assert.deepEqual(versionsOf(await loaders.list('neoforge', '1.21.1')), ['21.1.101', '21.1.77', '21.1.5', '21.1.0-beta'], '21.10.3 — это уже игра 1.21.10');
  assert.equal((await loaders.list('neoforge', '1.21.1')).find((x) => x.beta).version, '21.1.0-beta');
  assert.deepEqual(versionsOf(await loaders.list('neoforge', '26.3')), ['26.3.0.99']);
  assert.deepEqual(versionsOf(await loaders.list('neoforge', '1.20.1')), ['47.1.106', '47.1.5']);
  await assert.rejects(loaders.list('neoforge', '1.19.2'), /NeoForge для 1\.19\.2 не найден/);
});

test('список держится в памяти недолго и не запоминает сбои', async (t) => {
  const { loaders, calls, state } = setup(t);
  await loaders.list('fabric', '1.21.1');
  await loaders.list('fabric', '1.21.1');
  assert.equal(calls.filter((c) => /fabricmc/.test(c)).length, 1, 'второй раз из памяти');
  await loaders.list('fabric', '1.20.1');
  assert.equal(calls.filter((c) => /fabricmc/.test(c)).length, 2, 'другая игра — другой список');

  state.offline = true;
  await assert.rejects(loaders.list('quilt', '1.21.1'), (e) => e.name !== 'AssertionError');
  state.offline = false;
  assert.ok((await loaders.list('quilt', '1.21.1')).length, 'связь вернулась — сбой не застрял в памяти');
});

test('плохие запросы: vanilla и выдуманный загрузчик, мусор вместо версии игры', async (t) => {
  const { loaders } = setup(t);
  await assert.rejects(loaders.list('vanilla', '1.21.1'), /Неизвестный загрузчик/);
  await assert.rejects(loaders.list('fabric', '../../x'), /Некорректная версия/);
});

const jar = (files) => {
  const z = new AdmZip();
  for (const [name, text] of Object.entries(files)) z.addFile(name, Buffer.from(text));
  return z.toBuffer();
};

test('моды, которым нужен более свежий загрузчик, находятся по их описаниям; выключенные и чужие загрузчики не считаются', (t) => {
  const { p, loaders } = setup(t);
  const instances = p.load('core/instances');
  const fab = instances.create({ name: 'F', version: '1.21.1', loader: 'fabric' });
  const need = (v) => jar({ 'fabric.mod.json': JSON.stringify({ schemaVersion: 1, id: 'm' + v, name: 'Мод ' + v, version: '1', depends: { fabricloader: v, minecraft: '1.21.x' } }) });
  put(instances.gameDir(fab.id), {
    'mods/new.jar': need('>=0.16.0'),
    'mods/old.jar': need('>=0.14.0'),
    'mods/free.jar': jar({ 'fabric.mod.json': JSON.stringify({ schemaVersion: 1, id: 'free', version: '1' }) }),
    'mods/off.jar.disabled': need('>=0.99.0'),
  });
  assert.deepEqual(loaders.check(fab.id, 'fabric', '0.15.7'), [{ title: 'Мод >=0.16.0', need: '>=0.16.0' }]);
  assert.deepEqual(loaders.check(fab.id, 'fabric', '0.16.2'), []);
  assert.deepEqual(loaders.check(fab.id, 'forge', '47.4.0'), [], 'у Forge условия на загрузчик не читаются');
  assert.deepEqual(loaders.check(fab.id, 'fabric', ''), []);

  const quilt = instances.create({ name: 'Q', version: '1.21.1', loader: 'quilt' });
  put(instances.gameDir(quilt.id), { 'mods/q.jar': jar({ 'quilt.mod.json': JSON.stringify({ schema_version: 1, quilt_loader: { id: 'qmod', version: '1', metadata: { name: 'Квилт-мод' }, depends: [{ id: 'quilt_loader', versions: '>=0.20.0' }] } }) }) });
  assert.deepEqual(loaders.check(quilt.id, 'quilt', '0.19.0'), [{ title: 'Квилт-мод', need: '>=0.20.0' }]);
  assert.deepEqual(loaders.check(quilt.id, 'quilt', '0.30.0'), []);

  const empty = instances.create({ name: 'E', version: '1.21.1', loader: 'fabric' });
  assert.deepEqual(loaders.check(empty.id, 'fabric', '0.1.0'), []);
  assert.equal(fs.existsSync(path.join(instances.gameDir(empty.id), 'mods')), false, 'проверка не создаёт папку модов');
});

test('сохранение сборки: версия загрузчика остаётся, пока не меняется игра или загрузчик; новая переданная вместе со сменой — сохраняется', (t) => {
  const { p } = setup(t);
  const instances = p.load('core/instances');
  const inst = instances.create({ name: 'Т', version: '1.20.1', loader: 'fabric', loaderVersion: '0.15.7' });
  assert.equal(instances.update(inst.id, { name: 'Т2' }).loaderVersion, '0.15.7', 'правка названия не трогает версию загрузчика');
  assert.equal(instances.update(inst.id, { loaderVersion: '0.16.9' }).loaderVersion, '0.16.9', 'выбрали другую');
  assert.equal(instances.update(inst.id, { loaderVersion: null }).loaderVersion, null, '«последняя»: поставится при запуске');
  instances.update(inst.id, { loaderVersion: '0.16.9' });
  assert.equal(instances.update(inst.id, { version: '1.21.1' }).loaderVersion, null, 'новая игра без явного выбора — старая версия загрузчика ей не подходит');
  assert.equal(instances.update(inst.id, { version: '1.20.1', loaderVersion: '0.15.11' }).loaderVersion, '0.15.11', 'смена игры вместе с выбором — выбор сохраняется');
  assert.equal(instances.update(inst.id, { loader: 'quilt' }).loaderVersion, null);
  assert.equal(instances.update(inst.id, { loaderVersion: 'не версия/../' }).loaderVersion, null, 'мусор отбрасывается');
});

test('такой версии у загрузчика нет: понятная ошибка про настройки сборки вместо «HTTP 404»', async (t) => {
  const { p } = setup(t);
  const versions = p.load('core/versions');
  await assert.rejects(versions.installLoader(p.dir, '1.21.1', 'fabric', '9.9.9'), /Fabric 9\.9\.9 для Minecraft 1\.21\.1 не найден — выбери другую версию загрузчика в настройках сборки/);
  const forge = p.load('core/forge');
  await assert.rejects(forge.install(p.dir, '1.20.1', 'forge', '99.9.9', 'java', {}), /Forge 99\.9\.9 для Minecraft 1\.20\.1 не найден — выбери другую версию загрузчика/);
  assert.equal(fs.existsSync(path.join(p.dir, 'installers', 'forge-1.20.1-99.9.9-installer.jar.part')), false, 'недокачанного файла не осталось');
});
