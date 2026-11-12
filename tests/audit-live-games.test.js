// FL-GAME-01 (остаток): игра, пережившая принудительное завершение лаунчера, узнаётся при следующем старте.
// «Игра» здесь — подставной процесс node с папкой игры в командной строке; «завершение лаунчера» — загрузка модулей заново.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { spawn } = require('child_process');
const { profile, SRC } = require('./helpers');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 15000) { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(100); } return false; }
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

// Новый «запуск лаунчера» на том же профиле: модули заново, память о запущенных играх пропала
function restart(p) {
  for (const k of Object.keys(require.cache)) if (k.startsWith(SRC)) delete require.cache[k];
  const store = require(path.join(SRC, 'core/store')); store.init(p.dir);
  return { game: require(path.join(SRC, 'core/game')), live: require(path.join(SRC, 'core/livegames')), instances: require(path.join(SRC, 'core/instances')), playlog: require(path.join(SRC, 'core/playlog')) };
}

function fakeGame(gameDir) {
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)', '--', '--gameDir', gameDir], { stdio: 'ignore', windowsHide: true });
  return child;
}

async function scenario(t) {
  const p = profile(); const kids = [];
  t.after(() => { for (const k of kids) try { process.kill(k.pid); } catch {} p.done(); });
  const first = p.load('core/instances').create({ name: 'Live', version: '1.20.1' });
  const gameDir = p.load('core/instances').gameDir(first.id);
  fs.mkdirSync(gameDir, { recursive: true });
  const child = fakeGame(gameDir); kids.push(child);
  await sleep(300);
  return { p, id: first.id, gameDir, child, startedAt: Date.now() - 60000 };
}

test('запись создаётся; после «убийства лаунчера» процесс узнан, второй запуск отклонён, выход обработан, запись удалена', async (t) => {
  const s = await scenario(t);
  const one = restart(s.p);
  await one.live.track(s.id, { pid: s.child.pid, javaPath: process.execPath, gameDir: s.gameDir, startedAt: s.startedAt });
  const rec = one.live.readAll()[s.id];
  assert.equal(rec.pid, s.child.pid);
  assert.ok(Number.isFinite(rec.procStart) && rec.cmdHash && rec.gameDir === s.gameDir && rec.startedAt === s.startedAt);
  assert.ok(fs.existsSync(one.live.file()));

  const two = restart(s.p); // лаунчер перезапущен, память пуста
  assert.equal(two.game.isRunning(s.id), false);
  const events = [];
  const r = await two.game.recover({ adopted: (id) => events.push(['adopted', id]), closed: (id, code, rec2) => events.push(['closed', id, code, rec2.startedAt]), gone: (id) => events.push(['gone', id]) }, { pollMs: 150 });
  assert.deepEqual(r, { adopted: [s.id], gone: [], unknown: [] });
  assert.equal(two.game.isRunning(s.id), true);
  assert.deepEqual(two.game.runningIds(), [s.id]);
  await assert.rejects(two.game.launch(s.id, {}), /уже запущена/);
  assert.ok(alive(s.child.pid)); // отказ второго запуска игру не тронул

  const before = two.instances.get(s.id).playtime || 0;
  process.kill(s.child.pid);
  assert.ok(await until(() => events.some((e) => e[0] === 'closed')), 'выход игры не замечен');
  assert.deepEqual(events.at(-1), ['closed', s.id, null, s.startedAt]); // код выхода неизвестен
  assert.equal(two.game.isRunning(s.id), false);
  assert.ok(two.instances.get(s.id).playtime - before >= 60000); // время игры начислено от начала сессии
  assert.equal(two.playlog.all().filter((e) => e.id === s.id && e.start === s.startedAt).length, 1);
  assert.equal(fs.existsSync(two.live.file()), false);
});

test('переиспользованный PID с другим временем запуска не принимается', async (t) => {
  const s = await scenario(t);
  const one = restart(s.p);
  await one.live.track(s.id, { pid: s.child.pid, javaPath: process.execPath, gameDir: s.gameDir, startedAt: s.startedAt });
  const all = one.live.readAll(); all[s.id].procStart -= 3600e3; // «в записи другой процесс с тем же PID»
  fs.writeFileSync(one.live.file(), JSON.stringify(all));
  const two = restart(s.p);
  const events = [];
  const r = await two.game.recover({ adopted: () => events.push('adopted'), gone: (id) => events.push('gone:' + id) }, { pollMs: 150 });
  assert.deepEqual(r, { adopted: [], gone: [s.id], unknown: [] });
  assert.equal(two.game.isRunning(s.id), false);
  assert.deepEqual(events, ['gone:' + s.id]);
  assert.equal(fs.existsSync(two.live.file()), false);
  assert.ok(alive(s.child.pid)); // чужой процесс не трогаем
});

test('процесс с тем же PID, но другой папкой игры, не принимается', async (t) => {
  const s = await scenario(t);
  const one = restart(s.p);
  await one.live.track(s.id, { pid: s.child.pid, javaPath: process.execPath, gameDir: s.gameDir, startedAt: s.startedAt });
  const all = one.live.readAll(); all[s.id].gameDir = path.join(s.gameDir, 'other'); all[s.id].cmdHash = 'x';
  fs.writeFileSync(one.live.file(), JSON.stringify(all));
  const two = restart(s.p);
  const r = await two.game.recover({}, { pollMs: 150 });
  assert.deepEqual(r, { adopted: [], gone: [s.id], unknown: [] });
});

test('игра закрылась, пока лаунчера не было: запись убрана, время не начислено, дана возможность сделать работу после игры', async (t) => {
  const s = await scenario(t);
  const one = restart(s.p);
  await one.live.track(s.id, { pid: s.child.pid, javaPath: process.execPath, gameDir: s.gameDir, startedAt: s.startedAt });
  process.kill(s.child.pid);
  assert.ok(await until(() => !alive(s.child.pid)));
  const two = restart(s.p);
  const before = two.instances.get(s.id).playtime || 0;
  const events = [];
  const r = await two.game.recover({ gone: (id, rec) => events.push([id, rec.startedAt]), closed: () => events.push('closed') }, { pollMs: 150 });
  assert.deepEqual(r, { adopted: [], gone: [s.id], unknown: [] });
  assert.deepEqual(events, [[s.id, s.startedAt]]);
  assert.equal(two.game.isRunning(s.id), false);
  assert.equal(two.instances.get(s.id).playtime || 0, before);
  assert.equal(fs.existsSync(two.live.file()), false);
});

test('если ОС не ответила, запись сохраняется и игра не объявляется закрытой', async (t) => {
  const s = await scenario(t);
  const one = restart(s.p);
  await one.live.track(s.id, { pid: s.child.pid, javaPath: process.execPath, gameDir: s.gameDir, startedAt: s.startedAt });
  const two = restart(s.p);
  two.live.setProbe(async () => { throw new Error('powershell недоступен'); });
  const r = await two.game.recover({}, { pollMs: 150 });
  assert.deepEqual(r, { adopted: [], gone: [], unknown: [s.id] });
  assert.ok(two.live.readAll()[s.id]);
});

test('штатное закрытие убирает запись: game.js удаляет её в обработчике close, а запуск её создаёт', () => {
  const g = fs.readFileSync(path.join(SRC, 'core/game.js'), 'utf8');
  assert.ok(g.includes("livegames.track(id, { pid: proc.pid, javaPath, gameDir: gameDirectory, startedAt })"));
  const close = g.slice(g.indexOf("client.on('close'"), g.indexOf('// Ноутбук с двумя видеокартами'));
  assert.ok(close.includes("livegames.untrack(id)"));
});

// ---- доработка после проверки на настоящей Java ----

test('зависшая проверка ОС: 4 записи проверяются параллельно, общий потолок, старт не блокируется, запись остаётся', async (t) => {
  const p = profile(); t.after(() => p.done());
  const cp = require('child_process'), realExec = cp.execFile;
  cp.execFile = () => ({ on() {}, kill() {} }); // powershell завис: колбэк не вызывается никогда
  t.after(() => { cp.execFile = realExec; });
  const two = restart(p);
  const recs = {};
  for (let i = 0; i < 4; i++) recs['inst' + i] = { pid: 900000 + i, procStart: Date.now(), cmdHash: 'x', javaPath: '', gameDir: 'C:/g/' + i, startedAt: Date.now() - 1000 };
  fs.writeFileSync(two.live.file(), JSON.stringify(recs));
  const unverified = [];
  const t0 = Date.now();
  const r = await two.game.recover({ unverified: (ids) => unverified.push(...ids) }, { pollMs: 150 });
  const took = Date.now() - t0;
  assert.ok(took < 6000, 'recover занял ' + took + ' мс');
  assert.deepEqual(r.adopted, []); assert.deepEqual(r.gone, []);
  assert.deepEqual(r.unknown.sort(), Object.keys(recs));
  assert.deepEqual(unverified.sort(), Object.keys(recs)); // main.js пишет об этом строку в журнал
  assert.deepEqual(Object.keys(two.live.readAll()).sort(), Object.keys(recs));
  assert.equal(two.game.isRunning(), false);
});

test('граница пути gameDir в командной строке', () => {
  const B = String.fromCharCode(92), win = (x) => x.split('/').join(B);
  const p = profile(); const live = p.load('core/livegames'); try {
    const has = live.cmdHasDir, dir = win('C:/Inst/a/.minecraft');
    assert.equal(has('java.exe --gameDir ' + dir + ' --x', dir), true);
    assert.equal(has('java.exe --gameDir "c:/inst/A/.MINECRAFT" --x', dir), true); // кавычки, регистр, слэши
    assert.equal(has('java.exe -Dfml.gameDir=' + dir, dir), true);
    assert.equal(has('java.exe --gameDir ' + win('C:/Inst/ab'), win('C:/Inst/a')), false);
    assert.equal(has('java.exe --gameDir ' + win('C:/Inst/a/sub'), win('C:/Inst/a')), true); // вложенная папка той же сборки
    assert.equal(has('java.exe --gameDir X' + win('C:/Inst/a'), win('C:/Inst/a')), false);
    assert.equal(has('java.exe', ''), false);
  } finally { p.done(); }
});

test('перед завершением подхваченной игры сверяется личность: сменившийся процесс не убивается, запись снимается', async (t) => {
  const s = await scenario(t);
  const one = restart(s.p);
  await one.live.track(s.id, { pid: s.child.pid, javaPath: process.execPath, gameDir: s.gameDir, startedAt: s.startedAt });
  const two = restart(s.p);
  const events = [];
  await two.game.recover({ closed: (id, code) => events.push(['closed', code]) }, { pollMs: 150 });
  assert.equal(two.game.isRunning(s.id), true);
  const before = two.instances.get(s.id).playtime || 0;
  const real = two.live.readAll()[s.id];
  two.live.setProbe(async () => ({ start: real.procStart + 600000, cmd: 'other.exe', name: 'other.exe' })); // PID достался другой программе
  two.game.kill(s.id);
  assert.ok(await until(() => events.length === 1));
  assert.ok(alive(s.child.pid), 'чужой процесс убит');
  assert.equal(two.game.isRunning(s.id), false);
  assert.equal(fs.existsSync(two.live.file()), false);
  assert.equal(two.instances.get(s.id).playtime || 0, before); // конец игры неизвестен: время не начисляется
});

test('kill подхваченной игры при совпавшей личности завершает процесс; при неответе ОС не завершает', async (t) => {
  const s = await scenario(t);
  const one = restart(s.p);
  await one.live.track(s.id, { pid: s.child.pid, javaPath: process.execPath, gameDir: s.gameDir, startedAt: s.startedAt });
  const two = restart(s.p);
  const events = [], warn = [];
  await two.game.recover({ closed: () => events.push('closed'), unverified: (ids) => warn.push(...ids) }, { pollMs: 150 });
  const realProbe = null;
  two.live.setProbe(async () => { throw new Error('нет ответа'); });
  two.game.kill(s.id);
  assert.ok(await until(() => warn.length === 1));
  assert.ok(alive(s.child.pid));
  two.live.setProbe(null);
  two.game.kill(s.id);
  assert.ok(await until(() => events.length === 1));
  assert.ok(await until(() => !alive(s.child.pid)));
});

test('запись без procStart: процесс, созданный заметно позже начала сессии, не принимается', async () => {
  const p = profile(); try {
    const live = p.load('core/livegames');
    const rec = { pid: 4242, procStart: null, cmdHash: null, gameDir: 'C:/g/a/.minecraft', startedAt: 1000000 };
    live.setProbe(async () => ({ start: 1000500, cmd: 'java --gameDir c:/g/a/.minecraft', name: 'java.exe' }));
    assert.equal(await live.verify(rec), true);
    live.setProbe(async () => ({ start: 1000000 + 60000, cmd: 'java --gameDir c:/g/a/.minecraft', name: 'java.exe' })); // тот же gameDir, но моложе игры
    assert.equal(await live.verify(rec), false);
  } finally { p.done(); }
});
