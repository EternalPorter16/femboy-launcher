// Лог игры сборки. С тех пор как Java запускается в папке сборки, latest.log и старые логи лежат в <папка сборки>/logs.
// Кнопки «Лог игры» и «Папка логов» (вкладка «Ещё») открывают их: что именно, решает только эта функция, а не окно
const fs = require('fs');
const path = require('path');

const isDir = (p) => fs.statSync(p, { throwIfNoEntry: false })?.isDirectory() === true;
const isFile = (p) => fs.statSync(p, { throwIfNoEntry: false })?.isFile() === true;

// what: 'latest' — файл latest.log, 'folder' — папка logs. Отвечает путём или бросает понятную ошибку
function target(gameDir, what) {
  if (what !== 'latest' && what !== 'folder') throw new Error('Неизвестно, что открыть');
  const dir = path.join(gameDir, 'logs');
  if (what === 'folder') {
    if (!isDir(dir)) throw new Error('Папки логов этой сборки ещё нет: она появится после запуска игры');
    return dir;
  }
  const file = path.join(dir, 'latest.log');
  if (!isFile(file)) throw new Error('Лога этой сборки ещё нет: он появится после запуска игры');
  return file;
}

module.exports = { target };
