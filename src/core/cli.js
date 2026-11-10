// Аргументы командной строки лаунчера. Так работает ярлык сборки на рабочем столе, и так же сборку можно запустить из любого
// скрипта: «Femboy Launcher.exe --launch <id сборки> [--world <папка мира>] [--server <адрес>]»
const path = require('path');

// Значение флага: «--name значение» или «--name=значение». Следующий флаг значением не считается
function take(argv, name) {
  for (let i = 0; i < argv.length; i++) {
    const a = String(argv[i]);
    if (a === `--${name}`) {
      const next = argv[i + 1];
      return next !== undefined && !String(next).startsWith('--') ? String(next) : undefined;
    }
    if (a.startsWith(`--${name}=`)) return a.slice(name.length + 3);
  }
  return undefined;
}

// → { launch, world?, server? } или null, если просят не запуск сборки. Всё, что пришло извне, проверяем: аргументы может
// подсунуть кто угодно, а id и мир потом превращаются в пути на диске
function parse(argv = []) {
  const launch = take(argv, 'launch');
  if (!launch || !/^[\w-]{1,64}$/.test(launch)) return null;
  const out = { launch };
  const world = take(argv, 'world');
  if (world && world.length <= 200 && path.basename(world) === world && !world.startsWith('.')) out.world = world;
  const server = take(argv, 'server');
  const m = server && /^[A-Za-z0-9][\w.-]{0,252}(?::(\d{1,5}))?$/.exec(server);
  if (m && (!m[1] || +m[1] <= 65535)) out.server = server;
  return out;
}

// Модпак, который открыли двойным щелчком: Windows передаёт путь к файлу обычным аргументом. Берём только полный путь к .mrpack
// (не флаг, не относительный путь, не гигантскую строку); сам файл проверяет импорт
function pack(argv = []) {
  for (const a of argv) {
    const s = String(a);
    if (s.length <= 1000 && !s.startsWith('--') && path.isAbsolute(s) && /\.mrpack$/i.test(s)) return s;
  }
  return null;
}

// Строка аргументов для ярлыка: id сборки уже проверен при создании сборки, но на всякий случай пропускаем через parse.
// Форма с «=» выбрана намеренно: Chromium при передаче аргументов уже запущенному лаунчеру разрывает «--launch id» на два куска
function args(instId) {
  if (!parse([`--launch=${instId}`])) throw new Error('Некорректный id сборки');
  return `--launch=${instId}`;
}

module.exports = { parse, args, pack };
