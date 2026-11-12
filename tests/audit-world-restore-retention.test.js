const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), os = require('os'), vm = require('vm');
const AdmZip = require('adm-zip');
const { spawnSync } = require('child_process');
function fixture(t, fsOverrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'world-restore-retention-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const game = path.join(root, '.minecraft'), saves = path.join(game, 'saves'), archives = path.join(root, 'backups');
  fs.mkdirSync(saves, { recursive: true }); fs.mkdirSync(archives);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/core/worlds.js'), 'utf8'), {
    module, process, Buffer, Date, require: n => n === 'fs' ? { ...fs, ...fsOverrides } : n === './instances' ? { dirOf: () => root, gameDir: () => game } : require(n.startsWith(".") ? path.resolve(__dirname, "../src/core", n) : n),
  });
  function zip(file, entries, comment) {
    const z = new AdmZip(); for (const [name, text] of Object.entries(entries)) z.addFile(name, Buffer.from(text));
    if (comment) z.addZipComment(comment); z.writeZip(path.join(archives, file));
    return file;
  }
  function world(name) { fs.mkdirSync(path.join(saves, name)); fs.writeFileSync(path.join(saves, name, 'level.dat'), 'ORIGINAL'); }
  return { root, saves, archives, zip, world, worlds: module.exports };
}
test('failed world restore never exposes a partial world and leaves the archive intact', t => {
  let writes = 0;
  const f = fixture(t, { writeFileSync(file, ...args) {
    if (++writes === 2) throw Object.assign(Error('fixture disk full'), { code: 'ENOSPC' });
    return fs.writeFileSync(file, ...args);
  } });
  f.world('Original'); const file = f.zip('World-2026-01-01-00-00-00.zip', { 'World/level.dat': 'LEVEL', 'World/region/r.0.0.mca': 'REGION' });
  const before = fs.readFileSync(path.join(f.archives, file));
  assert.throws(() => f.worlds.restore('id', file), /fixture disk full/);
  assert.deepEqual(fs.readdirSync(f.saves), ['Original']);
  assert.equal(f.worlds.list('id').length, 1);
  assert.deepEqual(fs.readFileSync(path.join(f.archives, file)), before);
  assert.deepEqual(fs.readdirSync(path.join(f.root, '.minecraft/.cache/.world-restore')), []);
});
test('restore publishes a complete independent copy and preserves an earlier restored world', t => {
  const f = fixture(t); f.world('World');
  const file = f.zip('World-2026-01-01-00-00-00.zip', { 'World/level.dat': 'LEVEL', 'World/region/r.0.0.mca': 'REGION' });
  const first = f.worlds.restore('id', file), second = f.worlds.restore('id', file);
  assert.notEqual(first, second);
  for (const name of [first, second]) assert.equal(fs.readFileSync(path.join(f.saves, name, 'region/r.0.0.mca'), 'utf8'), 'REGION');
  assert.equal(fs.readFileSync(path.join(f.saves, 'World/level.dat'), 'utf8'), 'ORIGINAL');
});
test('manual -auto backups remain manual and survive retention for the other world', async t => {
  const f = fixture(t); f.world('Foo'); f.world('Foo-auto');
  const manual = await f.worlds.backup('id', 'Foo-auto');
  const entry = f.worlds.backups('id').find(b => b.file === path.basename(manual));
  assert.equal(entry.world, 'Foo-auto'); assert.equal(entry.auto, false);
  await f.worlds.autoBackup('id', 0, { mode: 'session', keep: 1 });
  await f.worlds.autoBackup('id', 0, { mode: 'session', keep: 1 });
  assert.ok(fs.existsSync(manual));
});
test('legacy archives use their embedded world root, not the ambiguous -auto suffix', t => {
  const f = fixture(t);
  f.zip('Foo-auto-2026-01-01-00-00-00.zip', { 'Foo-auto/level.dat': 'MANUAL' });
  f.zip('Foo-auto-2026-01-02-00-00-00.zip', { 'Foo/level.dat': 'AUTOMATIC' });
  const all = f.worlds.backups('id');
  assert.equal(all.find(b => b.file.includes('01-01')).world, 'Foo-auto');
  assert.equal(all.find(b => b.file.includes('01-01')).auto, false);
  assert.equal(all.find(b => b.file.includes('01-02')).auto, true);
});
test('unreadable ambiguous archives are retained conservatively', async t => {
  const f = fixture(t); f.world('Foo');
  const file = 'Foo-auto-2026-01-01-00-00-00.zip'; fs.writeFileSync(path.join(f.archives, file), 'not a zip');
  await f.worlds.autoBackup('id', 0, { mode: 'session', keep: 1 });
  assert.equal(f.worlds.backups('id').find(b => b.file === file).auto, false);
  assert.ok(fs.existsSync(path.join(f.archives, file)));
});
test('failed final rename leaves no visible new world and preserves the source', t => {
  const f = fixture(t, { renameSync() { throw Object.assign(Error('fixture rename blocked'), { code: 'EACCES' }); } });
  f.world('Original'); const file = f.zip('World-2026-01-01-00-00-00.zip', { 'World/level.dat': 'LEVEL' });
  assert.throws(() => f.worlds.restore('id', file), /rename blocked/);
  assert.deepEqual(fs.readdirSync(f.saves), ['Original']);
  assert.equal(fs.readFileSync(path.join(f.saves, 'Original/level.dat'), 'utf8'), 'ORIGINAL');
  assert.deepEqual(fs.readdirSync(path.join(f.root, '.minecraft/.cache/.world-restore')), []);
});
test('mixed archive roots and missing level.dat cannot publish a partial world', t => {
  const f = fixture(t);
  for (const [day, entries] of [[1, { 'World/level.dat': 'LEVEL', 'Other/data': 'BAD' }], [2, { 'World/region/r.0.0.mca': 'REGION' }]]) {
    const file = f.zip(`World-2026-01-0${day}-00-00-00.zip`, entries);
    assert.throws(() => f.worlds.restore('id', file));
    assert.deepEqual(fs.readdirSync(f.saves), []);
  }
});
test('abrupt process exit during restore leaves only hidden recovery material, not a playable world', t => {
  const f = fixture(t); f.world('Original');
  const file = f.zip('World-2026-01-01-00-00-00.zip', { 'World/level.dat': 'LEVEL', 'World/region/r.0.0.mca': 'REGION' });
  const script = `
    const fs=require('fs'),vm=require('vm'),path=require('path');let writes=0;
    const m={exports:{}};const root=${JSON.stringify(f.root)};
    vm.runInNewContext(fs.readFileSync(${JSON.stringify(path.join(__dirname, '../src/core/worlds.js'))},'utf8'),{
      module:m,process,Buffer,Date,require:n=>n==='fs'?{...fs,writeFileSync(...args){if(++writes===2)process.exit(17);return fs.writeFileSync(...args)}}:n==='./instances'?{dirOf:()=>root,gameDir:()=>path.join(root,'.minecraft')}:require(n.startsWith(".")?path.resolve(${JSON.stringify(path.join(__dirname, "../src/core"))},n):n)
    });m.exports.restore('id',${JSON.stringify(file)});
  `;
  const child = spawnSync(process.execPath, ['-e', script], { cwd: path.join(__dirname, '..'), encoding: 'utf8', windowsHide: true, timeout: 10000 });
  assert.equal(child.status, 17, child.stderr);
  assert.deepEqual(fs.readdirSync(f.saves), ['Original']);
  assert.equal(f.worlds.list('id').length, 1);
  assert.ok(fs.existsSync(path.join(f.archives, file)));
  assert.equal(fs.readdirSync(path.join(f.root, '.minecraft/.cache/.world-restore')).length, 1);
  const restored = f.worlds.restore('id', file);
  assert.equal(fs.readFileSync(path.join(f.saves, restored, 'region/r.0.0.mca'), 'utf8'), 'REGION');
});
