// «Проверка игры с другом»: за несколько секунд проверяет то, от чего зависит открытие мира для друга через мод e4mc.
// Ничего не меняет и игру не запускает: читает файлы сборки и делает два-три запроса (HTTPS к серверу e4mc и один UDP-пакет
// ретранслятору), причём тем путём, каким пойдёт сама игра. Результат — коды и данные, а тексты подставляет окно (так их можно перевести)
const fs = require('fs');
const path = require('path');
const fsx = require('./fsx');
const proxy = require('./proxy');
const netprobe = require('./netprobe');

const DEFAULT_BROKER = 'https://broker.e4mc.link/getBestRelay';
const FALLBACK_RELAYS = ['eu.e4mc.link', 'de.e4mc.link']; // если сервер e4mc не ответил и ретранслятор неизвестен
const RELAY_RE = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.e4mc\.link$/i; // чужие адреса из ответа сервера не трогаем
const E4MC = /^e4mc/i;
const LAN_MOD = /mcwifipnp|lan[-_ ]?world/i;

// Настройки e4mc из config/e4mc/e4mc.toml: брокера и ретранслятор можно поменять
function e4mcConfig(gameDir) {
  const out = { brokerUrl: DEFAULT_BROKER, useBroker: true, relayHost: 'test.e4mc.link', relayPort: 25575 };
  let text;
  try {
    text = fs.readFileSync(path.join(gameDir, 'config', 'e4mc', 'e4mc.toml'), 'utf8');
  } catch {
    return out;
  }
  const str = (k) => new RegExp(`^\\s*${k}\\s*=\\s*"([^"]*)"`, 'm').exec(text)?.[1];
  const num = (k) => Number(new RegExp(`^\\s*${k}\\s*=\\s*(\\d+)`, 'm').exec(text)?.[1]);
  const bool = (k) => new RegExp(`^\\s*${k}\\s*=\\s*(true|false)`, 'm').exec(text)?.[1];
  if (str('brokerUrl')) out.brokerUrl = str('brokerUrl');
  if (bool('useBroker')) out.useBroker = bool('useBroker') === 'true';
  if (str('relayHost')) out.relayHost = str('relayHost');
  if (num('relayPort')) out.relayPort = num('relayPort');
  return out;
}

function brokerTarget(url) {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) throw new Error('не http');
    return { host: u.hostname, port: Number(u.port) || (u.protocol === 'https:' ? 443 : 80), path: u.pathname + u.search, secure: u.protocol === 'https:' };
  } catch {
    return brokerTarget(DEFAULT_BROKER);
  }
}

// Миры, в настройках которых мод LAN World Plug-n-Play держит включённым «Белый список» (его включают заново при каждом открытии мира)
function worldsWithWhitelist(gameDir) {
  const saves = path.join(gameDir, 'saves');
  let names;
  try {
    names = fs.readdirSync(saves, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
  return names.filter((n) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(saves, n, 'mcwifipnp.json'), 'utf8'))['enforce-whitelist'] === true;
    } catch {
      return false;
    }
  });
}

const find = (mods, re) => mods.find((m) => re.test(m.file) || re.test(m.title || ''));

// input: { gameDir, mods (список модов сборки), nicks, offline (кто-то без лицензии), route (ответ Chromium «PROXY …» или «DIRECT») }
// deps подменяют сеть в тестах. Возвращает { verdict: 'ok' | 'warn' | 'fail', items: [{ id, status, code, data }], ms }
async function run({ gameDir, mods = [], nicks = [], offline = false, route = 'DIRECT' }, deps = {}) {
  const reachable = deps.reachable || proxy.reachable;
  const getJson = deps.getJson || netprobe.getJson;
  const udpProbe = deps.udpProbe || netprobe.udpProbe;
  const t0 = Date.now();
  const items = [];
  const add = (id, status, code, data = {}) => items.push({ id, status, code, data });
  // Сбой одной проверки не должен ронять окно: он становится строкой «не получилось проверить»
  const guard = async (id, fn) => {
    try {
      await fn();
    } catch (e) {
      add(id, 'warn', 'probe-error', { message: String(e?.message || e).slice(0, 200) });
    }
  };
  const cfg = e4mcConfig(gameDir);

  await guard('e4mc', () => {
    const m = find(mods, E4MC);
    if (!m) add('e4mc', 'fail', 'mod-e4mc-missing');
    else if (!m.enabled) add('e4mc', 'fail', 'mod-e4mc-off', { file: m.file });
    else add('e4mc', 'ok', 'mod-e4mc-ok', { file: m.file });
  });
  if (offline || nicks.length) {
    await guard('lan', () => {
      const m = find(mods, LAN_MOD);
      if (!m) add('lan', 'fail', 'mod-lan-missing');
      else if (!m.enabled) add('lan', 'fail', 'mod-lan-off', { file: m.file });
      else add('lan', 'ok', 'mod-lan-ok', { file: m.file });
    });
  }

  // Как игра выйдет в сеть: HTTP-прокси ей передаётся флагами Java, только если он отвечает; всё остальное — напрямую
  let viaProxy = null;
  await guard('route', async () => {
    const first = String(route || '').split(';')[0].trim();
    const p = proxy.httpProxy(route);
    if (!first || /^DIRECT$/i.test(first)) add('route', 'ok', 'route-direct');
    else if (!p) add('route', 'warn', 'route-unsupported', { kind: first.split(/\s+/)[0].toUpperCase() });
    else if (await reachable(p)) {
      viaProxy = p;
      add('route', 'ok', 'route-proxy', { host: p.host, port: p.port });
    } else add('route', 'warn', 'route-dead', { host: p.host, port: p.port });
  });

  let relay = null;
  await guard('broker', async () => {
    if (!cfg.useBroker) {
      relay = { host: cfg.relayHost, port: cfg.relayPort };
      return add('broker', 'ok', 'broker-off', { host: cfg.relayHost });
    }
    const target = brokerTarget(cfg.brokerUrl);
    const probe = (px) => getJson({ ...target, proxy: px, timeoutMs: 8000 });
    // Тем путём, каким пойдёт игра, и (для диагноза) другим. Другой начинаем сразу, но ждём его, только если первый не вышел:
    // закрытый напрямую адрес молчит до таймаута, и проверка из-за него длилась бы все 8 секунд
    const mainRun = probe(viaProxy);
    const otherRun = viaProxy ? probe(null) : null;
    const main = await mainRun;
    const via = viaProxy ? 'proxy' : 'direct';
    const other = main.ok ? null : await otherRun;
    if (main.ok) {
      const j = main.json || {};
      if (!RELAY_RE.test(String(j.host || ''))) return add('broker', 'warn', 'broker-bad-answer');
      relay = { host: j.host, port: Number.isInteger(j.port) && j.port > 0 && j.port < 65536 ? j.port : 25575 };
      add('broker', 'ok', 'broker-ok', { relay: j.id || j.host, host: j.host, ms: main.ms, via });
    } else if (other?.ok) add('broker', 'fail', 'broker-fail-other-ok', { reason: main.reason, via });
    else add('broker', 'fail', 'broker-fail', { reason: main.reason, status: main.status, via, directReason: other ? other.reason : undefined });
  });

  await guard('udp', async () => {
    const hosts = relay ? [relay.host] : FALLBACK_RELAYS;
    const port = relay?.port || 25575;
    const results = await Promise.all(hosts.map((host) => udpProbe({ host, port, timeoutMs: 3000 })));
    const ok = results.find((r) => r.ok);
    if (ok) add('udp', 'ok', 'udp-ok', { host: ok.host, ms: ok.ms, guessed: !relay });
    else add('udp', 'fail', 'udp-fail', { hosts, reason: results[0]?.reason, guessed: !relay });
  });

  await guard('whitelist', () => {
    const worlds = worldsWithWhitelist(gameDir);
    const wl = fsx.readJson(path.join(gameDir, 'whitelist.json'));
    if (worlds.length && !nicks.length) add('whitelist', 'warn', 'wl-enforced-empty', { worlds });
    else if (wl.exists && !(wl.ok && Array.isArray(wl.data))) add('whitelist', 'warn', 'wl-broken');
    else if (worlds.length) add('whitelist', 'ok', 'wl-enforced', { worlds, nicks });
    else if (nicks.length) add('whitelist', 'ok', 'wl-ready', { nicks });
  });

  const rank = { ok: 0, warn: 1, fail: 2 };
  const verdict = items.reduce((v, i) => (rank[i.status] > rank[v] ? i.status : v), 'ok');
  return { verdict, items, ms: Date.now() - t0 };
}

module.exports = { run, e4mcConfig, brokerTarget, worldsWithWhitelist, FALLBACK_RELAYS };
