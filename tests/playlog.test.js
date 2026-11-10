const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { profile } = require('./helpers');

const H = 3600e3;
const MIN = 60e3;
const DAY = 24 * H;
// Местное время (границы дней — по часам компьютера): так проверка не зависит от пояса, в котором её запустили
const at = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const NOW = at(2026, 10, 29, 20, 0); // четверг, 20:00

function setup(t) {
  const p = profile();
  t.after(() => p.done());
  const file = path.join(p.store.baseDir(), 'playlog.json');
  const load = () => {
    for (const k of Object.keys(require.cache)) if (/core[\\/]playlog\.js$/.test(k)) delete require.cache[k];
    return p.load('core/playlog');
  };
  return { p, file, playlog: load(), reload: load };
}

test('сессия записывается в журнал и переживает перезапуск лаунчера', (t) => {
  const { file, playlog, reload } = setup(t);
  assert.equal(playlog.add('inst1', NOW - 2 * H, NOW - H), true);
  assert.deepEqual(playlog.all(), [{ id: 'inst1', start: NOW - 2 * H, end: NOW - H }]);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), [[NOW - 2 * H, NOW - H, 'inst1']]);
  assert.deepEqual(reload().all(), [{ id: 'inst1', start: NOW - 2 * H, end: NOW - H }]);
});

test('слишком короткие сессии (вылет в первые секунды) и мусор в журнал не попадают', (t) => {
  const { playlog } = setup(t);
  assert.equal(playlog.add('a', NOW, NOW + 4000), false, 'меньше пяти секунд — не игра');
  assert.equal(playlog.add('a', NOW, NOW - 1000), false, 'конец раньше начала');
  assert.equal(playlog.add('', NOW, NOW + MIN), false);
  assert.equal(playlog.add(undefined, NOW, NOW + MIN), false);
  assert.equal(playlog.add('a', NaN, NOW), false);
  assert.equal(playlog.add('a', NOW, Infinity), false);
  assert.equal(playlog.add('a', 'вчера', 'сегодня'), false);
  assert.deepEqual(playlog.all(), []);
  assert.equal(playlog.add('a', NOW, NOW + 5000), true, 'ровно пять секунд — уже игра');
});

test('журнал не растёт бесконечно: записи старше 400 дней и лишние сверх 5000 отбрасываются', (t) => {
  const { playlog } = setup(t);
  const old = [NOW - 401 * DAY, NOW - 401 * DAY + H, 'old'];
  const fresh = [NOW - 5 * DAY, NOW - 5 * DAY + H, 'fresh'];
  assert.deepEqual(playlog.prune([old, fresh], NOW), [fresh]);
  const many = Array.from({ length: 5100 }, (_, i) => [NOW - 100 * DAY + i * MIN, NOW - 100 * DAY + i * MIN + 10 * MIN, 'm']);
  const kept = playlog.prune(many, NOW);
  assert.equal(kept.length, 5000);
  assert.deepEqual(kept[kept.length - 1], many[many.length - 1], 'остаются самые свежие');
  assert.deepEqual(kept[0], many[100]);
});

test('повреждённый файл журнала не ломает ничего: читается как пустой, а следующая запись его чинит', (t) => {
  const { file, playlog } = setup(t);
  fs.writeFileSync(file, '[[1, 2,');
  assert.deepEqual(playlog.all(), []);
  assert.equal(playlog.add('a', NOW - H, NOW), true);
  assert.deepEqual(playlog.all().map((s) => s.id), ['a']);
  fs.writeFileSync(file, JSON.stringify({ не: 'список' }));
  assert.deepEqual(playlog.all(), []);
  fs.writeFileSync(file, JSON.stringify([null, 5, 'x', [1], [NOW, NOW + H, 'ok'], [NOW, 'bad', 'z'], [NOW + H, NOW, 'back']]));
  assert.deepEqual(playlog.all(), [{ id: 'ok', start: NOW, end: NOW + H }], 'годные записи читаются, мусор пропускается');
});

test('неделя по дням: часы каждого дня считаются отдельно, пустые дни — нули, последний день — сегодня', () => {
  const { summarize } = require('../src/core/playlog');
  const s = summarize(
    [
      { id: 'a', start: at(2026, 10, 29, 18), end: at(2026, 10, 29, 19, 30) }, // сегодня 1 ч 30 мин
      { id: 'a', start: at(2026, 10, 27, 10), end: at(2026, 10, 27, 12) }, // позавчера 2 ч
      { id: 'b', start: at(2026, 10, 27, 20), end: at(2026, 10, 27, 20, 30) }, // позавчера ещё 30 мин
      { id: 'b', start: at(2026, 10, 23, 9), end: at(2026, 10, 23, 10) }, // 6 дней назад (входит в неделю)
      { id: 'b', start: at(2026, 10, 22, 9), end: at(2026, 10, 22, 10) }, // 7 дней назад (в неделю уже не входит)
    ],
    { now: NOW }
  );
  assert.equal(s.week.length, 7);
  assert.deepEqual(s.week.map((d) => d.at), [23, 24, 25, 26, 27, 28, 29].map((d) => at(2026, 10, d)), 'от недели назад до сегодня');
  assert.deepEqual(s.week.map((d) => d.ms), [1 * H, 0, 0, 0, 2.5 * H, 0, 1.5 * H]);
  assert.equal(s.weekTotal, 5 * H);
});

test('игра шла через полночь: время делится между днями по часам компьютера', () => {
  const { summarize } = require('../src/core/playlog');
  const s = summarize([{ id: 'a', start: at(2026, 10, 28, 23), end: at(2026, 10, 29, 1, 30) }], { now: NOW });
  const by = Object.fromEntries(s.week.map((d) => [d.at, d.ms]));
  assert.equal(by[at(2026, 10, 28)], 1 * H);
  assert.equal(by[at(2026, 10, 29)], 1.5 * H);
  assert.equal(s.weekTotal, 2.5 * H);
  assert.equal(s.longest, 2.5 * H, 'но это одна сессия');
  assert.equal(s.sessions, 1);
});

test('по сборкам: за последние 30 дней, больше всего сверху; всего, самая долгая сессия и «с какого дня считаю» — за всё время', () => {
  const { summarize } = require('../src/core/playlog');
  const s = summarize(
    [
      { id: 'a', start: NOW - 40 * DAY, end: NOW - 40 * DAY + 5 * H }, // давно: в «по сборкам» не входит
      { id: 'a', start: NOW - 10 * DAY, end: NOW - 10 * DAY + 1 * H },
      { id: 'b', start: NOW - 3 * DAY, end: NOW - 3 * DAY + 3 * H },
      { id: 'c', start: NOW - 2 * DAY, end: NOW - 2 * DAY + 2 * H },
      { id: 'b', start: NOW - 1 * DAY, end: NOW - 1 * DAY + 1 * H },
    ],
    { now: NOW }
  );
  assert.deepEqual(s.byInstance, [{ id: 'b', ms: 4 * H }, { id: 'c', ms: 2 * H }, { id: 'a', ms: 1 * H }]);
  assert.equal(s.total, 12 * H);
  assert.equal(s.longest, 5 * H);
  assert.equal(s.sessions, 5);
  assert.equal(s.since, NOW - 40 * DAY);
});

test('журнал пуст: нули, пустые списки и «с какого дня» — ничего; будущие записи (часы переводили) не ломают расчёт', () => {
  const { summarize } = require('../src/core/playlog');
  const empty = summarize([], { now: NOW });
  assert.deepEqual([empty.total, empty.weekTotal, empty.sessions, empty.longest, empty.since, empty.byInstance.length], [0, 0, 0, 0, null, 0]);
  assert.equal(empty.week.length, 7);
  assert.ok(empty.week.every((d) => d.ms === 0));
  const future = summarize([{ id: 'a', start: NOW + 2 * DAY, end: NOW + 2 * DAY + H }], { now: NOW });
  assert.equal(future.weekTotal, 0, 'в неделю до сегодняшнего вечера будущее не попадает');
  assert.equal(future.sessions, 1);
});

test('summary() читает журнал с диска и называет дни по часам компьютера', (t) => {
  const { playlog } = setup(t);
  playlog.add('a', NOW - 3 * H, NOW - 2 * H);
  playlog.add('b', NOW - 2 * DAY, NOW - 2 * DAY + H);
  const s = playlog.summary({ now: NOW });
  assert.equal(s.sessions, 2);
  assert.equal(s.weekTotal, 2 * H);
  assert.deepEqual(s.byInstance.map((x) => x.id).sort(), ['a', 'b']);
});
