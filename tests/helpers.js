// Общее для тестов: свежий профиль лаунчера во временной папке. Запуск всех тестов: npm test
const path = require('path');
const fs = require('fs');
const os = require('os');

const SRC = path.join(__dirname, '..', 'src');
const src = (p) => path.join(SRC, p);

// Модули лаунчера хранят состояние внутри себя (store, кэш списка версий), поэтому каждому тесту даём их заново
function profile() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'femboy-test-')));
  for (const k of Object.keys(require.cache)) if (k.startsWith(SRC)) delete require.cache[k];
  const store = require(src('core/store'));
  store.init(dir);
  require(src('core/net')).setRetryDelay(1); // повторы запросов без секундных пауз (fetch подменяют до profile())
  return {
    dir,
    store,
    load: (m) => require(src(m)),
    done: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

// Записывает файлы из { 'путь/относительно': 'содержимое' } (Buffer или строка)
function put(root, files) {
  for (const [rel, data] of Object.entries(files)) {
    const f = path.join(root, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, data);
  }
}

// Читает все файлы папки в { 'путь': 'содержимое' }
function dump(root) {
  const out = {};
  const walk = (dir, rel) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(dir, e.name), `${rel}${e.name}/`);
      else out[`${rel}${e.name}`] = fs.readFileSync(path.join(dir, e.name), 'utf8');
    }
  };
  walk(root, '');
  return out;
}

// Тесты не должны ходить в настоящий интернет: всё, кроме 127.0.0.1, отвечает «нет связи». Вызывать до profile(),
// потому что net.js запоминает fetch при загрузке. Возвращает функцию, которая всё возвращает как было
function blockInternet() {
  const real = globalThis.fetch;
  globalThis.fetch = (url, opts) => {
    if (/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(String(url))) return real(url, opts);
    return Promise.reject(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }));
  };
  return () => {
    globalThis.fetch = real;
  };
}

// Настоящий PNG нужного размера (для проверок скинов), без внешних библиотек
function makePng(width = 64, height = 64) {
  const zlib = require('zlib');
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 8 бит на канал
  ihdr[9] = 6; // RGBA
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 4, 0x80)]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// Мини-сервер на 127.0.0.1: handler(req, body) → { status, json } | { status, body }. Возвращает { url, close, hits }
function server(handler) {
  const http = require('http');
  const hits = [];
  const srv = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let body = null;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {}
      hits.push({ method: req.method, url: req.url, body, headers: req.headers });
      const r = handler(req, body) || { status: 404 };
      res.statusCode = r.status || 200;
      if (r.json !== undefined) {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(r.json));
      } else res.end(r.body ?? '');
    });
  });
  return new Promise((resolve) =>
    srv.listen(0, '127.0.0.1', () =>
      resolve({
        url: `http://127.0.0.1:${srv.address().port}`,
        hits,
        close: () => new Promise((r) => (srv.closeAllConnections?.(), srv.close(r))),
      })
    )
  );
}

module.exports = { src, profile, put, dump, makePng, server, blockInternet, SRC };
