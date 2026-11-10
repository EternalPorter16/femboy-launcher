// Миры и скриншоты сборки: список, резервная копия, удаление
const fs = require('fs');
const { pipeline } = require('stream/promises');
const path = require('path');
const { pathToFileURL } = require('url');
const yazl = require('yazl');
const instances = require('./instances');

const savesDir = (id) => path.join(instances.gameDir(id), 'saves');

function dirSize(dir) {
  let total = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    total += e.isDirectory() ? dirSize(p) : fs.statSync(p).size;
  }
  return total;
}

// Мир может быть ссылкой на папку другого лаунчера (перенос «на месте»)
const isDirLike = (dir, e) => e.isDirectory() || (e.isSymbolicLink() && fs.statSync(path.join(dir, e.name), { throwIfNoEntry: false })?.isDirectory());

function checkWorld(id, name) {
  if (!name || path.basename(name) !== name || name.startsWith('.')) throw new Error('Некорректное имя мира');
  const dir = path.join(savesDir(id), name);
  if (!fs.existsSync(path.join(dir, 'level.dat'))) throw new Error('Мир не найден');
  return dir;
}

function list(id) {
  const dir = savesDir(id);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => isDirLike(dir, e) && fs.existsSync(path.join(dir, e.name, 'level.dat')))
    .map((e) => {
      const p = path.join(dir, e.name);
      const icon = path.join(p, 'icon.png');
      return {
        name: e.name,
        size: dirSize(p),
        lastPlayed: fs.statSync(path.join(p, 'level.dat')).mtimeMs,
        icon: fs.existsSync(icon) ? 'data:image/png;base64,' + fs.readFileSync(icon).toString('base64') : null,
      };
    })
    .sort((a, b) => b.lastPlayed - a.lastPlayed);
}

// Сколько в сборке миров — без подсчёта размера, для быстрых значков на главной
function count(id) {
  const dir = savesDir(id);
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => isDirLike(dir, e) && fs.existsSync(path.join(dir, e.name, 'level.dat'))).length;
}

function listFiles(dir, base = '') {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...listFiles(path.join(dir, e.name), rel));
    else if (e.name !== 'session.lock') out.push(rel); // замок мира занят игрой и в копии не нужен
  }
  return out;
}

// Копия мира в zip потоком: файлы читаются с диска по одному, так что и мир на гигабайты не съест память.
// Автокопии помечены в имени файла («-auto-»): только их лаунчер потом сам и удаляет
async function backup(id, name, { auto = false } = {}) {
  const dir = checkWorld(id, name);
  const out = path.join(instances.dirOf(id), 'backups');
  fs.mkdirSync(out, { recursive: true });
  let file, tmp, fd;
  // Reserve a name before starting, including parallel backups in the same
  // second. A partial archive is never listed as a successful .zip.
  for (let time = Date.now(); ; time += 1000) {
    const d = new Date(time);
    const stamp = new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 19).replace(/[:T]/g, '-');
    file = path.join(out, `${name}${auto ? '-auto' : ''}-${stamp}.zip`);
    tmp = file + '.part';
    if (fs.existsSync(file)) continue;
    try { fd = fs.openSync(tmp, 'wx'); break; }
    catch (e) { if (e.code !== 'EEXIST') throw e; }
  }
  const zip = new yazl.ZipFile();
  const inputs = new Set();
  const closeInputs = async () => {
    await Promise.all([...inputs].filter((input) => !input.closed).map((input) => new Promise((resolve) => {
      input.once('close', resolve);
      input.destroy();
    })));
  };
  const stream = fs.createWriteStream(tmp, { fd, autoClose: true });
  zip.on('error', (e) => zip.outputStream.destroy(e));
  const writing = pipeline(zip.outputStream, stream);
  writing.catch(() => {}); // enumeration can throw before we await the pipeline
  try {
    for (const rel of listFiles(dir)) {
      const source = path.join(dir, rel);
      const stat = fs.statSync(source);
      zip.addReadStreamLazy(`${name}/${rel}`, { size: stat.size, mtime: stat.mtime, mode: stat.mode }, (callback) => {
        const input = fs.createReadStream(source);
        inputs.add(input);
        input.once('close', () => inputs.delete(input));
        input.on('error', (e) => zip.emit('error', e));
        callback(null, input);
      });
    }
    zip.end();
    await writing;
    await closeInputs();
    if (fs.existsSync(file)) throw new Error('Копия с таким именем уже существует');
    fs.renameSync(tmp, file);
    return file;
  } catch (e) {
    // Mark yazl errored as well: it must not start another lazy reader while
    // the output pipeline is shutting down.
    zip.emit('error', e);
    await closeInputs();
    const closed = !stream.closed ? new Promise((resolve) => stream.once('close', resolve)) : null;
    stream.destroy();
    await writing.catch(() => {});
    if (closed) await closed;
    try { fs.rmSync(tmp, { force: true }); } catch {}
    throw e;
  }
}

function remove(id, name) {
  fs.rmSync(checkWorld(id, name), { recursive: true, force: true });
}

/* ---------- копии миров: список, восстановление, автокопии ---------- */
const BACKUP_RE = /^(.+?)(-auto)?-(\d{4}-\d{2}-\d{2}-\d{2}-\d{2}(?:-\d{2})?)\.zip$/;

function backups(id) {
  const dir = path.join(instances.dirOf(id), 'backups');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .map((file) => {
      const m = BACKUP_RE.exec(file);
      if (!m) return null;
      const st = fs.statSync(path.join(dir, file));
      return { file, world: m[1], auto: !!m[2], size: st.size, time: st.mtimeMs };
    })
    .filter(Boolean)
    .sort((a, b) => b.time - a.time);
}

// Восстанавливаем рядом, а не поверх: мир «Имя (копия от …)» — текущий мир не трогаем
function restore(id, file) {
  if (path.basename(file) !== file || !BACKUP_RE.test(file)) throw new Error('Некорректное имя копии');
  const zipFile = path.join(instances.dirOf(id), 'backups', file);
  if (!fs.existsSync(zipFile)) throw new Error('Копия не найдена');
  const b = backups(id).find((x) => x.file === file);
  const when = new Date(b.time).toLocaleString('ru-RU', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(/[:/\\]/g, '.');
  let name = `${b.world} (копия от ${when})`;
  for (let n = 2; fs.existsSync(path.join(savesDir(id), name)); n++) name = `${b.world} (копия от ${when}, ${n})`;
  const dest = path.join(savesDir(id), name);
  const AdmZip = require('adm-zip');
  const zip = new AdmZip(zipFile);
  for (const e of zip.getEntries()) {
    if (e.isDirectory) continue;
    const rel = e.entryName.replace(/\\/g, '/').split('/').slice(1).join('/'); // внутри архива всё лежит в папке с именем мира
    const out = path.resolve(dest, rel);
    if (!rel || !out.startsWith(dest + path.sep)) continue;
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, e.getData());
  }
  return name;
}

// После игры: копии миров, в которые играли в этот раз. mode: 'session' — каждый раз, 'daily' — не чаще раза в сутки
async function autoBackup(id, since, { mode = 'daily', keep = 5 } = {}) {
  if (mode === 'off') return [];
  const done = [];
  const all = backups(id);
  for (const w of list(id)) {
    if (w.lastPlayed < since - 2000) continue; // в этот раз мир не открывали
    const last = all.find((b) => b.world === w.name && b.auto);
    if (mode === 'daily' && last && Date.now() - last.time < 20 * 3600 * 1000) continue;
    await backup(id, w.name, { auto: true });
    done.push(w.name);
    pruneAutos(id, w.name, keep);
  }
  return done;
}

// Лишние старые автокопии мира — прочь, остаются keep самых свежих (ручные копии и копии других миров не трогаем)
function pruneAutos(id, world, keep) {
  const autos = backups(id).filter((b) => b.world === world && b.auto);
  for (const old of autos.slice(Math.max(1, keep))) fs.rmSync(path.join(instances.dirOf(id), 'backups', old.file), { force: true });
}

/* ---------- копия перед тем, как мир откроют для друзей ---------- */
// Какой мир сейчас открыт в игре: тот, чей замок session.lock создан после since (игра создаёт его, когда открывает мир, чуть раньше,
// чем сервер напишет первую строку в лог). Из подходящих берётся самый свежий замок; таких нет — null
function openedSince(id, since) {
  const dir = savesDir(id);
  if (!fs.existsSync(dir)) return null;
  let best = null;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!isDirLike(dir, e)) continue;
    const lock = fs.statSync(path.join(dir, e.name, 'session.lock'), { throwIfNoEntry: false });
    if (lock && lock.mtimeMs >= since && (!best || lock.mtimeMs > best.at)) best = { name: e.name, at: lock.mtimeMs };
  }
  return best?.name || null;
}

// Автокопия открытого мира: если с ним на сеть что-то случится (друг сломал, игра вылетела), останется то, каким он был до гостей.
// Копия того же мира, сделанная меньше получаса назад, повторно не делается. since — когда началась игра в этом мире (с запасом)
async function backupOpened(id, since, { keep = 5 } = {}) {
  const name = openedSince(id, since);
  if (!name) return null;
  const recent = backups(id).find((b) => b.world === name && b.auto && Date.now() - b.time < 30 * 60000);
  if (recent) return { world: name, file: path.join(instances.dirOf(id), 'backups', recent.file), reused: true };
  const file = await backup(id, name, { auto: true });
  pruneAutos(id, name, keep);
  return { world: name, file, reused: false };
}

function screenshots(id) {
  const dir = path.join(instances.gameDir(id), 'screenshots');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /\.(png|jpe?g)$/i.test(f))
    .map((f) => ({ file: f, url: pathToFileURL(path.join(dir, f)).href, time: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.time - a.time)
    .slice(0, 200);
}

const screenshotPath = (id, file) => {
  if (path.basename(file) !== file) throw new Error('Некорректное имя файла');
  return path.join(instances.gameDir(id), 'screenshots', file);
};

module.exports = { list, count, backup, remove, backups, restore, autoBackup, openedSince, backupOpened, screenshots, screenshotPath, savesDir, assertWorld: checkWorld, backupsDir: (id) => path.join(instances.dirOf(id), 'backups') };
