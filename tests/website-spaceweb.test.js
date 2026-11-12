const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { plan, publish, digest } = require('../build/publish-spaceweb.js');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fl-spaceweb-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const out = path.join(root, 'website/dist');
  fs.mkdirSync(path.join(root, 'website/src/config'), { recursive: true });
  fs.writeFileSync(path.join(root, 'website/src/config/downloads.json'), JSON.stringify({ release: { version: '0.10.2' } }));
  const routes = ['', 'en/', 'releases/', 'en/releases/', 'guides/setup-or-portable/', 'en/guides/setup-or-portable/', 'guides/install-modrinth-modpack/', 'en/guides/install-modrinth-modpack/'];
  for (const route of routes) {
    fs.mkdirSync(path.join(out, route), { recursive: true });
    fs.writeFileSync(path.join(out, route, 'index.html'), `<html lang="${route.startsWith('en/') ? 'en' : 'ru'}"><head><title>Femboy Launcher</title></head><body>Femboy Launcher <a href="https://downloads.femboylauncher.ru/FemboyLauncher-Setup-0.10.2.exe">Setup</a> FemboyLauncher-Portable-0.10.2.exe</body></html>`);
  }
  fs.writeFileSync(path.join(out, 'robots.txt'), 'User-agent: *\nAllow: /');
  fs.writeFileSync(path.join(out, '404.html'), '<html><head><meta name="robots" content="noindex"></head><body>Femboy Launcher 404</body></html>');
  fs.writeFileSync(path.join(out, 'sitemap.xml'), '<urlset></urlset>');
  fs.writeFileSync(path.join(out, 'app.js'), 'console.log("noindex is a word in code");');
  return { root, out };
}
function remote({ corrupt = false, uploadFail = false, swapFail = false, lostAck = false, changed = false, rollbackFail = false, busy = false } = {}) {
  const old = Buffer.from('Femboy Launcher old website');
  const files = new Map([['/public_html/index.html', old], ['/public_html/keep.txt', Buffer.from('foreign file preserved in backup')]]);
  const dirs = new Set(['/public_html']);
  const calls = [];
  let preflightDone = false;
  return {
    files, dirs, calls, old,
    async preflight() { preflightDone = true; return digest(old); },
    async mkdir(dir) { calls.push('mkdir ' + dir); if (busy && dir.endsWith('lock')) throw new Error('busy'); if (dirs.has(dir)) throw new Error('exists'); dirs.add(dir); },
    async rmdir(dir) { calls.push('rmdir ' + dir); dirs.delete(dir); },
    async ensureDir(dir) { dirs.add(dir); },
    async put(file, body) { calls.push('put ' + file); if (uploadFail) throw new Error('upload failed'); files.set(file, Buffer.from(body)); },
    async get(file) {
      if (corrupt && file.includes('stage-') && file.endsWith('/index.html')) return Buffer.from('corrupt');
      if (changed && preflightDone && file === '/public_html/index.html') return Buffer.from('edited meanwhile');
      if (!files.has(file)) throw new Error('missing ' + file);
      return files.get(file);
    },
    async exists(dir) { return dirs.has(dir) || files.has(dir); },
    async list(dir) { return [...dirs, ...files.keys()].filter(p => p.startsWith(dir + '/') && !p.slice(dir.length + 1).includes('/')); },
    async remove(file) { files.delete(file); },
    reconnect() {},
    async move(from, to) {
      calls.push('move ' + from + ' ' + to);
      if (swapFail && from.includes('stage-')) throw new Error('rename failed');
      if (rollbackFail && from.includes('backup-')) throw new Error('restore failed');
      if (!dirs.has(from) || dirs.has(to)) throw new Error('invalid rename');
      for (const d of [...dirs]) if (d === from || d.startsWith(from + '/')) { dirs.delete(d); dirs.add(to + d.slice(from.length)); }
      for (const [f,b] of [...files]) if (f.startsWith(from + '/')) { files.delete(f); files.set(to + f.slice(from.length), b); }
      if (lostAck && from.includes('stage-')) throw new Error('connection lost after rename');
    },
  };
}
test('SpaceWeb preview is isolated, noindex, and keeps download metadata and source intact', (t) => {
  const f = fixture(t); const before = fs.readFileSync(path.join(f.out, 'index.html'));
  const p = plan(f.root);
  assert(p.files.find(f => f.name === 'index.html').body.includes('noindex, nofollow'));
  assert(p.files.find(f => f.name === '.htaccess').body.includes('X-Robots-Tag'));
  assert(p.files.find(f => f.name === 'robots.txt').body.includes('Disallow: /'));
  assert.deepEqual(fs.readFileSync(path.join(f.out, 'index.html')), before);
  const production = plan(f.root, { preview: false, previewHost: 'site.fixture.test' });
  assert(!production.files.find(f => f.name === 'index.html').body.includes('noindex'));
});
test('SpaceWeb rejects non-public files, wrong version and production noindex', (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.out, 'secret.env'), 'fixture');
  assert.throws(() => plan(f.root), /Non-public/); fs.unlinkSync(path.join(f.out, 'secret.env'));
  const index = path.join(f.out, 'index.html'); const body = fs.readFileSync(index, 'utf8');
  fs.writeFileSync(index, body.replaceAll('0.10.2.exe', '0.10.1.exe'));
  assert.throws(() => plan(f.root), /version/);
  fs.writeFileSync(index, body.replace('<head>', '<head><meta name="robots" content="noindex">'));
  assert.throws(() => plan(f.root, { preview: false, previewHost: 'site.fixture.test' }), /Production page/);
});
test('SpaceWeb refuses missing required outputs and hidden directories', t => {
  for (const name of ['404.html', 'robots.txt', 'sitemap.xml']) {
    const f = fixture(t); fs.unlinkSync(path.join(f.out, name)); assert.throws(() => plan(f.root), /Required website file/);
  }
  const f = fixture(t); fs.mkdirSync(path.join(f.out, '.private')); fs.writeFileSync(path.join(f.out, '.private/data.json'), '{}');
  assert.throws(() => plan(f.root), /Unsafe website entry/);
});
test('SpaceWeb stages and hashes everything, switches directories and preserves the whole previous site', async (t) => {
  const p = plan(fixture(t).root); const r = remote();
  const result = await publish(p, r);
  assert.deepEqual(r.files.get('/public_html/index.html'), p.files.find(f => f.name === 'index.html').body);
  assert.deepEqual(r.files.get(result.backup + '/index.html'), r.old);
  assert(r.files.has(result.backup + '/keep.txt'));
  assert(!r.dirs.has('/.fl-site-deploy-lock'));
  assert.equal(r.calls.filter(c => c.startsWith('move ') && !c.startsWith('move /.fl-site-deploy-lock ')).length, 2);
});
for (const [name, options] of [['upload failure', { uploadFail: true }], ['bad checksum', { corrupt: true }], ['concurrent edit', { changed: true }], ['existing lock', { busy: true }]]) {
  test('SpaceWeb ' + name + ' cannot replace the working website', async (t) => {
    const p = plan(fixture(t).root); const r = remote(options);
    await assert.rejects(publish(p, r));
    assert.deepEqual(r.files.get('/public_html/index.html'), r.old);
    assert(!r.calls.some(c => c.startsWith('move ') && !c.startsWith('move /.fl-site-deploy-lock ')));
    if (options.busy) assert(!r.calls.some(c => c.startsWith('put ')));
  });
}
for (const [name, options] of [['failed second rename', { swapFail: true }], ['lost rename acknowledgement', { lostAck: true }], ['failed public verification', {}]]) {
  test('SpaceWeb restores previous site after ' + name, async (t) => {
    const p = plan(fixture(t).root); const r = remote(options);
    await assert.rejects(publish(p, r, { verify: async () => { throw new Error('verification failed'); } }));
    assert.deepEqual(r.files.get('/public_html/index.html'), r.old);
    assert(r.files.has('/public_html/keep.txt'));
    assert(!r.dirs.has('/.fl-site-deploy-lock'));
  });
}
test('SpaceWeb keeps lock and backup if recovery is blocked', async (t) => {
  const p = plan(fixture(t).root); const r = remote({ swapFail: true, rollbackFail: true });
  await assert.rejects(publish(p, r), /recovery requires attention/);
  assert(r.dirs.has('/.fl-site-deploy-lock'));
  assert([...r.dirs].some(d => d.startsWith('/.fl-site-backup-')));
});
test('Website dispatcher keeps Firebase active, supports SpaceWeb failures, and rejects invalid config', { skip: process.platform !== 'win32' }, (t) => {
  const { spawnSync } = require('node:child_process');
  const real = path.join(__dirname, '..');
  const f = fixture(t);
  const build = path.join(f.root, 'build'); const bin = path.join(f.root, 'fakebin');
  fs.mkdirSync(build); fs.mkdirSync(bin);
  for (const name of ['deploy-website.bat', 'website-provider.js']) fs.copyFileSync(path.join(real, 'build', name), path.join(build, name));
  fs.writeFileSync(path.join(bin, 'firebase.cmd'), '@echo off\necho firebase>>"%SW_TEST_LOG%"\nexit /b 0\n');
  fs.writeFileSync(path.join(bin, 'powershell.cmd'), '@echo off\necho spaceweb>>"%SW_TEST_LOG%"\nexit /b 3\n');
  const log = path.join(f.root, 'dispatcher.log');
  for (const [provider, expectedStatus, expectedLog] of [['firebase', 0, 'firebase'], ['spaceweb', 3, 'spaceweb'], ['unknown', 1, '']]) {
    fs.writeFileSync(path.join(build, 'website-hosting.json'), JSON.stringify({ activeProvider: provider }));
    fs.rmSync(log, { force: true });
    const result = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d','/c','build\\deploy-website.bat'], { cwd: f.root, windowsHide: true, encoding: 'utf8', timeout: 15000, env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH, SW_TEST_LOG: log } });
    assert.equal(result.status, expectedStatus, result.stdout + result.stderr);
    assert.equal(fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim() : '', expectedLog);
  }
});

test('Production Apache rules preserve HTTPS directory redirects and protect deployment metadata', t => {
  const f = fixture(t);
  const production = plan(f.root, { preview: false, previewHost: 'site.fixture.test' }).files.find(f => f.name === '.htaccess').body.toString();
  assert.match(production, /RewriteCond %\{REQUEST_FILENAME\} -d/);
  // технический адрес хостинга (из локальной конфигурации, вне git) получает noindex; без него боевая публикация не собирается
  assert.ok(production.includes('SetEnvIfNoCase Host "^site[.]fixture[.]test(:[0-9]+)?$" fl_preview=1'));
  assert.throws(() => plan(f.root, { preview: false }), /technical preview host is required/);
  assert.match(production, /https:\/\/femboylauncher\.ru%\{REQUEST_URI\}\/ \[R=301,L,NE\]/);
  assert.ok(production.indexOf('REQUEST_FILENAME') < production.indexOf('^www[.]'));
  assert.match(production, /Header always set Strict-Transport-Security "max-age=86400" env=fl_https/);
  assert.match(production, /AddDefaultCharset UTF-8/);
  assert.match(production, /X-Content-Type-Options "nosniff"/);
  assert.match(production, /Cache-Control "no-cache"/);
  assert.match(production, /fl-site-deploy\[\.\]json\$ - \[F,L\]/);
  assert.match(production, /well-known\/acme-challenge/);
  const preview = plan(f.root, { preview: true }).files.find(f => f.name === '.htaccess').body.toString();
  assert.doesNotMatch(preview, /Strict-Transport-Security/);
  assert.match(preview, /X-Robots-Tag "noindex, nofollow"/);
});
