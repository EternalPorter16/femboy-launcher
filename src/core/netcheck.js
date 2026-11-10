// «Проверить связь»: достаёт ли лаунчер до серверов, которые ему нужны, и каким путём он ходит в сеть
const { netRoute, resetRoutes, noteResult } = require('./net');

const UA = `FemboyLauncher/${require('../../package.json').version}`;
const TIMEOUT = 10000;

// core — без этого не скачать игру и моды; остальное нужно для отдельных возможностей
const TARGETS = [
  { id: 'mojang', label: 'Mojang — версии и файлы игры', url: 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json', core: true },
  { id: 'assets', label: 'Mojang — ресурсы игры', url: 'https://resources.download.minecraft.net/', core: true },
  { id: 'modrinth', label: 'Modrinth — моды и сборки', url: 'https://api.modrinth.com/v2/', core: true },
  { id: 'fabric', label: 'Fabric — загрузчик модов', url: 'https://meta.fabricmc.net/v2/versions/game' },
  { id: 'curseforge', label: 'CurseForge — моды и сборки', url: 'https://api.curseforge.com/' },
  { id: 'microsoft', label: 'Вход через Microsoft', url: 'https://login.live.com/' },
  { id: 'minecraft', label: 'Профиль и скин Minecraft', url: 'https://api.minecraftservices.com/' },
  { id: 'mirror', label: 'Зеркало BMCLAPI', url: 'https://bmclapi2.bangbang93.com/' },
  { id: 'updates', label: 'Обновления лаунчера', url: 'https://cloud-api.yandex.net/v1/disk/' },
];

// Почему не вышло — одним словом; текст по этому коду подбирает интерфейс
function reasonOf(e) {
  const text = [e?.name, e?.code, e?.cause?.code, e?.message].join(' ');
  if (/Timeout|AbortError|ETIMEDOUT|CONNECT_TIMEOUT|ERR_TIMED_OUT/i.test(text)) return 'timeout';
  if (/ENOTFOUND|EAI_AGAIN|ERR_NAME_NOT_RESOLVED/i.test(text)) return 'dns';
  if (/PROXY|TUNNEL/i.test(text)) return 'proxy';
  if (/CERT|SSL|TLS/i.test(text)) return 'cert';
  if (/ECONNREFUSED|ERR_CONNECTION_REFUSED/i.test(text)) return 'refused';
  if (/ECONNRESET|ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED|ERR_EMPTY_RESPONSE|socket hang up|UND_ERR_SOCKET/i.test(text)) return 'reset';
  return 'other';
}

async function probe(t) {
  const host = new URL(t.url).host;
  const started = Date.now();
  const base = { id: t.id, label: t.label, host, core: !!t.core };
  try {
    const { res, via } = await netRoute(t.url, { method: 'HEAD', headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(TIMEOUT) });
    res.body?.cancel?.().catch(() => {});
    if (t.core) noteResult(host, true); // индикатор связи в заголовке: нужные серверы ответили
    // Любой ответ сервера — уже связь (401 и 403 тут нормальны: мы пришли без ключа). Падает только пятисотая ошибка
    return { ...base, ok: res.status < 500, status: res.status, ms: Date.now() - started, via, reason: res.status < 500 ? null : 'server' };
  } catch (e) {
    if (t.core) noteResult(host, false);
    return { ...base, ok: false, status: 0, ms: Date.now() - started, via: null, reason: reasonOf(e) };
  }
}

// Общий вывод для человека: код, по которому интерфейс покажет подсказку
function verdictOf(items) {
  const up = (id) => items.find((i) => i.id === id)?.ok;
  if (!items.some((i) => i.ok)) return 'down';
  const coreDown = items.filter((i) => i.core && !i.ok);
  if (!coreDown.length) return items.every((i) => i.ok) ? 'ok' : 'partial';
  if (coreDown.every((i) => i.id === 'mojang' || i.id === 'assets') && up('mirror')) return 'mirror';
  return 'core';
}

async function run(session, customProxy) {
  resetRoutes(); // проверяем заново, без запомненных «этот хост лучше обычным путём»
  const items = await Promise.all(TARGETS.map(probe));
  let route = null;
  try {
    route = await session.resolveProxy('https://api.modrinth.com/');
  } catch {}
  return {
    route, // как Chromium ходит в сеть: DIRECT или PROXY адрес:порт
    custom: !!String(customProxy || '').trim(),
    // Если пришлось идти в обход Chromium, значит системный прокси не работает, а напрямую интернет есть
    bypass: items.some((i) => i.via === 'node'),
    items,
    verdict: verdictOf(items),
  };
}

module.exports = { run, TARGETS, verdictOf, reasonOf };
