const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { EventEmitter } = require('events');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('destroying the last test window is handled until explicit completion', () => {
  const events = {};
  const app = { setPath() {}, on: (name, fn) => { events[name] = fn; }, whenReady: () => ({ then() {} }) };
  vm.runInNewContext(read('tests/electron/main.js'), {
    require: (n) => n === 'electron' ? { app } : require(n),
    __dirname: '/tests/electron', process: { env: {} },
  });
  assert.equal(typeof events['window-all-closed'], 'function');
  events['window-all-closed']();
});

test('Electron runner rejects an incomplete report even when Electron exits 0', () => {
  for (const [report, status, expected] of [['', 0, 1], ['✔ partial\n', 0, 1], ['Всё хорошо\n', 0, 0], ['Всё хорошо\n', 1, 1], ['ПРОВАЛЕНО: 1\n', 0, 1]]) {
    let exit;
    vm.runInNewContext(read('tests/electron/run.js'), {
      __dirname: '/tests/electron', console: { log() {} },
      process: { env: {}, exit: (code) => { exit = code; } },
      require: (n) => ({
        electron: 'unused', child_process: { spawnSync: () => ({ status }) },
        fs: { mkdtempSync: () => '/tmp/test', existsSync: () => true, readFileSync: () => report, rmSync() {} },
        os: { tmpdir: () => '/tmp' }, path,
      })[n],
    });
    assert.equal(exit, expected, JSON.stringify({ report, status }));
  }
});

test('RU and EN loading options preserve the current Minecraft version', async () => {
  const code = read('src/renderer/app/modals.js');
  const fn = code.slice(code.indexOf('async function fillVersionSelect'), code.indexOf('\nfunction openInstanceModal'));
  for (const loading of ['Загружаю версии…', 'Loading versions…']) {
    const select = { value: '', innerHTML: '' };
    const fill = vm.runInNewContext(`(${fn})`, {
      loadVersions: async () => ({ versions: [{ id: '26.3', type: 'release' }, { id: '1.21.1', type: 'release' }], latest: { release: '26.3' } }),
      esc: (s) => s, toast: () => {},
    });
    // Model the value of the loading option from the actual markup.
    const option = code.match(/<select id="mVersion"><option([^>]*)>([^<]*)<\/option>/);
    assert.ok(option);
    select.value = /value=""/.test(option[1]) ? '' : loading;
    await fill(select, { current: '1.21.1' });
    assert.equal(select.value, '1.21.1', loading);
    select.value = '26.3';
    await fill(select, { current: '1.21.1' });
    assert.equal(select.value, '26.3', 'explicit user selection survives refill');
  }
});

test('server favicon rejects markup, oversized data and a non-PNG payload', async () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8Dwn4GBgYGJAQoAHxcCAr7cjZ0AAAAASUVORK5CYII=';
  for (const [favicon, expected] of [[png, png], [png + '"/><iframe srcdoc="x">', null], ['data:image/png;base64,AAAA', null], ['data:image/png;base64,' + 'A'.repeat(100000), null]]) {
    const socket = new EventEmitter();
    socket.setTimeout = socket.write = socket.destroy = () => {};
    const m = { exports: {} };
    vm.runInNewContext(read('src/core/ping.js'), { Buffer, Date, setTimeout, clearTimeout, module: m, require: (n) => n === 'net' ? { createConnection: () => socket } : require(n) });
    const pending = m.exports.ping('127.0.0.1:25565');
    await Promise.resolve();
    const json = Buffer.from(JSON.stringify({ favicon }));
    const vint = (v) => { const a = []; do { let b = v & 127; v >>>= 7; a.push(b | (v ? 128 : 0)); } while(v); return Buffer.from(a); };
    const body = Buffer.concat([Buffer.from([0]), vint(json.length), json]);
    socket.emit('data', Buffer.concat([vint(body.length), body]));
    assert.equal((await pending).favicon, expected);
  }
});

test('Share passes an untrusted filename as data, outside PowerShell command arguments', async () => {
  const source = read('src/main.js');
  const snippet = source.slice(source.indexOf("handle('instances:share'"), source.indexOf('// Список друзей', source.indexOf("handle('instances:share'")));
  let handler, invocation;
  vm.runInNewContext(snippet, {
    handle: (_, fn) => { handler = fn; }, path, fs: { mkdirSync() {} },
    instances: { get: () => ({ name: "a$(ni marker);b'" }) },
    store: { baseDir: () => '/fixture', bump() {} },
    packs: { exportMrpack: async () => ({}) }, withTask: (fn) => fn(), shell: { showItemInFolder() {} },
    process: { env: {} },
    require: () => ({ execFile: (exe, args, opts, cb) => { invocation = { exe, args, opts }; cb(null); } }),
  });
  await handler('test');
  assert.ok(invocation.opts.env?.FEMBOY_SHARE_FILE?.endsWith("a$(ni marker);b'.mrpack"));
  assert.ok(!invocation.args.some((arg) => arg.includes('ni marker')));
  assert.ok(invocation.args.includes('Set-Clipboard -LiteralPath $env:FEMBOY_SHARE_FILE'));
});

test('renderer assigns favicon to an img property instead of interpreting it as markup', async () => {
  const code = read('src/renderer/app/details.js');
  const fn = code.slice(code.indexOf('function renderServers'), code.indexOf('\nfunction packBlock'));
  const malicious = 'data:image/png;base64,AAAA"><iframe srcdoc="bad">';
  let replacement, htmlWritten = false;
  const fav = { replaceWith: (img) => { replacement = img; }, set outerHTML(_) { htmlWritten = true; } };
  const row = { isConnected: true }, status = {}, form = {};
  const render = vm.runInNewContext(`(${fn})`, {
    instById: () => ({ servers: [{ name: 'Test', address: '127.0.0.1' }] }),
    activeAccount: () => null, esc: (s) => s,
    call: async () => ({ online: true, favicon: malicious }),
    $: (selector) => selector.startsWith('.srv-row') ? row : selector === '[data-fav]' ? fav : selector === '[data-status]' ? status : form,
    document: { createElement: (tagName) => ({ tagName }) },
  });
  render({ id: 'test' }, {});
  await new Promise(setImmediate);
  assert.equal(htmlWritten, false);
  assert.equal(replacement?.tagName, 'img');
  assert.equal(replacement?.src, malicious);
});
