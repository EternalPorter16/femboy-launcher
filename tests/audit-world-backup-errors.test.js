const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), os = require('os'), vm = require('vm');
const { Writable } = require('stream');
const yazl = require('yazl');
const AdmZip = require('adm-zip');

function fixture(t, extra = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'femboy-backup-errors-'));
  t.after(() => { assert.ok(path.basename(root).startsWith('femboy-backup-errors-')); fs.rmSync(root, { recursive: true, force: true }); });
  const game = path.join(root, '.minecraft'), world = path.join(game, 'saves/World');
  fs.mkdirSync(world, { recursive: true });
  fs.writeFileSync(path.join(world, 'level.dat'), 'WORLD CONTENT');
  fs.writeFileSync(path.join(world, 'session.lock'), 'LOCK');
  const m = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/core/worlds.js'), 'utf8'), {
    module: m, process, Buffer, Date,
    require: (n) => Object.hasOwn(extra, n) ? extra[n] : n === './instances' ? { dirOf: () => root, gameDir: () => game } : require(n),
  });
  return { root, world, worlds: m.exports };
}

async function bounded(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('backup stayed pending')), 2000); })]); }
  finally { clearTimeout(timer); }
}

test('world backup publishes only a completed ZIP and excludes the session lock', async (t) => {
  const f = fixture(t);
  const pending = f.worlds.backup('test', 'World');
  assert.equal(f.worlds.backups('test').length, 0, 'in-progress archive must not be listed');
  const zip = await pending;
  const archive = new AdmZip(zip);
  assert.equal(archive.readAsText('World/level.dat'), 'WORLD CONTENT');
  assert.equal(archive.getEntry('World/session.lock'), null);
  assert.equal(f.worlds.backups('test').length, 1);
  assert.ok(fs.readdirSync(path.dirname(zip)).every((name) => name.endsWith('.zip')));
});

test('a disappearing source rejects and never leaves a truncated listed backup', async (t) => {
  const f = fixture(t, { fs: { ...fs, createReadStream(file, ...args) {
    fs.unlinkSync(file);
    return fs.createReadStream(file, ...args);
  } } });
  await assert.rejects(bounded(f.worlds.backup('test', 'World')), /ENOENT/);
  assert.equal(f.worlds.backups('test').length, 0);
  assert.deepEqual(fs.readdirSync(path.join(f.root, 'backups')), []);
});

test('archive write failure rejects, closes the file and preserves earlier backups', async (t) => {
  const f = fixture(t, { fs: { ...fs, createWriteStream(_file, options) {
    fs.closeSync(options.fd);
    return new Writable({ write(_chunk, _encoding, callback) { callback(Object.assign(new Error('fixture disk full'), { code: 'ENOSPC' })); } });
  } } });
  const dir = path.join(f.root, 'backups'); fs.mkdirSync(dir);
  const old = path.join(dir, 'World-2026-01-01-00-00-00.zip'); fs.writeFileSync(old, 'OLD BACKUP');
  await assert.rejects(bounded(f.worlds.backup('test', 'World')), (e) => e.code === 'ENOSPC');
  assert.equal(fs.readFileSync(old, 'utf8'), 'OLD BACKUP');
  assert.deepEqual(fs.readdirSync(dir), [path.basename(old)]);
});

test('parallel backups in one second reserve different names and preserve both archives', async (t) => {
  const f = fixture(t);
  const files = await Promise.all([f.worlds.backup('test', 'World'), f.worlds.backup('test', 'World')]);
  assert.notEqual(files[0], files[1]);
  assert.equal(f.worlds.backups('test').length, 2);
  for (const file of files) assert.equal(new AdmZip(file).readAsText('World/level.dat'), 'WORLD CONTENT');
});
