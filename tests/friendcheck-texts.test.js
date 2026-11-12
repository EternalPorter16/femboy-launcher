// Связка «проверка игры с другом» ↔ окно. friendcheck.js присылает коды результатов, а тексты к ним лежат в интерфейсе
// (app/friends.js) и переводе (i18n.js). Забытый код показался бы человеку строкой «не получилось разобрать ответ», поэтому
// списки сверяются здесь по тексту файлов — без Электрона и без сети
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { src } = require('./helpers');

const read = (rel) => fs.readFileSync(src(rel), 'utf8').replace(/\r\n/g, '\n'); // копия git с core.autocrlf=true даёт CRLF
const core = read('core/friendcheck.js');
const probes = read('core/netprobe.js');
const ui = read('renderer/app/friends.js');
const i18n = read('renderer/i18n.js');
// Содержимое «const ИМЯ = { … };» из скрипта интерфейса (закрывающая скобка стоит в первом столбце)
const block = (name) => ui.match(new RegExp(`^const ${name} = \\{\\n([\\s\\S]*?)^\\};`, 'm'))?.[1] || '';
const uniq = (list) => [...new Set(list)].sort();

test('у каждого кода из friendcheck.js есть текст в окне, и в окне нет текстов для несуществующих кодов', () => {
  const emitted = uniq([...core.matchAll(/\badd\(\s*[^,()]+,\s*'(?:ok|warn|fail)',\s*'([a-z0-9-]+)'/g)].map((m) => m[1]));
  const texts = uniq([...block('FC_ROW').matchAll(/^ {2}'([a-z0-9-]+)':/gm)].map((m) => m[1]));
  assert.ok(emitted.length >= 20, `код разобран не весь: ${emitted.join(', ')}`);
  assert.deepEqual(texts, emitted);
});

test('у каждой проверки есть заголовок строки, а у каждого итога — текст', () => {
  const ids = uniq([...core.matchAll(/\badd\(\s*'([a-z0-9]+)'/g), ...core.matchAll(/\bguard\(\s*'([a-z0-9]+)'/g)].map((m) => m[1]));
  const titles = uniq([...block('FC_TITLE').matchAll(/^ {2}([a-z0-9]+):/gm)].map((m) => m[1]));
  assert.deepEqual(titles, ids);
  const verdicts = uniq([...block('FC_VERDICT').matchAll(/^ {2}(\w+):/gm)].map((m) => m[1]));
  assert.deepEqual(verdicts, ['fail', 'ok', 'warn']);
});

test('каждая причина отказа сети, которую умеют называть пробы, описана словами', () => {
  const reasons = uniq([...probes.matchAll(/\breason:\s*'([a-z-]+)'/g), ...probes.matchAll(/\breturn '([a-z-]+)';/g)].map((m) => m[1]));
  const words = uniq([...block('FC_WHY').matchAll(/^ {2}'?([a-z-]+)'?:/gm)].map((m) => m[1]));
  assert.ok(reasons.includes('timeout') && reasons.includes('http') && reasons.includes('proxy'), `причины разобраны не все: ${reasons.join(', ')}`);
  for (const r of reasons) assert.ok(words.includes(r), `для причины «${r}» нет слов в FC_WHY`);
  assert.ok(words.includes('udp-timeout'), 'у UDP своя фраза про молчание: ждём не 8 секунд, а 3');
});

test('заголовки, причины и итоги переведены: каждая русская строка из этих таблиц есть в словаре i18n.js', () => {
  for (const name of ['FC_TITLE', 'FC_WHY', 'FC_VERDICT']) {
    const strings = [...block(name).matchAll(/'([^']*[А-Яа-яЁё][^']*)'/g)].map((m) => m[1]);
    assert.ok(strings.length > 0, `${name}: русских строк не нашлось`);
    for (const s of strings) assert.ok(i18n.includes(`'${s}':`), `нет перевода: ${s}`);
  }
});
