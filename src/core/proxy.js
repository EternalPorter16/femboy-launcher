// Прокси для загрузок. Пусто — так, как настроен Windows (стек Chromium берёт системный прокси сам); можно вписать свой
const tcp = require('net');

const RULE = /^(https?|socks4|socks5):\/\/[^\s/]+$/i;

// Что вписал человек → правило для Chromium. null — «как в системе»
function rules(value) {
  const v = String(value || '').trim();
  if (!v) return null;
  if (RULE.test(v)) return v;
  if (/^[\w.-]+:\d{1,5}$/.test(v)) return 'http://' + v; // «127.0.0.1:8080» без схемы — обычный HTTP-прокси
  throw new Error('Прокси впиши так: http://адрес:порт или socks5://адрес:порт');
}

async function apply(session, value) {
  const r = rules(value);
  await session.setProxy(r ? { mode: 'fixed_servers', proxyRules: r, proxyBypassRules: '<local>' } : { mode: 'system' });
}

// Что Chromium ответил про обычный сайт («PROXY 127.0.0.1:10809; DIRECT») → обычный HTTP-прокси.
// DIRECT, SOCKS и HTTPS-прокси флагами Java не передать, для них null
function httpProxy(route) {
  const m = /^PROXY\s+([^\s:;]+):(\d{1,5})\b/i.exec(String(route || '').trim());
  return m ? { host: m[1], port: Number(m[2]) } : null;
}

// Java системный прокси не видит и ходит напрямую. Если сеть открыта только через VPN-прокси, моды с выходом в интернет
// (e4mc и другие) без этих флагов упираются в закрытую сеть. Локальные адреса и свою сеть прокси не касаются
const LOCAL = ['localhost', '127.*', '[::1]', '10.*', '192.168.*', ...Array.from({ length: 16 }, (_, i) => `172.${16 + i}.*`), '*.local'].join('|');
function javaArgs({ host, port }) {
  return [`-Dhttp.proxyHost=${host}`, `-Dhttp.proxyPort=${port}`, `-Dhttps.proxyHost=${host}`, `-Dhttps.proxyPort=${port}`, `-Dhttp.nonProxyHosts=${LOCAL}`];
}

// Отвечает ли прокси: если VPN закрыли, а системная настройка осталась, игре лучше идти напрямую
const reachable = ({ host, port }) =>
  new Promise((resolve) => {
    const s = tcp.connect({ host, port });
    const done = (ok) => (s.destroy(), resolve(ok));
    s.setTimeout(800, () => done(false));
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
  });

// По какому адресу спрашиваем Chromium, каким путём ходить в сеть: игре передаётся именно этот ответ (и проверка игры с другом смотрит на него же)
const ROUTE_URL = 'https://api.modrinth.com/';

// Прокси для игры: тот же путь, что у лаунчера (системный или свой из настроек), если прокси жив
async function forGame(session, custom, alive = reachable) {
  let route;
  try {
    route = await session.resolveProxy(ROUTE_URL);
  } catch {
    return { args: [] };
  }
  const p = httpProxy(route);
  if (!p) return { args: [] };
  const where = `${p.host}:${p.port}`;
  if (!(await alive(p))) return { args: [], note: `Прокси ${where} не отвечает — игра идёт в сеть напрямую` };
  return { args: javaArgs(p), note: `Прокси для игры: ${where} (${String(custom || '').trim() ? 'из настроек' : 'так настроен Windows'})` };
}

module.exports = { rules, apply, httpProxy, javaArgs, reachable, forGame, ROUTE_URL };
