// «Вышли обновления модов»: в фоне раз в сутки спрашиваем Modrinth, есть ли новые версии модов каждой сборки (лёгкая проверка: один запрос по
// хэшам файлов, ничего не скачивается), а на карточке сборки появляется значок «⬆ 3 обновления». Сам ничего не ставит: установка — в окне
// «Обновить моды», где видно, что изменилось в каждой версии. Итог лежит в modwatch.json рядом с настройками лаунчера (не в папке сборки:
// та уходит в экспорт и копии) и пропадает, когда меняются моды или версия сборки. Сбои молчат: без связи значок просто не появляется
const fs = require('fs');
const path = require('path');
const store = require('./store');
const instances = require('./instances');
const modupdates = require('./modupdates');
const snapshots = require('./snapshots');
const fsx = require('./fsx');
const { isNetworkError } = require('./net');

const TTL = 24 * 3600e3; // как часто спрашиваем про одну сборку
const MAX_AGE = 3 * 24 * 3600e3; // итог старше этого не показываем: свежей проверки, видимо, не было (нет связи)
const RETRY = 6 * 3600e3; // после ошибки Modrinth про эту сборку не спрашиваем раньше
const PAUSE = 4000; // пауза между сборками: фоновая проверка не должна занимать сеть
const FIRST = 45 * 1000; // первый обход после запуска лаунчера (позже, чем у готовности к новой версии: запросы идут вразбивку)
const EVERY = 3 * 3600e3; // потом просыпаемся раз в несколько часов (спрашиваем только тех, кому пора)
const NAMES = 5; // сколько названий модов хранить для подсказки значка
const NAME_LEN = 100;

const file = () => path.join(store.baseDir(), 'modwatch.json');
const isCount = (n) => Number.isInteger(n) && n >= 0 && n < 100000;
const isTitles = (a) => Array.isArray(a) && a.length <= NAMES && a.every((s) => typeof s === 'string' && s.length <= NAME_LEN);

// Файл читаем с проверкой типов: испорченное или чужое просто не считается
function load() {
  const r = fsx.readJson(file());
  const data = r.ok && r.data && typeof r.data === 'object' && !Array.isArray(r.data) ? r.data : {};
  const out = {};
  for (const [id, e] of Object.entries(data)) {
    if (!e || typeof e !== 'object' || typeof e.sig !== 'string') continue;
    const failedAt = Number.isFinite(e.failedAt) ? { failedAt: e.failedAt } : {};
    if (Number.isFinite(e.checkedAt) && isCount(e.count) && isTitles(e.titles)) out[id] = { checkedAt: e.checkedAt, sig: e.sig, count: e.count, titles: e.titles, ...failedAt };
    else if (failedAt.failedAt) out[id] = { sig: e.sig, ...failedAt };
  }
  return out;
}
const save = (data) => fsx.writeJsonAtomic(file(), data, false);

// Что показать на карточке: null, если итога нет, моды или версия сборки с тех пор изменились или он слишком старый
function get(instId) {
  let e;
  let sig;
  try {
    e = load()[instId];
    sig = snapshots.modsSig(instId);
  } catch {
    return null;
  }
  if (!Number.isFinite(e?.checkedAt) || e.sig !== sig || Date.now() - e.checkedAt > MAX_AGE) return null;
  return { count: e.count, titles: e.titles, checkedAt: e.checkedAt };
}

const titlesOf = (list) => list.map((u) => u?.title).filter((s) => typeof s === 'string' && s.trim()).map((s) => s.slice(0, NAME_LEN)).slice(0, NAMES);

// Записывает итог: сколько обновлений и какие моды. Подпись набора модов берём ДО запроса (check) или на момент записи (record)
function put(instId, sig, count, titles) {
  const entry = { checkedAt: Date.now(), sig, count, titles };
  const data = load();
  data[instId] = entry;
  save(data);
  return entry;
}

// Проверка одной сборки. Если моды поменяются, пока ждём ответ, итог не припишется к новому набору
async function check(instId) {
  const sig = snapshots.modsSig(instId);
  const found = await modupdates.lookup(instId);
  return put(instId, sig, found.length, titlesOf(found));
}

// Окно «Обновить моды» нашло свои обновления (с учётом совместимости): значок должен показывать то же число, что окно
function record(instId, updates) {
  const list = Array.isArray(updates) ? updates : [];
  return put(instId, snapshots.modsSig(instId), list.length, titlesOf(list));
}

// Стоит ли вообще проверять: не ванильная, в папке mods есть jar
function eligible(inst) {
  if (inst.loader === 'vanilla') return false;
  try {
    return fs.readdirSync(path.join(instances.gameDir(inst.id), 'mods')).some((f) => /\.jar(\.disabled)?$/i.test(f));
  } catch {
    return false;
  }
}

// Пора ли: итога нет, моды изменились или прошли сутки; после ошибки — не раньше чем через несколько часов
function due(entry, sig, now) {
  if (!entry || entry.sig !== sig) return true;
  if (entry.failedAt && now - entry.failedAt < RETRY) return false;
  if (!Number.isFinite(entry.checkedAt)) return true;
  return now - entry.checkedAt >= TTL;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const same = (a, b) => !!a && !!b && a.sig === b.sig && a.count === b.count && a.titles?.join('\n') === b.titles?.join('\n');

async function run({ pause = sleep, onChange } = {}) {
  if (store.get().settings.modUpdatesCheck === false) return;
  const all = instances.list();
  const data = load();
  const known = new Set(all.map((i) => i.id));
  const stale = Object.keys(data).filter((id) => !known.has(id)); // сборку удалили — итог ей больше не нужен
  if (stale.length) {
    for (const id of stale) delete data[id];
    save(data);
  }
  const now = Date.now();
  const queue = all
    .filter((inst) => {
      try {
        return eligible(inst) && due(data[inst.id], snapshots.modsSig(inst.id), now);
      } catch {
        return false;
      }
    })
    .sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0)); // недавно игравшие — первыми
  for (const [i, inst] of queue.entries()) {
    if (store.get().settings.modUpdatesCheck === false) return; // выключили, пока шёл обход
    if (i) await pause(PAUSE);
    const before = load()[inst.id];
    try {
      const entry = await check(inst.id);
      if (!same(before, entry)) onChange?.(inst.id);
    } catch (e) {
      if (e.cancelled || isNetworkError(e)) return; // связи нет: остальные сборки не мучаем
      try {
        const cur = load();
        cur[inst.id] = { ...cur[inst.id], sig: snapshots.modsSig(inst.id), failedAt: Date.now() };
        save(cur);
      } catch {}
    }
  }
}

// Обход один за раз: второй вызов, пока идёт первый, ждёт его же результат
let running = null;
function sweep(opts) {
  running ||= run(opts)
    .catch(() => {}) // всё это «по возможности»: любой сбой молчит
    .finally(() => {
      running = null;
    });
  return running;
}

// Запускает фон: первый обход через минуту после старта, потом раз в несколько часов. Возвращает функцию остановки
function start({ onChange } = {}) {
  const tick = () => sweep({ onChange });
  const first = setTimeout(tick, FIRST);
  const timer = setInterval(tick, EVERY);
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}

module.exports = { get, check, record, sweep, start };
