'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable, Writable } = require('node:stream');
const recovery = require('./spaceweb-recovery');
const { ROOT, LOCK } = recovery;
// Адрес FTP-сервера, технический адрес сайта и логин — только в локальном build/website-hosting.local.json (вне git).
// Безопасный пример без рабочих значений: build/website-hosting.local.example.json
const LOCAL_CONFIG = path.join(__dirname, 'website-hosting.local.json');
const LOCAL_MISSING = 'Local hosting configuration is missing: copy build/website-hosting.local.example.json to build/website-hosting.local.json and fill in the server details (the file stays out of git)';
function hostingConfig(file = LOCAL_CONFIG) {
  let c;
  try {
    c = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(e.code === 'ENOENT' ? LOCAL_MISSING : 'Local hosting configuration build/website-hosting.local.json is not valid JSON');
  }
  const host = c && typeof c.host === 'string' ? c.host.trim() : '';
  const preview = c && typeof c.previewUrl === 'string' ? c.previewUrl.trim().replace(/\/+$/, '') : '';
  const placeholder = (s) => /example|\.invalid$|^<|>$/i.test(s);
  if (!/^[A-Za-z0-9.-]{1,253}$/.test(host) || placeholder(host)) throw new Error('Local hosting configuration build/website-hosting.local.json: fill in a real "host"');
  if (!/^https?:\/\/[A-Za-z0-9.-]{1,253}$/.test(preview) || placeholder(preview)) throw new Error('Local hosting configuration build/website-hosting.local.json: fill in a real "previewUrl"');
  return { host, preview };
}
const ROUTES = ['', 'en/', 'releases/', 'en/releases/', 'guides/setup-or-portable/', 'en/guides/setup-or-portable/', 'guides/install-modrinth-modpack/', 'en/guides/install-modrinth-modpack/'];
const digest = b => crypto.createHash('sha256').update(b).digest('hex');
const allowed = new Set(['.html','.css','.js','.json','.png','.ico','.webp','.woff2','.txt','.vtt','.mp4','.jpg','.xml','.webmanifest','.svg','.woff','.jpeg','.avif','.gif']);

function plan(project, { preview = true, out = 'website/dist', previewHost } = {}) {
  const folder = path.resolve(project, out);
  const version = JSON.parse(fs.readFileSync(path.join(project, 'website/src/config/downloads.json'), 'utf8')).release.version;
  if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)) throw new Error('Invalid published website version');
  const files = [];
  let bytes = 0;
  function walk(dir, prefix = '') {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const name = prefix + entry.name;
      const full = path.join(dir, entry.name);
      const stat = fs.lstatSync(full);
      if (stat.isSymbolicLink() || entry.name.startsWith('.') || /[\x00-\x1f\\]/.test(name)) throw new Error('Unsafe website entry');
      if (stat.isDirectory()) { walk(full, name + '/'); continue; }
      if (!stat.isFile() || !allowed.has(path.extname(name).toLowerCase()) || /(?:^|\/)(?:package(?:-lock)?\.json|firebase\.json|credentials[^/]*|[^/]*-key\.xml)$/i.test(name) || entry.name.startsWith('.')) throw new Error('Non-public file in website output');
      bytes += stat.size;
      if (stat.size > 32 * 1024 * 1024 || bytes > 64 * 1024 * 1024 || files.length >= 1000) throw new Error('Website output exceeds deployment safety limits');
      let body = fs.readFileSync(full);
      if (preview && name.endsWith('.html')) {
        const html = body.toString('utf8');
        if (!/<head(?:\s[^>]*)?>/i.test(html)) throw new Error('Invalid website HTML');
        body = Buffer.from(html.replace(/<head(?:\s[^>]*)?>/i, '$&<meta name="robots" content="noindex, nofollow" />'));
      }
      if (preview && name === 'robots.txt') body = Buffer.from('User-agent: *\nDisallow: /\n');
      files.push({ name, body, sha256: digest(body) });
    }
  }
  walk(folder);
  for (const required of ['404.html', 'robots.txt', 'sitemap.xml']) if (!files.some(f => f.name === required && f.body.length)) throw new Error('Required website file is missing: ' + required);
  for (const route of ROUTES) {
    const file = files.find(f => f.name === route + 'index.html');
    if (!file || !file.body.includes('Femboy Launcher')) throw new Error('Required website page is missing');
    const html = file.body.toString('utf8');
    if (route.startsWith('en/') && !/<html\s[^>]*lang="en"/.test(html)) throw new Error('English page has wrong language');
    if (!preview && /<meta\b[^>]*\bname=["']robots["'][^>]*\bcontent=["'][^"']*noindex/i.test(html)) throw new Error('Production page contains noindex');
  }
  const home = files.find(f => f.name === 'index.html').body.toString('utf8');
  if (!home.includes(`FemboyLauncher-Setup-${version}.exe`) || !home.includes(`FemboyLauncher-Portable-${version}.exe`) || !home.includes('https://downloads.femboylauncher.ru/')) throw new Error('Website download version does not match published metadata');
  // Технический адрес хостинга в боевой публикации получает noindex; сам адрес — из локальной конфигурации (previewHost)
  if (!preview && !/^[A-Za-z0-9-]+(?:[.][A-Za-z0-9-]+)+$/.test(previewHost || '')) throw new Error('Local hosting configuration: the technical preview host is required for production rules');
  const previewHostRe = preview ? '' : previewHost.split('.').join('[.]');
  const headers = preview ? '    Header always set X-Robots-Tag "noindex, nofollow"\n' : '    SetEnvIfNoCase Host "^' + previewHostRe + '(:[0-9]+)?$" fl_preview=1\n    Header always set X-Robots-Tag "noindex, nofollow" env=fl_preview\n';
  const redirects = preview ? 'RewriteEngine On\nRewriteRule ^\\.fl-site-deploy[.]json$ - [F,L]\n' : [
    'RewriteEngine On',
    'RewriteRule ^\\.fl-site-deploy[.]json$ - [F,L]',
    'RewriteCond %{HTTPS} =on [NC,OR]',
    'RewriteCond %{HTTP:HTTPS} =on [NC,OR]',
    'RewriteCond %{HTTP:X-Forwarded-Proto} ^https$ [NC]',
    'RewriteRule ^ - [E=fl_https:1]',
    'RewriteCond %{ENV:REDIRECT_STATUS} ^(?:403|404)$',
    'RewriteRule ^ - [L]',
    'RewriteCond %{HTTP_HOST} ^(?:www[.])?femboylauncher[.]ru(?::[0-9]+)?$ [NC]',
    'RewriteCond %{REQUEST_URI} !^/\\.well-known/acme-challenge/ [NC]',
    'RewriteCond %{REQUEST_FILENAME} -d',
    'RewriteCond %{REQUEST_URI} !/$',
    'RewriteRule ^ https://femboylauncher.ru%{REQUEST_URI}/ [R=301,L,NE]',
    'RewriteCond %{REQUEST_URI} !^/\\.well-known/acme-challenge/ [NC]',
    'RewriteCond %{HTTP_HOST} ^www[.]femboylauncher[.]ru(?::[0-9]+)?$ [NC]',
    'RewriteRule ^ https://femboylauncher.ru%{REQUEST_URI} [R=301,L,NE]',
    'RewriteCond %{REQUEST_URI} !^/\\.well-known/acme-challenge/ [NC]',
    'RewriteCond %{HTTP_HOST} ^femboylauncher[.]ru(?::[0-9]+)?$ [NC]',
    'RewriteCond %{HTTP:HTTPS} !=on [NC]',
    'RewriteCond %{HTTPS} !=on [NC]',
    'RewriteCond %{HTTP:X-Forwarded-Proto} !^https$ [NC]',
    'RewriteRule ^ https://femboylauncher.ru%{REQUEST_URI} [R=301,L,NE]', ''
  ].join('\n');
  const htaccess = Buffer.from(redirects + 'DirectoryIndex index.html\nAddDefaultCharset UTF-8\nErrorDocument 403 /404.html\nErrorDocument 404 /404.html\n<IfModule mod_headers.c>\n' + headers +
    '    Header always set X-Content-Type-Options "nosniff"\n' +
    (preview ? '' : '    Header always set Strict-Transport-Security "max-age=86400" env=fl_https\n') +
    '    <FilesMatch "\\.html$">\n        Header always set Cache-Control "no-cache"\n    </FilesMatch>\n</IfModule>\n<IfModule mod_mime.c>\n    AddType text/vtt .vtt\n    AddType application/manifest+json .webmanifest\n</IfModule>\n');
  files.push({ name: '.htaccess', body: htaccess, sha256: digest(htaccess) });
  const id = new Date().toISOString().replace(/[-:.TZ]/g, '') + '-' + crypto.randomBytes(4).toString('hex');
  const marker = Buffer.from(JSON.stringify({ id, version, preview, files: files.length, created: new Date().toISOString() }) + '\n');
  files.push({ name: '.fl-site-deploy.json', body: marker, sha256: digest(marker) });
  return { id, version, preview, files };
}

function connection(credentials, config = hostingConfig()) {
  const { Client } = require('basic-ftp');
  const HOST = config.host;
  let c;
  async function ready() {
    if (!c || c.closed) {
      c = new Client(30000);
      c.ftp.verbose = false;
      await c.access({ host: HOST, port: 21, user: credentials.user, password: credentials.password, secure: true, secureOptions: { servername: HOST, minVersion: 'TLSv1.2' } });
    }
    return c;
  }
  const remote = {
    async preflight() {
      const client = await ready();
      const root = (await client.list('/')).find(f => f.name === 'public_html');
      if (!root?.isDirectory || root.isSymbolicLink) throw new Error('Expected public_html directory not found');
      const index = await remote.get(ROOT + '/index.html', 2 * 1024 * 1024);
      if (!index.includes('Femboy Launcher')) throw new Error('Refusing to replace an unrelated website');
      return digest(index);
    },
    async mkdir(dir) { await (await ready()).send('MKD ' + dir); },
    async rmdir(dir) { await (await ready()).removeEmptyDir(dir); },
    async ensureDir(dir) { await (await ready()).ensureDir(dir); },
    async put(file, body) { await (await ready()).uploadFrom(Readable.from(body), file); },
    async get(file, limit = 34 * 1024 * 1024) {
      const chunks = []; let size = 0;
      const sink = new Writable({ write(chunk, enc, done) { size += chunk.length; if (size > limit) return done(new Error('Remote file exceeds size limit')); chunks.push(Buffer.from(chunk)); done(); } });
      await (await ready()).downloadTo(sink, file);
      return Buffer.concat(chunks);
    },
    async move(from, to) { await (await ready()).rename(from, to); },
    async exists(file) {
      const entry = (await (await ready()).list(path.posix.dirname(file))).find(f => f.name === path.posix.basename(file));
      if (entry?.isSymbolicLink) throw new Error('SpaceWeb unsafe remote link; files preserved');
      return !!entry;
    },
    async list(dir) { return (await (await ready()).list(dir)).map(f => ({ name: f.name })); },
    async remove(file) { await (await ready()).remove(file); },
    reconnect() { c?.close(); c = null; },
    close() { c?.close(); },
  };
  return remote;
}

async function rollback(remote, p, backup, stage) {
  const o = await recovery.readOwner(remote);
  if (o.id !== p.id || o.backup !== backup || o.stage !== stage) throw new Error('SpaceWeb lock ownership changed; files preserved');
  return recovery.rollback(remote, o);
}

async function publish(p, remote, { log = () => {}, verify = async () => {} } = {}) {
  const stage = '/.fl-site-stage-' + p.id;
  const backup = '/.fl-site-backup-' + p.id;
  let locked = false, moveAttempted = false, recoveryFailed = false, phase = 'preflight';
  const oldHash = await remote.preflight();
  const marker = ROOT + '/.fl-site-deploy.json';
  const oldMarkerHash = await remote.exists(marker) ? digest(await remote.get(marker, 8192)) : null;
  const o = recovery.owner(p, oldHash, oldMarkerHash);
  try {
    if (await remote.exists(LOCK)) throw new Error('SpaceWeb deployment lock exists; use --status before recovery');
    if (await remote.exists(stage) || await remote.exists(backup)) throw new Error('SpaceWeb directory state changed; staging name is already in use');
    phase = 'lock';
    await remote.mkdir(LOCK); locked = true;
    await remote.put(LOCK + '/owner.json', recovery.sealed(o));
    await recovery.guard(remote, o);
    phase = 'staging';
    await remote.mkdir(stage);
    const dirs = new Set(p.files.map(f => path.posix.dirname(f.name)).filter(d => d !== '.'));
    for (const dir of [...dirs].sort()) await recovery.retry(remote, async () => { await recovery.guard(remote, o); await remote.ensureDir(stage + '/' + dir); });
    log(`SpaceWeb: uploading ${p.files.length} files to staging ${stage}`);
    for (let i = 0; i < p.files.length; i++) {
      const f = p.files[i];
      await recovery.retry(remote, async () => { await recovery.guard(remote, o); await remote.put(stage + '/' + f.name, f.body); });
      if ((i + 1) % 25 === 0) log(`SpaceWeb: uploaded ${i + 1}/${p.files.length}`);
    }
    phase = 'staged-check';
    log('SpaceWeb: verifying every staged file by SHA256');
    for (const f of p.files) if (digest(await recovery.retry(remote, () => remote.get(stage + '/' + f.name, f.body.length + 1))) !== f.sha256) throw new Error('Staged website checksum mismatch');
    if (digest(await remote.get(ROOT + '/index.html', 2 * 1024 * 1024)) !== oldHash) throw new Error('Website changed during staging; deployment stopped');
    phase = 'backup-switch'; moveAttempted = true;
    await recovery.move(remote, ROOT, backup, o, recovery.oldAt);
    phase = 'root-switch';
    await recovery.move(remote, stage, ROOT, o, recovery.newAt);
    phase = 'public-check';
    await verify(p);
    phase = 'completion';
    await recovery.guard(remote, o);
    await remote.put(LOCK + '/complete.json', recovery.sealed({ id: o.id, owner: recovery.digest(o) }));
    log(`SpaceWeb ${p.version}: published and verified; previous website preserved as ${backup}`);
    return { backup, id: p.id, preview: p.preview };
  } catch (error) {
    if (moveAttempted) {
      try {
        await recovery.retry(remote, () => recovery.rollback(remote, o)); log('SpaceWeb: previous website restored');
      } catch (rollbackError) {
        recoveryFailed = true;
        // Never include FTP replies or verification messages: they may contain credentials.
        const code = e => /^[1-5][0-9]{2}$/.test(String(e?.code)) ? 'FTP_' + e.code : typeof e?.code === 'string' && /^(?:E[A-Z0-9_]{1,30}|ERR_[A-Z0-9_]{1,28})$/.test(e.code) ? e.code : 'unclassified';
        const failure = new Error(`SpaceWeb recovery requires attention; deployment lock and backup preserved (phase=${phase}, operation=${code(error)}, rollback=${code(rollbackError)})`);
        failure.cause = rollbackError;
        failure.publishCause = error;
        failure.phase = phase;
        throw failure;
      }
    }
    throw error;
  } finally {
    if (locked && !recoveryFailed) {
      try { await recovery.release(remote, o); }
      catch { log('WARNING: website deployment lock remains; check before retrying'); }
    }
  }
}

async function verifyPublic(p, config) {
  const origin = p.preview ? (config || hostingConfig()).preview : 'https://femboylauncher.ru';
  for (const route of ROUTES) {
    const response = await fetch(origin + '/' + route + '?deployment=' + p.id, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
    const html = await response.text();
    const expected = p.files.find(f => f.name === route + 'index.html');
    if (response.status !== 200 || digest(Buffer.from(html)) !== expected.sha256 || (p.preview && !/noindex/.test(response.headers.get('x-robots-tag') || ''))) throw new Error('Public website verification failed');
  }
}

if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    const mode = args[0];
    const recovering = mode === '--recover';
    if (!(args.length === 1 && ['--check','--preview','--production','--status'].includes(mode)) && !(recovering && args.length === 3 && args[2] === '--owner-stopped')) throw new Error('Use --check, --preview, --production, --status or --recover ID --owner-stopped');
    // Сначала локальная конфигурация сервера: без неё ничего не читаем из сети и не публикуем
    const config = hostingConfig();
    const user = process.env.SW_FTP_USER, password = process.env.SW_FTP_PASSWORD;
    if (!user || !password) throw new Error('Run the local SpaceWeb access setup first');
    const project = path.join(__dirname, '..');
    if (args[0] === '--production') {
      const config = JSON.parse(fs.readFileSync(path.join(project, 'build/website-hosting.json'), 'utf8'));
      if (config.activeProvider !== 'spaceweb') throw new Error('Production SpaceWeb publication is not enabled; primary site is still Firebase');
    }
    const p = ['--preview','--production'].includes(mode) ? plan(project, { preview: mode === '--preview', previewHost: new URL(config.preview).hostname }) : null;
    const remote = connection({ user, password }, config);
    try {
      if (mode === '--status') return console.log(JSON.stringify(await recovery.status(remote), null, 2));
      if (recovering) return console.log(JSON.stringify(await recovery.recover(remote, { expectedId: args[1], ownerStopped: true }), null, 2));
      if (!p) { await remote.preflight(); return console.log('SpaceWeb protected access ready'); }
      await publish(p, remote, { log: console.log, verify: (x) => verifyPublic(x, config) });
    } finally { remote.close(); }
  })().catch(e => {
    // Server replies may contain account details: only print application errors.
    const safe = /^(Use |Run |Local hosting configuration|Production SpaceWeb|Invalid published|Unsafe website|Non-public|Website |Required website|English page|Production page|Staged website|Public website|SpaceWeb (?:recovery|lock|deployment|directory|previous|completed|unsafe|renamed)|Expected public_html|Refusing to replace)/.test(e.message);
    console.error(safe ? e.message : `SpaceWeb deployment stopped (${e.code || 'connection or filesystem error'}); credentials were not logged`);
    process.exitCode = 1;
  });
}
module.exports = { plan, publish, digest, rollback, verifyPublic, connection, hostingConfig, LOCAL_CONFIG, status: recovery.status, recover: recovery.recover };
