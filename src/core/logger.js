// Лог лаунчера на диске: <папка данных>/logs/launcher.log. Нужен, чтобы ошибки главного процесса, сбои синхронизации и ход
// запуска не пропадали при перезапуске, а отчёт для поддержки видел не только текущий сеанс. Строки игры сюда не идут
// (у игры свой latest.log). Всё проходит через очистку от токенов и имени пользователя Windows
const fs = require('fs');
const path = require('path');
const scrub = require('./scrub');

const MAX_BYTES = 2 * 1024 * 1024;
const KEEP = 3; // launcher.log и два предыдущих
const BUFFER_MAX = 200;
let file = null;
let writes = 0;
let buffer = []; // записи до init (например, ошибка при самом старте) ждут, пока появится папка данных

const pad = (n, w = 2) => String(n).padStart(w, '0');
function stamp(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

const nth = (i) => (i === 0 ? file : file.replace(/\.log$/, `.${i}.log`));

// Когда файл вырос, он становится launcher.1.log, прежний launcher.1.log — launcher.2.log, самый старый удаляется
function rotate() {
  try {
    if (!file || fs.statSync(file).size < MAX_BYTES) return;
    fs.rmSync(nth(KEEP - 1), { force: true });
    for (let i = KEEP - 2; i >= 0; i--) if (fs.existsSync(nth(i))) fs.renameSync(nth(i), nth(i + 1));
  } catch {}
}

function text(p) {
  if (p instanceof Error) return p.stack || p.message;
  if (typeof p === 'string') return p;
  try {
    return JSON.stringify(p) ?? String(p);
  } catch {
    return String(p);
  }
}

function line(level, parts, at = new Date()) {
  const body = scrub.text(parts.map(text).join(' ')).replace(/\r?\n/g, '\n    ');
  return `${stamp(at)} [${level}] ${body}\n`;
}

function append(s) {
  try {
    fs.appendFileSync(file, s);
    if (++writes % 200 === 0) rotate();
  } catch {} // диск полон или папка недоступна: лог — не повод ронять лаунчер
}

function write(level, ...parts) {
  const s = line(level, parts);
  if (file) return append(s);
  if (buffer.length < BUFFER_MAX) buffer.push(s);
}

// Папка для логов; возвращает путь к launcher.log (или null, если писать некуда)
function init(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    file = path.join(dir, 'launcher.log');
    rotate();
    for (const s of buffer) append(s);
  } catch {
    file = null;
  }
  buffer = [];
  return file;
}

// Последние строки лога (для отчёта для поддержки): читаем конец файла, а не весь
function tail(lines = 3000) {
  if (!file) return null;
  try {
    const size = fs.statSync(file).size;
    const take = Math.min(size, 1024 * 1024);
    const buf = Buffer.alloc(take);
    const fd = fs.openSync(file, 'r');
    try {
      fs.readSync(fd, buf, 0, take, size - take);
    } finally {
      fs.closeSync(fd);
    }
    let t = buf.toString('utf8');
    if (size > take) t = t.slice(t.indexOf('\n') + 1);
    const all = t.replace(/\r?\n$/, '').split(/\r?\n/);
    return (all.length > lines ? all.slice(-lines) : all).join('\n');
  } catch {
    return null;
  }
}

module.exports = {
  init,
  tail,
  file: () => file,
  info: (...p) => write('INFO', ...p),
  warn: (...p) => write('WARN', ...p),
  error: (...p) => write('ERROR', ...p),
  MAX_BYTES,
  KEEP,
};
