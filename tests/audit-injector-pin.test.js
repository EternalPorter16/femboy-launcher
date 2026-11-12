const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), os = require('os'), vm = require('vm'), crypto = require('crypto');
const core = path.join(__dirname, '../src/core');
const payload = Buffer.from('VERIFIED TEST JAR'); // never executed, only hashed
const pin = { version: 'test', size: payload.length, sha256: crypto.createHash('sha256').update(payload).digest('hex'), urls: ['https://fixture.invalid/pinned.jar', 'https://mirror.invalid/pinned.jar'] };
function fixture(t, { initial, mode } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'injector-pin-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const jar = path.join(root, 'authlib-injector.jar');
  if (initial) fs.writeFileSync(jar, initial);
  const calls = [], m = { exports: {} }; let cancelled = false;
  vm.runInNewContext(fs.readFileSync(path.join(core, 'yggdrasil.js'), 'utf8'), {
    module: m, process, Buffer,
    require: name => name === './injector-pin.json' ? { ...pin, urls: [...pin.urls] } : name === './store' ? { baseDir: () => root } : name === './net' ? {
      getJson() { assert.fail('runtime metadata is not a source of trust'); },
      download: async (url, file) => {
        calls.push(url);
        await new Promise(resolve => setTimeout(resolve, 10));
        if (mode === 'offline') throw Error('fixture offline');
        fs.writeFileSync(file, mode === 'bad-first' && calls.length === 1 ? Buffer.alloc(payload.length, 65) : payload);
        if (mode === 'cancel') cancelled = true;
      },
      throwIfCancelled() { if (cancelled) throw Object.assign(Error('fixture cancelled'), { cancelled: true }); },
    } : name === './fsx' && mode === 'rename-error' ? { renameRetry() { throw Error('fixture rename denied'); } } : name.startsWith('.') ? require(path.resolve(core, name)) : require(name),
  });
  return { root, jar, calls, ensure: m.exports.ensureInjector };
}
test('verified cache works offline without metadata requests', async t => {
  const f = fixture(t, { initial: payload, mode: 'offline' });
  assert.equal(await f.ensure(), f.jar); assert.deepEqual(f.calls, []);
});
test('a same-size altered cache is revalidated and replaced', async t => {
  const f = fixture(t, { initial: Buffer.alloc(payload.length, 65) });
  await f.ensure(); assert.deepEqual(fs.readFileSync(f.jar), payload); assert.deepEqual(f.calls, [pin.urls[0]]);
});
test('unverified cache is never returned on network failure and stays available for diagnosis', async t => {
  const f = fixture(t, { initial: 'OLD UNTRUSTED', mode: 'offline' });
  await assert.rejects(f.ensure(), /fixture offline/);
  assert.equal(fs.readFileSync(f.jar, 'utf8'), 'OLD UNTRUSTED');
  assert.deepEqual(fs.readdirSync(f.root), ['authlib-injector.jar']);
});
test('bad downloaded bytes are discarded and only pinned mirrors are tried', async t => {
  const f = fixture(t, { mode: 'bad-first' });
  await f.ensure(); assert.deepEqual(f.calls, pin.urls); assert.deepEqual(fs.readFileSync(f.jar), payload);
  assert.deepEqual(fs.readdirSync(f.root), ['authlib-injector.jar']);
});
test('cancellation cleans the temporary file and does not fall back to another host', async t => {
  const f = fixture(t, { initial: 'OLD', mode: 'cancel' });
  await assert.rejects(f.ensure(), e => e.cancelled);
  assert.deepEqual(f.calls, [pin.urls[0]]); assert.equal(fs.readFileSync(f.jar, 'utf8'), 'OLD');
  assert.deepEqual(fs.readdirSync(f.root), ['authlib-injector.jar']);
});
test('concurrent callers share one verified download', async t => {
  const f = fixture(t); const results = await Promise.all([f.ensure(), f.ensure(), f.ensure()]);
  assert.deepEqual(results, [f.jar, f.jar, f.jar]); assert.equal(f.calls.length, 1);
});
test('rename failure preserves old bytes and their hardlinked snapshot', async t => {
  const f = fixture(t, { initial: 'OLD', mode: 'rename-error' });
  const snapshot = path.join(f.root, 'snapshot.jar'); fs.linkSync(f.jar, snapshot);
  await assert.rejects(f.ensure(), /rename denied/);
  assert.equal(fs.readFileSync(f.jar, 'utf8'), 'OLD'); assert.equal(fs.readFileSync(snapshot, 'utf8'), 'OLD');
  assert.deepEqual(fs.readdirSync(f.root).sort(), ['authlib-injector.jar', 'snapshot.jar']);
});
test('production pin is a fixed reviewed release, not latest metadata', () => {
  const actual = require('../src/core/injector-pin.json');
  assert.equal(actual.version, '1.2.8'); assert.equal(actual.size, 349681);
  assert.equal(actual.sha256, '9c7f4343e6c82034958ffb48c14a2cb0c85928be7283103ce17da00c6d5a7b10');
  assert.ok(actual.urls.every(url => url.startsWith('https://') && url.includes('1.2.8') && !url.includes('latest')));
});
