const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { Writable } = require('stream');
const crypto = require('crypto');
const fsx = require('../src/core/fsx');

function setup(t, { createWriteStream, response } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'femboy-download-safety-'));
  t.after(() => { assert.ok(path.basename(dir).startsWith('femboy-download-safety-')); fs.rmSync(dir, { recursive: true, force: true }); });
  const dest = path.join(dir, 'existing.bin');
  fs.writeFileSync(dest, 'ORIGINAL');
  const module = { exports: {} };
  const source = fs.readFileSync(path.join(__dirname, '../src/core/net.js'), 'utf8');
  vm.runInNewContext(source, {
    module, Buffer, URL, AbortController, AbortSignal, Response,
    setTimeout: (...args) => { const timer = setTimeout(...args); timer.unref(); return timer; }, clearTimeout,
    fetch: async () => response ? response() : new Response(Buffer.alloc(200000, 7)),
    require: (n) => n === 'fs' && createWriteStream ? { ...fs, createWriteStream } : n === '../../package.json' ? { version: 'test' } : n === './fsx' ? fsx : require(n),
  });
  module.exports.setRetryDelay(1);
  return { net: module.exports, dir, dest };
}

async function settles(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('operation remained pending')), 1000); })]); }
  finally { clearTimeout(timer); }
}

for (const code of ['ENOSPC', 'EPERM']) {
  test(`download rejects ${code} promptly and preserves the original`, async (t) => {
    const f = setup(t, { createWriteStream: () => {
      const out = new Writable({ write(_, __, callback) { callback(Object.assign(new Error('fixture write failure'), { code })); } });
      // Keep the old broken implementation from crashing the test runner;
      // its missing error propagation still fails the bounded-settlement check.
      out.on('error', () => {});
      return out;
    } });
    await assert.rejects(settles(f.net.download('https://fixture.invalid/file', f.dest)), (e) => e.code === code);
    assert.equal(fs.readFileSync(f.dest, 'utf8'), 'ORIGINAL');
    assert.deepEqual(fs.readdirSync(f.dir), ['existing.bin']);
  });
}

test('cancel interrupts a writable which never drains', async (t) => {
  const f = setup(t, { createWriteStream: () => new Writable({ highWaterMark: 1, write() {} }) });
  const token = f.net.cancelToken();
  const pending = f.net.runCancellable(token, () => f.net.download('https://fixture.invalid/file', f.dest));
  setTimeout(() => token.cancel(), 30);
  await assert.rejects(settles(pending), (e) => e.cancelled === true);
  assert.equal(fs.readFileSync(f.dest, 'utf8'), 'ORIGINAL');
});

for (const mode of ['404', 'bad-hash', 'already-cancelled']) {
  test(`failed download preserves destination and removes only its temporary file: ${mode}`, async (t) => {
    const f = setup(t, { response: () => new Response('NEW', { status: mode === '404' ? 404 : 200 }) });
    const token = f.net.cancelToken();
    if (mode === 'already-cancelled') token.cancel();
    await assert.rejects(settles(f.net.runCancellable(token, () => f.net.download('https://fixture.invalid/file', f.dest, mode === 'bad-hash' ? { sha1: '0'.repeat(40) } : {}))));
    assert.equal(fs.readFileSync(f.dest, 'utf8'), 'ORIGINAL');
    assert.deepEqual(fs.readdirSync(f.dir), ['existing.bin']);
  });
}

test('successful replacement preserves a hardlinked snapshot and leaves no temporary files', async (t) => {
  const f = setup(t, { response: () => new Response('NEW') });
  const snapshot = path.join(f.dir, 'snapshot.bin');
  fs.linkSync(f.dest, snapshot);
  const sha1 = crypto.createHash('sha1').update('NEW').digest('hex');
  await f.net.download('https://fixture.invalid/file', f.dest, { sha1 });
  assert.equal(fs.readFileSync(f.dest, 'utf8'), 'NEW');
  assert.equal(fs.readFileSync(snapshot, 'utf8'), 'ORIGINAL');
  assert.equal(fs.readdirSync(f.dir).length, 2);
});

test('cancellation during response creation waits for the file to close before cleanup', async (t) => {
  let token;
  const f = setup(t, { response: () => { token.cancel(); return new Response('NEW'); } });
  token = f.net.cancelToken();
  await assert.rejects(settles(f.net.runCancellable(token, () => f.net.download('https://fixture.invalid/file', f.dest))), (e) => e.cancelled === true);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(fs.readFileSync(f.dest, 'utf8'), 'ORIGINAL');
  assert.deepEqual(fs.readdirSync(f.dir), ['existing.bin']);
});
