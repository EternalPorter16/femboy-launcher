const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { plan, publish, retention } = require('../build/publish-s3');
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fl-s3-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'out'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '1.2.3' }));
  const setup = Buffer.from('setup fixture'), portable = Buffer.from('portable fixture');
  const sha = crypto.createHash('sha512').update(setup).digest('base64');
  const raw = `version: 1.2.3\nfiles:\n  - url: FemboyLauncher-Setup-1.2.3.exe\n    size: ${setup.length}\n    sha512: ${sha}\npath: FemboyLauncher-Setup-1.2.3.exe\nsha512: ${sha}\n`;
  for (const [name, data] of [['FemboyLauncher-Setup-1.2.3.exe', setup], ['FemboyLauncher-Portable-1.2.3.exe', portable], ['latest.yml', raw]]) fs.writeFileSync(path.join(root, 'out', name), data);
  return { root, p: plan(root, 'out') };
}
function remote({ corrupt, failPut, version } = {}) {
  const calls = [], objects = new Map();
  if (version) objects.set('latest.yml', Buffer.from(`version: ${version}\n`));
  return { calls, objects, async list() { calls.push('list'); return [...objects.keys()]; }, async remove(name) { calls.push('remove:' + name); objects.delete(name); }, async get(name) {
    calls.push('get:' + name);
    const body = objects.get(name);
    if (!body) return { status: 404 };
    return { status: 200, body, size: body.length, sha256: corrupt === name ? 'wrong' : hash(body) };
  }, async put(name, body) {
    calls.push('put:' + name);
    if (name === failPut) throw new Error('upload failed');
    objects.set(name, body);
  }};
}
test('S3: local version, size and SHA512 must match before network', t => {
  const { root } = fixture(t);
  fs.appendFileSync(path.join(root, 'out/FemboyLauncher-Setup-1.2.3.exe'), 'changed');
  assert.throws(() => plan(root, 'out'), /does not match/);
});
test('S3: both EXEs publicly verified before latest.yml is uploaded', async t => {
  const { p } = fixture(t), r = remote();
  await publish(p, r);
  const at = r.calls.indexOf('put:latest.yml');
  for (const f of p.files) assert.ok(r.calls.lastIndexOf('get:' + f.name) < at);
  assert.ok(r.calls.indexOf('list') > at, 'cleanup begins only after manifest publication');
});
test('S3: corruption never advertises a new release', async t => {
  const { p } = fixture(t), r = remote({ corrupt: 'FemboyLauncher-Portable-1.2.3.exe' });
  await assert.rejects(publish(p, r), /verification/);
  assert.ok(!r.calls.includes('put:latest.yml'));
});
test('S3: failed EXE upload keeps previous manifest', async t => {
  const { p } = fixture(t), r = remote({ failPut: p.files[1].name, version: '1.2.2' });
  await assert.rejects(publish(p, r));
  assert.ok(!r.calls.includes('put:latest.yml'));
  assert.match(r.objects.get('latest.yml').toString(), /1.2.2/);
});
test('S3: retry verifies existing files and does not overwrite immutable EXEs', async t => {
  const { p } = fixture(t), r = remote();
  await publish(p, r); r.calls.length = 0;
  await publish(p, r);
  assert.deepEqual(r.calls.filter(x => x.startsWith('put:')), ['put:latest.yml']);
});
test('S3: rebuilt EXE under same version is refused', async t => {
  const { p } = fixture(t), r = remote();
  r.objects.set(p.files[0].name, Buffer.from('different binary'));
  await assert.rejects(publish(p, r), /verification/);
  assert.ok(!r.calls.some(x => x.startsWith('put:')));
});
test('S3: newer published version cannot be downgraded', async t => {
  const { p } = fixture(t), r = remote({ version: '1.2.4' });
  await assert.rejects(publish(p, r), /downgrade/);
  assert.ok(!r.calls.some(x => x.startsWith('put:')));
});
test('S3: invalid or inaccessible channel is refused before upload', async t => {
  const { p } = fixture(t);
  for (const status of [403, 429, 500]) {
    const r = remote(); r.get = async () => ({ status });
    await assert.rejects(publish(p, r));
    assert.ok(!r.calls.some(x => x.startsWith('put:')));
  }
});

const pair = v => ['Setup', 'Portable'].map(kind => `FemboyLauncher-${kind}-${v}.exe`);
test('S3 retention: current and previous stay; exact older EXE and blockmap removed', () => {
  const names = [...pair('1.0.0'), ...pair('1.1.0'), ...pair('1.2.0'), 'FemboyLauncher-Setup-1.0.0.exe.blockmap'];
  const result = retention(names, '1.2.0', '1.1.0');
  assert.equal(result.previous, '1.1.0');
  assert.deepEqual(result.remove.sort(), [...pair('1.0.0'), 'FemboyLauncher-Setup-1.0.0.exe.blockmap'].sort());
});
test('S3 retention: unknown files, subfolders, invalid versions, newer releases untouched', () => {
  const extra = ['latest.yml', 'notes.txt', 'archive/FemboyLauncher-Setup-0.1.0.exe', 'FemboyLauncher-Setup-latest.exe', 'FemboyLauncher-Setup-1.0.0.exe.bak', ...pair('2.0.0')];
  assert.deepEqual(retention([...pair('1.1.0'), ...pair('1.2.0'), ...extra], '1.2.0').remove, []);
});
test('S3 retention: incomplete previous published release prevents all cleanup', () => {
  assert.throws(() => retention([...pair('1.2.0'), ...pair('1.0.0'), 'FemboyLauncher-Setup-1.1.0.exe'], '1.2.0', '1.1.0'), /incomplete/);
});
test('S3 retention: no previous complete release means no deletion', () => {
  assert.deepEqual(retention([...pair('1.2.0'), 'FemboyLauncher-Setup-1.0.0.exe'], '1.2.0').remove, []);
});
test('S3 cleanup executes only after successful channel verification', async t => {
  const { p } = fixture(t), r = remote({ version: '1.2.2' });
  for (const name of [...pair('1.2.1'), ...pair('1.2.2')]) r.objects.set(name, Buffer.from('old'));
  await publish(p, r);
  assert.ok(r.calls.indexOf('remove:' + pair('1.2.1')[0]) > r.calls.lastIndexOf('get:latest.yml'));
  for (const name of pair('1.2.2')) assert.ok(r.objects.has(name));
});
test('S3 cleanup never runs on failed publication', async t => {
  const { p } = fixture(t), r = remote({ failPut: 'latest.yml' });
  await assert.rejects(publish(p, r));
  assert.ok(!r.calls.includes('list'));
  assert.ok(!r.calls.some(c => c.startsWith('remove:')));
});
test('S3 cleanup failure is reported, release remains successful', async t => {
  const { p } = fixture(t), r = remote({ version: '1.2.2' });
  for (const name of [...pair('1.2.1'), ...pair('1.2.2')]) r.objects.set(name, Buffer.from('old'));
  r.remove = async () => { throw new Error('delete denied'); };
  const logs = [];
  await publish(p, r, line => logs.push(line));
  assert.ok(logs.some(line => line.includes('release is live, cleanup stopped')));
  assert.equal(r.objects.get('latest.yml'), p.raw);
});
test('S3 cleanup refuses deleting if channel changed concurrently', async t => {
  const { p } = fixture(t), r = remote();
  r.list = async () => { r.objects.set('latest.yml', Buffer.from('version: 2.0.0')); return [...pair('1.1.0'), ...pair('1.2.0'), ...p.files.map(f => f.name)]; };
  const logs = [];
  await publish(p, r, line => logs.push(line));
  assert.ok(!r.calls.some(c => c.startsWith('remove:')));
  assert.ok(logs.some(line => line.includes('cleanup stopped')));
});
