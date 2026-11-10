// Ярлык сборки на рабочем столе: клик по нему запускает именно эту сборку («Femboy Launcher.exe --launch <id>»)
const { app, shell } = require('electron');
const path = require('path');
const cli = require('./cli');

// Имя файла из названия сборки: без символов, которые Windows не терпит в именах, и без точек и пробелов в конце
const safeName = (s) => String(s || 'Сборка').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/[. ]+$/, '').slice(0, 80) || 'Сборка';
const quote = (s) => `"${String(s).replace(/"/g, '')}"`;

// Что запускать. У portable-версии программа распаковывается во временную папку, а настоящий exe лежит там, где его оставили
function target() {
  const portable = process.env.PORTABLE_EXECUTABLE_FILE;
  const exe = portable || process.execPath;
  // При разработке (npm start) запускается electron.exe, ему нужна ещё и папка приложения
  return { exe, lead: app.isPackaged || portable ? '' : `${quote(app.getAppPath())} ` };
}

// К имени добавлено «Femboy Launcher»: так ярлык не затрёт чужой с тем же названием (например, от другого лаунчера)
function create(inst, { dir = app.getPath('desktop') } = {}) {
  const { exe, lead } = target();
  const file = path.join(dir, `${safeName(inst.name)} - Femboy Launcher.lnk`);
  const ok = shell.writeShortcutLink(file, 'create', { target: exe, args: lead + cli.args(inst.id), cwd: path.dirname(exe), description: `Femboy Launcher: ${inst.name}`, icon: exe, iconIndex: 0 });
  if (!ok) throw new Error('Не получилось создать ярлык на рабочем столе');
  return { file };
}

module.exports = { create, safeName };
