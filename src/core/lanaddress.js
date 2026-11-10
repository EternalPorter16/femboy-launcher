// Прямые адреса для входа в мир, открытый по сети, на случай, когда e4mc недоступен: по локальной сети или через VPN, который есть
// у обоих (Radmin VPN, Hamachi, ZeroTier, Tailscale). Только показ: ни в сеть, ни в настройки Windows лаунчер не лезет.
// Порт берётся из строки лога игры («Published LAN server on port N»), адреса — из таблицы сетевых адаптеров
const os = require('os');
const { START, STOP, OPEN } = require('./lansession');

const MAX = 6;
// VPN, которыми играют с друзьями: по имени адаптера (а Radmin и Hamachi ещё и по диапазону адресов)
const FRIEND_VPN = [
  [/radmin/i, 'Radmin VPN'],
  [/hamachi/i, 'Hamachi'],
  [/zerotier/i, 'ZeroTier'],
  [/tailscale/i, 'Tailscale'],
];
// Адаптеры, чей адрес другу ничем не поможет: виртуальные машины, WSL, Docker, туннели прокси и обычных VPN-сервисов
const SKIP = /vethernet|vmware|virtualbox|vbox|hyper-v|wsl|docker|loopback|pseudo|bluetooth|wintun|\btun\b|\btap\b|tap-|\bclash\b|mihomo|\bmeta\b|sing-?box|nekoray|v2ray|xray/i;

// Таблица адаптеров; для проверок её подменяет FEMBOY_TEST_INTERFACES (JSON). Не вышло — пустая таблица
function systemInterfaces() {
  try {
    if (process.env.FEMBOY_TEST_INTERFACES) {
      const t = JSON.parse(process.env.FEMBOY_TEST_INTERFACES);
      return t && typeof t === 'object' ? t : {};
    }
    return os.networkInterfaces() || {};
  } catch {
    return {};
  }
}

const octets = (a) => {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(a);
  const o = m && m.slice(1).map(Number);
  return o && o.every((n) => n <= 255) ? o : null;
};
const isPrivate = ([a, b]) => a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
const isGlobal6 = (a) => (parseInt(String(a).split('%')[0].split(':')[0] || '0', 16) & 0xe000) === 0x2000; // 2000::/3

function classify4(name, o) {
  const [a, b] = o;
  if (a === 127 || a === 0 || (a === 169 && b === 254)) return null; // петля и «адрес не получен»
  const named = FRIEND_VPN.find(([re]) => re.test(name));
  if (named) return { kind: 'vpn', name: named[1] };
  if (a === 26) return { kind: 'vpn', name: 'Radmin VPN' };
  if (a === 25) return { kind: 'vpn', name: 'Hamachi' };
  if (SKIP.test(name)) return null;
  return isPrivate(o) ? { kind: 'lan', name } : null;
}

// Адреса вида { kind: 'lan' | 'vpn' | 'ipv6', name: адаптер, host, address: хост:порт }; сначала локальная сеть, потом VPN, потом IPv6
function candidates(port, interfaces = systemInterfaces()) {
  const p = Number(port);
  if (!Number.isInteger(p) || p < 1 || p > 65535 || !interfaces || typeof interfaces !== 'object') return [];
  const out = [];
  for (const [name, list] of Object.entries(interfaces)) {
    if (!Array.isArray(list)) continue;
    for (const a of list) {
      if (!a || a.internal || typeof a.address !== 'string') continue;
      const v4 = a.family === 'IPv4' || a.family === 4;
      const v6 = a.family === 'IPv6' || a.family === 6;
      if (v4) {
        const o = octets(a.address);
        const c = o && classify4(name, o);
        if (c) out.push({ ...c, host: a.address, address: `${a.address}:${p}` });
      } else if (v6 && isGlobal6(a.address) && !SKIP.test(name)) {
        out.push({ kind: 'ipv6', name, host: a.address, address: `[${a.address}]:${p}` });
      }
    }
  }
  const order = { lan: 0, vpn: 1, ipv6: 2 };
  const seen = new Set();
  return out
    .map((x, i) => [x, i])
    .sort((a, b) => order[a[0].kind] - order[b[0].kind] || a[1] - b[1])
    .map(([x]) => x)
    .filter((x) => !seen.has(x.address) && seen.add(x.address))
    .slice(0, MAX);
}

// Разбирает строки лога игры по одной. found(порт) — мир открыт по сети на этом порту (по разу на мир и порт). feed.port() — порт
// открытого мира или null; новый мир и закрытие мира порт забывают
function watcher({ found } = {}) {
  let port = null;
  const feed = (text) => {
    const s = String(text);
    let m;
    if (START.test(s) || STOP.test(s)) port = null;
    else if ((m = OPEN.exec(s))) {
      const p = Number(m[1]);
      if (p < 1 || p > 65535 || p === port) return;
      port = p;
      try {
        found?.(p);
      } catch {}
    }
  };
  feed.port = () => port;
  feed.reset = () => {
    port = null;
  };
  return feed;
}

module.exports = { candidates, watcher, systemInterfaces };
