const test = require('node:test');
const assert = require('node:assert/strict');
const { src } = require('./helpers');
const lanplayers = require(src('core/lanplayers'));

// Строки из настоящего лога игры (Minecraft 26.3: у сообщений игры приставка «System chat: ») и такие же в формате старых версий и Forge
const L = {
  start: '[20:50:18] [Server thread/INFO]: Starting integrated minecraft server version 26.3',
  hostJoin: '[20:50:29] [Server thread/INFO]: System chat: Bart_Awesome joined the game',
  hostLogin: '[20:50:29] [Server thread/INFO]: Bart_Awesome[local:E:2c1fa4d3] logged in with entity id 41 at (12.5, 70.0, -3.5)',
  published: '[20:50:40] [Render thread/INFO]: Published LAN server on port 61223',
  friendJoin: '[20:52:30] [Server thread/INFO]: System chat: nnn joined the game',
  friendLogin: '[20:52:30] [Server thread/INFO]: nnn[/203.0.113.7:50412] logged in with entity id 63 at (12.5, 70.0, -3.5)',
  friendClientChat: '[20:52:30] [Render thread/INFO]: [System] [CHAT] nnn joined the game',
  friendLeave: '[20:58:02] [Server thread/INFO]: System chat: nnn left the game',
  friendLost: '[20:58:02] [Server thread/INFO]: nnn lost connection: Disconnected',
  hostLeave: '[21:10:11] [Server thread/INFO]: System chat: Bart_Awesome left the game',
  stopSingle: '[21:10:11] [Server thread/INFO]: Stopping singleplayer server as player logged out',
  stop: '[21:10:11] [Server thread/INFO]: Stopping server',
  // Форматы других версий и загрузчиков
  oldJoin: '[12:00:05] [Server thread/INFO]: Alex_Prem joined the game',
  oldLeave: '[12:09:05] [Server thread/INFO]: Alex_Prem left the game',
  forgeJoin: '[12:00:05] [Server thread/INFO] [minecraft/MinecraftServer]: Sleepy_Cat joined the game',
  forgeLeave: '[12:09:05] [Server thread/INFO] [minecraft/MinecraftServer]: Sleepy_Cat left the game',
  // Подделки: слова игроков в чате и строки не от сервера
  spoofChat: '[20:53:00] [Server thread/INFO]: <nnn> Bob joined the game',
  spoofChatSystem: '[20:53:00] [Server thread/INFO]: <nnn> System chat: Bob joined the game',
  spoofSay: '[20:53:00] [Server thread/INFO]: [nnn] Bob joined the game',
  spoofLeave: '[20:53:00] [Server thread/INFO]: <nnn> Bob left the game',
  badNick: '[20:53:00] [Server thread/INFO]: System chat: Bob the builder joined the game',
};

function run(lines) {
  const events = [];
  const feed = lanplayers.watcher({ changed: (e) => events.push(e) });
  lines.forEach(feed);
  return { events, feed };
}

test('хозяин мира заходит первым и в «гости» не попадает; друг зашёл и вышел — об этом сказано по разу', () => {
  const { events } = run([L.start, L.hostJoin, L.hostLogin, L.published, L.friendJoin, L.friendLogin, L.friendLeave, L.friendLost]);
  assert.deepEqual(events, [
    { guests: ['nnn'], joined: 'nnn' },
    { guests: [], left: 'nnn' },
  ]);
});

test('когда хозяин выходит из мира, сообщения «вышел» про него нет, а мир закрывается без шума', () => {
  const { events } = run([L.start, L.hostJoin, L.published, L.friendJoin, L.hostLeave, L.stopSingle, L.stop]);
  assert.deepEqual(events, [{ guests: ['nnn'], joined: 'nnn' }, { guests: [] }]);
});

test('при закрытии мира друзья, которых игра выгоняет уже после «Stopping server», сообщений «вышел» не дают', () => {
  const { events } = run([L.start, L.hostJoin, L.friendJoin, L.stop, L.friendLost, L.friendLeave]);
  assert.deepEqual(events, [{ guests: ['nnn'], joined: 'nnn' }, { guests: [] }]);
});

test('форматы старых версий и Forge читаются так же, порядок гостей — как они заходили', () => {
  const { events, feed } = run([L.start, L.hostJoin, L.oldJoin, L.forgeJoin, L.oldLeave]);
  assert.deepEqual(events, [
    { guests: ['Alex_Prem'], joined: 'Alex_Prem' },
    { guests: ['Alex_Prem', 'Sleepy_Cat'], joined: 'Sleepy_Cat' },
    { guests: ['Sleepy_Cat'], left: 'Alex_Prem' },
  ]);
  assert.deepEqual(feed.guests(), ['Sleepy_Cat']);
});

test('чужие слова в чате и строки не от сервера не считаются заходом и выходом', () => {
  const { events, feed } = run([L.start, L.hostJoin, L.friendClientChat, L.spoofChat, L.spoofChatSystem, L.spoofSay, L.badNick, L.friendJoin, L.spoofLeave]);
  assert.deepEqual(events, [{ guests: ['nnn'], joined: 'nnn' }]);
  assert.deepEqual(feed.guests(), ['nnn']);
});

test('повторная строка о заходе ничего не удваивает; «вышел» про того, кого не было, молчит', () => {
  const { events } = run([L.start, L.hostJoin, L.friendJoin, L.friendJoin, L.oldLeave]);
  assert.deepEqual(events, [{ guests: ['nnn'], joined: 'nnn' }]);
});

test('новый мир начинается заново: гости прежнего сбрасываются, а хозяином снова становится тот, кто зашёл первым', () => {
  const { events, feed } = run([L.start, L.hostJoin, L.friendJoin, L.start, L.oldJoin, L.friendJoin]);
  assert.deepEqual(events, [
    { guests: ['nnn'], joined: 'nnn' },
    { guests: [] },
    { guests: ['nnn'], joined: 'nnn' },
  ]);
  assert.deepEqual(feed.guests(), ['nnn']);
});

test('игра закрылась (reset): гости убираются, а когда никого не было — тишина', () => {
  const { events, feed } = run([L.start, L.hostJoin, L.friendJoin]);
  feed.reset();
  feed.reset();
  assert.deepEqual(events, [{ guests: ['nnn'], joined: 'nnn' }, { guests: [] }]);
  assert.deepEqual(feed.guests(), []);
  const quiet = run([L.start, L.hostJoin, L.stop]);
  assert.deepEqual(quiet.events, []);
});

test('сбой в обработчике не роняет разбор строк', () => {
  const feed = lanplayers.watcher({
    changed: () => {
      throw new Error('окно закрыто');
    },
  });
  assert.doesNotThrow(() => [L.start, L.hostJoin, L.friendJoin, L.friendLeave].forEach(feed));
  assert.deepEqual(feed.guests(), []);
});

test('без обработчика и со странными строками тоже ничего не падает', () => {
  const feed = lanplayers.watcher();
  assert.doesNotThrow(() => [L.start, L.hostJoin, L.friendJoin, undefined, null, 5, '', L.friendLeave].forEach(feed));
});
