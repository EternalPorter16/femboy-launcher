const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { profile, put } = require('./helpers');

for (const legacy of [false, true]) {
  test(`restore ${legacy ? 'legacy snapshot preserves' : 'new snapshot restores'} resourcepacks and shaderpacks`, (t) => {
    const p = profile(); t.after(() => p.done());
    const instances = p.load('core/instances'), snapshots = p.load('core/snapshots');
    const inst = instances.create({ name: 'Test pack', version: '1.21.1' });
    const game = instances.gameDir(inst.id);
    put(game, { 'mods/a.jar': 'OLD MOD', 'resourcepacks/a.zip': 'OLD RESOURCE', 'shaderpacks/a.zip': 'OLD SHADER' });
    const snapshot = snapshots.create(inst.id, 'Before pack update');
    // Locate this fixture's snapshot without depending on a hardcoded store path.
    const find = (base) => {
      for (const e of fs.readdirSync(base, { withFileTypes: true })) {
        if (!e.isDirectory()) continue;
        const dir = path.join(base, e.name);
        if (e.name === snapshot.id && fs.existsSync(path.join(dir, 'snapshot.json'))) return dir;
        const match = find(dir); if (match) return match;
      }
    };
    const saved = find(p.dir);
    assert.ok(saved);
    if (legacy) {
      const file = path.join(saved, 'snapshot.json');
      const info = JSON.parse(fs.readFileSync(file)); delete info.extraPacks;
      fs.writeFileSync(file, JSON.stringify(info));
      for (const name of ['resourcepacks', 'shaderpacks']) fs.rmSync(path.join(saved, name), { recursive: true, force: true });
    }
    put(game, { 'resourcepacks/a.zip': 'NEW RESOURCE', 'shaderpacks/a.zip': 'NEW SHADER', 'resourcepacks/new.zip': 'EXTRA' });
    snapshots.restore(inst.id, snapshot.id);
    assert.equal(fs.readFileSync(path.join(game, 'resourcepacks/a.zip'), 'utf8'), legacy ? 'NEW RESOURCE' : 'OLD RESOURCE');
    assert.equal(fs.readFileSync(path.join(game, 'shaderpacks/a.zip'), 'utf8'), legacy ? 'NEW SHADER' : 'OLD SHADER');
    assert.equal(fs.existsSync(path.join(game, 'resourcepacks/new.zip')), legacy);
  });
}
