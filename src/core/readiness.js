// «Пора на новую версию?»: в фоне раз в сутки считаем, сколько модов сборки уже вышло под самую свежую версию Minecraft (лёгкая проверка
// переноса: два запроса к Modrinth, без названий, библиотек, миров и CurseForge), а значок на карточке говорит «готовы 38 из 40».
// Итог лежит в readiness.json рядом с настройками лаунчера (не в папке сборки: та уходит в экспорт и копии) и пропадает, когда меняются моды
// или версия сборки. Ничего не меняет и не скачивает, сбои молчат: без связи значок просто не появляется
const fs = require('fs');
const path = require('path');
const store = require('./store');
const instances = require('./instances');
const versions = require('./versions');
const migrate = require('./migrate');
const snapshots = require('./snapshots');
const fsx = require('./fsx');
const { isNetworkError } = require('./net');

const TTL = 24 * 3600e3; // как часто спрашиваем про одну сборку
const MAX_AGE = 3 * 24 * 3600e3; // итог старше этого не показываем: свежей проверки, видимо, не было (нет связи)
const RETRY = 6 * 3600e3; // после ошибки Modrinth про эту сборку не спрашиваем раньше
const PAUSE = 4000; // пауза между сборками: фоновая проверка не должна занимать сеть
const FIRST = 30 * 1000; // первый обход после запуска лаунчера
const EVERY = 3 * 3600e3; // потом просыпаемся раз в несколько часов (спрашиваем только тех, кому пора)

const file = () => path.join(store.baseDir(), 'readiness.json');
const isCount = (n) => Number.isInteger(n) && n >= 0 && n < 100000;

// Файл читаем с проверкой типов: испорченное или чужое просто не считается
function load() {
  const r = fsx.readJson(file());
  const data = r.ok && r.data && typeof r.data === 'object' && !Array.isArray(r.data) ? r.data : {};
  const out = {};
  for (const [id, e] of Object.entries(data)) {
    if (!e || typeof e !== 'object' || typeof e.sig !== 'string') continue;
    const failedAt = Number.isFinite(e.failedAt) ? { failedAt: e.failedAt } : {};
    if (typeof e.target === 'string' && Number.isFinite(e.checkedAt) && isCount(e.ready) && isCount(e.total) && e.ready <= e.total) out[id] = { checkedAt: e.checkedAt, target: e.target, ready: e.ready, total: e.total, sig: e.sig, ...failedAt };
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
  if (!e?.target || e.sig !== sig || Date.now() - e.checkedAt > MAX_AGE) return null;
  return { target: e.target, ready: e.ready, total: e.total, checkedAt: e.checkedAt };
}

// Проверка одной сборки: сколько её модов готово к версии target (обновятся или подойдут как есть). Подпись набора модов берём ДО запроса:
// если моды поменяются, пока ждём ответ, итог не припишется к новому набору
async function check(instId, target) {
  const sig = snapshots.modsSig(instId);
  const c = await migrate.quick(instId, target);
  const entry = { checkedAt: Date.now(), target, ready: c.update + c.same, total: c.total, sig };
  const data = load();
  data[instId] = entry;
  save(data);
  return entry;
}

// Стоит ли вообще проверять: не ванильная, версия — обычный релиз старше самого свежего, в папке mods есть jar
function eligible(inst, byId, latest) {
  if (inst.loader === 'vanilla') return false;
  const cur = byId.get(inst.version);
  if (!cur || cur.type !== 'release' || !(new Date(cur.releaseTime) < new Date(latest.releaseTime))) return false;
  try {
    return fs.readdirSync(path.join(instances.gameDir(inst.id), 'mods')).some((f) => /\.jar(\.disabled)?$/i.test(f));
  } catch {
    return false;
  }
}

// Пора ли: итога нет, моды изменились, вышла новая версия игры или прошли сутки; после ошибки — не раньше чем через несколько часов
function due(entry, sig, latest, now) {
  if (!entry || entry.sig !== sig) return true;
  if (entry.failedAt && now - entry.failedAt < RETRY) return false;
  if (!entry.target) return true;
  return entry.target !== latest.id || now - entry.checkedAt >= TTL;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const same = (a, b) => !!a && !!b && a.sig === b.sig && a.target === b.target && a.ready === b.ready && a.total === b.total;

async function run({ pause = sleep, onChange } = {}) {
  if (store.get().settings.readinessCheck === false) return;
  let list;
  try {
    list = await versions.listMinecraft();
  } catch {
    return; // нет списка версий — не с чем сравнивать
  }
  const byId = new Map(list.versions.map((v) => [v.id, v]));
  const latest = byId.get(list.latest?.release);
  if (!latest) return;
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
        return eligible(inst, byId, latest) && due(data[inst.id], snapshots.modsSig(inst.id), { id: latest.id }, now);
      } catch {
        return false;
      }
    })
    .sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0)); // недавно игравшие — первыми
  for (const [i, inst] of queue.entries()) {
    if (store.get().settings.readinessCheck === false) return; // выключили, пока шёл обход
    if (i) await pause(PAUSE);
    const before = load()[inst.id];
    try {
      const entry = await check(inst.id, latest.id);
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

// Запускает фон: первый обход через полминуты после старта, потом раз в несколько часов. Возвращает функцию остановки
function start({ onChange } = {}) {
  const tick = () => sweep({ onChange });
  const first = setTimeout(tick, FIRST);
  const timer = setInterval(tick, EVERY);
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}

module.exports = { get, check, sweep, start };
