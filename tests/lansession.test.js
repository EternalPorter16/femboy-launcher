const test = require('node:test');
const assert = require('node:assert/strict');
const { src } = require('./helpers');
const lansession = require(src('core/lansession'));

// Строки из настоящего лога игры (Minecraft 26.3, Fabric, мир открыт по сети мобом e4mc 28.10) и такие же в форматах Forge и старых версий
const L = {
  start: '[20:50:18] [Server thread/INFO]: Starting integrated minecraft server version 26.3',
  published: '[20:50:29] [Render thread/INFO]: Published LAN server on port 61223',
  joined: '[20:52:30] [Render thread/INFO]: [System] [CHAT] nnn joined the game',
  stop: '[20:54:32] [Server thread/INFO]: Stopping server',
  stopSingle: '[20:54:32] [Server thread/INFO]: Stopping singleplayer server as player logged out',
  saving: '[20:54:32] [Server thread/INFO]: Saving worlds',
  // Форматы других версий и загрузчиков
  publishedOld: '[12:00:01] [Render thread/INFO]: Started serving on 55555',
  publishedForge: '[12:00:01] [Render thread/INFO] [minecraft/IntegratedServer]: Started serving on 55555',
  publishedLegacy: '[12:00:01] [Server thread/INFO]: Started on 55555',
  startForge: '[12:00:00] [Server thread/INFO] [minecraft/IntegratedServer]: Starting integrated minecraft server version 1.20.1',
  stopForge: '[12:30:00] [Server thread/INFO] [minecraft/MinecraftServer]: Stopping server',
  // Подделки: так выглядят чужие слова в чате и похожие строки
  spoofServerChat: '[20:53:00] [Server thread/INFO]: <nnn> Stopping server',
  spoofClientChat: '[20:53:00] [Render thread/INFO]: [System] [CHAT] <nnn> Stopping server',
  spoofPublish: '[20:53:00] [Server thread/INFO]: <nnn> Published LAN server on port 1',
};

function run(lines, o = {}) {
  const got = { opened: 0, stopped: 0 };
  const feed = lansession.watcher({ opened: () => got.opened++, stopped: () => got.stopped++ });
  lines.forEach(feed);
  return { got, feed };
}

test('мир открыт по сети и закрыт: об этом сказано по разу', () => {
  const { got } = run([L.start, L.published, L.joined, L.stop, L.stopSingle, L.saving]);
  assert.deepEqual(got, { opened: 1, stopped: 1 });
});

test('«Stopping server» в одиночном мире, который по сети не открывали, ничего не значит', () => {
  const { got } = run([L.start, L.stop, L.saving]);
  assert.deepEqual(got, { opened: 0, stopped: 0 });
});

test('строка «Stopping singleplayer server…» — не остановка мира: настоящая идёт отдельной строкой', () => {
  const { got } = run([L.start, L.published, L.stopSingle]);
  assert.deepEqual(got, { opened: 1, stopped: 0 });
});

test('два мира подряд: второй открывают заново, и закрытие каждого замечено отдельно', () => {
  const { got } = run([L.start, L.published, L.stop, L.start, L.published, L.stop]);
  assert.deepEqual(got, { opened: 2, stopped: 2 });
});

test('в мир заходили, но по сети не открывали, а потом открыли другой: сработает только закрытие второго', () => {
  const { got } = run([L.start, L.stop, L.start, L.published, L.stop]);
  assert.deepEqual(got, { opened: 1, stopped: 1 });
});

test('новый мир сбрасывает «открыт»: потерянная строка остановки не заставит очистить список чужого мира', () => {
  const { got } = run([L.start, L.published, L.start, L.stop]);
  assert.deepEqual(got, { opened: 1, stopped: 0 });
});

test('форматы других версий и Forge: «Started serving on», «Started on», строки с названием класса', () => {
  for (const open of [L.publishedOld, L.publishedForge, L.publishedLegacy]) {
    const { got } = run([L.startForge, open, L.stopForge]);
    assert.deepEqual(got, { opened: 1, stopped: 1 }, open);
  }
});

test('слова игроков в чате строк мира не подделывают', () => {
  const { got } = run([L.start, L.spoofPublish, L.spoofServerChat, L.spoofClientChat]);
  assert.deepEqual(got, { opened: 0, stopped: 0 });
  const open = run([L.start, L.published, L.spoofServerChat, L.spoofClientChat]);
  assert.deepEqual(open.got, { opened: 1, stopped: 0 }, 'чужое «Stopping server» мир не закрывает');
});

test('сигнал от мода e4mc тоже означает «мир открыт», даже если строку игры не узнали', () => {
  const { got, feed } = run([L.start]);
  feed.markOpen();
  feed.markOpen();
  feed(L.stop);
  assert.deepEqual(got, { opened: 1, stopped: 1 });
});

// ---- начало мира и открытие по сети для других дел (копия мира перед друзьями) ----

test('«мир начался» сообщается при каждой новой игре в мире, а «открыт по сети» — один раз на мир, и в сессии тоже', () => {
  const got = { started: 0, opened: 0 };
  const s = lansession.session({ clear: () => ({ cleared: 0, names: [] }), started: () => got.started++, opened: () => got.opened++ });
  [L.start, L.published, L.published].forEach(s.line);
  assert.deepEqual(got, { started: 1, opened: 1 });
  s.opened(); // и мод e4mc с тем же «открыт»: повторно не сообщается
  assert.deepEqual(got, { started: 1, opened: 1 });
  [L.stop, L.start, L.published].forEach(s.line);
  assert.deepEqual(got, { started: 2, opened: 2 }, 'второй мир: свои начало и открытие');
  const w = { started: 0 };
  const feed = lansession.watcher({ started: () => w.started++ });
  [L.startForge, L.start].forEach(feed);
  assert.equal(w.started, 2, 'начало мира в форматах Forge и обычном');
});

test('сбой в обработчике начала или открытия не роняет разбор лога и не мешает очистке списка', () => {
  const cleared = [];
  const s = lansession.session({
    clear: () => (cleared.push(1), { cleared: 1, names: ['A'] }),
    started: () => {
      throw new Error('нет окна');
    },
    opened: () => {
      throw new Error('нет окна');
    },
  });
  assert.doesNotThrow(() => [L.start, L.published, L.stop].forEach(s.line));
  assert.equal(cleared.length, 1, 'мир закрыт — список очищен, несмотря на сбои');
});

// ---- белый список за миром ----

function policy(o = {}) {
  const log = { cleared: [], failed: [], clears: 0 };
  const s = lansession.session({
    clear: o.clear ?? (() => (log.clears++, { cleared: 2, names: ['PinkDick', 'Sleepy_Cat'] })),
    enabled: o.enabled,
    cleared: (r) => log.cleared.push(r),
    failed: (e, why) => log.failed.push([e.message, why]),
  });
  return { s, log };
}

test('мир открыт и закрыт: список очищается сразу после закрытия, и об этом говорят один раз', () => {
  const { s, log } = policy();
  [L.start, L.published, L.stop].forEach(s.line);
  assert.equal(log.clears, 1);
  assert.deepEqual(log.cleared.map((r) => [r.why, r.cleared, r.names]), [['world', 2, ['PinkDick', 'Sleepy_Cat']]]);
});

test('игру закрыли: список очищается и тут, но если он уже пуст, лишнего сообщения нет', () => {
  const calls = [];
  const { s, log } = policy({ clear: () => (calls.push(1), calls.length === 1 ? { cleared: 2, names: ['A', 'B'] } : { cleared: 0, names: [] }) });
  [L.start, L.published, L.stop].forEach(s.line);
  s.exited();
  assert.equal(calls.length, 2, 'после выхода из игры список проверяется ещё раз: вдруг что-то дописали командой');
  assert.equal(log.cleared.length, 1, 'сообщение про пустой список не нужно');
});

test('игру закрыли, не закрывая мир (вылет): список всё равно очищается', () => {
  const { s, log } = policy();
  [L.start, L.published].forEach(s.line);
  s.exited();
  assert.deepEqual(log.cleared.map((r) => r.why), ['exit']);
});

test('мир по сети не открывали: пока идёт игра список не трогается, а при выходе из игры очищается', () => {
  const { s, log } = policy();
  [L.start, L.stop].forEach(s.line);
  assert.equal(log.clears, 0, 'в одиночном мире список, который лаунчер записал заранее, ещё нужен');
  s.exited();
  assert.equal(log.clears, 1);
});

test('в настройках очистка выключена: список не трогается никогда', () => {
  const { s, log } = policy({ enabled: () => false });
  [L.start, L.published, L.stop].forEach(s.line);
  s.exited();
  assert.equal(log.clears, 0);
});

test('настройку читают в момент закрытия мира, а не при запуске игры', () => {
  let on = false;
  const { s, log } = policy({ enabled: () => on });
  [L.start, L.published].forEach(s.line);
  on = true; // человек включил очистку, пока мир был открыт
  s.line(L.stop);
  assert.equal(log.clears, 1);
});

test('сбой очистки не роняет разбор лога и записывается как причина с сообщением', () => {
  const { s, log } = policy({
    clear: () => {
      throw new Error('файл занят');
    },
  });
  assert.doesNotThrow(() => [L.start, L.published, L.stop].forEach(s.line));
  assert.deepEqual(log.failed, [['файл занят', 'world']]);
});

test('e4mc сообщил адрес — для очистки это «мир открыт»', () => {
  const { s, log } = policy();
  s.line(L.start);
  s.opened();
  s.line(L.stop);
  assert.equal(log.clears, 1);
});
