const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { profile, put, dump } = require('./helpers');

// Профиль с двумя сборками: у каждой есть мир, моды и файл настроек, чтобы видеть, что при переносе ничего не потерялось
function setup(t) {
  const p = profile();
  t.after(() => p.done());
  const instances = p.load('core/instances');
  const trash = p.load('core/trash');
  const make = (name, extra = {}) => {
    const inst = instances.create({ name, version: '1.21.1', loader: 'fabric', ...extra });
    put(instances.dirOf(inst.id), {
      '.minecraft/saves/Мир 1/level.dat': `уровень ${name}`,
      '.minecraft/saves/Мир 1/region/r.0.0.mca': Buffer.from([1, 2, 3, 4]),
      '.minecraft/mods/sodium.jar': 'jar',
      '.minecraft/options.txt': `fov:90 ${name}`,
    });
    return instances.get(inst.id);
  };
  const a = make('Уютное выживание');
  const b = make('Шейдерная красота');
  return { p, dir: p.dir, instances, trash, a, b, trashDir: path.join(p.dir, 'trash') };
}
const names = (list) => list.map((i) => i.name);

test('в корзину: сборка пропадает из списка, а её папка целиком лежит в корзине', (t) => {
  const { instances, trash, a, trashDir } = setup(t);
  const before = dump(instances.dirOf(a.id));
  const r = trash.move(a.id);
  assert.deepEqual([r.id, r.name], [a.id, 'Уютное выживание']);
  assert.ok(Math.abs(r.deletedAt - Date.now()) < 5000);
  assert.deepEqual(names(instances.list()), ['Шейдерная красота']);
  assert.throws(() => instances.get(a.id), /Сборка не найдена/);
  assert.deepEqual(dump(path.join(trashDir, a.id)), before, 'каждый файл на месте, байт в байт');
  assert.equal(trash.has(a.id), true);
});

test('список корзины: название, версия и значок остаются при сборке; новые сверху', (t) => {
  const { instances, trash, a, b, trashDir } = setup(t);
  assert.deepEqual(trash.list(), []);
  trash.move(a.id);
  trash.move(b.id);
  // Время удаления лежит в записи рядом: ставим его руками, чтобы порядок не зависел от скорости теста
  fs.writeFileSync(path.join(trashDir, `${a.id}.json`), JSON.stringify({ deletedAt: 2000 }));
  fs.writeFileSync(path.join(trashDir, `${b.id}.json`), JSON.stringify({ deletedAt: 1000 }));
  const list = trash.list();
  assert.deepEqual(list.map((i) => [i.id, i.name, i.version, i.loader, i.deletedAt]), [
    [a.id, 'Уютное выживание', '1.21.1', 'fabric', 2000],
    [b.id, 'Шейдерная красота', '1.21.1', 'fabric', 1000],
  ]);
  assert.deepEqual(instances.list(), []);
});

test('записи про время нет или она испорчена: сборка всё равно в списке, время берётся с диска', (t) => {
  const { trash, a, b, trashDir } = setup(t);
  trash.move(a.id);
  trash.move(b.id);
  fs.rmSync(path.join(trashDir, `${a.id}.json`));
  fs.writeFileSync(path.join(trashDir, `${b.id}.json`), '{ обрыв');
  const list = trash.list();
  assert.equal(list.length, 2);
  assert.ok(list.every((i) => Number.isFinite(i.deletedAt) && i.deletedAt > 0));
});

test('вернуть: сборка снова в списке со всеми файлами и прежними настройками, корзина пуста', (t) => {
  const { instances, trash, a, trashDir } = setup(t);
  instances.touch(a.id, { playtime: 12345, group: 'Друзья' });
  const before = dump(instances.dirOf(a.id));
  trash.move(a.id);
  const back = trash.restore(a.id);
  assert.deepEqual([back.id, back.name, back.playtime, back.group], [a.id, 'Уютное выживание', 12345, 'Друзья']);
  assert.deepEqual(dump(instances.dirOf(a.id)), before);
  assert.deepEqual(trash.list(), []);
  assert.equal(trash.has(a.id), false);
  assert.equal(fs.existsSync(path.join(trashDir, `${a.id}.json`)), false, 'запись про время тоже убрана');
});

test('вернуть нельзя, если сборка с таким номером уже есть: ничего не теряется ни там, ни там', (t) => {
  const { instances, trash, a } = setup(t);
  trash.move(a.id);
  fs.mkdirSync(instances.dirOf(a.id), { recursive: true });
  fs.writeFileSync(path.join(instances.dirOf(a.id), 'instance.json'), JSON.stringify({ id: a.id, name: 'Другая', version: '1.20.1' }));
  assert.throws(() => trash.restore(a.id), /уже есть/);
  assert.equal(trash.has(a.id), true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(instances.dirOf(a.id), 'instance.json'), 'utf8')).name, 'Другая');
});

test('чужой номер: вернуть нечего, стереть нечего, а путь наружу не пропускается', (t) => {
  const { dir, trash, a } = setup(t);
  trash.move(a.id);
  const outside = path.join(dir, 'не-трогать');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'важное.txt'), 'да');
  assert.throws(() => trash.restore('нет-такой-сборки'), /нет в корзине/);
  for (const bad of ['..', '../не-трогать', '..\\не-трогать', 'a/b', '', null, undefined]) {
    assert.equal(trash.has(bad), false, String(bad));
    assert.equal(trash.purge(bad), false, String(bad));
    assert.throws(() => trash.restore(bad), /нет в корзине/, String(bad));
  }
  assert.ok(fs.existsSync(path.join(outside, 'важное.txt')));
  assert.equal(trash.has(a.id), true);
});

test('удалить навсегда: папка и запись исчезают, остальное в корзине остаётся', (t) => {
  const { trash, a, b, trashDir } = setup(t);
  trash.move(a.id);
  trash.move(b.id);
  assert.equal(trash.purge(a.id), true);
  assert.equal(fs.existsSync(path.join(trashDir, a.id)), false);
  assert.equal(fs.existsSync(path.join(trashDir, `${a.id}.json`)), false);
  assert.deepEqual(trash.list().map((i) => i.id), [b.id]);
  assert.equal(trash.purge(a.id), false, 'второй раз стирать уже нечего');
});

test('удалить навсегда: ссылка на папку другого лаунчера снимается, а его данные не затрагиваются', (t) => {
  const { dir, instances, trash, a } = setup(t);
  const foreign = path.join(dir, 'чужой-лаунчер', 'saves');
  fs.mkdirSync(foreign, { recursive: true });
  fs.writeFileSync(path.join(foreign, 'мир.dat'), 'чужие миры');
  fs.symlinkSync(foreign, path.join(instances.dirOf(a.id), '.minecraft', 'чужие-миры'), 'junction'); // так выглядит перенос «на месте»
  trash.move(a.id);
  trash.purge(a.id);
  assert.equal(fs.readFileSync(path.join(foreign, 'мир.dat'), 'utf8'), 'чужие миры');
});

test('очистить всё: стираются все сборки и лишнее в корзине, возвращается их число', (t) => {
  const { trash, a, b, trashDir } = setup(t);
  trash.move(a.id);
  trash.move(b.id);
  fs.mkdirSync(path.join(trashDir, 'мусор'), { recursive: true });
  fs.writeFileSync(path.join(trashDir, 'мусор', 'x'), 'x');
  assert.equal(trash.purgeAll(), 2);
  assert.deepEqual(trash.list(), []);
  assert.deepEqual(fs.existsSync(trashDir) ? fs.readdirSync(trashDir) : [], []);
  assert.equal(trash.purgeAll(), 0);
});

test('сбой переноса (папку держит другая программа): понятное сообщение, а сборка остаётся на месте нетронутой', (t) => {
  const { p, instances, trash, a } = setup(t);
  const fsx = require(require('./helpers').src('core/fsx'));
  const real = fsx.renameRetry;
  fsx.renameRetry = () => {
    throw Object.assign(new Error("EPERM: operation not permitted, rename 'x' -> 'y'"), { code: 'EPERM' });
  };
  t.after(() => (fsx.renameRetry = real));
  const before = dump(instances.dirOf(a.id));
  assert.throws(() => trash.move(a.id), /Не получилось убрать сборку в корзину.*занята/);
  assert.deepEqual(dump(instances.dirOf(a.id)), before);
  assert.deepEqual(trash.list(), []);
  assert.deepEqual(names(instances.list()).sort(), ['Уютное выживание', 'Шейдерная красота']);
  void p;
});

test('несуществующая сборка и повтор: ошибка, а не пустая корзина', (t) => {
  const { trash, a } = setup(t);
  assert.throws(() => trash.move('нет-такой'), /Некорректный id сборки|Сборка не найдена/);
  assert.throws(() => trash.move('no-such-1a2b3c'), /Сборка не найдена/);
  trash.move(a.id);
  assert.throws(() => trash.move(a.id), /Сборка не найдена/, 'второй раз её уже нет в списке');
});

// ---- закрытие лаунчера ----

test('закрытие лаунчера: корзина переименовывается мгновенно, а стирает её отдельный процесс; список пуст сразу', (t) => {
  const { dir, instances, trash, a, b, trashDir } = setup(t);
  const foreign = path.join(dir, 'чужой-лаунчер');
  fs.mkdirSync(foreign, { recursive: true });
  fs.writeFileSync(path.join(foreign, 'мир.dat'), 'чужие миры');
  fs.symlinkSync(foreign, path.join(instances.dirOf(b.id), '.minecraft', 'чужое'), 'junction');
  trash.move(a.id);
  trash.move(b.id);
  const started = [];
  const moved = trash.retire((folder) => started.push(folder));
  assert.equal(started.length, 1);
  assert.equal(started[0], moved);
  assert.match(path.basename(moved), /^trash-gone-\d+$/);
  assert.equal(fs.existsSync(trashDir), false, 'корзины уже нет, лаунчер при следующем запуске увидит её пустой');
  assert.deepEqual(trash.list(), []);
  assert.ok(fs.existsSync(path.join(moved, a.id, 'instance.json')), 'сами сборки ещё лежат в переименованной папке: их сотрёт отдельный процесс');
  assert.throws(() => fs.lstatSync(path.join(moved, b.id, '.minecraft', 'чужое')), 'ссылки на чужие папки сняты до стирания');
  assert.equal(fs.readFileSync(path.join(foreign, 'мир.dat'), 'utf8'), 'чужие миры');
});

test('закрытие лаунчера при пустой корзине: ничего не переименовывается и никто не запускается', (t) => {
  const { dir, trash } = setup(t);
  const started = [];
  assert.equal(trash.retire((f) => started.push(f)), null);
  assert.deepEqual(started, []);
  assert.deepEqual(fs.readdirSync(dir).filter((n) => n.startsWith('trash')), []);
  fs.mkdirSync(path.join(dir, 'trash'));
  assert.equal(trash.retire((f) => started.push(f)), null, 'пустая папка корзины — тоже пусто');
});

test('по-настоящему: отдельный процесс стирает переименованную корзину и переживает вызов', async (t) => {
  const { trash, a } = setup(t);
  trash.move(a.id);
  const moved = trash.retire();
  assert.ok(moved);
  const deadline = Date.now() + 15000;
  while (fs.existsSync(moved) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
  assert.equal(fs.existsSync(moved), false, 'папка сборки стёрта');
});

test('отдельный процесс стирает и неудобную папку: пробелы, апостроф, русские имена, путь длиннее 260 знаков, файл «только для чтения», ссылка на чужую папку', async (t) => {
  const { dir, trash } = setup(t);
  const root = path.join(dir, "папка с пробелами и 'апострофом'");
  let deep = root;
  for (let i = 0; i < 4; i++) deep = path.join(deep, `уровень-${i}-${'x'.repeat(70)}`);
  fs.mkdirSync(`\\\\?\\${deep}`, { recursive: true });
  fs.writeFileSync(`\\\\?\\${path.join(deep, 'файл.txt')}`, 'глубоко');
  assert.ok(path.join(deep, 'файл.txt').length > 260, 'путь действительно длиннее предела обычных путей Windows');
  fs.writeFileSync(path.join(root, 'только-чтение.txt'), 'ro');
  fs.chmodSync(path.join(root, 'только-чтение.txt'), 0o444);
  const foreign = path.join(dir, 'чужое');
  fs.mkdirSync(foreign);
  fs.writeFileSync(path.join(foreign, 'мир.dat'), 'чужой мир');
  fs.symlinkSync(foreign, path.join(root, 'ссылка'), 'junction');
  trash.startDeleter(root);
  const deadline = Date.now() + 15000;
  while (fs.existsSync(root) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
  assert.equal(fs.existsSync(root), false, 'папка стёрта целиком');
  assert.equal(fs.readFileSync(path.join(foreign, 'мир.dat'), 'utf8'), 'чужой мир', 'то, на что вела ссылка, цело');
});

test('следующий запуск: недостёртое прошлого раза (trash-gone-*) стирается снова, чужие папки не трогаются', (t) => {
  const { dir, trash } = setup(t);
  for (const n of ['trash-gone-111', 'trash-gone-222']) fs.mkdirSync(path.join(dir, n, 'x'), { recursive: true });
  for (const n of ['trash-gone-abc', 'trashy', 'instances-old']) fs.mkdirSync(path.join(dir, n), { recursive: true });
  const started = [];
  const r = trash.sweep((f) => started.push(path.basename(f)));
  assert.deepEqual(started.sort(), ['trash-gone-111', 'trash-gone-222']);
  assert.deepEqual(r.map((f) => path.basename(f)).sort(), ['trash-gone-111', 'trash-gone-222']);
  assert.ok(fs.existsSync(path.join(dir, 'trash-gone-abc')) && fs.existsSync(path.join(dir, 'trashy')));
});

test('корзина, оставшаяся после аварийного закрытия лаунчера, не стирается при запуске: сборки можно вернуть', (t) => {
  const { trash, a } = setup(t);
  trash.move(a.id);
  const started = [];
  trash.sweep((f) => started.push(f));
  assert.deepEqual(started, []);
  assert.equal(trash.has(a.id), true);
  assert.equal(trash.list().length, 1);
});

// ---- облако ----

test('облако: сборка в корзине не «возвращается» синхронизацией как чужая; после возврата синхронизация идёт как раньше', async (t) => {
  const { p, dir, instances, trash, a } = setup(t);
  const sync = p.load('core/sync');
  const cloudDir = path.join(dir, 'облако');
  fs.mkdirSync(cloudDir);
  p.store.updateSettings({ syncDir: cloudDir });
  assert.equal((await sync.syncAll()).instances >= 1, true, 'обычная синхронизация отдала сборки в облако');
  const cloudCopy = path.join(cloudDir, sync.ROOT_NAME, sync.SPACE, 'instances', a.id);
  assert.ok(fs.existsSync(path.join(cloudCopy, 'instance.json')));

  trash.move(a.id);
  const s = await sync.syncAll();
  assert.equal(fs.existsSync(instances.dirOf(a.id)), false, 'удалённая сборка не воскресла из облака');
  assert.ok(fs.existsSync(path.join(cloudCopy, 'instance.json')), 'в облаке её копия лежит как лежала: решение о ней принимается при окончательном удалении');
  assert.equal(s.errors.length, 0);
  assert.equal(await sync.syncInstance(a.id), null);

  trash.restore(a.id);
  const again = await sync.syncAll();
  assert.equal(again.errors.length, 0);
  assert.ok(fs.existsSync(path.join(instances.dirOf(a.id), 'instance.json')));
});
