const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
const { profile, put } = require('./helpers');
const core = path.join(__dirname, '../src/core');
const fsx = require('../src/core/fsx');

function load(name, overrides = {}, suffix = '') {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(core, name + '.js'), 'utf8') + suffix, {
    module, process, Buffer,
    require: (n) => Object.hasOwn(overrides, n) ? overrides[n] : n.startsWith('.') ? require(path.resolve(core, n)) : require(n),
  }); return module.exports;
}

for (const mode of ['rename-failure', 'same-name', 'different-name', 'disabled', 'bad-cache', 'download-failure']) {
  test(`mod update preserves a recoverable state: ${mode}`, async (t) => {
    const p = profile(); t.after(() => p.done());
    const instances = p.load('core/instances'), mods = p.load('core/mods');
    const inst = instances.create({ name: 'Update fixture', version: '1.20.1' });
    const disabled = mode === 'disabled', filename = mode === 'same-name' ? 'old.jar' : 'new.jar';
    const old = path.join(mods.dir(inst.id), 'old.jar' + (disabled ? '.disabled' : ''));
    put(instances.gameDir(inst.id), { ['mods/' + path.basename(old)]: 'OLD MOD' });
    mods.record(inst.id, 'old.jar', { title: 'Test Mod', source: 'modrinth', projectId: 'fixture' });
    const metaBefore = fs.readFileSync(path.join(instances.dirOf(inst.id), 'mods-meta.json'), 'utf8');
    const snapshot = path.join(p.dir, 'snapshot.jar'); fs.linkSync(old, snapshot);
    const cached = path.join(p.dir, 'cached.jar'); fs.writeFileSync(cached, mode === 'bad-cache' ? 'CORRUPTED' : 'NEW MOD');
    let failedRename = false;
    const transaction = load('packupdate', { './fsx': { ...fsx, renameRetry(from, to) {
      if (mode === 'rename-failure' && !failedRename && from.includes(path.join('.pack-update', 'new'))) {
        failedRename = true; throw Object.assign(new Error('fixture rename failure'), { code: 'EPERM' });
      }
      return fsx.renameRetry(from, to);
    } } });
    const updater = load('modupdates', {
      './packupdate': transaction,
      './net': { download: async () => { throw new Error('fixture download 404'); }, throwIfCancelled() {} },
    }, '\nmodule.exports.seed = (id, values) => lastCheck.set(id, values);');
    updater.seed(inst.id, [{ file: 'old.jar', filename, enabled: !disabled, title: 'Test Mod', source: 'modrinth', projectId: 'fixture', to: '2', url: 'https://fixture.invalid/new.jar', cached: mode === 'download-failure' ? undefined : cached, sha1: crypto.createHash('sha1').update('NEW MOD').digest('hex') }]);
    const result = await updater.apply(inst.id);
    const failure = ['rename-failure', 'bad-cache', 'download-failure'].includes(mode);
    if (failure) {
      assert.equal(result.done.length, 0); assert.equal(result.failed.length, 1);
      assert.equal(fs.readFileSync(old, 'utf8'), 'OLD MOD');
      assert.equal(fs.readFileSync(path.join(instances.dirOf(inst.id), 'mods-meta.json'), 'utf8'), metaBefore);
    } else {
      assert.equal(result.done.length, 1); assert.equal(result.failed.length, 0);
      const target = path.join(mods.dir(inst.id), filename + (disabled ? '.disabled' : ''));
      assert.equal(fs.readFileSync(target, 'utf8'), 'NEW MOD');
      if (filename !== 'old.jar') assert.equal(fs.existsSync(old), false);
      assert.equal(mods.readMeta(inst.id)[filename].version, '2');
    }
    assert.equal(fs.readFileSync(snapshot, 'utf8'), 'OLD MOD');
    assert.equal(fs.existsSync(path.join(instances.dirOf(inst.id), '.pack-update')), false);
    assert.ok(fs.readdirSync(mods.dir(inst.id)).every((name) => !name.endsWith('.part')));
  });
}
