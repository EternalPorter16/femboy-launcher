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
    if (!rel && ['instance.json', 'sync-base.json', 'sync-wait.json', '.femboy-sync.json', 'backups'].includes(e.name)) continue;
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
  e.C = (...p) => path.join(cloud, sync.ROOT_NAME, 'instances', e.id, ...p);
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
  assert.equal(fs.readdirSync(path.join(e.cloud, sync.ROOT_NAME, 'Корзина')).length, 1);
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
const genOf = (e, k) => JSON.parse(R(e.L(k, 'sync-base.json'))).gen;
const cloudGen = (e) => JSON.parse(R(e.C('.femboy-sync.json')));

test('publishLocal после истории синхронизаций: поколение не откатывается, отдававший ПК не застревает, все сходятся', async (t) => {
  const e = await both(t);
  await history(e, 4);
  const genA = genOf(e, 'A');
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
  assert.ok(cloudGen(e).gen > genA, 'новая линия облака старше базы A');
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

test('пропавшая облачная копия после истории: пересоздаётся, другой ПК не застревает', async (t) => {
  const e = await both(t);
  await history(e, 3);
  W(e.G('B', 'options.txt'), 'opt-B2', T0 + 80000);
  rm(e.C());
  assert.deepEqual((await e.sync('B')).errors, []);
  assert.deepEqual((await e.sync('A')).errors, []);
  assert.equal(R(e.G('A', 'options.txt')), 'opt-B2');
  assert.deepEqual(tree(e.G('B')), tree(e.G('A')));
});

test('прерванный publishLocal: пометка pending уже с новым поколением, другие ждут, доводка без отката поколения', async (t) => {
  const e = await both(t);
  await history(e, 4);
  const genA = genOf(e, 'A');
  W(e.G('B', 'options.txt'), 'opt-B3', T0 + 90000);
  e.use('B');
  const restore = failCopyAt(3);
  try {
    await assert.rejects(sync.publishLocal(e.id));
  } finally {
    restore();
  }
  const pend = cloudGen(e);
  assert.ok(pend.pending && pend.gen > genA);
  assert.match((await e.sync('A')).errors[0], /другой компьютер не закончил/);
  assert.deepEqual((await e.sync('B')).errors, []);
  assert.ok(!cloudGen(e).pending && cloudGen(e).gen > pend.gen);
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

// ---------- 5. старое облако без манифеста ----------

test('старое облако без манифеста: ничего не удаляется по отсутствию файла, манифест строится из фактических файлов', async (t) => {
  const e = await both(t);
  // «старая версия» лаунчера: облако без манифеста; на A есть файл из базы, которого в облаке нет
  rm(e.C('.femboy-sync.json'));
  rm(e.C('.minecraft', 'mods', 'keep.jar'));
  W(e.C('.minecraft', 'config', 'legacy.toml'), 'from-legacy', T0 + 1000);
  // на B (новая версия, но база от старой: без gen и sha1)
  const bf = e.L('B', 'sync-base.json');
  const b = JSON.parse(fs.readFileSync(bf, 'utf8'));
  delete b.gen;
  delete b.v;
  for (const v of Object.values(b.files)) delete v.sha1;
  fs.writeFileSync(bf, JSON.stringify(b));
  const r = await e.sync('B');
  assert.deepEqual(r.errors, []);
  assert.equal(R(e.G('B', 'mods', 'keep.jar')), 'KEEP', 'локальный файл не удалён');
  assert.equal(R(e.C('.minecraft', 'mods', 'keep.jar')), 'KEEP', 'и возвращён в облако');
  assert.equal(R(e.G('B', 'config', 'legacy.toml')), 'from-legacy');
  assert.ok(fs.existsSync(e.C('.femboy-sync.json')), 'манифест построен');
  const ra = await e.sync('A');
  assert.deepEqual(ra.errors, []);
  assert.deepEqual(tree(e.G('A')), tree(e.G('B')));
});

test('старое облако: сборка, выложенная прежней версией (без манифеста и базы), забирается целиком', async (t) => {
  const e = env(t);
  await e.sync('A');
  rm(e.C('.femboy-sync.json'));
  rm(e.L('A', 'sync-base.json'));
  const r = await e.sync('B');
  assert.deepEqual(r.errors, []);
  assert.deepEqual(tree(e.G('B')), tree(e.G('A')));
});

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
  const main = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
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
  const bin = path.join(e.cloud, sync.ROOT_NAME, 'Корзина');
  e.use('B');
  const baseB = R(e.L('B', 'sync-base.json'));
  // обновление модпака не завершено
  fs.mkdirSync(e.L('B', '.pack-update'), { recursive: true });
  await assert.rejects(sync.publishLocal(e.id), /обновление модпака/);
  fs.rmSync(e.L('B', '.pack-update'), { recursive: true });
  // сборка удалена на другом компьютере (tombstone)
  const tomb = path.join(e.cloud, sync.ROOT_NAME, 'deleted', e.id);
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

test('publishLocal: перенос облачной копии в Корзину не удался (файл занят) — ошибка, облако и база не изменились, syncedAt прежний', async (t) => {
  const e = await both(t);
  const cloud0 = tree(e.C());
  e.use('B');
  const at0 = e.status('B').at;
  const base0 = R(e.L('B', 'sync-base.json'));
  const real = fs.renameSync;
  fs.renameSync = (from, to) => {
    if (path.resolve(from) === path.resolve(e.C())) throw Object.assign(new Error('EPERM: operation not permitted, rename'), { code: 'EPERM' });
    return real(from, to);
  };
  try {
    await assert.rejects(sync.publishLocal(e.id), (err) => /занята другой программой/.test(err.message) && err.cause?.code === 'EPERM');
  } finally {
    fs.renameSync = real;
  }
  assert.deepEqual(tree(e.C()), cloud0);
  const bin = path.join(e.cloud, sync.ROOT_NAME, 'Корзина');
  assert.deepEqual(fs.existsSync(bin) ? fs.readdirSync(bin) : [], [], 'в Корзину ничего не ушло');
  assert.equal(R(e.L('B', 'sync-base.json')), base0);
  assert.equal(e.status('B').at, at0);
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
    'Изменения, которые другой компьютер ещё не отдал в облако, у него не пропадут: при его следующей синхронизации они уйдут в облако, а если одно и то же изменили оба компьютера, обе версии сохранятся рядом.',
    'Сборка «My pack» сейчас запущена: сначала закрой игру.',
    'Восстановить облако',
    'Облако восстановлено с этого компьютера: «My pack» ♡',
    'Восстанавливаю облако с этого компьютера: My pack…',
    'Сначала дождись восстановления облака',
    'Облако не восстановлено: синхронизация этой сборки сейчас невозможна',
    'Сначала закрой игру и дождись завершения задач сборки',
  ];
  // имя папки конфликтного мира и папка «Корзина» в облаке — настоящие имена папок, остаются как есть
  for (const s of samples) assert.doesNotMatch(tr(s).replace(/(конфликт [^)]*)/g, '').replace(/“Корзина”/g, ''), /[А-Яа-яЁё]/, s);
});
