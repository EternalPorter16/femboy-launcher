const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { spawnSync } = require('child_process');
const { publish } = require('../build/publish-spaceweb');
const R = require('../build/spaceweb-recovery');
const { plan, remote, ID } = require('./spaceweb-remote-fixture');
async function locked(r) {
  const p = plan(), o = R.owner(p, await r.preflight());
  await r.mkdir(R.LOCK); await r.put(R.LOCK + '/owner.json', R.sealed(o)); return { p, o };
}
test('status is read-only and recovery cannot steal a live or different owner lock', async () => {
  const r = remote(); await locked(r); const before = r.snapshot();
  const s = await R.status(r); assert.equal(s.id, ID); assert.equal(r.snapshot(), before);
  await assert.rejects(R.recover(r, { expectedId: ID }), /confirmation/);
  await assert.rejects(R.recover(r, { expectedId: 'wrong', ownerStopped: true }), /ownership changed/);
  await assert.rejects(publish(plan(), r), /lock exists/); assert.equal(r.snapshot(), before);
});
test('corrupt or redirected owner records cannot authorize changes or expose arbitrary metadata', async () => {
  const huge = plan(), prefix = Array(10).fill('汉'.repeat(90)).join('/');
  for (let i = 0; i < 997; i++) huge.files.push({ name: prefix + '/' + i + '.txt', body: Buffer.from('x'), sha256: 'a'.repeat(64) });
  assert.throws(() => R.owner(huge, 'a'.repeat(64)), /exceeds safety limit/);
  for (const kind of ['null', 'path', 'version']) {
    const r = remote(), { o } = await locked(r);
    const bad = kind === 'null' ? Buffer.from('null') : R.sealed({ ...o, ...(kind === 'path' ? { stage: '/unrelated' } : { version: 'SYNTHETIC_PRIVATE_VALUE' }) });
    await r.put(R.LOCK + '/owner.json', bad); const before = r.snapshot();
    await assert.rejects(R.recover(r, { expectedId: ID, ownerStopped: true }), /recovery record/);
    const info = await R.status(r); assert.equal(info.unrecognized, true);
    assert.equal(JSON.stringify(info).includes('SYNTHETIC_PRIVATE_VALUE'), false); assert.equal(r.snapshot(), before);
  }
});
test('legacy empty lock requires explicit stopped-owner confirmation and a recognizable working site', async () => {
  const r = remote(); await r.mkdir(R.LOCK);
  assert.equal((await R.status(r)).unrecognized, true);
  await assert.rejects(R.recover(r, { expectedId: 'unowned' }), /confirmation/);
  await R.recover(r, { expectedId: 'unowned', ownerStopped: true }); assert.equal(await r.exists(R.LOCK), false);
  await r.mkdir(R.LOCK); await r.put(R.LOCK + '/owner.json', Buffer.from('{'));
  await assert.rejects(R.recover(r, { expectedId: 'unowned', ownerStopped: true }), /not empty/);
  assert.equal(await r.exists(R.LOCK + '/owner.json'), true);
});
test('recover restores a missing public_html from the recorded backup and preserves partial staging', async () => {
  const r = remote(), { o } = await locked(r);
  await r.mkdir(o.stage); await r.put(o.stage + '/partial.txt', Buffer.from('PARTIAL'));
  await r.move(R.ROOT, o.backup);
  await R.recover(r, { expectedId: ID, ownerStopped: true });
  assert.equal((await r.get(R.ROOT + '/index.html')).toString(), 'Femboy Launcher OLD');
  assert.equal((await r.get(o.stage + '/partial.txt')).toString(), 'PARTIAL');
  assert.equal((await R.recover(r, { expectedId: ID, ownerStopped: true })).recovered, false);
});
for (const previousMarker of [false, true]) test(`same-HTML deployment rolls back changed headers, previous marker=${previousMarker}`, async () => {
  const r = remote(), p = plan();
  const oldMarker = Buffer.from('{"id":"previous"}');
  if (previousMarker) r.files.set(R.ROOT + '/.fl-site-deploy.json', oldMarker);
  r.files.set(R.ROOT + '/.htaccess', Buffer.from('OLD RULES'));
  const home = p.files.find(f => f.name === 'index.html'); home.body = Buffer.from('Femboy Launcher OLD'); home.sha256 = require('../build/publish-spaceweb').digest(home.body);
  const body = Buffer.from('NEW RULES'); p.files.push({name:'.htaccess',body,sha256:require('../build/publish-spaceweb').digest(body)});
  await assert.rejects(publish(p,r,{verify:async()=>{throw Error('fixture bad headers')}}));
  assert.equal((await r.get(R.ROOT+'/.htaccess')).toString(),'OLD RULES');
  if(previousMarker) assert.deepEqual(await r.get(R.ROOT+'/.fl-site-deploy.json'),oldMarker);
  else assert.equal(await r.exists(R.ROOT+'/.fl-site-deploy.json'),false);
});
test('a verified completion record preserves the new site during orphan-lock recovery', async () => {
  let blocked = true;
  const r = remote({ fault(op, args, phase) { if (blocked && op === 'move' && args[0] === R.LOCK && phase === 'before') throw Error('fixture release blocked'); } });
  await publish(plan(), r); assert.equal(await r.exists(R.LOCK), true);
  blocked = false;
  const result = await R.recover(r, { expectedId: ID, ownerStopped: true });
  assert.equal(result.keptCompletedWebsite, true); assert.equal((await r.get(R.ROOT + '/index.html')).toString(), 'Femboy Launcher NEW');
  assert.equal(await r.exists('/.fl-site-backup-' + ID), true);
});
for (const boundary of ['first', 'second', 'rollback']) test(`lost rename acknowledgement is reconciled: ${boundary}`, async () => {
  let injected = false;
  const r = remote({ fault(op, args, phase) {
    const selected = boundary === 'first' ? args[0] === R.ROOT && args[1].includes('backup-') : boundary === 'second' ? args[0].includes('stage-') : args[0].includes('backup-');
    if (!injected && op === 'move' && selected && phase === 'after') { injected = true; throw Error('fixture lost acknowledgement'); }
  } });
  if (boundary === 'rollback') await assert.rejects(publish(plan(), r, { verify: async () => { throw Error('fixture HTTP check'); } }));
  else await publish(plan(), r);
  assert.equal((await r.get(R.ROOT + '/index.html')).toString(), boundary === 'rollback' ? 'Femboy Launcher OLD' : 'Femboy Launcher NEW');
  assert.ok(r.reconnects > 0); assert.equal(await r.exists(R.LOCK), false);
});
test('blocked rollback keeps records, then explicit recovery works without preflighting the missing root', async () => {
  let blocked = true;
  const r = remote({ fault(op,args,phase) { if (blocked && op === 'move' && (args[0].includes('stage-') || args[0].includes('backup-')) && phase === 'before') throw Error('fixture connection down'); } });
  await assert.rejects(publish(plan(), r), /recovery requires attention/);
  assert.equal((await R.status(r)).rootPresent, false); blocked = false;
  await R.recover(r, { expectedId: ID, ownerStopped: true });
  assert.equal((await r.get(R.ROOT + '/keep.txt')).toString(), 'FOREIGN DATA');
});
test('recovery never overwrites an unrecognized root and fences the previous publisher', async () => {
  const r = remote(), { o } = await locked(r); await r.move(R.ROOT, o.backup);
  await r.mkdir(R.ROOT); await r.put(R.ROOT + '/index.html', Buffer.from('UNRELATED'));
  await assert.rejects(R.recover(r, { expectedId: ID, ownerStopped: true }));
  assert.equal((await r.get(R.ROOT + '/index.html')).toString(), 'UNRELATED');
  assert.equal(await r.exists(o.backup), true);
  await assert.rejects(R.guard(r, o), /recovery is in progress/);
});
test('fresh process recovers to a complete old/new site at every modeled mutation boundary', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spaceweb-recovery-fault-'));
  t.after(() => { assert.ok(path.basename(root).startsWith('spaceweb-recovery-fault-')); fs.rmSync(root, { recursive: true, force: true }); });
  const baseline = remote(); await publish(plan(), baseline); const steps = baseline.mutations;
  const script = `const {remote,plan}=require(${JSON.stringify(path.join(__dirname, 'spaceweb-remote-fixture'))});const {publish}=require(${JSON.stringify(path.join(__dirname, '../build/publish-spaceweb'))});const r=remote({file:process.argv[1],mode:process.argv[2],crashAt:Number(process.argv[3])});publish(plan(),r).catch(()=>{});`;
  let scenarios = 0;
  for (const mode of ['throw-before', 'throw-after', 'kill-before', 'kill-after']) for (let step = 1; step <= steps; step++) {
    const file = path.join(root, 'state.json'); fs.rmSync(file, { force: true });
    const child = spawnSync(process.execPath, ['-e', script, file, mode, String(step)], { encoding: 'utf8', timeout: 10000, windowsHide: true });
    assert.ok([0,77].includes(child.status), child.stderr);
    const r = remote({ file }), s = await R.status(r);
    if (s.locked) await R.recover(r, { expectedId: s.unrecognized ? 'unowned' : s.id, ownerStopped: true });
    const body = (await r.get(R.ROOT + '/index.html')).toString();
    assert.ok(['Femboy Launcher OLD','Femboy Launcher NEW'].includes(body), mode + step);
    assert.ok(await r.exists(R.ROOT + '/keep.txt') || await r.exists('/.fl-site-backup-' + ID + '/keep.txt'));
    assert.equal((await R.status(r)).locked, false, mode + step);
    scenarios++;
  }
  t.diagnostic(`${steps} mutation steps; ${scenarios} throw/kill boundary scenarios`);
});

test('rollback retries a disconnected precheck without losing the previous website', async () => {
  const r=remote(), get=r.get.bind(r); let rollback=false, failures=0;
  r.get=async (...args)=>{if(rollback&&args[0]===R.LOCK+'/owner.json'&&failures++===0)throw Object.assign(Error('synthetic FTP private response'),{code:'ECONNRESET'});return get(...args)};
  await assert.rejects(publish(plan(),r,{verify:async()=>{rollback=true;throw Error('fixture public check')}}),/fixture public check/);
  assert.equal((await r.get(R.ROOT+'/index.html')).toString(),'Femboy Launcher OLD');assert.equal(await r.exists(R.LOCK),false);assert.ok(r.reconnects>0);
});
test('failed rollback exposes only safe phase/codes while retaining causes and recovery records', async () => {
  const r=remote(),get=r.get.bind(r);let rollback=false;
  const privateValue='SYNTHETIC_PASSWORD_ACCOUNT_DO_NOT_LOG';
  r.get=async (...args)=>{if(rollback&&args[0]===R.LOCK+'/owner.json')throw Object.assign(Error(privateValue),{code:privateValue});return get(...args)};
  const first=Object.assign(Error(privateValue),{code:'ETIMEDOUT'});
  await assert.rejects(publish(plan(),r,{verify:async()=>{rollback=true;throw first}}),e=>{
    assert.equal(e.phase,'public-check');assert.equal(e.publishCause,first);assert.equal(e.cause.message,privateValue);
    assert.match(e.message,/operation=ETIMEDOUT, rollback=unclassified/);assert.equal(e.message.includes(privateValue),false);return true;
  });
  assert.equal(await r.exists(R.LOCK),true);assert.equal(await r.exists('/.fl-site-backup-'+ID),true);
});

test('FTP numeric reply codes are safe diagnostics without exposing server replies', async () => {
 const r=remote(),get=r.get.bind(r);let rollback=false;
 r.get=async(...args)=>{if(rollback&&args[0]===R.LOCK+'/owner.json')throw Object.assign(Error('SYNTHETIC_PRIVATE_FTP_REPLY'),{code:550});return get(...args)};
 await assert.rejects(publish(plan(),r,{verify:async()=>{rollback=true;throw Object.assign(Error('private'),{code:'ECONNRESET'})}}),e=>{assert.match(e.message,/operation=ECONNRESET, rollback=FTP_550/);assert.equal(e.message.includes('PRIVATE'),false);return true;});
});
