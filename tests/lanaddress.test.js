const test = require('node:test');
const assert = require('node:assert/strict');
const { src } = require('./helpers');
const lanaddress = require(src('core/lanaddress'));

// Таблица сетевых адаптеров в том виде, в каком её отдаёт os.networkInterfaces()
const v4 = (address, extra = {}) => ({ address, family: 'IPv4', internal: false, ...extra });
const v6 = (address, extra = {}) => ({ address, family: 'IPv6', internal: false, ...extra });
const NICS = {
  'Loopback Pseudo-Interface 1': [v4('127.0.0.1', { internal: true }), v6('::1', { internal: true })],
  'Wi-Fi': [v6('fe80::1c2b:3d4e:5f60:7182'), v4('192.168.1.5')],
  Ethernet: [v4('10.0.0.7')],
  'Radmin VPN': [v4('26.12.34.56')],
  'vEthernet (WSL)': [v4('172.28.64.1')],
  'VMware Network Adapter VMnet1': [v4('192.168.56.1')],
};

test('адреса для входа: локальная сеть и VPN друзей, с названием адаптера; петля, виртуальные машины и WSL не показываются', () => {
  const list = lanaddress.candidates(61223, NICS);
  assert.deepEqual(list, [
    { kind: 'lan', name: 'Wi-Fi', host: '192.168.1.5', address: '192.168.1.5:61223' },
    { kind: 'lan', name: 'Ethernet', host: '10.0.0.7', address: '10.0.0.7:61223' },
    { kind: 'vpn', name: 'Radmin VPN', host: '26.12.34.56', address: '26.12.34.56:61223' },
  ]);
});

test('известные VPN для игры с друзьями узнаются по имени адаптера и по адресу: Radmin, Hamachi, ZeroTier, Tailscale', () => {
  const list = lanaddress.candidates(25565, {
    'Radmin VPN': [v4('26.1.2.3')],
    Hamachi: [v4('25.4.5.6')],
    'ZeroTier One [8056c2e21c000001]': [v4('10.147.17.5')],
    Tailscale: [v4('100.101.102.103')],
    'Подключение по локальной сети 3': [v4('26.9.9.9')], // имя не английское, а адрес из диапазона Radmin
  });
  assert.deepEqual(list.map((a) => [a.kind, a.name, a.host]), [
    ['vpn', 'Radmin VPN', '26.1.2.3'],
    ['vpn', 'Hamachi', '25.4.5.6'],
    ['vpn', 'ZeroTier', '10.147.17.5'],
    ['vpn', 'Tailscale', '100.101.102.103'],
    ['vpn', 'Radmin VPN', '26.9.9.9'],
  ]);
});

test('диапазоны частных сетей: 10.*, 172.16–31.*, 192.168.*; соседние адреса частными не считаются', () => {
  const host = (a) => lanaddress.candidates(1000, { Net: [v4(a)] }).map((x) => x.host);
  for (const a of ['10.0.0.1', '10.255.255.254', '172.16.0.9', '172.31.255.1', '192.168.0.1', '192.168.255.1']) assert.deepEqual(host(a), [a], a);
  for (const a of ['172.15.0.1', '172.32.0.1', '192.167.1.1', '192.169.1.1', '11.0.0.1', '8.8.8.8', '169.254.10.20', '127.0.0.1', '0.0.0.0']) assert.deepEqual(host(a), [], a);
});

test('отключённый адаптер VPN (адрес 169.254.*, петля или нули) не показывается, хотя имя у него «правильное»', () => {
  const nics = { 'Radmin VPN': [v4('169.254.8.9')], Hamachi: [v4('127.0.0.1')], ZeroTier: [v4('0.0.0.0')], Tailscale: [v4('169.254.1.1')] };
  assert.deepEqual(lanaddress.candidates(25565, nics), []);
  assert.equal(lanaddress.candidates(25565, { 'Radmin VPN': [v4('169.254.8.9'), v4('26.1.2.3')] }).length, 1, 'рядом с таким адресом настоящий всё равно виден');
});

test('адаптеры прокси-туннелей и виртуальных машин пропускаются по имени, даже если адрес частный', () => {
  const nics = {};
  for (const name of ['Meta Tunnel', 'Clash', 'sing-tun', 'Wintun Userspace Tunnel', 'TAP-Windows Adapter V9', 'vEthernet (Default Switch)', 'VirtualBox Host-Only Network', 'Hyper-V Virtual Ethernet Adapter', 'Docker', 'Bluetooth Network Connection']) nics[name] = [v4('192.168.77.1')];
  assert.deepEqual(lanaddress.candidates(25565, nics), []);
  assert.equal(lanaddress.candidates(25565, { 'Беспроводная сеть': [v4('192.168.0.8')] }).length, 1, 'русское имя обычной сети — не повод пропускать');
});

test('IPv6: только глобальный адрес (2000::/3), в скобках с портом и последним в списке; локальные и уникальные-локальные не показываются', () => {
  const list = lanaddress.candidates(61223, {
    Ethernet: [v6('2a02:6b8:1:2:3:4:5:6'), v6('fe80::1'), v6('fd12:3456::1'), v6('fc00::2'), v4('192.168.1.5')],
  });
  assert.deepEqual(list.map((a) => [a.kind, a.address]), [
    ['lan', '192.168.1.5:61223'],
    ['ipv6', '[2a02:6b8:1:2:3:4:5:6]:61223'],
  ]);
});

test('порядок: сначала локальная сеть, потом VPN, потом IPv6; повторы убираются; не больше шести', () => {
  const nics = { 'Radmin VPN': [v4('26.1.1.1')], A: [v6('2001:db8::1')], B: [v4('192.168.1.2'), v4('192.168.1.2')] };
  for (let i = 3; i < 12; i++) nics[`Net${i}`] = [v4(`10.0.${i}.1`)];
  const list = lanaddress.candidates(1234, nics);
  assert.equal(list.length, 6);
  assert.ok(list.every((a) => a.kind === 'lan'), 'в шести первых только локальные: они идут вперёд');
  assert.equal(list.filter((a) => a.host === '192.168.1.2').length, 1);
  const few = lanaddress.candidates(1234, { 'Radmin VPN': [v4('26.1.1.1')], A: [v6('2001:db8::1')], B: [v4('192.168.1.2')] });
  assert.deepEqual(few.map((a) => a.kind), ['lan', 'vpn', 'ipv6']);
});

test('семейство адреса может быть числом (старые Node отдавали 4 и 6), внутренние адаптеры и странные записи не мешают', () => {
  const list = lanaddress.candidates(1000, { Old: [{ address: '192.168.4.4', family: 4, internal: false }, { address: '2001:db8::5', family: 6, internal: false }, { address: '192.168.9.9', family: 4, internal: true }, null, {}, { address: 5 }] });
  assert.deepEqual(list.map((a) => a.address), ['192.168.4.4:1000', '[2001:db8::5]:1000']);
  assert.deepEqual(lanaddress.candidates(1000, null), []);
  assert.deepEqual(lanaddress.candidates(1000, { X: null, Y: 'нет' }), []);
});

test('порт должен быть настоящим: целое от 1 до 65535, иначе адресов нет', () => {
  for (const bad of [0, -1, 65536, 1.5, NaN, undefined, null, '61223x', {}]) assert.deepEqual(lanaddress.candidates(bad, NICS), [], String(bad));
  assert.equal(lanaddress.candidates('61223', NICS)[0].address, '192.168.1.5:61223', 'порт из строки лога приходит строкой');
  assert.equal(lanaddress.candidates(65535, NICS)[0].address, '192.168.1.5:65535');
  assert.equal(lanaddress.candidates(1, NICS)[0].address, '192.168.1.5:1');
});

test('таблицу адаптеров можно подменить переменной окружения для проверок: и настоящая таблица читается без ошибок', () => {
  const real = lanaddress.systemInterfaces();
  assert.equal(typeof real, 'object');
  const was = process.env.FEMBOY_TEST_INTERFACES;
  try {
    process.env.FEMBOY_TEST_INTERFACES = JSON.stringify({ 'Тест-сеть': [v4('192.168.50.50')] });
    assert.deepEqual(lanaddress.candidates(40000).map((a) => a.address), ['192.168.50.50:40000']);
    process.env.FEMBOY_TEST_INTERFACES = 'это не JSON';
    assert.deepEqual(lanaddress.systemInterfaces(), {}, 'испорченная подмена не роняет, а даёт пустую таблицу');
  } finally {
    if (was === undefined) delete process.env.FEMBOY_TEST_INTERFACES;
    else process.env.FEMBOY_TEST_INTERFACES = was;
  }
});

// ---- порт мира из лога ----

const L = {
  start: '[20:50:18] [Server thread/INFO]: Starting integrated minecraft server version 26.3',
  published: '[20:50:40] [Render thread/INFO]: Published LAN server on port 61223',
  publishedOld: '[12:00:01] [Render thread/INFO]: Started serving on 55555',
  publishedForge: '[12:00:01] [Render thread/INFO] [minecraft/IntegratedServer]: Started serving on 54321',
  publishedLegacy: '[12:00:01] [Server thread/INFO]: Started on 44444',
  stop: '[21:10:11] [Server thread/INFO]: Stopping server',
  spoofServer: '[20:53:00] [Server thread/INFO]: <nnn> Published LAN server on port 1111',
  spoofClient: '[20:53:00] [Render thread/INFO]: [System] [CHAT] <nnn> Published LAN server on port 2222',
  chatLine: '[20:50:40] [Render thread/INFO]: [System] [CHAT] Local game hosted on port 61223',
  tooBig: '[20:50:40] [Render thread/INFO]: Published LAN server on port 99999',
  zero: '[20:50:40] [Render thread/INFO]: Published LAN server on port 0',
};

function run(lines) {
  const found = [];
  const feed = lanaddress.watcher({ found: (p) => found.push(p) });
  lines.forEach(feed);
  return { found, feed };
}

test('порт открытого мира берётся из строки лога игры: новые и старые версии, Forge; о каждом мире — по разу', () => {
  assert.deepEqual(run([L.start, L.published]).found, [61223]);
  for (const [line, port] of [[L.publishedOld, 55555], [L.publishedForge, 54321], [L.publishedLegacy, 44444]]) assert.deepEqual(run([L.start, line]).found, [port], line);
  const twice = run([L.start, L.published, L.published]);
  assert.deepEqual(twice.found, [61223], 'повторная строка с тем же портом ничего не говорит');
  assert.equal(twice.feed.port(), 61223);
});

test('мир закрыт или начат новый — порт забывается; следующий мир сообщается заново, даже с тем же портом', () => {
  const r = run([L.start, L.published, L.stop]);
  assert.equal(r.feed.port(), null);
  const again = run([L.start, L.published, L.stop, L.start, L.published, L.publishedOld]);
  assert.deepEqual(again.found, [61223, 61223, 55555]);
  r.feed.reset();
  assert.equal(r.feed.port(), null);
});

test('начат новый мир, а строку остановки прежнего потеряли (вылет): тот же порт сообщается заново', () => {
  assert.deepEqual(run([L.start, L.published, L.start, L.published]).found, [61223, 61223]);
});

test('слова игроков в чате и чат клиента порт не подделывают; негодные порты (0, 99999) игнорируются', () => {
  const r = run([L.start, L.spoofServer, L.spoofClient, L.chatLine, L.tooBig, L.zero]);
  assert.deepEqual(r.found, []);
  assert.equal(r.feed.port(), null);
});

test('сбой в обработчике не роняет разбор лога; без обработчика и с мусором вместо строк тоже ничего не падает', () => {
  const feed = lanaddress.watcher({
    found: () => {
      throw new Error('нет окна');
    },
  });
  assert.doesNotThrow(() => [L.start, L.published].forEach(feed));
  assert.equal(feed.port(), 61223, 'порт всё равно запомнен');
  const bare = lanaddress.watcher();
  assert.doesNotThrow(() => [L.start, L.published, undefined, null, 5, ''].forEach(bare));
});
