// «Пора на новую версию?» (core/readiness.js): в фоне раз в сутки считаем, сколько модов сборки уже вышло под самую свежую версию Minecraft,
// и значок на карточке говорит «готовы 38 из 40». Modrinth и список версий Mojang подменены; на неизвестный адрес отвечает 404
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { profile, put, src } = require('./helpers');

const sha1 = (b) => crypto.createHash('sha1').update(b).digest('hex');
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const HOUR = 3600 * 1000;

const manifest = (release) => ({
  latest: { release, snapshot: '25w10a' },
  versions: [
    { id: '1.21.6', type: 'release', releaseTime: '2025-06-17T00:00:00+00:00' },
    { id: '1.21.5', type: 'release', releaseTime: '2025-03-25T00:00:00+00:00' },
    { id: '25w10a', type: 'snapshot', releaseTime: '2025-03-05T00:00:00+00:00' },
    { id: '1.21.1', type: 'release', releaseTime: '2024-08-08T00:00:00+00:00' },
    { id: '1.20.1', type: 'release', releaseTime: '2023-06-12T00:00:00+00:00' },
  ].filter((v) => v.id !== '1.21.6' || release === '1.21.6'),
});

// Моды: A обновится, B подойдёт как есть, C под новую версию ещё нет (Modrinth его знает), D Modrinth не знает
const OLD = { a: Buffer.from('mod A 1.0'), b: Buffer.from('mod B 1.0'), c: Buffer.from('mod C 1.0'), d: Buffer.from('mod D 1.0'), e: Buffer.from('mod E 1.0'), f: Buffer.from('mod F 1.0') };
const version = (project, number, bytes) => ({ id: `v-${project}-${number}`, project_id: project, version_number: number, files: [{ primary: true, url: `https://cdn.modrinth.com/${project}.jar`, filename: `${project}.jar`, hashes: { sha1: sha1(bytes) } }], dependencies: [] });
const UPDATE = {
  [sha1(OLD.a)]: version('PA', '2.0', Buffer.from('mod A 2.0')), // другой файл — «обновится»
  [sha1(OLD.b)]: version('PB', '1.0', OLD.b), // тот же файл — «подойдёт как есть»
  [sha1(OLD.e)]: version('PE', '2.0', Buffer.from('mod E 2.0')), // выключенный, тоже обновится
};
const KNOWN = { [sha1(OLD.c)]: { project_id: 'PC', version_number: '1.0' } };

// Подменённая сеть. state: manifestDown — списка версий нет, offline — нет связи совсем, fail — HTTP-ошибка на запросы к Modrinth,
// release — какая версия сейчас самая свежая, delay — задержка ответа Modrinth (чтобы видеть, не идут ли проверки вперемешку)
function world(t, { release = '1.21.5' } = {}) {
  const real = globalThis.fetch;
  const state = { release, manifestDown: false, offline: false, fail: false, delay: 0 };
  const calls = [];
  const events = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ url: u, method: opts.method || 'GET', body });
    if (/version_manifest_v2\.json$/.test(u)) return state.manifestDown ? new Response('нет', { status: 503 }) : json(manifest(state.release));
    if (state.offline) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }); // Modrinth недоступен (список версий Mojang уже получен)
    if (/api\.modrinth\.com\/v2\/version_files(\/update)?$/.test(u)) {
      const hook = state.onRequest; // что-то случилось, пока Modrinth отвечает (один раз)
      state.onRequest = null;
      hook?.();
      events.push(`start ${body.hashes.join(',').slice(0, 8)}`);
      if (state.delay) await new Promise((r) => setTimeout(r, state.delay));
      events.push(`end ${body.hashes.join(',').slice(0, 8)}`);
      if (state.fail) return new Response('сбой', { status: 400 });
      const table = /update$/.test(u) ? UPDATE : KNOWN;
      return json(Object.fromEntries(body.hashes.filter((h) => table[h]).map((h) => [h, table[h]])));
    }
    return new Response('нет такого', { status: 404 }); // названия, библиотеки, CurseForge — лёгкой проверке они не нужны
  };
  const p = profile();
  const realNow = Date.now;
  t.after(() => {
    globalThis.fetch = real;
    Date.now = realNow;
    p.done();
  });
  const instances = p.load('core/instances');
  const make = (name, files, extra = {}) => {
    const inst = instances.create({ name, version: '1.21.1', loader: 'fabric', ...extra });
    put(instances.gameDir(inst.id), Object.fromEntries(Object.entries(files).map(([k, v]) => [`mods/${k}`, v])));
    return inst;
  };
  const inst = make('Моя', { 'a.jar': OLD.a, 'b.jar': OLD.b, 'c.jar': OLD.c, 'd.jar': OLD.d, 'e.jar.disabled': OLD.e });
  return {
    p, state, calls, events, inst, instances, make,
    modrinth: () => calls.filter((c) => /api\.modrinth\.com/.test(c.url)),
    later: (hours) => {
      Date.now = () => realNow() + hours * HOUR; // время идёт: суточное ожидание, устаревший список версий Mojang
    },
    readiness: p.load('core/readiness'),
    migrate: p.load('core/migrate'),
    file: path.join(p.dir, 'readiness.json'),
    pause: () => Promise.resolve(),
    onChange: (id) => events.push(`changed ${id}`),
  };
}

// ---------- лёгкая проверка в core/migrate.js ----------

test('лёгкая проверка переноса: те же статусы, что в плане, но два запроса к Modrinth и ничего лишнего; моды CurseForge считаются неопознанными', async (t) => {
  const w = world(t);
  w.p.store.get().settings.cfApiKey = 'test-key';
  put(w.instances.gameDir(w.inst.id), { 'mods/cf.jar': Buffer.from('mod CF') });
  w.p.load('core/mods').record(w.inst.id, 'cf.jar', { source: 'curseforge', projectId: '111', title: 'CF Mod' });
  const counts = await w.migrate.quick(w.inst.id, '1.21.5');
  assert.deepEqual(counts, { total: 6, update: 2, same: 1, missing: 1, unknown: 2, failed: 0 }, 'A и выключенный E обновятся, B подходит, C нет под версию, D и CF неопознаны');
  assert.deepEqual(w.modrinth().map((c) => `${c.method} ${c.url.replace(/^.*\/v2\//, '')}`), ['POST version_files/update', 'POST version_files'], 'два запроса: что обновится и что Modrinth хотя бы знает');
  assert.ok(!w.calls.some((c) => /curseforge|\/projects|\/project\//.test(c.url)), 'ни CurseForge, ни названий проектов, ни библиотек');
  await assert.rejects(() => w.migrate.quick(w.inst.id, '1.21.1'), /уже на этой версии/);
  const bare = w.make('Без модов', {});
  assert.equal((await w.migrate.quick(bare.id, '1.21.5')).total, 0);
});

// ---------- итог, кэш и сброс ----------

test('проверка сохраняет итог (готовы = обновятся + подойдут), он виден, пока моды те же, и пропадает, когда моды или версия сборки меняются', async (t) => {
  const w = world(t);
  assert.equal(w.readiness.get(w.inst.id), null, 'до проверки значка нет');
  const r = await w.readiness.check(w.inst.id, '1.21.5');
  assert.deepEqual([r.target, r.ready, r.total], ['1.21.5', 3, 5]);
  assert.deepEqual(Object.keys(w.readiness.get(w.inst.id)).sort(), ['checkedAt', 'ready', 'target', 'total']);
  assert.equal(w.readiness.get(w.inst.id).ready, 3);
  const saved = JSON.parse(fs.readFileSync(w.file, 'utf8'));
  assert.deepEqual(Object.keys(saved[w.inst.id]).sort(), ['checkedAt', 'ready', 'sig', 'target', 'total']);
  assert.ok(!fs.existsSync(path.join(w.instances.dirOf(w.inst.id), 'readiness.json')), 'в папке сборки ничего не появилось: она уходит в экспорт и копии');
  // моды изменились: добавили, убрали, выключили, подменили файл — значок прячется, пока не проверим заново
  const g = w.instances.gameDir(w.inst.id);
  put(g, { 'mods/new.jar': 'x' });
  assert.equal(w.readiness.get(w.inst.id), null, 'добавили мод');
  fs.rmSync(path.join(g, 'mods/new.jar'));
  assert.equal(w.readiness.get(w.inst.id).ready, 3, 'убрали — те же моды, значок вернулся');
  fs.renameSync(path.join(g, 'mods/a.jar'), path.join(g, 'mods/a.jar.disabled'));
  assert.equal(w.readiness.get(w.inst.id), null, 'выключили');
  fs.renameSync(path.join(g, 'mods/a.jar.disabled'), path.join(g, 'mods/a.jar'));
  put(g, { 'mods/b.jar': 'другой размер файла' });
  assert.equal(w.readiness.get(w.inst.id), null, 'подменили файл');
  put(g, { 'mods/b.jar': OLD.b });
  await w.readiness.check(w.inst.id, '1.21.5');
  w.instances.update(w.inst.id, { version: '1.20.1' });
  assert.equal(w.readiness.get(w.inst.id), null, 'сборку перевели на другую версию игры');
  assert.equal(w.readiness.get('нет-такой'), null);
  // старый итог (давно не проверяли) тоже не показываем
  const t2 = world(t);
  await t2.readiness.check(t2.inst.id, '1.21.5');
  t2.later(24 * 3 + 1);
  assert.equal(t2.readiness.get(t2.inst.id), null, 'старше трёх суток');
});

test('моды поменялись, пока шёл запрос к Modrinth: итог к новому набору не приписывается', async (t) => {
  const w = world(t);
  w.state.onRequest = () => put(w.instances.gameDir(w.inst.id), { 'mods/new.jar': 'x' });
  await w.readiness.check(w.inst.id, '1.21.5');
  assert.equal(w.readiness.get(w.inst.id), null, 'набор уже другой — значка нет, пока не проверим заново');
});

test('повреждённый или чужой файл итогов не ломает: пустой список, а значок собирается заново', async (t) => {
  const w = world(t);
  fs.writeFileSync(w.file, '{"это не json');
  assert.equal(w.readiness.get(w.inst.id), null);
  await w.readiness.check(w.inst.id, '1.21.5');
  assert.equal(w.readiness.get(w.inst.id).total, 5);
  const junk = { [w.inst.id]: { checkedAt: 'вчера', target: 5, ready: -1, total: 'много', sig: {} }, other: 7 };
  fs.writeFileSync(w.file, JSON.stringify(junk));
  assert.equal(w.readiness.get(w.inst.id), null, 'записи с неверными типами игнорируются');
  // запись неверна только одним полем: готовых больше, чем модов; целая запись с верной подписью, наоборот, принимается
  const good = { checkedAt: Date.now(), target: '1.21.5', ready: 3, total: 5, sig: w.p.load('core/snapshots').modsSig(w.inst.id) };
  fs.writeFileSync(w.file, JSON.stringify({ [w.inst.id]: { ...good, ready: 9 } }));
  assert.equal(w.readiness.get(w.inst.id), null, 'готовых больше, чем модов');
  fs.writeFileSync(w.file, JSON.stringify({ [w.inst.id]: good }));
  assert.equal(w.readiness.get(w.inst.id)?.ready, 3);
});

// ---------- фоновый обход ----------

test('обход: проверяет сборки с модами на версии старше свежей, по очереди и с паузой; остальных не трогает и про них ничего не спрашивает', async (t) => {
  const w = world(t);
  const second = w.make('Вторая', { 'a.jar': OLD.a, 'c.jar': OLD.c }); // тоже два запроса: порядок сборок в обходе не важен
  const fresh = w.make('Уже свежая', { 'a.jar': OLD.a }, { version: '1.21.5' }); // версия самая свежая
  const vanilla = w.instances.create({ name: 'Ванилька', version: '1.21.1', loader: 'vanilla' });
  put(w.instances.gameDir(vanilla.id), { 'mods/a.jar': OLD.a }); // даже с файлом в mods ванильную не проверяем
  const empty = w.make('Без модов', {});
  const notes = w.make('Только заметка', { 'readme.txt': 'не мод' }); // папка mods есть, а модов в ней нет
  const snap = w.make('Снапшот', { 'a.jar': OLD.a }, { version: '25w10a' });
  const unknown = w.make('Чужая версия', { 'a.jar': OLD.a }, { version: '1.7.10' });
  const pauses = [];
  await w.readiness.sweep({ pause: async () => pauses.push(w.modrinth().length), onChange: w.onChange });
  const got = (i) => w.readiness.get(i.id);
  assert.deepEqual([got(w.inst)?.ready, got(second)?.ready], [3, 1]);
  for (const i of [fresh, vanilla, empty, notes, snap, unknown]) assert.equal(got(i), null, i.name);
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(w.file, 'utf8'))).sort(), [w.inst.id, second.id].sort(), 'в файле итогов только проверенные сборки: остальные даже не пробовали (и ошибки не записывали)');
  assert.equal(w.modrinth().length, 4, 'по два запроса на каждую из двух сборок, и всё');
  assert.deepEqual(pauses, [2], 'пауза одна: между первой сборкой и второй (после последней не ждём)');
  assert.deepEqual(w.events.filter((e) => /^changed/.test(e)).sort(), [`changed ${w.inst.id}`, `changed ${second.id}`].sort());
});

test('обход идёт от недавно игравших сборок к давно не игравшим', async (t) => {
  const w = world(t);
  const [a, b, c, d] = [w.inst, w.make('B', { 'a.jar': OLD.a }), w.make('C', { 'a.jar': OLD.a }), w.make('D', { 'a.jar': OLD.a })];
  // порядок по давности игры не совпадает ни с порядком папок на диске (по алфавиту: b, c, d, потом «instance-…»), ни с обратным
  for (const [inst, played] of [[d, 4000], [b, 3000], [a, 2000], [c, 1000]]) w.instances.touch(inst.id, { lastPlayed: played });
  await w.readiness.sweep({ pause: w.pause, onChange: w.onChange });
  assert.deepEqual(w.events.filter((e) => /^changed/.test(e)), [d, b, a, c].map((i) => `changed ${i.id}`));
});

test('фон: первый обход через полминуты после старта, дальше по расписанию (спрашивает только тех, кому пора); остановка гасит таймеры', async (t) => {
  const w = world(t);
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const settle = async () => {
    for (let i = 0; i < 60; i++) await new Promise((r) => setImmediate(r));
  };
  const stop = w.readiness.start({ onChange: w.onChange });
  t.mock.timers.tick(29 * 1000);
  await settle();
  assert.equal(w.calls.length, 0, 'раньше полуминуты ничего не спрашиваем: запуск лаунчера важнее');
  t.mock.timers.tick(1500);
  await settle();
  assert.equal(w.modrinth().length, 2);
  assert.equal(w.readiness.get(w.inst.id).ready, 3);
  t.mock.timers.tick(3 * 3600 * 1000);
  await settle();
  assert.equal(w.modrinth().length, 2, 'через три часа итог ещё свежий: просыпаемся, но никого не спрашиваем');
  w.later(25);
  t.mock.timers.tick(3 * 3600 * 1000);
  await settle();
  assert.equal(w.modrinth().length, 4, 'сутки прошли — проверили заново');
  stop();
  w.later(60);
  t.mock.timers.tick(12 * 3600 * 1000);
  await settle();
  assert.equal(w.modrinth().length, 4, 'после остановки таймеры молчат');
});

test('главный процесс запускает фон, отдаёт значок по каналу и сообщает окну, когда итог готов', () => {
  const main = fs.readFileSync(src('main.js'), 'utf8');
  assert.match(main, /readiness\.start\(\{/);
  assert.match(main, /handle\('instances:readiness', \(id\) => readiness\.get\(id\)\)/);
  assert.match(main, /send\('app:readiness', \{ id \}\)/);
});

test('обход: проверки идут по одной, а не вперемешку', async (t) => {
  const w = world(t);
  w.make('Вторая', { 'a.jar': OLD.a, 'c.jar': OLD.c });
  w.state.delay = 25;
  await w.readiness.sweep({ pause: w.pause });
  const marks = w.events.filter((e) => /^(start|end)/.test(e)).map((e) => e.split(' ')[0]);
  assert.equal(marks.length, 8);
  for (let i = 0; i < marks.length; i += 2) assert.deepEqual(marks.slice(i, i + 2), ['start', 'end'], 'запрос закончился раньше, чем начался следующий');
});

test('обход: свежий итог второй раз не спрашивают; через сутки, при смене модов или выходе новой версии игры — спрашивают снова', async (t) => {
  const w = world(t);
  await w.readiness.sweep({ pause: w.pause });
  const n = w.modrinth().length;
  await w.readiness.sweep({ pause: w.pause });
  assert.equal(w.modrinth().length, n, 'сразу после проверки спрашивать нечего');
  w.later(23);
  await w.readiness.sweep({ pause: w.pause });
  assert.equal(w.modrinth().length, n, '23 часа — ещё не пора');
  w.later(25);
  await w.readiness.sweep({ pause: w.pause });
  assert.equal(w.modrinth().length, n + 2, 'через сутки — заново');
  // моды поменялись — заново, не дожидаясь суток
  put(w.instances.gameDir(w.inst.id), { 'mods/f.jar': OLD.f });
  await w.readiness.sweep({ pause: w.pause });
  assert.equal(w.modrinth().length, n + 4);
  assert.equal(w.readiness.get(w.inst.id).total, 6);
  // вышла новая версия игры (список Mojang устарел и обновился): итог про старую версию уже не годится
  w.state.release = '1.21.6';
  w.later(27);
  await w.readiness.sweep({ pause: w.pause });
  assert.equal(w.modrinth().length, n + 6);
  assert.equal(w.readiness.get(w.inst.id).target, '1.21.6');
});

test('обход выключен в настройках: ни списка версий, ни Modrinth', async (t) => {
  const w = world(t);
  assert.equal(w.p.store.get().settings.readinessCheck, true, 'по умолчанию включён');
  w.p.store.updateSettings({ readinessCheck: false });
  await w.readiness.sweep({ pause: w.pause });
  assert.equal(w.calls.length, 0);
  assert.equal(w.readiness.get(w.inst.id), null);
});

test('обход молча переносит сбои: нет списка версий, нет связи (останавливается сразу), ошибка Modrinth (идёт дальше, повторит не раньше чем через несколько часов)', async (t) => {
  const w = world(t);
  const second = w.make('Вторая', { 'a.jar': OLD.a });
  w.state.manifestDown = true;
  await assert.doesNotReject(() => w.readiness.sweep({ pause: w.pause }));
  assert.equal(w.modrinth().length, 0, 'списка версий нет — проверять не с чем');
  w.state.manifestDown = false;
  w.state.offline = true;
  await assert.doesNotReject(() => w.readiness.sweep({ pause: w.pause }));
  const tried = new Set(w.calls.filter((c) => c.body).map((c) => c.body.hashes.join(',')));
  assert.equal(tried.size, 1, 'связи нет: вторую сборку даже не пробуем');
  assert.equal(w.readiness.get(w.inst.id), null);
  w.state.offline = false;
  w.state.fail = true; // Modrinth отвечает ошибкой на каждый запрос
  w.calls.length = 0;
  await assert.doesNotReject(() => w.readiness.sweep({ pause: w.pause }));
  assert.ok(w.calls.some((c) => c.body?.hashes.length === 1), 'после ошибки одной сборки идём к следующей');
  assert.equal(w.readiness.get(w.inst.id), null);
  w.state.fail = false;
  w.calls.length = 0;
  await w.readiness.sweep({ pause: w.pause });
  assert.equal(w.modrinth().length, 0, 'ошибка была только что: повторять рано');
  w.later(7);
  await w.readiness.sweep({ pause: w.pause });
  assert.equal(w.readiness.get(w.inst.id).ready, 3);
  assert.equal(w.readiness.get(second.id).ready, 1);
});

test('два обхода одновременно — один: запросы не удваиваются', async (t) => {
  const w = world(t);
  w.state.delay = 20;
  await Promise.all([w.readiness.sweep({ pause: w.pause }), w.readiness.sweep({ pause: w.pause })]);
  assert.equal(w.modrinth().length, 2);
});

test('удалённые сборки уходят из файла итогов', async (t) => {
  const w = world(t);
  const second = w.make('Вторая', { 'a.jar': OLD.a });
  await w.readiness.sweep({ pause: w.pause });
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(w.file, 'utf8'))).sort(), [w.inst.id, second.id].sort());
  w.instances.remove(second.id);
  w.later(25);
  await w.readiness.sweep({ pause: w.pause });
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(w.file, 'utf8'))), [w.inst.id]);
});

test('onChange зовётся, когда итог появился или изменился, а не когда проверка ничего нового не дала', async (t) => {
  const w = world(t);
  await w.readiness.sweep({ pause: w.pause, onChange: w.onChange });
  assert.equal(w.events.filter((e) => /^changed/.test(e)).length, 1);
  w.later(25);
  await w.readiness.sweep({ pause: w.pause, onChange: w.onChange });
  assert.equal(w.events.filter((e) => /^changed/.test(e)).length, 1, 'те же числа — окну перерисовываться незачем');
  put(w.instances.gameDir(w.inst.id), { 'mods/f.jar': OLD.f });
  await w.readiness.sweep({ pause: w.pause, onChange: w.onChange });
  assert.equal(w.events.filter((e) => /^changed/.test(e)).length, 2);
});
