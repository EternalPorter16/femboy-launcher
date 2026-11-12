// Игры, запущенные лаунчером: запись running-games.json в профиле. Если лаунчер закрыли принудительно (завершили процесс, упал),
// игра (Java) продолжает работать; при следующем старте по этой записи мы её узнаём, а не считаем сборку свободной
// (иначе второй запуск открыл бы тот же мир и сохранения) — FL-GAME-01.
// Запись: id сборки → { pid, procStart (время запуска процесса, как его отдаёт ОС), cmdHash, javaPath, gameDir, startedAt }.
// Процесс узнаём по PID И времени его запуска (PID Windows переиспользует) и по командной строке с папкой игры.
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const store = require('./store');
const fsx = require('./fsx');

const file = () => path.join(store.baseDir(), 'running-games.json');
const norm = (s) => String(s || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
const PROBE_TIMEOUT_MS = 3000;
const hash = (s) => crypto.createHash('sha1').update(String(s || '')).digest('hex');

// Папка игры в командной строке — целиком, с границей пути: «...a» не совпадает с «...ab»; кавычки, регистр и разделители не важны
const BEFORE = [' ', '"', "'", '=', ',', ';'];
const AFTER = [' ', '"', "'", '/', ',', ';'];
function cmdHasDir(cmd, dir) {
  const c = norm(cmd), d = norm(dir);
  if (!d) return false;
  for (let i = c.indexOf(d); i !== -1; i = c.indexOf(d, i + 1)) {
    const before = i === 0 ? ' ' : c[i - 1];
    const after = c[i + d.length];
    if (BEFORE.includes(before) && (after === undefined || AFTER.includes(after))) return true;
  }
  return false;
}

function readAll() {
  const r = fsx.readJson(file());
  if (!r.ok || !r.data || typeof r.data !== 'object' || Array.isArray(r.data)) return {};
  const out = {};
  for (const [id, rec] of Object.entries(r.data)) if (rec && Number.isSafeInteger(rec.pid) && rec.pid > 0 && Number.isFinite(rec.startedAt)) out[id] = rec;
  return out;
}

function writeAll(all) {
  if (!Object.keys(all).length) return require('fs').rmSync(file(), { force: true });
  fsx.writeJsonAtomic(file(), all);
}

// Сведения о процессе от ОС: { start (мс, UTC), cmd, name } | null (процесса нет) | бросает ошибку, если спросить не вышло
async function osProbe(pid) {
  if (process.platform !== 'win32') throw new Error('Проверка процессов поддерживается только в Windows');
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  const script = `[Console]::OutputEncoding=[Text.Encoding]::UTF8; $p=Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}'; if($p){ @{s=[long]([DateTimeOffset]$p.CreationDate).ToUnixTimeMilliseconds();c=[string]$p.CommandLine;n=[string]$p.Name}|ConvertTo-Json -Compress }`;
  const out = await new Promise((resolve, reject) =>
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: PROBE_TIMEOUT_MS, encoding: 'utf8', maxBuffer: 1 << 20 }, (e, stdout) => (e ? reject(e) : resolve(stdout)))
  );
  const text = out.trim();
  if (!text) return null;
  const j = JSON.parse(text);
  return { start: Number(j.s), cmd: String(j.c || ''), name: String(j.n || '') };
}

let probe = osProbe;
const SCAN_CEILING_MS = 3500; // общий потолок проверки всех записей при старте лаунчера
const setProbe = (fn) => { probe = fn || osProbe; }; // для тестов

// Живо ли ещё то, что запускали: true / false / null (проверить не удалось — запись не трогаем)
async function verify(rec) {
  let info;
  try {
    info = await probe(rec.pid);
  } catch {
    return null;
  }
  if (!info) return false;
  // PID переиспользован другим процессом: время запуска не совпало
  if (Number.isFinite(rec.procStart) && Math.abs(info.start - rec.procStart) > 1500) return false;
  // Записи без времени запуска (лаунчер убит в первую секунду): процесс, занявший PID позже, моложе игры, а игра создана
  // не позже начала сессии, поэтому процесс, созданный заметно после неё, игрой быть не может
  if (!Number.isFinite(rec.procStart) && Number.isFinite(info.start) && info.start > rec.startedAt + 2000) return false;
  const inCmd = rec.gameDir && cmdHasDir(info.cmd, rec.gameDir);
  const sameCmd = rec.cmdHash && hash(info.cmd) === rec.cmdHash;
  if (!inCmd && !sameCmd) return false;
  return true;
}

// Игра запущена: запись создаём сразу, время запуска процесса и хэш командной строки дописываем, когда ОС ответит
async function track(id, { pid, javaPath, gameDir, startedAt }) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return;
  const rec = { pid, procStart: null, cmdHash: null, javaPath: javaPath || '', gameDir: gameDir || '', startedAt: startedAt || Date.now() };
  const all = readAll();
  all[id] = rec;
  writeAll(all);
  try {
    const info = await probe(pid);
    if (!info) return;
    const cur = readAll();
    if (!cur[id] || cur[id].pid !== pid) return; // игра успела закрыться
    cur[id] = { ...cur[id], procStart: info.start, cmdHash: hash(info.cmd) };
    writeAll(cur);
  } catch {}
}

function untrack(id) {
  const all = readAll();
  if (!(id in all)) return;
  delete all[id];
  writeAll(all);
}

// При старте лаунчера: { alive: [{ id, rec }], gone: [{ id, rec }] }. Мёртвые записи убираем, непроверенные оставляем
// Записи проверяются параллельно, на всё — общий потолок: не успели или ОС не ответила — запись остаётся (unknown), старт не ждёт
async function scan({ ceilingMs = SCAN_CEILING_MS } = {}) {
  const all = readAll();
  const alive = [];
  const gone = [];
  const unknown = [];
  let timer;
  const ceiling = new Promise((resolve) => { timer = setTimeout(resolve, ceilingMs, null); });
  const results = await Promise.all(Object.entries(all).map(async ([id, rec]) => [id, rec, await Promise.race([verify(rec), ceiling])]));
  clearTimeout(timer);
  for (const [id, rec, v] of results) {
    if (v === true) alive.push({ id, rec });
    else if (v === false) gone.push({ id, rec });
    else unknown.push({ id, rec });
  }
  if (gone.length) {
    const cur = readAll();
    for (const g of gone) delete cur[g.id];
    writeAll(cur);
  }
  return { alive, gone, unknown };
}

const has = () => Object.keys(readAll()).length > 0;

module.exports = { track, untrack, scan, verify, cmdHasDir, has, readAll, setProbe, file };
