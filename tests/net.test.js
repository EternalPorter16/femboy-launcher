const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { src } = require('./helpers');

const small = Buffer.from('hello femboy '.repeat(2000));
const smallSha = crypto.createHash('sha1').update(small).digest('hex');

// Свой сервер: быстрые ответы, 503, «принял и молчит» и очень медленная загрузка (для проверки отмены)
async function setup(t) {
  const net = require(src('core/net'));
  net.setRetryDelay(1);
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'femboy-net-')));
  const hits = { five: 0 };
  const server = http.createServer((req, res) => {
    if (req.url === '/json') return res.end(JSON.stringify({ hi: 1 }));
    if (req.url === '/small') return (res.setHeader('content-length', small.length), res.end(small));
    if (req.url === '/slow') {
      res.setHeader('content-length', 5_000_000);
      const timer = setInterval(() => (res.destroyed ? clearInterval(timer) : res.write(Buffer.alloc(100_000))), 100);
      res.on('close', () => clearInterval(timer));
      return;
    }
    if (req.url === '/five') {
      hits.five++;
      res.statusCode = 503;
      return res.end('no');
    }
    if (req.url === '/hang') return; // принимаем и молчим, как сбойный прокси
    res.statusCode = 404;
    res.end('nope');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => {
    server.closeAllConnections?.();
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { net, dir, hits, base: `http://127.0.0.1:${server.address().port}` };
}

test('запросы и загрузки: json, проверка sha1, неверный хэш, 404', async (t) => {
  const { net, dir, base } = await setup(t);
  assert.equal((await net.getJson(base + '/json')).hi, 1);
  await net.download(base + '/small', path.join(dir, 'small.bin'), { sha1: smallSha });
  assert.ok(fs.readFileSync(path.join(dir, 'small.bin')).equals(small));
  await assert.rejects(net.download(base + '/small', path.join(dir, 'bad.bin'), { sha1: '0'.repeat(40) }), /не совпал хэш/);
  assert.equal(fs.existsSync(path.join(dir, 'bad.bin')), false, 'при неверном хэше файл не остаётся');
  await assert.rejects(net.getJson(base + '/nothing'), (e) => e.status === 404);
});

test('таймаут: молчащий сервер не вешает лаунчер', async (t) => {
  const { net, base } = await setup(t);
  const started = Date.now();
  await assert.rejects(net.getJson(base + '/hang', null, { timeoutMs: 400, attempts: 1 }), /Нет связи/);
  assert.ok(Date.now() - started < 1500);
});

test('«Отменить»: загрузка прерывается за долю секунды, недокачанный файл удаляется', async (t) => {
  const { net, dir, base } = await setup(t);
  const token = net.cancelToken();
  const started = Date.now();
  const p = net.runCancellable(token, () => net.download(base + '/slow', path.join(dir, 'slow.bin'), {}));
  setTimeout(() => token.cancel(), 400);
  await assert.rejects(p, (e) => e.cancelled === true && e.message === 'Отменено');
  assert.ok(Date.now() - started < 1500);
  assert.equal(fs.existsSync(path.join(dir, 'slow.bin')), false);
});

test('«Отменить»: пауза между повторами и очередь параллельных задач прерываются сразу', async (t) => {
  const { net, base, hits } = await setup(t);
  net.setRetryDelay(800);
  try {
    let token = net.cancelToken();
    let started = Date.now();
    const retry = net.runCancellable(token, () => net.getJson(base + '/five'));
    setTimeout(() => token.cancel(), 900);
    await assert.rejects(retry, (e) => e.cancelled === true);
    assert.ok(Date.now() - started < 2500, 'не ждали все повторы');
    assert.ok(hits.five >= 1);

    token = net.cancelToken();
    started = Date.now();
    const launched = [];
    const queue = net.runCancellable(token, () => net.pool(Array.from({ length: 30 }, (_, i) => i), 3, async (i) => (launched.push(i), net.getJson(base + '/hang', null, { timeoutMs: 20000 }))));
    setTimeout(() => token.cancel(), 300);
    await assert.rejects(queue, (e) => e.cancelled === true);
    assert.ok(launched.length <= 3, `стартовало ${launched.length} из 30`);
    assert.ok(Date.now() - started < 1500);
  } finally {
    net.setRetryDelay(1);
  }
});

test('область отмены не мешает обычной работе, а уже отменённый токен запрос даже не отправляет', async (t) => {
  const { net, base } = await setup(t);
  assert.equal((await net.runCancellable(net.cancelToken(), () => net.getJson(base + '/json'))).hi, 1);
  const token = net.cancelToken();
  token.cancel();
  await assert.rejects(net.runCancellable(token, () => net.getJson(base + '/json')), (e) => e.cancelled === true);
  assert.equal(net.throwIfCancelled(), undefined, 'вне области ничего не происходит');
});

test('pool: после первой ошибки новые задачи не берутся, и пока он не вернулся, ни одна не работает', async (t) => {
  const { net } = await setup(t);
  const started = [];
  let running = 0;
  await assert.rejects(
    net.pool(Array.from({ length: 20 }, (_, i) => i), 3, async (i) => {
      started.push(i);
      running++;
      await new Promise((r) => setTimeout(r, 20));
      running--;
      if (i === 1) throw new Error('boom');
    }),
    /boom/
  );
  assert.equal(running, 0, 'все начатые задачи дошли до конца');
  assert.ok(started.length < 20, `после ошибки очередь остановилась (запущено ${started.length})`);
});

test('«нет связи» отличается от отказа сервера', async (t) => {
  const { net } = await setup(t);
  const is = net.isNetworkError;
  assert.ok(is(Object.assign(new TypeError('fetch failed'), { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } })));
  assert.ok(is(new Error('net::ERR_PROXY_CONNECTION_FAILED')));
  assert.ok(is(new Error('net::ERR_TUNNEL_CONNECTION_FAILED')));
  assert.ok(is(new Error('Нет связи с api.modrinth.com (x)')));
  assert.ok(!is(new Error('error.auth.xsts.userNotFound')) && !is('error.auth.minecraft.entitlements'), 'отказ Microsoft — не «нет связи»');
});

test('зеркало BMCLAPI: адреса Mojang, Fabric и Forge заменяются, чужие — нет', async (t) => {
  const { net } = await setup(t);
  assert.equal(net.mirrorOf('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'), 'https://bmclapi2.bangbang93.com/mc/game/version_manifest_v2.json');
  assert.equal(net.mirrorOf('https://meta.fabricmc.net/v2/versions/loader'), 'https://bmclapi2.bangbang93.com/fabric-meta/v2/versions/loader');
  assert.equal(net.mirrorOf('https://api.modrinth.com/v2/search'), null);
});
