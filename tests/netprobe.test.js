const test = require('node:test');
const assert = require('node:assert/strict');
const dgram = require('dgram');
const http = require('http');
const https = require('https');
const net = require('net');
const { src } = require('./helpers');
const tlsFixture = require('./tls-fixture');
const netprobe = require(src('core/netprobe'));

// Сервер, который отвечает как умеет handler(req, res); возвращает { port, close }
function server(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer(handler);
    srv.listen(0, '127.0.0.1', () => resolve({ port: srv.address().port, close: () => new Promise((r) => (srv.closeAllConnections?.(), srv.close(r))) }));
  });
}
// https-сервер с самоподписанным сертификатом для localhost; sni — какие имена клиенты назвали при рукопожатии
function tlsServer(handler) {
  return new Promise((resolve) => {
    const sni = [];
    const srv = https.createServer({ cert: tlsFixture.cert, key: tlsFixture.key }, handler);
    srv.on('secureConnection', (s) => sni.push(s.servername));
    srv.listen(0, '127.0.0.1', () => resolve({ port: srv.address().port, sni, close: () => new Promise((r) => (srv.closeAllConnections?.(), srv.close(r))) }));
  });
}
// Прокси, который понимает CONNECT и пересылает байты дальше; mode 'refuse' отвечает отказом. log — куда просили соединиться.
// redirectTo — порт на 127.0.0.1, куда прокси на самом деле соединяет: так запрошенный адрес напрямую недоступен, и запрос,
// который «пошёл мимо прокси», сразу виден по отказу
function connectProxy(mode = 'pass', redirectTo = null) {
  const log = [];
  const srv = http.createServer((req, res) => res.end());
  srv.on('connect', (req, client, head) => {
    log.push(req.url);
    if (mode === 'refuse') return client.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
    const [host, port] = req.url.split(':');
    const up = net.connect(redirectTo || +port, redirectTo ? '127.0.0.1' : host, () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      up.write(head);
      up.pipe(client);
      client.pipe(up);
    });
    up.on('error', () => client.destroy());
    client.on('error', () => up.destroy());
    // TLS-сервер, не дождавшись close_notify, закрывается без 'end': без этого соединение к прокси осталось бы висеть и server.close() не вернулся бы
    up.on('close', () => client.destroy());
    client.on('close', () => up.destroy());
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({ host: '127.0.0.1', port: srv.address().port, log, close: () => new Promise((r) => (srv.closeAllConnections?.(), srv.close(r))) })));
}
const closedPort = () =>
  new Promise((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

test('причины отказа узнаются по тексту ошибки Node', () => {
  const R = netprobe.reasonOf;
  assert.equal(R({ code: 'ETIMEDOUT' }), 'timeout');
  assert.equal(R(new Error('Connect Timeout Error')), 'timeout');
  assert.equal(R({ code: 'ENOTFOUND' }), 'dns');
  assert.equal(R({ code: 'ECONNREFUSED' }), 'refused');
  assert.equal(R({ code: 'ECONNRESET' }), 'reset');
  assert.equal(R(new Error('Client network socket disconnected before secure TLS connection was established')), 'reset');
  assert.equal(R(new Error('unable to verify the first certificate')), 'tls');
  assert.equal(R(new Error('что-то непонятное')), 'other');
  // Имя с адресами IPv4 и IPv6: Node складывает отказы в AggregateError, а сам он без кода и текста
  assert.equal(R(new AggregateError([Object.assign(new Error('connect ECONNREFUSED ::1:443'), { code: 'ECONNREFUSED' }), Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:443'), { code: 'ECONNREFUSED' })])), 'refused');
  assert.equal(R(new AggregateError([Object.assign(new Error('connect ETIMEDOUT 1.2.3.4:443'), { code: 'ETIMEDOUT' })])), 'timeout');
});

test('запрос напрямую: ответ в JSON разбирается, в том числе кусками', async (t) => {
  const s = await server((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.write('{"id":"de","host":"de.e4mc.link",');
    setTimeout(() => res.end('"port":25575}'), 20);
  });
  t.after(s.close);
  const r = await netprobe.getJson({ host: '127.0.0.1', port: s.port, path: '/getBestRelay', secure: false });
  assert.equal(r.ok, true);
  assert.deepEqual(r.json, { id: 'de', host: 'de.e4mc.link', port: 25575 });
  assert.ok(r.ms >= 0);
});

test('запрос напрямую: ошибка сервера, мусор вместо JSON, молчание и закрытый порт', async (t) => {
  const s = await server((req, res) => {
    if (req.url === '/404') return ((res.statusCode = 404), res.end('{}'));
    if (req.url === '/junk') return res.end('<html>');
    // /silent: не отвечаем
  });
  t.after(s.close);
  const get = (path, extra = {}) => netprobe.getJson({ host: '127.0.0.1', port: s.port, path, secure: false, timeoutMs: 300, ...extra });
  assert.deepEqual(await get('/404').then(({ ok, reason, status }) => ({ ok, reason, status })), { ok: false, reason: 'http', status: 404 });
  assert.equal((await get('/junk')).reason, 'bad-answer');
  const t0 = Date.now();
  assert.equal((await get('/silent')).reason, 'timeout');
  assert.ok(Date.now() - t0 < 2000, 'сдаётся вовремя');
  assert.equal((await get('/', { port: await closedPort() })).reason, 'refused');
});

test('запрос через HTTP-прокси действительно идёт по туннелю: адрес, до которого напрямую не достучаться, отвечает', async (t) => {
  const s = await server((req, res) => res.end('{"id":"eu","host":"eu.e4mc.link","port":25575}'));
  const off = await closedPort(); // по этому адресу никого нет: ответить может только прокси, подменив его настоящим сервером
  const px = await connectProxy('pass', s.port);
  t.after(() => Promise.all([s.close(), px.close()]));
  const base = { host: '127.0.0.1', port: off, path: '/', secure: false };
  assert.equal((await netprobe.getJson(base)).reason, 'refused', 'контроль: напрямую сюда не попасть');
  const r = await netprobe.getJson({ ...base, proxy: { host: px.host, port: px.port } });
  assert.equal(r.ok, true, `через прокси должно дойти: ${r.reason}`);
  assert.equal(r.json.id, 'eu');
  assert.deepEqual(px.log, [`127.0.0.1:${off}`]);
});

test('https через туннель прокси: сертификат проверяется по имени сервера, а запрос идёт внутри туннеля, не мимо него', async (t) => {
  const s = await tlsServer((req, res) => res.end('{"id":"eu","host":"eu.e4mc.link","port":25575}'));
  const off = await closedPort();
  const px = await connectProxy('pass', s.port);
  t.after(() => Promise.all([s.close(), px.close()]));
  const viaProxy = { host: 'localhost', port: off, tlsOptions: { ca: tlsFixture.cert }, proxy: { host: px.host, port: px.port } };
  assert.equal((await netprobe.getJson({ host: 'localhost', port: off, tlsOptions: { ca: tlsFixture.cert } })).reason, 'refused', 'контроль: напрямую сюда не попасть');
  const r = await netprobe.getJson(viaProxy);
  assert.equal(r.ok, true, `через прокси должно дойти: ${r.reason}`);
  assert.equal(r.json.host, 'eu.e4mc.link');
  assert.deepEqual(px.log, [`localhost:${off}`]);
  assert.deepEqual(s.sni, ['localhost'], 'имя сервера (SNI) называется при рукопожатии внутри туннеля: без него настоящие серверы отдают чужой сертификат');
  // Сертификат, которому лаунчер не доверяет, — это «tls», а не «всё хорошо»
  const untrusted = await netprobe.getJson({ ...viaProxy, tlsOptions: {} });
  assert.deepEqual([untrusted.ok, untrusted.reason], [false, 'tls']);
  // И напрямую (без прокси) https работает так же
  const direct = await netprobe.getJson({ host: 'localhost', port: s.port, tlsOptions: { ca: tlsFixture.cert } });
  assert.equal(direct.ok, true, `напрямую: ${direct.reason}`);
});

test('через прокси: отказ прокси и мёртвый прокси — понятные причины', async (t) => {
  const px = await connectProxy('refuse');
  t.after(px.close);
  const refused = await netprobe.getJson({ host: '127.0.0.1', port: 1, proxy: { host: px.host, port: px.port }, secure: false });
  assert.deepEqual([refused.ok, refused.reason], [false, 'proxy']);
  const dead = await netprobe.getJson({ host: '127.0.0.1', port: 1, proxy: { host: '127.0.0.1', port: await closedPort() }, secure: false });
  assert.deepEqual([dead.ok, dead.reason], [false, 'refused']);
});

test('UDP: любой ответ ретранслятора — это «доходит», тишина — нет, а имя, которого нет, — «DNS»', async (t) => {
  const answering = dgram.createSocket('udp4');
  const silent = dgram.createSocket('udp4');
  const seen = [];
  answering.on('message', (m, rinfo) => (seen.push(m), answering.send(Buffer.from([0x80, 0, 0, 0, 0]), rinfo.port, rinfo.address)));
  await Promise.all([answering, silent].map((s) => new Promise((r) => s.bind(0, '127.0.0.1', r))));
  t.after(() => [answering, silent].forEach((s) => s.close()));
  const ok = await netprobe.udpProbe({ host: '127.0.0.1', port: answering.address().port, timeoutMs: 1000 });
  assert.equal(ok.ok, true);
  assert.equal(seen[0].length, 1200, 'послан пакет не меньше 1200 байт: меньший QUIC-сервер вправе проигнорировать');
  const quiet = await netprobe.udpProbe({ host: '127.0.0.1', port: silent.address().port, timeoutMs: 250 });
  assert.deepEqual([quiet.ok, quiet.reason], [false, 'timeout']);
  // Настоящий DNS в тесте не нужен (у VPN он отвечает по-своему): вместо него подставляем «такого имени нет»
  const noName = (host, opts, cb) => cb(Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: 'ENOTFOUND' }));
  const nowhere = await netprobe.udpProbe({ host: 'no-such-relay.example', timeoutMs: 1500, lookup: noName });
  assert.deepEqual([nowhere.ok, nowhere.reason], [false, 'dns']);
});

test('пакет-проба: длинный заголовок QUIC, зарезервированная версия, 1200 байт', () => {
  const p = netprobe.quicProbePacket();
  assert.equal(p.length, 1200);
  assert.equal(p[0], 0xc0);
  assert.equal(p.readUInt32BE(1), 0x1a2a3a4a);
  assert.equal(p[5], 8);
});
