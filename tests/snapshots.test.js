const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { profile, put, dump } = require('./helpers');

// Сборка с модами, настройками и записью о том, что откуда поставлено
function makeInstance(p, extra = {}) {
  const instances = p.load('core/instances');
  const inst = instances.create({ name: 'Тест', version: '1.20.1', loader: 'fabric', loaderVersion: '0.15.0', ...extra });
  const g = instances.gameDir(inst.id);
  put(g, {
    'mods/a.jar': 'jar-a-1',
    'mods/b.jar': 'jar-b',
    'mods/c.jar.disabled': 'jar-c',
    'mods/sub/d.jar': 'jar-d',
    'config/x.toml': 'volume = 1',
    'config/dir/y.json': '{"y":1}',
  });
  put(instances.dirOf(inst.id), { 'mods-meta.json': '{"a.jar":{"title":"A","projectId":"AAA"}}' });
  return { instances, inst, g };
}

test('точка запоминает моды, config и версию загрузчика, а откат всё возвращает', () => {
  const p = profile();
  try {
    const snaps = p.load('core/snapshots');
    const { instances, inst, g } = makeInstance(p);
    const before = dump(g);

    const s = snaps.create(inst.id, 'Перед обновлением модов');
    assert.equal(s.mods, 4);
    assert.equal(s.configFiles, 2);
    assert.equal(s.auto, true);
    assert.deepEqual(s.instance, { version: '1.20.1', loader: 'fabric', loaderVersion: '0.15.0', pack: null });
    assert.equal(snaps.list(inst.id).length, 1);

    // обновление мода: старый файл ушёл, новый появился, настройки и загрузчик другие, запись о моде новая
    fs.rmSync(path.join(g, 'mods/a.jar'));
    put(g, { 'mods/a2.jar': 'jar-a-2', 'config/x.toml': 'volume = 99' });
    put(instances.dirOf(inst.id), { 'mods-meta.json': '{"a2.jar":{"title":"A","projectId":"AAA"}}' });
    instances.touch(inst.id, { loaderVersion: '0.16.0', pack: { source: 'modrinth', projectId: 'P', version: '2' } });
    assert.deepEqual(snaps.list(inst.id)[0].diff, { added: 1, removed: 1, changed: 0 });

    const r = snaps.restore(inst.id, s.id);
    assert.equal(r.before.reason, 'Перед откатом');
    assert.deepEqual(dump(g), before, 'моды и config вернулись один в один (и отключённые, и во вложенной папке)');
    assert.equal(instances.get(inst.id).loaderVersion, '0.15.0');
    assert.equal(instances.get(inst.id).pack, null, 'модпак вернулся к состоянию точки (его тогда не было)');
    assert.equal(JSON.parse(fs.readFileSync(path.join(instances.dirOf(inst.id), 'mods-meta.json'), 'utf8'))['a.jar'].projectId, 'AAA', 'запись о том, откуда поставлены моды, тоже вернулась');
    assert.deepEqual(snaps.list(inst.id).find((x) => x.id === s.id).diff, { added: 0, removed: 0, changed: 0 }, 'после отката моды совпадают с точкой');

    // сам откат можно отменить: «Перед откатом» хранит состояние, которое было до него
    snaps.restore(inst.id, r.before.id);
    assert.equal(fs.existsSync(path.join(g, 'mods/a2.jar')), true);
    assert.equal(fs.existsSync(path.join(g, 'mods/a.jar')), false);
    assert.equal(fs.readFileSync(path.join(g, 'config/x.toml'), 'utf8'), 'volume = 99');
    assert.equal(instances.get(inst.id).loaderVersion, '0.16.0');
    assert.equal(instances.get(inst.id).pack.projectId, 'P');
  } finally {
    p.done();
  }
});

test('если ничего не изменилось, новая точка не создаётся', () => {
  const p = profile();
  try {
    const snaps = p.load('core/snapshots');
    const { inst, g } = makeInstance(p);
    const a = snaps.create(inst.id, 'Первая');
    const b = snaps.create(inst.id, 'Вторая');
    assert.equal(b.reused, true);
    assert.equal(b.id, a.id);
    assert.equal(snaps.list(inst.id).length, 1);
    put(g, { 'mods/new.jar': 'x' });
    const c = snaps.create(inst.id, 'Третья');
    assert.notEqual(c.id, a.id);
    assert.equal(snaps.list(inst.id).length, 2);
    // force делает точку даже без изменений (так откат сохраняет «до»)
    assert.notEqual(snaps.create(inst.id, 'Принудительная', { force: true }).id, c.id);
  } finally {
    p.done();
  }
});

test('моды в точке лежат ссылками, а не копиями, и переживают обновление мода', () => {
  const p = profile();
  try {
    const snaps = p.load('core/snapshots');
    const { inst, g } = makeInstance(p);
    const s = snaps.create(inst.id, 'x');
    const inSnap = path.join(p.dir, 'snapshots', inst.id, s.id, 'mods', 'a.jar');
    assert.equal(fs.readFileSync(inSnap, 'utf8'), 'jar-a-1');
    assert.ok(fs.statSync(inSnap).nlink >= 2, 'жёсткая ссылка: файл в сборке и в точке один и тот же');
    fs.rmSync(path.join(g, 'mods/a.jar')); // лаунчер удаляет старую версию при обновлении
    assert.equal(fs.readFileSync(inSnap, 'utf8'), 'jar-a-1', 'в точке файл остался');
  } finally {
    p.done();
  }
});

test('старые автоматические точки чистятся, точки «вручную» остаются, откатываемая точка не пропадает', () => {
  const p = profile();
  try {
    const snaps = p.load('core/snapshots');
    const { inst, g } = makeInstance(p);
    const manual = snaps.create(inst.id, 'Моя точка', { auto: false });
    const first = [];
    for (let i = 0; i < snaps.MAX_AUTO + 4; i++) {
      put(g, { [`mods/m${i}.jar`]: `jar-${i}` });
      first.push(snaps.create(inst.id, `авто ${i}`).id);
    }
    const all = snaps.list(inst.id);
    assert.equal(all.filter((s) => s.auto).length, snaps.MAX_AUTO);
    assert.ok(all.some((s) => s.id === manual.id), 'созданная вручную точка осталась');
    assert.ok(!all.some((s) => s.id === first[0]), 'самая старая автоматическая удалена');
    // откат к самой старой из оставшихся автоматических не должен её же и удалить
    const oldestAuto = all.filter((s) => s.auto).pop();
    snaps.restore(inst.id, oldestAuto.id);
    assert.ok(snaps.list(inst.id).some((s) => s.id === oldestAuto.id), 'точка, к которой откатились, на месте');
  } finally {
    p.done();
  }
});

test('удаление точки и сборки, неверные идентификаторы', () => {
  const p = profile();
  try {
    const snaps = p.load('core/snapshots');
    const { inst } = makeInstance(p);
    const s = snaps.create(inst.id, 'x', { auto: false });
    assert.throws(() => snaps.remove(inst.id, '../../etc'), /Некорректная точка/);
    assert.throws(() => snaps.restore(inst.id, '20200101-000000-abcd'), /не найдена/);
    snaps.remove(inst.id, s.id);
    assert.equal(snaps.list(inst.id).length, 0);
    snaps.create(inst.id, 'y');
    snaps.removeAll(inst.id);
    assert.equal(fs.existsSync(path.join(p.dir, 'snapshots', inst.id)), false);
    assert.doesNotThrow(() => snaps.removeAll('../x'), 'мусорный id просто игнорируется');
  } finally {
    p.done();
  }
});

test('папка mods, подключённая ссылкой из другого лаунчера, остаётся ссылкой', () => {
  const p = profile();
  try {
    const snaps = p.load('core/snapshots');
    const { inst, g } = makeInstance(p);
    const shared = path.join(p.dir, 'other-launcher-mods');
    fs.cpSync(path.join(g, 'mods'), shared, { recursive: true });
    fs.rmSync(path.join(g, 'mods'), { recursive: true });
    fs.symlinkSync(shared, path.join(g, 'mods'), 'junction');
    const s = snaps.create(inst.id, 'x');
    put(g, { 'mods/extra.jar': 'extra' });
    snaps.restore(inst.id, s.id);
    assert.ok(fs.lstatSync(path.join(g, 'mods')).isSymbolicLink(), 'ссылка на месте');
    assert.equal(fs.existsSync(path.join(shared, 'extra.jar')), false, 'лишнее убрано');
    assert.equal(fs.readFileSync(path.join(shared, 'a.jar'), 'utf8'), 'jar-a-1');
  } finally {
    p.done();
  }
});

test('сборка без модов и config тоже снимается и откатывается', () => {
  const p = profile();
  try {
    const snaps = p.load('core/snapshots');
    const instances = p.load('core/instances');
    const inst = instances.create({ name: 'Пустая', version: '1.21.1', loader: 'vanilla' });
    const g = instances.gameDir(inst.id);
    const s = snaps.create(inst.id, 'пусто');
    assert.equal(s.mods, 0);
    put(g, { 'mods/new.jar': 'n', 'config/c.txt': 'c' });
    snaps.restore(inst.id, s.id);
    assert.deepEqual(dump(g), {});
  } finally {
    p.done();
  }
});

// ---------- «Последний удачный запуск» (kind: 'good'): особая точка, к которой откатывают после вылета ----------

const GOOD_DIR = (p, inst, snap) => path.join(p.dir, 'snapshots', inst.id, snap.id);

test('удачная точка: одна на сборку, при тех же файлах обновляется только время, при других заменяется, а config в ней свежий', () => {
  const p = profile();
  try {
    const snaps = p.load('core/snapshots');
    const { inst, g } = makeInstance(p);
    const a = snaps.markGood(inst.id);
    assert.equal(a.kind, 'good');
    assert.equal(a.auto, false);
    assert.equal(a.reason, 'Последний удачный запуск');
    assert.equal(a.mods, 4);
    assert.equal(a.sig, undefined, 'отпечаток наружу не отдаётся, как и у обычных точек');
    assert.equal(snaps.list(inst.id).length, 1);

    // ничего не менялось: новой точки нет, а «когда это было» сдвигается вперёд
    const b = snaps.markGood(inst.id);
    assert.equal(b.id, a.id);
    assert.equal(b.refreshed, true);
    assert.ok(b.time > a.time);
    assert.equal(snaps.list(inst.id)[0].time, b.time);
    assert.equal(snaps.list(inst.id).length, 1);

    // игра переписала настройки: точка заменяется, прежней не остаётся, в новой config свежий
    put(g, { 'config/x.toml': 'volume = 7' });
    const c = snaps.markGood(inst.id);
    assert.notEqual(c.id, a.id);
    assert.equal(c.refreshed, undefined);
    assert.equal(fs.existsSync(GOOD_DIR(p, inst, a)), false, 'старая удачная точка удалена');
    assert.equal(fs.readFileSync(path.join(GOOD_DIR(p, inst, c), 'config', 'x.toml'), 'utf8'), 'volume = 7');
    // изменились моды: тоже новая
    put(g, { 'mods/new.jar': 'n' });
    const d = snaps.markGood(inst.id);
    assert.notEqual(d.id, c.id);
    assert.equal(d.mods, 5);
    const all = snaps.list(inst.id);
    assert.equal(all.length, 1);
    assert.equal(all[0].id, d.id);
    assert.equal(all[0].kind, 'good');
  } finally {
    p.done();
  }
});

test('удачная точка не входит в лимиты: её не вытесняют ни автоматические, ни ручные точки', () => {
  const p = profile();
  try {
    const snaps = p.load('core/snapshots');
    const { inst, g } = makeInstance(p);
    const good = snaps.markGood(inst.id);
    for (let i = 0; i < snaps.MAX_ALL + 3; i++) {
      put(g, { [`mods/m${i}.jar`]: `jar-${i}` });
      snaps.create(inst.id, `вручную ${i}`, { auto: false });
    }
    for (let i = 0; i < snaps.MAX_AUTO + 3; i++) {
      put(g, { [`mods/a${i}.jar`]: `jar-${i}` });
      snaps.create(inst.id, `авто ${i}`);
    }
    const all = snaps.list(inst.id);
    assert.ok(all.some((s) => s.id === good.id), 'самая старая точка осталась, потому что она особая');
    const rest = all.filter((s) => s.kind !== 'good');
    assert.equal(rest.filter((s) => s.auto).length, snaps.MAX_AUTO);
    assert.equal(rest.length, snaps.MAX_ALL, 'остальные точки по-прежнему ограничены общим лимитом, удачная его не занимает');
    // откат тоже чистит лишнее — удачная точка при этом на месте
    snaps.restore(inst.id, rest[rest.length - 1].id);
    assert.ok(snaps.list(inst.id).some((s) => s.id === good.id));
  } finally {
    p.done();
  }
});

test('обычные точки не принимают удачную за «ничего не менялось», а новая удачная не трогает обычные', () => {
  const p = profile();
  try {
    const snaps = p.load('core/snapshots');
    const { inst, g } = makeInstance(p);
    const good = snaps.markGood(inst.id);
    // состояние то же, что в удачной точке, но «Перед обновлением модов» должна быть настоящей отдельной точкой: удачную со временем заменят
    const auto = snaps.create(inst.id, 'Перед обновлением модов');
    assert.notEqual(auto.id, good.id);
    assert.equal(auto.reused, undefined);
    const again = snaps.create(inst.id, 'Ещё раз');
    assert.equal(again.id, auto.id, 'между обычными точками проверка «ничего не менялось» работает как раньше');
    assert.equal(again.reused, true);
    put(g, { 'mods/x.jar': 'x' });
    const good2 = snaps.markGood(inst.id);
    const ids = snaps.list(inst.id).map((s) => s.id);
    assert.deepEqual(ids.sort(), [auto.id, good2.id].sort(), 'обычная точка осталась, удачная заменена');
    // в списке удачная точка первая, даже когда обычные новее
    put(g, { 'mods/y.jar': 'y' });
    snaps.create(inst.id, 'Позже');
    const list = snaps.list(inst.id);
    assert.equal(list[0].id, good2.id);
    assert.equal(list[0].kind, 'good');
    assert.deepEqual(list.slice(1).map((s) => s.kind), [undefined, undefined]);
    assert.ok(list[1].time >= list[2].time, 'остальные по времени, новые первыми');
  } finally {
    p.done();
  }
});

test('откат к удачной точке возвращает моды, config и версию загрузчика; точка остаётся, сам откат можно отменить', () => {
  const p = profile();
  try {
    const snaps = p.load('core/snapshots');
    const { instances, inst, g } = makeInstance(p);
    const before = dump(g);
    const good = snaps.markGood(inst.id);
    fs.rmSync(path.join(g, 'mods/a.jar'));
    put(g, { 'mods/a2.jar': 'jar-a-2', 'config/x.toml': 'volume = 99' });
    instances.touch(inst.id, { loaderVersion: '0.16.0' });
    assert.equal(snaps.sinceGood(inst.id).any, true);

    const r = snaps.restore(inst.id, good.id);
    assert.equal(r.before.reason, 'Перед откатом');
    assert.deepEqual(dump(g), before);
    assert.equal(instances.get(inst.id).loaderVersion, '0.15.0');
    assert.ok(snaps.list(inst.id).some((s) => s.id === good.id && s.kind === 'good'), 'удачная точка на месте');
    assert.equal(snaps.sinceGood(inst.id).any, false, 'после отката всё как при удачном запуске');

    snaps.restore(inst.id, r.before.id);
    assert.equal(fs.existsSync(path.join(g, 'mods/a2.jar')), true);
    assert.equal(instances.get(inst.id).loaderVersion, '0.16.0');
  } finally {
    p.done();
  }
});

test('удачная точка не пропадает при сбое записи новой и исчезает вместе со сборкой; вручную её тоже можно удалить', () => {
  const p = profile();
  try {
    const snaps = p.load('core/snapshots');
    const { inst, g } = makeInstance(p);
    const good = snaps.markGood(inst.id);
    put(g, { 'mods/new.jar': 'n' });
    const fsx = p.load('core/fsx');
    const real = fsx.writeJsonAtomic;
    fsx.writeJsonAtomic = () => {
      throw new Error('диск полон');
    };
    assert.throws(() => snaps.markGood(inst.id), /диск полон/);
    fsx.writeJsonAtomic = real;
    assert.deepEqual(snaps.list(inst.id).map((s) => s.id), [good.id], 'прежняя удачная точка цела');
    assert.deepEqual(fs.readdirSync(path.join(p.dir, 'snapshots', inst.id)).filter((n) => n.endsWith('.part')), [], 'недоделанная точка не осталась');

    snaps.remove(inst.id, good.id);
    assert.equal(snaps.sinceGood(inst.id), null, 'без точки сравнивать не с чем');
    snaps.markGood(inst.id);
    snaps.removeAll(inst.id);
    assert.equal(fs.existsSync(path.join(p.dir, 'snapshots', inst.id)), false);
  } finally {
    p.done();
  }
});

test('что изменилось с удачного запуска: без точки ответа нет, а настройки, которые игра переписала сама, изменением не считаются', () => {
  const p = profile();
  try {
    const snaps = p.load('core/snapshots');
    const { inst, g } = makeInstance(p);
    assert.equal(snaps.sinceGood(inst.id), null);
    const good = snaps.markGood(inst.id);
    put(g, { 'config/x.toml': 'volume = 7', 'config/new.toml': 'x' });
    const d = snaps.sinceGood(inst.id);
    assert.equal(d.id, good.id);
    assert.equal(d.time, good.time);
    assert.equal(d.any, false);
    assert.deepEqual(d.mods, { added: [], enabled: [], changed: [], removed: [], disabled: [] });
    assert.deepEqual(d.instance, {});
  } finally {
    p.done();
  }
});

test('что изменилось с удачного запуска: имена добавленных, убранных, изменённых, включённых и выключенных модов, по алфавиту', () => {
  const p = profile();
  try {
    const snaps = p.load('core/snapshots');
    const { inst, g } = makeInstance(p);
    snaps.markGood(inst.id);
    put(g, { 'mods/Zeta.jar': 'z', 'mods/new.jar': 'n', 'mods/sub/e.jar': 'e', 'mods/_extra.jar': 'x', 'mods/b.jar': 'jar-b-длиннее' });
    fs.rmSync(path.join(g, 'mods/a.jar'));
    fs.renameSync(path.join(g, 'mods/sub/d.jar'), path.join(g, 'mods/sub/d.jar.disabled'));
    fs.renameSync(path.join(g, 'mods/c.jar.disabled'), path.join(g, 'mods/c.jar'));
    const d = snaps.sinceGood(inst.id);
    assert.equal(d.any, true);
    // без учёта регистра, а не в порядке файловой системы (там «_extra» оказывается после «Zeta»)
    assert.deepEqual(d.mods, { added: ['_extra.jar', 'new.jar', 'sub/e.jar', 'Zeta.jar'], enabled: ['c.jar'], changed: ['b.jar'], removed: ['a.jar'], disabled: ['sub/d.jar'] });
    assert.deepEqual(d.instance, {});
  } finally {
    p.done();
  }
});

test('что изменилось с удачного запуска: выключенные файлы и посторонние файлы в mods игру не меняют, поэтому изменением не считаются', () => {
  const p = profile();
  try {
    const snaps = p.load('core/snapshots');
    const { inst, g } = makeInstance(p);
    snaps.markGood(inst.id);
    put(g, { 'mods/off.jar.disabled': 'x', 'mods/readme.txt': 'hi', 'mods/.cache/index.bin': 'z' });
    fs.rmSync(path.join(g, 'mods/c.jar.disabled'));
    const d = snaps.sinceGood(inst.id);
    assert.equal(d.any, false);
    assert.deepEqual(d.mods, { added: [], enabled: [], changed: [], removed: [], disabled: [] });
  } finally {
    p.done();
  }
});

test('что изменилось с удачного запуска: версия игры, загрузчик, его версия и модпак; сами по себе они тоже «изменение»', () => {
  const p = profile();
  try {
    const snaps = p.load('core/snapshots');
    const { instances, inst } = makeInstance(p);
    snaps.markGood(inst.id);
    instances.touch(inst.id, { loaderVersion: '0.16.0' });
    let d = snaps.sinceGood(inst.id);
    assert.equal(d.any, true, 'новая версия загрузчика при тех же модах — уже повод');
    assert.deepEqual(d.instance, { loaderVersion: { from: '0.15.0', to: '0.16.0' } });
    assert.deepEqual(d.mods, { added: [], enabled: [], changed: [], removed: [], disabled: [] });

    instances.touch(inst.id, { version: '1.21.1', loader: 'quilt', loaderVersion: '0.15.0', pack: { source: 'modrinth', projectId: 'P', version: '2.0' } });
    d = snaps.sinceGood(inst.id);
    assert.deepEqual(d.instance, { version: { from: '1.20.1', to: '1.21.1' }, loader: { from: 'fabric', to: 'quilt' }, pack: { from: null, to: '2.0' } });

    snaps.markGood(inst.id);
    instances.touch(inst.id, { pack: { source: 'modrinth', projectId: 'P', version: '3.0' } });
    assert.deepEqual(snaps.sinceGood(inst.id).instance, { pack: { from: '2.0', to: '3.0' } });
    instances.touch(inst.id, { pack: null });
    assert.deepEqual(snaps.sinceGood(inst.id).instance, { pack: { from: '2.0', to: null } });
  } finally {
    p.done();
  }
});

test('отпечаток модов: не зависит от config и посторонних файлов, но видит любое изменение набора модов, их размера и версий', () => {
  const p = profile();
  try {
    const snaps = p.load('core/snapshots');
    const { instances, inst, g } = makeInstance(p);
    const s0 = snaps.modsSig(inst.id);
    assert.match(s0, /^[a-f0-9]{40}$/);
    put(g, { 'config/x.toml': 'другое', 'mods/readme.txt': 'hi', 'mods/.cache/z.bin': 'z' });
    assert.equal(snaps.modsSig(inst.id), s0, 'config и не-jar файлы отпечаток не меняют');
    put(g, { 'mods/new.jar': 'n' });
    assert.notEqual(snaps.modsSig(inst.id), s0, 'новый мод');
    fs.rmSync(path.join(g, 'mods/new.jar'));
    assert.equal(snaps.modsSig(inst.id), s0, 'убрали — отпечаток тот же');
    fs.renameSync(path.join(g, 'mods/a.jar'), path.join(g, 'mods/a.jar.disabled'));
    assert.notEqual(snaps.modsSig(inst.id), s0, 'мод выключен');
    fs.renameSync(path.join(g, 'mods/a.jar.disabled'), path.join(g, 'mods/a.jar'));
    assert.equal(snaps.modsSig(inst.id), s0);
    instances.touch(inst.id, { loaderVersion: '0.16.0' });
    assert.notEqual(snaps.modsSig(inst.id), s0, 'другая версия загрузчика');
    instances.touch(inst.id, { loaderVersion: '0.15.0' });
    assert.equal(snaps.modsSig(inst.id), s0);
    put(g, { 'mods/b.jar': 'jar-b-длиннее' });
    assert.notEqual(snaps.modsSig(inst.id), s0, 'другой размер файла');
  } finally {
    p.done();
  }
});
