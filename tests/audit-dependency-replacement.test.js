const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), crypto = require('crypto'), vm = require('vm');
const { profile, put } = require('./helpers');
const core = path.join(__dirname, '../src/core');
function load(name, overrides = {}) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(core, name + '.js'), 'utf8'), {
    module, process, Buffer,
    require: n => Object.hasOwn(overrides, n) ? overrides[n] : n.startsWith('.') ? require(path.resolve(core, n)) : require(n),
  }); return module.exports;
}
function fixture(t, mode) {
  const p = profile(); t.after(() => p.done());
  const instances = p.load('core/instances'), mods = p.load('core/mods'), fsx = p.load('core/fsx');
  const inst = instances.create({ name: 'Dependency fixture', version: '1.20.1', loader: 'fabric' });
  const old = path.join(mods.dir(inst.id), 'old.jar' + (mode === 'disabled' ? '.disabled' : ''));
  put(instances.gameDir(inst.id), { ['mods/' + path.basename(old)]: 'OLD' });
  mods.record(inst.id, 'old.jar', { source: 'modrinth', projectId: 'fixture', title: 'Old mod', version: '1', pinned: true });
  if (mode.startsWith('clash-')) {
    put(instances.gameDir(inst.id), { 'mods/neighbor-old.jar': 'NEIGHBOR OLD' });
    mods.record(inst.id, 'neighbor-old.jar', { source: 'modrinth', projectId: 'neighbor', title: 'Neighbor', version: '1' });
  }
  const meta = fs.readFileSync(path.join(instances.dirOf(inst.id), 'mods-meta.json'));
  const snapshot = path.join(p.dir, 'snapshot.jar'); fs.linkSync(old, snapshot);
  const filename = mode === 'same-name' ? 'old.jar' : 'new.jar';
  let cancelled = false, metadataFailed = false, renameFailed = false;
  const downloads = [];
  const net = { ...p.load('core/net'),
    getJson: async url => url.includes('/version?') ? [{ version_type: 'release', version_number: '2', dependencies: [], files: [{ filename: url.includes('/neighbor/version') ? 'neighbor-new.jar' : filename, primary: true, url: 'https://fixture.invalid/mod', hashes: { sha1: crypto.createHash('sha1').update('NEW').digest('hex') } }] }] : { id: 'fixture', title: 'Fixture', loaders: ['fabric'] },
    download: async (_url, file) => {
      assert.equal(fs.readFileSync(old, 'utf8'), 'OLD', 'old mod must still exist while downloading');
      downloads.push(file);
      if (['download-error', 'direct-download-error'].includes(mode)) throw Error('fixture 404');
      fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, mode === 'bad-hash' ? 'BAD' : 'NEW');
      if (mode === 'cancel') cancelled = true;
    },
    throwIfCancelled() { if (cancelled) throw Object.assign(Error('fixture cancelled'), { cancelled: true }); },
  };
  const transaction = load('packupdate', { './fsx': { ...fsx, renameRetry(from, to) {
    if (mode === 'rename-error' && !renameFailed && from.includes(path.join('.pack-update', 'new'))) { renameFailed = true; throw Error('fixture rename'); }
    return fsx.renameRetry(from, to);
  } } });
  const mr = load('modrinth', { './net': net, './packupdate': transaction,
    './modmeta': { readMeta(file) { return { id: 'fixture', version: fs.readFileSync(file, 'utf8'), depends: new Map(), kind: 'fabric' }; }, satisfies(meta) { return meta?.version === 'NEW'; }, conflictBetween: () => null },
    './health': { checkNewMod: () => {
      const hardMods = mode.startsWith('clash-') ? [{ file: 'neighbor-old.jar', name: 'Neighbor', versionSpecific: true }] : [];
      if (mode === 'incompatible' || mode === 'clash-unresolved') hardMods.push({ file: 'other.jar', name: 'Other', versionSpecific: false });
      return { hard: hardMods.map(h => h.name), soft: [], hardMods };
    } },
    './fsx': { ...fsx, writeJsonAtomic(file, value) {
      if (['metadata-error', 'clash-metadata-error'].includes(mode) && !metadataFailed && file.endsWith('mods-meta.json')) { metadataFailed = true; throw Error('fixture metadata'); }
      return fsx.writeJsonAtomic(file, value);
    } },
  });
  return { p, instances, mods, inst, old, meta, snapshot, filename, mr, downloads };
}
for (const mode of ['download-error', 'direct-download-error', 'bad-hash', 'cancel', 'rename-error', 'metadata-error', 'incompatible', 'same-name', 'different-name', 'disabled']) {
  test(`dependency replacement keeps old files until verified commit: ${mode}`, async t => {
    const f = fixture(t, mode);
    const operation = f.mr.installMod(f.inst.id, 'fixture', new Set(), mode === 'direct-download-error' ? null : { title: 'Parent', depends: new Map([['fixture', '*']]), kind: 'fabric' });
    const success = ['same-name', 'different-name', 'disabled'].includes(mode);
    if (success) {
      const r = await operation; assert.equal(r.installed.length, 1);
      assert.equal(fs.readFileSync(path.join(f.mods.dir(f.inst.id), f.filename), 'utf8'), 'NEW');
      if (mode !== 'same-name') assert.equal(fs.existsSync(f.old), false);
      assert.equal(f.mods.readMeta(f.inst.id)[f.filename].pinned, true);
    } else {
      await assert.rejects(operation);
      assert.equal(fs.readFileSync(f.old, 'utf8'), 'OLD');
      assert.deepEqual(fs.readFileSync(path.join(f.instances.dirOf(f.inst.id), 'mods-meta.json')), f.meta);
    }
    assert.equal(fs.readFileSync(f.snapshot, 'utf8'), 'OLD');
    assert.equal(fs.existsSync(path.join(f.instances.dirOf(f.inst.id), '.pack-update')), false);
    assert.ok(f.downloads.every(file => !fs.existsSync(file)), 'own temporary downloads are removed');
  });
}
test('an unrelated existing target mod is not overwritten', async t => {
  const f = fixture(t, 'collision'); put(f.instances.gameDir(f.inst.id), { 'mods/new.jar': 'UNRELATED' });
  await assert.rejects(f.mr.installMod(f.inst.id, 'fixture', new Set(), { title: 'Parent', depends: new Map([['fixture', '*']]) }), /занят другим модом/);
  assert.equal(fs.readFileSync(f.old, 'utf8'), 'OLD');
  assert.equal(fs.readFileSync(path.join(f.mods.dir(f.inst.id), 'new.jar'), 'utf8'), 'UNRELATED');
});
for (const mode of ['clash-unresolved', 'clash-metadata-error', 'clash-success']) {
  test(`primary and compatible neighbours form one recoverable commit: ${mode}`, async t => {
    const f = fixture(t, mode);
    const operation = f.mr.installMod(f.inst.id, 'fixture', new Set(), { title: 'Parent', depends: new Map([['fixture', '*']]) });
    if (mode === 'clash-success') {
      await operation;
      assert.equal(fs.readFileSync(path.join(f.mods.dir(f.inst.id), 'neighbor-new.jar'), 'utf8'), 'NEW');
      assert.equal(fs.existsSync(path.join(f.mods.dir(f.inst.id), 'neighbor-old.jar')), false);
      assert.equal(fs.readFileSync(path.join(f.mods.dir(f.inst.id), 'new.jar'), 'utf8'), 'NEW');
    } else {
      await assert.rejects(operation);
      assert.equal(fs.readFileSync(f.old, 'utf8'), 'OLD');
      assert.equal(fs.readFileSync(path.join(f.mods.dir(f.inst.id), 'neighbor-old.jar'), 'utf8'), 'NEIGHBOR OLD');
      assert.equal(fs.existsSync(path.join(f.mods.dir(f.inst.id), 'neighbor-new.jar')), false);
      assert.deepEqual(fs.readFileSync(path.join(f.instances.dirOf(f.inst.id), 'mods-meta.json')), f.meta);
    }
    assert.ok(f.downloads.every(file => !fs.existsSync(file)));
  });
}

test('main mod task blocks busy instances, requires snapshot and releases its lock on failure', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
  const helper = source.slice(source.indexOf('function withModTask('), source.indexOf('// Перед тем как лаунчер сам меняет моды'));
  let busy = true, snapshotFails = false, invoked = false;
  const lock = new Set(), module = { exports: {} };
  vm.runInNewContext(helper + '\nmodule.exports={withModTask};', {
    module, modInstalls: lock, launches: new Set(), packUpdates: new Set(),
    game: { isRunning: () => busy }, packupdate: { recover() {} }, lifecycle: { idle() {} },
    withTask: async fn => fn(() => {}), autoPoint(_id, _reason, options) { assert.equal(options.required, true); if (snapshotFails) throw Error('snapshot failed'); },
  });
  const run = () => module.exports.withModTask('id', 'fixture', () => { invoked = true; });
  assert.throws(run, /закрой игру/); assert.equal(invoked, false);
  busy = false; snapshotFails = true; await assert.rejects(run(), /snapshot failed/); assert.equal(lock.size, 0); assert.equal(invoked, false);
  snapshotFails = false; await run(); assert.equal(invoked, true); assert.equal(lock.size, 0);
  let release;
  const pending = module.exports.withModTask('id', 'fixture', () => new Promise(resolve => { release = resolve; }));
  assert.equal(lock.has('id'), true);
  assert.throws(run, /закрой игру/);
  release(); await pending; assert.equal(lock.size, 0);
});
