const test = require('node:test');
const assert = require('node:assert/strict');
const { src } = require('./helpers');
const proxy = require(src('core/proxy'));
const netcheck = require(src('core/netcheck'));

test('адрес прокси из настроек: пусто — как в Windows, «адрес:порт» — HTTP, схемы понимаются, мусор отвергается', () => {
  assert.equal(proxy.rules(''), null);
  assert.equal(proxy.rules('   '), null);
  assert.equal(proxy.rules(undefined), null);
  assert.equal(proxy.rules('127.0.0.1:8080'), 'http://127.0.0.1:8080');
  assert.equal(proxy.rules('proxy.local:3128'), 'http://proxy.local:3128');
  assert.equal(proxy.rules(' socks5://10.0.0.1:1080 '), 'socks5://10.0.0.1:1080');
  assert.equal(proxy.rules('https://secure.proxy:443'), 'https://secure.proxy:443');
  for (const bad of ['что-то странное', 'ftp://x:1', 'http://', 'http://a b:1', '127.0.0.1', 'http://host:1/path']) {
    assert.throws(() => proxy.rules(bad), /Прокси впиши так: http:\/\/адрес:порт или socks5:\/\/адрес:порт/, bad);
  }
});

test('применение к сессии: пустой адрес — системный прокси, свой — фиксированный (с обходом для localhost)', async () => {
  const calls = [];
  const session = { setProxy: async (cfg) => calls.push(cfg) };
  await proxy.apply(session, '');
  await proxy.apply(session, '127.0.0.1:9');
  assert.deepEqual(calls[0], { mode: 'system' });
  assert.deepEqual(calls[1], { mode: 'fixed_servers', proxyRules: 'http://127.0.0.1:9', proxyBypassRules: '<local>' });
});

test('проверка связи: вывод «всё / часть / нужно зеркало / главное недоступно / связи нет совсем»', () => {
  const V = netcheck.verdictOf;
  const make = (down) => netcheck.TARGETS.map((t) => ({ id: t.id, core: !!t.core, ok: !down.includes(t.id) }));
  assert.equal(V(make([])), 'ok');
  assert.equal(V(make(['curseforge'])), 'partial', 'главное работает, часть остального нет');
  assert.equal(V(make(['mojang', 'assets'])), 'mirror', 'Mojang не отвечает, а зеркало доступно: файлы пойдут с него');
  assert.equal(V(make(['mojang', 'assets', 'mirror'])), 'core');
  assert.equal(V(make(['modrinth'])), 'core');
  assert.equal(V(make(netcheck.TARGETS.map((t) => t.id))), 'down');
  assert.equal(netcheck.TARGETS.length, 9);
  assert.ok(netcheck.TARGETS.every((t) => /^https:\/\//.test(t.url) && t.label));
});

test('проверка связи: причина отказа определяется по тексту ошибки', () => {
  const R = netcheck.reasonOf;
  assert.equal(R(new Error('net::ERR_TUNNEL_CONNECTION_FAILED')), 'proxy');
  assert.equal(R(new Error('net::ERR_PROXY_CONNECTION_FAILED')), 'proxy');
  assert.equal(R(Object.assign(new Error('x'), { name: 'TimeoutError' })), 'timeout');
  assert.equal(R(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } })), 'dns');
  assert.equal(R(new Error('net::ERR_NAME_NOT_RESOLVED')), 'dns');
  assert.equal(R(new Error('net::ERR_CERT_AUTHORITY_INVALID')), 'cert');
  assert.equal(R(new Error('net::ERR_CONNECTION_REFUSED')), 'refused');
  assert.equal(R(new Error('net::ERR_CONNECTION_RESET')), 'reset');
  assert.equal(R(new Error('что-то непонятное')), 'other');
});

test('прокси для игры: из ответа Chromium берётся только обычный HTTP-прокси, остальное Java так не передать', () => {
  const P = proxy.httpProxy;
  assert.deepEqual(P('PROXY 127.0.0.1:10809'), { host: '127.0.0.1', port: 10809 });
  assert.deepEqual(P('PROXY 127.0.0.1:10809; DIRECT'), { host: '127.0.0.1', port: 10809 });
  assert.deepEqual(P(' PROXY proxy.local:3128 '), { host: 'proxy.local', port: 3128 });
  for (const no of ['DIRECT', 'DIRECT; PROXY 127.0.0.1:1', 'SOCKS5 127.0.0.1:1080', 'HTTPS secure.proxy:443', '', undefined, null]) assert.equal(P(no), null, String(no));
});

test('прокси для игры: флаги JVM — прокси для http и https и обход для своей сети, без пробелов', () => {
  const args = proxy.javaArgs({ host: '127.0.0.1', port: 10809 });
  assert.deepEqual(args.slice(0, 4), ['-Dhttp.proxyHost=127.0.0.1', '-Dhttp.proxyPort=10809', '-Dhttps.proxyHost=127.0.0.1', '-Dhttps.proxyPort=10809']);
  const bypass = args.find((a) => a.startsWith('-Dhttp.nonProxyHosts=')).split('=')[1].split('|');
  for (const h of ['localhost', '127.*', '[::1]', '10.*', '192.168.*', '172.16.*', '172.31.*']) assert.ok(bypass.includes(h), h);
  assert.ok(args.every((a) => !/\s/.test(a)));
});

test('прокси для игры: отдаём только живой прокси; мёртвый, DIRECT и ошибка Chromium дают пустой список', async () => {
  const sessionOf = (route) => ({ resolveProxy: async () => route });
  const alive = async () => true;
  const ok = await proxy.forGame(sessionOf('PROXY 127.0.0.1:10809; DIRECT'), '', alive);
  assert.deepEqual(ok.args, proxy.javaArgs({ host: '127.0.0.1', port: 10809 }));
  assert.equal(ok.note, 'Прокси для игры: 127.0.0.1:10809 (так настроен Windows)');
  assert.equal((await proxy.forGame(sessionOf('PROXY 127.0.0.1:8080'), '127.0.0.1:8080', alive)).note, 'Прокси для игры: 127.0.0.1:8080 (из настроек)');
  const off = await proxy.forGame(sessionOf('PROXY 127.0.0.1:10809'), '', async () => false);
  assert.deepEqual(off, { args: [], note: 'Прокси 127.0.0.1:10809 не отвечает — игра идёт в сеть напрямую' });
  let asked = false;
  const direct = await proxy.forGame(sessionOf('DIRECT'), '', async () => ((asked = true), true));
  assert.deepEqual(direct, { args: [] });
  assert.equal(asked, false, 'без прокси соединение проверять не нужно');
  const broken = { resolveProxy: async () => Promise.reject(new Error('нет ответа')) };
  assert.deepEqual(await proxy.forGame(broken, '', alive), { args: [] });
});

test('прокси для игры: «жив ли прокси» — получается ли соединиться с портом', async () => {
  const tcp = require('node:net');
  const server = tcp.createServer((s) => s.destroy());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  assert.equal(await proxy.reachable({ host: '127.0.0.1', port }), true);
  await new Promise((resolve) => server.close(resolve));
  assert.equal(await proxy.reachable({ host: '127.0.0.1', port }), false);
});
