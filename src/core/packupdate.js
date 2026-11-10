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
  if (!fs.existsSync(dir)) return false;
  const journal = path.join(dir, 'journal.json');
  if (!fs.existsSync(journal)) {
    // No commit has begun: only staged downloads can be present.
    fs.rmSync(dir, { recursive: true, force: true });
    return true;
  }
  const state = JSON.parse(fs.readFileSync(journal, 'utf8'));
  if (state.version !== 1 || !['applying', 'committed'].includes(state.phase) || !Array.isArray(state.entries)) throw new Error('Не удалось прочитать журнал обновления сборки');
  if (state.phase !== 'committed') {
    // Keep all backups until every restore succeeds. Repeating recovery is safe.
    for (const e of state.entries) {
      if (!['game', 'instance'].includes(e.root) || typeof e.rel !== 'string' || !Number.isInteger(e.backup) || e.backup < 0 || typeof e.existed !== 'boolean') throw new Error('Некорректный журнал обновления сборки');
      if (e.root === 'instance' && !metadata.includes(e.rel)) throw new Error('Некорректные метаданные обновления сборки');
      const dest = safeJoin(e.root === 'game' ? instances.gameDir(id) : instances.dirOf(id), e.rel);
      if (e.existed) copyAtomic(path.join(dir, 'old', String(e.backup)), dest);
      else fs.rmSync(dest, { force: true });
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

function begin(id) {
  recover(id);
  const dir = folder(id);
  fs.mkdirSync(path.join(dir, 'new'), { recursive: true });
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
        if (stat) fs.copyFileSync(dest, path.join(dir, 'old', String(i)));
      }
      journal = { version: 1, phase: 'applying', entries: entries.map(({ root, rel, existed, backup }) => ({ root, rel, existed, backup })) };
      // Persist the intent before the first modification of the instance.
      fsx.writeJsonAtomic(path.join(dir, 'journal.json'), journal);
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
      fsx.writeJsonAtomic(path.join(dir, 'journal.json'), { ...journal, phase: 'committed' });
      active.delete(id);
      // Cleanup failure is recoverable and must not turn a committed update into
      // a reported failure. The next recovery only removes a committed journal.
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    },
    abort,
  };
}

module.exports = { begin, recover };
