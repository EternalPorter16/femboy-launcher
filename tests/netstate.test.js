const test = require('node:test');
const assert = require('node:assert/strict');
const { src } = require('./helpers');

// Подменённый fetch ставим до загрузки net.js: он запоминает fetch при загрузке
function load(handler) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts) => handler(String(url), opts);
  delete require.cache[require.resolve(src('core/net'))];
  const net = require(src('core/net'));
  net.setRetryDelay(1);
  return { net, restore: () => (globalThis.fetch = real) };
}

const T = 1_000_000;

test('состояние связи: ничего не известно → всё отвечает → часть молчит → не отвечает никто', () => {
  const { net, restore } = load(() => new Response('{}'));
  try {
    assert.deepEqual(net.netState(T), { state: 'unknown', bad: [] });
    net.noteResult('api.modrinth.com', true, T);
    assert.deepEqual(net.netState(T), { state: 'ok', bad: [] });
    net.noteResult('piston-meta.mojang.com', false, T + 1);
    assert.deepEqual(net.netState(T + 2), { state: 'warn', bad: ['piston-meta.mojang.com'] }, 'один сервер молчит, другой отвечает: часть не отвечает');
    net.noteResult('api.modrinth.com', false, T + 3);
    assert.deepEqual(net.netState(T + 4), { state: 'bad', bad: ['api.modrinth.com', 'piston-meta.mojang.com'] }, 'молчат все известные: нет связи');
    // связь вернулась: сервер ответил — он снова «ок», остаётся только тот, до кого ещё не дошла очередь
    net.noteResult('api.modrinth.com', true, T + 5);
    assert.deepEqual(net.netState(T + 6), { state: 'warn', bad: ['piston-meta.mojang.com'] });
    net.noteResult('piston-meta.mojang.com', true, T + 7);
    assert.equal(net.netState(T + 8).state, 'ok');
  } finally {
    restore();
  }
});

test('один молчащий сервер — ещё не «нет связи», старые итоги забываются через десять минут', () => {
  const { net, restore } = load(() => new Response('{}'));
  try {
    net.noteResult('only.example', false, T);
    assert.deepEqual(net.netState(T + 1), { state: 'warn', bad: ['only.example'] });
    assert.deepEqual(net.netState(T + 10 * 60 * 1000 + 1), { state: 'unknown', bad: [] });
  } finally {
    restore();
  }
});

test('свой компьютер связью не считается, подписчик слышит только смену состояния', () => {
  const { net, restore } = load(() => new Response('{}'));
  try {
    const heard = [];
    const off = net.onNetState((s) => heard.push(s.state));
    net.noteResult('127.0.0.1:8080', false, T);
    net.noteResult('localhost:3000', false, T);
    net.noteResult('', false, T);
    assert.deepEqual(heard, []);
    net.noteResult('a.example', true, T);
    net.noteResult('a.example', true, T + 1);
    net.noteResult('b.example', true, T + 2);
    assert.deepEqual(heard, ['ok'], 'повторное «ок» ничего нового не говорит');
    net.noteResult('b.example', false, T + 3);
    off();
    net.noteResult('a.example', false, T + 4);
    assert.deepEqual(heard, ['ok', 'warn'], 'после отписки не слышим');
  } finally {
    restore();
  }
});

test('настоящие запросы сами пишут итог: ответ (даже ошибкой) — связь есть, сбой сети — нет, «Отменить» — не в счёт', async () => {
  let mode = 'ok';
  const { net, restore } = load((url, opts) => {
    if (mode === 'down') throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
    // «Молчащий» сервер: настоящий fetch при отмене обрывается, и подмена должна вести себя так же
    if (mode === 'hang') return new Promise((_, reject) => opts?.signal?.addEventListener('abort', () => reject(opts.signal.reason ?? new Error('aborted'))));
    return new Response(mode === '500' ? 'x' : '{}', { status: mode === '500' ? 503 : 200 });
  });
  try {
    net.resetNetState();
    await net.netFetch('https://a.example/x');
    assert.equal(net.netState().state, 'ok');
    mode = '500';
    await net.netFetch('https://b.example/x'); // сервер ответил ошибкой: до него дошли
    assert.equal(net.netState().state, 'ok');
    mode = 'down';
    await assert.rejects(net.netFetch('https://b.example/x'));
    assert.deepEqual(net.netState(), { state: 'warn', bad: ['b.example'] });
    await assert.rejects(net.netFetch('https://a.example/x'));
    assert.equal(net.netState().state, 'bad');

    // человек нажал «Отменить»: запрос оборван нами, а не сетью
    net.resetNetState();
    mode = 'hang';
    const token = net.cancelToken();
    const signal = AbortSignal.any([token.signal]);
    const pending = net.runCancellable(token, () => net.netFetch('https://c.example/x', { signal }));
    setTimeout(() => token.cancel(), 50);
    await assert.rejects(pending);
    assert.deepEqual(net.netState(), { state: 'unknown', bad: [] }, 'отмена связью не считается');
  } finally {
    restore();
  }
});
