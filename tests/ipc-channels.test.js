// Каналы между окном и главным процессом: опечатка в названии или забытая запись в preload.js не падает громко, а молча отключает
// возможность (api.on пропускает неизвестные события, а вызов несуществующего обработчика рвётся только при нажатии). Названия берутся из самих файлов
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { src } = require('./helpers');

const read = (rel) => fs.readFileSync(src(rel), 'utf8');
const all = (text, re) => [...text.matchAll(re)].map((m) => m[1]);
const rendererFiles = () => [
  'renderer/bisect.js',
  'renderer/palette.js',
  ...fs.readdirSync(path.dirname(src('renderer/app/core.js'))).filter((f) => f.endsWith('.js')).map((f) => `renderer/app/${f}`),
];
const rendererText = () => rendererFiles().map(read).join('\n');

const preload = read('preload.js');
const EVENTS = new Function(`return ${/const EVENTS = (\[[^\]]*\]);/.exec(preload)[1]}`)();
const INVOKE = new Function(`return ${/const INVOKE = (\/.+\/);/.exec(preload)[1]}`)();
const main = read('main.js');
const handled = new Set(all(main, /\bhandle\('([a-z]+:[A-Za-z]+)'/g));

test('каналы вызовов: каждый обработчик главного процесса пропускает preload.js', () => {
  assert.ok(handled.size > 100, `обработчиков найдено слишком мало: ${handled.size}`);
  const bad = [...handled].filter((c) => !INVOKE.test(c));
  assert.deepEqual(bad, [], 'preload.js отвергнет эти каналы: «Неизвестный канал»');
});

test('каналы вызовов: всё, что окно вызывает по имени, есть в главном процессе', () => {
  const called = new Set(all(rendererText(), /\bcall\(\s*'([a-z]+:[A-Za-z]+)'/g));
  assert.ok(called.size > 100, `вызовов найдено слишком мало: ${called.size}`);
  const missing = [...called].filter((c) => !handled.has(c));
  assert.deepEqual(missing, [], 'окно вызывает то, чего в главном процессе нет');
});

test('события: окно подписывается только на то, что разрешает preload.js (иначе подписка молча не работает)', () => {
  const subscribed = [...new Set(all(rendererText(), /\bapi\.on\(\s*'([a-z]+:[A-Za-z]+)'/g))];
  assert.ok(subscribed.length >= 8, `подписок найдено слишком мало: ${subscribed.length}`);
  assert.deepEqual(subscribed.filter((c) => !EVENTS.includes(c)), []);
});

test('события: всё, что главный процесс посылает окну, разрешено в preload.js и кем-то слушается', () => {
  const sent = [...new Set(all(main, /\bsend\('([a-z]+:[A-Za-z]+)'/g))];
  assert.ok(sent.length >= 8, `посылок найдено слишком мало: ${sent.length}`);
  assert.deepEqual(sent.filter((c) => !EVENTS.includes(c)), [], 'окно такое событие не получит');
  const heard = new Set(all(rendererText(), /\bapi\.on\(\s*'([a-z]+:[A-Za-z]+)'/g));
  assert.deepEqual(sent.filter((c) => !heard.has(c)), [], 'такое событие никто в окне не слушает');
  assert.deepEqual(EVENTS.filter((c) => !sent.includes(c)), [], 'в preload.js разрешено событие, которое главный процесс не посылает');
});
