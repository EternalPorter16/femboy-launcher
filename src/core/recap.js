// «Итоги недели/месяца» (Настройки → «Котик и награды» → «Время в игре» → «Итоги»): всё, что нужно для картинки, которую окно рисует на холсте.
// Время берётся из журнала игры (core/playlog.js), неделя — это семь дней по часам компьютера, последний из них — сегодня, месяц — тридцать.
// Подписи собираются здесь же сразу на нужном языке: текст на холсте переводчик окна не видит, а так его можно проверить обычными тестами
const playlog = require('./playlog');

const { dayStart, addDays, overlap } = playlog;
const MIN = 60e3;
const H = 3600e3;
const DAY = 24 * H;
const PERIODS = { week: 7, month: 30 };
const BRAND = 'Femboy Launcher';

// ---------- подсчёт ----------

// sessions — [{ id, start, end }]. Всё считается только внутри периода: игра через его границу делится, будущее (часы переводили) не входит
function build(sessions = [], { now = Date.now(), period = 'week' } = {}) {
  const kind = PERIODS[period] ? period : 'week';
  const n = PERIODS[kind];
  const from = addDays(dayStart(now), -(n - 1));
  const to = addDays(dayStart(now), 1);
  const before = addDays(from, -n);
  const byDay = Array.from({ length: n }, (_, i) => {
    const at = addDays(from, i);
    const end = addDays(at, 1);
    return { at, ms: sessions.reduce((sum, s) => sum + overlap(s, at, end), 0) };
  });
  const byId = new Map();
  let count = 0;
  let longest = null;
  for (const s of sessions) {
    const ms = overlap(s, from, to);
    if (ms <= 0) continue;
    count++;
    byId.set(s.id, (byId.get(s.id) || 0) + ms);
    if (!longest || ms > longest.ms || (ms === longest.ms && Math.max(s.start, from) < longest.at)) longest = { ms, at: Math.max(s.start, from), id: s.id };
  }
  let best = null;
  for (const d of byDay) if (d.ms > 0 && (!best || d.ms > best.ms)) best = { ms: d.ms, at: d.at };
  return {
    period: kind,
    from,
    to,
    byDay,
    total: byDay.reduce((sum, d) => sum + d.ms, 0),
    sessions: count,
    activeDays: byDay.filter((d) => d.ms > 0).length,
    longest,
    best,
    top: [...byId].map(([id, ms]) => ({ id, ms })).sort((a, b) => b.ms - a.ms || (a.id < b.id ? -1 : 1)),
    prevTotal: sessions.reduce((sum, s) => sum + overlap(s, before, from), 0),
  };
}

// Что сказать по итогам: тишина, мало, нормально, много, слишком много, заметно больше или меньше, чем в прошлый раз.
// «Слишком много» важнее похвалы за рост: котик беспокоится об отдыхе. Пороги — часов в день, поэтому и неделя, и месяц меряются одинаково
function tierOf(d) {
  if (!d.total) return 'quiet';
  const perDay = d.total / d.byDay.length / H;
  if (perDay >= 3.5) return 'huge';
  const diff = d.total - d.prevTotal;
  if (d.prevTotal > 0 && d.total >= d.prevTotal * 1.5 && diff >= H) return 'up';
  if (d.prevTotal > 0 && d.total <= d.prevTotal / 2 && -diff >= H) return 'down';
  if (perDay < 0.3) return 'little';
  if (perDay < 1.5) return 'some';
  return 'lots';
}

// ---------- подписи ----------

// В каждом уровне по два варианта: какой из них, решает день, с которого начинается период (в тот же день реплика не меняется)
const COMMENTS = {
  ru: {
    quiet: ['Тут пока тихо… сыграем? ♡', 'Пусто-пусто. Может, заглянем в мир? 🌙'],
    little: ['Заглянули ненадолго — и это уже приятно ♡', 'Чуть-чуть поиграли, зато с душой :3'],
    some: ['Хорошо поиграли и не забыли отдохнуть ✨', 'Ровно столько, чтобы было уютно :3'],
    lots: ['Ого, сколько всего построено! Попей водички 💧', 'Вот это да… горжусь тобой 😳'],
    huge: ['Это уже почти работа… давай поспим? 🌙', 'Глаза не квадратные? Разомнись и попей чаю ☕'],
    up: ['Заметно больше, чем раньше — кто-то увлёкся 👀', 'Игры стало больше — мне нравится :3'],
    down: ['Поспокойнее, чем раньше — тоже хорошо ♡', 'Отдыхать тоже нужно ✨'],
  },
  en: {
    quiet: ['It’s quiet here… shall we play? ♡', 'Nothing yet. Maybe we peek into a world? 🌙'],
    little: ['We dropped by for a bit — and that’s nice ♡', 'Just a little play, but with heart :3'],
    some: ['Good playing, and time to rest too ✨', 'Just enough to stay cozy :3'],
    lots: ['Wow, so much built! Have some water 💧', 'Look at you… I’m proud 😳'],
    huge: ['That’s almost a job… shall we sleep? 🌙', 'Are your eyes square yet? Stretch and have some tea ☕'],
    up: ['A lot more than before — someone got hooked 👀', 'More playing lately — I like it :3'],
    down: ['Calmer than before — that’s fine too ♡', 'Resting matters as well ✨'],
  },
};

const T = {
  ru: {
    title: { week: 'Итоги недели', month: 'Итоги месяца' },
    bigLabel: { week: 'в игре за неделю', month: 'в игре за месяц' },
    prev: { week: 'неделей раньше', month: 'месяцем раньше' },
    none: { week: 'Неделей раньше игр не было', month: 'Месяцем раньше игр не было' },
    more: (d, prev) => `На ${d} больше, чем ${prev}`,
    less: (d, prev) => `На ${d} меньше, чем ${prev}`,
    same: (prev) => `Столько же, сколько ${prev}`,
    facts: { sessions: 'Игровых сессий', days: 'Дней в игре', longest: 'Самая долгая игра', best: 'Лучший день' },
    daysOf: (a, n) => `${a} из ${n}`,
    favourite: 'Любимая сборка',
    deleted: 'Удалённая сборка',
    unit: { h: 'ч', min: 'мин' },
    underMinute: 'меньше минуты',
    weekdays: ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'],
    dateMonths: ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'],
    rangeMonths: ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'],
    date: (d, m) => `${d} ${m}`,
    // одна строка на период: «23 – 29 октября 2026», «30 сентября – 29 октября 2026», «30 декабря 2026 – 5 января 2027»
    range: (a, b, mon) => {
      const first = a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() ? `${a.getDate()}` : `${a.getDate()} ${mon[a.getMonth()]}${a.getFullYear() === b.getFullYear() ? '' : ` ${a.getFullYear()}`}`;
      return `${first} – ${b.getDate()} ${mon[b.getMonth()]} ${b.getFullYear()}`;
    },
  },
  en: {
    title: { week: 'Weekly recap', month: 'Monthly recap' },
    bigLabel: { week: 'in game this week', month: 'in game this month' },
    prev: { week: 'the week before', month: 'the month before' },
    none: { week: 'No games the week before', month: 'No games the month before' },
    more: (d, prev) => `${d} more than ${prev}`,
    less: (d, prev) => `${d} less than ${prev}`,
    same: (prev) => `Same as ${prev}`,
    facts: { sessions: 'Sessions', days: 'Days played', longest: 'Longest session', best: 'Best day' },
    daysOf: (a, n) => `${a} of ${n}`,
    favourite: 'Favourite instance',
    deleted: 'Deleted instance',
    unit: { h: 'h', min: 'min' },
    underMinute: 'under a minute',
    weekdays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    dateMonths: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    rangeMonths: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    date: (d, m) => `${m} ${d}`,
    range: (a, b, mon) => {
      const sameYear = a.getFullYear() === b.getFullYear();
      if (sameYear && a.getMonth() === b.getMonth()) return `${mon[a.getMonth()]} ${a.getDate()} – ${b.getDate()}, ${b.getFullYear()}`;
      if (sameYear) return `${mon[a.getMonth()]} ${a.getDate()} – ${mon[b.getMonth()]} ${b.getDate()}, ${b.getFullYear()}`;
      return `${mon[a.getMonth()]} ${a.getDate()}, ${a.getFullYear()} – ${mon[b.getMonth()]} ${b.getDate()}, ${b.getFullYear()}`;
    },
  },
};

// Время для картинки: «45 мин», «1 ч», «1 ч 5 мин», меньше полминуты — «меньше минуты»
function fmt(ms, lang = 'ru') {
  const t = T[lang] || T.ru;
  const min = Math.round((ms || 0) / MIN);
  if (min === 0 && ms > 0) return t.underMinute;
  if (min < 60) return `${min} ${t.unit.min}`;
  const h = Math.floor(min / 60);
  return min % 60 ? `${h} ${t.unit.h} ${min % 60} ${t.unit.min}` : `${h} ${t.unit.h}`;
}

const nameOf = (names, id) => (names instanceof Map ? names.get(id) : names && Object.prototype.hasOwnProperty.call(names, id) ? names[id] : undefined);

// Готовая карточка: все подписи на выбранном языке, числа для столбиков и сигналы для окна (empty, today, tick)
function describe(d, { lang = 'ru', hideNames = false, names } = {}) {
  const code = lang === 'en' ? 'en' : 'ru';
  const t = T[code];
  const when = (ms) => {
    const x = new Date(ms);
    return `${t.weekdays[x.getDay()]}, ${t.date(x.getDate(), t.dateMonths[x.getMonth()])}`;
  };
  const n = d.byDay.length;
  const tier = tierOf(d);
  const variants = COMMENTS[code][tier];

  let delta = null;
  if (d.total) {
    const diff = d.total - d.prevTotal;
    if (!d.prevTotal) delta = { dir: 1, text: t.none[d.period] };
    else if (Math.abs(diff) < MIN) delta = { dir: 0, text: t.same(t.prev[d.period]) };
    else delta = { dir: diff > 0 ? 1 : -1, text: (diff > 0 ? t.more : t.less)(fmt(Math.abs(diff), code), t.prev[d.period]) };
  }

  const top = d.top[0];
  const favourite = top && {
    label: t.favourite,
    name: hideNames ? null : String(nameOf(names, top.id) ?? '').trim() || t.deleted,
    value: fmt(top.ms, code),
    share: top.ms / d.total,
    percent: `${Math.round((top.ms / d.total) * 100)}%`,
  };

  return {
    period: d.period,
    lang: code,
    empty: !d.total,
    title: t.title[d.period],
    range: t.range(new Date(d.from), new Date(d.byDay[n - 1].at), t.rangeMonths),
    big: fmt(d.total, code),
    bigLabel: t.bigLabel[d.period],
    delta,
    days: d.byDay.map((x, i) => ({
      label: d.period === 'week' ? t.weekdays[new Date(x.at).getDay()] : String(new Date(x.at).getDate()),
      ms: x.ms,
      today: i === n - 1,
      tick: d.period === 'week' || i % 5 === 0 || i === n - 1,
    })),
    facts: [
      { id: 'sessions', label: t.facts.sessions, value: String(d.sessions), sub: null },
      { id: 'days', label: t.facts.days, value: t.daysOf(d.activeDays, n), sub: null },
      { id: 'longest', label: t.facts.longest, value: d.longest ? fmt(d.longest.ms, code) : '—', sub: d.longest ? when(d.longest.at) : null },
      { id: 'best', label: t.facts.best, value: d.best ? fmt(d.best.ms, code) : '—', sub: d.best ? when(d.best.at) : null },
    ],
    favourite: favourite || null,
    tier,
    comment: variants[Math.floor(d.from / DAY) % variants.length],
    brand: BRAND,
  };
}

// Имя файла, которое предлагает окно сохранения: «Итоги недели 2026-10-29.png»
function fileName(period, lang, now = Date.now()) {
  const d = new Date(now);
  const p = (n) => String(n).padStart(2, '0');
  return `${(T[lang] || T.ru).title[PERIODS[period] ? period : 'week']} ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.png`;
}

// Из журнала на диске: то, что просит окно «Итоги». names — имена сборок (Map или объект по коду)
function card({ period, lang, hideNames, names, now, sessions } = {}) {
  return describe(build(sessions || playlog.all(), { now, period }), { lang, hideNames, names });
}

module.exports = { build, describe, card, tierOf, fmt, fileName, COMMENTS, PERIODS };
