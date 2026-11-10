// Поиск мода-виновника. Лаунчер выключает часть модов, человек запускает игру и говорит, повторилась ли проблема; по ответам
// круг подозреваемых сужается вдвое. Для сборки из 40 модов хватает 8 проб, а не 40.
// Моды всегда остаются согласованными: вместе с подозреваемым включаются нужные ему библиотеки (иначе игра упала бы из-за
// «не хватает мода», а не из-за виновника). Состояние лежит в папке сборки (bisect.json): поиск можно продолжить после
// перезапуска лаунчера, а моды в любой момент вернуть как были
const fs = require('fs');
const path = require('path');
const instances = require('./instances');
const mods = require('./mods');
const modmeta = require('./modmeta');
const health = require('./health');
const fsx = require('./fsx');

// ---------- алгоритм (чистые функции: проба → ответ человека) ----------

// Не хватает ответа на пробу: planner возвращает её человеку
class Need extends Error {
  constructor(set, info) {
    super('нужна проба');
    this.set = set;
    this.info = info;
  }
}

const range = (n) => Array.from({ length: n }, (_, i) => i);
const key = (set) => set.join(',');

// Подозреваемые вместе со всем, что им нужно (needs[i] — номера модов, без которых i не запустится)
function closureOf(set, needs) {
  const out = new Set();
  const stack = [...set];
  while (stack.length) {
    const i = stack.pop();
    if (out.has(i)) continue;
    out.add(i);
    for (const j of needs[i] || []) stack.push(j);
  }
  return [...out].sort((a, b) => a - b);
}

// Минимальный набор, на котором проблема остаётся (Zeller, ddmin). Нужен, когда виноват не один мод, а сочетание
function ddmin(items, fails) {
  let c = items;
  let n = 2;
  while (c.length >= 2) {
    const size = Math.ceil(c.length / n);
    const chunks = [];
    for (let i = 0; i < c.length; i += size) chunks.push(c.slice(i, i + size));
    let next = chunks.find((d) => fails(d));
    if (next) {
      c = next;
      n = 2;
      continue;
    }
    next = chunks.map((d) => c.filter((x) => !d.includes(x))).find((d) => d.length && fails(d));
    if (next) {
      c = next;
      n = Math.max(n - 1, 2);
      continue;
    }
    if (n >= c.length) break;
    n = Math.min(c.length, n * 2);
  }
  return c;
}

// fails(часть, этап, сколько_подозреваемых) → повторилась ли проблема на этой части (с нужными ей модами)
function solve(n, hints, fails) {
  if (n === 0) return { kind: 'not-mods' };
  // 0. Без модов: если проблема есть и так, дело не в них — и винить моды было бы несправедливо
  if (fails([], 'vanilla', n)) return { kind: 'not-mods' };
  if (n === 1) return { kind: 'culprit', culprits: [0] };
  // 1. Предполагаем одного виновника и делим пополам. Подсказка из отчёта о вылете («Suspected Mods») берётся первой:
  // если она верна, хватит двух проб. Вторую половину отдельно не проверяем: раз в первой чисто, виновник во второй
  let S = range(n);
  let first = true;
  while (S.length > 1) {
    let H = S.slice(0, Math.ceil(S.length / 2));
    if (first && hints.length && hints.length < S.length) H = hints;
    first = false;
    S = fails(H, 'search', S.length) ? H : S.filter((i) => !H.includes(i));
  }
  // 2. Догадку проверяем: найденный мод (с нужными ему) сам по себе вызывает проблему
  if (fails(S, 'confirm', 1)) return { kind: 'culprit', culprits: S };
  // 3. Один мод не виноват — значит, проблема в сочетании. Полный поиск; уже полученные ответы переиспользуются
  const R = ddmin(range(n), (X) => fails(X, 'combo', X.length));
  if (R.length === n) return { kind: 'all' };
  return { kind: R.length === 1 ? 'culprit' : 'combo', culprits: R };
}

// Следующая проба по уже полученным ответам (history: [{ set, crashed }]) или итог. Каждый раз считаем с начала,
// а известные ответы берём из истории: так состояние — это одна история, и поиск легко продолжить
function plan({ needs, hints = [] }, history) {
  const known = new Map(history.map((h) => [key(h.set), h.crashed]));
  const fails = (part, phase, suspects) => {
    const set = closureOf(part, needs);
    const k = key(set);
    if (known.has(k)) return known.get(k);
    throw new Need(set, { phase, suspects });
  };
  try {
    return { done: true, result: solve(needs.length, hints, fails) };
  } catch (e) {
    if (e instanceof Need) return { done: false, test: e.set, info: e.info };
    throw e;
  }
}

// «Suspected Mods: Sodium (sodium), Iris (iris)» в отчёте о вылете; «None» — подозреваемых нет
function parseSuspects(text) {
  const line = /^\s*Suspected Mods:\s*(.+)$/im.exec(String(text))?.[1]?.trim();
  if (!line || /^none$/i.test(line)) return [];
  return [...line.matchAll(/([^,()]+?)\s*\(([^()]+)\)/g)].map((m) => ({ name: m[1].trim(), id: m[2].trim() }));
}

// ---------- состояние на диске ----------

const stateFile = (id) => path.join(instances.dirOf(id), 'bisect.json');

function load(id) {
  const r = fsx.readJson(stateFile(id));
  return r.ok && r.data?.v === 1 && Array.isArray(r.data.mods) ? r.data : null;
}

const save = (id, s) => fsx.writeJsonAtomic(stateFile(id), s);

// Включённые моды сборки: кому какие моды нужны, и в таком порядке, чтобы библиотеки шли раньше тех, кому они нужны
// (тогда деление пополам скорее придёт к самой библиотеке, а не к одному из её многих пользователей)
function candidates(instId) {
  const list = mods.list(instId).filter((m) => m.enabled);
  const metas = list.map((m) => modmeta.readMeta(mods.filePath(instId, m.file)));
  const providers = new Map();
  metas.forEach((meta, i) => {
    for (const id of meta?.id ? [meta.id, ...(meta.provides || [])] : []) providers.set(id, [...(providers.get(id) || []), i]);
  });
  const fabricApi = providers.get('fabric-api') || providers.get('fabric') || [];
  const needs = metas.map((meta, i) => {
    const out = new Set();
    for (const id of meta?.depends?.keys() || []) {
      if (health.PLATFORM_IDS.has(id)) continue;
      // Отдельные модули Fabric API (fabric-resource-loader-v0…) — это сам Fabric API
      const ps = providers.get(id) || (/^fabric(-|$)/.test(id) ? fabricApi : []);
      for (const j of ps) if (j !== i) out.add(j);
    }
    return [...out];
  });
  const order = [];
  const seen = new Set();
  const visit = (i) => {
    if (seen.has(i)) return;
    seen.add(i);
    needs[i].forEach(visit);
    order.push(i);
  };
  list.forEach((_, i) => visit(i));
  const at = new Map(order.map((old, now) => [old, now]));
  return order.map((old) => ({
    file: list[old].file,
    id: metas[old]?.id || null,
    title: list[old].title || metas[old]?.name || list[old].file.replace(/\.jar$/i, ''),
    needs: needs[old].map((j) => at.get(j)).sort((a, b) => a - b),
  }));
}

// Какие моды включены для пробы: остальные подозреваемые выключаются. Моды, выключенные ещё до поиска, не трогаем
function apply(instId, s, set) {
  const on = new Set(set);
  s.mods.forEach((m, i) => mods.setEnabled(instId, m.file, on.has(i)));
}

// Номера подозреваемых из отчёта о вылете: сначала по id мода, потом по названию
function hintsFrom(instId, mods_, report) {
  let text = '';
  try {
    const dir = path.resolve(instances.gameDir(instId), 'crash-reports');
    let file = report ? path.resolve(String(report)) : null;
    if (file && !file.startsWith(dir + path.sep)) file = null; // чужие пути не читаем
    if (!file) {
      // Отчёт не указан — берём самый свежий, если вылет был недавно
      const fresh = fs.existsSync(dir)
        ? fs.readdirSync(dir).filter((f) => f.endsWith('.txt')).map((f) => ({ f: path.join(dir, f), t: fs.statSync(path.join(dir, f)).mtimeMs })).filter((x) => Date.now() - x.t < 3 * 24 * 3600e3).sort((a, b) => b.t - a.t)[0]
        : null;
      file = fresh?.f;
    }
    if (file) text = fs.readFileSync(file, 'utf8').slice(0, 300000);
  } catch {}
  const out = new Set();
  for (const s of parseSuspects(text)) {
    const i = mods_.findIndex((m) => m.id === s.id || m.title.toLowerCase() === s.name.toLowerCase());
    if (i >= 0) out.add(i);
  }
  return [...out].sort((a, b) => a - b);
}

// ---------- действия ----------

const log2 = (x) => Math.ceil(Math.log2(Math.max(2, x)));

// Что показать человеку: очередная проба или итог
function view(instId) {
  instances.get(instId);
  const s = load(instId);
  if (!s) return null;
  const p = plan({ needs: s.mods.map((m) => m.needs), hints: s.hints }, s.history);
  const done = s.history.length;
  const base = { total: s.mods.length, done, history: s.history.map((h) => ({ count: h.set.length, crashed: h.crashed })) };
  if (p.done) {
    const { kind, culprits: found = [] } = p.result;
    const libs = closureOf(found, s.mods.map((m) => m.needs)).filter((i) => !found.includes(i)).map((i) => s.mods[i].title);
    return { ...base, phase: 'done', result: { kind, culprits: found.map((i) => ({ file: s.mods[i].file, title: s.mods[i].title })), libs } };
  }
  const { phase, suspects } = p.info;
  const more = phase === 'vanilla' ? log2(s.mods.length) + 1 : phase === 'search' ? log2(suspects) : phase === 'confirm' ? 0 : 3;
  return { ...base, phase: 'test', step: done + 1, stepsMax: done + 1 + more, test: { kind: phase, count: p.test.length, mods: p.test.map((i) => s.mods[i].title) } };
}

// Начинает поиск: запоминает, что было включено, и выключает все моды (первая проба — игра без модов)
function start(instId, { report } = {}) {
  const inst = instances.get(instId);
  if (inst.loader === 'vanilla') throw new Error('В ванильной сборке нет модов');
  if (load(instId)) throw new Error('Поиск уже идёт: продолжи его или верни моды как были');
  const list = candidates(instId);
  if (list.length < 2) throw new Error('Для поиска нужно хотя бы два включённых мода');
  const s = { v: 1, startedAt: Date.now(), original: list.map((m) => m.file), mods: list, hints: hintsFrom(instId, list, report), history: [] };
  save(instId, s); // сначала запись: что бы дальше ни случилось, «как было» известно
  apply(instId, s, plan({ needs: list.map((m) => m.needs), hints: s.hints }, []).test);
  return view(instId);
}

// Ответ на текущую пробу: проблема повторилась (crashed) или нет. Готовит следующую пробу, а в конце возвращает все моды
function answer(instId, crashed) {
  instances.get(instId);
  const s = load(instId);
  if (!s) throw new Error('Поиск не начат');
  const cur = plan({ needs: s.mods.map((m) => m.needs), hints: s.hints }, s.history);
  if (cur.done) throw new Error('Поиск уже закончен');
  s.history.push({ set: cur.test, crashed: !!crashed });
  save(instId, s);
  const next = plan({ needs: s.mods.map((m) => m.needs), hints: s.hints }, s.history);
  apply(instId, s, next.done ? range(s.mods.length) : next.test); // итог известен — моды пока как были, решение за человеком
  return view(instId);
}

// Конец поиска. Все моды возвращаются как были; disable — файлы виновников, которые человек решил оставить выключенными
function finish(instId, disable = []) {
  instances.get(instId);
  const s = load(instId);
  if (!s) return { disabled: [] };
  apply(instId, s, range(s.mods.length));
  const off = [];
  for (const f of disable) {
    if (!s.original.includes(f)) continue; // трогаем только моды из этого поиска
    mods.setEnabled(instId, f, false);
    off.push(s.mods.find((m) => m.file === f).title);
  }
  fs.rmSync(stateFile(instId), { force: true });
  return { disabled: off };
}

// Сборки, где поиск начат и не закончен (после перезапуска лаунчера моды в них могут быть выключены частично)
function pending() {
  return instances.list().filter((i) => fs.existsSync(stateFile(i.id))).map((i) => ({ id: i.id, name: i.name }));
}

// Идёт ли поиск в этой сборке: пока идёт, набор модов временный, и запуск с ним не доказывает, что сборка в порядке
const isActive = (id) => fs.existsSync(stateFile(id));

module.exports = { plan, closureOf, parseSuspects, start, view, answer, finish, pending, isActive };
