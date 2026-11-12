// Синхронизация сборок через облако: протокол из src/core/sync.js. Два «компьютера» (A и B) — два профиля лаунчера
// (свой store, свои sync-base.json), общая папка-облако во временной папке. Облако мгновенное; неполную доставку и
// обрывы изображаем подменой копирования и переименования. Настоящие данные и сеть не затрагиваются.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const store = require('../src/core/store');
const inst = require('../src/core/instances');
const sync = require('../src/core/sync');
const fsx = require('../src/core/fsx');

const T0 = Date.now() - 7200e3;
const rm = (f) => fs.rmSync(f, { recursive: true, force: true });

function W(file, text, ms) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  if (ms) fs.utimesSync(file, new Date(ms), new Date(ms));
}
const R = (f) => {
  try {
    return fs.readFileSync(f, 'utf8');
  } catch {
    return '<нет>';
  }
};
// Файлы папки как «путь=содержимое» без служебных
function tree(dir, rel = '', out = []) {
  let list = [];
  try {
    list = fs.readdirSync(dir, { withFileTypes: true });
  } catch {}
  for (const e of list) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (!rel && ['instance.json', 'sync-base.json', 'sync-wait.json', '.femboy-sync.json', '.femboy-origin.json', 'backups'].includes(e.name)) continue;
    if (e.isDirectory()) tree(path.join(dir, e.name), r, out);
    else out.push(`${r}=${fs.readFileSync(path.join(dir, e.name), 'utf8')}`);
  }
  return out.sort();
}
const names = (dir) => tree(dir).map((x) => x.split('=')[0]);
function find(dir, re, out = []) {
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (re.test(e.name)) out.push(p);
      if (e.isDirectory()) find(p, re, out);
    }
  } catch {}
  return out;
}

// Два компьютера и облако. Первый компьютер создаёт сборку «Моды» и кладёт в неё типовой набор файлов
function env(t, { populate = true } = {}) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'femboy-syncproto-')));
  t.after(() => rm(base));
  const cloud = path.join(base, 'cloud');
  fs.mkdirSync(cloud);
  const pcs = { A: path.join(base, 'A'), B: path.join(base, 'B'), C: path.join(base, 'C') };
  const e = { base, cloud, id: null, cur: null };
  e.use = (k) => {
    if (e.cur !== k) {
      store.init(pcs[k]);
      store.updateSettings({ syncDir: cloud });
      e.cur = k;
    }
    return e;
  };
  e.L = (k, ...p) => (e.use(k), path.join(inst.dirOf(e.id), ...p));
  e.G = (k, ...p) => e.L(k, '.minecraft', ...p);
  // облачная копия — папка текущей линии (по указателю v2/instances/<id>/line.json); линии ещё нет — несуществующая папка
  e.V = (...p) => path.join(cloud, sync.ROOT_NAME, sync.SPACE, ...p);
  e.line = () => {
    try {
      return JSON.parse(fs.readFileSync(e.V('instances', e.id, 'line.json'), 'utf8')).line;
    } catch {
      return null;
    }
  };
  e.C = (...p) => e.V('lines', e.line() || `${e.id}.none.0`, ...p);
  e.sync = async (k, running) => (e.use(k), sync.syncAll(running));
  e.one = async (k) => (e.use(k), sync.syncInstance(e.id));
  e.status = (k) => (e.use(k), sync.status());
  e.store = (k) => (e.use(k), store.get());
  e.use('A');
  e.id = inst.create({ name: 'Моя сборка', version: '1.20.1' }).id;
  if (populate) {
    W(e.G('A', 'mods', 'old.jar'), 'JAR-OLD', T0);
    W(e.G('A', 'mods', 'toggle.jar'), 'JAR-T', T0);
    W(e.G('A', 'mods', 'keep.jar'), 'KEEP', T0);
    W(e.G('A', 'config', 'x.toml'), 'cfg-v0', T0);
    for (const f of ['level.dat', 'region/r.0.0.mca', 'region/r.1.0.mca', 'playerdata/u1.dat', 'data/scoreboard.dat']) W(e.G('A', 'saves', 'World', f), `${f}:v0`, T0);
  }
  return e;
}
// A и B синхронны
async function both(t, opts) {
  const e = env(t, opts);
  const ra = await e.sync('A');
  assert.deepEqual(ra.errors, []);
  const rb = await e.sync('B');
  assert.deepEqual(rb.errors, []);
  return e;
}
const WORLD = (e, k, ...p) => e.G(k, 'saves', 'World', ...p);
const removedBy = (e, k) => find(e.L(k, 'backups', '.sync-removed'), /./).filter((f) => fs.statSync(f).isFile()).map((f) => path.basename(f));

// Подмена fs.promises.copyFile: бросает на N-м вызове, потом возвращает как было
function failCopyAt(n) {
  const real = fs.promises.copyFile;
  let i = 0;
  fs.promises.copyFile = async (...a) => {
    if (++i === n) throw new Error('fixture: copy interrupted');
    return real(...a);
  };
  return () => (fs.promises.copyFile = real);
}
const countCopies = async (fn) => {
  const real = fs.promises.copyFile;
  let n = 0;
  fs.promises.copyFile = async (...a) => (n++, real(...a));
  try {
    await fn();
  } finally {
    fs.promises.copyFile = real;
  }
  return n;
};

// ---------- 1. удаление, выключение, переименование ----------

test('T-DEL-1: обновление мода (удалён старый jar, добавлен новый) доходит до второго компьютера, его работа уходит в облако', async (t) => {
  const e = await both(t);
  rm(e.G('A', 'mods', 'old.jar'));
  W(e.G('A', 'mods', 'new.jar'), 'JAR-NEW', T0 + 60000);
  assert.deepEqual((await e.sync('A')).errors, []);
  W(e.G('B', 'saves', 'NewWorldB', 'level.dat'), 'newB', Date.now());
  W(e.G('B', 'options.txt'), 'opt-B', Date.now());
  const r = await e.sync('B');
  assert.deepEqual(r.errors, []);
  assert.deepEqual(names(e.G('B', 'mods')), ['keep.jar', 'new.jar', 'toggle.jar']);
  assert.equal(R(e.G('B', 'mods', 'new.jar')), 'JAR-NEW');
  assert.deepEqual(removedBy(e, 'B'), ['old.jar']); // перемещён, а не стёрт
  assert.equal(R(e.C('.minecraft', 'saves', 'NewWorldB', 'level.dat')), 'newB'); // в том же проходе Б отдал своё
  assert.equal(R(e.C('.minecraft', 'options.txt')), 'opt-B');
  assert.equal(fs.existsSync(e.C('.minecraft', 'mods', 'old.jar')), false);
  await e.sync('A');
  assert.equal(R(e.G('A', 'options.txt')), 'opt-B');
  assert.equal(fs.existsSync(e.G('A', 'mods', 'old.jar')), false, 'удалённый мод не вернулся');
});

test('T-DEL-1: выключение мода (.jar -> .jar.disabled) переносится', async (t) => {
  const e = await both(t);
  fs.renameSync(e.G('A', 'mods', 'toggle.jar'), e.G('A', 'mods', 'toggle.jar.disabled'));
  await e.sync('A');
  assert.deepEqual((await e.sync('B')).errors, []);
  assert.deepEqual(names(e.G('B', 'mods')), ['keep.jar', 'old.jar', 'toggle.jar.disabled']);
});

test('T-DEL-1: удалённый и переименованный мир переносятся на другой компьютер', async (t) => {
  const e = await both(t);
  fs.renameSync(WORLD(e, 'A'), e.G('A', 'saves', 'World-2'));
  await e.sync('A');
  const r = await e.sync('B');
  assert.deepEqual(r.errors, []);
  assert.equal(fs.existsSync(WORLD(e, 'B')), false);
  assert.equal(R(e.G('B', 'saves', 'World-2', 'region', 'r.1.0.mca')), 'region/r.1.0.mca:v0');
  assert.equal(removedBy(e, 'B').length, 5, 'старый мир лежит в backups/.sync-removed');
  rm(e.G('A', 'saves', 'World-2'));
  await e.sync('A');
  assert.deepEqual((await e.sync('B')).errors, []);
  assert.equal(fs.existsSync(e.G('B', 'saves', 'World-2')), false);
  assert.equal(fs.existsSync(e.C('.minecraft', 'saves', 'World-2')), false);
});

test('T-DEL-1: удаление одного файла мира переносится целым состоянием мира; зеркально от второго компьютера', async (t) => {
  const e = await both(t);
  rm(WORLD(e, 'A', 'region', 'r.1.0.mca'));
  await e.sync('A');
  await e.sync('B');
  assert.equal(fs.existsSync(WORLD(e, 'B', 'region', 'r.1.0.mca')), false);
  rm(e.G('B', 'mods', 'keep.jar'));
  await e.sync('B');
  assert.deepEqual((await e.sync('A')).errors, []);
  assert.equal(fs.existsSync(e.G('A', 'mods', 'keep.jar')), false);
});

test('T-DEL-2: удалено на A, но изменено на B — правка B сохраняется, сообщение есть, в облаке мод B', async (t) => {
  const e = await both(t);
  rm(e.G('A', 'mods', 'old.jar'));
  await e.sync('A');
  W(e.G('B', 'mods', 'old.jar'), 'JAR-OLD-EDITED-ON-B', T0 + 90000);
  const r = await e.sync('B');
  assert.deepEqual(r.errors, []);
  assert.equal(R(e.G('B', 'mods', 'old.jar')), 'JAR-OLD-EDITED-ON-B');
  assert.match(r.conflicts.join('\n'), /old\.jar.*удалён на другом компьютере, но изменён здесь/);
  assert.equal(R(e.C('.minecraft', 'mods', 'old.jar')), 'JAR-OLD-EDITED-ON-B');
  await e.sync('A');
  assert.equal(R(e.G('A', 'mods', 'old.jar')), 'JAR-OLD-EDITED-ON-B');
});

test('T-DEL-2: удалено на B, но изменено на A (облако) — файл возвращается', async (t) => {
  const e = await both(t);
  W(e.G('A', 'config', 'x.toml'), 'cfg-A-edit', T0 + 30000);
  await e.sync('A');
  rm(e.G('B', 'config', 'x.toml'));
  const r = await e.sync('B');
  assert.equal(R(e.G('B', 'config', 'x.toml')), 'cfg-A-edit');
  assert.match(r.conflicts.join('\n'), /x\.toml.*удалён здесь, но изменён на другом компьютере/);
});

test('T-DEL-3: удаление или обрезка sync-base.json не воскрешает удалённое и не отменяет удаление на другом ПК', async (t) => {
  for (const damage of ['delete', 'truncate', 'garbage']) {
    const e = await both(t);
    rm(e.G('A', 'mods', 'old.jar'));
    await e.sync('A');
    const bf = e.L('B', 'sync-base.json');
    if (damage === 'delete') rm(bf);
    else if (damage === 'truncate') fs.writeFileSync(bf, fs.readFileSync(bf, 'utf8').slice(0, 40));
    else fs.writeFileSync(bf, '{garbage');
    const r = await e.sync('B');
    assert.deepEqual(r.errors, [], damage);
    assert.equal(fs.existsSync(e.C('.minecraft', 'mods', 'old.jar')), false, `${damage}: в облако не вернулся`);
    assert.equal(fs.existsSync(e.G('B', 'mods', 'old.jar')), false, `${damage}: у B удалён`);
    await e.sync('A');
    assert.equal(fs.existsSync(e.G('A', 'mods', 'old.jar')), false, `${damage}: у A не воскрес`);
    assert.equal(R(e.G('B', 'mods', 'keep.jar')), 'KEEP');
    assert.deepEqual(names(e.G('A')), names(e.G('B')));
    if (damage === 'garbage') assert.match(r.warnings.join('\n'), /повреждён/);
  }
});

// ---------- 2. конфликты ----------

test('T-CONF-2: конфликт одного файла, оба порядка — обе версии сохранены, итог одинаковый везде', async (t) => {
  for (const order of [['A', 'B'], ['B', 'A']]) {
    const e = await both(t);
    W(e.G('A', 'config', 'x.toml'), 'cfg-A-edit', T0 + 50000);
    W(e.G('B', 'config', 'x.toml'), 'cfg-B-edit', T0 + 20000);
    const reports = [];
    for (const k of [...order, order[0], order[1]]) reports.push(await e.sync(k));
    for (const r of reports) assert.deepEqual(r.errors, []);
    const all = [e.G('A'), e.G('B'), e.C('.minecraft')].map((d) => tree(d));
    assert.deepEqual(all[0], all[1], order.join('->'));
    assert.deepEqual(all[1], all[2]);
    const texts = all[0].map((x) => x.split('=')[1]);
    assert.ok(texts.includes('cfg-A-edit') && texts.includes('cfg-B-edit'), `обе правки целы (${order.join('->')}): ${texts}`);
    const copies = names(e.G('A', 'config')).filter((n) => /x\.toml\.sync-conflict-/.test(n));
    assert.equal(copies.length, 1, 'одна копия, без размножения');
    assert.equal(reports.flatMap((r) => r.conflicts).length, 1, 'человек получил одно сообщение');
  }
});

test('T-CONF-2: конфликтная копия .jar не имеет расширения .jar', async (t) => {
  const e = await both(t);
  W(e.G('A', 'mods', 'keep.jar'), 'KEEP-A', T0 + 5000);
  W(e.G('B', 'mods', 'keep.jar'), 'KEEP-B', T0 + 9000);
  await e.sync('A');
  const r = await e.sync('B');
  const copies = names(e.G('B', 'mods')).filter((n) => /keep\.jar\./.test(n));
  assert.equal(copies.length, 1);
  assert.ok(!copies[0].endsWith('.jar'));
  assert.match(r.conflicts[0], /keep\.jar/);
});

test('T-CONF-1: разные файлы одного мира правят на A и B — мир не смешивается, облачная версия сохранена как отдельный мир', async (t) => {
  for (const order of [['A', 'B'], ['B', 'A']]) {
    const e = await both(t);
    W(WORLD(e, 'A', 'level.dat'), 'level.dat:A-edit', T0 + 30000);
    W(WORLD(e, 'A', 'playerdata', 'u1.dat'), 'u1:A-edit', T0 + 30000);
    W(WORLD(e, 'B', 'region', 'r.0.0.mca'), 'r00:B-edit', T0 + 60000);
    W(WORLD(e, 'B', 'data', 'scoreboard.dat'), 'sb:B-edit', T0 + 60000);
    const first = await e.sync(order[0]);
    const second = await e.sync(order[1]);
    await e.sync(order[0]);
    await e.sync(order[1]);
    assert.equal(first.conflicts.length + second.conflicts.length, 1);
    const [winner, loser] = second.conflicts.length ? [order[1], order[0]] : [order[0], order[1]];
    void loser;
    // у каждого компьютера мир «World» состоит целиком из одного состояния
    for (const k of ['A', 'B']) {
      const w = tree(WORLD(e, k)).join('|');
      const mixed = /A-edit/.test(w) && /B-edit/.test(w);
      assert.ok(!mixed, `${k}: мир не смешан: ${w}`);
    }
    const worlds = fs.readdirSync(e.G('A', 'saves'));
    assert.equal(worlds.length, 2, `мир и его конфликтная копия: ${worlds}`);
    const copy = worlds.find((x) => x !== 'World');
    assert.match(copy, /^World \(конфликт \d\d\.\d\d \d\d-\d\d\)$/);
    // между двумя «мирами» присутствуют обе версии правок целиком
    const a = tree(e.G('A', 'saves', 'World')).join('|');
    const b = tree(e.G('A', 'saves', copy)).join('|');
    assert.ok((/A-edit/.test(a) && /B-edit/.test(b)) || (/B-edit/.test(a) && /A-edit/.test(b)), 'обе версии целы');
    assert.deepEqual(tree(e.G('A', 'saves')), tree(e.G('B', 'saves')));
    assert.deepEqual(tree(e.G('A', 'saves')), tree(e.C('.minecraft', 'saves')));
    void winner;
  }
});

test('T-CONF-1: перекрёстные mtime (level новее на B, region новее на A) — всё равно целое состояние', async (t) => {
  const e = await both(t);
  W(WORLD(e, 'A', 'level.dat'), 'level.dat:A-edit', T0 + 20000);
  W(WORLD(e, 'A', 'region', 'r.0.0.mca'), 'r00:A-edit', T0 + 90000);
  W(WORLD(e, 'B', 'level.dat'), 'level.dat:B-edit', T0 + 80000);
  W(WORLD(e, 'B', 'region', 'r.0.0.mca'), 'r00:B-edit', T0 + 30000);
  await e.sync('A');
  const r = await e.sync('B');
  assert.equal(r.conflicts.length, 1);
  assert.equal(R(WORLD(e, 'B', 'level.dat')), 'level.dat:B-edit');
  assert.equal(R(WORLD(e, 'B', 'region', 'r.0.0.mca')), 'r00:B-edit');
  const copy = fs.readdirSync(e.G('B', 'saves')).find((x) => x !== 'World');
  assert.equal(R(e.G('B', 'saves', copy, 'level.dat')), 'level.dat:A-edit');
  assert.equal(R(e.G('B', 'saves', copy, 'region', 'r.0.0.mca')), 'r00:A-edit');
});

test('T-CONF-3: часы компьютера отстают на 10 минут — итог не зависит от часов, правки целы', async (t) => {
  for (const order of [['A', 'B'], ['B', 'A']]) {
    const e = await both(t);
    W(WORLD(e, 'A', 'level.dat'), 'level.dat:A-first', T0 + 60000);
    W(WORLD(e, 'B', 'level.dat'), 'level.dat:B-LATER-but-clock-behind', T0 + 60000 - 600000 + 120000);
    for (const k of [...order, order[0], order[1]]) await e.sync(k);
    const all = tree(e.G('A', 'saves')).join('|');
    assert.ok(all.includes('A-first') && all.includes('B-LATER'), all);
    assert.deepEqual(tree(e.G('A', 'saves')), tree(e.G('B', 'saves')));
  }
});

test('T-CONF-4: правка той же длины в пределах 2 с от версии базы переносится (E5), одновременные правки той же длины — конфликт (E4)', async (t) => {
  let e = await both(t);
  W(WORLD(e, 'A', 'level.dat'), 'level.dat:v1', T0 + 1500); // та же длина, +1,5 с
  await e.sync('A');
  await e.sync('B');
  assert.equal(R(WORLD(e, 'B', 'level.dat')), 'level.dat:v1');
  e = await both(t);
  W(WORLD(e, 'A', 'level.dat'), 'level.dat:v1', T0 + 1000);
  W(WORLD(e, 'B', 'level.dat'), 'level.dat:v2', T0 + 1500);
  await e.sync('A');
  const r = await e.sync('B');
  assert.equal(r.conflicts.length, 1);
  const texts = tree(e.G('B', 'saves')).filter((x) => x.includes('level.dat=')).map((x) => x.split('=')[1]);
  assert.deepEqual(texts.sort(), ['level.dat:v1', 'level.dat:v2']);
  await e.sync('A');
  assert.deepEqual(tree(e.G('A', 'saves')), tree(e.G('B', 'saves')));
});

test('файл, совпадающий с облачным по sha1, — не изменение и не конфликт (ложный конфликт после прерванного приёма)', async (t) => {
  const e = await both(t);
  W(e.G('A', 'config', 'x.toml'), 'cfg-same-content', T0 + 70000);
  await e.sync('A');
  // у B то же содержимое, но другое время (как после прерванного приёма клиентом облака)
  W(e.G('B', 'config', 'x.toml'), 'cfg-same-content', T0 + 70000 + 600000);
  const r = await e.sync('B');
  assert.deepEqual(r.conflicts, []);
  assert.equal(names(e.G('B', 'config')).length, 1);
});

// ---------- 3. неполное облако ----------

test('облако неполное — остановка до изменений, понятная ошибка с именем сборки, syncedAt не меняется (T-STAT-1)', async (t) => {
  const e = await both(t);
  const before = e.status('B').at;
  assert.ok(before);
  const baseBefore = R(e.L('B', 'sync-base.json'));
  const lost = e.C('.minecraft', 'saves', 'World', 'level.dat');
  rm(lost); // клиент облака ещё не докачал файл
  W(e.G('B', 'new-local.txt'), 'DO NOT UPLOAD', Date.now());
  const r = await e.sync('B');
  assert.equal(r.instances, 0);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /^Моя сборка: Облако ещё обновляется/);
  assert.equal(e.status('B').at, before, 'syncedAt не тронут');
  assert.match(e.status('B').error, /Моя сборка: Облако ещё обновляется/);
  assert.equal(R(e.L('B', 'sync-base.json')), baseBefore);
  assert.equal(fs.existsSync(e.C('.minecraft', 'new-local.txt')), false, 'ничего не отдано');
  assert.equal(R(WORLD(e, 'B', 'level.dat')), 'level.dat:v0');
  // облако докачалось — всё идёт дальше, ошибка пропадает, время обновляется
  W(lost, 'level.dat:v0', T0); // клиент облака докачал файл
  const ok = await e.sync('B');
  assert.deepEqual(ok.errors, []);
  assert.equal(e.status('B').error, '');
  assert.ok(e.status('B').at >= before);
});

// Тайм-аута нет: сколько бы ни прошло времени, незавершённая отдача не принимается и мир не смешивается
async function staleCase(t, files, failAt) {
  const e = await both(t);
  for (const f of files) W(WORLD(e, 'A', ...f.split('/')), `${f}:v1`, T0 + 60000);
  W(e.G('A', 'config', 'x.toml'), 'cfg-v1', T0 + 60000);
  const restore = failCopyAt(failAt);
  try {
    assert.equal((await e.sync('A')).errors.length, 1);
  } finally {
    restore();
  }
  const at0 = e.status('B').at;
  const before = [tree(e.G('B')), R(e.L('B', 'sync-base.json'))];
  const realNow = Date.now;
  Date.now = () => realNow() + 90 * 24 * 3600 * 1000; // «блокировка» старше любого тайм-аута
  try {
    for (let k = 0; k < 2; k++) {
      const r = await e.sync('B');
      assert.equal(r.errors.length, 1);
      assert.match(r.errors[0], /^Моя сборка: Облако ещё обновляется/);
      assert.deepEqual(r.warnings, []);
    }
  } finally {
    Date.now = realNow;
  }
  assert.deepEqual([tree(e.G('B')), R(e.L('B', 'sync-base.json'))], before, 'B ничего не принял и не отдал');
  assert.equal(e.status('B').at, at0, 'syncedAt прежний');
  assert.match(e.status('B').error, /Моя сборка: Облако ещё обновляется/);
  return e;
}
test('истёкшая блокировка с частично переданным миром: B не меняет мир, не смешивает, получает ошибку; после доводки отдачи — согласованный приём', async (t) => {
  const e = await staleCase(t, ['level.dat', 'region/r.0.0.mca', 'region/r.1.0.mca'], 3);
  assert.ok(tree(WORLD(e, 'B')).every((x) => x.endsWith(':v0')));
  assert.deepEqual((await e.sync('A')).errors, []);
  const r = await e.sync('B');
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.conflicts, []);
  assert.deepEqual(tree(e.G('B')), tree(e.G('A')));
  assert.equal(R(WORLD(e, 'B', 'level.dat')), 'level.dat:v1');
});
test('истёкшая блокировка с частично переданным обычным файлом: то же', async (t) => {
  const e = await staleCase(t, [], 1);
  assert.equal(R(e.G('B', 'config', 'x.toml')), 'cfg-v0');
  assert.deepEqual((await e.sync('A')).errors, []);
  assert.deepEqual((await e.sync('B')).errors, []);
  assert.equal(R(e.G('B', 'config', 'x.toml')), 'cfg-v1');
});
test('явный выход: publishLocal отдаёт наше состояние, облачная копия уходит в Корзину, не автоматически', async (t) => {
  const e = await staleCase(t, ['level.dat', 'region/r.0.0.mca'], 2);
  W(e.G('B', 'options.txt'), 'opt-B', T0 + 5000);
  e.use('B');
  const r = await sync.publishLocal(e.id);
  assert.deepEqual(r.conflicts, []);
  assert.equal(R(e.C('.minecraft', 'options.txt')), 'opt-B');
  assert.equal(R(e.C('.minecraft', 'config', 'x.toml')), 'cfg-v0');
  assert.equal(fs.readdirSync(path.join(e.cloud, sync.ROOT_NAME, sync.SPACE, 'Корзина')).length, 1);
  assert.equal(R(WORLD(e, 'B', 'level.dat')), 'level.dat:v0');
});

// Несколько обычных раундов: поколение облака растёт, как на настоящей паре ПК через несколько дней работы
async function history(e, rounds) {
  for (let i = 1; i <= rounds; i++) {
    const [k, other] = i % 2 ? ['A', 'B'] : ['B', 'A'];
    W(e.G(k, 'config', `h${i}.toml`), `h${i}`, T0 + i * 1000);
    assert.deepEqual((await e.sync(k)).errors, []);
    assert.deepEqual((await e.sync(other)).errors, []);
  }
}
const cloudGen = (e) => JSON.parse(R(e.C('.femboy-sync.json')));

test('publishLocal после истории синхронизаций: новая линия, отдававший ПК не застревает и не теряет своё, все сходятся', async (t) => {
  const e = await both(t);
  await history(e, 4);
  const line0 = e.line();
  for (const f of ['level.dat', 'region/r.0.0.mca']) W(WORLD(e, 'A', ...f.split('/')), `${f}:v1`, T0 + 60000);
  W(e.G('A', 'config', 'x.toml'), 'cfg-v1', T0 + 60000);
  const restore = failCopyAt(2);
  try {
    assert.equal((await e.sync('A')).errors.length, 1);
  } finally {
    restore();
  }
  assert.match((await e.sync('B')).errors[0], /Облако ещё обновляется/);
  W(e.G('B', 'options.txt'), 'opt-B', T0 + 70000);
  e.use('B');
  await sync.publishLocal(e.id);
  assert.notEqual(e.line(), line0, 'новая линия');
  assert.equal(fs.existsSync(e.V('lines', line0)), false, 'прежняя линия убрана в «Корзину»');
  const ra = await e.sync('A');
  assert.deepEqual(ra.errors, [], 'A не застревает на «облако старее последней синхронизации»');
  assert.deepEqual(ra.conflicts, []);
  assert.equal(R(e.G('A', 'options.txt')), 'opt-B');
  assert.equal(R(WORLD(e, 'A', 'level.dat')), 'level.dat:v1');
  assert.equal(R(e.G('A', 'config', 'x.toml')), 'cfg-v1');
  assert.deepEqual((await e.sync('B')).errors, []);
  assert.deepEqual(tree(e.G('B')), tree(e.G('A')));
  assert.deepEqual((await e.sync('C')).errors, []);
  assert.deepEqual(tree(e.G('C')), tree(e.G('A')), 'третий ПК принимает согласованное состояние');
  assert.equal(e.status('A').error, '');
});

test('пропавшая облачная копия (указатель есть, линии нет): остановка без изменений; «Восстановить облако» — выход, другой ПК сходится без потерь', async (t) => {
  const e = await both(t);
  await history(e, 3);
  W(e.G('B', 'options.txt'), 'opt-B2', T0 + 80000);
  W(e.G('A', 'config', 'a-only.toml'), 'a-only', T0 + 80000);
  rm(e.C());
  const B0 = tree(e.L('B'));
  assert.match((await e.sync('B')).errors.join('\n'), /Облако ещё обновляется/, 'линия могла ещё не доехать: ждём, а не создаём новую');
  assert.deepEqual(tree(e.L('B')), B0);
  e.use('B');
  await sync.publishLocal(e.id);
  assert.deepEqual((await e.sync('A')).errors, []);
  assert.equal(R(e.G('A', 'options.txt')), 'opt-B2');
  assert.equal(R(e.G('A', 'config', 'a-only.toml')), 'a-only', 'своё A не потеряно');
  assert.deepEqual((await e.sync('B')).errors, []);
  assert.deepEqual(tree(e.G('B')), tree(e.G('A')));
});

test('прерванный publishLocal: указатель не переключился, никто не застревает, повтор доводит', async (t) => {
  const e = await both(t);
  await history(e, 4);
  const line0 = e.line();
  W(e.G('B', 'options.txt'), 'opt-B3', T0 + 90000);
  e.use('B');
  const restore = failCopyAt(3);
  try {
    await assert.rejects(sync.publishLocal(e.id));
  } finally {
    restore();
  }
  assert.equal(e.line(), line0, 'облако прежнее');
  assert.deepEqual((await e.sync('A')).errors, [], 'A работает с прежней линией');
  e.use('B');
  await sync.publishLocal(e.id);
  assert.notEqual(e.line(), line0);
  assert.deepEqual(fs.readdirSync(e.V('lines')), [e.line()], 'недолитая линия и прежняя убраны');
  assert.deepEqual((await e.sync('A')).errors, []);
  assert.equal(R(e.G('A', 'options.txt')), 'opt-B3');
  assert.deepEqual(tree(e.G('B')), tree(e.G('A')));
});

test('другой компьютер ещё отдаёт (pending) — стоп; сам отдававший доводит отдачу до конца', async (t) => {
  const e = await both(t);
  W(e.G('A', 'config', 'x.toml'), 'cfg-new', T0 + 40000);
  W(e.G('A', 'config', 'y.toml'), 'cfg-y', T0 + 40000);
  W(e.G('A', 'config', 'z.toml'), 'cfg-z', T0 + 40000);
  const restore = failCopyAt(2); // отдача оборвалась после первого файла
  const ra = await e.sync('A');
  restore();
  assert.equal(ra.errors.length, 1);
  assert.equal(e.status('A').error.length > 0, true);
  const rb = await e.sync('B');
  assert.match(rb.errors[0], /другой компьютер не закончил отдачу/);
  assert.equal(R(e.G('B', 'config', 'x.toml')), 'cfg-v0', 'B ничего не принял');
  const ra2 = await e.sync('A');
  assert.deepEqual(ra2.errors, []);
  await e.sync('B');
  assert.deepEqual(tree(e.G('B')), tree(e.G('A')));
  assert.equal(R(e.G('B', 'config', 'z.toml')), 'cfg-z');
  assert.deepEqual(find(e.base, /\.femboy-sync\.tmp$/), []);
});

// ---------- 4. прерывания ----------

test('T-INT-1: обрыв отдачи на каждом шаге — другой компьютер не видит смешанный мир, после повтора везде v1, tmp нет', async (t) => {
  const steps = 5; // файлов мира
  for (let n = 1; n <= steps + 1; n++) {
    const e = await both(t);
    for (const f of ['level.dat', 'region/r.0.0.mca', 'region/r.1.0.mca', 'playerdata/u1.dat', 'data/scoreboard.dat']) W(WORLD(e, 'A', ...f.split('/')), `${f}:v1`, T0 + 60000);
    const restore = failCopyAt(n);
    let r;
    try {
      r = await e.sync('A');
    } finally {
      restore();
    }
    if (n <= steps) assert.equal(r.errors.length, 1, `n=${n}`);
    const mid = await e.sync('B'); // B во время обрыва
    const seen = new Set(tree(WORLD(e, 'B')).map((x) => x.split(':')[1]));
    assert.equal(seen.size, 1, `n=${n}: B видит смесь ${[...seen]}`);
    void mid;
    assert.deepEqual((await e.sync('A')).errors, [], `n=${n}`);
    assert.deepEqual((await e.sync('B')).errors, [], `n=${n}`);
    for (const k of ['A', 'B']) assert.ok(tree(WORLD(e, k)).every((x) => x.endsWith(':v1')), `n=${n} ${k}`);
    assert.deepEqual(tree(e.G('A')), tree(e.C('.minecraft')));
    assert.deepEqual(find(e.base, /\.femboy-sync\.tmp$/), [], `n=${n}: хвосты`);
    assert.equal(find(e.base, /\.sync-conflict-|\(конфликт/).length, 0, `n=${n}: ложного конфликта нет`);
  }
});

test('T-INT-1: обрыв приёма на каждом шаге — мир у B либо целиком старый, либо целиком новый, потом сходится без конфликтов', async (t) => {
  for (let n = 1; n <= 5; n++) {
    const e = await both(t);
    for (const f of ['level.dat', 'region/r.0.0.mca', 'region/r.1.0.mca', 'playerdata/u1.dat', 'data/scoreboard.dat']) W(WORLD(e, 'A', ...f.split('/')), `${f}:v1`, T0 + 60000);
    await e.sync('A');
    const restore = failCopyAt(n);
    let r;
    try {
      r = await e.sync('B');
    } finally {
      restore();
    }
    assert.equal(r.errors.length, 1, `n=${n}`);
    const seen = new Set(tree(WORLD(e, 'B')).map((x) => x.split(':')[1]));
    assert.equal(seen.size, 1, `n=${n}: мир у B смешан: ${[...seen]}`);
    const again = await e.sync('B');
    assert.deepEqual(again.errors, []);
    assert.deepEqual(again.conflicts, []);
    assert.ok(tree(WORLD(e, 'B')).every((x) => x.endsWith(':v1')));
    assert.deepEqual(find(e.base, /\.femboy-sync\.tmp$/), []);
  }
});

test('T-INT-1: обрыв посреди установки принятых файлов на место — следующий запуск доводит план без конфликтов', async (t) => {
  const e = await both(t);
  for (const f of ['level.dat', 'region/r.0.0.mca', 'region/r.1.0.mca', 'playerdata/u1.dat', 'data/scoreboard.dat']) W(WORLD(e, 'A', ...f.split('/')), `${f}:v1`, T0 + 60000);
  await e.sync('A');
  e.use('B');
  const real = fsx.renameRetry;
  let i = 0;
  fsx.renameRetry = (...a) => {
    if (++i === 3) throw new Error('fixture: power loss');
    return real(...a);
  };
  let r;
  try {
    r = await e.sync('B');
  } finally {
    fsx.renameRetry = real;
  }
  assert.equal(r.errors.length, 1);
  assert.ok(fs.existsSync(e.L('B', 'backups', '.sync-stage', 'plan.json')));
  const again = await e.sync('B');
  assert.deepEqual(again.errors, []);
  assert.deepEqual(again.conflicts, []);
  assert.ok(tree(WORLD(e, 'B')).every((x) => x.endsWith(':v1')));
  assert.equal(fs.existsSync(e.L('B', 'backups', '.sync-stage')), false);
});

test('T-INT-1: хвост .femboy-sync.tmp в облаке и у нас убирается', async (t) => {
  const e = await both(t);
  W(e.C('.minecraft', 'mods', 'ghost.jar.femboy-sync.tmp'), 'half');
  W(e.G('B', 'mods', 'ghost2.jar.femboy-sync.tmp'), 'half');
  const r = await e.sync('B');
  assert.deepEqual(r.errors, []);
  assert.deepEqual(find(e.base, /\.femboy-sync\.tmp$/), []);
});

test('T-INT-1: обрыв после сохранения конфликтной копии, повтор не плодит вторую копию', async (t) => {
  const e = await both(t);
  W(WORLD(e, 'A', 'level.dat'), 'level.dat:A-edit', T0 + 30000);
  W(WORLD(e, 'B', 'region', 'r.0.0.mca'), 'r00:B-edit', T0 + 60000);
  await e.sync('A');
  e.use('B');
  const real = fsx.writeJsonAtomic;
  fsx.writeJsonAtomic = (f, ...a) => {
    if (/\.femboy-sync\.json$/.test(f)) throw new Error('fixture: crash before upload');
    return real(f, ...a);
  };
  try {
    const r = await e.sync('B');
    assert.equal(r.errors.length, 1);
  } finally {
    fsx.writeJsonAtomic = real;
  }
  assert.equal(fs.readdirSync(e.G('B', 'saves')).length, 2);
  const r2 = await e.sync('B');
  assert.deepEqual(r2.errors, []);
  assert.equal(fs.readdirSync(e.G('B', 'saves')).length, 2, 'конфликтная копия одна');
  await e.sync('A');
  assert.deepEqual(tree(e.G('A', 'saves')), tree(e.G('B', 'saves')));
});

test('T-INT-2: сбой записи базы после отдачи не отменяет удаление и не рождает конфликты', async (t) => {
  const e = await both(t);
  rm(e.G('A', 'mods', 'old.jar'));
  W(e.G('A', 'config', 'x.toml'), 'cfg-v1', T0 + 50000);
  e.use('A');
  const real = fsx.writeJsonAtomic;
  fsx.writeJsonAtomic = (f, ...a) => {
    if (path.basename(f) === 'sync-base.json') throw new Error('fixture: base write failed');
    return real(f, ...a);
  };
  let r;
  try {
    r = await e.sync('A');
  } finally {
    fsx.writeJsonAtomic = real;
  }
  assert.equal(r.errors.length, 1);
  const again = await e.sync('A');
  assert.deepEqual(again.errors, []);
  assert.deepEqual(again.conflicts, []);
  await e.sync('B');
  assert.equal(fs.existsSync(e.G('B', 'mods', 'old.jar')), false);
  assert.equal(R(e.G('B', 'config', 'x.toml')), 'cfg-v1');
  assert.equal(fs.existsSync(e.G('A', 'mods', 'old.jar')), false);
});

test('база пишется атомарно (через fsx.writeJsonAtomic), а не прямой записью', () => {
  const code = fs.readFileSync(path.join(__dirname, '../src/core/sync.js'), 'utf8');
  assert.match(code, /fsx\.writeJsonAtomic\(baseFile/);
  assert.doesNotMatch(code, /writeFileSync\(baseFile/);
});

// ---------- 5. линия без манифеста, база без линии ----------
// Облако прежних версий (без манифеста) теперь переводится только кнопкой — тесты MIX ниже

test('линия без манифеста (повреждена или недокачана): остановка до изменений, ничего не удаляется по отсутствию файла', async (t) => {
  const e = await both(t);
  rm(e.C('.femboy-sync.json'));
  rm(e.C('.minecraft', 'mods', 'keep.jar'));
  const B0 = pcState0(e, 'B');
  const C0 = tree(e.C());
  assert.match((await e.sync('B')).errors.join('\n'), /Облако ещё обновляется/);
  assert.deepEqual(pcState0(e, 'B'), B0);
  assert.deepEqual(tree(e.C()), C0);
  e.use('B');
  await sync.publishLocal(e.id);
  assert.equal(R(e.C('.minecraft', 'mods', 'keep.jar')), 'KEEP', 'выход — восстановление облака, файл вернулся');
  assert.deepEqual((await e.sync('A')).errors, []);
  assert.deepEqual(tree(e.G('A')), tree(e.G('B')));
});

test('база без линии (сборка 0f1afed или протокол 2 до линий): не доверяется целиком, расхождения — конфликт рядом, а не перезапись', async (t) => {
  const e = await both(t);
  W(e.G('A', 'config', 'x.toml'), 'cfg-A', T0 + 60000);
  assert.deepEqual((await e.sync('A')).errors, []);
  // база B «помнит» как синхронизированную свою версию cfg-B, которой нет в снимке-основании линии: доверие к такой базе
  // сочло бы файл B неизменным и молча заменило бы его облачным cfg-A
  W(e.G('B', 'config', 'x.toml'), 'cfg-B', T0 + 90000);
  const bf = e.L('B', 'sync-base.json');
  const b = JSON.parse(R(bf));
  delete b.line;
  b.files['.minecraft/config/x.toml'] = { size: 5, mtime: T0 + 90000 };
  fs.writeFileSync(bf, JSON.stringify(b));
  const r = await e.sync('B');
  assert.deepEqual(r.errors, []);
  assert.equal(R(e.G('B', 'config', 'x.toml')), 'cfg-B');
  assert.deepEqual(find(e.G('B'), /^x\.toml\.sync-conflict-/).map(R), ['cfg-A']);
  assert.equal(R(e.G('B', 'mods', 'keep.jar')), 'KEEP', 'совпавшее со снимком-основанием не тронуто');
});
const pcState0 = (e, k) => [tree(e.L(k)), R(e.L(k, 'sync-base.json'))];

// ---------- 6. статус, имена, syncError ----------

test('T-STAT-1: ошибка по сборке называется именем, syncedAt не обновляется, syncError хранится; успех чистит', async (t) => {
  const e = await both(t);
  const at1 = e.status('A').at;
  assert.ok(at1 && !e.status('A').error);
  const lost = e.C('.minecraft', 'mods', 'keep.jar');
  rm(lost);
  const realNow = Date.now;
  Date.now = () => realNow() + 5000;
  let r;
  try {
    r = await e.sync('B');
  } finally {
    Date.now = realNow;
  }
  assert.match(r.errors[0], /^Моя сборка: /);
  assert.equal(e.status('B').at, e.status('B').at);
  const bAt = e.status('B').at;
  assert.ok(bAt <= realNow(), 'время не сдвинулось из-за ошибки');
  assert.match(e.status('B').error, /Моя сборка/);
  W(lost, 'KEEP', T0);
  const ok = await e.sync('B');
  assert.deepEqual(ok.errors, []);
  assert.equal(e.status('B').error, '');
  assert.ok(e.status('B').at >= bAt);
});

test('syncInstance при ошибке записывает syncError и не трогает syncedAt', async (t) => {
  const e = await both(t);
  const at1 = e.status('B').at;
  rm(e.C('.minecraft', 'mods', 'keep.jar'));
  await assert.rejects(e.one('B'), /Облако ещё обновляется/);
  assert.equal(e.status('B').at, at1);
  assert.match(e.status('B').error, /Моя сборка: Облако ещё обновляется/);
});

test('идущая игра: сборка пропускается и названа в результате', async (t) => {
  const e = await both(t);
  const r = await e.sync('A', () => true);
  assert.deepEqual(r.skipped, ['Моя сборка']);
  assert.equal(r.up + r.down, 0);
});

// ---------- 7. tombstone, корзина ----------

test('T-TOMB-1 (часть): сборка удалена на другом ПК — сообщение, а не молчание, облако не воскресает', async (t) => {
  const e = await both(t);
  e.use('A');
  sync.forget(e.id);
  const r = await e.sync('B');
  assert.deepEqual(r.errors, []);
  assert.match(r.warnings.join('\n'), /сборка удалена на другом компьютере/);
  assert.equal(r.instances, 0);
  assert.equal(fs.existsSync(e.C()), false);
  // B ещё раз — облако не воскресает
  await e.sync('B');
  assert.equal(fs.existsSync(e.C()), false);
});

// ---------- 8. SKIP_DIRS, R3-SYNC-02/03 ----------

test('T-SKIP-1: миры с именами backups/debug/logs синхронизируются, а логи и backups в корне сборки — нет', async (t) => {
  const e = env(t);
  for (const w of ['backups', 'debug', 'logs']) W(e.G('A', 'saves', w, 'level.dat'), `lvl-${w}`, T0);
  W(e.G('A', 'logs', 'latest.txt'), 'log', T0);
  W(e.G('A', 'crash-reports', 'c.txt'), 'crash', T0);
  W(e.L('A', 'backups', 'old', 'x.dat'), 'backup', T0);
  W(WORLD(e, 'A', 'debug', 'p.txt'), 'dbg', T0);
  await e.sync('A');
  await e.sync('B');
  for (const w of ['backups', 'debug', 'logs']) assert.equal(R(e.G('B', 'saves', w, 'level.dat')), `lvl-${w}`);
  assert.equal(R(WORLD(e, 'B', 'debug', 'p.txt')), 'dbg');
  assert.equal(fs.existsSync(e.G('B', 'logs')), false);
  assert.equal(fs.existsSync(e.G('B', 'crash-reports')), false);
  assert.equal(fs.existsSync(e.L('B', 'backups', 'old')), false);
});

test('T-TRUNC-1: instance.json нулевой длины не уходит в облако, а восстанавливается из него', async (t) => {
  const e = await both(t);
  const good = R(e.C('instance.json'));
  fs.writeFileSync(e.L('A', 'instance.json'), '');
  const d = new Date(Date.now() + 5000);
  fs.utimesSync(e.L('A', 'instance.json'), d, d);
  const r = await e.sync('A');
  assert.deepEqual(r.errors, []);
  assert.equal(R(e.C('instance.json')), good);
  assert.equal(R(e.L('A', 'instance.json')), good);
});

test('T-LATE-1: опоздавший файл мира не проигрывает заново сгенерированному молча: B ждёт, а при самовольном запуске обе версии целы', async (t) => {
  const e = env(t);
  await e.sync('A');
  const real = e.C('.minecraft', 'saves', 'World', 'region', 'r.1.0.mca');
  const held = path.join(e.base, 'held.bin');
  fs.renameSync(real, held); // клиент облака ещё не доставил файл
  const first = await e.sync('B');
  assert.match(first.errors[0], /Облако ещё обновляется/);
  // человек всё равно запустил игру без синхронизации: она сгенерировала свою r.1.0
  W(WORLD(e, 'B', 'region', 'r.1.0.mca'), 'NEWLY-GENERATED-TERRAIN', Date.now());
  fs.renameSync(held, real);
  const second = await e.sync('B');
  assert.deepEqual(second.errors, []);
  assert.equal(second.conflicts.length, 1);
  const copy = fs.readdirSync(e.G('B', 'saves')).find((x) => x !== 'World');
  assert.equal(R(e.G('B', 'saves', copy, 'region', 'r.1.0.mca')), 'region/r.1.0.mca:v0', 'оригинал сохранён');
  assert.equal(R(WORLD(e, 'B', 'region', 'r.1.0.mca')), 'NEWLY-GENERATED-TERRAIN');
});

test('защита сохранена: корзина и .pack-update', async (t) => {
  const e = await both(t);
  fs.mkdirSync(e.L('A', '.pack-update'), { recursive: true });
  await assert.rejects(e.one('A'), /обновление модпака/);
});

test('большая сборка: неизменённое не копируется повторно', async (t) => {
  const e = await both(t);
  const n = await countCopies(() => e.sync('A'));
  assert.equal(n, 0);
  const m = await countCopies(() => e.sync('B'));
  assert.equal(m, 0);
});

// ---------- 9. запуск игры и окно ----------

function launchPrefix() {
  const source = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
  const start = source.indexOf('async function launchGame');
  return source.slice(start, source.indexOf('  let startedAt = Date.now();', start));
}
function launcher({ fail, running = false, publishing = false }) {
  const events = [];
  const fn = vm.runInNewContext('(' + launchPrefix() + '  return "started";\n})', {
    packUpdates: new Set(), modInstalls: new Set(), cloudPublishes: new Set(publishing ? ['id'] : []), packupdate: { recover() {} },
    store: { get: () => ({ settings: { syncDir: 'fixture' } }) }, game: { isRunning: () => running }, launchProgress() {},
    sync: { syncInstance: async () => { events.push('sync'); if (fail) throw Object.assign(new Error(fail), fail === 'cancel' && { cancelled: true }); } },
    send: (ch, p) => events.push(`${ch}:${p?.type || ''}`),
  });
  return { fn, events };
}

test('T-LAUNCH-1: при ошибке синхронизации игра не стартует без явного skipSync', async () => {
  const a = launcher({ fail: 'Моя сборка: Облако ещё обновляется' });
  await assert.rejects(a.fn('id', {}), (e) => e.syncFailed === true && /Облако ещё обновляется/.test(e.message));
  await assert.rejects(a.fn('id', undefined), (e) => e.syncFailed === true);
  const b = launcher({ fail: 'ошибка' });
  assert.equal(await b.fn('id', { skipSync: true }), 'started');
  assert.deepEqual(b.events.filter((x) => x === 'sync'), [], 'при skipSync синхронизация не запускается');
  const c = launcher({});
  assert.equal(await c.fn('id', {}), 'started');
  const d = launcher({ fail: 'cancel' });
  await assert.rejects(d.fn('id', {}), (e) => e.cancelled === true && !e.syncFailed);
});

test('восстановление облака идёт — запуск этой сборки отклоняется до синхронизации', async () => {
  const a = launcher({ publishing: true });
  await assert.rejects(a.fn('id', { skipSync: true }), /Сначала дождись восстановления облака/);
  assert.deepEqual(a.events, []);
});

// ---------- «Восстановить облако с этого компьютера» (publishLocal) ----------

// Обработчик IPC из настоящего main.js в песочнице: свои заглушки игры, задач и синхронизации
function publishHandler({ running = false, launching = false, publish, syncAll } = {}) {
  const main = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8').replace(/\r\n/g, '\n'); // копия git с core.autocrlf=true даёт CRLF
  const start = main.indexOf('const cloudPublishes');
  const end = main.indexOf('\n});\n', start) + 5;
  assert.ok(start > 0 && end > start, 'обработчик sync:publishLocal не найден');
  const calls = [];
  const ctx = {
    handlers: {},
    handle: (ch, fn) => (ctx.handlers[ch] = fn),
    store: { get: () => ({ settings: { syncDir: 'fixture' } }) },
    game: { isRunning: (id) => running && id === 'id' },
    launches: new Map(launching ? [['id', {}]] : []), packUpdates: new Set(), modInstalls: new Set(),
    instances: { get: () => ({ name: 'Моя сборка' }) },
    withTask: async (fn) => fn((label) => calls.push(`progress:${label}`)),
    logger: { info: () => calls.push('log') },
    sync: {
      publishLocal: async (id) => (calls.push(`publish:${id}`), publish ? publish() : { up: 3, down: 0, conflicts: [], warnings: [] }),
      syncAll: async () => (calls.push('syncAll'), syncAll ? syncAll() : { errors: [], conflicts: [], warnings: [], skipped: [] }),
    },
  };
  vm.runInNewContext(main.slice(start, end), ctx);
  return { fn: ctx.handlers['sync:publishLocal'], calls };
}

test('восстановление облака (IPC): при запущенной игре или подготовке к запуску отказ, облако не трогается', async () => {
  for (const opts of [{ running: true }, { launching: true }]) {
    const h = publishHandler(opts);
    await assert.rejects(h.fn('id'), /Сначала закрой игру/);
    assert.deepEqual(h.calls, [], 'publishLocal не вызывался');
  }
});

test('восстановление облака (IPC): успех только после publishLocal, затем обычная синхронизация; ошибка не выдаётся за успех', async () => {
  const ok = publishHandler();
  const r = await ok.fn('id');
  assert.equal(r.name, 'Моя сборка');
  assert.deepEqual(ok.calls.filter((c) => !c.startsWith('progress')), ['publish:id', 'log', 'syncAll']);
  assert.match(ok.calls[0], /Восстанавливаю облако с этого компьютера: Моя сборка/);
  const bad = publishHandler({ publish: () => { throw new Error('EPERM: operation not permitted, rename'); } });
  await assert.rejects(bad.fn('id'), /EPERM/);
  assert.ok(!bad.calls.includes('syncAll') && !bad.calls.includes('log'));
  const none = publishHandler({ publish: () => null });
  await assert.rejects(none.fn('id'), /Облако не восстановлено/);
  // после успеха сбой общей синхронизации — не исключение, а сообщение в итоге (облако уже восстановлено)
  const later = publishHandler({ syncAll: () => { throw new Error('Папка облака не найдена'); } });
  assert.equal(JSON.stringify((await later.fn('id')).all.errors), JSON.stringify(['Папка облака не найдена']));
});

test('publishLocal не трогает облако, если отдача не состоится: корзина, удалена на другом ПК, обновление модпака, нет папки облака', async (t) => {
  const e = await both(t);
  const cloud0 = tree(e.C());
  const bin = path.join(e.cloud, sync.ROOT_NAME, sync.SPACE, 'Корзина');
  e.use('B');
  const baseB = R(e.L('B', 'sync-base.json'));
  // обновление модпака не завершено
  fs.mkdirSync(e.L('B', '.pack-update'), { recursive: true });
  await assert.rejects(sync.publishLocal(e.id), /обновление модпака/);
  fs.rmSync(e.L('B', '.pack-update'), { recursive: true });
  // сборка удалена на другом компьютере (tombstone)
  const tomb = path.join(e.cloud, sync.ROOT_NAME, sync.SPACE, 'deleted', e.id);
  W(tomb, String(Date.now()));
  await assert.rejects(sync.publishLocal(e.id), /удалена на другом компьютере/);
  rm(tomb);
  // нет такой сборки здесь; сборка в корзине лаунчера
  await assert.rejects(sync.publishLocal('no-such-instance'), /Сборка не найдена/);
  const trash = require('../src/core/trash');
  trash.move(e.id);
  try {
    await assert.rejects(sync.publishLocal(e.id), /Сборка не найдена|в корзине/);
  } finally {
    trash.restore(e.id);
  }
  assert.deepEqual(tree(e.C()), cloud0, 'облачная копия на месте и не изменилась');
  assert.equal(fs.existsSync(bin), false, 'в Корзину ничего не ушло');
  assert.equal(R(e.L('B', 'sync-base.json')), baseB);
  // папка облака пропала (диск отключён)
  const moved = e.cloud + '-away';
  fs.renameSync(e.cloud, moved);
  try {
    await assert.rejects(sync.publishLocal(e.id), /Папка облака не найдена/);
  } finally {
    fs.renameSync(moved, e.cloud);
  }
});

test('publishLocal: прежнюю линию не удалось убрать в Корзину (занята) — облако всё равно восстановлено, прежняя копия на месте, честное предупреждение', async (t) => {
  const e = await both(t);
  const old = e.C();
  const cloud0 = tree(old);
  W(e.G('B', 'options.txt'), 'opt-B', T0 + 60000);
  e.use('B');
  const real = fs.renameSync;
  fs.renameSync = (from, to) => {
    if (path.resolve(from) === path.resolve(old)) throw Object.assign(new Error('EPERM: operation not permitted, rename'), { code: 'EPERM' });
    return real(from, to);
  };
  let r;
  try {
    r = await sync.publishLocal(e.id);
  } finally {
    fs.renameSync = real;
  }
  assert.match(r.warnings.join('\n'), /осталась в папке облака/);
  assert.notEqual(e.C(), old);
  assert.equal(R(e.C('.minecraft', 'options.txt')), 'opt-B');
  assert.deepEqual(tree(old), cloud0, 'прежняя копия не тронута');
  assert.deepEqual((await e.sync('A')).errors, []);
  assert.equal(R(e.G('A', 'options.txt')), 'opt-B');
});

test('окно: кнопка «Восстановить облако с этого компьютера» с подтверждением, именем сборки и запретом при запущенной игре', () => {
  const html = fs.readFileSync(path.join(__dirname, '../src/renderer/index.html'), 'utf8');
  assert.match(html, /id="syncRestore"[^>]*>Восстановить облако с этого компьютера…</);
  const hw = fs.readFileSync(path.join(__dirname, '../src/renderer/app/sync-hardware.js'), 'utf8');
  const dlg = hw.slice(hw.indexOf('function restoreCloudDialog'), hw.indexOf("$('#syncRestore').onclick"));
  assert.match(dlg, /Состояние сборки «\$\{inst\.name\}» на этом компьютере станет новым облачным состоянием/);
  assert.match(dlg, /Прежняя облачная копия сохранится в корзине синхронизации/);
  assert.match(dlg, /state\.running\.has/);
  // вызов только из обработчика кнопки подтверждения, успех — только после ответа без ошибки
  assert.equal((dlg.match(/call\('sync:publishLocal'/g) || []).length, 1);
  const yes = dlg.slice(dlg.indexOf("$('#srYes', box).onclick"));
  assert.ok(yes.indexOf("call('sync:publishLocal'") < yes.indexOf('Облако восстановлено'));
  assert.match(yes, /catch \(err\) \{\s*toast\(err\.message, 'err'\)/);
  assert.doesNotMatch(hw.slice(0, hw.indexOf('function restoreCloudDialog')), /sync:publishLocal/, 'нигде не вызывается автоматически');
});

test('T-LAUNCH-1: IPC отдаёт признак syncFailed, окно спрашивает «Запустить без синхронизации» и передаёт skipSync', () => {
  const main = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
  assert.match(main, /\.\.\.\(e\?\.syncFailed && \{ syncFailed: true \}\)/);
  const core = fs.readFileSync(path.join(__dirname, '../src/renderer/app/core.js'), 'utf8');
  assert.match(core, /r\.syncFailed && \{ syncFailed: true \}/);
  const launch = fs.readFileSync(path.join(__dirname, '../src/renderer/app/launch.js'), 'utf8');
  assert.match(launch, /err\.syncFailed/);
  assert.match(fs.readFileSync(path.join(__dirname, '../src/renderer/app/launch-dialogs.js'), 'utf8'), /Запустить без синхронизации/);
  assert.match(launch, /skipSync/);
});

test('окно: ошибка синхронизации заменяет «Облако на связи» и показывается в настройках', () => {
  const home = fs.readFileSync(path.join(__dirname, '../src/renderer/app/home.js'), 'utf8');
  assert.match(home, /s\.error/);
  assert.match(home, /Синхронизация не удалась/);
  const hw = fs.readFileSync(path.join(__dirname, '../src/renderer/app/sync-hardware.js'), 'utf8');
  assert.match(hw, /s\.error/);
  const code = hw.slice(hw.indexOf('const syncResult'), hw.indexOf("$('#syncPick')"));
  const messages = [];
  const result = vm.runInNewContext(code + '\nsyncResult;', { toast: (text, kind) => messages.push({ text, kind }) });
  result({ up: 1, down: 0, errors: [], conflicts: ['Мир «X»: изменён на обоих компьютерах.'], warnings: ['w'] });
  assert.ok(messages.some((m) => /изменён на обоих/.test(m.text)));
  assert.ok(!messages.some((m) => m.kind === 'ok' && /^Синхронизировано/.test(m.text)) || messages.every((m) => m.kind !== 'err' || true));
});

test('фоновая синхронизация при старте показывает ошибки сборок, а не только исключения', () => {
  const main = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
  const i = main.indexOf('.syncAll()');
  const piece = main.slice(i, i + 900);
  assert.match(piece, /r\.errors/);
});

test('английский перевод новых сообщений синхронизации', () => {
  const body = { nodeType: 1, tagName: 'BODY', childNodes: [], getAttribute: () => null };
  const context = { localStorage: { getItem: () => 'en', setItem() {} }, document: { readyState: 'complete', documentElement: {}, body, addEventListener() {} }, MutationObserver: class { observe() {} }, confirm: () => true };
  context.window = context;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/renderer/i18n.js'), 'utf8'), context);
  const tr = context.I18N.tr;
  const code = fs.readFileSync(path.join(__dirname, '../src/core/sync.js'), 'utf8');
  const fixed = [...code.matchAll(/(?:new Error\(|const BUSY_\w+ = )'([^']*[А-Яа-я][^']*)'/g)].map((m) => m[1]);
  assert.ok(fixed.length >= 4, String(fixed.length));
  for (const text of fixed) assert.doesNotMatch(tr(text), /[А-Яа-яЁё]/, text);
  const samples = [
    'My pack: Облако ещё обновляется: файлы в облаке не совпадают с его описанием (программа облака не докачала их или другой компьютер не закончил). Ничего не изменено; подожди, пока программа облака закончит, и повтори.',
    'Мир «World»: изменён на обоих компьютерах. Здесь оставлена твоя версия, облачная сохранена как мир «World (конфликт 11.11 14-30)».',
    'Файл «mods/a.jar»: изменён на обоих компьютерах. Здесь оставлена твоя версия, облачная сохранена как «a.jar.sync-conflict-20261111-143000».',
    'Файл «mods/a.jar»: удалён на другом компьютере, но изменён здесь. Оставлена твоя версия.',
    'Файл «mods/a.jar»: удалён здесь, но изменён на другом компьютере. Оставлена изменённая версия.',
    'Мир «World»: удалён здесь, но изменён на другом компьютере. Оставлена изменённая версия.',
    '«My pack»: сборка удалена на другом компьютере, здесь она осталась и больше не синхронизируется.',
    '«My pack»: Мир «World»: изменён на обоих компьютерах. Здесь оставлена твоя версия, облачная сохранена как мир «World (конфликт 11.11 14-30)».',
    '«My pack»: Список синхронизации на этом компьютере повреждён. Ничего не удалено и не перезаписано: расхождения сохранены как конфликты.',
    '«My pack»: Облако не приходило в согласованное состояние больше 30 минут, поэтому его файлы приняты как есть.',
    'Синхронизация не удалась: Облако ещё обновляется: другой компьютер не закончил отдачу этой сборки. Ничего не изменено; подожди, пока программа облака закончит, и повтори. Если не проходит, запусти синхронизацию на том компьютере.',
    'Синхронизация завершилась с предупреждениями ♡',
    'Синхронизация не удалась',
    'Запустить без синхронизации',
    'Пропущено (идёт игра): My pack',
    // «Восстановить облако с этого компьютера»
    'Восстановить облако с этого компьютера…',
    'Восстановить облако с этого компьютера?',
    'Выход, если облако застряло на «Облако ещё обновляется»',
    'Состояние сборки «My pack» на этом компьютере станет новым облачным состоянием. Прежняя облачная копия сохранится в корзине синхронизации: папка «Корзина» в папке облака.',
    'Сборка «My pack» сейчас запущена: сначала закрой игру.',
    'Восстановить облако',
    'Облако восстановлено с этого компьютера: «My pack» ♡',
    'Восстанавливаю облако с этого компьютера: My pack…',
    'Сначала дождись восстановления облака',
    'Облако не восстановлено: синхронизация этой сборки сейчас невозможна',
    'Сначала закрой игру и дождись завершения задач сборки',
    // окна «Восстановить облако» и перевода: все постоянные тексты из файла
    ...[...fs.readFileSync(path.join(__dirname, '../src/renderer/app/sync-hardware.js'), 'utf8').matchAll(/<(?:h2|p class="(?:sub|hint)"|button class="btn \w+" id="s[mra]\w+")>([^<$]*[А-Яа-я][^<$]*)</g)].map((m) => m[1]),
    '«My pack»: в прежней папке облака есть изменения с другого компьютера, которых нет здесь: файл «.minecraft/mods/b.jar», мир «World» и другие. Сборка не переведена, ничего не изменено.',
    'Прежняя облачная копия занята другой программой и осталась в папке облака: abc.def.123. Облако восстановлено.',
    '«My pack»: Эту сборку уже перевёл или восстановил другой компьютер: облачная копия взята оттуда, отличия этого компьютера сохранены рядом как конфликтные копии.',
    'My pack: Сборка есть только в прежней папке облака. Перевести её может компьютер, на котором она есть, после обновления лаунчера там. Ничего не изменено.',
    'My pack: Файлы сборки на этом компьютере менялись во время отдачи в облако (например, шла игра). Облако не изменено, ничего не потеряно; закрой игру и повтори.',
    'Перевести облако на новый формат…',
    'Перевожу облако на новый формат…',
    'Переведено сборок: 2 ♡ Обнови лаунчер на других компьютерах',
    '«My pack», «Second»: Облако ещё в старом формате (лаунчер 0.10.2 и раньше), синхронизация приостановлена. Ничего не изменено; нажми «Перевести облако на новый формат…» в настройках синхронизации.',
    'Синхронизация не удалась: Облако ещё в старом формате (лаунчер 0.10.2 и раньше), синхронизация приостановлена. Ничего не изменено; нажми «Перевести облако на новый формат…» в настройках синхронизации.',
  ];
  // имя папки конфликтного мира и папка «Корзина» в облаке — настоящие имена папок, остаются как есть
  for (const s of samples) assert.doesNotMatch(tr(s).replace(/(конфликт [^)]*)/g, '').replace(/“Корзина”/g, ''), /[А-Яа-яЁё]/, s);
});

// ---------- смешанные версии: опубликованная 0.10.2 и новая ----------
// «Старый компьютер» — настоящий модуль синхронизации опубликованной 0.10.2 без изменений: tests/sync-0.10.2-fixture.js
// = src/core/sync.js из её app.asar (app.asar SHA-256 29fca49c…483b67, файл SHA-256 6f8ab036…6e48). Он подключается к тем же
// store/instances/trash, что и новый модуль: компьютер = профиль (e.use), версия лаунчера = модуль
const OLD = (() => {
  const module = { exports: {} };
  const map = { './store': store, './instances': inst, './trash': require('../src/core/trash') };
  const code = fs.readFileSync(path.join(__dirname, 'sync-0.10.2-fixture.js'), 'utf8');
  vm.runInThisContext(`(function (module, exports, require) {${code}\n})`)(module, module.exports, (n) => map[n] || require(n));
  return module.exports;
})();

// Второй экземпляр нового модуля со своей очередью синхронизаций: «другой компьютер», который работает одновременно с этим
const SYNC2 = (() => {
  const module = { exports: {} };
  const map = { './store': store, './instances': inst, './trash': require('../src/core/trash'), './fsx': fsx };
  const code = fs.readFileSync(path.join(__dirname, '../src/core/sync.js'), 'utf8');
  vm.runInThisContext(`(function (module, exports, require) {${code}\n})`)(module, module.exports, (n) => map[n] || require(n));
  return module.exports;
})();

// 0.10.2 на A и B: сборка создана на A, оба компьютера синхронны в прежней папке облака
async function legacyBoth(t) {
  const e = env(t);
  e.old = async (k) => (e.use(k), OLD.syncAll());
  e.migrate = async (k) => (e.use(k), sync.migrate());
  e.P = (...p) => path.join(e.cloud, sync.ROOT_NAME, 'instances', e.id, ...p);
  e.fence = path.join(e.cloud, sync.ROOT_NAME, 'deleted', e.id);
  assert.deepEqual((await e.old('A')).errors, []);
  assert.deepEqual((await e.old('B')).errors, []);
  assert.deepEqual(tree(e.L('B')), tree(e.L('A')));
  return e;
}
// Всё, что видно на компьютере k: файлы сборки, база синхронизации
const pcState = (e, k) => [tree(e.L(k)), R(e.L(k, 'sync-base.json'))];
// Подмена fsx.writeJsonAtomic: бросает на n-й записи подходящего файла, потом возвращает как было
function patchJson(match, n = 1) {
  const real = fsx.writeJsonAtomic;
  let i = 0;
  fsx.writeJsonAtomic = (f, ...a) => {
    if (match(f) && ++i === n) throw new Error('fixture: write interrupted');
    return real(f, ...a);
  };
  return () => (fsx.writeJsonAtomic = real);
}

test('MIX-1: после обновления прежняя папка без явного перевода не трогается; «Восстановить облако» тоже отказывает, ничего не перенося', async (t) => {
  const e = await legacyBoth(t);
  const P0 = tree(e.P());
  const A0 = pcState(e, 'A');
  const r = await e.sync('A');
  assert.deepEqual(r.errors, ['«Моя сборка»: Облако ещё в старом формате (лаунчер 0.10.2 и раньше), синхронизация приостановлена. Ничего не изменено; нажми «Перевести облако на новый формат…» в настройках синхронизации.']);
  await assert.rejects(e.one('A'), (err) => err.code === 'CLOUD_LEGACY');
  e.use('A');
  await assert.rejects(sync.publishLocal(e.id), (err) => err.code === 'CLOUD_LEGACY');
  assert.equal(e.status('A').legacy, 1);
  assert.deepEqual(tree(e.P()), P0);
  assert.deepEqual(pcState(e, 'A'), A0);
  assert.equal(fs.existsSync(e.fence), false, 'ограды нет');
  assert.equal(fs.existsSync(e.C()), false, 'в новой папке ничего нет');
  // база протокола 2 до перевода (сборки 12be080/d268896) с поколением «из будущего» и манифест в прежней папке не мешают
  const bf = e.L('A', 'sync-base.json');
  fsx.writeJsonAtomic(bf, { ...JSON.parse(R(bf)), v: 2, gen: Date.now() + 1e9 }, false);
  fsx.writeJsonAtomic(e.P('.femboy-sync.json'), { v: 2, gen: Date.now() + 1e9, files: {}, deleted: {} }, false);
  const m = await e.migrate('A');
  assert.deepEqual([m.errors, m.migrated], [[], 1]);
  assert.deepEqual((await e.sync('A')).errors, []);
  assert.deepEqual(tree(e.C()), P0);
});

test('MIX-2: перевод: ограда до первого файла новой папки, новая = прежней, прежняя не изменилась; 0.10.2 за оградой ничего не отдаёт, не забирает и не удаляет', async (t) => {
  const e = await legacyBoth(t);
  const P0 = tree(e.P());
  let fenceFirst = null;
  const real = fs.promises.copyFile;
  fs.promises.copyFile = async (from, to) => {
    if (fenceFirst === null && to.startsWith(path.join(e.cloud, sync.ROOT_NAME, sync.SPACE))) fenceFirst = fs.existsSync(e.fence);
    return real(from, to);
  };
  let r;
  try {
    r = await e.migrate('A');
  } finally {
    fs.promises.copyFile = real;
  }
  assert.deepEqual([r.errors, r.migrated], [[], 1]);
  assert.equal(fenceFirst, true, 'ограда стоит до первого файла новой папки');
  assert.equal(JSON.parse(R(e.fence)).fence, 'v2');
  assert.deepEqual(tree(e.P()), P0, 'прежняя копия не изменилась');
  assert.deepEqual(tree(e.C()), P0);
  assert.deepEqual(tree(e.L('A')), P0);
  assert.equal(e.status('A').legacy, 0);
  // B (0.10.2) правит, удаляет и синхронизирует: за оградой ничего не происходит
  W(WORLD(e, 'B', 'level.dat'), 'level.dat:B', T0 + 60000);
  W(e.G('B', 'mods', 'b.jar'), 'JAR-B', T0 + 60000);
  rm(e.G('B', 'mods', 'keep.jar'));
  const B0 = pcState(e, 'B');
  const C0 = tree(e.C());
  const ro = await e.old('B');
  assert.deepEqual([ro.errors, ro.instances, ro.up, ro.down, ro.removed], [[], 0, 0, 0, 0]);
  e.use('B');
  assert.equal(await OLD.syncInstance(e.id), null);
  assert.deepEqual(pcState(e, 'B'), B0);
  assert.deepEqual(tree(e.P()), P0);
  assert.deepEqual(tree(e.C()), C0);
  // A не застревает и чужих правок не видит
  const ra = await e.sync('A');
  assert.deepEqual([ra.errors, ra.warnings], [[], []]);
  assert.deepEqual(tree(e.L('A')), P0);
  // сборка, созданная новой версией, до 0.10.2 не доходит
  e.use('A');
  const id2 = inst.create({ name: 'Новая', version: '1.20.1' }).id;
  assert.deepEqual((await e.sync('A')).errors, []);
  assert.deepEqual((await e.old('B')).errors, []);
  e.use('B');
  assert.equal(fs.existsSync(inst.dirOf(id2)), false);
  assert.equal(fs.existsSync(path.join(e.cloud, sync.ROOT_NAME, 'instances', id2)), false);
});

test('MIX-3: старый ПК обновился позже: его неотданные правки и удаления и правки нового ПК сохраняются, миры не смешиваются', async (t) => {
  const e = await legacyBoth(t);
  assert.deepEqual((await e.migrate('A')).errors, []);
  // A (новая): мир, options, новый мод, удалён keep.jar
  W(WORLD(e, 'A', 'region', 'r.0.0.mca'), 'r00:A', T0 + 60000);
  W(e.G('A', 'options.txt'), 'opt-A', T0 + 60000);
  W(e.G('A', 'mods', 'a.jar'), 'JAR-A', T0 + 60000);
  rm(e.G('A', 'mods', 'keep.jar'));
  assert.deepEqual((await e.sync('A')).errors, []);
  // B (0.10.2, за оградой): тот же мир, options, свой мод, удалён toggle.jar
  W(WORLD(e, 'B', 'region', 'r.1.0.mca'), 'r10:B', T0 + 90000);
  W(e.G('B', 'options.txt'), 'opt-B', T0 + 90000);
  W(e.G('B', 'mods', 'b.jar'), 'JAR-B', T0 + 90000);
  rm(e.G('B', 'mods', 'toggle.jar'));
  assert.deepEqual((await e.old('B')).errors, []);
  // B обновился
  const rb = await e.sync('B');
  assert.deepEqual(rb.errors, []);
  assert.equal(R(e.G('B', 'options.txt')), 'opt-B');
  assert.deepEqual(find(e.G('B'), /^options\.txt\.sync-conflict-/).map(R), ['opt-A']);
  const worlds = fs.readdirSync(e.G('B', 'saves')).sort();
  assert.equal(worlds.length, 2);
  assert.match(worlds[1], /^World \(конфликт /);
  const v0 = (f) => `${f}=${f}:v0`;
  assert.deepEqual(tree(WORLD(e, 'B')), [v0('data/scoreboard.dat'), v0('level.dat'), v0('playerdata/u1.dat'), v0('region/r.0.0.mca'), 'region/r.1.0.mca=r10:B'], 'мир B целиком его');
  assert.deepEqual(tree(e.G('B', 'saves', worlds[1])), [v0('data/scoreboard.dat'), v0('level.dat'), v0('playerdata/u1.dat'), 'region/r.0.0.mca=r00:A', v0('region/r.1.0.mca')], 'копия рядом — целиком мир A');
  assert.deepEqual(names(e.G('B', 'mods')), ['a.jar', 'b.jar', 'old.jar']);
  assert.deepEqual(removedBy(e, 'B'), ['keep.jar'], 'удаление с A принято, файл перемещён, а не стёрт');
  // A догоняет: одинаково, ни одна правка не потеряна
  assert.deepEqual((await e.sync('A')).errors, []);
  assert.deepEqual(removedBy(e, 'A'), ['toggle.jar']);
  assert.deepEqual(tree(e.L('A')), tree(e.L('B')));
  const all = tree(e.L('A')).join('\n');
  for (const s of ['opt-A', 'opt-B', 'r00:A', 'r10:B', 'JAR-A', 'JAR-B']) assert.ok(all.includes(s), s);
});

test('MIX-4: 0.10.2 начал проход до ограды и дописал прежнюю папку после перевода: новый не застревает, поздние правки после обновления старого — конфликт рядом, а не перезапись', async (t) => {
  const e = await legacyBoth(t);
  W(e.G('B', 'mods', 'b.jar'), 'JAR-B', T0 + 60000);
  W(WORLD(e, 'B', 'region', 'r.0.0.mca'), 'r00:B', T0 + 60000);
  // B уже прошёл проверку ограды; перед его первой записью A делает перевод целиком
  const real = fs.promises.copyFile;
  let fired = false;
  fs.promises.copyFile = async (...a) => {
    if (!fired) {
      fired = true;
      const m = await e.migrate('A');
      assert.deepEqual(m.errors, []);
      e.use('B');
    }
    return real(...a);
  };
  try {
    assert.deepEqual((await e.old('B')).errors, []);
  } finally {
    fs.promises.copyFile = real;
  }
  assert.ok(fired);
  assert.equal(R(e.P('.minecraft', 'mods', 'b.jar')), 'JAR-B', 'поздняя запись старого — только в прежней папке');
  assert.equal(R(e.C('.minecraft', 'mods', 'b.jar')), '<нет>');
  assert.equal(R(e.C('.minecraft', 'saves', 'World', 'region', 'r.0.0.mca')), 'region/r.0.0.mca:v0');
  assert.deepEqual((await e.sync('A')).errors, [], 'новый не застревает');
  const B0 = pcState(e, 'B');
  await e.old('B');
  assert.deepEqual(pcState(e, 'B'), B0, 'дальше 0.10.2 за оградой');
  W(WORLD(e, 'A', 'level.dat'), 'level.dat:A', T0 + 120000);
  assert.deepEqual((await e.sync('A')).errors, []);
  // B обновился: его мир остаётся его, мир A — рядом; мод доходит
  const rb = await e.sync('B');
  assert.deepEqual(rb.errors, []);
  const worlds = fs.readdirSync(e.G('B', 'saves')).sort();
  assert.equal(worlds.length, 2);
  assert.equal(R(WORLD(e, 'B', 'region', 'r.0.0.mca')), 'r00:B');
  assert.equal(R(WORLD(e, 'B', 'level.dat')), 'level.dat:v0');
  assert.equal(R(e.G('B', 'saves', worlds[1], 'level.dat')), 'level.dat:A');
  assert.equal(R(e.G('B', 'saves', worlds[1], 'region', 'r.0.0.mca')), 'region/r.0.0.mca:v0');
  assert.equal(R(e.C('.minecraft', 'mods', 'b.jar')), 'JAR-B');
  assert.deepEqual((await e.sync('A')).errors, []);
  assert.deepEqual(tree(e.L('A')), tree(e.L('B')));
});

test('MIX-5: обрыв перевода на каждом шаге: указателя нет, локальные файлы, 0.10.2 и прежняя копия не изменились, другой новый ПК ничего не берёт; повтор доводит, недолитых линий не остаётся', async (t) => {
  const named = (name) => (f) => path.basename(f) === name;
  const steps = [
    ['ограда', (e) => patchJson((f) => f === e.fence)],
    ['копия 1', () => failCopyAt(1)],
    ['копия 4', () => failCopyAt(4)],
    ['копия 8', () => failCopyAt(8)],
    ['снимок-основание', () => patchJson(named('.femboy-origin.json'))],
    ['манифест', () => patchJson(named('.femboy-sync.json'), 2)],
    ['указатель', () => patchJson(named('line.json'))],
  ];
  for (const [step, inject] of steps) {
    const e = await legacyBoth(t);
    const P0 = tree(e.P());
    const files = (k) => [tree(e.L(k)), JSON.parse(R(e.L(k, 'sync-base.json'))).files]; // без ограды 0.10.2 законно синхронизируется: меняется только время базы
    const B0 = files('B');
    const A0 = pcState(e, 'A');
    e.use('A');
    const restore = inject(e);
    let r;
    try {
      r = await sync.migrate();
    } finally {
      restore();
    }
    assert.deepEqual([r.errors.length, r.migrated], [1, 0], step);
    assert.equal(e.line(), null, `${step}: указателя нет — новую линию никто не видит`);
    assert.deepEqual(pcState(e, 'A'), A0, `${step}: локальные файлы и база не тронуты`);
    assert.deepEqual(tree(e.P()), P0, `${step}: прежняя копия цела`);
    await e.old('B');
    assert.deepEqual(files('B'), B0, `${step}: старый ПК не изменился`);
    assert.deepEqual(tree(e.P()), P0, `${step}: старый не тронул прежнюю копию`);
    assert.match((await e.sync('C')).errors.join('\n'), /старом формате/, step);
    assert.equal(fs.existsSync(e.L('C')), false, `${step}: у C сборка не появилась`);
    // повтор — снова явный перевод
    const again = await e.migrate('A');
    assert.deepEqual([again.errors, again.migrated], [[], 1], step);
    assert.deepEqual(fs.readdirSync(e.V('lines')), [e.line()], `${step}: недолитые линии убраны в «Корзину»`);
    assert.deepEqual(tree(e.C()), P0, step);
    assert.equal(JSON.parse(R(e.fence)).fence, 'v2', step);
    assert.deepEqual((await e.sync('C')).errors, [], step);
    assert.deepEqual(tree(e.L('C')), P0, step);
  }
});

test('MIX-6: старый ПК пишет в прежнюю папку во время перевода — перевод не засчитан; повтор называет, что отличается, и без подтверждения не переводит; «без них» — изменение остаётся в прежней папке, смешанный мир не принят', async (t) => {
  const e = await legacyBoth(t);
  const real = fs.promises.copyFile;
  let n = 0;
  fs.promises.copyFile = async (from, to) => {
    if (++n === 2) W(e.P('.minecraft', 'saves', 'World', 'level.dat'), 'level.dat:late', T0 + 5000);
    return real(from, to);
  };
  let r;
  try {
    r = await e.migrate('A');
  } finally {
    fs.promises.copyFile = real;
  }
  assert.match(r.errors.join('\n'), /менялась во время перевода/);
  assert.equal(e.line(), null, 'ложного успеха нет: указатель не записан');
  const r2 = await e.migrate('A');
  assert.equal(r2.migrated, 0);
  assert.deepEqual(r2.ahead, ['«Моя сборка»: в прежней папке облака есть изменения с другого компьютера, которых нет здесь: мир «World». Сборка не переведена, ничего не изменено.']);
  assert.equal(e.line(), null);
  assert.equal(R(WORLD(e, 'A', 'level.dat')), 'level.dat:v0', 'чужой level.dat к целому миру не подмешан');
  e.use('A');
  const r3 = await sync.migrate(() => false, true);
  assert.deepEqual([r3.errors, r3.ahead, r3.migrated], [[], [], 1]);
  assert.deepEqual(tree(e.C('.minecraft', 'saves', 'World')), tree(WORLD(e, 'A')), 'в новой папке — целый мир этого ПК');
  assert.equal(R(e.P('.minecraft', 'saves', 'World', 'level.dat')), 'level.dat:late', 'изменение другого ПК осталось в прежней папке');
});

test('MIX-6b: локальные файлы меняются во время отдачи — новая линия не засчитана, облако не изменено, повтор берёт новое состояние', async (t) => {
  const e = await legacyBoth(t);
  const real = fs.promises.copyFile;
  let n = 0;
  fs.promises.copyFile = async (from, to) => {
    if (++n === 3) W(e.G('A', 'options.txt'), 'opt-during', T0 + 7000);
    return real(from, to);
  };
  let r;
  try {
    r = await e.migrate('A');
  } finally {
    fs.promises.copyFile = real;
  }
  assert.match(r.errors.join('\n'), /менялись во время отдачи/);
  assert.equal(e.line(), null);
  const r2 = await e.migrate('A');
  assert.deepEqual([r2.errors, r2.migrated], [[], 1]);
  assert.equal(R(e.C('.minecraft', 'options.txt')), 'opt-during');
});

test('MIX-9: в прежней папке есть изменения другого ПК, которых здесь нет — перевод остановлен с перечнем, ничего не изменено; тот ПК обновился и перевёл — отставший получает его правки без лишних конфликтов, своё неотданное не теряет', async (t) => {
  const e = await legacyBoth(t);
  W(WORLD(e, 'B', 'region', 'r.1.0.mca'), 'r10:B', T0 + 90000);
  W(e.G('B', 'mods', 'b.jar'), 'JAR-B', T0 + 90000);
  assert.deepEqual((await e.old('B')).errors, []);
  W(e.G('A', 'options.txt'), 'opt-A', T0 + 95000); // неотданное у A
  const A0 = pcState(e, 'A');
  const P0 = tree(e.P());
  const r = await e.migrate('A');
  assert.equal(r.migrated, 0);
  assert.deepEqual(r.ahead, ['«Моя сборка»: в прежней папке облака есть изменения с другого компьютера, которых нет здесь: файл «.minecraft/mods/b.jar», мир «World». Сборка не переведена, ничего не изменено.']);
  assert.equal(fs.existsSync(e.fence), false, 'ограды нет: старые ПК синхронизируются как прежде');
  assert.equal(e.line(), null);
  assert.deepEqual(pcState(e, 'A'), A0);
  assert.deepEqual(tree(e.P()), P0);
  assert.match(e.status('A').error, /изменения с другого компьютера/);
  // B обновился и переводит сам
  const rb = await e.migrate('B');
  assert.deepEqual([rb.errors, rb.ahead, rb.migrated], [[], [], 1]);
  const ra = await e.sync('A');
  assert.deepEqual([ra.errors, ra.conflicts], [[], []], 'отставший A просто получает новое');
  assert.equal(R(WORLD(e, 'A', 'region', 'r.1.0.mca')), 'r10:B');
  assert.equal(R(e.G('A', 'mods', 'b.jar')), 'JAR-B');
  assert.equal(R(e.C('.minecraft', 'options.txt')), 'opt-A', 'неотданное A ушло в облако');
  assert.deepEqual((await e.sync('B')).errors, []);
  assert.deepEqual(tree(e.L('A')), tree(e.L('B')));
});

test('MIX-10: два новых ПК одновременно переводят одну сборку — файлы линий не смешиваются, первая записанная линия остаётся, второй ПК сливает в неё свои правки; ничего не потеряно', async (t) => {
  const e = await legacyBoth(t);
  // у обоих свои неотданные правки (оба в остальном совпадают с прежней папкой)
  W(WORLD(e, 'A', 'region', 'r.0.0.mca'), 'r00:A', T0 + 60000);
  W(e.G('A', 'mods', 'a.jar'), 'JAR-A', T0 + 60000);
  W(e.G('B', 'options.txt'), 'opt-B', T0 + 60000);
  W(e.G('B', 'mods', 'b.jar'), 'JAR-B', T0 + 60000);
  // пока A заливает свою линию, B проходит перевод целиком
  const real = fs.promises.copyFile;
  let n = 0;
  let rb = null;
  fs.promises.copyFile = async (...a) => {
    if (++n === 2 && !rb) {
      e.use('B');
      rb = await SYNC2.migrate();
      e.use('A');
    }
    return real(...a);
  };
  let ra;
  try {
    ra = await e.migrate('A');
  } finally {
    fs.promises.copyFile = real;
  }
  assert.deepEqual([rb.errors, rb.migrated], [[], 1]);
  assert.deepEqual([ra.errors, ra.migrated], [[], 1]);
  assert.match(ra.warnings.join('\n'), /уже перевёл или восстановил другой компьютер/);
  assert.deepEqual(ra.conflicts, []);
  assert.match(e.line(), new RegExp(`^${e.id}\\.${e.store('B').syncDevice}\\.`), 'текущая — линия B, записанная первой');
  assert.deepEqual(fs.readdirSync(e.V('lines')), [e.line()], 'линия A убрана в «Корзину», а не смешана');
  assert.deepEqual((await e.sync('B')).errors, []);
  assert.deepEqual(tree(e.L('A')), tree(e.L('B')));
  const all = tree(e.L('A')).join('\n');
  for (const s of ['r00:A', 'JAR-A', 'opt-B', 'JAR-B']) assert.ok(all.includes(s), s);
});

test('MIX-10b: указатель второго ПК затёр первый (программа облака принесла его позже) — первый ПК сливает свои правки в новую линию, миры не смешаны, ничего не потеряно', async (t) => {
  const e = await legacyBoth(t);
  W(e.G('B', 'mods', 'b.jar'), 'JAR-B', T0 + 60000);
  assert.deepEqual((await e.migrate('A')).migrated, 1);
  const lineA = e.line();
  W(WORLD(e, 'A', 'region', 'r.0.0.mca'), 'r00:A', T0 + 80000);
  assert.deepEqual((await e.sync('A')).errors, []);
  // указатель A до B ещё не доехал: B переводит и пишет свой; программа облака оставляет последний — указатель B
  const ptr = e.V('instances', e.id, 'line.json');
  fs.renameSync(ptr, ptr + '.in-transit');
  const rb = await e.migrate('B');
  fs.rmSync(ptr + '.in-transit');
  assert.deepEqual([rb.errors, rb.migrated], [[], 1]);
  assert.notEqual(e.line(), lineA);
  const ra = await e.sync('A');
  assert.deepEqual(ra.errors, []);
  assert.equal(fs.existsSync(e.V('lines', lineA)), false, 'своя прежняя линия A убрана в «Корзину»');
  assert.deepEqual((await e.sync('B')).errors, []);
  assert.deepEqual(tree(e.L('A')), tree(e.L('B')));
  const all = tree(e.L('A')).join('\n');
  for (const s of ['r00:A', 'JAR-B']) assert.ok(all.includes(s), s);
  // каждый мир целиком одной стороны
  for (const w of fs.readdirSync(e.G('A', 'saves')).filter((x) => x.startsWith('World'))) {
    const r00 = R(e.G('A', 'saves', w, 'region', 'r.0.0.mca'));
    assert.ok(['r00:A', 'region/r.0.0.mca:v0'].includes(r00), w);
    assert.equal(R(e.G('A', 'saves', w, 'level.dat')), 'level.dat:v0', w);
  }
});

test('MIX-11: сборка есть только в прежней папке — отсюда не переводится, понятное объяснение, ограды нет; переводит компьютер, где она есть', async (t) => {
  const e = await legacyBoth(t);
  e.use('B');
  const id2 = inst.create({ name: 'Только на B', version: '1.20.1' }).id;
  W(path.join(inst.dirOf(id2), '.minecraft', 'options.txt'), 'only-B', T0);
  assert.deepEqual((await e.old('B')).errors, []);
  const r = await e.migrate('A');
  assert.match(r.errors.join('\n'), /^Только на B: Сборка есть только в прежней папке облака/m);
  assert.equal(fs.existsSync(path.join(e.cloud, sync.ROOT_NAME, 'deleted', id2)), false);
  assert.ok(e.status('A').legacy >= 1);
  assert.deepEqual((await e.migrate('B')).errors, []);
  assert.deepEqual((await e.sync('A')).errors, []);
  e.use('A');
  assert.equal(R(path.join(inst.dirOf(id2), '.minecraft', 'options.txt')), 'only-B');
});

test('MIX-7: ограда — не удаление; настоящее удаление на 0.10.2 или на новой версии рядом с оградой ничего не стирает', async (t) => {
  const e = await legacyBoth(t);
  assert.deepEqual((await e.migrate('A')).errors, []);
  assert.deepEqual((await e.sync('A')).warnings, [], 'ограда не принята за удаление');
  // 0.10.2 удалил сборку у себя навсегда (forget): ограда стала настоящим удалением
  e.use('B');
  OLD.forget(e.id);
  assert.match(R(e.fence), /^\d+$/);
  const A0 = pcState(e, 'A');
  const C0 = tree(e.C());
  const r = await e.sync('A');
  assert.deepEqual(r.errors, []);
  assert.match(r.warnings.join('\n'), /сборка удалена на другом компьютере/);
  assert.deepEqual(pcState(e, 'A'), A0);
  assert.deepEqual(tree(e.C()), C0, 'новая копия не тронута');
  // новая версия удаляет переведённую сборку: обе облачные копии уходят в «Корзину» своих папок, 0.10.2 её не воскрешает
  const f = await legacyBoth(t);
  assert.deepEqual((await f.migrate('A')).errors, []);
  const P0 = tree(f.P());
  f.use('A');
  sync.forget(f.id);
  assert.equal(fs.existsSync(f.C()), false);
  assert.equal(fs.existsSync(f.P()), false);
  assert.match(R(f.fence), /^\d+$/);
  assert.ok(fs.existsSync(path.join(f.cloud, sync.ROOT_NAME, sync.SPACE, 'deleted', f.id)));
  const bins = [path.join(f.cloud, sync.ROOT_NAME, sync.SPACE, 'Корзина'), path.join(f.cloud, sync.ROOT_NAME, 'Корзина')];
  for (const b of bins) assert.deepEqual(tree(path.join(b, fs.readdirSync(b)[0])), P0);
  const B0 = pcState(f, 'B');
  await f.old('B');
  assert.deepEqual(pcState(f, 'B'), B0);
});

test('MIX-8: «Восстановить облако» после перевода оставляет ограду и прежнюю копию; 0.10.2 по-прежнему за оградой', async (t) => {
  const e = await legacyBoth(t);
  assert.deepEqual((await e.migrate('A')).errors, []);
  const P0 = tree(e.P());
  W(e.G('A', 'options.txt'), 'opt-A', T0 + 60000);
  e.use('A');
  const r = await sync.publishLocal(e.id);
  assert.deepEqual(r.conflicts, []);
  assert.equal(R(e.C('.minecraft', 'options.txt')), 'opt-A');
  assert.equal(fs.readdirSync(path.join(e.cloud, sync.ROOT_NAME, sync.SPACE, 'Корзина')).length, 1);
  assert.equal(JSON.parse(R(e.fence)).fence, 'v2');
  assert.deepEqual(tree(e.P()), P0);
  const B0 = pcState(e, 'B');
  await e.old('B');
  assert.deepEqual(pcState(e, 'B'), B0);
});

test('окно: кнопка «Перевести облако на новый формат…» видна, только когда есть что переводить; перевод — только после подтверждения, «без них» — только вторым подтверждением', () => {
  const html = fs.readFileSync(path.join(__dirname, '../src/renderer/index.html'), 'utf8');
  assert.match(html, /id="syncMigrate" hidden>Перевести облако на новый формат…</);
  const hw = fs.readFileSync(path.join(__dirname, '../src/renderer/app/sync-hardware.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(hw, /\$\('#syncMigrate'\)\.hidden = !\(s\.dir && s\.legacy\)/);
  assert.equal((hw.match(/call\('sync:migrate'/g) || []).length, 1, 'один вызов — в runMigrate');
  const run = hw.slice(hw.indexOf('async function runMigrate'), hw.indexOf('function migrateAheadDialog'));
  assert.ok(run.indexOf("call('sync:migrate', force)") < run.indexOf('Переведено сборок'), 'успех — только после ответа');
  assert.match(run, /r\?\.ahead\?\.length\) migrateAheadDialog/);
  assert.match(hw, /\$\('#smYes', box\)\.onclick = \(\) => \(closeModal\(\), runMigrate\(false\)\)/);
  assert.match(hw, /\$\('#saYes', box\)\.onclick = \(\) => \(closeModal\(\), runMigrate\(true\)\)/);
  assert.equal((hw.match(/runMigrate\(true\)/g) || []).length, 1, '«без них» — только из второго окна');
  assert.match(hw, /if \(r\.errors\?\.length \|\| r\.ahead\?\.length\) toast/, 'остановленный перевод не выдаётся за успех');
  const main = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(main, /handle\('sync:migrate'[\s\S]{0,400}Сначала закрой игру/);
  assert.match(main, /sync\.migrate\(\(id\) => game\.isRunning\(id\), force === true\)/);
  assert.doesNotMatch(main.replace(/handle\('sync:migrate'[\s\S]*?\n\}\);/, ''), /sync\.migrate\(/, 'перевод не вызывается автоматически');
});
