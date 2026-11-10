const test = require('node:test');
const assert = require('node:assert/strict');
const { src } = require('./helpers');
const cli = require(src('core/cli'));

test('--launch в разных видах: после пробела, через «=», среди чужих аргументов (в том числе у Electron при разработке)', () => {
  assert.deepEqual(cli.parse(['--launch', 'instance-4c2c54']), { launch: 'instance-4c2c54' });
  assert.deepEqual(cli.parse(['--launch=wz-test-9a6610']), { launch: 'wz-test-9a6610' });
  assert.deepEqual(cli.parse(['C:\\electron.exe', '.', '--no-sandbox', '--launch', 'abc-123', '--remote-debugging-port=9224']), { launch: 'abc-123' });
});

test('мир и сервер берутся только вместе с --launch и проверяются', () => {
  assert.deepEqual(cli.parse(['--launch', 'a1', '--world', 'Новый мир', '--server', 'mc.example.com:25565']), { launch: 'a1', world: 'Новый мир', server: 'mc.example.com:25565' });
  assert.deepEqual(cli.parse(['--world', 'Мир']), null, 'без --launch запускать нечего');
  // имя мира станет путём внутри saves: выход за папку, скрытые и слишком длинные имена отбрасываются
  for (const bad of ['..', '../x', 'a/b', 'a\\b', '.hidden', 'x'.repeat(201)]) assert.equal(cli.parse(['--launch', 'a1', '--world', bad]).world, undefined, bad);
  for (const bad of ['host:port', 'a b', 'x:99999999', 'x:70000', '-x', 'a/b']) assert.equal(cli.parse(['--launch', 'a1', '--server', bad]).server, undefined, bad);
  assert.equal(cli.parse(['--launch', 'a1', '--server', 'play.example.com']).server, 'play.example.com');
});

test('мусор в id — это не запуск', () => {
  for (const bad of ['', '../evil', 'a/b', 'a b', 'x'.repeat(65), '--world']) assert.equal(cli.parse(['--launch', bad]), null, JSON.stringify(bad));
  assert.equal(cli.parse(['--launch']), null);
  assert.equal(cli.parse(['--launch', '--world', 'x']), null, 'следующий флаг значением не считается');
  assert.equal(cli.parse([]), null);
  assert.equal(cli.parse(), null);
});

test('строка аргументов для ярлыка разбирается обратно в тот же id', () => {
  const a = cli.args('instance-4c2c54');
  assert.equal(a, '--launch=instance-4c2c54');
  assert.deepEqual(cli.parse(a.split(' ')), { launch: 'instance-4c2c54' });
  assert.throws(() => cli.args('a b'), /Некорректный id/);
  assert.throws(() => cli.args('x --world=y'), /Некорректный id/, 'через id нельзя протащить чужой флаг');
});

test('так аргументы приходят уже запущенному лаунчеру: флаги переставлены вперёд, значения без «=» оторваны', () => {
  // Chromium собирает argv заново: сначала все флаги, потом остальное. Форма с «=» это переживает, форма с пробелом — нет
  assert.deepEqual(cli.parse(['electron.exe', '--user-data-dir=C:\\x', '--launch=a1', '--world=Мир', '.']), { launch: 'a1', world: 'Мир' });
  assert.equal(cli.parse(['electron.exe', '--launch', '--world', '.', 'a1', 'Мир']), null, 'оторванное значение не угадываем: лучше не запускать, чем запустить не то');
});

test('.mrpack, открытый двойным щелчком: берётся только полный путь к файлу .mrpack, флаги, относительные пути и чужие файлы не годятся', () => {
  const f = String.raw`C:\Users\Bart\Downloads\Мой модпак (1.2).mrpack`;
  assert.equal(cli.pack([String.raw`C:\Program Files\Femboy Launcher\Femboy Launcher.exe`, f]), f);
  assert.equal(cli.pack([f.toUpperCase()]), f.toUpperCase(), 'расширение любого регистра');
  assert.equal(cli.pack(['--launch', 'abc-1', f]), f, 'рядом с другими флагами');
  assert.equal(cli.pack([String.raw`\\server\share\pack.mrpack`]), String.raw`\\server\share\pack.mrpack`);
  const long = String.raw`C:\a` + 'a'.repeat(1000) + '.mrpack';
  for (const bad of [[], ['pack.mrpack'], [String.raw`..\pack.mrpack`], [String.raw`C:\a\pack.zip`], [String.raw`C:\a\pack.mrpack.exe`], [String.raw`--x=C:\a\pack.mrpack`], [long], [5, null]]) assert.equal(cli.pack(bad), null, JSON.stringify(bad).slice(0, 40));
  assert.equal(cli.pack(), null);
});

test('двойной щелчок по .mrpack: установщик привязывает расширение, главный процесс отдаёт окну только имя, импортирует файл, о котором спросили, и ловит второй запуск', () => {
  const fs = require('fs');
  const pkg = JSON.parse(fs.readFileSync(require('path').join(__dirname, '..', 'package.json'), 'utf8'));
  assert.deepEqual(pkg.build.fileAssociations.map((a) => a.ext), ['mrpack'], 'в установщике одна привязка: .mrpack');
  const main = fs.readFileSync(src('main.js'), 'utf8');
  assert.match(main, /let pendingPack = cli\.pack\(process\.argv\);/);
  assert.match(main, /const pack = cli\.pack\(own\) \|\| cli\.pack\(argv\);[\s\S]*?pendingPack = pack;\s*send\('app:importRequest'\);/, 'второй запуск с файлом');
  assert.match(main, /handle\('app:takePack', \(\) => \{[\s\S]*?openedPack = file;\s*return \{ name: path\.basename\(file\) \};/, 'окну уходит только имя');
  assert.match(main, /handle\('instances:importOpened', \(\) => \{[\s\S]*?const file = openedPack;\s*openedPack = null;[\s\S]*?packs\.importPath\(file, p\)/, 'импорт без пути от окна, один раз');
  assert.match(main, /JUMP_CHANNELS = [^\n]*importOpened/, 'после импорта обновляется список переходов');
  const ui = fs.readFileSync(src('renderer/app/import.js'), 'utf8');
  assert.match(ui, /confirm\(`Поставить модпак «\$\{req\.name\}» как новую сборку\?`\)[\s\S]*?call\('instances:importOpened'\)/, 'сначала вопрос, потом импорт');
  assert.match(fs.readFileSync(src('renderer/app/start.js'), 'utf8'), /takePackRequest\(\)/, 'файл, с которым запустили лаунчер');
  const en = require('vm');
  assert.match(fs.readFileSync(src('preload.js'), 'utf8'), /'app:importRequest'/);
  assert.ok(en);
});
