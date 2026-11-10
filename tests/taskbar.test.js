// Полоска прогресса на значке лаунчера в панели задач (core/taskbar.js): загрузки и подготовка к запуску видны, даже когда окно свёрнуто.
// Окно подменено записью вызовов apply(value, mode); сам ход загрузки здесь не нужен
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { src } = require('./helpers');
const taskbar = require('../src/core/taskbar');

function setup() {
  const calls = [];
  const bar = taskbar.create({ apply: (value, mode) => calls.push([value, mode]) });
  return { bar, calls, last: () => calls.at(-1) };
}
const CLEAR = [-1, 'none'];

test('загрузка с процентами: полоска растёт и по окончании пропадает', () => {
  const { bar, calls, last } = setup();
  bar.task(0);
  assert.deepEqual(last(), [0, 'normal']);
  bar.task(40);
  assert.deepEqual(last(), [0.4, 'normal']);
  bar.task(100);
  assert.deepEqual(last(), [1, 'normal']);
  bar.taskEnd();
  assert.deepEqual(last(), CLEAR);
  assert.equal(calls.length, 4);
});

test('проценты без числа (статус «Проверяю файлы…») — бегущая полоска; потом число — обычная', () => {
  const { bar, last } = setup();
  bar.launch('a', null);
  assert.deepEqual(last(), [1, 'indeterminate']);
  bar.launch('a', undefined);
  bar.launch('a', 'сорок');
  assert.deepEqual(last(), [1, 'indeterminate']);
  bar.launch('a', 30);
  assert.deepEqual(last(), [0.3, 'normal']);
  bar.launchEnd('a');
  assert.deepEqual(last(), CLEAR);
});

test('проценты за пределами и мусор не ломают полоску: меньше нуля — ноль, больше ста — сто, не число — бегущая', () => {
  const { bar, last } = setup();
  bar.task(-5);
  assert.deepEqual(last(), [0, 'normal']);
  bar.task(150);
  assert.deepEqual(last(), [1, 'normal']);
  bar.task(NaN);
  assert.deepEqual(last(), [1, 'indeterminate']);
  bar.task(Infinity);
  assert.deepEqual(last(), [1, 'indeterminate']);
  bar.task(50.4);
  assert.deepEqual(last(), [0.5, 'normal'], 'дробные проценты округляются до целого');
  bar.task(49.6);
  assert.deepEqual(last(), [0.5, 'normal'], 'и вверх тоже: 49,6 — это 50, а не 49');
  bar.task(0.4);
  assert.deepEqual(last(), [0, 'normal']);
});

test('apply не сработал (окно ещё не готово): это состояние не считается показанным, и следующее событие пробует снова', () => {
  let fail = true;
  const seen = [];
  const bar = taskbar.create({ apply: (v, m) => { seen.push([v, m]); if (fail) throw new Error('нет окна'); } });
  bar.task(10);
  fail = false;
  bar.task(10);
  bar.task(10);
  assert.deepEqual(seen, [[0.1, 'normal'], [0.1, 'normal']], 'первая попытка не удалась, вторая прошла, третья уже лишняя');
});

test('одинаковое состояние второй раз не отправляется: загрузка шлёт события часто, а значок перерисовывать так часто незачем', () => {
  const { bar, calls } = setup();
  bar.task(10);
  bar.task(10);
  bar.task(10.2);
  bar.task(10.4);
  assert.equal(calls.length, 1);
  bar.task(11);
  assert.equal(calls.length, 2);
  bar.taskEnd();
  bar.taskEnd();
  assert.equal(calls.length, 3, 'повторное «конец» ничего не шлёт');
});

test('два дела сразу: показывается то, что обновилось последним; когда оно кончилось — второе, пока оба не кончатся', () => {
  const { bar, last } = setup();
  bar.launch('a', 20);
  bar.task(70);
  assert.deepEqual(last(), [0.7, 'normal']);
  bar.launch('a', 25);
  assert.deepEqual(last(), [0.25, 'normal'], 'последним обновилась подготовка запуска');
  bar.launchEnd('a');
  assert.deepEqual(last(), [0.7, 'normal'], 'осталась загрузка');
  bar.taskEnd();
  assert.deepEqual(last(), CLEAR);
});

test('две сборки готовятся одновременно: каждая со своим процентом, конец одной не гасит другую; чужой и повторный конец ничего не ломают', () => {
  const { bar, last, calls } = setup();
  bar.launch('a', 10);
  bar.launch('b', 60);
  assert.deepEqual(last(), [0.6, 'normal']);
  bar.launchEnd('b');
  assert.deepEqual(last(), [0.1, 'normal']);
  const n = calls.length;
  bar.launchEnd('b');
  bar.launchEnd('нет-такой');
  assert.equal(calls.length, n);
  bar.launchEnd('a');
  assert.deepEqual(last(), CLEAR);
});

test('начало игры (или отмена) гасит полоску, даже если последнего «100%» не было', () => {
  const { bar, last } = setup();
  bar.launch('a', 80);
  bar.launchEnd('a');
  assert.deepEqual(last(), CLEAR);
  bar.task(30);
  bar.clear();
  assert.deepEqual(last(), CLEAR, 'clear() гасит всё сразу (закрывается окно, выход)');
  bar.launchEnd('a');
  bar.taskEnd();
});

test('окно уже закрыто и apply падает: полоска молчит, а загрузка идёт дальше', () => {
  let boom = true;
  const bar = taskbar.create({ apply: () => { if (boom) throw new Error('Object has been destroyed'); } });
  assert.doesNotThrow(() => (bar.task(10), bar.launch('a', null), bar.launchEnd('a'), bar.taskEnd(), bar.clear()));
  boom = false;
  const seen = [];
  const again = taskbar.create({ apply: (v, m) => seen.push([v, m]) });
  again.task(5);
  assert.deepEqual(seen, [[0.05, 'normal']]);
});

test('главный процесс: события загрузки и запуска идут и в окно, и на значок, а конец подготовки и закрытие окна гасят полоску', () => {
  const main = fs.readFileSync(src('main.js'), 'utf8');
  assert.match(main, /const taskProgress = \(label, percent\) => \{[\s\S]*?send\('task:progress', \{ label, percent \}\)[\s\S]*?taskbar\.task\(/, 'общие задачи');
  assert.match(main, /taskProgress\(null, null\)/, 'конец задачи сообщается как «нет ни подписи, ни процента»');
  assert.match(main, /if \(label === null && percent === null\) taskbar\.taskEnd\(\);/, 'а на значке это конец полоски');
  assert.match(main, /const launchProgress = \(id, label, percent\) => \{\s*send\('game:progress', \{ id, label, percent \}\);\s*taskbar\.launch\(id, percent\);/, 'подготовка к запуску: и окну, и значку');
  assert.match(main, /progress: \(label, percent\) => launchProgress\(id, label, percent\)/, 'проценты подготовки к запуску');
  assert.match(main, /status: \(label\) => \{\s*launchProgress\(id, label, null\)/, 'статусы подготовки к запуску');
  assert.match(main, /launches\.delete\(id\);\s*taskbar\.launchEnd\(id\);/, 'конец подготовки гасит полоску при любом исходе');
  assert.match(main, /started: \(\) => \{\s*taskbar\.launchEnd\(id\);/, 'игра пошла — полоска гаснет сразу, а не когда игра закроется (задача запуска может жить до выхода из игры)');
  assert.match(main, /\.create\(\{ apply: \(value, mode\) => win && !win\.isDestroyed\(\) && win\.setProgressBar\(value, \{ mode \}\) \}\)/, 'настоящее окно');
});
