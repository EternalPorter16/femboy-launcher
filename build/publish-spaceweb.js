'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable, Writable } = require('node:stream');
const ROOT = '/public_html';
const LOCK = '/.fl-site-deploy-lock';
const HOST = 'vh403.sweb.ru';
const PREVIEW = 'http://bartawesom.temp.swtest.ru';
const ROUTES = ['', 'en/', 'releases/', 'en/releases/', 'guides/setup-or-portable/', 'en/guides/setup-or-portable/', 'guides/install-modrinth-modpack/', 'en/guides/install-modrinth-modpack/'];
const digest = b => crypto.createHash('sha256').update(b).digest('hex');
const allowed = new Set(['.html','.css','.js','.json','.png','.ico','.webp','.woff2','.txt','.vtt','.mp4','.jpg','.xml','.webmanifest','.svg','.woff','.jpeg','.avif','.gif']);

function plan(project, { preview = true, out = 'website/dist' } = {}) {
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
      if (stat.isSymbolicLink() || /[\x00-\x1f\\]/.test(name)) throw new Error('Unsafe website entry');
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
  for (const route of ROUTES) {
    const file = files.find(f => f.name === route + 'index.html');
    if (!file || !file.body.includes('Femboy Launcher')) throw new Error('Required website page is missing');
    const html = file.body.toString('utf8');
    if (route.startsWith('en/') && !/<html\s[^>]*lang="en"/.test(html)) throw new Error('English page has wrong language');
    if (!preview && /<meta\b[^>]*\bname=["']robots["'][^>]*\bcontent=["'][^"']*noindex/i.test(html)) throw new Error('Production page contains noindex');
  }
  const home = files.find(f => f.name === 'index.html').body.toString('utf8');
  if (!home.includes(`FemboyLauncher-Setup-${version}.exe`) || !home.includes(`FemboyLauncher-Portable-${version}.exe`) || !home.includes('https://downloads.femboylauncher.ru/')) throw new Error('Website download version does not match published metadata');
  const headers = preview ? '    Header always set X-Robots-Tag "noindex, nofollow"\n' : '    SetEnvIfNoCase Host "^bartawesom[.]temp[.]swtest[.]ru(:[0-9]+)?$" fl_preview=1\n    Header always set X-Robots-Tag "noindex, nofollow" env=fl_preview\n';
  const redirects = preview ? '' : 'RewriteEngine On\nRewriteCond %{ENV:REDIRECT_STATUS} =404\nRewriteRule ^ - [L]\nRewriteCond %{REQUEST_URI} !^/\\.well-known/acme-challenge/ [NC]\nRewriteCond %{HTTP_HOST} ^www[.]femboylauncher[.]ru(?::[0-9]+)?$ [NC]\nRewriteRule ^ https://femboylauncher.ru%{REQUEST_URI} [R=301,L,NE]\nRewriteCond %{REQUEST_URI} !^/\\.well-known/acme-challenge/ [NC]\nRewriteCond %{HTTP_HOST} ^femboylauncher[.]ru(?::[0-9]+)?$ [NC]\nRewriteCond %{HTTP:HTTPS} !=on [NC]\nRewriteCond %{HTTPS} !=on [NC]\nRewriteCond %{HTTP:X-Forwarded-Proto} !^https$ [NC]\nRewriteRule ^ https://femboylauncher.ru%{REQUEST_URI} [R=301,L,NE]\n';
  const htaccess = Buffer.from(redirects + 'DirectoryIndex index.html\nErrorDocument 404 /404.html\n<IfModule mod_headers.c>\n' + headers + '</IfModule>\n<IfModule mod_mime.c>\n    AddType text/vtt .vtt\n    AddType application/manifest+json .webmanifest\n</IfModule>\n');
  files.push({ name: '.htaccess', body: htaccess, sha256: digest(htaccess) });
  const id = new Date().toISOString().replace(/[-:.TZ]/g, '') + '-' + crypto.randomBytes(4).toString('hex');
  const marker = Buffer.from(JSON.stringify({ id, version, preview, files: files.length, created: new Date().toISOString() }) + '\n');
  files.push({ name: '.fl-site-deploy.json', body: marker, sha256: digest(marker) });
  return { id, version, preview, files };
}

function connection(credentials) {
  const { Client } = require('basic-ftp');
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
    async exists(dir) { return (await (await ready()).list('/')).some(f => '/' + f.name === dir); },
    close() { c?.close(); },
  };
  return remote;
}

async function rollback(remote, p, backup, stage) {
  if (!(await remote.exists(backup))) throw new Error('Previous website backup not found');
  if (await remote.exists(ROOT)) {
    const marker = JSON.parse((await remote.get(ROOT + '/.fl-site-deploy.json', 8192)).toString());
    if (marker.id !== p.id || await remote.exists(stage)) throw new Error('Website state changed; manual recovery required');
    await remote.move(ROOT, stage);
  }
  await remote.move(backup, ROOT);
}

async function publish(p, remote, { log = () => {}, verify = async () => {} } = {}) {
  const stage = '/.fl-site-stage-' + p.id;
  const backup = '/.fl-site-backup-' + p.id;
  let locked = false, oldMoved = false, moveAttempted = false, recoveryFailed = false;
  const oldHash = await remote.preflight();
  try {
    await remote.mkdir(LOCK); locked = true;
    await remote.mkdir(stage);
    const dirs = new Set(p.files.map(f => path.posix.dirname(f.name)).filter(d => d !== '.'));
    for (const dir of [...dirs].sort()) await remote.ensureDir(stage + '/' + dir);
    log(`SpaceWeb: uploading ${p.files.length} files to staging ${stage}`);
    for (let i = 0; i < p.files.length; i++) {
      const f = p.files[i];
      await remote.put(stage + '/' + f.name, f.body);
      if ((i + 1) % 25 === 0) log(`SpaceWeb: uploaded ${i + 1}/${p.files.length}`);
    }
    log('SpaceWeb: verifying every staged file by SHA256');
    for (const f of p.files) if (digest(await remote.get(stage + '/' + f.name, f.body.length + 1)) !== f.sha256) throw new Error('Staged website checksum mismatch');
    if (digest(await remote.get(ROOT + '/index.html', 2 * 1024 * 1024)) !== oldHash) throw new Error('Website changed during staging; deployment stopped');
    moveAttempted = true;
    await remote.move(ROOT, backup); oldMoved = true;
    await remote.move(stage, ROOT);
    await verify(p);
    log(`SpaceWeb ${p.version}: published and verified; previous website preserved as ${backup}`);
    return { backup, id: p.id, preview: p.preview };
  } catch (error) {
    if (moveAttempted) {
      try {
        if (await remote.exists(backup)) { await rollback(remote, p, backup, stage); log('SpaceWeb: previous website restored'); }
        else if (oldMoved) throw new Error('Previous directory state could not be confirmed');
      } catch { recoveryFailed = true; throw new Error('SpaceWeb recovery requires attention; deployment lock and backup preserved'); }
    }
    throw error;
  } finally {
    if (locked && !recoveryFailed) {
      try { await remote.rmdir(LOCK); }
      catch { log('WARNING: website deployment lock remains; check before retrying'); }
    }
  }
}

async function verifyPublic(p) {
  const origin = p.preview ? PREVIEW : 'https://femboylauncher.ru';
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
    if (args.length !== 1 || !['--check','--preview','--production'].includes(args[0])) throw new Error('Use --check, --preview or --production');
    const user = process.env.SW_FTP_USER, password = process.env.SW_FTP_PASSWORD;
    if (!user || !password) throw new Error('Run the local SpaceWeb access setup first');
    const project = path.join(__dirname, '..');
    if (args[0] === '--production') {
      const config = JSON.parse(fs.readFileSync(path.join(project, 'build/website-hosting.json'), 'utf8'));
      if (config.activeProvider !== 'spaceweb') throw new Error('Production SpaceWeb publication is not enabled; primary site is still Firebase');
    }
    const p = args[0] === '--check' ? null : plan(project, { preview: args[0] === '--preview' });
    const remote = connection({ user, password });
    try {
      if (!p) { await remote.preflight(); return console.log('SpaceWeb protected access ready'); }
      await publish(p, remote, { log: console.log, verify: verifyPublic });
    } finally { remote.close(); }
  })().catch(e => {
    // Server replies may contain account details: only print application errors.
    const safe = /^(Use |Run |Production SpaceWeb|Invalid published|Unsafe website|Non-public|Website |Required website|English page|Production page|Staged website|Public website|SpaceWeb recovery|Expected public_html|Refusing to replace)/.test(e.message);
    console.error(safe ? e.message : `SpaceWeb deployment stopped (${e.code || 'connection or filesystem error'}); credentials were not logged`);
    process.exitCode = 1;
  });
}
module.exports = { plan, publish, digest, rollback, verifyPublic };


