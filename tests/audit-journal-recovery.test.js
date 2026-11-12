const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), os = require('os'), vm = require('vm'), crypto = require('crypto');
const core = path.join(__dirname, '../src/core');
const { spawnSync } = require('child_process');
const fsx = require('../src/core/fsx'), { safeJoin } = require('../src/core/net');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'journal-recovery-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const game = path.join(root, '.minecraft'), dir = path.join(root, '.pack-update');
  fs.mkdirSync(path.join(game, 'mods'), { recursive: true });
  fs.writeFileSync(path.join(root, 'instance.json'), JSON.stringify({ id: 'fixture', version: 'old' }));
  fs.writeFileSync(path.join(game, 'mods/old.jar'), 'OLD');
  const load = (overrides = {}) => {
    const m = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(core, 'packupdate.js'), 'utf8'), {
      module: m, process, Buffer, require: n => Object.hasOwn(overrides, n) ? overrides[n] : n === './instances' ? { dirOf: () => root, gameDir: () => game } : n === './fsx' ? fsx : n === './net' ? { safeJoin } : require(n),
    }); return m.exports;
  };
  const applied = (transaction = load()) => {
    const tx = transaction.begin('fixture'), dest = tx.path('mods/new.jar');
    fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, 'NEW');
    tx.commit(['mods/old.jar']);
    fs.writeFileSync(path.join(root, 'instance.json'), JSON.stringify({ id: 'fixture', version: 'new' }));
    return tx;
  };
  const restored = () => {
    assert.equal(fs.readFileSync(path.join(game, 'mods/old.jar'), 'utf8'), 'OLD');
    assert.equal(fs.existsSync(path.join(game, 'mods/new.jar')), false);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'instance.json'))).version, 'old');
  };
  return { root, game, dir, load, applied, restored };
}
for (const damage of ['empty', 'truncated', 'missing', 'checksum', 'schema']) {
  test(`independent record recovers a damaged main journal: ${damage}`, t => {
    const f = fixture(t); f.applied(); const file = path.join(f.dir, 'journal.json');
    if (damage === 'missing') fs.unlinkSync(file);
    else if (damage === 'empty' || damage === 'truncated') fs.writeFileSync(file, damage === 'empty' ? '' : '{');
    else { const j = JSON.parse(fs.readFileSync(file)); j.phase = damage === 'schema' ? 'unknown' : 'committed'; fs.writeFileSync(file, JSON.stringify(j)); }
    const recovery = f.load(); assert.equal(recovery.status('fixture').source, 'backup');
    assert.equal(recovery.recover('fixture'), true); f.restored(); assert.equal(recovery.recover('fixture'), false);
  });
}
test('missing both maps after applying never discards backups', t => {
  const f = fixture(t); f.applied();
  fs.unlinkSync(path.join(f.dir, 'journal.json')); fs.unlinkSync(path.join(f.dir, 'journal.backup.json'));
  assert.throws(() => f.load().recover('fixture'), /Резервные файлы сохранены/);
  assert.ok(fs.existsSync(path.join(f.dir, 'old')));
  assert.equal(fs.readFileSync(path.join(f.game, 'mods/new.jar'), 'utf8'), 'NEW');
});
test('all backup bytes are validated before any rollback write', t => {
  const f = fixture(t); f.applied();
  const state = JSON.parse(fs.readFileSync(path.join(f.dir, 'journal.json')));
  const last = state.entries.filter(e => e.existed).pop();
  const file = path.join(f.dir, 'old', String(last.backup)); fs.writeFileSync(file, Buffer.alloc(last.size, 65));
  assert.throws(() => f.load().recover('fixture'));
  assert.equal(fs.readFileSync(path.join(f.game, 'mods/new.jar'), 'utf8'), 'NEW');
  assert.equal(fs.existsSync(path.join(f.game, 'mods/old.jar')), false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.root, 'instance.json'))).version, 'new');
});
test('commit receipt prevents rollback when main journal is damaged after successful finish', t => {
  const f = fixture(t), tx = f.applied(f.load({ './fsx': { ...fsx, renameRetry(from, to) { if (from === f.dir) throw Error('fixture cleanup'); return fsx.renameRetry(from, to); } } }));
  tx.finish(); fs.writeFileSync(path.join(f.dir, 'journal.json'), '{');
  f.load().recover('fixture');
  assert.equal(fs.readFileSync(path.join(f.game, 'mods/new.jar'), 'utf8'), 'NEW');
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.root, 'instance.json'))).version, 'new');
});
test('failure of redundant final journal does not invalidate a committed operation', t => {
  const f = fixture(t), transaction = f.load({ './fsx': { ...fsx, writeJsonAtomic(file, value) {
    if (file.endsWith('journal.json') && value.phase === 'committed') throw Error('fixture final record failure');
    return fsx.writeJsonAtomic(file, value);
  } } });
  const tx = f.applied(transaction); assert.doesNotThrow(() => tx.finish());
  assert.equal(fs.readFileSync(path.join(f.game, 'mods/new.jar'), 'utf8'), 'NEW');
});
test('old journal with a malformed late entry performs no partial rollback', t => {
  const f = fixture(t); fs.mkdirSync(path.join(f.dir, 'old'), { recursive: true });
  fs.writeFileSync(path.join(f.dir, 'old/0'), 'RECOVERED');
  fs.writeFileSync(path.join(f.dir, 'journal.json'), JSON.stringify({ version: 1, phase: 'applying', entries: [
    { root: 'game', rel: 'mods/old.jar', existed: true, backup: 0 }, { root: 'instance', rel: '../../outside', existed: false, backup: 1 },
  ] }));
  assert.throws(() => f.load().recover('fixture'));
  assert.equal(fs.readFileSync(path.join(f.game, 'mods/old.jar'), 'utf8'), 'OLD');
});
test('a valid legacy journal remains recoverable', t => {
  const f = fixture(t); fs.mkdirSync(path.join(f.dir, 'old'), { recursive: true });
  fs.writeFileSync(path.join(f.dir, 'old/0'), 'LEGACY OLD');
  fs.writeFileSync(path.join(f.dir, 'journal.json'), JSON.stringify({ version: 1, phase: 'applying', entries: [{ root: 'game', rel: 'mods/old.jar', existed: true, backup: 0 }] }));
  f.load().recover('fixture'); assert.equal(fs.readFileSync(path.join(f.game, 'mods/old.jar'), 'utf8'), 'LEGACY OLD');
});
test('legacy broken JSON has a readable diagnosis and preserves all files', t => {
  const f = fixture(t); fs.mkdirSync(f.dir); fs.writeFileSync(path.join(f.dir, 'journal.json'), '{');
  const s = f.load().status('fixture'); assert.equal(s.pending, true); assert.equal(s.canRecover, false);
  assert.match(s.reason, /Резервные файлы сохранены/); assert.throws(() => f.load().recover('fixture'), /не удаляй/);
  assert.equal(fs.readFileSync(path.join(f.dir, 'journal.json'), 'utf8'), '{');
});
test('a damaged commit receipt blocks ambiguous recovery without overwriting files', t => {
  const f = fixture(t); f.applied(); fs.writeFileSync(path.join(f.dir, 'committed.json'), '{');
  assert.throws(() => f.load().recover('fixture'), /Резервные файлы сохранены/);
  assert.equal(fs.readFileSync(path.join(f.game, 'mods/new.jar'), 'utf8'), 'NEW');
  assert.equal(fs.existsSync(path.join(f.game, 'mods/old.jar')), false);
});
test('a foreign instance journal cannot rewrite the destination identity', t => {
  const f = fixture(t); f.applied();
  for (const name of ['journal.json', 'journal.backup.json']) {
    const { checksum, ...state } = JSON.parse(fs.readFileSync(path.join(f.dir, name)));
    state.instance = 'other'; const hash = crypto.createHash('sha256').update(JSON.stringify(state)).digest('hex');
    fs.writeFileSync(path.join(f.dir, name), JSON.stringify({ ...state, checksum: hash }));
  }
  assert.throws(() => f.load().recover('fixture'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.root, 'instance.json'))).id, 'fixture');
});
test('incomplete preparation with copied backups can be discarded without touching working files', t => {
  const f = fixture(t), transaction = f.load({ fs: { ...fs, copyFileSync(from, to, ...args) {
    if (to.startsWith(path.join(f.dir, 'old')) && to.endsWith('2')) throw Error('fixture backup failure');
    return fs.copyFileSync(from, to, ...args);
  } } });
  const tx = transaction.begin('fixture'), dest = tx.path('mods/new.jar');
  fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, 'NEW');
  assert.throws(() => tx.commit(['mods/old.jar']), /backup failure/);
  f.load().recover('fixture'); f.restored();
});
test('partial cleanup after detaching the resolved directory is never replayed', t => {
  const f = fixture(t), tx = f.applied(f.load({ fs: { ...fs, rmSync(file, opts) {
    if (file.includes(path.join('backups', '.update-cleanup'))) {
      fs.rmSync(path.join(file, 'journal.json'), { force: true });
      fs.rmSync(path.join(file, 'committed.json'), { force: true });
      throw Error('fixture interrupted cleanup');
    }
    return fs.rmSync(file, opts);
  } } }));
  tx.finish(); assert.equal(f.load().recover('fixture'), false);
  assert.equal(fs.readFileSync(path.join(f.game, 'mods/new.jar'), 'utf8'), 'NEW');
  assert.equal(fs.readdirSync(path.join(f.root, 'backups/.update-cleanup')).length, 1);
});
for (const boundary of ['receipt', 'detach']) {
  test(`fresh process preserves committed data after abrupt exit at ${boundary}`, t => {
    const f = fixture(t);
    const code = `
      const fs=require('fs'),path=require('path'),vm=require('vm');
      const root=${JSON.stringify(f.root)}, game=${JSON.stringify(f.game)}, core=${JSON.stringify(core)};
      const fsx=require(path.join(core,'fsx')), safeJoin=require(path.join(core,'net')).safeJoin;
      const fx={...fsx,writeJsonAtomic(file,value){fsx.writeJsonAtomic(file,value);if(${JSON.stringify(boundary)}==='receipt'&&file.endsWith('committed.json'))process.exit(77)},renameRetry(from,to){fsx.renameRetry(from,to);if(${JSON.stringify(boundary)}==='detach'&&from===path.join(root,'.pack-update'))process.exit(77)}};
      const m={exports:{}};vm.runInNewContext(fs.readFileSync(path.join(core,'packupdate.js'),'utf8'),{module:m,Buffer,process,require:n=>n==='./instances'?{dirOf:()=>root,gameDir:()=>game}:n==='./fsx'?fx:n==='./net'?{safeJoin}:require(n)});
      const tx=m.exports.begin('fixture'), dest=tx.path('mods/new.jar');fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,'NEW');
      tx.commit(['mods/old.jar']);fs.writeFileSync(path.join(root,'instance.json'),JSON.stringify({id:'fixture',version:'new'}));tx.finish();
    `;
    const child = spawnSync(process.execPath, ['-e', code], { cwd: path.join(__dirname, '..'), windowsHide: true, timeout: 10000, encoding: 'utf8' });
    assert.equal(child.status, 77, child.stderr); f.load().recover('fixture');
    assert.equal(fs.readFileSync(path.join(f.game, 'mods/new.jar'), 'utf8'), 'NEW');
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.root, 'instance.json'))).version, 'new');
  });
}
test('recovery IPC validates the instance and blocks running or preparing games', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
  const handlers = source.slice(source.indexOf("handle('packs:recoveryStatus'"), source.indexOf("handle('packs:check'"));
  const api = {}, busy = new Set(); let running = true, recovered = 0;
  vm.runInNewContext(handlers, {
    handle: (name, fn) => { api[name] = fn; },
    instances: { get(id) { if (id !== 'fixture') throw Error('invalid instance'); } },
    game: { isRunning: () => running }, launches: new Set(), packUpdates: busy, modInstalls: new Set(),
    withTask: async fn => fn(), lifecycle: { idle() {} },
    packupdate: { status: () => ({ pending: true }), recover() { recovered++; return true; } },
  });
  assert.throws(() => api['packs:recover']('../outside'), /invalid instance/);
  assert.throws(() => api['packs:recover']('fixture'), /закрой игру/);
  assert.equal(recovered, 0); running = false;
  assert.equal((await api['packs:recover']('fixture')).recovered, true);
  assert.equal(recovered, 1); assert.equal(busy.size, 0);
});
test('commit refuses a redirected child folder before touching existing game files', t => {
  const f = fixture(t), target = path.join(f.root, 'linked-mods');
  fs.renameSync(path.join(f.game, 'mods'), target);
  fs.symlinkSync(target, path.join(f.game, 'mods'), process.platform === 'win32' ? 'junction' : 'dir');
  const tx = f.load().begin('fixture'), staged = tx.path('mods/new.jar');
  fs.mkdirSync(path.dirname(staged), { recursive: true }); fs.writeFileSync(staged, 'NEW');
  assert.throws(() => tx.commit(['mods/old.jar']));
  assert.equal(fs.readFileSync(path.join(target, 'old.jar'), 'utf8'), 'OLD');
  assert.equal(fs.existsSync(path.join(target, 'new.jar')), false);
  tx.abort();
});
