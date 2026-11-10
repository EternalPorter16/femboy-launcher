// Пробы сети «как это сделает игра». Мод e4mc работает внутри Java и ходит в сеть сам, без Chromium: напрямую или через
// HTTP-прокси (лаунчер передаёт его флагами JVM). Здесь то же самое средствами Node: запрос к серверу e4mc по HTTPS и один
// UDP-пакет ретранслятору (мир соединяется с другом по QUIC, то есть поверх UDP)
const dgram = require('dgram');
const dns = require('dns');
const http = require('http');
const https = require('https');
const net = require('net');
const tls = require('tls');

// Почему не вышло — одним словом
function reasonOf(e) {
  // У имени с несколькими адресами (IPv4 и IPv6) Node собирает отказы в AggregateError: причина лежит в errors
  const inner = Array.isArray(e?.errors) ? e.errors.map((x) => [x?.code, x?.message].join(' ')) : [];
  const text = [e?.code, e?.name, e?.message, ...inner].join(' ');
  if (/ETIMEDOUT|timed? ?out|timeout/i.test(text)) return 'timeout';
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(text)) return 'dns';
  if (/ECONNREFUSED/i.test(text)) return 'refused';
  if (/ECONNRESET|EPIPE|ECONNABORTED|socket hang up|disconnected|terminated|closed|ended/i.test(text)) return 'reset';
  if (/CERT|SSL|TLS|handshake/i.test(text)) return 'tls';
  return 'other';
}

// Туннель через HTTP-прокси (метод CONNECT). Возвращает открытый сокет до host:port
function tunnel(proxy, host, port, onSocket) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: proxy.host, port: proxy.port });
    onSocket?.(sock);
    let head = '';
    const fail = (e) => (sock.destroy(), reject(e));
    const onData = (chunk) => {
      head += chunk.toString('latin1');
      if (!head.includes('\r\n\r\n')) return;
      sock.off('data', onData);
      const status = Number(/^HTTP\/1\.[01] (\d{3})/.exec(head)?.[1]);
      if (status === 200) {
        sock.off('error', fail);
        resolve(sock);
      } else fail(Object.assign(new Error(`прокси ответил ${status || 'не по-HTTP'}`), { reason: 'proxy' }));
    };
    sock.once('error', fail);
    sock.once('connect', () => sock.write(`CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n\r\n`));
    sock.on('data', onData);
  });
}

// GET с ответом в JSON: напрямую или через HTTP-прокси. secure: false — обычный HTTP, tlsOptions (например, ca) — для проверок.
// Всегда отвечает, не бросает: { ok, ms, json } или { ok: false, ms, reason, status? }
function getJson({ host, port = 443, path = '/', proxy = null, secure = true, timeoutMs = 8000, tlsOptions = {} }) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const sockets = [];
    let settled = false;
    const finish = (r) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sockets.forEach((s) => s.destroy());
      resolve({ ms: Date.now() - t0, ...r });
    };
    const timer = setTimeout(() => finish({ ok: false, reason: 'timeout' }), timeoutMs);
    const send = (createConnection) => {
      const req = (secure ? https : http).request(
        {
          host,
          port,
          path,
          method: 'GET',
          headers: { 'User-Agent': 'FemboyLauncher', Accept: 'application/json' },
          // Свой createConnection (туннель) Node учитывает только без agent: он молча отбрасывается, и запрос уходит напрямую, мимо прокси
          ...(createConnection ? { createConnection } : { agent: false }),
          ...(secure && tlsOptions),
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('error', (e) => finish({ ok: false, reason: reasonOf(e) }));
          res.on('end', () => {
            if (res.statusCode >= 400) return finish({ ok: false, reason: 'http', status: res.statusCode });
            try {
              finish({ ok: true, status: res.statusCode, json: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
            } catch {
              finish({ ok: false, reason: 'bad-answer', status: res.statusCode });
            }
          });
        }
      );
      req.on('socket', (s) => sockets.push(s));
      req.on('error', (e) => finish({ ok: false, reason: reasonOf(e) }));
      req.end();
    };
    if (!proxy) return send(null);
    tunnel(proxy, host, port, (s) => sockets.push(s)).then(
      (sock) => send(() => (secure ? tls.connect({ socket: sock, servername: net.isIP(host) ? undefined : host, ...tlsOptions }) : sock)),
      (e) => finish({ ok: false, reason: e.reason || reasonOf(e) })
    );
  });
}

// Пакет, на который QUIC-сервер обязан ответить «версия не поддерживается» (RFC 9000, раздел 6): длинный заголовок,
// зарезервированная версия 0x1a2a3a4a и не меньше 1200 байт. Ответ значит, что UDP до ретранслятора доходит в обе стороны
function quicProbePacket() {
  const p = Buffer.alloc(1200);
  p[0] = 0xc0;
  p.writeUInt32BE(0x1a2a3a4a, 1);
  p[5] = 8; // длина идентификатора назначения, дальше он сам; идентификатор отправителя нулевой длины
  for (let i = 6; i < 14; i++) p[i] = Math.floor(Math.random() * 256);
  return p;
}

// Один UDP-пакет ретранслятору и ожидание любого ответа. Не бросает: { ok, ms, host } или { ok: false, reason }
function udpProbe({ host, port = 25575, timeoutMs = 3000, packet = quicProbePacket(), lookup = dns.lookup }) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const sock = dgram.createSocket('udp4');
    let settled = false;
    const finish = (r) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        sock.close();
      } catch {}
      resolve({ ms: Date.now() - t0, host, ...r });
    };
    const timer = setTimeout(() => finish({ ok: false, reason: 'timeout' }), timeoutMs);
    sock.once('error', (e) => finish({ ok: false, reason: reasonOf(e) }));
    sock.once('message', (m) => finish({ ok: true, bytes: m.length }));
    lookup(host, { family: 4 }, (err, ip) => {
      if (err) return finish({ ok: false, reason: 'dns' });
      sock.send(packet, port, ip, (e) => e && finish({ ok: false, reason: reasonOf(e) }));
    });
  });
}

module.exports = { getJson, udpProbe, quicProbePacket, tunnel, reasonOf };
