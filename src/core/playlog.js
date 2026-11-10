// Журнал сессий игры для «Времени в игре»: когда и сколько играли. Лежит отдельным файлом playlog.json в папке данных:
// [[начало, конец, номер сборки], …] в миллисекундах. Хранится не больше 400 дней и 5000 записей; сессии короче пяти секунд
// (вылет при запуске) не пишутся. Общее время сборки, как и раньше, считает instances (playtime), журнал его не заменяет
const path = require('path');
const store = require('./store');
const fsx = require('./fsx');

const DAY = 24 * 3600e3;
const KEEP_MS = 400 * DAY;
const KEEP_N = 5000;
const MIN_MS = 5000;

const file = () => path.join(store.baseDir(), 'playlog.json');
const valid = (e) => Array.isArray(e) && Number.isFinite(e[0]) && Number.isFinite(e[1]) && e[1] >= e[0] && typeof e[2] === 'string' && e[2] !== '';

function read() {
  const r = fsx.readJson(file());
  return r.ok && Array.isArray(r.data) ? r.data.filter(valid) : [];
}

// Старое и лишнее прочь; остаются самые свежие. now — «сегодня» для отсчёта давности
function prune(list, now) {
  return list
    .filter((e) => e[1] >= now - KEEP_MS)
    .sort((a, b) => a[0] - b[0])
    .slice(-KEEP_N);
}

// Записывает сессию; отвечает, записана ли она (слишком короткие и негодные не пишутся)
function add(id, start, end) {
  if (typeof id !== 'string' || !id || !Number.isFinite(start) || !Number.isFinite(end) || end - start < MIN_MS) return false;
  fsx.writeJsonAtomic(file(), prune([...read(), [start, end, id]], end), false);
  return true;
}

const all = () => read().map(([start, end, id]) => ({ id, start, end })).sort((a, b) => a.start - b.start);

const dayStart = (ms) => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
const addDays = (ms, n) => {
  const d = new Date(ms);
  d.setDate(d.getDate() + n);
  return d.getTime();
};
const overlap = (s, from, to) => Math.max(0, Math.min(s.end, to) - Math.max(s.start, from));

// Что показать: неделя по дням (по часам компьютера, последний день — сегодня), сборки за 30 дней, всего, самая долгая сессия, с какого дня считаем.
// Сессия, шедшая через полночь, делится между днями
function summarize(sessions, { now = Date.now(), days = 7 } = {}) {
  const today = dayStart(now);
  const week = [];
  for (let i = days - 1; i >= 0; i--) {
    const at = dayStart(addDays(today, -i));
    const to = addDays(at, 1);
    week.push({ at, ms: sessions.reduce((sum, s) => sum + overlap(s, at, to), 0) });
  }
  const byId = new Map();
  for (const s of sessions) {
    const ms = overlap(s, now - 30 * DAY, now);
    if (ms > 0) byId.set(s.id, (byId.get(s.id) || 0) + ms);
  }
  return {
    since: sessions.length ? Math.min(...sessions.map((s) => s.start)) : null,
    sessions: sessions.length,
    total: sessions.reduce((sum, s) => sum + (s.end - s.start), 0),
    longest: sessions.reduce((m, s) => Math.max(m, s.end - s.start), 0),
    week,
    weekTotal: week.reduce((sum, d) => sum + d.ms, 0),
    byInstance: [...byId].map(([id, ms]) => ({ id, ms })).sort((a, b) => b.ms - a.ms),
  };
}

const summary = (opts) => summarize(all(), opts);

module.exports = { add, all, summary, summarize, prune, dayStart, addDays, overlap };
