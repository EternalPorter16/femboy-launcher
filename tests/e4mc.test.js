const test = require('node:test');
const assert = require('node:assert/strict');
const { src } = require('./helpers');
const e4mc = require(src('core/e4mc'));

// Строки взяты из настоящих логов игры: Minecraft 26.3 + e4mc 6.2.3 (удачная попытка 27.10 и неудачная 28.10)
const L = {
  req: '[08:06:35] [e4mc_minecraft-init/INFO]: broker req: https://broker.e4mc.link/getBestRelay GET',
  resp: '[08:06:36] [e4mc_minecraft-init/INFO]: broker resp: (GET https://broker.e4mc.link/getBestRelay) 200',
  relay: '[08:06:36] [e4mc_minecraft-init/INFO]: using relay eu',
  assigned: '[08:06:39] [Netty NIO IO #1/INFO]: Domain assigned: unequal-cofounder.eu.e4mc.link',
  relaymap: '[08:06:39] [Netty NIO IO #2/INFO]: relaymap req: https://natives.e4mc.link/relaymap.json GET',
  chat: '[08:06:39] [Render thread/INFO]: [System] [CHAT] Local game hosted on domain [unequal-cofounder.eu.e4mc.link] (Click here to stop)',
  connecting: '[15:02:57] [Render thread/INFO]: Connecting to broker.e4mc.link, 25565',
  error: '[14:48:34] [e4mc_minecraft-init/ERROR]: error in e4mc',
  errorChat: '[14:48:34] [Render thread/INFO]: [System] [CHAT] An error occurred in e4mc',
};
const DOMAIN = 'unequal-cofounder.eu.e4mc.link';

function run(lines) {
  const got = { addresses: [], failures: 0 };
  const feed = e4mc.watcher({ address: (a) => got.addresses.push(a), failed: () => got.failures++ });
  lines.forEach(feed);
  return got;
}

test('e4mc: удачная попытка — адресом становится выданный домен, а не служебный broker.e4mc.link', () => {
  const got = run([L.req, L.resp, L.relay, L.assigned, L.relaymap, L.chat]);
  assert.deepEqual(got.addresses, [DOMAIN]);
  assert.equal(got.failures, 0);
});

test('e4mc: служебные строки сами по себе адреса не дают (это и показывалось другу вместо адреса мира)', () => {
  for (const line of [L.req, L.resp, L.relay, L.relaymap, L.connecting]) assert.deepEqual(run([line]).addresses, [], line);
});

test('e4mc: неудачная попытка — адреса нет, об ошибке сказано один раз (строка чата её не дублирует)', () => {
  const got = run([L.req, L.error, '[14:48:34] [e4mc_minecraft-init/ERROR]: Uncaught exception in thread "e4mc_minecraft-init"', L.errorChat]);
  assert.deepEqual(got.addresses, []);
  assert.equal(got.failures, 1);
});

test('e4mc: после неудачи вторая попытка может получиться; ошибка второй попытки снова замечается', () => {
  const got = run([L.req, L.error, L.req, L.assigned, L.req, L.error]);
  assert.deepEqual(got.addresses, [DOMAIN]);
  assert.equal(got.failures, 2);
});

test('e4mc: мир открыли заново — адрес показывается снова, даже если домен тот же; повтор в одной попытке — нет', () => {
  assert.deepEqual(run([L.req, L.assigned, L.chat, L.req, L.assigned]).addresses, [DOMAIN, DOMAIN]);
  assert.deepEqual(run([L.assigned, L.chat, L.assigned]).addresses, [DOMAIN]);
});

test('e4mc: старые версии мода без строки «Domain assigned» — адрес берём из чата на любом языке', () => {
  assert.deepEqual(run([L.chat]).addresses, [DOMAIN]);
  assert.deepEqual(run(['[10:00:00] [Render thread/INFO]: [System] [CHAT] Локальная игра размещена на домене [unequal-cofounder.eu.e4mc.link]']).addresses, [DOMAIN]);
  assert.deepEqual(run(['[10:00:00] [Render thread/INFO]: [CHAT] Local game hosted on domain [fancy-fox.e4mc.link]']).addresses, ['fancy-fox.e4mc.link']);
});

test('e4mc: в чате служебные хосты (отчёт /e4mc doctor) и ретрансляторы адресом не считаются', () => {
  for (const host of ['broker.e4mc.link', 'natives.e4mc.link', 'test.e4mc.link', 'de.e4mc.link', 'eu.e4mc.link', 'usw.e4mc.link']) {
    assert.deepEqual(run([`[10:00:00] [Render thread/INFO]: [System] [CHAT] relay id is x, host is ${host}, port is 25575.`]).addresses, [], host);
  }
});

test('e4mc: мод уже назвал домен — чужое сообщение в чате с другим доменом его не подменяет', () => {
  const got = run([L.req, L.assigned, '[10:01:00] [Render thread/INFO]: [CHAT] <PinkCat> попробуй fun-fox.na.e4mc.link']);
  assert.deepEqual(got.addresses, [DOMAIN]);
});
