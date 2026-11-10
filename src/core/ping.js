// Пинг сервера Minecraft (Server List Ping): онлайн, игроки, версия, описание, иконка
const net = require('net');
const dns = require('dns').promises;
const MAX_STATUS_BYTES = 1024 * 1024;

// Server status is untrusted. Accept only a bounded, canonical base64 PNG,
// never a data URL containing HTML or an arbitrary image format.
function faviconPng(value) {
  const prefix = 'data:image/png;base64,';
  if (typeof value !== 'string' || value.length > 65536 || !value.startsWith(prefix)) return null;
  const data = value.slice(prefix.length);
  if (!data || data.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return null;
  const bytes = Buffer.from(data, 'base64');
  if (bytes.toString('base64') !== data || bytes.length < 8 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return null;
  return value;
}

function varint(n) {
  const out = [];
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n) b |= 0x80;
    out.push(b);
  } while (n);
  return Buffer.from(out);
}

function readVarint(buf, offset) {
  let value = 0;
  let size = 0;
  for (;;) {
    if (offset + size >= buf.length) return null;
    const b = buf[offset + size];
    value |= (b & 0x7f) << (7 * size++);
    if (!(b & 0x80)) return { value, size };
    if (size > 5) throw new Error('bad varint');
  }
}

const packet = (id, ...parts) => {
  const body = Buffer.concat([varint(id), ...parts]);
  return Buffer.concat([varint(body.length), body]);
};
const str = (s) => Buffer.concat([varint(Buffer.byteLength(s)), Buffer.from(s)]);

// Текст описания сервера (MOTD) из JSON-компонента
function plain(c) {
  if (typeof c === 'string') return c.replace(/§./g, '');
  if (!c) return '';
  return (plain(c.text || '') + (c.extra || []).map(plain).join('')).replace(/§./g, '');
}

async function resolve(address) {
  let [host, port] = address.split(':');
  port = Number(port) || 25565;
  if (!address.includes(':') && !/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    try {
      const [srv] = await dns.resolveSrv(`_minecraft._tcp.${host}`);
      if (srv) [host, port] = [srv.name, srv.port];
    } catch {}
  }
  return { host, port };
}

async function ping(address, timeout = 5000) {
  const { host, port } = await resolve(String(address).trim());
  return new Promise((resolveP) => {
    const started = Date.now();
    const sock = net.createConnection({ host, port });
    let buf = Buffer.alloc(0);
    let settled = false;
    const deadline = setTimeout(() => done({ online: false, error: 'нет ответа' }), timeout);
    const done = (r) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      sock.destroy();
      resolveP(r);
    };
    sock.setTimeout(timeout, () => done({ online: false, error: 'нет ответа' }));
    sock.on('error', (e) => done({ online: false, error: e.code === 'ECONNREFUSED' ? 'выключен' : e.code || e.message }));
    sock.on('connect', () => {
      const portBuf = Buffer.alloc(2);
      portBuf.writeUInt16BE(port);
      sock.write(packet(0, varint(767), str(host), portBuf, varint(1)));
      sock.write(packet(0));
    });
    sock.on('data', (chunk) => {
      if (settled) return;
      if (buf.length + chunk.length > MAX_STATUS_BYTES) return done({ online: false, error: 'слишком большой ответ' });
      buf = Buffer.concat([buf, chunk]);
      try {
        const len = readVarint(buf, 0);
        if (len && (len.value < 1 || len.value > MAX_STATUS_BYTES)) return done({ online: false, error: 'непонятный ответ' });
        if (!len || buf.length < len.size + len.value) return;
        const id = readVarint(buf, len.size);
        const slen = readVarint(buf, len.size + id.size);
        const start = len.size + id.size + slen.size;
        if (id.value !== 0 || slen.value < 0 || start + slen.value !== len.size + len.value) throw new Error('bad status frame');
        const json = JSON.parse(buf.subarray(start, start + slen.value).toString('utf8'));
        done({
          online: true,
          latency: Date.now() - started,
          players: json.players?.online ?? 0,
          max: json.players?.max ?? 0,
          version: json.version?.name || '',
          motd: plain(json.description).trim().slice(0, 120),
          favicon: faviconPng(json.favicon),
        });
      } catch {
        done({ online: false, error: 'непонятный ответ' });
      }
    });
  });
}

module.exports = { ping };
