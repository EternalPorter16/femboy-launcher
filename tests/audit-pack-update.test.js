const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const vm = require('vm');
const { safeJoin } = require('../src/core/net');
const fsx = require('../src/core/fsx');
const { spawnSync } = require('child_process');

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'femboy-pack-update-'));
  t.after(() => { assert.ok(path.basename(dir).startsWith('femboy-pack-update-')); fs.rmSync(dir, { recursive: true, force: true }); });
  const game = path.join(dir, '.minecraft');
  const put = (base, rel, data) => { const file = path.join(base, rel); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); return file; };
  put(dir, 'instance.json', '{"pack":"OLD"}');
  put(dir, 'pack-files.json', '["mods/old.jar","resourcepacks/old.zip","shaderpacks/old.zip"]');
  put(dir, 'mods-meta.json', '{"old":true}');
  for (const rel of ['mods/old.jar', 'config/settings.txt', 'resourcepacks/old.zip', 'shaderpacks/old.zip', 'saves/World/level.dat']) put(game, rel, 'ORIGINAL ' + rel);
  const instances = { dirOf: () => dir, gameDir: () => game };
  const load = (name, overrides = {}) => {
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/core', name + '.js'), 'utf8'), {
      module, Buffer, process,
      require: (n) => Object.hasOwn(overrides, n) ? overrides[n] : n === './instances' ? instances : n === './fsx' ? fsx : n === './net' ? { safeJoin } : require(n),
    });
    return module.exports;
  };
  const dump = () => {
    const result = {};
    const walk = (base, rel = '') => {
      for (const e of fs.readdirSync(base, { withFileTypes: true })) {
        if (e.name === '.pack-update') continue;
        const name = rel ? rel + '/' + e.name : e.name;
        if (e.isDirectory()) walk(path.join(base, e.name), name);
        else result[name] = fs.readFileSync(path.join(base, e.name)).toString('hex');
      }
    }; walk(dir); return result;
  };
  return { dir, game, put, load, instances, dump };
}

function prepare(f, transaction) {
  const tx = transaction.begin('test');
  for (const rel of ['mods/new.jar', 'config/settings.txt', 'resourcepacks/new.zip', 'shaderpacks/new.zip']) {
    const dest = tx.path(rel); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, 'NEW ' + rel);
  }
  return tx;
}

test('staging and an aborted preparation never touch working files', (t) => {
  const f = setup(t), before = f.dump();
  const tx = prepare(f, f.load('packupdate'));
  assert.deepEqual(f.dump(), before);
  tx.abort();
  assert.deepEqual(f.dump(), before);
  assert.equal(fs.existsSync(path.join(f.dir, '.pack-update')), false);
});

for (const step of [1, 2, 3, 4]) for (const after of [false, true]) {
  test(`recovery restores all bytes after interrupted replacement ${step}, ${after ? 'after' : 'before'} rename`, (t) => {
    const f = setup(t), before = f.dump();
    let calls = 0;
    const transaction = f.load('packupdate', { './fsx': { ...fsx, renameRetry(from, to) {
      calls++;
      if (calls === step && !after) throw new Error('interrupted commit');
      fsx.renameRetry(from, to);
      if (calls === step && after) throw new Error('interrupted commit');
    } } });
    const tx = prepare(f, transaction);
    assert.throws(() => tx.commit(['mods/old.jar', 'resourcepacks/old.zip', 'shaderpacks/old.zip']), /interrupted/);
    // A fresh module has no in-memory transaction: only on-disk recovery state.
    f.load('packupdate').recover('test');
    assert.deepEqual(f.dump(), before);
    assert.equal(f.load('packupdate').recover('test'), false, 'recovery is idempotent');
  });
}

test('metadata error rolls back files, deleted packs, manifest and instance version', (t) => {
  const f = setup(t), before = f.dump();
  const tx = prepare(f, f.load('packupdate'));
  tx.commit(['mods/old.jar', 'resourcepacks/old.zip', 'shaderpacks/old.zip']);
  f.put(f.dir, 'instance.json', '{"pack":"PARTIAL"}');
  f.put(f.dir, 'pack-files.json', '["mods/new.jar"]');
  f.put(f.dir, 'mods-meta.json', '{"new":true}');
  tx.abort();
  assert.deepEqual(f.dump(), before);
});

for (const boundary of ['replace', 'remove']) {
  test(`fresh process recovers after forced process exit following ${boundary}`, (t) => {
    const f = setup(t), before = f.dump();
    const script = `
      const fs=require('fs'),path=require('path'),vm=require('vm');
      const dir=process.argv[1],core=process.argv[2],boundary=process.argv[3];
      const realFsx=require(path.join(core,'fsx'));
      const fsx={...realFsx,renameRetry(from,to){realFsx.renameRetry(from,to);if(boundary==='replace')process.exit(77)}};
      const mockFs={...fs,rmSync(dest,opts){fs.rmSync(dest,opts);if(boundary==='remove'&&dest===path.join(dir,'.minecraft','mods','old.jar'))process.exit(77)}};
      const m={exports:{}};
      vm.runInNewContext(fs.readFileSync(path.join(core,'packupdate.js'),'utf8'),{module:m,process,Buffer,require(n){
        if(n==='fs')return mockFs;
        if(n==='./fsx')return fsx;
        if(n==='./net')return require(path.join(core,'net'));
        if(n==='./instances')return {dirOf:()=>dir,gameDir:()=>path.join(dir,'.minecraft')};
        return require(n);
      }});
      const tx=m.exports.begin('test'),dest=tx.path('config/settings.txt');
      fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,'NEW CONFIG');
      tx.commit(['mods/old.jar']);
      process.exit(99);
    `;
    const child = spawnSync(process.execPath, ['-e', script, f.dir, path.join(__dirname, '../src/core'), boundary], { windowsHide: true, timeout: 10000, encoding: 'utf8' });
    assert.equal(child.status, 77, child.stderr);
    f.load('packupdate').recover('test');
    assert.deepEqual(f.dump(), before);
  });
}

test('committed update keeps new files and does not damage a hardlinked snapshot', (t) => {
  const f = setup(t);
  const snapshot = path.join(f.dir, 'snapshot.jar');
  fs.linkSync(path.join(f.game, 'mods/old.jar'), snapshot);
  const tx = prepare(f, f.load('packupdate'));
  tx.commit(['mods/old.jar', 'resourcepacks/old.zip', 'shaderpacks/old.zip']);
  f.put(f.dir, 'instance.json', '{"pack":"NEW"}');
  tx.finish();
  assert.equal(fs.readFileSync(path.join(f.game, 'mods/new.jar'), 'utf8'), 'NEW mods/new.jar');
  assert.equal(fs.readFileSync(snapshot, 'utf8'), 'ORIGINAL mods/old.jar');
  assert.equal(fs.existsSync(path.join(f.game, 'mods/old.jar')), false);
  assert.equal(fs.existsSync(path.join(f.dir, '.pack-update')), false);
});

test('failed cleanup after commit is resolved without rolling back a successful update', (t) => {
  const f = setup(t);
  let failCleanup = true;
  const transaction = f.load('packupdate', { fs: { ...fs, rmSync(dest, opts) {
    if (failCleanup && dest === path.join(f.dir, '.pack-update')) { failCleanup = false; throw new Error('busy cleanup'); }
    return fs.rmSync(dest, opts);
  } } });
  const tx = prepare(f, transaction);
  tx.commit(['mods/old.jar']);
  f.put(f.dir, 'instance.json', '{"pack":"NEW"}');
  tx.finish();
  const state = f.dump();
  assert.equal(fs.existsSync(path.join(f.dir, '.pack-update')), true);
  f.load('packupdate').recover('test');
  assert.deepEqual(f.dump(), state);
});

test('incomplete backup blocks recovery and preserves the journal for repair', (t) => {
  const f = setup(t);
  const tx = prepare(f, f.load('packupdate'));
  tx.commit(['mods/old.jar']);
  fs.unlinkSync(path.join(f.dir, '.pack-update/old/1'));
  assert.throws(() => f.load('packupdate').recover('test'));
  assert.equal(fs.existsSync(path.join(f.dir, '.pack-update/journal.json')), true);
});

test('simultaneous update/recovery cannot remove an active staging directory', (t) => {
  const f = setup(t), transaction = f.load('packupdate');
  const tx = prepare(f, transaction);
  assert.throws(() => transaction.begin('test'), /ещё выполняется/);
  assert.throws(() => transaction.recover('test'), /ещё выполняется/);
  assert.equal(fs.existsSync(path.join(f.dir, '.pack-update/new')), true);
  tx.abort();
});

test('required pre-update snapshot failure prevents calling the updater', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
  const auto = source.slice(source.indexOf('function autoPoint'), source.indexOf('/* ---------- трей'));
  const handler = source.slice(source.indexOf("handle('packs:update'"), source.indexOf("handle('storage:scan'"));
  let run, updates = 0;
  const busy = new Set();
  vm.runInNewContext(auto + '\n' + handler, {
    snapshots: { create: (_id, _reason, options) => { assert.equal(options.force, true); throw new Error('snapshot failure'); } }, send() {},
    handle: (_, fn) => { run = fn; }, game: { isRunning: () => false }, launches: new Map(), packUpdates: busy,
    packupdate: { recover() {} }, lifecycle: { idle() {} }, instances: { get: () => ({ pack: { projectId: 'fixture', source: 'modrinth' } }) },
    withTask: async (fn) => fn(() => {}), source: () => ({ updateModpack: () => { updates++; } }),
  });
  await assert.rejects(run('test'), /snapshot failure/);
  assert.equal(updates, 0);
  assert.equal(busy.size, 0);
});

test('game launch waits for pack updates and recovers before syncing or launching', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
  const prefix = source.slice(source.indexOf('async function launchGame'), source.indexOf('  let startedAt = Date.now();', source.indexOf('async function launchGame')));
  const events = [], busy = new Set(['test']);
  const launch = vm.runInNewContext('(' + prefix + '})', {
    packUpdates: busy, packupdate: { recover: () => events.push('recover') },
    store: { get: () => ({ settings: { syncDir: 'fixture' } }) }, game: { isRunning: () => false }, launchProgress() {},
    sync: { syncInstance: async () => events.push('sync') }, send() {},
  });
  await assert.rejects(launch('test', {}), /дождись обновления/);
  assert.deepEqual(events, []);
  busy.clear();
  await launch('test', {});
  assert.deepEqual(events, ['recover', 'sync']);
});

for (const source of ['modrinth', 'curseforge']) for (const failure of ['download', 'override', 'cancel', 'metadata']) {
  test(`${source} rolls back the complete pack on ${failure} failure`, async (t) => {
    const f = setup(t), before = f.dump();
    const state = f.load('packstate');
    const transaction = f.load('packupdate');
    const net = {
      safeJoin,
      postJson: async (url) => ({ data: url.endsWith('/mods/files') ? [{ modId: 1, fileName: 'new.jar', downloadUrl: 'https://fixture.invalid/new.jar' }] : [{ id: 1, classId: 6, name: 'Test Mod' }] }),
      download: async (_, dest) => {
        assert.equal(fs.readFileSync(path.join(f.game, 'mods/old.jar'), 'utf8'), 'ORIGINAL mods/old.jar', 'old pack is intact during downloads');
        if (failure === 'download') throw new Error('fixture 404');
        fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, 'NEW JAR');
      },
      pool: async (items, _, fn) => { for (const item of items) await fn(item); },
      throwIfCancelled: () => { if (failure === 'cancel') throw Object.assign(new Error('cancelled'), { cancelled: true }); },
    };
    const module = { exports: {} };
    const sourceCode = fs.readFileSync(path.join(__dirname, '../src/core', source + '.js'), 'utf8');
    const mocks = { './instances': f.instances, './fsx': fsx, './packstate': state, './packupdate': transaction, './net': net,
      './mods': { record: () => f.put(f.dir, 'mods-meta.json', '{"new":true}') }, './modmeta': {}, './health': {}, 'adm-zip': class {},
      './store': { get: () => ({ settings: { cfApiKey: 'test-only' } }) },
    };
    vm.runInNewContext(sourceCode + `\nmodule.exports.applyForTest = ${source === 'modrinth' ? 'applyMrpack' : 'applyCfPack'};`, {
      module, Buffer, process, require: (n) => Object.hasOwn(mocks, n) ? mocks[n] : require(n),
    });
    const pack = {
      index: { files: [{ path: 'mods/new.jar', downloads: ['https://fixture.invalid/new.jar'] }] },
      manifest: {}, wanted: [{ fileID: 1 }],
      zip: { getEntries: () => [{ entryName: 'overrides/config/settings.txt', isDirectory: false, getData: () => { if (failure === 'override') throw new Error('fixture archive failure'); return Buffer.from('NEW CONFIG'); } }] },
    };
    await assert.rejects(module.exports.applyForTest('test', pack, () => {}, true, () => {
      f.put(f.dir, 'instance.json', '{"pack":"NEW"}');
      if (failure === 'metadata') throw new Error('fixture metadata failure');
    }));
    assert.deepEqual(f.dump(), before);
    assert.equal(fs.existsSync(path.join(f.dir, '.pack-update')), false);
  });
}
