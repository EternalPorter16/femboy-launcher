const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');

const UA = `FemboyLauncher/${require('../../package.json').version}`;

// Зеркало BMCLAPI для серверов Mojang, Fabric, Forge и NeoForge: выручает, когда официальные тормозят или недоступны
const BMCL = 'https://bmclapi2.bangbang93.com';
const MIRRORS = [
  ['https://piston-meta.mojang.com/', `${BMCL}/`],
  ['https://launchermeta.mojang.com/', `${BMCL}/`],
  ['https://resources.download.minecraft.net/', `${BMCL}/assets/`],
  ['https://libraries.minecraft.net/', `${BMCL}/maven/`],
  ['https://maven.minecraftforge.net/', `${BMCL}/maven/`],
  ['https://files.minecraftforge.net/maven/', `${BMCL}/maven/`],
  ['https://maven.neoforged.net/releases/', `${BMCL}/maven/`],
  ['https://maven.fabricmc.net/', `${BMCL}/maven/`],
  ['https://meta.fabricmc.net/', `${BMCL}/fabric-meta/`],
];
function mirrorOf(url) {
  const m = MIRRORS.find(([from]) => url.startsWith(from));
  return m ? m[1] + url.slice(m[0].length) : null;
}

// Хосты, у которых в этой сессии уже выручило зеркало, — дальше сразу идём на зеркало
const preferMirror = new Set();

function sourceMode() {
  try {
    return require('./store').get().settings.downloadSource || 'auto';
  } catch {
    return 'auto';
  }
}

// Порядок адресов для попыток: официальный и зеркало (в зависимости от настройки)
function candidates(url) {
  const mirror = mirrorOf(url);
  const mode = sourceMode();
  if (!mirror || mode === 'official') return [url];
  if (mode === 'mirror' || preferMirror.has(new URL(url).host)) return [mirror, url];
  return [url, mirror];
}

/* ---------- «Отменить»: токен лежит в области, всё запущенное внутри прерывается вместе ---------- */

// Через AsyncLocalStorage отмена доходит до запросов, загрузок и очереди параллельных задач, и не нужно
// передавать флажок через каждую функцию
const scope = new AsyncLocalStorage();

class Cancelled extends Error {
  constructor() {
    super('Отменено');
    this.name = 'Cancelled';
    this.cancelled = true;
  }
}

function cancelToken() {
  const ctrl = new AbortController();
  return { signal: ctrl.signal, cancel: () => ctrl.abort() };
}
const runCancellable = (token, fn) => scope.run(token, fn);
const scopeSignal = () => scope.getStore()?.signal;
function throwIfCancelled() {
  if (scopeSignal()?.aborted) throw new Cancelled();
}
// Пауза, которую можно прервать отменой
const sleep = (ms) =>
  new Promise((resolve, reject) => {
    const cancel = scopeSignal();
    if (cancel?.aborted) return reject(new Cancelled());
    const done = () => {
      cancel?.removeEventListener('abort', stop);
      resolve();
    };
    const timer = setTimeout(done, ms);
    const stop = () => (clearTimeout(timer), reject(new Cancelled()));
    cancel?.addEventListener('abort', stop, { once: true });
  });

/* ---------- сам запрос: стек Chromium (системный прокси) или обычный fetch ---------- */

const nodeFetch = globalThis.fetch.bind(globalThis);
// Хосты, до которых Chromium не достучался, а обычный fetch смог (бывает, что прокси из настроек Windows мёртв)
const viaNode = new Set();

function electronNet() {
  try {
    const { net, app } = require('electron');
    return net && app?.isReady?.() ? net : null;
  } catch {
    return null; // тесты без Электрона
  }
}

// Электрон ходит в сеть стеком Chromium: он понимает системный прокси (v2rayN, Clash, Happ в режиме «системный
// прокси»), PAC-скрипты и сертификаты из хранилища Windows (антивирус, который проверяет HTTPS). Обычный fetch из Node
// всего этого не знает: у кого интернет идёт через прокси, лаунчер до Modrinth и Mojang просто не доставал.
// Возвращает { res, via }, где via — каким способом дошло
async function netRoute(url, opts = {}) {
  const u = String(url);
  let host = '';
  try {
    host = new URL(u).host;
  } catch {}
  const net = electronNet();
  if (net && host && /^https?:/i.test(u) && !viaNode.has(host)) {
    try {
      return { res: await net.fetch(u, { credentials: 'omit', ...opts }), via: 'chromium' };
    } catch (e) {
      if (opts.signal?.aborted) throw e;
      try {
        const res = await nodeFetch(u, opts);
        viaNode.add(host);
        return { res, via: 'node' };
      } catch {
        throw e;
      }
    }
  }
  return { res: await nodeFetch(u, opts), via: 'node' };
}
/* ---------- «есть ли связь»: по тому, чем заканчиваются настоящие запросы, без фонового опроса ---------- */

// Лаунчер, когда с ним ничего не делают, спит и сам в сеть не ходит. Поэтому состояние берётся из итогов запросов, которые и
// так идут: сервер ответил (пусть и ошибкой) — связь с ним есть, упал по сети или промолчал до таймаута — связи нет.
// Смотрим на последний итог по каждому серверу: ok — все отвечали, warn — часть не отвечает, bad — не отвечает никто (и их
// не меньше двух: один молчащий сервер ещё не повод говорить «нет связи»)
const RECENT_MS = 10 * 60 * 1000;
const lastByHost = new Map(); // хост → { at, ok }
const stateListeners = new Set();
let lastStateKey = JSON.stringify({ state: 'unknown', bad: [] });

function netState(now = Date.now()) {
  const alive = [...lastByHost].filter(([, v]) => now - v.at <= RECENT_MS);
  if (!alive.length) return { state: 'unknown', bad: [] };
  const bad = alive.filter(([, v]) => !v.ok).map(([h]) => h).sort();
  if (!bad.length) return { state: 'ok', bad: [] };
  return { state: alive.length === bad.length && bad.length >= 2 ? 'bad' : 'warn', bad };
}

function noteResult(host, ok, now = Date.now()) {
  host = String(host || '').toLowerCase();
  if (!host || /^(localhost|127\.|\[::1\]|::1)/.test(host)) return; // свой компьютер связью не считается: тесты, локальный сервер скинов
  lastByHost.set(host, { at: now, ok: !!ok });
  const s = netState(now);
  const key = JSON.stringify(s);
  if (key === lastStateKey) return;
  lastStateKey = key;
  for (const fn of stateListeners) {
    try {
      fn(s);
    } catch {}
  }
}
const onNetState = (fn) => (stateListeners.add(fn), () => stateListeners.delete(fn));
const resetNetState = () => {
  lastByHost.clear();
  lastStateKey = JSON.stringify({ state: 'unknown', bad: [] });
};

// Через эту воронку идёт почти вся сеть лаунчера, поэтому итог записываем здесь
const netFetch = async (url, opts) => {
  let host = '';
  try {
    host = new URL(String(url)).host;
  } catch {}
  try {
    const res = (await netRoute(url, opts)).res;
    noteResult(host, true);
    return res;
  } catch (e) {
    if (!scopeSignal()?.aborted) noteResult(host, false); // «Отменить» — не ошибка связи
    throw e;
  }
};
// Сменили прокси — прежние выводы «до этого хоста Chromium не достучался» больше не верны
const resetRoutes = () => viaNode.clear();

// Другие библиотеки (вход Microsoft и прочие) берут обычный fetch: подменяем его, чтобы и они шли тем же путём
function installGlobalFetch() {
  if (globalThis.fetch.__femboy) return;
  const wrapped = (input, init) => (typeof input === 'string' || input instanceof URL ? netFetch(String(input), init || {}) : nodeFetch(input, init));
  wrapped.__femboy = true;
  globalThis.fetch = wrapped;
}

// Ошибка похожа на «нет связи», а не на отказ сервера (чтобы не говорить «сессия устарела», когда просто нет интернета)
const NET_ERROR = /ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|UND_ERR|ERR_SSL|ERR_NETWORK|ERR_CONNECTION|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|ERR_PROXY|ERR_TUNNEL|ERR_TIMED_OUT|ERR_FAILED|ERR_CERT|net::ERR_|Failed to fetch|fetch failed|network|timeout|Нет связи/i;
const isNetworkError = (e) => NET_ERROR.test([e?.code, e?.cause?.code, e?.cause?.message, e?.message, typeof e === 'string' ? e : ''].filter(Boolean).join(' '));

// Пробуем адреса по очереди; на зеркало переключаемся при обрыве связи или ошибке сервера, но не при 404
async function withFallback(url, fn) {
  const list = candidates(url);
  let lastError;
  for (const [i, u] of list.entries()) {
    try {
      const result = await fn(u, list.length > 1 && i === 0 ? 2 : 5);
      if (u !== url && i > 0) preferMirror.add(new URL(url).host);
      return result;
    } catch (e) {
      lastError = e;
      if (e.cancelled) throw e;
      if (e.status && e.status < 500 && e.status !== 403 && e.status !== 429) throw e;
    }
  }
  throw lastError;
}

// Сеть бывает нестабильной: при обрыве соединения или 5xx пробуем ещё пару раз.
// Без своего таймаута запрос мог висеть минутами, если сервер принял соединение и молчит (так ведут себя сбойные
// прокси и VPN): тогда не срабатывали ни повторы, ни зеркало. Большие загрузки передают свой signal и следят за стоянием сами
let retryMs = 800;
const setRetryDelay = (ms) => {
  retryMs = ms; // пауза между повторами; тесты ставят её в 1 мс, чтобы не ждать секундами
};

async function request(url, opts = {}, attempts = 5) {
  const { timeoutMs = 40000, ...rest } = opts;
  for (let i = 1; ; i++) {
    throwIfCancelled();
    const cancel = scopeSignal();
    const signals = [rest.signal || AbortSignal.timeout(timeoutMs), cancel].filter(Boolean);
    const signal = signals.length > 1 ? AbortSignal.any(signals) : signals[0];
    let res;
    try {
      res = await netFetch(url, { ...rest, signal, headers: { 'User-Agent': UA, ...rest.headers } });
    } catch (e) {
      if (cancel?.aborted) throw new Cancelled();
      if (i >= attempts || rest.signal?.aborted) throw new Error(`Нет связи с ${new URL(url).host} (${e.cause?.code || e.message})`);
      await sleep(retryMs * i);
      continue;
    }
    if (res.ok) return res;
    if (res.status >= 500 && i < attempts) {
      await sleep(retryMs * i);
      continue;
    }
    throw Object.assign(new Error(`HTTP ${res.status} — ${url}`), { status: res.status });
  }
}

// opts: { timeoutMs, attempts } — для запросов, которые должны сдаваться быстро (список версий в окне)
async function getJson(url, headers, opts = {}) {
  return withFallback(url, async (u, attempts) => (await request(u, { headers, timeoutMs: opts.timeoutMs }, opts.attempts || attempts)).json());
}

// opts: { timeoutMs, attempts } — для запросов «по возможности», которые не стоят долгого ожидания
async function postJson(url, body, headers, opts = {}) {
  const res = await request(
    url,
    {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json', ...headers },
      timeoutMs: opts.timeoutMs,
    },
    opts.attempts
  );
  return res.json();
}

const STALL_MS = 30000;

async function downloadOnce(url, dest, { onProgress, sha1, headers }, attempts) {
  // Если данные перестали идти на 30 секунд — обрываем, иначе загрузка может висеть вечно
  const ctrl = new AbortController();
  const cancel = scopeSignal();
  const onCancel = () => ctrl.abort();
  cancel?.addEventListener('abort', onCancel, { once: true });
  if (cancel?.aborted) ctrl.abort();
  let stall = setTimeout(() => ctrl.abort(), STALL_MS);
  const bump = () => {
    clearTimeout(stall);
    stall = setTimeout(() => ctrl.abort(), STALL_MS);
  };
  const hash = crypto.createHash('sha1');
  const tmp = `${dest}.${crypto.randomBytes(8).toString('hex')}.part`;
  let source;
  let out;
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const res = await request(url, { headers, signal: ctrl.signal }, attempts);
    const total = Number(res.headers.get('content-length')) || 0;
    let received = 0;
    const meter = new Transform({
      transform(value, _encoding, callback) {
        try {
          bump();
          received += value.length;
          hash.update(value);
          onProgress?.(received, total);
          callback(null, value);
        } catch (e) { callback(e); }
      },
    });
    source = Readable.fromWeb(res.body);
    out = fs.createWriteStream(tmp, { flags: 'wx' });
    await pipeline(source, meter, out, { signal: ctrl.signal });
    if (sha1 && hash.digest('hex') !== sha1.toLowerCase()) {
      throw Object.assign(new Error(`Файл повреждён (не совпал хэш): ${path.basename(dest)}`), { retry: true });
    }
    throwIfCancelled();
    // Replace only a fully written, verified file. Renaming also preserves any
    // hardlinked snapshot without modifying its bytes.
    require('./fsx').renameRetry(tmp, dest);
  } catch (e) {
    if (cancel?.aborted) throw new Cancelled();
    if (ctrl.signal.aborted) throw Object.assign(new Error(`Загрузка зависла: ${new URL(url).host}`), { retry: true });
    throw e;
  } finally {
    clearTimeout(stall);
    cancel?.removeEventListener('abort', onCancel);
    source?.destroy();
    // On Electron's Node 20 an already-aborted pipeline may reject before the
    // WriteStream has opened and closed its file. Wait before removing our temp.
    const closed = out && !out.closed ? new Promise((resolve) => out.once('close', resolve)) : null;
    out?.destroy();
    if (closed) await closed;
    removeFile(tmp);
  }
}

// Только что закрытый файл Windows иногда на миг не отдаёт (его проверяет антивирус или индексатор): удаление отвечает EPERM.
// Пробуем несколько раз, а если не вышло — не подменяем настоящую ошибку загрузки чужой «операция не разрешена»
function removeFile(file) {
  try {
    fs.rmSync(file, { force: true, maxRetries: 6, retryDelay: 40 });
  } catch {}
}

// Качает файл потоково; если передан sha1 — сверяет хэш. Зависшие и битые загрузки повторяет,
// при проблемах с официальным сервером переключается на зеркало
async function download(url, dest, opts = {}) {
  return withFallback(url, async (u, attempts) => {
    for (let i = 1; ; i++) {
      try {
        return await downloadOnce(u, dest, opts, attempts);
      } catch (e) {
        if (e.cancelled || !e.retry || i >= (attempts > 2 ? 3 : 2)) throw e;
      }
    }
  });
}

// Путь из модпака не должен выходить за папку сборки
function safeJoin(base, rel) {
  const root = path.resolve(base);
  const full = path.resolve(root, rel);
  if (!full.startsWith(root + path.sep)) throw new Error('Небезопасный путь в модпаке: ' + rel);
  return full;
}

// Параллельная обработка с ограничением числа одновременных задач. После первой ошибки (или «Отменить») новые задачи
// не берутся, а когда pool возвращает управление, ни одна из них уже не работает: можно спокойно чистить папку
async function pool(items, limit, fn) {
  let next = 0;
  let failure = null;
  const worker = async () => {
    try {
      while (!failure && next < items.length) {
        throwIfCancelled();
        const i = next++;
        await fn(items[i], i);
      }
    } catch (e) {
      failure ||= { e };
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  if (failure) throw failure.e;
}

module.exports = { getJson, postJson, download, safeJoin, pool, mirrorOf, netFetch, netRoute, resetRoutes, setRetryDelay, netState, noteResult, onNetState, resetNetState, installGlobalFetch, isNetworkError, Cancelled, cancelToken, cancelSignal: scopeSignal, runCancellable, throwIfCancelled, sleep };
