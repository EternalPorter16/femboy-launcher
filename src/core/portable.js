// «Настоящий» portable: у portable-сборки данные (сборки, миры, Java, настройки) лежат в папке data рядом с exe, а не в профиле
// Windows. Флешку или папку можно унести на другой компьютер целиком. Включается, если лаунчер запущен из portable-сборки
// (electron-builder кладёт её папку в PORTABLE_EXECUTABLE_DIR) или рядом с обычным exe лежит файл portable.txt
const fs = require('fs');
const path = require('path');

// Куда класть данные. null — обычный режим (или рядом с программой писать нельзя, например в Program Files или на диске только для чтения).
// oldDataDir: прежнее место данных в профиле Windows. Если там уже есть сборки, а папки data ещё нет, данные не переезжают
// молча (иначе у человека «пропали» бы все сборки): остаёмся на прежнем месте, пока он сам не создаст data и не перенесёт данные
function dataDir({ env = process.env, exeDir, packaged = false, oldDataDir } = {}) {
  const base = env.PORTABLE_EXECUTABLE_DIR || (packaged && exeDir && fs.existsSync(path.join(exeDir, 'portable.txt')) ? exeDir : null);
  if (!base) return null;
  const dir = path.join(base, 'data');
  if (oldDataDir && fs.existsSync(path.join(oldDataDir, 'launcher.json')) && !fs.existsSync(dir)) return null;
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.write-test-${process.pid}`);
    fs.writeFileSync(probe, '');
    fs.rmSync(probe);
    return dir;
  } catch {
    return null;
  }
}

module.exports = { dataDir };
