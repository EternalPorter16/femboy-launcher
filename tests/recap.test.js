const test = require('node:test');
const assert = require('node:assert/strict');
const { profile } = require('./helpers');
const recap = require('../src/core/recap');

const H = 3600e3;
const MIN = 60e3;
const DAY = 24 * H;
// Местное время (границы дней — по часам компьютера): проверка не зависит от пояса, в котором её запустили
const at = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const NOW = at(2026, 10, 29, 20, 0); // четверг, 20:00
const S = (id, start, end) => ({ id, start, end });
const CYR = /[А-Яа-яЁё]/;

// Неделя 23–29 октября. Здесь есть всё, что может встретиться: сессия на границе недели, через полночь, из будущего и давняя
const WEEK = [
  S('a', at(2026, 10, 23, 9), at(2026, 10, 23, 10)), // 1 ч в первый день недели
  S('a', at(2026, 10, 22, 23), at(2026, 10, 23, 1)), // через границу: 1 ч до недели и 1 ч в ней
  S('a', at(2026, 10, 22, 9), at(2026, 10, 22, 10)), // до недели: 1 ч в прошлой
  S('b', at(2026, 10, 29, 18), at(2026, 10, 29, 19, 30)), // сегодня 1 ч 30 мин
  S('c', at(2026, 10, 30, 1), at(2026, 10, 30, 2)), // из будущего (часы переводили)
  S('d', at(2026, 10, 28, 23, 30), at(2026, 10, 29, 0, 30)), // через полночь: по 30 мин на два дня
];
const NAMES = new Map([['a', 'Уютное выживание'], ['b', 'Техно'], ['d', 'Скай']]);

test('неделя — семь дней по часам компьютера, последний — сегодня; месяц — тридцать; незнакомый период читается как неделя', () => {
  const w = recap.build([], { now: NOW });
  assert.equal(w.period, 'week');
  assert.equal(w.from, at(2026, 10, 23));
  assert.equal(w.to, at(2026, 10, 30), 'период кончается вместе с сегодняшним днём');
  assert.deepEqual(w.byDay.map((d) => d.at), [23, 24, 25, 26, 27, 28, 29].map((d) => at(2026, 10, d)));
  const m = recap.build([], { now: NOW, period: 'month' });
  assert.equal(m.period, 'month');
  assert.equal(m.byDay.length, 30);
  assert.equal(m.from, at(2026, 9, 30));
  assert.equal(m.byDay[29].at, at(2026, 10, 29));
  assert.equal(recap.build([], { now: NOW, period: 'год' }).period, 'week');
  assert.equal(recap.build([], { now: NOW, period: undefined }).period, 'week');
});

test('журнал пуст: нули и пустые списки, ничего не выдумывается', () => {
  const d = recap.build([], { now: NOW });
  assert.deepEqual([d.total, d.sessions, d.activeDays, d.prevTotal], [0, 0, 0, 0]);
  assert.deepEqual([d.longest, d.best, d.top], [null, null, []]);
  assert.ok(d.byDay.every((x) => x.ms === 0));
  assert.deepEqual(recap.build(undefined, { now: NOW }).top, [], 'и без списка вообще');
});

test('часы считаются внутри периода: игра через границу делится, будущее и давнее не входят, прошлая неделя считается отдельно', () => {
  const d = recap.build(WEEK, { now: NOW });
  assert.deepEqual(d.byDay.map((x) => x.ms), [2 * H, 0, 0, 0, 0, 0.5 * H, 2 * H]);
  assert.equal(d.total, 4.5 * H);
  assert.equal(d.sessions, 4, 'сессия из будущего и сессия до недели не считаются');
  assert.equal(d.activeDays, 3);
  assert.equal(d.prevTotal, 2 * H, 'хвост сессии через границу и сессия 22 октября');
});

test('месяц: двадцать девятый день назад входит, тридцатый — нет; прошлый период — предыдущие тридцать дней', () => {
  const d = recap.build(
    [
      S('a', at(2026, 9, 30, 10), at(2026, 9, 30, 11)), // первый день месяца
      S('a', at(2026, 9, 29, 10), at(2026, 9, 29, 12)), // за день до: прошлый период
      S('a', at(2026, 8, 31, 10), at(2026, 8, 31, 13)), // первый день прошлого периода
      S('a', at(2026, 8, 30, 10), at(2026, 8, 30, 14)), // раньше прошлого периода: не считается нигде
    ],
    { now: NOW, period: 'month' }
  );
  assert.equal(d.total, 1 * H);
  assert.equal(d.sessions, 1);
  assert.equal(d.prevTotal, 5 * H);
  assert.equal(d.byDay[0].ms, 1 * H);
});

test('сессия, которая заканчивается ровно в начале периода, в него не входит и не считается', () => {
  const d = recap.build([S('a', at(2026, 10, 22, 22), at(2026, 10, 23, 0))], { now: NOW });
  assert.deepEqual([d.total, d.sessions, d.activeDays, d.longest, d.best], [0, 0, 0, null, null]);
  assert.equal(d.prevTotal, 2 * H);
});

test('по сборкам: больше всего сверху, при равенстве по коду; время считается только внутри периода', () => {
  const d = recap.build(
    [
      S('b', at(2026, 10, 24, 10), at(2026, 10, 24, 13)),
      S('a', at(2026, 10, 25, 10), at(2026, 10, 25, 13)),
      S('c', at(2026, 10, 26, 10), at(2026, 10, 26, 11)),
      S('c', at(2026, 10, 1, 10), at(2026, 10, 1, 20)), // давно
      S('b', at(2026, 10, 22, 22), at(2026, 10, 23, 1)), // через границу: 1 ч внутри
    ],
    { now: NOW }
  );
  assert.deepEqual(d.top, [{ id: 'b', ms: 4 * H }, { id: 'a', ms: 3 * H }, { id: 'c', ms: 1 * H }]);
  const tie = recap.build([S('b', at(2026, 10, 24, 10), at(2026, 10, 24, 12)), S('a', at(2026, 10, 25, 10), at(2026, 10, 25, 12))], { now: NOW });
  assert.deepEqual(tie.top.map((x) => x.id), ['a', 'b']);
});

test('самая долгая игра и лучший день считаются внутри периода; при равенстве выигрывает более ранняя', () => {
  const tie = recap.build(
    [S('b', at(2026, 10, 26, 10), at(2026, 10, 26, 12)), S('a', at(2026, 10, 24, 10), at(2026, 10, 24, 12))],
    { now: NOW }
  );
  assert.deepEqual(tie.longest, { ms: 2 * H, at: at(2026, 10, 24, 10), id: 'a' });
  assert.deepEqual(tie.best, { ms: 2 * H, at: at(2026, 10, 24) });
  const edge = recap.build([...[S('b', at(2026, 10, 26, 10), at(2026, 10, 26, 12))], S('c', at(2026, 10, 22, 23), at(2026, 10, 23, 3))], { now: NOW });
  assert.deepEqual(edge.longest, { ms: 3 * H, at: at(2026, 10, 23), id: 'c' }, 'у сессии через границу в счёт идёт только та часть, что внутри недели');
  assert.deepEqual(edge.best, { ms: 3 * H, at: at(2026, 10, 23) });
});

test('время в минутах и часах: ноль, меньше минуты, ровные часы, округление до минуты, большие числа; по-русски и по-английски', () => {
  const f = recap.fmt;
  assert.deepEqual([0, 20e3, 29.9e3, 30e3, 59 * MIN, 59.6 * MIN, 60 * MIN, 65 * MIN, 130 * H + 5 * MIN].map((ms) => f(ms, 'ru')), [
    '0 мин', 'меньше минуты', 'меньше минуты', '1 мин', '59 мин', '1 ч', '1 ч', '1 ч 5 мин', '130 ч 5 мин',
  ]);
  assert.deepEqual([0, 20e3, 30e3, 65 * MIN, 120 * MIN].map((ms) => f(ms, 'en')), ['0 min', 'under a minute', '1 min', '1 h 5 min', '2 h']);
});

test('карточка недели по-русски: заголовок, даты, главное число, сравнение, дни, факты и любимая сборка', () => {
  const c = recap.describe(recap.build(WEEK, { now: NOW }), { names: NAMES });
  assert.deepEqual([c.period, c.lang, c.empty], ['week', 'ru', false]);
  assert.equal(c.title, 'Итоги недели');
  assert.equal(c.range, '23 – 29 октября 2026');
  assert.equal(c.big, '4 ч 30 мин');
  assert.equal(c.bigLabel, 'в игре за неделю');
  assert.deepEqual(c.delta, { dir: 1, text: 'На 2 ч 30 мин больше, чем неделей раньше' });
  assert.deepEqual(c.days.map((d) => d.label), ['пт', 'сб', 'вс', 'пн', 'вт', 'ср', 'чт']);
  assert.deepEqual(c.days.map((d) => d.ms), [2 * H, 0, 0, 0, 0, 0.5 * H, 2 * H]);
  assert.deepEqual(c.days.map((d) => d.today), [false, false, false, false, false, false, true]);
  assert.ok(c.days.every((d) => d.tick), 'у недели подписан каждый день');
  assert.deepEqual(c.facts, [
    { id: 'sessions', label: 'Игровых сессий', value: '4', sub: null },
    { id: 'days', label: 'Дней в игре', value: '3 из 7', sub: null },
    { id: 'longest', label: 'Самая долгая игра', value: '1 ч 30 мин', sub: 'чт, 29 окт' },
    { id: 'best', label: 'Лучший день', value: '2 ч', sub: 'пт, 23 окт' },
  ]);
  assert.equal(c.favourite.label, 'Любимая сборка');
  assert.equal(c.favourite.name, 'Уютное выживание');
  assert.equal(c.favourite.value, '2 ч');
  assert.equal(c.favourite.percent, '44%');
  assert.ok(Math.abs(c.favourite.share - 2 / 4.5) < 1e-9);
  assert.equal(c.brand, 'Femboy Launcher');
});

test('карточка недели по-английски: те же числа, английские слова и даты', () => {
  const c = recap.describe(recap.build(WEEK, { now: NOW }), { lang: 'en', names: NAMES });
  assert.equal(c.lang, 'en');
  assert.equal(c.title, 'Weekly recap');
  assert.equal(c.range, 'Oct 23 – 29, 2026');
  assert.equal(c.big, '4 h 30 min');
  assert.equal(c.bigLabel, 'in game this week');
  assert.deepEqual(c.delta, { dir: 1, text: '2 h 30 min more than the week before' });
  assert.deepEqual(c.days.map((d) => d.label), ['Fri', 'Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu']);
  assert.deepEqual(c.facts.map((f) => [f.label, f.value, f.sub]), [
    ['Sessions', '4', null],
    ['Days played', '3 of 7', null],
    ['Longest session', '1 h 30 min', 'Thu, Oct 29'],
    ['Best day', '2 h', 'Fri, Oct 23'],
  ]);
  assert.equal(c.favourite.label, 'Favourite instance');
});

test('карточка месяца: даты через месяцы и годы, подписи дней, сравнение с прошлым месяцем', () => {
  const m = recap.describe(recap.build([S('a', at(2026, 9, 30, 10), at(2026, 9, 30, 11)), S('a', at(2026, 9, 29, 10), at(2026, 9, 29, 12))], { now: NOW, period: 'month' }), { names: NAMES });
  assert.equal(m.title, 'Итоги месяца');
  assert.equal(m.range, '30 сентября – 29 октября 2026');
  assert.equal(m.bigLabel, 'в игре за месяц');
  assert.deepEqual(m.delta, { dir: -1, text: 'На 1 ч меньше, чем месяцем раньше' });
  assert.equal(m.days.length, 30);
  assert.deepEqual([m.days[0].label, m.days[1].label, m.days[29].label], ['30', '1', '29']);
  assert.deepEqual(m.days.map((d, i) => (d.tick ? i : -1)).filter((i) => i >= 0), [0, 5, 10, 15, 20, 25, 29], 'подписан каждый пятый день и сегодня');
  assert.equal(m.days.filter((d) => d.today).length, 1);
  assert.equal(m.facts[1].value, '1 из 30');
  const en = recap.describe(recap.build([S('a', at(2026, 9, 30, 10), at(2026, 9, 30, 11))], { now: NOW, period: 'month' }), { lang: 'en' });
  assert.equal(en.range, 'Sep 30 – Oct 29, 2026');
  assert.equal(en.title, 'Monthly recap');
  assert.equal(en.delta.text, 'No games the month before');
  // через границу года и коротким месяцем
  const ny = recap.describe(recap.build([], { now: at(2027, 1, 5, 12) }));
  assert.equal(ny.range, '30 декабря 2026 – 5 января 2027');
  assert.equal(recap.describe(recap.build([], { now: at(2027, 1, 5, 12) }), { lang: 'en' }).range, 'Dec 30, 2026 – Jan 5, 2027');
  assert.equal(recap.describe(recap.build([], { now: at(2026, 11, 3, 12) })).range, '28 октября – 3 ноября 2026');
  assert.equal(recap.describe(recap.build([], { now: at(2026, 11, 3, 12) }), { lang: 'en' }).range, 'Oct 28 – Nov 3, 2026');
});

test('сравнение с прошлым периодом: больше, меньше, столько же, раньше игр не было, сейчас тишина', () => {
  const week = (cur, prev) => {
    const list = [];
    if (cur) list.push(S('a', at(2026, 10, 26, 10), at(2026, 10, 26, 10) + cur));
    if (prev) list.push(S('a', at(2026, 10, 19, 10), at(2026, 10, 19, 10) + prev));
    return recap.describe(recap.build(list, { now: NOW }), {}).delta;
  };
  assert.deepEqual(week(3 * H, 1 * H), { dir: 1, text: 'На 2 ч больше, чем неделей раньше' });
  assert.deepEqual(week(1 * H, 3 * H), { dir: -1, text: 'На 2 ч меньше, чем неделей раньше' });
  assert.deepEqual(week(2 * H, 2 * H + 30e3), { dir: 0, text: 'Столько же, сколько неделей раньше' }, 'разница меньше минуты — это «столько же»');
  assert.deepEqual(week(2 * H + 20 * MIN, 2 * H), { dir: 1, text: 'На 20 мин больше, чем неделей раньше' }, 'а разница в двадцать минут — уже разница');
  assert.deepEqual(week(2 * H, 2 * H + 90e3), { dir: -1, text: 'На 2 мин меньше, чем неделей раньше' }, 'и в полторы минуты тоже');
  assert.deepEqual(week(2 * H, 0), { dir: 1, text: 'Неделей раньше игр не было' });
  assert.equal(week(0, 2 * H), null, 'сейчас тишина — сравнивать нечего');
  assert.equal(week(0, 0), null);
});

test('названия сборок можно скрыть; удалённая сборка называется «Удалённая сборка»; пустое имя — тоже удалённая', () => {
  const d = recap.build(WEEK, { now: NOW });
  assert.equal(recap.describe(d, { names: NAMES, hideNames: true }).favourite.name, null);
  assert.equal(recap.describe(d, { names: NAMES, hideNames: true }).favourite.value, '2 ч', 'остальное остаётся');
  assert.equal(recap.describe(d, { names: new Map() }).favourite.name, 'Удалённая сборка');
  assert.equal(recap.describe(d, { names: new Map([['a', '  ']]) }).favourite.name, 'Удалённая сборка');
  assert.equal(recap.describe(d, { names: new Map(), lang: 'en' }).favourite.name, 'Deleted instance');
  assert.equal(recap.describe(d, { names: { a: 'Из объекта' } }).favourite.name, 'Из объекта', 'имена можно передать и обычным объектом');
  assert.equal(recap.describe(d, { hideNames: true }).favourite.name, null, 'без списка имён с hideNames имя тоже нет');
});

test('доля любимой сборки округляется до целого процента (две трети — 67%, а не 66%), единственная сборка — 100%', () => {
  const two = recap.describe(recap.build([S('a', at(2026, 10, 25, 10), at(2026, 10, 25, 12)), S('b', at(2026, 10, 26, 10), at(2026, 10, 26, 11))], { now: NOW }), { names: NAMES });
  assert.equal(two.favourite.percent, '67%');
  const one = recap.describe(recap.build([S('b', at(2026, 10, 25, 10), at(2026, 10, 25, 12))], { now: NOW }), { names: NAMES });
  assert.deepEqual([one.favourite.percent, one.favourite.share, one.favourite.name], ['100%', 1, 'Техно']);
});

test('пустая карточка: нули и прочерки, любимой сборки нет, котик говорит про тишину', () => {
  const c = recap.describe(recap.build([], { now: NOW }), { names: NAMES });
  assert.equal(c.empty, true);
  assert.equal(c.big, '0 мин');
  assert.equal(c.delta, null);
  assert.equal(c.favourite, null);
  assert.deepEqual(c.facts.map((f) => f.value), ['0', '0 из 7', '—', '—']);
  assert.deepEqual(c.facts.map((f) => f.sub), [null, null, null, null]);
  assert.equal(c.tier, 'quiet');
  assert.ok(recap.COMMENTS.ru.quiet.includes(c.comment));
});

test('реплика котика зависит от того, сколько играли: тишина, чуть-чуть, нормально, много, очень много; с поправкой на прошлый период', () => {
  const tier = (hours, prevHours = 0, period = 'week') => {
    const list = [];
    if (hours) list.push(S('a', at(2026, 10, 25, 1), at(2026, 10, 25, 1) + hours * H));
    if (prevHours) list.push(S('a', at(2026, 10, 18, 1), at(2026, 10, 18, 1) + prevHours * H));
    return recap.tierOf(recap.build(list, { now: NOW, period }));
  };
  assert.equal(tier(0, 5), 'quiet');
  assert.equal(tier(1), 'little');
  assert.equal(tier(2), 'little');
  assert.equal(tier(3), 'some');
  assert.equal(tier(10), 'some');
  assert.equal(tier(11), 'lots');
  assert.equal(tier(24), 'lots');
  assert.equal(tier(25), 'huge');
  assert.equal(tier(6, 3), 'up', 'в полтора раза больше и не меньше часа разницы');
  assert.equal(tier(2, 5), 'down', 'вдвое меньше и не меньше часа разницы');
  assert.equal(tier(30, 10), 'huge', 'забота об отдыхе важнее похвалы за рост');
  assert.equal(tier(2.9, 2), 'some', 'небольшая разница ничего не меняет');
  assert.equal(tier(3, 2), 'up', 'ровно в полтора раза и ровно на час — уже рост');
  assert.equal(tier(1.4, 0.5), 'little', 'в разы больше, но меньше чем на час — это не рост, а мелочь');
  assert.equal(tier(0.5, 1.4), 'little', 'и то же в обратную сторону: вдвое меньше, но меньше чем на час — не спад');
  assert.equal(tier(10, 7), 'some', 'в полтора раза ещё не дотянуто (10 из 7 — это в 1,43 раза)');
  assert.equal(tier(7, 12), 'some', 'вдвое тоже: 7 из 12 — это ещё не вдвое меньше');
  // месяц считает в тех же долях на день
  assert.equal(tier(8, 0, 'month'), 'little');
  assert.equal(tier(40, 0, 'month'), 'some');
  assert.equal(tier(100, 0, 'month'), 'lots');
  assert.equal(tier(110, 0, 'month'), 'huge');
});

test('у каждой реплики есть русский и английский вариант; все они короткие, без пустых и без русских букв в английских', () => {
  const tiers = Object.keys(recap.COMMENTS.ru);
  assert.deepEqual(Object.keys(recap.COMMENTS.en), tiers);
  assert.deepEqual(tiers.sort(), ['down', 'little', 'lots', 'huge', 'quiet', 'some', 'up'].sort());
  for (const t of tiers) {
    assert.equal(recap.COMMENTS.en[t].length, recap.COMMENTS.ru[t].length, t);
    assert.ok(recap.COMMENTS.ru[t].length >= 2, `в «${t}» должно быть из чего выбирать`);
    for (const s of recap.COMMENTS.ru[t]) assert.ok(s.trim() && s.length <= 70 && CYR.test(s), s);
    for (const s of recap.COMMENTS.en[t]) assert.ok(s.trim() && s.length <= 70 && !CYR.test(s), s);
  }
});

test('вариант реплики выбирается по дню периода: в один день одинаков, в разные дни бывают все', () => {
  const pick = (now, lang = 'ru') => recap.describe(recap.build([S('a', now - 5 * H, now - 3 * H)], { now }), { lang }).comment;
  assert.equal(pick(NOW), pick(NOW + 3 * H - 1), 'в тот же день реплика не меняется между открытиями окна');
  const seen = new Set();
  for (let i = 0; i < 8; i++) seen.add(pick(at(2026, 10, 20 + i, 20)));
  assert.equal(seen.size, 2, 'за неделю встречаются оба варианта (для этого уровня)');
  assert.deepEqual([...seen].sort(), [...recap.COMMENTS.ru.little].sort());
});

test('в английской карточке нет русских букв (кроме названий сборок), а суммы сходятся — на сотне случайных журналов', () => {
  let seed = 12345;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const strings = (v, out = []) => {
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (k !== 'name') strings(x, out);
    return out;
  };
  for (let i = 0; i < 120; i++) {
    const now = at(2026 + Math.floor(rnd() * 2), 1 + Math.floor(rnd() * 12), 1 + Math.floor(rnd() * 28), Math.floor(rnd() * 24));
    const list = Array.from({ length: Math.floor(rnd() * 40) }, () => {
      const start = now - Math.floor(rnd() * 75 * DAY) + Math.floor(rnd() * 2 * DAY);
      return S(['a', 'b', 'c', 'gone'][Math.floor(rnd() * 4)], start, start + 5000 + Math.floor(rnd() * 7 * H));
    });
    const period = rnd() < 0.5 ? 'week' : 'month';
    const d = recap.build(list, { now, period });
    assert.equal(d.byDay.reduce((s, x) => s + x.ms, 0), d.total, 'часы по дням сходятся с общим');
    assert.equal(d.top.reduce((s, x) => s + x.ms, 0), d.total, 'часы по сборкам сходятся с общим');
    assert.ok(d.activeDays <= d.byDay.length);
    assert.equal(d.sessions === 0, d.total === 0, 'сессия считается, только если в периоде от неё есть время');
    assert.ok(d.longest === null || d.longest.ms <= d.total);
    assert.ok(d.best === null || d.best.ms <= d.total);
    for (const lang of ['ru', 'en']) {
      const c = recap.describe(d, { lang, names: new Map([['a', 'Мой мир'], ['b', 'Фабрика']]) });
      assert.equal(c.days.length, d.byDay.length);
      if (lang === 'en') for (const s of strings(c)) assert.ok(!CYR.test(s), `русское в английской карточке: «${s}»`);
      else assert.ok(CYR.test(c.title) && CYR.test(c.comment));
      assert.ok(!strings(c).some((s) => /undefined|NaN|\[object/.test(s)), JSON.stringify(c));
    }
  }
});

test('имя файла для сохранения: период, дата по часам компьютера, язык; незнакомое читается как неделя по-русски', () => {
  assert.equal(recap.fileName('week', 'ru', NOW), 'Итоги недели 2026-10-29.png');
  assert.equal(recap.fileName('month', 'ru', NOW), 'Итоги месяца 2026-10-29.png');
  assert.equal(recap.fileName('month', 'en', at(2027, 1, 5, 12)), 'Monthly recap 2027-01-05.png');
  assert.equal(recap.fileName('week', 'en', NOW), 'Weekly recap 2026-10-29.png');
  assert.equal(recap.fileName('год', 'de', NOW), 'Итоги недели 2026-10-29.png');
  assert.ok(!/[\\/:*?"<>|]/.test(recap.fileName('week', 'ru', NOW)), 'в имени нет знаков, запрещённых в Windows');
});

test('card() читает журнал с диска, подставляет имена сборок; неизвестные язык и период — русский и неделя', (t) => {
  const p = profile();
  t.after(() => p.done());
  const playlog = p.load('core/playlog');
  const { card } = p.load('core/recap');
  playlog.add('x1', NOW - 3 * H, NOW - 2 * H);
  playlog.add('x2', NOW - 2 * DAY, NOW - 2 * DAY + H);
  const c = card({ now: NOW, names: new Map([['x1', 'Моя сборка']]) });
  assert.equal(c.big, '2 ч');
  assert.equal(c.favourite.name, 'Моя сборка', 'у x1 и x2 поровну: выигрывает меньший код, а у x2 имени нет');
  assert.equal(card({ now: NOW, period: 'month', lang: 'en' }).title, 'Monthly recap');
  const odd = card({ now: NOW, period: 'год', lang: 'de' });
  assert.deepEqual([odd.period, odd.lang], ['week', 'ru']);
  assert.equal(card({ now: NOW, hideNames: true, names: new Map([['x1', 'Моя сборка']]) }).favourite.name, null);
});
