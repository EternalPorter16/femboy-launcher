const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const { profile, put, dump } = require('./helpers');

const sha1 = (b) => crypto.createHash('sha1').update(b).digest('hex');
const jar = (id, { version = '1.0', name, depends = {} } = {}) => {
  const z = new AdmZip();
  z.addFile('fabric.mod.json', Buffer.from(JSON.stringify({ schemaVersion: 1, id, name: name || id, version, depends })));
  z.addFile('marker.txt', Buffer.from(`${id} ${version} ${crypto.randomBytes(4).toString('hex')}`)); // у каждого файла свой хэш
  return z.toBuffer();
};

const MANIFEST = {
  latest: { release: '1.21.5', snapshot: '1.21.5' },
  versions: ['1.21.5', '1.21.4', '1.21.1'].map((id) => ({ id, type: 'release', releaseTime: '2024-12-03T10:00:00+00:00', url: `https://piston-meta.mojang.com/v1/packages/x/${id}.json` })),
};
const PROJECTS = { AANobbMI: 'Sodium', P7dR8mSH: 'Fabric API', gvQqBUqZ: 'Lithium', ZOOM0001: 'Zoomify', GONE0001: 'Gone Mod', P_CLOTH: 'Cloth Config', P_NOLIB: 'No Lib' };

// Старая сборка на 1.21.1 и «Modrinth» из подмены fetch: что обновилось, что подошло как есть, чего под 1.21.4 нет
const OLD = {
  sodium: jar('sodium', { version: '0.5.8', depends: { minecraft: '1.21.x', 'fabric-api': '*' } }),
  fapi: jar('fabric-api', { version: '0.100.0' }),
  lithium: jar('lithium', { version: '0.14.0', name: 'Lithium' }),
  zoomify: jar('zoomify', { version: '1.0' }),
  gone: jar('gone', { version: '1.0' }),
  declared: jar('declared', { version: '1.0', name: 'Declared Mod', depends: { minecraft: '>=1.21' } }),
  stranger: jar('stranger', { version: '1.0', name: 'Stranger Mod', depends: { minecraft: '1.20.x' } }),
};
const NEW = {
  sodium: (dep) => jar('sodium', { version: '0.6.0', depends: { minecraft: '>=1.21.4', 'fabric-api': '>=0.100', [dep === 'P_CLOTH' ? 'cloth-config' : 'no-lib']: '*' } }),
  fapi: jar('fabric-api', { version: '0.110.0' }),
  zoomify: jar('zoomify', { version: '2.0' }),
  cloth: jar('cloth-config', { version: '1.0' }),
};

// Моды «с CurseForge» (лаунчер ставил их сам, id проекта в записи): новая версия, файла под 1.21.4 нет, автор запретил скачивание
const CF = { fresh: jar('cfmod', { version: '2.0' }) };

function setup(t, { dep = 'P_CLOTH', broken = [], cf = false } = {}) {
  const real = globalThis.fetch;
  const calls = [];
  const sodium = NEW.sodium(dep);
  const files = { 'sodium-0.6.0.jar': sodium, 'fabric-api-0.110.jar': NEW.fapi, 'zoomify-2.0.jar': NEW.zoomify, 'cloth-config-1.0.jar': NEW.cloth, 'cfmod-2.0.jar': CF.fresh };
  const ver = (project, number, filename, bytes, deps = []) => ({
    id: `v-${project}-${number}`,
    project_id: project,
    version_number: number,
    version_type: 'release',
    loaders: ['fabric'],
    files: [{ primary: true, url: `https://cdn.modrinth.com/data/${project}/versions/${number}/${filename}`, filename, hashes: { sha1: sha1(bytes) } }],
    dependencies: deps.map((p) => ({ project_id: p, dependency_type: 'required' })),
  });
  const update = {
    [sha1(OLD.sodium)]: ver('AANobbMI', '0.6.0', 'sodium-0.6.0.jar', sodium, [dep, 'P7dR8mSH']),
    [sha1(OLD.fapi)]: ver('P7dR8mSH', '0.110.0', 'fabric-api-0.110.jar', NEW.fapi),
    [sha1(OLD.lithium)]: { ...ver('gvQqBUqZ', '0.14.0', 'lithium-0.14.jar', OLD.lithium) }, // файл тот же: подходит как есть
    [sha1(OLD.zoomify)]: ver('ZOOM0001', '2.0', 'zoomify-2.0.jar', NEW.zoomify),
  };
  const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ url: u, method: opts.method || 'GET', body });
    if (/version_manifest_v2\.json$/.test(u)) return json(MANIFEST);
    const loader = /meta\.(fabricmc\.net|quiltmc\.org)\/v\d\/versions\/loader\/([\w.]+)$/.exec(u);
    if (loader) return json(loader[2] === '1.21.5' ? [] : [{ loader: { version: '0.16.9', stable: true } }]);
    if (/api\.modrinth\.com\/v2\/version_files\/update$/.test(u)) return json(Object.fromEntries(body.hashes.filter((h) => update[h]).map((h) => [h, update[h]])));
    if (/api\.modrinth\.com\/v2\/version_files$/.test(u)) return json(sha1(OLD.gone) && body.hashes.includes(sha1(OLD.gone)) ? { [sha1(OLD.gone)]: { project_id: 'GONE0001', version_number: '1.0' } } : {});
    const ids = /api\.modrinth\.com\/v2\/projects\?ids=(.+)$/.exec(u);
    if (ids) return json(JSON.parse(decodeURIComponent(ids[1])).filter((id) => PROJECTS[id]).map((id) => ({ id, title: PROJECTS[id], icon_url: null })));
    const versionsOf = /api\.modrinth\.com\/v2\/project\/(\w+)\/version\?/.exec(u);
    if (versionsOf) return json(versionsOf[1] === 'P_CLOTH' ? [ver('P_CLOTH', '1.0', 'cloth-config-1.0.jar', NEW.cloth)] : []);
    const project = /api\.modrinth\.com\/v2\/project\/(\w+)$/.exec(u);
    if (project && PROJECTS[project[1]]) return json({ id: project[1], title: PROJECTS[project[1]], icon_url: null });
    const cfFiles = /api\.curseforge\.com\/v1\/mods\/(\d+)\/files\?/.exec(u);
    if (cfFiles) {
      assert.equal(opts.headers?.['x-api-key'], 'test-key', 'CurseForge спрашиваем с ключом пользователя');
      assert.match(u, /gameVersion=1\.21\.4&modLoaderType=4/, 'под новую версию и Fabric');
      const f = { fileName: 'cfmod-2.0.jar', displayName: 'CF Mod 2.0', releaseType: 1, fileDate: '2025-01-01', downloadUrl: 'https://edge.forgecdn.net/files/cfmod-2.0.jar', hashes: [{ algo: 1, value: sha1(CF.fresh) }] };
      return json({ data: cfFiles[1] === '111' ? [f] : cfFiles[1] === '333' ? [{ ...f, downloadUrl: null }] : [] });
    }
    const file = /(?:cdn\.modrinth\.com\/data\/\w+\/versions\/[\w.]+|edge\.forgecdn\.net\/files)\/([\w.-]+)$/.exec(u);
    if (file && files[file[1]] && !broken.includes(file[1])) return new Response(files[file[1]], { status: 200, headers: { 'content-length': String(files[file[1]].length) } });
    return new Response('нет такого', { status: 404 });
  };
  const p = profile();
  t.after(() => {
    globalThis.fetch = real;
    p.done();
  });
  const instances = p.load('core/instances');
  const mods = p.load('core/mods');
  const inst = instances.create({ name: 'Шейдерная красота', version: '1.21.1', loader: 'fabric', maxRam: 6144, group: 'Друзья' });
  const g = instances.gameDir(inst.id);
  put(g, {
    'mods/sodium-0.5.8.jar': OLD.sodium,
    'mods/fabric-api-0.100.jar': OLD.fapi,
    'mods/lithium-0.14.jar': OLD.lithium,
    'mods/zoomify-1.0.jar.disabled': OLD.zoomify,
    'mods/gone.jar': OLD.gone,
    'mods/declared.jar': OLD.declared,
    'mods/stranger.jar': OLD.stranger,
    'config/sodium-options.json': '{"quality":"ultra"}',
    'options.txt': 'renderDistance:16\n',
    'resourcepacks/pack.zip': 'pack-bytes',
    'shaderpacks/s.zip': 'shader-bytes',
    'saves/World1/level.dat': 'level',
    'saves/World1/region/r.0.0.mca': 'region',
    'saves/World1/session.lock': 'lock',
    'logs/latest.log': 'log',
    'crash-reports/c.txt': 'crash',
    '.fabric/processedMods/x.jar': 'remapped',
  });
  put(instances.dirOf(inst.id), { 'backups/b.zip': 'backup', 'pack-files.json': '["mods/old.jar"]', 'origins.json': '{}' });
  mods.record(inst.id, 'sodium-0.5.8.jar', { source: 'modrinth', projectId: 'AANobbMI', title: 'Sodium', icon: 'https://cdn.modrinth.com/s.png', version: '0.5.8' });
  mods.record(inst.id, 'pack.zip', { source: 'modrinth', projectId: 'RP000001', title: 'Мой пак' }, 'resourcepack');
  if (cf) {
    p.store.get().settings.cfApiKey = 'test-key';
    put(g, { 'mods/cfmod-1.0.jar': jar('cfmod', { version: '1.0' }), 'mods/cfgone.jar': jar('cfgone'), 'mods/cfblocked.jar': jar('cfblocked') });
    mods.record(inst.id, 'cfmod-1.0.jar', { source: 'curseforge', projectId: '111', title: 'CF Mod', version: '1.0' });
    mods.record(inst.id, 'cfgone.jar', { source: 'curseforge', projectId: '222', title: 'CF Gone' });
    mods.record(inst.id, 'cfblocked.jar', { source: 'curseforge', projectId: '333', title: 'CF Blocked' });
  }
  return { p, calls, inst, g, instances, mods, sodium, store: p.store, migrate: p.load('core/migrate'), net: p.load('core/net') };
}

test('план: что обновится, что подойдёт как есть, чего нет под новую версию — и старая сборка при этом не меняется', async (t) => {
  const { inst, instances, calls, migrate } = setup(t);
  const before = dump(instances.dirOf(inst.id));
  const pl = await migrate.plan(inst.id, '1.21.4');
  assert.deepEqual(pl.counts, { total: 7, update: 3, same: 2, missing: 1, unknown: 1, failed: 0 });
  const by = Object.fromEntries(pl.mods.map((m) => [m.file, m]));
  assert.deepEqual([by['sodium-0.5.8.jar'].status, by['sodium-0.5.8.jar'].from, by['sodium-0.5.8.jar'].to, by['sodium-0.5.8.jar'].title], ['update', '0.5.8', '0.6.0', 'Sodium']);
  assert.equal(by['lithium-0.14.jar'].status, 'same');
  assert.equal(by['lithium-0.14.jar'].title, 'Lithium', 'названия мода без записи лаунчера берутся с Modrinth');
  assert.equal(by['zoomify-1.0.jar'].enabled, false, 'выключенный мод остаётся выключенным');
  assert.equal(by['zoomify-1.0.jar'].status, 'update');
  assert.deepEqual([by['gone.jar'].status, by['gone.jar'].title], ['missing', 'Gone Mod'], 'Modrinth мод знает, но файла под 1.21.4 нет');
  assert.deepEqual([by['declared.jar'].status, by['declared.jar'].declared, by['declared.jar'].title], ['same', true, 'Declared Mod'], 'не с Modrinth, но сам мод заявляет поддержку новой версии');
  assert.deepEqual([by['stranger.jar'].status, by['stranger.jar'].title], ['unknown', 'Stranger Mod'], 'не с Modrinth и поддержка не заявлена');
  assert.deepEqual(pl.extras, [{ projectId: 'P_CLOTH', title: 'Cloth Config', requiredBy: ['Sodium'], available: true }], 'нужная новому Sodium библиотека, которой в сборке нет');
  assert.deepEqual([pl.from, pl.to, pl.loader, pl.loaderVersion], ['1.21.1', '1.21.4', 'fabric', '0.16.9']);
  assert.deepEqual(pl.worlds, { count: 1, size: 'level'.length + 'region'.length + 'lock'.length });
  assert.deepEqual(pl.packs, { resourcepack: 1, shader: 1 });
  assert.equal(pl.java, null);

  const upd = calls.find((c) => /version_files\/update$/.test(c.url));
  assert.deepEqual([upd.body.algorithm, upd.body.loaders, upd.body.game_versions], ['sha1', ['fabric'], ['1.21.4']], 'версии ищутся под новую игру и под загрузчик сборки');
  assert.equal(upd.body.hashes.length, 7, 'один запрос на все моды');
  assert.deepEqual(dump(instances.dirOf(inst.id)), before, 'план ничего не пишет в старую сборку');
});

test('план: понятные ошибки, если переносить некуда', async (t) => {
  const { inst, migrate } = setup(t);
  await assert.rejects(migrate.plan(inst.id, '1.21.1'), /уже на этой версии/);
  await assert.rejects(migrate.plan(inst.id, ''), /Выбери версию/);
  await assert.rejects(migrate.plan(inst.id, '9.99'), /Версия 9\.99 не найдена/);
  await assert.rejects(migrate.plan(inst.id, '1.21.5'), /Fabric не поддерживает 1\.21\.5/, 'под новую версию нет загрузчика — моды ставить некуда');
});

test('сборка на Quilt ищет моды и под Quilt, и под Fabric; ванильная обходится без запросов к Modrinth', async (t) => {
  const { inst, instances, calls, migrate } = setup(t);
  const q = instances.create({ name: 'Куилт', version: '1.21.1', loader: 'quilt' });
  put(instances.gameDir(q.id), { 'mods/sodium-0.5.8.jar': OLD.sodium });
  await migrate.plan(q.id, '1.21.4');
  assert.deepEqual(calls.find((c) => /version_files\/update$/.test(c.url)).body.loaders, ['quilt', 'fabric']);

  const v = instances.create({ name: 'Ванилла', version: '1.21.1', loader: 'vanilla' });
  calls.length = 0;
  const pl = await migrate.plan(v.id, '1.21.4');
  assert.deepEqual([pl.mods, pl.counts.total, pl.loaderVersion], [[], 0, null]);
  assert.equal(calls.filter((c) => /modrinth/.test(c.url)).length, 0);
  assert.equal(fs.existsSync(path.join(instances.gameDir(v.id), 'mods')), false, 'папку модов в старой сборке не создаём');
  assert.ok(inst);
});

test('перенос: рядом появляется копия на новой версии, а старая сборка остаётся как была', async (t) => {
  const { inst, instances, mods, calls, sodium, migrate } = setup(t);
  const before = dump(instances.dirOf(inst.id));
  const labels = [];
  const { instance: copy, report } = await migrate.run(inst.id, '1.21.4', {}, (label) => labels.push(label));

  assert.deepEqual([copy.name, copy.version, copy.loader, copy.loaderVersion, copy.maxRam, copy.group, copy.playtime, copy.lastPlayed], ['Шейдерная красота (1.21.4)', '1.21.4', 'fabric', null, 6144, 'Друзья', 0, null], 'настройки те же, версия новая, версию загрузчика подберёт запуск');
  assert.notEqual(copy.id, inst.id);
  assert.deepEqual(copy.migratedFrom && [copy.migratedFrom.id, copy.migratedFrom.version], [inst.id, '1.21.1']);

  const dir = mods.dir(copy.id);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['cloth-config-1.0.jar', 'declared.jar', 'fabric-api-0.110.jar', 'lithium-0.14.jar', 'sodium-0.6.0.jar', 'stranger.jar.disabled', 'zoomify-2.0.jar.disabled']);
  assert.equal(sha(path.join(dir, 'sodium-0.6.0.jar')), sha1(sodium), 'новый мод скачан и совпадает по хэшу');
  assert.equal(sha(path.join(dir, 'lithium-0.14.jar')), sha1(OLD.lithium), 'подходящий мод просто скопирован');
  assert.equal(fs.existsSync(path.join(dir, 'gone.jar')), false, 'мода, которого под новую версию нет, в копии нет');

  const meta = mods.readMeta(copy.id);
  assert.deepEqual([meta['sodium-0.6.0.jar'].source, meta['sodium-0.6.0.jar'].projectId, meta['sodium-0.6.0.jar'].title, meta['sodium-0.6.0.jar'].version], ['modrinth', 'AANobbMI', 'Sodium', '0.6.0']);
  assert.equal(meta['lithium-0.14.jar'].title, 'Lithium', 'мод, найденный по хэшу, дальше отслеживается как с Modrinth');
  assert.equal(meta['cloth-config-1.0.jar'].projectId, 'P_CLOTH', 'недостающая библиотека поставлена');
  assert.equal(meta['resourcepack:pack.zip'].title, 'Мой пак', 'записи о ресурспаках переехали вместе с файлами');
  assert.equal(meta['sodium-0.5.8.jar'], undefined);

  const g = instances.gameDir(copy.id);
  const kept = dump(g);
  for (const f of ['config/sodium-options.json', 'options.txt', 'resourcepacks/pack.zip', 'shaderpacks/s.zip', 'saves/World1/level.dat', 'saves/World1/region/r.0.0.mca']) assert.ok(f in kept, `${f} в копии есть`);
  for (const f of ['logs/latest.log', 'crash-reports/c.txt', '.fabric/processedMods/x.jar', 'saves/World1/session.lock']) assert.ok(!(f in kept), `${f} в копию не идёт`);
  const root = dump(instances.dirOf(copy.id));
  for (const f of ['backups/b.zip', 'pack-files.json', 'origins.json']) assert.ok(!(f in root), `${f} относится к старой сборке`);

  assert.deepEqual(report.counts, { total: 7, update: 3, same: 2, missing: 1, unknown: 1, failed: 0 });
  assert.deepEqual(report.health, { conflicts: 0, missing: 0, duplicates: 0 }, 'после переноса у модов нет недостающих зависимостей');
  assert.deepEqual(report.installed, ['Cloth Config']);
  assert.deepEqual(report.from, { id: inst.id, name: 'Шейдерная красота', version: '1.21.1' });
  assert.deepEqual(migrate.report(copy.id).counts, report.counts, 'отчёт лежит в сборке и читается позже');
  assert.equal(migrate.report(inst.id), null);
  assert.ok(labels.some((l) => /Переношу моды \(6 \/ 6\)/.test(l)) && labels.some((l) => /библиотек/.test(l)), labels.join(' | '));

  assert.deepEqual(dump(instances.dirOf(inst.id)), before, 'старая сборка не изменилась ни на байт');
  assert.equal(instances.list().length, 2);
  assert.equal(calls.filter((c) => /version_files\/update$/.test(c.url)).length, 1, 'перенос спрашивает Modrinth про все моды одним запросом');
});

test('миры-ссылки (перенос «на месте» из другого лаунчера) в копии становятся настоящими файлами, а даты миров сохраняются', async (t) => {
  const { inst, instances, p, migrate } = setup(t);
  // Папка saves сборки — ссылка на чужую папку с миром; level.dat «старый»
  const outside = path.join(p.dir, 'чужой-лаунчер', 'saves');
  put(outside, { 'Мир на месте/level.dat': 'level', 'Мир на месте/data/x.dat': 'x' });
  const old = new Date('2024-05-05T10:00:00Z');
  fs.utimesSync(path.join(outside, 'Мир на месте', 'level.dat'), old, old);
  const saves = path.join(instances.gameDir(inst.id), 'saves');
  fs.rmSync(saves, { recursive: true, force: true });
  fs.symlinkSync(outside, saves, 'junction');

  const { instance: copy } = await migrate.run(inst.id, '1.21.4');
  const copied = path.join(instances.gameDir(copy.id), 'saves');
  assert.equal(fs.lstatSync(copied).isSymbolicLink(), false, 'в копии saves — настоящая папка, не ссылка на чужую');
  const level = path.join(copied, 'Мир на месте', 'level.dat');
  assert.equal(fs.readFileSync(level, 'utf8'), 'level');
  assert.ok(Math.abs(fs.statSync(level).mtimeMs - old.getTime()) < 2000, 'дата последней игры в мире не стала «сегодня»');
  fs.writeFileSync(level, 'изменили в копии');
  assert.equal(fs.readFileSync(path.join(outside, 'Мир на месте', 'level.dat'), 'utf8'), 'level', 'мир в копии не общий со старым');
});

test('перенос без миров: папки saves в копии нет, остальное на месте', async (t) => {
  const { inst, instances, migrate } = setup(t);
  const { instance: copy } = await migrate.run(inst.id, '1.21.4', { worlds: false });
  const kept = dump(instances.gameDir(copy.id));
  assert.ok(!Object.keys(kept).some((f) => f.startsWith('saves/')));
  assert.ok('options.txt' in kept && 'config/sodium-options.json' in kept);
});

test('не скачался один мод — перенос идёт дальше, а мод попадает в отчёт; библиотека ради него не ставится', async (t) => {
  const { inst, mods, migrate } = setup(t, { broken: ['sodium-0.6.0.jar'] });
  const { instance: copy, report } = await migrate.run(inst.id, '1.21.4');
  const sodium = report.mods.find((m) => m.file === 'sodium-0.5.8.jar');
  assert.equal(sodium.status, 'failed');
  assert.match(sodium.error, /HTTP 404/);
  assert.equal(report.counts.failed, 1);
  assert.equal(report.counts.update, 2);
  const files = fs.readdirSync(mods.dir(copy.id));
  assert.ok(!files.includes('sodium-0.6.0.jar') && !files.includes('cloth-config-1.0.jar'), files.join(', '));
  assert.ok(files.includes('fabric-api-0.110.jar'), 'остальные моды перенесены');
});

test('библиотеки, которой под новую версию нет, не выдумываем: предупреждение и честная пометка в плане', async (t) => {
  const { inst, migrate } = setup(t, { dep: 'P_NOLIB' });
  const pl = await migrate.plan(inst.id, '1.21.4');
  assert.deepEqual(pl.extras.map((e) => [e.title, e.available]), [['No Lib', false]]);
  const { instance: copy, report } = await migrate.run(inst.id, '1.21.4');
  assert.ok(report.warnings.some((w) => /«No Lib»/.test(w) && /нет/.test(w)), report.warnings.join(' | '));
  assert.ok(copy.id);
});

test('моды с CurseForge: новая версия качается, нет файла или автор запретил скачивание — в отчёте с причиной', async (t) => {
  const { inst, mods, migrate } = setup(t, { cf: true });
  const pl = await migrate.plan(inst.id, '1.21.4');
  const by = Object.fromEntries(pl.mods.map((m) => [m.file, m]));
  assert.deepEqual([by['cfmod-1.0.jar'].status, by['cfmod-1.0.jar'].to, by['cfmod-1.0.jar'].title], ['update', 'CF Mod 2.0', 'CF Mod']);
  assert.deepEqual([by['cfgone.jar'].status, by['cfgone.jar'].reason], ['missing', null]);
  assert.deepEqual([by['cfblocked.jar'].status, by['cfblocked.jar'].reason], ['missing', 'автор запретил скачивание в лаунчерах']);
  assert.deepEqual(pl.counts, { total: 10, update: 4, same: 2, missing: 3, unknown: 1, failed: 0 });
  const { instance: copy } = await migrate.run(inst.id, '1.21.4');
  assert.ok(fs.existsSync(path.join(mods.dir(copy.id), 'cfmod-2.0.jar')));
  assert.deepEqual([mods.readMeta(copy.id)['cfmod-2.0.jar'].source, mods.readMeta(copy.id)['cfmod-2.0.jar'].projectId], ['curseforge', '111']);
});

test('«Отменить» посреди переноса: копия удаляется целиком, старая сборка цела', async (t) => {
  const { inst, instances, store, migrate, net } = setup(t);
  const before = dump(instances.dirOf(inst.id));
  const token = net.cancelToken();
  await assert.rejects(
    net.runCancellable(token, () => migrate.run(inst.id, '1.21.4', {}, (label) => /Переношу моды/.test(label) && token.cancel())),
    (e) => e.cancelled === true
  );
  assert.deepEqual(instances.list().map((i) => i.id), [inst.id], 'половинчатой копии не осталось');
  assert.deepEqual(fs.readdirSync(store.paths().instances), [inst.id], 'и папки её тоже');
  assert.deepEqual(dump(instances.dirOf(inst.id)), before);
});

test('на диске не хватает места — понятная ошибка до всякого копирования, копия не создаётся', async (t) => {
  const { inst, instances, migrate } = setup(t);
  t.mock.method(fs, 'statfsSync', () => ({ bavail: 1000, bsize: 4096 })); // около 4 МБ свободно
  await assert.rejects(migrate.run(inst.id, '1.21.4'), /не хватает места для копии: нужно около 300 МБ, свободно 4 МБ/);
  assert.equal(instances.list().length, 1);
  t.mock.method(fs, 'statfsSync', () => { throw new Error('нет такого вызова'); });
  const { instance } = await migrate.run(inst.id, '1.21.4', { worlds: false });
  assert.ok(instance.id, 'если свободное место узнать не вышло, перенос не блокируется');
});

test('сбой до копирования (нет такой версии) ничего не создаёт', async (t) => {
  const { inst, instances, migrate } = setup(t);
  await assert.rejects(migrate.run(inst.id, '1.21.5'), /Fabric не поддерживает/);
  assert.equal(instances.list().length, 1);
});

test('имя копии: версия в скобках заменяется, а не копится; длинное имя не вылезает за 40 знаков', (t) => {
  const { migrate } = setup(t);
  assert.equal(migrate.copyName('Сборка', '1.21.4'), 'Сборка (1.21.4)');
  assert.equal(migrate.copyName('Сборка (1.20.1)', '1.21.4'), 'Сборка (1.21.4)');
  const long = migrate.copyName('Очень длинное название сборки для друзей и знакомых', '1.21.4');
  assert.ok(long.length <= 40 && long.endsWith(' (1.21.4)'), long);
  assert.equal(migrate.copyName('   ', '1.21.4'), 'Сборка (1.21.4)');
});

const sha = (file) => sha1(fs.readFileSync(file));
