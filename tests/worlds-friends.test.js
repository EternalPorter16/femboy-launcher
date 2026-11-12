const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { profile, put } = require('./helpers');

const MIN = 60e3;
const NOW = Date.now();

function setup(t) {
  const p = profile();
  t.after(() => p.done());
  const instances = p.load('core/instances');
  const inst = instances.create({ name: 'Т', version: '1.21.1', loader: 'vanilla' });
  const g = instances.gameDir(inst.id);
  const worlds = p.load('core/worlds');
  // Мир: level.dat, замок session.lock (его создаёт игра, когда открывает мир; время замка — время открытия) и пара файлов
  const world = (name, lockAgoMin, files = {}) => {
    put(g, { [`saves/${name}/level.dat`]: 'level', [`saves/${name}/region/r.0.0.mca`]: 'region of ' + name, ...Object.fromEntries(Object.entries(files).map(([k, v]) => [`saves/${name}/${k}`, v])) });
    if (lockAgoMin !== null) {
      const lock = path.join(g, 'saves', name, 'session.lock');
      fs.writeFileSync(lock, '☃');
      const when = new Date(NOW - lockAgoMin * MIN);
      fs.utimesSync(lock, when, when);
    }
  };
  const zips = () => (fs.existsSync(path.join(instances.dirOf(inst.id), 'backups')) ? fs.readdirSync(path.join(instances.dirOf(inst.id), 'backups')) : []);
  return { p, inst, g, world, worlds, zips, instances };
}

test('открытым считается мир с самым свежим замком, созданным после начала игры; старые замки и миры без замка не в счёт', (t) => {
  const { world, worlds, inst } = setup(t);
  world('Старый мир', 90); // замок полтора часа назад: в эту игру его не открывали
  world('Без замка', null);
  world('Вчерашний', 2); // открывали ещё до этой игры
  world('Этот', 1); // открыт минуту назад
  assert.equal(worlds.openedSince(inst.id, NOW - 10 * MIN), 'Этот');
  assert.equal(worlds.openedSince(inst.id, NOW - 150 * MIN), 'Этот', 'из подходящих берётся самый свежий замок');
  assert.equal(worlds.openedSince(inst.id, NOW + 5 * MIN), null, 'после начала игры замков нет — мир не открывали');
});

test('нет папки миров или миров вообще — ничего не открыто, и это не ошибка', (t) => {
  const { worlds, inst, g } = setup(t);
  assert.equal(worlds.openedSince(inst.id, 0), null);
  fs.mkdirSync(path.join(g, 'saves'), { recursive: true });
  assert.equal(worlds.openedSince(inst.id, 0), null);
  fs.mkdirSync(path.join(g, 'saves', 'просто папка'), { recursive: true });
  assert.equal(worlds.openedSince(inst.id, 0), null);
});

test('копия перед друзьями: zip с файлами открытого мира (без замка), другие миры не копируются', async (t) => {
  const { world, worlds, inst, zips } = setup(t);
  world('Открытый', 1, { 'playerdata/a.dat': 'player' });
  world('Другой', 2);
  const r = await worlds.backupOpened(inst.id, NOW - 10 * MIN);
  assert.equal(r.world, 'Открытый');
  assert.equal(r.reused, false);
  assert.equal(zips().length, 1);
  assert.match(zips()[0], /^Открытый-auto-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}(-\d{2})?\.zip$/, 'это автокопия: лаунчер знает, что её можно подчищать');
  const names = new AdmZip(r.file).getEntries().map((e) => e.entryName).sort();
  assert.deepEqual(names, ['Открытый/level.dat', 'Открытый/playerdata/a.dat', 'Открытый/region/r.0.0.mca']);
  assert.equal(worlds.backups(inst.id).find((b) => b.world === 'Открытый').auto, true);
});

test('мир открыли для друзей второй раз за полчаса: новая копия не нужна, а через час — нужна', async (t) => {
  const { world, worlds, inst, zips } = setup(t);
  world('Мир', 1);
  const first = await worlds.backupOpened(inst.id, NOW - 10 * MIN);
  const again = await worlds.backupOpened(inst.id, NOW - 10 * MIN);
  assert.equal(again.reused, true);
  assert.equal(again.file, first.file);
  assert.equal(zips().length, 1);
  const old = new Date(Date.now() - 61 * MIN);
  fs.utimesSync(first.file, old, old);
  await new Promise((r) => setTimeout(r, 1100)); // имя копии с точностью до секунды
  const third = await worlds.backupOpened(inst.id, NOW - 10 * MIN);
  assert.equal(third.reused, false);
  assert.equal(zips().length, 2);
});

test('свежая копия другого мира не считается копией этого: открытый мир всё равно копируется', async (t) => {
  const { world, worlds, inst, zips, instances } = setup(t);
  world('Открытый', 1);
  const dir = path.join(instances.dirOf(inst.id), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'Другой-auto-2026-10-29-20-00.zip'), 'zip'); // сделана только что
  const r = await worlds.backupOpened(inst.id, NOW - 10 * MIN);
  assert.equal(r.world, 'Открытый');
  assert.equal(r.reused, false);
  assert.ok(zips().some((n) => /^Открытый-auto-/.test(n)));
});

test('автокопии одного мира не копятся: остаются самые свежие (по настройке), ручные копии и копии других миров не трогаются', async (t) => {
  const { world, worlds, inst, zips, instances } = setup(t);
  world('Мир', 1);
  const dir = path.join(instances.dirOf(inst.id), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const make = (name, hoursAgo) => {
    const zip = new AdmZip();
    const world = name.startsWith('Другой-') ? 'Другой' : 'Мир';
    zip.addFile(`${world}/level.dat`, Buffer.from('level'));
    zip.writeZip(path.join(dir, name));
    const when = new Date(Date.now() - hoursAgo * 3600e3);
    fs.utimesSync(path.join(dir, name), when, when);
  };
  make('Мир-auto-2026-10-01-10-00.zip', 100);
  make('Мир-auto-2026-10-02-10-00.zip', 90);
  make('Мир-auto-2026-10-03-10-00.zip', 80);
  make('Мир-2026-10-04-10-00.zip', 70); // ручная
  make('Другой-auto-2026-10-01-10-00.zip', 100);
  await worlds.backupOpened(inst.id, NOW - 10 * MIN, { keep: 2 });
  const left = zips().sort();
  assert.equal(left.filter((n) => /^Мир-auto-/.test(n)).length, 2, 'свежая копия и одна прежняя');
  assert.ok(!left.includes('Мир-auto-2026-10-01-10-00.zip') && !left.includes('Мир-auto-2026-10-02-10-00.zip'));
  assert.ok(left.includes('Мир-2026-10-04-10-00.zip'), 'ручная копия осталась');
  assert.ok(left.includes('Другой-auto-2026-10-01-10-00.zip'), 'копия другого мира осталась');
});

test('открытого мира не нашлось — копия не делается, ответ пустой', async (t) => {
  const { world, worlds, inst, zips } = setup(t);
  world('Мир', 200);
  assert.equal(await worlds.backupOpened(inst.id, NOW - 10 * MIN), null);
  assert.equal(zips().length, 0);
});
