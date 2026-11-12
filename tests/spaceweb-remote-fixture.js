// Persistent in-memory FTP model. No socket, credential, or real remote operations.
const fs = require('fs');
const { digest } = require('../build/publish-spaceweb');
const ID = '20261111000000000-deadbeef';
function plan() {
  const files = Object.entries({ 'index.html': 'Femboy Launcher NEW', 'en/index.html': 'Femboy Launcher English NEW', '.fl-site-deploy.json': JSON.stringify({ id: ID }) })
    .map(([name, text]) => ({ name, body: Buffer.from(text), sha256: digest(Buffer.from(text)) }));
  return { id: ID, version: '0.10.2', preview: false, files };
}
function remote({ file, fault, crashAt = 0, mode = '' } = {}) {
  const saved = file && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : null;
  const dirs = new Set(saved?.dirs || ['/public_html']);
  const files = new Map(saved ? saved.files.map(([p, b]) => [p, Buffer.from(b, 'base64')]) : [['/public_html/index.html', Buffer.from('Femboy Launcher OLD')], ['/public_html/keep.txt', Buffer.from('FOREIGN DATA')]]);
  const calls = []; let mutations = 0, injected = false, reconnects = 0;
  const save = () => { if (file) fs.writeFileSync(file, JSON.stringify({ dirs: [...dirs], files: [...files].map(([p,b]) => [p,b.toString('base64')]) })); };
  const mutation = (op, args, change) => {
    const n = ++mutations; calls.push([op, ...args]);
    const inject = phase => {
      fault?.(op, args, phase);
      if (!injected && n === crashAt && mode.endsWith(phase)) {
        injected = true; if (mode.startsWith('kill')) process.exit(77);
        throw Error('fixture transport failure');
      }
    };
    inject('before'); change(); save(); inject('after');
  };
  return {
    dirs, files, calls, get mutations() { return mutations; }, get reconnects() { return reconnects; },
    async preflight() {
      if (!dirs.has('/public_html')) throw Error('Expected public_html directory not found');
      const body = files.get('/public_html/index.html');
      if (!body?.includes('Femboy Launcher')) throw Error('Refusing to replace an unrelated website');
      return digest(body);
    },
    async exists(p) { return dirs.has(p) || files.has(p); },
    async list(p) { return [...dirs, ...files.keys()].filter(n => n.startsWith(p + '/') && !n.slice(p.length + 1).includes('/')); },
    async get(p, limit = Infinity) { const b = files.get(p); if (!b) throw Error('fixture missing file'); if (b.length > limit) throw Error('fixture size limit'); return Buffer.from(b); },
    async mkdir(p) { mutation('mkdir', [p], () => { if (dirs.has(p)) throw Error('fixture directory exists'); dirs.add(p); }); },
    async ensureDir(p) { mutation('ensureDir', [p], () => dirs.add(p)); },
    async put(p,b) { mutation('put', [p], () => files.set(p, Buffer.from(b))); },
    async remove(p) { mutation('remove', [p], () => { if (!files.delete(p)) throw Error('fixture missing file'); }); },
    async rmdir(p) { mutation('rmdir', [p], () => { if ([...files.keys(), ...dirs].some(n => n.startsWith(p + '/'))) throw Error('fixture nonempty directory'); dirs.delete(p); }); },
    async move(from, to) { mutation('move', [from, to], () => {
      if (!dirs.has(from) || dirs.has(to) || files.has(to)) throw Error('fixture invalid rename');
      for (const d of [...dirs]) if (d === from || d.startsWith(from + '/')) { dirs.delete(d); dirs.add(to + d.slice(from.length)); }
      for (const [p,b] of [...files]) if (p.startsWith(from + '/')) { files.delete(p); files.set(to + p.slice(from.length), b); }
    }); },
    reconnect() { reconnects++; }, close() {}, snapshot() { return JSON.stringify({ dirs: [...dirs], files: [...files].map(([p,b]) => [p,b.toString('base64')]) }); },
  };
}
module.exports = { plan, remote, ID };
