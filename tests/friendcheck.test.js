const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { profile, put } = require('./helpers');

const BROKER_OK = { ok: true, ms: 700, json: { id: 'de', host: 'de.e4mc.link', port: 25575 } };
const E4MC = { file: 'e4mc-fabric-6.2.3-modern.jar', enabled: true };
const LAN = { file: 'mcwifipnp-2.1.4-26.3-fabric.jar', enabled: true };
const E4MC_TOML = 'useBroker = true\nbrokerUrl = "https://broker.e4mc.link/getBestRelay"\nrelayHost = "test.e4mc.link"\nrelayPort = 25575\n';

function setup(t) {
  const p = profile();
  t.after(() => p.done());
  const gameDir = path.join(p.dir, 'сборка', '.minecraft');
  fs.mkdirSync(gameDir, { recursive: true });
  return { gameDir, friendcheck: p.load('core/friendcheck'), put: (files) => put(gameDir, files) };
}
// Поддельная сеть: что ответит сервер e4mc напрямую и через прокси, жив ли прокси, что скажет ретранслятор по UDP. calls — кого спрашивали
function net(o = {}) {
  const calls = { getJson: [], udp: [] };
  return {
    calls,
    reachable: async () => o.proxyAlive ?? true,
    getJson: async (args) => {
      calls.getJson.push(args);
      return (args.proxy ? o.viaProxy : o.direct) ?? { ok: false, reason: 'timeout' };
    },
    udpProbe: async ({ host }) => {
      calls.udp.push(host);
      return { host, ...(o.udp ?? { ok: true, ms: 40 }) };
    },
  };
}
const codes = (r) => r.items.map((i) => i.code);
const item = (r, id) => r.items.find((i) => i.id === id);

test('всё в порядке: прямой выход в сеть, e4mc на месте, сервер и ретранслятор отвечают', async (t) => {
  const { gameDir, friendcheck } = setup(t);
  const r = await friendcheck.run({ gameDir, mods: [E4MC], route: 'DIRECT' }, net({ direct: BROKER_OK }));
  assert.equal(r.verdict, 'ok');
  assert.deepEqual(codes(r), ['mod-e4mc-ok', 'route-direct', 'broker-ok', 'udp-ok']);
  assert.deepEqual(item(r, 'broker').data, { relay: 'de', host: 'de.e4mc.link', ms: 700, via: 'direct' });
});

test('как у пользователя: напрямую сервер e4mc закрыт, через прокси открывается — игре отдан прокси, всё хорошо', async (t) => {
  const { gameDir, friendcheck } = setup(t);
  const n = net({ viaProxy: BROKER_OK, direct: { ok: false, reason: 'timeout' } });
  const r = await friendcheck.run({ gameDir, mods: [E4MC], route: 'PROXY 127.0.0.1:10809; DIRECT' }, n);
  assert.equal(r.verdict, 'ok');
  assert.deepEqual(codes(r), ['mod-e4mc-ok', 'route-proxy', 'broker-ok', 'udp-ok']);
  assert.equal(item(r, 'broker').data.via, 'proxy');
  assert.deepEqual(n.calls.getJson.map((c) => !!c.proxy).sort(), [false, true], 'проверены оба пути: тот, что у игры, и запасной для диагноза');
});

test('через прокси ответили, а напрямую молчат: проверка не ждёт молчащий путь до таймаута', async (t) => {
  const { gameDir, friendcheck } = setup(t);
  const n = net({ viaProxy: BROKER_OK });
  const getJson = (args) => (args.proxy ? n.getJson(args) : new Promise(() => {})); // напрямую — вечное молчание
  const t0 = Date.now();
  const r = await friendcheck.run({ gameDir, mods: [E4MC], route: 'PROXY 127.0.0.1:10809' }, { ...n, getJson });
  assert.equal(r.verdict, 'ok');
  assert.ok(Date.now() - t0 < 1500, 'проверка дождалась молчащего пути: на настоящем таймауте это 8 секунд впустую');
});

test('до версии 0.8.1: прокси есть, но игре он не передавался — напрямую не открывается, итог «не получится»', async (t) => {
  const { gameDir, friendcheck } = setup(t);
  const r = await friendcheck.run({ gameDir, mods: [E4MC], route: 'DIRECT' }, net({ direct: { ok: false, reason: 'timeout' } }));
  assert.equal(r.verdict, 'fail');
  assert.deepEqual(item(r, 'broker').data, { reason: 'timeout', status: undefined, via: 'direct', directReason: undefined });
  assert.equal(item(r, 'broker').code, 'broker-fail');
});

test('прокси включён, но не отвечает: предупреждение, игра идёт напрямую', async (t) => {
  const { gameDir, friendcheck } = setup(t);
  const n = net({ proxyAlive: false, direct: BROKER_OK });
  const r = await friendcheck.run({ gameDir, mods: [E4MC], route: 'PROXY 127.0.0.1:10809' }, n);
  assert.equal(item(r, 'route').code, 'route-dead');
  assert.equal(item(r, 'route').status, 'warn');
  assert.equal(r.verdict, 'warn');
  assert.deepEqual(n.calls.getJson.map((c) => c.proxy), [null], 'через мёртвый прокси не ходим');
});

test('прокси, который Java не поймёт (SOCKS): предупреждение с видом прокси', async (t) => {
  const { gameDir, friendcheck } = setup(t);
  const r = await friendcheck.run({ gameDir, mods: [E4MC], route: 'SOCKS5 127.0.0.1:1080' }, net({ direct: BROKER_OK }));
  assert.deepEqual([item(r, 'route').code, item(r, 'route').data], ['route-unsupported', { kind: 'SOCKS5' }]);
  assert.equal(r.verdict, 'warn');
});

test('через прокси не открывается, а напрямую открывается — отдельный диагноз', async (t) => {
  const { gameDir, friendcheck } = setup(t);
  const r = await friendcheck.run({ gameDir, mods: [E4MC], route: 'PROXY 127.0.0.1:10809' }, net({ viaProxy: { ok: false, reason: 'proxy' }, direct: BROKER_OK }));
  assert.deepEqual([item(r, 'broker').code, item(r, 'broker').data], ['broker-fail-other-ok', { reason: 'proxy', via: 'proxy' }]);
  assert.equal(r.verdict, 'fail');
});

test('не открывается ни через прокси, ни напрямую — видны обе причины', async (t) => {
  const { gameDir, friendcheck } = setup(t);
  const r = await friendcheck.run({ gameDir, mods: [E4MC], route: 'PROXY 127.0.0.1:10809' }, net({ viaProxy: { ok: false, reason: 'reset' }, direct: { ok: false, reason: 'timeout' } }));
  assert.deepEqual(item(r, 'broker').data, { reason: 'reset', status: undefined, via: 'proxy', directReason: 'timeout' });
});

test('сервер e4mc ответил не то, что ждали: чужой адрес ретранслятора не трогаем, UDP пробуем на запасных', async (t) => {
  const { gameDir, friendcheck } = setup(t);
  const n = net({ direct: { ok: true, ms: 100, json: { id: 'x', host: 'evil.example.com', port: 25575 } } });
  const r = await friendcheck.run({ gameDir, mods: [E4MC], route: 'DIRECT' }, n);
  assert.equal(item(r, 'broker').code, 'broker-bad-answer');
  assert.deepEqual(n.calls.udp.sort(), ['de.e4mc.link', 'eu.e4mc.link'], 'чужой адрес не пробуем');
  assert.equal(item(r, 'udp').data.guessed, true);
});

test('UDP не доходит: не получится; проверяется ретранслятор, который выдал сервер', async (t) => {
  const { gameDir, friendcheck } = setup(t);
  const n = net({ direct: BROKER_OK, udp: { ok: false, reason: 'timeout' } });
  const r = await friendcheck.run({ gameDir, mods: [E4MC], route: 'DIRECT' }, n);
  assert.deepEqual(n.calls.udp, ['de.e4mc.link']);
  assert.deepEqual([item(r, 'udp').code, item(r, 'udp').data], ['udp-fail', { hosts: ['de.e4mc.link'], reason: 'timeout', guessed: false }]);
  assert.equal(r.verdict, 'fail');
});

test('моды: e4mc нет, e4mc выключен, а для друзей без лицензии нужен ещё LAN World Plug-n-Play', async (t) => {
  const { gameDir, friendcheck } = setup(t);
  const ok = net({ direct: BROKER_OK });
  assert.equal(item(await friendcheck.run({ gameDir, mods: [], route: 'DIRECT' }, ok), 'e4mc').code, 'mod-e4mc-missing');
  assert.equal(item(await friendcheck.run({ gameDir, mods: [{ ...E4MC, enabled: false }], route: 'DIRECT' }, ok), 'e4mc').code, 'mod-e4mc-off');
  assert.equal(item(await friendcheck.run({ gameDir, mods: [E4MC], route: 'DIRECT' }, ok), 'lan'), undefined, 'без друзей LAN-мод не нужен');
  const offline = await friendcheck.run({ gameDir, mods: [E4MC], offline: true, route: 'DIRECT' }, ok);
  assert.equal(item(offline, 'lan').code, 'mod-lan-missing');
  assert.equal(offline.verdict, 'fail');
  const withNicks = await friendcheck.run({ gameDir, mods: [E4MC, LAN], nicks: ['PinkDick'], route: 'DIRECT' }, ok);
  assert.equal(item(withNicks, 'lan').code, 'mod-lan-ok');
  const off = await friendcheck.run({ gameDir, mods: [E4MC, { ...LAN, enabled: false }], nicks: ['PinkDick'], route: 'DIRECT' }, ok);
  assert.equal(item(off, 'lan').code, 'mod-lan-off');
});

test('моды по названию Modrinth: файл может называться как угодно', async (t) => {
  const { gameDir, friendcheck } = setup(t);
  const r = await friendcheck.run({ gameDir, mods: [{ file: 'something.jar', enabled: true, title: 'e4mc' }], route: 'DIRECT' }, net({ direct: BROKER_OK }));
  assert.equal(item(r, 'e4mc').code, 'mod-e4mc-ok');
});

test('белый список: включённый переключатель в мире без ников — ловушка; с никами — норма; испорченный файл — предупреждение', async (t) => {
  const { gameDir, friendcheck, put } = setup(t);
  const ok = net({ direct: BROKER_OK });
  const base = { gameDir, mods: [E4MC, LAN], route: 'DIRECT' };
  assert.equal(item(await friendcheck.run(base, ok), 'whitelist'), undefined, 'нечего сказать — строки нет');
  put({ 'saves/New World/mcwifipnp.json': JSON.stringify({ 'enforce-whitelist': true }), 'saves/Другой мир/mcwifipnp.json': JSON.stringify({ 'enforce-whitelist': false }) });
  const empty = await friendcheck.run(base, ok);
  assert.deepEqual([item(empty, 'whitelist').code, item(empty, 'whitelist').data], ['wl-enforced-empty', { worlds: ['New World'] }]);
  assert.equal(empty.verdict, 'warn');
  const named = await friendcheck.run({ ...base, nicks: ['PinkDick'], offline: true }, ok);
  assert.equal(item(named, 'whitelist').code, 'wl-enforced');
  assert.equal(named.verdict, 'ok');
  fs.rmSync(path.join(gameDir, 'saves'), { recursive: true });
  const ready = await friendcheck.run({ ...base, nicks: ['PinkDick'], offline: true }, ok);
  assert.equal(item(ready, 'whitelist').code, 'wl-ready');
  const licensed = await friendcheck.run({ ...base, nicks: ['Bart_Awesome'], offline: false }, ok);
  assert.deepEqual([item(licensed, 'whitelist').code, item(licensed, 'whitelist').data], ['wl-ready', { nicks: ['Bart_Awesome'] }], 'отмеченные друзья с лицензией лаунчер тоже впишет сам');
  put({ 'whitelist.json': '[{ "uuid": "обрыв' });
  assert.equal(item(await friendcheck.run(base, ok), 'whitelist').code, 'wl-broken');
});

test('настройки e4mc: свой брокер, брокер выключен, чужие значения не ломают проверку', async (t) => {
  const { gameDir, friendcheck, put } = setup(t);
  assert.deepEqual(friendcheck.e4mcConfig(gameDir), { brokerUrl: 'https://broker.e4mc.link/getBestRelay', useBroker: true, relayHost: 'test.e4mc.link', relayPort: 25575 }, 'файла нет — значения по умолчанию');
  put({ 'config/e4mc/e4mc.toml': E4MC_TOML.replace('useBroker = true', 'useBroker = false').replace('test.e4mc.link', 'my.e4mc.link').replace('25575', '30000') });
  const off = net({ udp: { ok: true, ms: 10 } });
  const r = await friendcheck.run({ gameDir, mods: [E4MC], route: 'DIRECT' }, off);
  assert.equal(item(r, 'broker').code, 'broker-off');
  assert.equal(off.calls.getJson.length, 0, 'брокер выключен — к нему не ходим');
  assert.deepEqual(off.calls.udp, ['my.e4mc.link']);
  put({ 'config/e4mc/e4mc.toml': E4MC_TOML.replace('https://broker.e4mc.link/getBestRelay', 'https://my.broker.test:8443/relay?x=1') });
  const custom = net({ direct: BROKER_OK });
  await friendcheck.run({ gameDir, mods: [E4MC], route: 'DIRECT' }, custom);
  assert.deepEqual({ host: custom.calls.getJson[0].host, port: custom.calls.getJson[0].port, path: custom.calls.getJson[0].path, secure: custom.calls.getJson[0].secure }, { host: 'my.broker.test', port: 8443, path: '/relay?x=1', secure: true });
  put({ 'config/e4mc/e4mc.toml': E4MC_TOML.replace('https://broker.e4mc.link/getBestRelay', 'мусор') });
  const junk = net({ direct: BROKER_OK });
  await friendcheck.run({ gameDir, mods: [E4MC], route: 'DIRECT' }, junk);
  assert.equal(junk.calls.getJson[0].host, 'broker.e4mc.link', 'непонятный адрес — берём обычный');
});

test('неожиданный сбой одной проверки не роняет остальные: появляется строка «не получилось проверить»', async (t) => {
  const { gameDir, friendcheck } = setup(t);
  const n = net({ direct: BROKER_OK });
  n.udpProbe = async () => {
    throw new Error('сокет не открылся');
  };
  const r = await friendcheck.run({ gameDir, mods: [E4MC], route: 'DIRECT' }, n);
  assert.deepEqual(codes(r), ['mod-e4mc-ok', 'route-direct', 'broker-ok', 'probe-error']);
  assert.deepEqual([item(r, 'udp').status, item(r, 'udp').data.message], ['warn', 'сокет не открылся']);
  assert.equal(r.verdict, 'warn');
});
