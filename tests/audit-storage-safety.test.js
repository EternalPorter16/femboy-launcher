const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { profile, put, blockInternet } = require('./helpers');

function setup(t) {
  const unblock = blockInternet(), p = profile(); t.after(() => { unblock(); p.done(); });
  const instances = p.load('core/instances');
  const inst = instances.create({ name: 'Protected instance', version: '1.20.1', loader: 'vanilla' });
  const root = p.store.paths().root;
  put(root, {
    'versions/1.20.1/1.20.1.json': JSON.stringify({ id: '1.20.1', type: 'release', javaVersion: { majorVersion: 17 }, libraries: [{ name: 'test:needed:1', downloads: { artifact: { path: 'test/needed.jar', url: 'https://fixture.invalid/needed.jar' } } }], assetIndex: { id: 'fixture-index' } }),
    'versions/1.20.1/1.20.1.jar': 'CLIENT', 'libraries/test/needed.jar': 'NEEDED', 'libraries/test/unused.jar': 'UNUSED',
    'assets/indexes/fixture-index.json': JSON.stringify({ objects: {} }),
  });
  const game = instances.gameDir(inst.id);
  put(game, { 'saves/World/level.dat': 'WORLD' });
  return { p, root, game, instances, inst, storage: p.load('core/storage') };
}

for (const mode of ['invalid-json', 'missing-version', 'wrong-id', 'version-json', 'asset-index', 'missing-index', 'pending-update']) {
  test(`cache cleanup refuses uncertain ownership: ${mode}`, async (t) => {
    const f = setup(t);
    const file = path.join(f.instances.dirOf(f.inst.id), 'instance.json');
    if (mode === 'invalid-json') fs.writeFileSync(file, '{');
    if (mode === 'missing-version') fs.writeFileSync(file, JSON.stringify({ id: f.inst.id }));
    if (mode === 'wrong-id') fs.writeFileSync(file, JSON.stringify({ ...f.inst, id: 'someone-else' }));
    if (mode === 'version-json') fs.writeFileSync(path.join(f.root, 'versions/1.20.1/1.20.1.json'), '{');
    if (mode === 'asset-index') fs.writeFileSync(path.join(f.root, 'assets/indexes/fixture-index.json'), '{');
    if (mode === 'missing-index') fs.unlinkSync(path.join(f.root, 'assets/indexes/fixture-index.json'));
    if (mode === 'pending-update') fs.mkdirSync(path.join(f.instances.dirOf(f.inst.id), '.pack-update'));
    await assert.rejects(f.storage.scan(), /Очистка/);
    await assert.rejects(f.storage.clean(['versions', 'libraries', 'assets', 'java']), /Очистка/);
    assert.equal(fs.readFileSync(path.join(f.root, 'versions/1.20.1/1.20.1.jar'), 'utf8'), 'CLIENT');
    assert.equal(fs.readFileSync(path.join(f.root, 'libraries/test/needed.jar'), 'utf8'), 'NEEDED');
    assert.equal(fs.readFileSync(path.join(f.game, 'saves/World/level.dat'), 'utf8'), 'WORLD');
  });
}

test('valid metadata still allows removing only an unused library', async (t) => {
  const f = setup(t);
  await f.storage.clean(['libraries']);
  assert.equal(fs.existsSync(path.join(f.root, 'libraries/test/unused.jar')), false);
  assert.equal(fs.readFileSync(path.join(f.root, 'libraries/test/needed.jar'), 'utf8'), 'NEEDED');
});
