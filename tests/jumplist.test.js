// Список переходов на значке лаунчера в панели задач (core/jumplist.js): правый щелчок по значку — последние сборки, запуск одним щелчком
// («Femboy Launcher.exe --launch=<id>», то же делает ярлык сборки). Окно, Windows и часы подменены
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { src } = require('./helpers');
const jumplist = require('../src/core/jumplist');

const EXE = 'C:\\Program Files\\Femboy Launcher\\Femboy Launcher.exe';
const inst = (id, name, extra = {}) => ({ id, name, version: '1.21.1', loader: 'fabric', ...extra });
const items = (cats) => cats?.[0]?.items || [];

test('список: одна категория «Недавние сборки», у каждой сборки — ссылка с запуском именно её, названием, версией и значком программы', () => {
  const cats = jumplist.build([inst('instance-a1', 'Уютное выживание', { lastPlayed: 100 })], { exe: EXE });
  assert.equal(cats.length, 1);
  assert.deepEqual([cats[0].type, cats[0].name], ['custom', 'Недавние сборки']);
  assert.deepEqual(items(cats), [{ type: 'task', program: EXE, args: '--launch=instance-a1', iconPath: EXE, iconIndex: 0, title: 'Уютное выживание', description: '1.21.1 · Fabric' }]);
  const en = jumplist.build([inst('b', 'Pack', { loader: 'vanilla' })], { exe: EXE, lang: 'en' });
  assert.equal(en[0].name, 'Recent instances');
  assert.equal(items(en)[0].description, '1.21.1 · Vanilla');
  assert.equal(items(jumplist.build([inst('c', 'Пак', { loader: 'vanilla' })], { exe: EXE }))[0].description, '1.21.1 · Ванилла');
  for (const [loader, label] of [['quilt', 'Quilt'], ['forge', 'Forge'], ['neoforge', 'NeoForge'], ['неведомый', 'неведомый']]) assert.equal(items(jumplist.build([inst('d', 'Пак', { loader })], { exe: EXE }))[0].description, `1.21.1 · ${label}`);
});

test('порядок и число: сначала игравшие недавно, потом не игравшие по названию; не больше шести', () => {
  const list = [inst('s1', 'Яблоко'), inst('s2', 'Арбуз'), inst('s3', 'Груша', { lastPlayed: 50 }), inst('s4', 'Вишня', { lastPlayed: 300 }), inst('s5', 'Дыня', { lastPlayed: 200 }), inst('s6', 'Ежевика'), inst('s7', 'Жимолость'), inst('s8', 'Земляника')];
  const titles = items(jumplist.build(list, { exe: EXE })).map((i) => i.title);
  assert.deepEqual(titles, ['Вишня', 'Дыня', 'Груша', 'Арбуз', 'Ежевика', 'Жимолость'], 'шесть: три игравших по времени, три остальных по алфавиту');
  assert.equal(items(jumplist.build(list, { exe: EXE, max: 2 })).length, 2);
  assert.deepEqual(items(jumplist.build([inst('x1', 'Б'), inst('x2', 'А')], { exe: EXE })).map((i) => i.title), ['А', 'Б']);
  assert.deepEqual(list.map((i) => i.id), ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'], 'исходный список не переставляется');
});

test('мусор в данных: плохой id в список не попадает, непечатные знаки и длина в названии укрощаются, пустое имя — «Сборка»; нет сборок — списка нет', () => {
  const cats = jumplist.build([inst('ok-1', 'Хорошая'), inst('плохой id', 'Плохая'), inst('', 'Пустая'), inst('a;b', 'Хитрая'), inst('../x', 'Путь'), inst('ok-2', '  \u0007Звонок\n\tвнутри  '), inst('ok-3', 'Д'.repeat(200)), inst('ok-4', '   ')], { exe: EXE });
  const by = Object.fromEntries(items(cats).map((i) => [i.args, i.title]));
  assert.deepEqual(Object.keys(by).sort(), ['--launch=ok-1', '--launch=ok-2', '--launch=ok-3', '--launch=ok-4']);
  assert.equal(by['--launch=ok-2'], 'Звонок внутри', 'знаки управления и повторы становятся одним пробелом');
  assert.equal(by['--launch=ok-3'].length, 60);
  assert.equal(by['--launch=ok-4'], 'Сборка', 'пустое название заменено');
  assert.deepEqual(items(cats).map((i) => i.title), ['Д'.repeat(60), 'Звонок внутри', 'Сборка', 'Хорошая'], 'без времени запуска — по названию, каким оно видно в меню');
  assert.equal(jumplist.build([], { exe: EXE }), null, 'без сборок список сбрасывается, а не остаётся пустой категорией');
  assert.equal(jumplist.build([inst('a b', 'x')], { exe: EXE }), null);
  assert.equal(jumplist.build(null, { exe: EXE }), null);
  assert.equal(jumplist.build([inst('ok', 'x')], {}), null, 'без пути к программе строить нечего');
});

test('включается только в установленной или portable-версии на Windows: при разработке и в проверках список переходов настоящей программы не трогаем', () => {
  assert.equal(jumplist.enabled({ platform: 'win32', packaged: true, portable: false }), true);
  assert.equal(jumplist.enabled({ platform: 'win32', packaged: false, portable: true }), true);
  assert.equal(jumplist.enabled({ platform: 'win32', packaged: false, portable: false }), false, 'запуск из исходников (npm start, проверки интерфейса)');
  assert.equal(jumplist.enabled({ platform: 'linux', packaged: true, portable: false }), false);
  assert.equal(jumplist.enabled({ platform: 'darwin', packaged: true, portable: true }), false);
  assert.equal(jumplist.enabled({}), false);
});

test('если Windows не пускает свою категорию (выключены «недавние элементы»), те же ссылки идут обычными «Задачами»', () => {
  const cats = jumplist.build([inst('a1', 'Первая', { lastPlayed: 2 }), inst('b2', 'Вторая', { lastPlayed: 1 })], { exe: EXE });
  const tasks = jumplist.asTasks(cats);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].type, 'tasks');
  assert.equal(tasks[0].name, undefined, 'у «Задач» своего названия нет');
  assert.deepEqual(tasks[0].items, cats[0].items, 'ссылки те же');
  assert.equal(jumplist.asTasks(null), null);
  assert.equal(jumplist.asTasks([]), null);
  assert.equal(jumplist.asTasks('мусор'), null);
});

function schedulerWorld(t, { results = [] } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const applied = [];
  const log = [];
  const gets = { n: 0 };
  let list = [inst('a', 'Первая', { lastPlayed: 1 })];
  const sch = jumplist.scheduler({
    get: () => (gets.n++, jumplist.build(list, { exe: EXE })),
    apply: (cats) => {
      applied.push(cats);
      return results.shift() ?? 'ok';
    },
    onResult: (r) => log.push(r),
  });
  return { sch, applied, log, gets, set: (l) => (list = l) };
}

test('расписание: несколько просьб подряд — одно обновление через пару секунд; ничего не изменилось — второй раз не обновляем', (t) => {
  const w = schedulerWorld(t);
  w.sch.schedule();
  w.sch.schedule();
  w.sch.schedule();
  t.mock.timers.tick(1999);
  assert.equal(w.applied.length, 0, 'раньше срока ничего');
  t.mock.timers.tick(1);
  assert.equal(w.applied.length, 1);
  assert.equal(w.gets.n, 1, 'список читается с диска один раз, а не по разу на каждую просьбу');
  assert.deepEqual(w.log, ['ok']);
  w.sch.schedule();
  t.mock.timers.tick(5000);
  assert.equal(w.applied.length, 1, 'те же сборки — Windows лишний раз не дёргаем');
  w.set([inst('a', 'Первая', { lastPlayed: 1 }), inst('b', 'Вторая', { lastPlayed: 2 })]);
  w.sch.schedule();
  t.mock.timers.tick(2000);
  assert.equal(w.applied.length, 2);
  assert.equal(items(w.applied[1])[0].title, 'Вторая');
  w.set([]);
  w.sch.schedule();
  t.mock.timers.tick(2000);
  assert.equal(w.applied.at(-1), null, 'сборок не осталось — список сбрасывается');
});

test('расписание: отказ Windows (например, выключены «недавние элементы») и сбой не ломают лаунчер, а неудачный список не запоминается: в следующий раз пробуем снова', (t) => {
  const w = schedulerWorld(t, { results: ['customCategoryAccessDeniedError'] });
  w.sch.schedule();
  t.mock.timers.tick(2000);
  assert.deepEqual(w.log, ['customCategoryAccessDeniedError']);
  w.sch.schedule();
  t.mock.timers.tick(2000);
  assert.equal(w.applied.length, 2, 'отказ не считается «уже обновили»');
  assert.deepEqual(w.log, ['customCategoryAccessDeniedError', 'ok']);
  const boom = jumplist.scheduler({ get: () => { throw new Error('диск'); }, apply: () => 'ok' });
  boom.schedule();
  assert.doesNotThrow(() => t.mock.timers.tick(2000));
  const boom2 = jumplist.scheduler({ get: () => jumplist.build([inst('a', 'x')], { exe: EXE }), apply: () => { throw new Error('Windows'); } });
  boom2.schedule();
  assert.doesNotThrow(() => t.mock.timers.tick(2000));
});

test('расписание: stop() отменяет ожидающее обновление', (t) => {
  const w = schedulerWorld(t);
  w.sch.schedule();
  w.sch.stop();
  t.mock.timers.tick(10000);
  assert.equal(w.applied.length, 0);
});

test('главный процесс: включается по условию, обновляется при изменении сборок, после игры и при старте; запуск берёт ту же программу, что и ярлык', () => {
  const main = fs.readFileSync(src('main.js'), 'utf8');
  assert.match(main, /jumplist\.enabled\(\{ platform: process\.platform, packaged: app\.isPackaged, portable: !!process\.env\.PORTABLE_EXECUTABLE_FILE \}\)/, 'условие включения');
  assert.match(main, /exe: process\.env\.PORTABLE_EXECUTABLE_FILE \|\| process\.execPath/, 'у portable настоящий exe лежит там, где его оставили');
  assert.match(main, /const r = app\.setJumpList\(cats\);\s*return r === 'customCategoryAccessDeniedError' \? app\.setJumpList\(jumplist\.asTasks\(cats\)\) : r;/, 'запасной путь через «Задачи»');
  assert.match(main, /JUMP_CHANNELS\.test\(channel\)\) jumps\.schedule\(\)/, 'после изменений сборок');
  assert.match(main, /closed: \(code, crash\) => \{[\s\S]*?jumps\.schedule\(\)/, 'после игры время последнего запуска стало другим');
  assert.match(main, /jumps\.schedule\(\);\s*\/\/ при старте/, 'при старте');
});
