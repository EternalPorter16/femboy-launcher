'use strict';
const crypto = require('node:crypto');
const ROOT = '/public_html', LOCK = '/.fl-site-deploy-lock';
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const digest = o => hash(Buffer.from(JSON.stringify(o)));
const sealed = o => Buffer.from(JSON.stringify({ ...o, checksum: digest(o) }));
function decode(body) {
  try {
    const parsed = JSON.parse(body.toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error('invalid record');
    const { checksum, ...o } = parsed;
    if (checksum !== digest(o)) throw Error('invalid checksum');
    return o;
  } catch { throw new Error('SpaceWeb recovery record is damaged; files preserved'); }
}
function validate(o) {
  if (o.schema !== 1 || !/^\d{17}-[a-f0-9]{8}$/.test(o.id) || !/^[a-f0-9]{32}$/.test(o.token) || !/^[a-f0-9]{64}$/.test(o.oldHash) ||
      !(o.oldMarkerHash === null || /^[a-f0-9]{64}$/.test(o.oldMarkerHash)) || typeof o.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(o.version) || typeof o.preview !== 'boolean' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(o.created) ||
      !Number.isFinite(Date.parse(o.created)) || o.stage !== '/.fl-site-stage-' + o.id || o.backup !== '/.fl-site-backup-' + o.id || !Array.isArray(o.files) || !o.files.length || o.files.length > 1002) throw new Error('SpaceWeb recovery record is invalid; files preserved');
  const names = new Set();
  for (const f of o.files) {
    if (typeof f.name !== 'string' || f.name.length > 1024 || /[\\:\x00-\x1f]/.test(f.name) || f.name.startsWith('/') || f.name.split('/').some(p => !p || p === '.' || p === '..') ||
        !/^[a-f0-9]{64}$/.test(f.sha256) || !Number.isSafeInteger(f.size) || f.size < 0 || f.size > 34 * 1024 * 1024 || names.has(f.name)) throw new Error('SpaceWeb recovery file list is invalid; files preserved');
    names.add(f.name);
  }
  if (!names.has('index.html') || !names.has('.fl-site-deploy.json')) throw new Error('SpaceWeb recovery file list is incomplete; files preserved');
  return o;
}
function owner(p, oldHash, oldMarkerHash = null) {
  const o = validate({ schema: 1, id: p.id, token: crypto.randomBytes(16).toString('hex'), created: new Date().toISOString(), version: p.version, preview: p.preview,
    stage: '/.fl-site-stage-' + p.id, backup: '/.fl-site-backup-' + p.id, oldHash, oldMarkerHash, files: p.files.map(f => ({ name: f.name, size: f.body.length, sha256: f.sha256 })) });
  if (sealed(o).length > 2 * 1024 * 1024) throw new Error('SpaceWeb recovery record exceeds safety limit');
  return o;
}
const readOwner = async r => validate(decode(await r.get(LOCK + '/owner.json', 2 * 1024 * 1024)));
async function guard(r, o, claim) {
  if (digest(await readOwner(r)) !== digest(o)) throw new Error('SpaceWeb lock ownership changed; no changes allowed');
  const claimed = await r.exists(LOCK + '/recovering.json');
  if (!claim && claimed) throw new Error('SpaceWeb recovery is in progress; publication stopped');
  if (claim && (!claimed || decode(await r.get(LOCK + '/recovering.json', 8192)).token !== claim)) throw new Error('SpaceWeb recovery ownership changed; files preserved');
}
async function retry(r, fn) {
  let last;
  for (let i = 0; i < 3; i++) { try { return await fn(); } catch (e) { last = e; if (/ownership changed|recovery is in progress|state changed|unrelated/.test(e.message)) throw e; await r.reconnect?.(); } }
  throw last;
}
async function oldAt(r, dir, o) {
  if (hash(await r.get(dir + '/index.html', 2 * 1024 * 1024)) !== o.oldHash) return false;
  const marker = dir + '/.fl-site-deploy.json', present = await r.exists(marker);
  return o.oldMarkerHash === null ? !present : present && hash(await r.get(marker, 8192)) === o.oldMarkerHash;
}
async function newAt(r, dir, o) {
  const m = JSON.parse((await r.get(dir + '/.fl-site-deploy.json', 8192)).toString());
  return m.id === o.id && hash(await r.get(dir + '/index.html', 2 * 1024 * 1024)) === o.files.find(f => f.name === 'index.html').sha256;
}
async function move(r, from, to, o, matches, claim) {
  return retry(r, async () => {
    await guard(r, o, claim);
    const source = await r.exists(from), dest = await r.exists(to);
    if (!source && dest && await matches(r, to, o)) return; // rename succeeded but its reply was lost
    if (!source || dest || !(await matches(r, from, o))) throw new Error('SpaceWeb directory state changed; files preserved');
    await r.move(from, to);
    if (!(await matches(r, to, o))) throw new Error('SpaceWeb renamed directory verification failed');
  });
}
async function rollback(r, o, claim) {
  await guard(r, o, claim);
  if (await r.exists(ROOT)) {
    if (await oldAt(r, ROOT, o)) return;
    if (!(await newAt(r, ROOT, o)) || await r.exists(o.stage)) throw new Error('SpaceWeb directory state changed; files preserved');
    if (!(await r.exists(o.backup)) || !(await oldAt(r, o.backup, o))) throw new Error('SpaceWeb previous website backup cannot be verified');
    await move(r, ROOT, o.stage, o, newAt, claim);
  }
  await move(r, o.backup, ROOT, o, oldAt, claim);
}
async function release(r, o, claim) {
  await guard(r, o, claim);
  const archive = '/.fl-site-lock-archive-' + o.id + '-' + crypto.randomBytes(4).toString('hex');
  // Detach ownership atomically, before deleting records. Never replay partial cleanup.
  await r.move(LOCK, archive);
  try {
    for (const name of ['owner.json', 'complete.json', 'recovering.json']) if (await r.exists(archive + '/' + name)) await r.remove(archive + '/' + name);
    await r.rmdir(archive);
  } catch {} // Detached diagnostics are harmless; never recursively remove remote data.
}
async function status(r) {
  if (!(await r.exists(LOCK))) return { locked: false, rootPresent: await r.exists(ROOT) };
  try {
    const o = await readOwner(r);
    return { locked: true, id: o.id, created: o.created, version: o.version, rootPresent: await r.exists(ROOT), stagePresent: await r.exists(o.stage), backupPresent: await r.exists(o.backup),
      recoveryInProgress: await r.exists(LOCK + '/recovering.json'), completionRecordPresent: await r.exists(LOCK + '/complete.json') };
  } catch { return { locked: true, unrecognized: true, rootPresent: await r.exists(ROOT), reason: 'SpaceWeb lock has no readable owner record; files preserved' }; }
}
async function recover(r, { expectedId, ownerStopped = false } = {}) {
  if (ownerStopped !== true) throw new Error('SpaceWeb recovery requires confirmation that all previous publish/recovery processes have stopped');
  if (!(await r.exists(LOCK))) return { recovered: false };
  if (expectedId === 'unowned') {
    // Explicit legacy path: only an EMPTY old lock and an identifiable working site.
    if ((await r.list(LOCK)).length) throw new Error('SpaceWeb unrecognized lock is not empty; files preserved');
    await r.preflight(); await r.rmdir(LOCK); return { recovered: true, legacyEmptyLock: true };
  }
  const o = await readOwner(r);
  if (o.id !== expectedId) throw new Error('SpaceWeb lock ownership changed; expected deployment id does not match');
  const claim = crypto.randomBytes(16).toString('hex');
  await r.put(LOCK + '/recovering.json', sealed({ token: claim, id: o.id }));
  await guard(r, o, claim);
  let complete = false;
  if (await r.exists(LOCK + '/complete.json')) {
    try { const record = decode(await r.get(LOCK + '/complete.json', 8192)); complete = record.id === o.id && record.owner === digest(o); } catch {}
  }
  if (complete) {
    if (!(await r.exists(ROOT)) || !(await newAt(r, ROOT, o))) throw new Error('SpaceWeb completed website identity changed; files preserved');
    for (const f of o.files) if (hash(await r.get(ROOT + '/' + f.name, f.size + 1)) !== f.sha256) throw new Error('SpaceWeb completed website content changed; files preserved');
  } else await rollback(r, o, claim);
  await release(r, o, claim);
  return { recovered: true, id: o.id, keptCompletedWebsite: complete, backup: o.backup, stage: o.stage };
}
module.exports = { ROOT, LOCK, owner, sealed, digest, readOwner, guard, retry, oldAt, newAt, move, rollback, release, status, recover };
