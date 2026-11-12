const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { safeJoin } = require('../src/core/net');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'femboy-world-safety-'));
  t.after(() => { assert.ok(path.basename(root).startsWith('femboy-world-safety-')); fs.rmSync(root, { recursive: true, force: true }); });
  const local = path.join(root, 'local');
  const cloudDir = path.join(root, 'cloud');
  const cloud = path.join(cloudDir, 'Femboy Launcher Sync', 'v2', 'instances', 'test');
  fs.mkdirSync(local, { recursive: true });
  const put = (dir, rel, value) => { const dest = path.join(dir, rel); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, value); };
  const mocks = {
    './store': { get: () => ({ settings: { syncDir: cloudDir, cfApiKey: 'test-only' } }), save() {} },
    './instances': { dirOf: () => local, gameDir: () => local, list: () => [{ id: 'test' }], get: () => ({ id: 'test', name: 'test' }) },
    './trash': { has: () => false }, './fsx': require('../src/core/fsx'),
    './mods': {}, './modmeta': {}, './health': {}, 'adm-zip': class {},
  };
  const load = (name, extra = {}, expose = '') => {
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/core', name + '.js'), 'utf8') + expose, {
      module, Buffer, console, process,
      require: (n) => Object.hasOwn(extra, n) ? extra[n] : n === './packupdate' ? load('packupdate', { './net': { safeJoin } }) : Object.hasOwn(mocks, n) ? mocks[n] : require(n),
    });
    return module.exports;
  };
  return { root, local, cloudDir, cloud, put, load, mocks };
}

async function synced(t) {
  const f = fixture(t);
  f.put(f.local, 'instance.json', '{"id":"test"}');
  f.put(f.local, 'saves/World/level.dat', 'PLAYER_LEVEL');
  f.put(f.local, 'saves/World/region/r.0.0.mca', 'PLAYER_REGION');
  f.sync = f.load('sync');
  await f.sync.syncInstance('test');
  // облачная копия — текущая линия по указателю v2/instances/test/line.json
  const v2 = path.join(f.cloudDir, 'Femboy Launcher Sync', 'v2');
  f.cloud = path.join(v2, 'lines', JSON.parse(fs.readFileSync(path.join(v2, 'instances', 'test', 'line.json'), 'utf8')).line);
  f.baseBefore = fs.readFileSync(path.join(f.local, 'sync-base.json'), 'utf8');
  return f;
}

for (const mode of ['empty', 'one-world-file', 'missing-metadata']) {
  test(`sync stops before mutations when cloud is incomplete: ${mode}`, async (t) => {
    const f = await synced(t);
    if (mode === 'empty') for (const name of fs.readdirSync(f.cloud)) fs.rmSync(path.join(f.cloud, name), { recursive: true, force: true });
    else fs.unlinkSync(path.join(f.cloud, mode === 'one-world-file' ? 'saves/World/level.dat' : 'instance.json'));
    f.put(f.local, 'new-local.txt', 'DO NOT UPLOAD DURING FAILED SYNC');
    await assert.rejects(f.sync.syncInstance('test'), /Облако ещё обновляется/);
    assert.equal(fs.readFileSync(path.join(f.local, 'saves/World/level.dat'), 'utf8'), 'PLAYER_LEVEL');
    assert.equal(fs.readFileSync(path.join(f.local, 'instance.json'), 'utf8'), '{"id":"test"}');
    assert.equal(fs.readFileSync(path.join(f.local, 'sync-base.json'), 'utf8'), f.baseBefore);
    assert.equal(fs.existsSync(path.join(f.cloud, 'new-local.txt')), false);
  });
}

for (const operation of ['readdirSync', 'statSync']) {
  test(`sync treats cloud ${operation} failure as an error, not a deletion`, async (t) => {
    const f = await synced(t);
    const brokenFs = { ...fs, [operation]: (dest, ...args) => {
      if (String(dest).startsWith(path.join(f.cloud, 'saves'))) throw Object.assign(new Error('fixture access denied'), { code: 'EACCES' });
      return fs[operation](dest, ...args);
    } };
    await assert.rejects(f.load('sync', { fs: brokenFs }).syncInstance('test'));
    assert.equal(fs.readFileSync(path.join(f.local, 'saves/World/level.dat'), 'utf8'), 'PLAYER_LEVEL');
    assert.equal(fs.readFileSync(path.join(f.local, 'sync-base.json'), 'utf8'), f.baseBefore);
  });
}

test('sync preserves normal new-file transfer and explicit local file removal', async (t) => {
  const f = await synced(t);
  f.put(f.cloud, 'config/new.txt', 'REMOTE_NEW');
  // другой компьютер отдаёт файл вместе с манифестом (протокол 2: манифест пишется последним)
  const manifest = JSON.parse(fs.readFileSync(path.join(f.cloud, '.femboy-sync.json'), 'utf8'));
  manifest.files['config/new.txt'] = { size: 10, mtime: Math.round(fs.statSync(path.join(f.cloud, 'config/new.txt')).mtimeMs) };
  manifest.gen++;
  fs.writeFileSync(path.join(f.cloud, '.femboy-sync.json'), JSON.stringify(manifest));
  f.put(f.local, 'config/local.txt', 'LOCAL_NEW');
  await f.sync.syncInstance('test');
  assert.equal(fs.readFileSync(path.join(f.local, 'config/new.txt'), 'utf8'), 'REMOTE_NEW');
  assert.equal(fs.readFileSync(path.join(f.cloud, 'config/local.txt'), 'utf8'), 'LOCAL_NEW');
  fs.unlinkSync(path.join(f.local, 'config/local.txt'));
  await f.sync.syncInstance('test');
  assert.equal(fs.existsSync(path.join(f.cloud, 'config/local.txt')), false);
});

test('a completely absent cloud copy stops sync without changes; restoring the cloud recreates it', async (t) => {
  const f = await synced(t);
  fs.rmSync(f.cloud, { recursive: true, force: true });
  // линия могла ещё не доехать с другого компьютера: ждём, а не создаём новую сами
  await assert.rejects(f.sync.syncInstance('test'), /Облако ещё обновляется/);
  assert.equal(fs.readFileSync(path.join(f.local, 'sync-base.json'), 'utf8'), f.baseBefore);
  await f.sync.publishLocal('test');
  const v2 = path.join(f.cloudDir, 'Femboy Launcher Sync', 'v2');
  const line = JSON.parse(fs.readFileSync(path.join(v2, 'instances', 'test', 'line.json'), 'utf8')).line;
  assert.equal(fs.readFileSync(path.join(v2, 'lines', line, 'saves/World/level.dat'), 'utf8'), 'PLAYER_LEVEL');
});

test('syncAll reports the rejected instance without counting it as successful', async (t) => {
  const f = await synced(t);
  fs.unlinkSync(path.join(f.cloud, 'saves/World/level.dat'));
  const result = await f.sync.syncAll();
  assert.equal(result.instances, 0);
  assert.equal(result.errors.length, 1);
  assert.equal(fs.readFileSync(path.join(f.local, 'saves/World/level.dat'), 'utf8'), 'PLAYER_LEVEL');
});

test('sync UI does not announce success for an incomplete run', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/renderer/app/sync-hardware.js'), 'utf8');
  const code = source.slice(source.indexOf('const syncResult'), source.indexOf("$('#syncPick')"));
  const messages = [];
  const result = vm.runInNewContext(code + '\nsyncResult;', { toast: (text, kind) => messages.push({ text, kind }) });
  result({ up: 0, down: 0, errors: ['test: incomplete cloud'] });
  assert.ok(messages.every((m) => m.kind === 'err'));
  assert.ok(!messages.some((m) => m.text.startsWith('Синхронизировано ♡')));
});

test('sync warnings have English translations', () => {
  const body = { nodeType: 1, tagName: 'BODY', childNodes: [], getAttribute: () => null };
  const context = { localStorage: { getItem: () => 'en', setItem() {} }, document: { readyState: 'complete', documentElement: {}, body, addEventListener() {} }, MutationObserver: class { observe() {} }, confirm: () => true };
  context.window = context;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/renderer/i18n.js'), 'utf8'), context);
  const code = fs.readFileSync(path.join(__dirname, '../src/core/sync.js'), 'utf8');
  const warnings = [...code.matchAll(/new Error\('(Не удалось прочитать[^']+|В облачной копии[^']+)'/g)].map((m) => m[1]);
  assert.ok(warnings.length >= 2);
  for (const text of warnings) assert.doesNotMatch(context.I18N.tr(text), /[А-Яа-яЁё]/);
});

test('pack stale-file cleanup never deletes worlds listed by an older pack', (t) => {
  const f = fixture(t);
  f.put(f.local, 'saves/World/level.dat', 'PLAYER_LEVEL');
  f.put(f.local, 'mods/old.jar', 'OLD_MOD');
  f.put(f.local, 'pack-files.json', JSON.stringify(['./saves/World/level.dat', 'mods/old.jar']));
  const state = f.load('packstate', { './net': { safeJoin } });
  state.removeStale('test', []);
  assert.equal(fs.readFileSync(path.join(f.local, 'saves/World/level.dat'), 'utf8'), 'PLAYER_LEVEL');
  assert.equal(fs.existsSync(path.join(f.local, 'mods/old.jar')), false);
});

for (const source of ['modrinth', 'curseforge']) {
  for (const updating of [true, false]) {
    test(`${source}: ${updating ? 'update preserves worlds' : 'new install accepts bundled worlds'}`, async (t) => {
      const f = fixture(t);
      if (updating) f.put(f.local, 'saves/World/level.dat', 'PLAYER_LEVEL');
      f.put(f.local, 'options.txt', 'PLAYER_OPTIONS');
      const state = f.load('packstate', { './net': { safeJoin } });
      const net = {
        throwIfCancelled() {},
        safeJoin, pool: async (files, _, fn) => { for (const file of files) await fn(file); },
        download: async (_, dest) => { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, 'DOWNLOADED_WORLD'); },
      };
      const fnName = source === 'modrinth' ? 'applyMrpack' : 'applyCfPack';
      const mod = f.load(source, { './packstate': state, './net': net }, `\nmodule.exports.applyForTest = ${fnName};`);
      const entries = ['saves/World/level.dat', './SAVES/NewWorld/level.dat', 'config/../saves/Other/level.dat', 'Options.txt', './servers.dat', 'config/a.toml'];
      f.put(f.local, 'servers.dat', 'PLAYER_SERVERS');
      const pack = { zip: { getEntries: () => entries.map((rel) => ({ entryName: 'overrides/' + rel, isDirectory: false, getData: () => Buffer.from('PACK_DATA') })) },
        index: { files: [{ path: 'saves/Downloaded/level.dat', downloads: ['https://fixture.invalid/world'], hashes: {} }] },
        manifest: {}, wanted: [],
      };
      await mod.applyForTest('test', pack, () => {}, updating);
      assert.equal(fs.readFileSync(path.join(f.local, 'saves/World/level.dat'), 'utf8'), updating ? 'PLAYER_LEVEL' : 'PACK_DATA');
      assert.equal(fs.existsSync(path.join(f.local, 'saves/NewWorld/level.dat')), !updating);
      assert.equal(fs.existsSync(path.join(f.local, 'saves/Other/level.dat')), !updating);
      if (source === 'modrinth') assert.equal(fs.existsSync(path.join(f.local, 'saves/Downloaded/level.dat')), !updating);
      assert.equal(fs.readFileSync(path.join(f.local, 'config/a.toml'), 'utf8'), 'PACK_DATA');
      if (updating) {
        assert.equal(fs.readFileSync(path.join(f.local, 'options.txt'), 'utf8'), 'PLAYER_OPTIONS');
        assert.equal(fs.readFileSync(path.join(f.local, 'servers.dat'), 'utf8'), 'PLAYER_SERVERS');
      }
    });
  }
}
