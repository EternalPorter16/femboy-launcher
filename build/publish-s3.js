// Release-only tool. Credentials are injected by publish-s3.ps1, never packaged.
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const crypto = require('node:crypto');
const { S3Client, ListObjectsV2Command, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const yaml = require('js-yaml');
const semver = require('semver');
const BUCKET = 'downloads.femboylauncher.ru';
const PUBLIC = `https://${BUCKET}/`;
const digest = b => crypto.createHash('sha256').update(b).digest('hex');

function plan(root, out) {
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  const raw = fs.readFileSync(path.join(root, out, 'latest.yml'));
  const manifest = yaml.load(raw.toString());
  if (!semver.valid(version) || version !== manifest.version) throw new Error('Version mismatch');
  const files = ['Setup', 'Portable'].map(kind => {
    const name = `FemboyLauncher-${kind}-${version}.exe`;
    const file = path.join(root, out, name);
    if (!fs.lstatSync(file).isFile()) throw new Error('Not a regular file');
    const body = fs.readFileSync(file);
    if (!body.length) throw new Error('Empty installer');
    return { name, body, sha256: digest(body) };
  });
  const setup = files[0];
  const entry = manifest.files?.find(f => f.url === setup.name);
  const sum = crypto.createHash('sha512').update(setup.body).digest('base64');
  if (manifest.files?.length !== 1 || !entry || entry.size !== setup.body.length || entry.sha512 !== sum || manifest.path !== setup.name || manifest.sha512 !== sum) throw new Error('Setup does not match latest.yml');
  return { version, files, raw };
}

// No response bodies, signed headers or credential values are logged on failure.
function transfer(options, body, collect = false) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let size = 0; const hash = crypto.createHash('sha256'); const chunks = [];
      res.on('data', b => {
        size += b.length; hash.update(b);
        if (collect) {
          if (size > 1024 * 1024) return req.destroy(new Error('Metadata too large'));
          chunks.push(b);
        }
      });
      res.on('end', () => resolve({ status: res.statusCode, size, sha256: hash.digest('hex'), headers: res.headers, body: collect ? Buffer.concat(chunks) : null }));
      res.on('error', () => reject(new Error('Response interrupted')));
    });
    const deadline = setTimeout(() => req.destroy(new Error('Request deadline exceeded')), 180000);
    req.on('close', () => clearTimeout(deadline));
    req.setTimeout(30000, () => req.destroy(new Error('Network timeout')));
    req.on('error', () => reject(new Error('S3/HTTPS request failed')));
    req.end(body);
  });
}
function client(credentials) {
  const s3 = new S3Client({
    endpoint: 'https://storage.yandexcloud.net', region: 'ru-central1',
    forcePathStyle: true, credentials, maxAttempts: 1,
    requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
    requestHandler: { connectionTimeout: 15000, requestTimeout: 180000 },
  });
  async function send(command, action) {
    try { return await s3.send(command); }
    catch (e) {
      const code = /^[A-Za-z0-9_]{1,80}$/.test(e.name || '') ? e.name : 'Unknown';
      throw new Error(`${action}: HTTP ${e.$metadata?.httpStatusCode || 'network'}; code=${code}`);
    }
  }
  return {
    async preflight() {
      await send(new ListObjectsV2Command({ Bucket: BUCKET, MaxKeys: 0 }), 'S3 access check');
    },
    get(name, collect = false) {
      return transfer(new URL(PUBLIC + encodeURIComponent(name) + '?release-check=' + Date.now()), null, collect);
    },
    async list() {
      const names = []; let token;
      do {
        const page = await send(new ListObjectsV2Command({ Bucket: BUCKET, ContinuationToken: token }), 'S3 list');
        for (const object of page.Contents || []) names.push(object.Key);
        if (page.IsTruncated && (!page.NextContinuationToken || page.NextContinuationToken === token)) throw new Error('Invalid S3 pagination');
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
      return names;
    },
    async remove(name) {
      await send(new DeleteObjectCommand({ Bucket: BUCKET, Key: name }), 'S3 remove');
    },
    async put(name, body, manifest = false) {
      await send(new PutObjectCommand({
        Bucket: BUCKET, Key: name, Body: body, ContentLength: body.length,
        ContentType: manifest ? 'application/yaml; charset=utf-8' : 'application/octet-stream',
        CacheControl: manifest ? 'no-cache, max-age=0, must-revalidate' : 'public, max-age=31536000, immutable',
      }), 'S3 upload');
    },
  };
}

function verify(r, f) {
  if (r.status !== 200 || r.size !== f.body.length || r.sha256 !== f.sha256) throw new Error(`Public verification failed: ${f.name}`);
}
// Only exact root installer names are eligible; unknown files and newer versions stay.
function retention(names, current, publishedPrevious) {
  if (!semver.valid(current)) throw new Error('Invalid current version');
  const files = names.flatMap(name => {
    const m = /^FemboyLauncher-(Setup|Portable)-(.+)\.exe(?:\.blockmap)?$/.exec(name);
    if (!m || !semver.valid(m[2])) return [];
    return [{ name, version: m[2] }];
  });
  const complete = v => ['Setup', 'Portable'].every(kind => names.includes(`FemboyLauncher-${kind}-${v}.exe`));
  if (!complete(current)) throw new Error('Current release is incomplete; cleanup refused');
  let previous;
  if (publishedPrevious && publishedPrevious !== current) {
    if (!semver.valid(publishedPrevious) || !semver.lt(publishedPrevious, current) || !complete(publishedPrevious)) throw new Error('Previous published release is incomplete; cleanup refused');
    previous = publishedPrevious;
  } else {
    previous = [...new Set(files.map(f => f.version))].filter(v => semver.lt(v, current) && complete(v)).sort(semver.rcompare)[0];
  }
  // Without a complete previous release there is no safe retention boundary.
  return { previous, remove: previous ? files.filter(f => semver.lt(f.version, previous)).map(f => f.name) : [] };
}
async function cleanup(p, remote, previous, log) {
  const plan = retention(await remote.list(), p.version, previous);
  // Avoid cleanup if another release changed the channel after our upload.
  verify(await remote.get('latest.yml', true), { name: 'latest.yml', body: p.raw, sha256: digest(p.raw) });
  for (const name of plan.remove) {
    await remote.remove(name);
    log(`S3 removed old installer: ${name}`);
  }
  log(`S3 retention: kept ${p.version}${plan.previous ? ' and ' + plan.previous : ''}; removed ${plan.remove.length} old files`);
}
async function publish(p, remote, log = () => {}) {
  const old = await remote.get('latest.yml', true);
  if (old.status !== 404 && old.status !== 200) throw new Error(`Cannot check current channel: HTTP ${old.status}`);
  let previous;
  if (old.status === 200) {
    const v = yaml.load(old.body.toString())?.version;
    if (!semver.valid(v) || semver.gt(v, p.version)) throw new Error('Refusing channel downgrade or invalid current channel');
    previous = v;
  }
  for (const f of p.files) {
    const existing = await remote.get(f.name);
    if (existing.status === 404) await remote.put(f.name, f.body);
    else { verify(existing, f); log(`${f.name}: already uploaded, verified`); }
    if (existing.status === 404) verify(await remote.get(f.name), f);
    log(`${f.name}: public SHA256 verified`);
  }
  // Only advertise a version after BOTH public installers have been verified.
  await remote.put('latest.yml', p.raw, true);
  verify(await remote.get('latest.yml', true), { name: 'latest.yml', body: p.raw, sha256: digest(p.raw) });
  log(`S3 release ${p.version}: published and verified`);
  try { await cleanup(p, remote, previous, log); }
  catch (e) { log(`WARNING: S3 release is live, cleanup stopped: ${e.message}`); }
}
if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    if (args.some(a => a.startsWith('--') && a !== '--check')) throw new Error('Unknown option');
    const accessKeyId = process.env.FL_S3_ACCESS_KEY_ID, secretAccessKey = process.env.FL_S3_SECRET_ACCESS_KEY;
    if (!accessKeyId || !secretAccessKey) throw new Error('Run build/setup-s3-key.ps1 first');
    const remote = client({ accessKeyId, secretAccessKey });
    await remote.preflight();
    if (args.includes('--check')) return console.log('S3 access ready');
    await publish(plan(path.join(__dirname, '..'), args.find(a => !a.startsWith('--')) || 'dist-release'), remote, console.log);
  })().catch(e => { console.error(`S3 publish stopped: ${e.message}`); process.exitCode = 1; });
}
module.exports = { plan, publish, retention };

