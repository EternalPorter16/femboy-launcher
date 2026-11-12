// A pack update stages its writes before touching the game. The journal and
// independent copies of the old files allow rollback after an interrupted commit.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const instances = require('./instances');
const fsx = require('./fsx');
const { safeJoin } = require('./net');

const active = new Set();
const folder = (id) => path.join(instances.dirOf(id), '.pack-update');
const metadata = ['instance.json', 'pack-files.json', 'mods-meta.json'];
const key = (rel) => rel.replace(/\\/g, '/').toLowerCase();
const damaged = () => new Error('Запись восстановления повреждена. Резервные файлы сохранены; не удаляй папку обновления');
function pendingFolder(id) {
  const st = fs.lstatSync(folder(id), { throwIfNoEntry: false });
  if (!st) return false;
  if (!st.isDirectory()) throw damaged();
  return true;
}
function digest(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function seal(value) { return { ...value, checksum: digest(value) }; }
function unseal(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw damaged();
  const { checksum, ...data } = value;
  if (typeof checksum !== 'string' || checksum !== digest(data)) throw damaged();
  return data;
}
function hashFile(file) {
  const fd = fs.openSync(file, 'r'), hash = crypto.createHash('sha256'), chunk = Buffer.alloc(65536);
  try { for (let n; (n = fs.readSync(fd, chunk, 0, chunk.length, null));) hash.update(chunk.subarray(0, n)); }
  finally { fs.closeSync(fd); }
  return hash.digest('hex');
}
function readRecord(file) {
  const st = fs.lstatSync(file);
  if (!st.isFile() || st.size > 32 * 1024 * 1024) throw damaged();
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function validateState(raw, id) {
  const state = raw?.version === 2 ? unseal(raw) : raw;
  if (![1, 2].includes(state?.version) || !['applying', 'committed'].includes(state.phase) || !Array.isArray(state.entries) || !state.entries.length || state.entries.length > 100000) throw damaged();
  if (state.version === 2 && (state.instance !== id || !/^[a-f0-9]{32}$/.test(state.transaction))) throw damaged();
  const targets = new Set(), indexes = new Set();
  for (const e of state.entries) {
    if (!e || !['game', 'instance'].includes(e.root) || typeof e.rel !== 'string' || !Number.isSafeInteger(e.backup) || e.backup < 0 || e.backup >= state.entries.length || typeof e.existed !== 'boolean') throw damaged();
    if (e.root === 'instance' && !metadata.includes(e.rel)) throw damaged();
    const dest = safeJoin(e.root === 'game' ? instances.gameDir(id) : instances.dirOf(id), e.rel);
    if (e.root === 'game' && (/^(?:\.pack-update|backups)(?:[\\/]|$)/i.test(e.rel) || e.rel.split(/[\\/]/).some(p => p === '..' || /:/.test(p)))) throw damaged();
    const k = key(dest);
    if (targets.has(k) || indexes.has(e.backup)) throw damaged();
    targets.add(k); indexes.add(e.backup);
    if (state.version === 2 && e.existed && (!Number.isSafeInteger(e.size) || e.size < 0 || !/^[a-f0-9]{64}$/.test(e.sha256))) throw damaged();
  }
  return state;
}
function planDigest(state) { return digest({ ...state, phase: 'applying' }); }

function recoveryState(id) {
  const dir = folder(id);
  let state, backup;
  try { state = validateState(readRecord(path.join(dir, 'journal.json')), id); } catch {}
  try { backup = validateState(readRecord(path.join(dir, 'journal.backup.json')), id); } catch {}
  if (state && backup && (state.version !== 2 || backup.version !== 2 || planDigest(state) !== planDigest(backup))) throw damaged();
  const selected = state || backup;
  if (!selected) {
    const hasRecords = ['journal.json', 'journal.backup.json', 'committed.json'].some(name => fs.existsSync(path.join(dir, name)));
    let preparing = false;
    try { const p = unseal(readRecord(path.join(dir, 'preparing.json'))); preparing = p.version === 2 && p.instance === id && p.phase === 'preparing'; } catch {}
    const old = path.join(dir, 'old');
    // Legacy files with backups but no readable map cannot safely be discarded.
    if (hasRecords || (!preparing && fs.existsSync(old) && fs.readdirSync(old).length)) throw damaged();
    return { state: null, committed: false, source: 'preparing' };
  }
  let committed = selected.phase === 'committed';
  const receipt = path.join(dir, 'committed.json');
  if (!committed && fs.existsSync(receipt)) {
    let r;
    try { r = unseal(readRecord(receipt)); } catch { throw damaged(); }
    if (selected.version !== 2 || r.version !== 2 || r.instance !== id || r.transaction !== selected.transaction || r.plan !== planDigest(selected) || r.phase !== 'committed') throw damaged();
    committed = true;
  }
  return { state: selected, committed, source: state ? 'journal' : 'backup' };
}

function preflight(id, state) {
  if (!state) return;
  if (state.entries.some(e => e.existed) && !fs.lstatSync(path.join(folder(id), 'old')).isDirectory()) throw damaged();
  // Validate every backup and destination before the first rollback write.
  for (const e of state.entries) {
    const root = e.root === 'game' ? instances.gameDir(id) : instances.dirOf(id);
    const dest = safeJoin(root, e.rel);
    let parent = path.dirname(dest);
    while (parent !== root && parent.startsWith(root + path.sep)) {
      const st = fs.lstatSync(parent, { throwIfNoEntry: false });
      if (st && (!st.isDirectory() || st.isSymbolicLink())) throw damaged();
      parent = path.dirname(parent);
    }
    const target = fs.lstatSync(dest, { throwIfNoEntry: false });
    if (target && !target.isFile()) throw damaged();
    if (!e.existed) continue;
    const file = path.join(folder(id), 'old', String(e.backup)), st = fs.lstatSync(file);
    if (!st.isFile() || (state.version === 2 && (st.size !== e.size || hashFile(file) !== e.sha256))) throw damaged();
    if (e.root === 'instance' && e.rel === 'instance.json') {
      const saved = readRecord(file);
      if (saved?.id !== undefined && saved.id !== id) throw damaged();
    }
  }
}

function status(id) {
  try {
    if (!pendingFolder(id)) return { pending: false };
    if (active.has(id)) return { pending: true, canRecover: false, busy: true };
    const r = recoveryState(id);
    if (!r.committed) preflight(id, r.state);
    return { pending: true, canRecover: true, source: r.source, committed: r.committed };
  } catch { return { pending: true, canRecover: false, reason: damaged().message }; }
}

function retire(id) {
  // Never delete records piecemeal while they still look like a live update.
  // A crash during cleanup can only leave a detached, non-replayed backup.
  const parent = path.join(instances.dirOf(id), 'backups', '.update-cleanup');
  fs.mkdirSync(parent, { recursive: true });
  const dest = path.join(parent, crypto.randomBytes(16).toString('hex'));
  fsx.renameRetry(folder(id), dest);
  try { fs.rmSync(dest, { recursive: true, force: true }); } catch {}
}

function copyAtomic(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  const tmp = `${to}.${crypto.randomBytes(8).toString('hex')}.pack.tmp`;
  try {
    fs.copyFileSync(from, tmp);
    fsx.renameRetry(tmp, to);
  } finally { fs.rmSync(tmp, { force: true }); }
}

function recover(id) {
  if (active.has(id)) throw new Error('Обновление этой сборки ещё выполняется');
  const dir = folder(id);
  if (!pendingFolder(id)) return false;
  const { state, committed } = recoveryState(id);
  if (state && !committed) {
    preflight(id, state);
    // Keep all backups until every restore succeeds. Repeating recovery is safe.
    for (const e of state.entries) {
      const dest = safeJoin(e.root === 'game' ? instances.gameDir(id) : instances.dirOf(id), e.rel);
      if (e.existed) copyAtomic(path.join(dir, 'old', String(e.backup)), dest);
      else fs.rmSync(dest, { force: true });
    }
  }
  retire(id);
  return true;
}

function begin(id) {
  recover(id);
  const dir = folder(id);
  fs.mkdirSync(path.join(dir, 'new'), { recursive: true });
  fsx.writeJsonAtomic(path.join(dir, 'preparing.json'), seal({ version: 2, instance: id, phase: 'preparing' }));
  active.add(id);
  const writes = new Map();
  let journal;
  const abort = () => { active.delete(id); return recover(id); };
  return {
    path(rel) {
      const dest = safeJoin(instances.gameDir(id), rel);
      const canonical = path.relative(instances.gameDir(id), dest);
      const staged = safeJoin(path.join(dir, 'new'), canonical);
      writes.set(key(canonical), { rel: canonical, staged });
      return staged;
    },
    commit(removals) {
      const changes = new Map(writes);
      for (const rel of removals) {
        const canonical = path.relative(instances.gameDir(id), safeJoin(instances.gameDir(id), rel));
        if (!changes.has(key(canonical))) changes.set(key(canonical), { rel: canonical });
      }
      const entries = [...changes.values()].map((e) => ({ ...e, root: 'game' }));
      entries.push(...metadata.map((rel) => ({ root: 'instance', rel })));
      fs.mkdirSync(path.join(dir, 'old'), { recursive: true });
      for (const [i, e] of entries.entries()) {
        const dest = safeJoin(e.root === 'game' ? instances.gameDir(id) : instances.dirOf(id), e.rel);
        let stat;
        try { stat = fs.lstatSync(dest); } catch (err) { if (err.code !== 'ENOENT') throw err; }
        if (stat && !stat.isFile()) throw new Error('Файл обновления занят папкой или ссылкой');
        e.existed = !!stat;
        e.backup = i;
        if (stat) {
          const old = path.join(dir, 'old', String(i));
          fs.copyFileSync(dest, old);
          e.size = fs.statSync(old).size;
          e.sha256 = hashFile(old);
        }
      }
      journal = { version: 2, instance: id, transaction: crypto.randomBytes(16).toString('hex'), phase: 'applying', entries: entries.map(({ root, rel, existed, backup, size, sha256 }) => ({ root, rel, existed, backup, ...(existed ? { size, sha256 } : {}) })) };
      const record = seal(journal);
      validateState(record, id);
      if (Buffer.byteLength(JSON.stringify(record)) > 32 * 1024 * 1024) throw damaged();
      preflight(id, journal);
      // Persist the intent before the first modification of the instance.
      fsx.writeJsonAtomic(path.join(dir, 'journal.backup.json'), record);
      fsx.writeJsonAtomic(path.join(dir, 'journal.json'), record);
      fs.rmSync(path.join(dir, 'preparing.json'), { force: true });
      for (const e of entries.filter((e) => e.root === 'game')) {
        const dest = safeJoin(instances.gameDir(id), e.rel);
        if (e.staged) {
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fsx.renameRetry(e.staged, dest);
        } else fs.rmSync(dest, { force: true });
      }
    },
    finish() {
      if (!journal) throw new Error('Обновление ещё не применено');
      fsx.writeJsonAtomic(path.join(dir, 'committed.json'), seal({ version: 2, instance: id, transaction: journal.transaction, phase: 'committed', plan: planDigest(journal) }));
      active.delete(id);
      // The receipt is the commit point. Failure of redundant bookkeeping must
      // not turn an already committed update into a failed/rolled-back update.
      try { fsx.writeJsonAtomic(path.join(dir, 'journal.json'), seal({ ...journal, phase: 'committed' })); } catch {}
      // Cleanup failure is recoverable and must not turn a committed update into
      // a reported failure. The next recovery only removes a committed journal.
      try { retire(id); } catch {}
    },
    abort,
  };
}

module.exports = { begin, recover, status };
