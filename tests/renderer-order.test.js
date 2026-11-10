// Порядок файлов интерфейса. src/renderer/app/*.js — один скрипт, разрезанный по темам: у файлов общая область видимости,
// а порядок подключения задаёт index.html. Ошибка порядка видна только в самом окне (ReferenceError при старте, и лаунчер
// остаётся без интерфейса), поэтому ловим её здесь: список в index.html, повторы имён и пробный запуск файлов по порядку.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { src } = require('./helpers');

const RENDERER = src('renderer');
const read = (rel) => fs.readFileSync(path.join(RENDERER, rel), 'utf8');
const scripts = [...read('index.html').matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
const appScripts = scripts.filter((s) => s.startsWith('app/'));
const ownScripts = scripts.filter((s) => !s.startsWith('..')); // без чужого бандла из node_modules
// Верхнеуровневые объявления: в этих файлах вложенный код сдвинут, а верхний начинается с первого столбца
const topNames = (code) => [...code.matchAll(/^(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)|^(?:const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1] || m[2]);

test('index.html подключает каждый файл из app/ один раз: core первым, start последним, bisect.js до них, palette.js после', () => {
  const onDisk = fs.readdirSync(path.join(RENDERER, 'app')).filter((f) => f.endsWith('.js')).sort();
  assert.deepEqual(appScripts.map((s) => s.slice(4)).sort(), onDisk, 'файлы в папке app/ и скрипты app/ в index.html должны совпадать');
  assert.equal(new Set(scripts).size, scripts.length, 'какой-то скрипт подключён дважды');
  assert.equal(appScripts[0], 'app/core.js', 'core.js — основа, его ждут все остальные');
  assert.equal(appScripts.at(-1), 'app/start.js', 'start.js запускает интерфейс и должен идти после всего');
  const [first, last] = [scripts.indexOf(appScripts[0]), scripts.indexOf(appScripts.at(-1))];
  assert.ok(scripts.indexOf('bisect.js') >= 0 && scripts.indexOf('bisect.js') < first, 'bisect.js подключается до app/: файлы app/ обращаются к Bisect из своих обработчиков');
  assert.ok(scripts.indexOf('palette.js') > last, 'palette.js подключается после app/: он пользуется их функциями');
});

test('одно имя на верхнем уровне не объявляется дважды ни в одном из скриптов интерфейса', () => {
  const where = new Map();
  for (const rel of ownScripts) for (const name of topNames(read(rel))) where.set(name, [...(where.get(name) || []), rel]);
  const dups = [...where].filter(([, files]) => files.length > 1).map(([name, files]) => `${name} — ${files.join(', ')}`);
  assert.equal(dups.length, 0, `Повторное объявление: у const/let это ошибка при загрузке, а у функции молча побеждает последняя:\n  ${dups.join('\n  ')}`);
});

// «Что угодно»: заглушку можно вызвать, прочитать, присвоить, перебрать и превратить в строку. Этого хватает, чтобы код
// интерфейса при загрузке дошёл до конца без настоящего окна
function anything() {
  const target = function () {
    'use strict';
  };
  return new Proxy(target, {
    get(_t, key) {
      if (key === Symbol.toPrimitive) return () => '';
      if (key === Symbol.iterator) return function* () {};
      if (key === 'then') return undefined; // не промис: await не зависнет
      if (key === 'length') return 0;
      return anything();
    },
    set: () => true,
    apply: () => anything(),
    construct: () => anything(),
  });
}

// Окно «как в браузере», только пустое. Объекты из скриптов, подключённых до app/ (Calm, Sounds…), тоже заглушки.
// log собирает, на что подписался интерфейс и что спросил у главного процесса
function emptyWindow(log) {
  const noop = () => {};
  const env = {
    console: { log: noop, info: noop, warn: noop, error: noop, debug: noop },
    document: anything(),
    window: anything(),
    navigator: anything(),
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop }),
    getComputedStyle: () => anything(),
    setTimeout: () => 0,
    setInterval: () => 0,
    clearTimeout: noop,
    clearInterval: noop,
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: noop,
    performance: { now: () => 0 },
    api: { on: (channel) => log.on.push(channel), invoke: (channel) => (log.invoke.push(channel), new Promise(() => {})), pathForFile: () => '' }, // то, что отдаёт preload.js
    skinview3d: anything(),
  };
  for (const rel of ownScripts.slice(0, ownScripts.indexOf(appScripts[0]))) for (const name of topNames(read(rel))) env[name] ??= anything();
  return vm.createContext(env);
}

test('файлы app/ запускаются по порядку без ошибок: при загрузке никто не зовёт то, что объявлено в файле ниже', async () => {
  const log = { on: [], invoke: [] };
  const ctx = emptyWindow(log);
  const problems = [];
  const onRejection = (e) => problems.push(`промис отклонён при загрузке: ${e?.message || e}`);
  process.on('unhandledRejection', onRejection);
  try {
    for (const rel of appScripts) {
      try {
        new vm.Script(read(rel), { filename: rel }).runInContext(ctx, { timeout: 5000 });
      } catch (e) {
        const at = String(e.stack || '').split('\n').find((l) => l.includes(rel));
        problems.push(`${rel}: ${e.name}: ${e.message}${at ? ` (${at.trim()})` : ''}`);
        break; // файл не дошёл до конца, и все следующие ошибки были бы лишь следствием этой
      }
    }
    await new Promise((r) => setImmediate(r)); // ошибки в промисах всплывают чуть позже
  } finally {
    process.off('unhandledRejection', onRejection);
  }
  // Страховка от «зелёно, потому что ничего не выполнилось»: подписки из ранних и поздних файлов и стартовая цепочка в конце start.js
  if (!problems.length) {
    for (const channel of ['net:state', 'game:state', 'update:status', 'app:launchRequest']) if (!log.on.includes(channel)) problems.push(`запуск не дошёл до подписки на «${channel}»`);
    if (!log.invoke.length) problems.push('стартовая цепочка в конце start.js не дошла до первого обращения к главному процессу');
  }
  assert.equal(
    problems.length,
    0,
    `Файлы app/ запущены по порядку из index.html, как это делает окно. Ошибка (остальные были бы её следствием):\n  ${problems.join('\n  ')}\n` +
      '«X is not defined» значит одно из двух: файл при загрузке зовёт то, что объявлено в файле ниже по списку (перенеси вызов в обработчик или подними файл с X выше), ' +
      'или это новый объект браузера или другого скрипта — тогда добавь заглушку в emptyWindow().'
  );
});
