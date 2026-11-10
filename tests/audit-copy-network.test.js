const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), vm = require('vm');
const { EventEmitter } = require('events');
const { profile, put } = require('./helpers');
const core = path.join(__dirname, '../src/core');

function loadVm(name, overrides = {}, suffix = '') {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(core, name + '.js'), 'utf8') + suffix, {
    module, Buffer, Date, process, setTimeout, clearTimeout,
    require: (n) => Object.hasOwn(overrides, n) ? overrides[n] : n.startsWith('.') ? require(path.resolve(core, n)) : require(n),
  });
  return module.exports;
}

test('duplicating a world with a backups-prefixed name preserves it and excludes only root backups', (t) => {
  const p = profile(); t.after(() => p.done());
  const instances = p.load('core/instances'), packs = p.load('core/packs');
  const inst = instances.create({ name: 'Original', version: '1.20.1' });
  put(instances.gameDir(inst.id), { 'saves/backups-ville/level.dat': 'WORLD', 'config/test.txt': 'CONFIG' });
  put(instances.dirOf(inst.id), { 'backups/old.zip': 'OLD BACKUP', 'bisect.json': '{}' });
  const copy = packs.duplicate(inst.id), dir = instances.dirOf(copy.id);
  assert.equal(fs.readFileSync(path.join(instances.gameDir(copy.id), 'saves/backups-ville/level.dat'), 'utf8'), 'WORLD');
  assert.equal(fs.existsSync(path.join(dir, 'backups')), false);
  assert.equal(fs.existsSync(path.join(dir, 'bisect.json')), false);
  assert.equal(instances.get(copy.id).id, copy.id);
});

test('duplicate materializes a linked world so edits do not change the original', (t) => {
  const p = profile(); t.after(() => p.done());
  const instances = p.load('core/instances'), packs = p.load('core/packs');
  const inst = instances.create({ name: 'Linked', version: '1.20.1' });
  const shared = path.join(p.dir, 'fixture-shared-world'); put(shared, { 'level.dat': 'ORIGINAL' });
  const saves = path.join(instances.gameDir(inst.id), 'saves'); fs.mkdirSync(saves, { recursive: true });
  fs.symlinkSync(shared, path.join(saves, 'LinkedWorld'), process.platform === 'win32' ? 'junction' : 'dir');
  const copy = packs.duplicate(inst.id);
  const dir = path.join(instances.gameDir(copy.id), 'saves/LinkedWorld');
  assert.equal(fs.lstatSync(dir).isSymbolicLink(), false);
  fs.writeFileSync(path.join(dir, 'level.dat'), 'COPY EDIT');
  assert.equal(fs.readFileSync(path.join(shared, 'level.dat'), 'utf8'), 'ORIGINAL');
});

for (const kind of ['duplicate', 'Prism import']) {
  test(`${kind} removes its incomplete instance when copying fails`, async (t) => {
    const p = profile(); t.after(() => p.done());
    const instances = p.load('core/instances');
    const original = instances.create({ name: 'Original', version: '1.20.1' });
    put(instances.gameDir(original.id), { 'saves/World/level.dat': 'ORIGINAL' });
    const count = instances.list().length;
    const packs = loadVm('packs', { fs: { ...fs, cpSync(_from, to) { put(to, { 'partial.txt': 'PARTIAL' }); throw new Error('fixture copy failure'); } } });
    if (kind === 'duplicate') assert.throws(() => packs.duplicate(original.id), /copy failure/);
    else {
      const prism = path.join(p.dir, 'fixture-prism');
      put(prism, { 'mmc-pack.json': JSON.stringify({ components: [{ uid: 'net.minecraft', version: '1.20.1' }] }), '.minecraft/options.txt': 'OPTIONS' });
      await assert.rejects(packs.importPath(prism), /copy failure/);
    }
    assert.equal(instances.list().length, count);
    assert.equal(fs.readFileSync(path.join(instances.gameDir(original.id), 'saves/World/level.dat'), 'utf8'), 'ORIGINAL');
  });
}

test('server ping rejects oversized or invalid length before allocating the claimed response', async () => {
  for (const input of [Buffer.alloc(1024 * 1024 + 1), Buffer.from([255, 255, 255, 255, 15])]) {
    const socket = new EventEmitter(); socket.destroy = socket.write = socket.setTimeout = () => {};
    const ping = loadVm('ping', { net: { createConnection: () => socket } });
    const pending = ping.ping('127.0.0.1:25565', 100);
    await Promise.resolve(); socket.emit('data', input);
    assert.equal((await pending).online, false);
  }
});

test('server ping has a total deadline even if the server continuously dribbles bytes', async () => {
  const socket = new EventEmitter(); let destroyed = false;
  socket.destroy = () => { destroyed = true; }; socket.write = socket.setTimeout = () => {};
  const ping = loadVm('ping', { net: { createConnection: () => socket } });
  const start = Date.now(), pending = ping.ping('127.0.0.1:25565', 40);
  await Promise.resolve(); socket.emit('data', Buffer.from([232, 7])); // announced frame: 1000 bytes
  const timer = setInterval(() => { if (!destroyed) socket.emit('data', Buffer.from([0])); }, 5);
  try { assert.equal((await pending).online, false); assert.ok(Date.now() - start >= 30 && Date.now() - start < 500); }
  finally { clearInterval(timer); }
});

test('Discord rejects negative and excessive frame lengths without looping', () => {
  for (const length of [-8, -1, 1024 * 1024 + 1]) {
    const discord = loadVm('discord', {}, '\nmodule.exports.probe = (chunk, socket) => { sock = socket; onData(chunk); return buf.length; };');
    const header = Buffer.alloc(8); header.writeInt32LE(1, 0); header.writeInt32LE(length, 4);
    let destroyed = 0;
    assert.equal(discord.probe(header, { destroy: () => destroyed++ }), 0);
    assert.equal(destroyed, 1);
  }
});
