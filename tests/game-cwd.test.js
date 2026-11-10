const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { profile, put, blockInternet } = require('./helpers');

const EXE = process.platform === 'win32' ? 'javaw.exe' : 'java';
const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');

test('an asynchronous Java spawn failure rejects without leaving the instance running, and retry works', async (t) => {
  const { game, inst, ui } = setup(t, { spawnFailure: true });
  let started = 0; ui.started = () => started++;
  for (let attempt = 0; attempt < 2; attempt++) {
    await assert.rejects(game.launch(inst.id, ui, {}), (e) => e.code === 'ENOENT');
    assert.equal(game.isRunning(inst.id), false);
    assert.equal(started, 0);
  }
});

// Запуск до самого движка: профиль версии, клиент и Java лежат на диске, а движок запуска подменён — смотрим, с чем его вызвали
function setup(t, { version = '1.21.1', releaseTime = '2024-08-08T12:24:45+00:00', spawnFailure = false } = {}) {
  const unblock = blockInternet();
  const calls = [];
  const seen = []; // что лежало в whitelist.json в тот миг, когда движок запуска получил команду
  let engine = null; // последний созданный движок: через него тесты «закрывают игру»
  class FakeClient {
    constructor() {
      this.handlers = {};
      engine = this;
    }
    on(event, fn) {
      this.handlers[event] = fn;
    }
    async launch(options) {
      calls.push(options);
      const f = path.join(options.overrides.cwd, 'whitelist.json');
      seen.push(fs.existsSync(f) && fs.statSync(f).isFile() ? JSON.parse(fs.readFileSync(f, 'utf8')) : null);
      if (spawnFailure) return require('child_process').spawn(path.join(options.overrides.cwd, 'missing-java-for-audit.exe'), [], { windowsHide: true });
      return { kill() {} };
    }
  }
  const key = require.resolve('minecraft-launcher-core');
  const real = require.cache[key];
  require.cache[key] = { id: key, filename: key, loaded: true, exports: { Client: FakeClient } };
  const p = profile();
  t.after(() => {
    if (real) require.cache[key] = real;
    else delete require.cache[key];
    unblock();
    p.done();
  });
  const accounts = p.load('core/accounts');
  const instances = p.load('core/instances');
  accounts.addOffline('CwdTester');
  put(path.join(p.dir, 'jvm'), { [`bin/${EXE}`]: '', release: 'IMPLEMENTOR="Test"\nJAVA_VERSION="21.0.4"\nOS_ARCH="x86_64"\n' });
  const inst = instances.create({ name: 'Cwd test', version, loader: 'vanilla', javaPath: path.join(p.dir, 'jvm', 'bin', EXE) });
  const root = p.store.paths().root;
  put(root, {
    [`versions/${version}/${version}.jar`]: 'client',
    [`versions/${version}/${version}.json`]: JSON.stringify({
      id: version,
      type: 'release',
      releaseTime,
      javaVersion: { majorVersion: 21, component: 'java-runtime-delta' },
      downloads: { client: { sha1: sha1('client'), size: 6, url: 'https://example.invalid/client.jar' } },
      libraries: [],
    }),
  });
  const events = [];
  const ui = {
    status: () => {},
    progress: () => {},
    log: (line) => events.push(line),
    notice: () => {},
    started: () => {},
    closed: () => {},
    javaProxy: async () => ({ args: ['-Dhttps.proxyHost=127.0.0.1', '-Dhttps.proxyPort=10809'], note: 'Прокси для игры: 127.0.0.1:10809 (так настроен Windows)' }),
  };
  const closed = [];
  const analyses = []; // разбор вылета, с которым игра сообщила о закрытии (null, если вылета не было)
  ui.closed = (code, analysis) => {
    closed.push(code);
    analyses.push(analysis);
  };
  return { p, inst, ui, events, calls, seen, root, instances, closed, analyses, fire: (event, ...args) => engine.handlers[event]?.(...args), game: p.load('core/game') };
}

test('рабочая папка игры — папка сборки; общий конфиг log4j старых версий берётся из корня игры полным путём', (t) => {
  const p = profile();
  t.after(() => p.done());
  const game = p.load('core/game');
  const root = p.store.paths().root;
  const g = path.join(p.dir, 'сборка', '.minecraft');
  const modern = ['1.17.1', '1.20.1', '1.21.1', '26.3', '24w14a', '1.6.4'];
  // Конфига ещё нет (движок скачает его сам) или версия новая — только папка сборки
  for (const v of ['1.12.2', '1.8.9', ...modern]) assert.deepEqual(game.launchOverrides(root, g, v), { gameDirectory: g, cwd: g }, v);
  put(root, { 'log4j2_112-116.xml': '<Configuration/>', 'log4j2_17-111.xml': '<Configuration/>' });
  for (const v of ['1.12.2', '1.13.2', '1.16.5']) assert.equal(game.launchOverrides(root, g, v).logj4ConfigurationFile, path.join(root, 'log4j2_112-116.xml'), v);
  for (const v of ['1.7.10', '1.8.9', '1.11.2']) assert.equal(game.launchOverrides(root, g, v).logj4ConfigurationFile, path.join(root, 'log4j2_17-111.xml'), v);
  for (const v of modern) assert.deepEqual(game.launchOverrides(root, g, v), { gameDirectory: g, cwd: g }, `${v}: конфиг старых версий новым не нужен`);
});

test('движку запуска передаётся папка сборки как рабочая, а прокси для игры идёт до своих аргументов JVM', async (t) => {
  const { game, inst, ui, events, calls, instances, p } = setup(t);
  p.store.updateSettings({ jvmArgs: '-Dhttps.proxyHost=custom -Xshare:auto' });
  await game.launch(inst.id, ui, {});
  assert.equal(calls.length, 1);
  const g = instances.gameDir(inst.id);
  assert.equal(calls[0].overrides.gameDirectory, g);
  assert.equal(calls[0].overrides.cwd, g, 'Java стартует из папки сборки, и logs/latest.log с hs_err лежат там, где их ищут отчёты');
  assert.ok(fs.existsSync(g), 'папка сборки есть до запуска, иначе Java не стартует');
  const args = calls[0].customArgs;
  const proxyAt = args.indexOf('-Dhttps.proxyHost=127.0.0.1');
  assert.ok(proxyAt >= 0);
  assert.ok(args.indexOf('-Dhttps.proxyHost=custom') > proxyAt, 'свои аргументы JVM идут после прокси и могут его переопределить');
  assert.ok(events.includes('Прокси для игры: 127.0.0.1:10809 (так настроен Windows)'));
});

test('прокси для игры не получился или не нужен — игра всё равно запускается, без лишних аргументов', async (t) => {
  for (const javaProxy of [async () => Promise.reject(new Error('нет ответа')), async () => ({ args: [] }), undefined]) {
    const { game, inst, ui, calls } = setup(t);
    ui.javaProxy = javaProxy;
    await game.launch(inst.id, ui, {});
    assert.equal(calls.length, 1);
    assert.ok(!calls[0].customArgs.some((a) => /proxy/i.test(a)));
  }
});

// Переключатель «Передавать игре прокси лаунчера» (настройка gameProxy) — запасной выход, если флаги прокси мешают моду или игре
test('прокси лаунчера для игры выключен в настройках: ни флагов, ни обращения за прокси, в консоли сказано почему', async (t) => {
  const { game, inst, ui, events, calls, p } = setup(t);
  let asked = 0;
  const javaProxy = ui.javaProxy;
  ui.javaProxy = (...a) => (asked++, javaProxy(...a));
  p.store.updateSettings({ gameProxy: false });
  await game.launch(inst.id, ui, {});
  assert.equal(calls.length, 1);
  assert.ok(!calls[0].customArgs.some((a) => /proxy/i.test(a)), 'флагов прокси нет');
  assert.equal(asked, 0, 'лаунчер даже не спрашивает, какой у него прокси');
  assert.ok(events.includes('Прокси лаунчера для игры отключён в настройках'));
  assert.ok(!events.some((l) => /^Прокси для игры:/.test(l)));
});

test('прокси лаунчера для игры по умолчанию включён: и когда настройка не записана, и когда включена явно; свои аргументы JVM работают при любом значении', async (t) => {
  for (const gameProxy of [undefined, true]) {
    const { game, inst, ui, calls, p, events } = setup(t);
    if (gameProxy === undefined) delete p.store.get().settings.gameProxy;
    else p.store.updateSettings({ gameProxy });
    p.store.updateSettings({ jvmArgs: '-Xshare:auto' });
    await game.launch(inst.id, ui, {});
    assert.ok(calls[0].customArgs.includes('-Dhttps.proxyHost=127.0.0.1'), String(gameProxy));
    assert.ok(events.includes('Прокси для игры: 127.0.0.1:10809 (так настроен Windows)'));
    assert.ok(calls[0].customArgs.includes('-Xshare:auto'));
  }
  const off = setup(t);
  off.p.store.updateSettings({ gameProxy: false, jvmArgs: '-Dhttps.proxyHost=mine' });
  await off.game.launch(off.inst.id, off.ui, {});
  assert.ok(off.calls[0].customArgs.includes('-Dhttps.proxyHost=mine'), 'свои аргументы остаются: выключен только прокси лаунчера');
  assert.ok(!off.calls[0].customArgs.includes('-Dhttps.proxyHost=127.0.0.1'));
});

test('Minecraft 1.12.2: общий конфиг log4j из корня игры доходит до движка полным путём', async (t) => {
  const { game, inst, ui, calls, root } = setup(t, { version: '1.12.2', releaseTime: '2017-09-18T08:39:46+00:00' });
  put(root, { 'log4j2_112-116.xml': '<Configuration/>' });
  await game.launch(inst.id, ui, {});
  assert.equal(calls[0].overrides.logj4ConfigurationFile, path.join(root, 'log4j2_112-116.xml'));
});

test('белый список друзей без лицензии записан в папку сборки до запуска игры', async (t) => {
  const { game, inst, ui, events, seen, p } = setup(t);
  await game.launch(inst.id, ui, { whitelist: ['PinkDick', 'Sleepy_Cat'] });
  const uuid = (n) => p.load('core/accounts').offlineUUID(n);
  assert.deepEqual(seen[0], [{ uuid: uuid('PinkDick'), name: 'PinkDick' }, { uuid: uuid('Sleepy_Cat'), name: 'Sleepy_Cat' }], 'файл уже лежал, когда движок получил команду на запуск');
  assert.equal(seen[0][0].uuid, '27aedc0d-672d-329a-a124-cc2cf9aea38b', 'UUID от ника с заглавными, как у друга в игре');
  assert.ok(events.includes('Белый список друзей записан: PinkDick, Sleepy_Cat'));
});

test('друзья из списка (с лицензией и без) записаны до запуска, а в консоли — их ники, а не [object Object]', async (t) => {
  const { game, inst, ui, events, seen, p } = setup(t);
  await game.launch(inst.id, ui, { whitelist: [{ nick: 'PinkDick', offline: true, uuid: null }, { nick: 'Bart_Awesome', offline: false, uuid: '37f80e23-59b7-4e9f-b250-ade4921e5f03' }] });
  const uuid = (n) => p.load('core/accounts').offlineUUID(n);
  assert.deepEqual(seen[0], [
    { uuid: uuid('PinkDick'), name: 'PinkDick' },
    { uuid: uuid('Bart_Awesome'), name: 'Bart_Awesome' },
    { uuid: '37f80e23-59b7-4e9f-b250-ade4921e5f03', name: 'Bart_Awesome' },
  ]);
  assert.ok(events.includes('Белый список друзей записан: PinkDick, Bart_Awesome'));
});

test('без ников друзей белый список не создаётся и в консоль ничего не пишется', async (t) => {
  const { game, inst, ui, events, seen } = setup(t);
  await game.launch(inst.id, ui, {});
  assert.equal(seen[0], null);
  assert.ok(!events.some((l) => /Белый список/.test(l)));
});

test('белый список не записался — игра всё равно запускается, а причина видна в консоли', async (t) => {
  const { game, inst, ui, events, calls, instances } = setup(t);
  fs.mkdirSync(path.join(instances.gameDir(inst.id), 'whitelist.json'), { recursive: true }); // на месте файла папка
  await game.launch(inst.id, ui, { whitelist: ['PinkDick'] });
  assert.equal(calls.length, 1);
  assert.ok(events.some((l) => /^Белый список друзей не записан: /.test(l)));
});

// «Время в игре»: когда игра закрывается, сессия попадает в журнал (core/playlog.js), а общее время сборки считается как раньше
test('сессия игры записывается в журнал времени, и общее время сборки растёт как раньше', async (t) => {
  const { game, inst, ui, p, instances, fire, closed } = setup(t);
  await game.launch(inst.id, ui, {});
  const realNow = Date.now;
  t.after(() => (Date.now = realNow));
  Date.now = () => realNow() + 90 * 60 * 1000; // прошло полтора часа
  fire('close', 0);
  const log = p.load('core/playlog').all();
  assert.equal(log.length, 1);
  assert.equal(log[0].id, inst.id);
  assert.ok(log[0].end - log[0].start >= 90 * 60 * 1000 - 50, `сессия ${log[0].end - log[0].start} мс`);
  assert.ok(instances.get(inst.id).playtime >= 90 * 60 * 1000 - 50);
  assert.deepEqual(closed, [0]);
});

test('игра закрылась через пару секунд (вылет при запуске): в журнал не пишется, а время сборки считается как раньше', async (t) => {
  const { game, inst, ui, p, instances, fire, closed } = setup(t);
  await game.launch(inst.id, ui, {});
  fire('close', 1);
  assert.deepEqual(p.load('core/playlog').all(), []);
  assert.ok(instances.get(inst.id).playtime >= 0);
  assert.equal(closed.length, 1);
});

test('журнал времени сломался — игра всё равно закрывается как обычно, время сборки считается', async (t) => {
  const { game, inst, ui, p, instances, fire, closed } = setup(t);
  await game.launch(inst.id, ui, {});
  p.load('core/playlog').add = () => {
    throw new Error('диск полон');
  };
  const realNow = Date.now;
  t.after(() => (Date.now = realNow));
  Date.now = () => realNow() + 60 * 60 * 1000;
  assert.doesNotThrow(() => fire('close', 0));
  assert.deepEqual(closed, [0]);
  assert.ok(instances.get(inst.id).playtime >= 60 * 60 * 1000 - 50);
});

// «Последний удачный запуск» (core/snapshots.js): после нормального выхода из настоящей игры лаунчер запоминает моды, config и версии,
// а после вылета кладёт в разбор, что с тех пор изменилось (sinceGood), чтобы окно вылета назвало перемены и предложило откат.
// Сборка: мод a.jar уже сохранён в удачной точке, перед запуском добавлен b.jar; during — что случилось за время игры
async function playedSession(t, { code = 0, ms = 10 * 60 * 1000, kill = false, during = () => {} } = {}) {
  const s = setup(t);
  const g = s.instances.gameDir(s.inst.id);
  put(g, { 'mods/a.jar': 'jar-a', 'config/x.toml': 'v = 1' });
  const snaps = s.p.load('core/snapshots');
  const old = snaps.markGood(s.inst.id);
  put(g, { 'mods/b.jar': 'jar-b' });
  await s.game.launch(s.inst.id, s.ui, {});
  during(g, s);
  const realNow = Date.now;
  t.after(() => (Date.now = realNow));
  Date.now = () => realNow() + ms;
  if (kill) s.game.kill(s.inst.id);
  s.fire('close', code);
  return { ...s, g, snaps, old, list: snaps.list(s.inst.id) };
}

test('нормальный выход после настоящей игры сохраняет «последний удачный запуск»: моды как в игре, config такой, какой его оставила игра', async (t) => {
  const s = await playedSession(t, { during: (g) => put(g, { 'config/x.toml': 'v = 2' }) });
  assert.equal(s.list.length, 1, 'удачная точка одна');
  assert.equal(s.list[0].kind, 'good');
  assert.notEqual(s.list[0].id, s.old.id, 'прежняя заменена новой');
  assert.equal(s.list[0].mods, 2, 'и a.jar, и b.jar');
  assert.equal(fs.readFileSync(path.join(s.p.dir, 'snapshots', s.inst.id, s.list[0].id, 'config', 'x.toml'), 'utf8'), 'v = 2');
  assert.deepEqual(s.closed, [0]);
  assert.equal(s.analyses[0], null, 'вылета не было, разбор не нужен');
});

test('граница удачной сессии — три минуты', async (t) => {
  const s = await playedSession(t, { ms: 190 * 1000 });
  assert.notEqual(s.list[0].id, s.old.id);
});

for (const [name, opts] of [
  ['игра проработала меньше трёх минут', { ms: 170 * 1000 }],
  ['игра вылетела (код не ноль)', { code: 1 }],
  ['игру остановил сам лаунчер', { kill: true }],
  ['во время игры в mods добавили файл (в игру он не попал)', { during: (g) => put(g, { 'mods/c.jar': 'jar-c' }) }],
  ['во время игры мод выключили (в игре он ещё работал)', { during: (g) => fs.renameSync(path.join(g, 'mods/a.jar'), path.join(g, 'mods/a.jar.disabled')) }],
  ['идёт поиск виновника: часть модов выключена для пробы', { during: (g, s) => put(s.instances.dirOf(s.inst.id), { 'bisect.json': '{"v":1,"mods":[]}' }) }],
]) {
  test(`«последний удачный запуск» не обновляется: ${name}`, async (t) => {
    const s = await playedSession(t, opts);
    assert.deepEqual(s.list.map((x) => x.id), [s.old.id], 'прежняя удачная точка на месте');
    assert.equal(s.list[0].time, s.old.time);
  });
}

test('вылет: в разборе лежит, что изменилось с последнего удачного запуска; сам вылет удачную точку не трогает', async (t) => {
  const s = await playedSession(t, { code: 1, during: (g) => fs.rmSync(path.join(g, 'mods/a.jar')) });
  const a = s.analyses[0];
  assert.match(a.reason, /код 1/, 'обычный разбор вылета на месте');
  assert.equal(a.sinceGood.id, s.old.id);
  assert.equal(a.sinceGood.any, true);
  assert.deepEqual(a.sinceGood.mods.added, ['b.jar']);
  assert.deepEqual(a.sinceGood.mods.removed, ['a.jar']);
  assert.deepEqual(s.list.map((x) => x.id), [s.old.id]);
});

test('вылет без удачной точки: разбор прежний, а sinceGood пустой', async (t) => {
  const { game, inst, ui, fire, analyses } = setup(t);
  await game.launch(inst.id, ui, {});
  fire('close', 1);
  assert.match(analyses[0].reason, /код 1/);
  assert.equal(analyses[0].sinceGood, null);
});

test('сбой при сохранении удачной точки закрытию игры не мешает, а причина видна в консоли', async (t) => {
  const { game, inst, ui, events, fire, closed, p } = setup(t);
  await game.launch(inst.id, ui, {});
  p.load('core/snapshots').markGood = () => {
    throw new Error('диск полон');
  };
  const realNow = Date.now;
  t.after(() => (Date.now = realNow));
  Date.now = () => realNow() + 10 * 60 * 1000;
  assert.doesNotThrow(() => fire('close', 0));
  assert.deepEqual(closed, [0]);
  assert.ok(events.includes('Точка восстановления «последний удачный запуск» не сохранилась: диск полон'));
});

test('сбой при сравнении с удачной точкой окну вылета не мешает: разбор приходит, sinceGood пустой', async (t) => {
  const { game, inst, ui, fire, analyses, p } = setup(t);
  await game.launch(inst.id, ui, {});
  p.load('core/snapshots').sinceGood = () => {
    throw new Error('повреждено');
  };
  assert.doesNotThrow(() => fire('close', 1));
  assert.match(analyses[0].reason, /код 1/);
  assert.equal(analyses[0].sinceGood, null);
});

test('не получилось снять отпечаток модов при запуске: игра запускается, а удачная точка в этот раз не делается', async (t) => {
  const { game, inst, ui, calls, fire, closed, p } = setup(t);
  const snaps = p.load('core/snapshots');
  snaps.modsSig = () => {
    throw new Error('нет доступа');
  };
  await game.launch(inst.id, ui, {});
  assert.equal(calls.length, 1);
  const realNow = Date.now;
  t.after(() => (Date.now = realNow));
  Date.now = () => realNow() + 10 * 60 * 1000;
  fire('close', 0);
  assert.deepEqual(closed, [0]);
  assert.deepEqual(snaps.list(inst.id), []);
});

test('логи, которые игра пишет в свою рабочую папку, находят отчёт о проблеме и разбор вылета', async (t) => {
  const { game, inst, ui, calls, p } = setup(t);
  await game.launch(inst.id, ui, {});
  const cwd = calls[0].overrides.cwd;
  put(cwd, { 'logs/latest.log': '[10:00:00] [main/INFO]: hello\n', 'hs_err_pid4242.log': '# fatal\n' });
  const logs = p.load('core/report').gameLogs(inst.id);
  assert.match(logs.latest, /hello/);
  assert.equal(logs.hs.name, 'hs_err_pid4242.log');
  const crash = p.load('core/crash').analyze({ gameDir: cwd, startedAt: 0, logTail: [], code: 1 });
  assert.ok(String(crash.report).endsWith('hs_err_pid4242.log'));
});
