// Запись файлов «целиком или никак»: сначала во временный файл рядом, потом он подменяет настоящий. Если питание пропадёт
// или лаунчер вылетит посреди записи, останется либо старый файл, либо новый — а не обрезок, который уже не прочитать
const fs = require('fs');
const path = require('path');

const waitMs = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function renameRetry(from, to) {
  for (let i = 0; ; i++) {
    try {
      return fs.renameSync(from, to);
    } catch (e) {
      // Windows не даёт заменить файл, который в этот миг читает антивирус или проводник: ждём и пробуем ещё (всего около секунды)
      if (i >= 9 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e;
      waitMs(25 * (i + 1));
    }
  }
}

function writeFileAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, data);
    renameRetry(tmp, file);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}

const writeJsonAtomic = (file, obj, pretty = true) => writeFileAtomic(file, JSON.stringify(obj, null, pretty ? 2 : 0));

// Читает JSON-файл: { ok, data, exists }. На время чтения файл может быть занят — пробуем несколько раз
function readJson(file) {
  let error = null;
  for (let i = 0; i < 4; i++) {
    try {
      return { ok: true, data: JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')), exists: true };
    } catch (e) {
      error = e;
      if (e.code === 'ENOENT') return { ok: false, exists: false };
      if (e.code !== 'EBUSY' && e.code !== 'EPERM' && e.code !== 'EACCES') break; // испорченный JSON ждать бессмысленно
      waitMs(40 * (i + 1));
    }
  }
  return { ok: false, exists: true, error };
}

// Читает JSON; если файл испорчен — берёт его копию «.bak». source: 'file' | 'backup' | null
function readJsonOrBackup(file) {
  const main = readJson(file);
  if (main.ok) return { data: main.data, source: 'file' };
  const bak = readJson(file + '.bak');
  return bak.ok ? { data: bak.data, source: 'backup' } : { data: null, source: null };
}

// Файл с несколькими именами (общий мод в разных сборках, точка восстановления) нельзя перезаписывать на месте: изменились бы все имена.
// Перед записью поверх убираем имя, и новый файл получается отдельным
function breakLink(file) {
  try {
    if (fs.statSync(file).nlink > 1) fs.rmSync(file, { force: true });
  } catch {}
}

module.exports = { breakLink, writeFileAtomic, writeJsonAtomic, readJson, readJsonOrBackup, renameRetry };
