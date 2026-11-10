// «Вышли обновления модов» (core/modwatch.js + лёгкая проверка и «что нового» в core/modupdates.js): в фоне раз в сутки спрашиваем Modrinth, есть ли новые версии
// модов каждой сборки (один запрос по хэшам, без скачивания), а на карточке появляется значок «⬆ 3 обновления». Modrinth подменён; на неизвестный адрес — 404
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { profile, put, src } = require('./helpers');

const sha1 = (b) => crypto.createHash('sha1').update(b).digest('hex');
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const HOUR = 3600 * 1000;

// Моды: Alpha обновится (с описанием), Beta уже свежий (тот же файл), Gamma Modrinth не знает, Delta обновится без описания, Eps выключен и обновится
const OLD = { a: Buffer.from('mod A 1.0'), b: Buffer.from('mod B 1.0'), c: Buffer.from('mod C 1.0'), d: Buffer.from('mod D 1.0'), e: Buffer.from('mod E 1.0') };
const NEW = { a: Buffer.from('mod A 2.0'), d: Buffer.from('mod D 3.0'), e: Buffer.from('mod E 2.0') };
const version = (name, number, bytes, changelog) => ({ name, id: `v-${name}-${number}`, project_id: `P${name}`, version_number: number, changelog, files: [{ primary: true, url: `https://cdn.modrinth.com/${name}-${number}.jar`, filename: `${name}-${number}.jar`, hashes: { sha1: sha1(bytes) } }] });
const UPDATE = {
  [sha1(OLD.a)]: version('Alpha', '2.0', NEW.a, '## Что нового\n- **Быстрее** загрузка [подробнее](https://example.com/x)\n- Исправлен вылет'),
  [sha1(OLD.b)]: version('Beta', '1.0', OLD.b, 'тот же файл'),
  [sha1(OLD.d)]: version('Delta', '3.0', NEW.d, null),
  [sha1(OLD.e)]: version('Eps', '2.0', NEW.e, 'Fixed &amp; improved'),
};
const SERVED = { 'https://cdn.modrinth.com/Alpha-2.0.jar': NEW.a, 'https://cdn.modrinth.com/Delta-3.0.jar': NEW.d, 'https://cdn.modrinth.com/Eps-2.0.jar': NEW.e };

// Подменённая сеть. state: offline — нет связи, fail — HTTP-ошибка Modrinth, delay — задержка ответа (видно, не идут ли проверки вперемешку), onRequest — хук на один запрос
function world(t, { extra = {} } = {}) {
  const table = { ...UPDATE, ...extra };
  const real = globalThis.fetch;
  const state = { offline: false, fail: false, delay: 0 };
  const calls = [];
  const events = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ url: u, method: opts.method || 'GET', body });
    if (state.offline) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
    if (/api\.modrinth\.com\/v2\/version_files\/update$/.test(u)) {
      const hook = state.onRequest;
      state.onRequest = null;
      hook?.();
      events.push(`start ${body.hashes.join(',').slice(0, 8)}`);
      if (state.delay) await new Promise((r) => setTimeout(r, state.delay));
      events.push(`end ${body.hashes.join(',').slice(0, 8)}`);
      if (state.fail) return new Response('сбой', { status: 400 });
      return json(Object.fromEntries(body.hashes.filter((h) => table[h]).map((h) => [h, table[h]])));
    }
    if (SERVED[u]) return new Response(SERVED[u], { status: 200, headers: { 'content-length': String(SERVED[u].length) } });
    return new Response('нет такого', { status: 404 });
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
    p, state, calls, events, inst, instances, make, table,
    modrinth: () => calls.filter((c) => /api\.modrinth\.com/.test(c.url)),
    asked: () => new Set(calls.filter((c) => /api\.modrinth\.com/.test(c.url)).map((c) => c.body.hashes.join(','))).size, // сколько разных наборов спросили (повторы после обрыва связи не в счёт)
    later: (hours) => {
      Date.now = () => realNow() + hours * HOUR;
    },
    modwatch: p.load('core/modwatch'),
    modupdates: p.load('core/modupdates'),
    file: path.join(p.dir, 'modwatch.json'),
    pause: () => Promise.resolve(),
    onChange: (id) => events.push(`changed ${id}`),
  };
}

// ---------- «что нового»: описание версии без разметки ----------

test('описание версии из Modrinth: разметка убирается, списки получают точки, ссылки остаются текстом, мусор и картинки уходят', () => {
  const { plainChangelog: plain } = require('../src/core/modupdates');
  assert.equal(plain('## Что нового\n\n- Исправлен **вылет** при [запуске](https://x.y/z)\n* Добавлена `опция`\n\n![скрин](http://i/p.png)\nПодробности: https://github.com/a/b/compare/1...2'), 'Что нового\n\n• Исправлен вылет при запуске\n• Добавлена опция');
  assert.equal(plain('Вышла **новая** версия, __очень__ важная, ~~не~~ нужная и *красивая*'), 'Вышла новая версия, очень важная, не нужная и красивая');
  assert.equal(plain('<p>Привет <b>мир</b></p><br>Строка&nbsp;два &amp; три &lt;4&gt; &quot;пять&quot; &#39;шесть&#39;'), 'Привет мир\n\nСтрока два & три <4> "пять" \'шесть\'');
  assert.equal(plain('Начало\n```js\nconsole.log(1)\n```\nКонец <!-- скрыто -->'), 'Начало\n\nКонец');
  assert.equal(plain('[![значок](https://img/badge.svg)](https://site)\nТекст'), 'Текст');
  assert.equal(plain('# Заголовок ##\n---\n* * *\n1. первое\n2. второе'), 'Заголовок\n\n1. первое\n2. второе', 'линии-разделители уходят, нумерованный список остаётся');
});

test('описание версии: имена с подчёркиванием и умножение не портятся, пустое и не строка — пустая строка, переводы строк и пробелы приводятся в порядок', () => {
  const { plainChangelog: plain } = require('../src/core/modupdates');
  assert.equal(plain('Опция max_render_distance_chunks и 2*3*4 остались'), 'Опция max_render_distance_chunks и 2*3*4 остались');
  for (const bad of [null, undefined, 5, {}, [], '', '   \n  ']) assert.equal(plain(bad), '', String(bad));
  assert.equal(plain('раз  \r\nдва\r\n\r\n\r\n\r\nтри   '), 'раз\nдва\n\nтри');
  assert.equal(plain('Смотри https://example.com/очень/длинная/ссылка подробнее'), 'Смотри подробнее');
  assert.equal(plain('Полный список: https://example.com/changes\nДальше'), 'Дальше', 'строка-подпись, у которой убрали ссылку, исчезает целиком');
});

test('описание версии обрезается по слову, не больше 14 строк и заданной длины; короткое остаётся как есть; эмодзи не рвутся', () => {
  const { plainChangelog: plain } = require('../src/core/modupdates');
  const long = 'слово '.repeat(300);
  const cut = plain(long, 50);
  assert.ok(cut.endsWith('…') && cut.length <= 51, cut);
  assert.ok(/слово…$/.test(cut), 'режется по границе слова');
  assert.equal(plain('ровно десять', 12), 'ровно десять');
  assert.equal(plain('ровно десять!', 12), 'ровно…');
  const lines = Array.from({ length: 30 }, (_, i) => `строка ${i + 1}`).join('\n');
  const many = plain(lines);
  assert.equal(many.split('\n').length, 14);
  assert.ok(many.endsWith('строка 14…'), many);
  assert.equal(plain(lines.split('\n').slice(0, 14).join('\n')), lines.split('\n').slice(0, 14).join('\n'), 'ровно четырнадцать — без многоточия');
  assert.equal(plain(lines.split('\n').slice(0, 15).join('\n')), `${lines.split('\n').slice(0, 14).join('\n')}…`, 'пятнадцатая строка уже лишняя: четырнадцать и многоточие');
  const flowers = plain('🌸'.repeat(40), 11);
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(flowers) && flowers.endsWith('…'), 'пара-суррогаты не разрезаются');
  assert.equal(plain('x'.repeat(2000)).length, 701, 'по умолчанию 700 знаков и многоточие');
  assert.equal(plain('x'.repeat(700)).length, 700, 'ровно 700 — без многоточия');
  assert.equal(plain(`${Array.from({ length: 13 }, (_, i) => `п${i + 1}`).join('\n')}\n\nещё\nещё`), `${Array.from({ length: 13 }, (_, i) => `п${i + 1}`).join('\n')}…`, 'пустая четырнадцатая строка не оставляет перевод строки перед многоточием');
});

// ---------- лёгкая проверка и полная проверка ----------

test('лёгкая проверка: один запрос к Modrinth по хэшам незакреплённых модов (и выключенных), ничего не скачивается; в ответе — что нового', async (t) => {
  const w = world(t);
  w.p.load('core/mods').setPinned(w.inst.id, 'b.jar', true);
  const ups = await w.modupdates.lookup(w.inst.id);
  assert.equal(w.calls.length, 1, 'только запрос о хэшах: ни скачивания, ни CurseForge, ни названий проектов');
  const body = w.calls[0].body;
  assert.deepEqual(body.hashes.sort(), [sha1(OLD.a), sha1(OLD.c), sha1(OLD.d), sha1(OLD.e)].sort(), 'закреплённый Beta не спрашивается, выключенный Eps — да');
  assert.deepEqual([body.algorithm, body.loaders, body.game_versions], ['sha1', ['fabric'], ['1.21.1']]);
  assert.deepEqual(ups.map((u) => [u.file, u.title, u.from, u.to, u.source]).sort(), [['a.jar', 'Alpha', 'a.jar', '2.0', 'modrinth'], ['d.jar', 'Delta', 'd.jar', '3.0', 'modrinth'], ['e.jar', 'Eps', 'e.jar', '2.0', 'modrinth']].sort());
  const by = Object.fromEntries(ups.map((u) => [u.title, u.changelog]));
  assert.equal(by.Alpha, 'Что нового\n• Быстрее загрузка подробнее\n• Исправлен вылет');
  assert.equal(by.Delta, '', 'описания нет — пустая строка, а не null');
  assert.equal(by.Eps, 'Fixed & improved');
});

test('лёгкая проверка: у ванильной сборки, без модов и когда все моды закреплены, к Modrinth не обращаемся; свежий мод (тот же файл) обновлением не считается', async (t) => {
  const w = world(t);
  const van = w.instances.create({ name: 'Ван', version: '1.21.1', loader: 'vanilla' });
  put(w.instances.gameDir(van.id), { 'mods/x.jar': OLD.a });
  assert.deepEqual(await w.modupdates.lookup(van.id), [], 'у ванильной сборки файл в mods не мод: не спрашиваем');
  const bare = w.make('Пустая', {});
  assert.deepEqual(await w.modupdates.lookup(bare.id), []);
  const mods = w.p.load('core/mods');
  for (const f of ['a.jar', 'b.jar', 'c.jar', 'd.jar', 'e.jar.disabled']) mods.setPinned(w.inst.id, f.replace('.disabled', ''), true);
  assert.deepEqual(await w.modupdates.lookup(w.inst.id), []);
  assert.equal(w.calls.length, 0);
  const only = w.make('Один', { 'b.jar': OLD.b });
  assert.deepEqual(await w.modupdates.lookup(only.id), [], 'тот же файл, что и «последняя версия»: обновлять нечего');
  assert.equal(w.calls.length, 1);
});

test('полная проверка («Обновить моды») тоже приносит описание версии, а установка по-прежнему берёт то, что нашла проверка', async (t) => {
  const w = world(t);
  const ups = await w.modupdates.check(w.inst.id);
  assert.deepEqual(ups.map((u) => u.title).sort(), ['Alpha', 'Delta', 'Eps']);
  assert.equal(ups.find((u) => u.title === 'Alpha').changelog, 'Что нового\n• Быстрее загрузка подробнее\n• Исправлен вылет');
  assert.equal(ups.find((u) => u.title === 'Delta').changelog, '');
  const r = await w.modupdates.apply(w.inst.id, ['a.jar']);
  assert.equal(r.done.length, 1);
  assert.ok(fs.existsSync(path.join(w.instances.gameDir(w.inst.id), 'mods', 'Alpha-2.0.jar')));
});

// ---------- итог, кэш и сброс ----------

test('проверка сохраняет итог (сколько обновлений и какие моды), он виден, пока моды те же, и пропадает, когда моды меняются; файл лежит не в папке сборки', async (t) => {
  const w = world(t);
  assert.equal(w.modwatch.get(w.inst.id), null, 'до проверки значка нет');
  const r = await w.modwatch.check(w.inst.id);
  assert.deepEqual([r.count, r.titles.slice().sort()], [3, ['Alpha', 'Delta', 'Eps']]);
  assert.deepEqual(Object.keys(w.modwatch.get(w.inst.id)).sort(), ['checkedAt', 'count', 'titles']);
  const saved = JSON.parse(fs.readFileSync(w.file, 'utf8'));
  assert.deepEqual(Object.keys(saved[w.inst.id]).sort(), ['checkedAt', 'count', 'sig', 'titles']);
  assert.ok(!fs.existsSync(path.join(w.instances.dirOf(w.inst.id), 'modwatch.json')), 'в папке сборки ничего не появилось: она уходит в экспорт и копии');
  const g = w.instances.gameDir(w.inst.id);
  put(g, { 'mods/new.jar': 'x' });
  assert.equal(w.modwatch.get(w.inst.id), null, 'добавили мод');
  fs.rmSync(path.join(g, 'mods/new.jar'));
  assert.equal(w.modwatch.get(w.inst.id).count, 3, 'убрали — те же моды, значок вернулся');
  fs.renameSync(path.join(g, 'mods/a.jar'), path.join(g, 'mods/a.jar.disabled'));
  assert.equal(w.modwatch.get(w.inst.id), null, 'выключили');
  fs.renameSync(path.join(g, 'mods/a.jar.disabled'), path.join(g, 'mods/a.jar'));
  put(g, { 'mods/b.jar': 'другой размер файла' });
  assert.equal(w.modwatch.get(w.inst.id), null, 'подменили файл');
  put(g, { 'mods/b.jar': OLD.b });
  assert.equal(w.modwatch.get(w.inst.id), null, 'файл вернули, но это уже другой файл (время записи): набор считается новым, пока не проверим заново');
  await w.modwatch.check(w.inst.id);
  assert.equal(w.modwatch.get(w.inst.id).count, 3);
  w.instances.update(w.inst.id, { version: '1.20.1' });
  assert.equal(w.modwatch.get(w.inst.id), null, 'сборку перевели на другую версию игры: обновления могут быть другими');
  assert.equal(w.modwatch.get('нет-такой'), null);
  const t2 = world(t);
  await t2.modwatch.check(t2.inst.id);
  t2.later(24 * 3 + 1);
  assert.equal(t2.modwatch.get(t2.inst.id), null, 'старше трёх суток');
});

test('в итоге не больше пяти названий (число — настоящее), нет обновлений — итог «0», по которому значок не рисуется', async (t) => {
  const many = {};
  const extra = {};
  for (let i = 1; i <= 7; i++) {
    const old = Buffer.from(`old mod ${i}`);
    many[`m${i}.jar`] = old;
    extra[sha1(old)] = version(`Mod${i}`, '2.0', Buffer.from(`new mod ${i}`), '');
  }
  const w = world(t, { extra });
  const big = w.make('Много', many);
  const r = await w.modwatch.check(big.id);
  assert.equal(r.count, 7);
  assert.equal(r.titles.length, 5);
  const fresh = w.make('Свежие', { 'b.jar': OLD.b });
  const zero = await w.modwatch.check(fresh.id);
  assert.deepEqual([zero.count, zero.titles], [0, []]);
  assert.equal(w.modwatch.get(fresh.id).count, 0);
});

test('после полной проверки в окне итог записывается тем, что показало окно (с учётом совместимости), и значок совпадает с окном', async (t) => {
  const w = world(t);
  const before = w.modwatch.record(w.inst.id, [{ title: 'Одно' }, { title: 'Другое' }]);
  assert.deepEqual([before.count, before.titles], [2, ['Одно', 'Другое']]);
  assert.equal(w.modwatch.get(w.inst.id).count, 2);
  w.modwatch.record(w.inst.id, []);
  assert.equal(w.modwatch.get(w.inst.id).count, 0);
  for (const junk of [null, undefined, 'x', 5, {}]) assert.equal(w.modwatch.record(w.inst.id, junk).count, 0, String(junk));
  w.modwatch.record(w.inst.id, [{ title: 5 }, null, { title: 'Ок' }, {}, { title: 'x'.repeat(500) }]);
  const e = w.modwatch.get(w.inst.id);
  assert.equal(e.count, 5, 'число — сколько обновлений показало окно');
  assert.deepEqual(e.titles.slice(0, 1), ['Ок'], 'в названия идут только строки');
  assert.ok(e.titles.every((s) => typeof s === 'string' && s.length <= 100));
});

test('моды поменялись, пока шёл запрос к Modrinth: итог к новому набору не приписывается', async (t) => {
  const w = world(t);
  w.state.onRequest = () => put(w.instances.gameDir(w.inst.id), { 'mods/late.jar': 'поздний' });
  await w.modwatch.check(w.inst.id);
  assert.equal(w.modwatch.get(w.inst.id), null, 'подпись снята до запроса, поэтому к набору с late.jar итог не относится');
});

test('испорченный или чужой файл итогов не ломает ничего: читается как пустой, годные записи остаются, ошибочные пропускаются', async (t) => {
  const w = world(t);
  fs.writeFileSync(w.file, '{ не json');
  assert.equal(w.modwatch.get(w.inst.id), null);
  const sig = (await w.modwatch.check(w.inst.id)) && JSON.parse(fs.readFileSync(w.file, 'utf8'))[w.inst.id].sig;
  const good = { checkedAt: Date.now(), sig, count: 2, titles: ['A', 'B'] };
  for (const bad of [{ ...good, count: -1 }, { ...good, count: 1.5 }, { ...good, count: '3' }, { ...good, titles: 'A' }, { ...good, titles: [1, 2] }, { ...good, checkedAt: 'вчера' }, { ...good, sig: 5 }, { ...good, count: 100000 }]) {
    fs.writeFileSync(w.file, JSON.stringify({ [w.inst.id]: bad }));
    assert.equal(w.modwatch.get(w.inst.id), null, JSON.stringify(bad));
  }
  fs.writeFileSync(w.file, JSON.stringify({ [w.inst.id]: good, junk: 5, other: null }));
  assert.equal(w.modwatch.get(w.inst.id).count, 2);
  fs.writeFileSync(w.file, JSON.stringify([good]));
  assert.equal(w.modwatch.get(w.inst.id), null, 'вместо словаря список');
});

// ---------- обход ----------

test('обход спрашивает только тех, у кого есть моды: ванильные, без модов и с одним лишь не-jar пропускаются; сборка с одними выключенными модами проверяется', async (t) => {
  const w = world(t);
  const van = w.instances.create({ name: 'Ван', version: '1.21.1', loader: 'vanilla' });
  put(w.instances.gameDir(van.id), { 'mods/x.jar': OLD.a });
  const bare = w.make('Пустая', {});
  const notes = w.make('Заметка', { 'readme.txt': 'не мод' });
  const off = w.make('Выключенные', { 'x.jar.disabled': OLD.a });
  const seen = [];
  await w.modwatch.sweep({ pause: w.pause, onChange: (id) => seen.push(id) });
  assert.deepEqual(seen.sort(), [w.inst.id, off.id].sort());
  assert.equal(w.modrinth().length, 2, 'два запроса: «Моя» и «Выключенные»');
  for (const id of [van.id, bare.id, notes.id]) assert.equal(w.modwatch.get(id), null);
});

test('недавно игравшие проверяются первыми, по одной сборке за раз', async (t) => {
  const w = world(t);
  const mk = (name, played) => {
    const i = w.make(name, { 'a.jar': Buffer.from(name) });
    w.instances.touch(i.id, { lastPlayed: played });
    return i;
  };
  const d = mk('Яблоко', 400);
  const b = mk('Вишня', 300);
  const a = mk('Арбуз', 100);
  const c = mk('Груша', 200);
  w.instances.touch(w.inst.id, { lastPlayed: 50 });
  w.state.delay = 15;
  const seen = [];
  await w.modwatch.sweep({ pause: w.pause, onChange: (id) => seen.push(id) });
  assert.deepEqual(seen, [d.id, b.id, c.id, a.id, w.inst.id]);
  assert.deepEqual(w.events.filter((e) => /^(start|end)/.test(e)).map((e) => e.split(' ')[0]), ['start', 'end', 'start', 'end', 'start', 'end', 'start', 'end', 'start', 'end'], 'начало следующей — после конца предыдущей');
});

test('повторно — не раньше чем через сутки; сразу при смене модов; отдельная проверка про свежесть: 23 часа — рано, 25 — пора', async (t) => {
  const w = world(t);
  await w.modwatch.sweep({ pause: w.pause });
  const first = w.modrinth().length;
  assert.equal(first, 1);
  await w.modwatch.sweep({ pause: w.pause });
  assert.equal(w.modrinth().length, first, 'только что проверяли');
  w.later(23);
  await w.modwatch.sweep({ pause: w.pause });
  assert.equal(w.modrinth().length, first, '23 часа — ещё рано');
  w.later(25);
  await w.modwatch.sweep({ pause: w.pause });
  assert.equal(w.modrinth().length, first + 1, '25 часов — пора');
  put(w.instances.gameDir(w.inst.id), { 'mods/new.jar': 'новый' });
  await w.modwatch.sweep({ pause: w.pause });
  assert.equal(w.modrinth().length, first + 2, 'моды изменились — спрашиваем сразу');
});

test('выключатель в настройках: выключено — обход ничего не делает, даже не прибирает файл итогов', async (t) => {
  const w = world(t);
  fs.writeFileSync(w.file, JSON.stringify({ 'instance-призрак': { checkedAt: 1, sig: 'x', count: 1, titles: ['A'] } }));
  w.p.store.get().settings.modUpdatesCheck = false;
  await w.modwatch.sweep({ pause: w.pause });
  assert.equal(w.calls.length, 0);
  assert.ok(JSON.parse(fs.readFileSync(w.file, 'utf8'))['instance-призрак'], 'пока слежение выключено, файл итогов не трогается');
  w.p.store.get().settings.modUpdatesCheck = true;
  await w.modwatch.sweep({ pause: w.pause });
  assert.equal(w.modrinth().length, 1);
});

test('сбои молчат: нет связи — остальные сборки не мучаем и запись не портим; ошибка Modrinth — идём дальше, но эту сборку не раньше чем через шесть часов', async (t) => {
  const w = world(t);
  const other = w.make('Другая', { 'a.jar': Buffer.from('другая') });
  w.instances.touch(w.inst.id, { lastPlayed: 20 });
  w.instances.touch(other.id, { lastPlayed: 10 });
  w.state.offline = true;
  await w.modwatch.sweep({ pause: w.pause });
  assert.equal(w.asked(), 1, 'после первой же сетевой ошибки обход остановился: про вторую сборку не спрашивали');
  assert.equal(w.modwatch.get(w.inst.id), null);
  assert.ok(!fs.existsSync(w.file) || !JSON.parse(fs.readFileSync(w.file, 'utf8'))[w.inst.id], 'записи про неудачу при обрыве связи нет: завтра спросим как обычно');
  w.state.offline = false;
  w.state.fail = true;
  w.calls.length = 0;
  await w.modwatch.sweep({ pause: w.pause });
  assert.equal(w.asked(), 2, 'ошибка Modrinth не останавливает обход: спросили обе сборки');
  w.state.fail = false;
  w.calls.length = 0;
  await w.modwatch.sweep({ pause: w.pause });
  assert.equal(w.calls.length, 0, 'шесть часов после ошибки не ждём — не спрашиваем');
  w.later(7);
  await w.modwatch.sweep({ pause: w.pause });
  assert.equal(w.asked(), 2, 'через семь часов можно снова');
  assert.equal(w.modwatch.get(w.inst.id).count, 3);
});

test('выключили проверку, пока шёл обход: до остальных сборок дело не доходит', async (t) => {
  const w = world(t);
  const second = w.make('Вторая', { 'a.jar': Buffer.from('вторая') });
  const third = w.make('Третья', { 'a.jar': Buffer.from('третья') });
  w.instances.touch(w.inst.id, { lastPlayed: 30 });
  w.instances.touch(second.id, { lastPlayed: 20 });
  w.instances.touch(third.id, { lastPlayed: 10 });
  w.state.onRequest = () => {
    w.p.store.get().settings.modUpdatesCheck = false;
  };
  await w.modwatch.sweep({ pause: w.pause });
  assert.equal(w.asked(), 1, 'первую сборку уже спросили, а после выключения остальных — нет');
});

test('два обхода одновременно не идут: второй вызов ждёт первый', async (t) => {
  const w = world(t);
  w.state.delay = 25;
  await Promise.all([w.modwatch.sweep({ pause: w.pause }), w.modwatch.sweep({ pause: w.pause }), w.modwatch.sweep({ pause: w.pause })]);
  assert.equal(w.modrinth().length, 1);
});

test('удалённые сборки убираются из файла; окну сообщают только об изменившемся', async (t) => {
  const w = world(t);
  const gone = w.make('Уйдёт', { 'a.jar': OLD.a });
  const events = [];
  await w.modwatch.sweep({ pause: w.pause, onChange: (id) => events.push(id) });
  assert.deepEqual(events.sort(), [gone.id, w.inst.id].sort());
  w.instances.remove(gone.id);
  w.later(25);
  events.length = 0;
  await w.modwatch.sweep({ pause: w.pause, onChange: (id) => events.push(id) });
  assert.deepEqual(events, [], 'ответ тот же — окно не дёргаем');
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(w.file, 'utf8'))), [w.inst.id]);
  put(w.instances.gameDir(w.inst.id), { 'mods/z.jar': 'z' });
  await w.modwatch.sweep({ pause: w.pause, onChange: (id) => events.push(id) });
  assert.deepEqual(events, [w.inst.id], 'моды те же плюс один, обновлений столько же, но набор другой — сообщаем');
});

test('окну сообщают, когда изменилось число обновлений или их состав, даже если сами моды те же; когда ничего не изменилось — молчим', async (t) => {
  const many = {};
  const extra = {};
  for (let i = 1; i <= 7; i++) {
    const old = Buffer.from(`old mod ${i}`);
    many[`m${i}.jar`] = old;
    if (i <= 6) extra[sha1(old)] = version(`Mod${i}`, '2.0', Buffer.from(`new mod ${i}`), '');
  }
  const w = world(t, { extra });
  const big = w.make('Много', many);
  const events = [];
  const sweep = () => w.modwatch.sweep({ pause: w.pause, onChange: (id) => events.push(id) });
  await sweep();
  assert.ok(events.includes(big.id));
  assert.deepEqual([w.modwatch.get(big.id).count, w.modwatch.get(big.id).titles.length], [6, 5]);
  events.length = 0;
  w.later(25);
  await sweep();
  assert.ok(!events.includes(big.id), 'ответ тот же — окно не дёргаем');
  w.later(50);
  w.table[sha1(Buffer.from('old mod 7'))] = version('Mod7', '2.0', Buffer.from('new mod 7'), ''); // вышло ещё одно обновление: число 7, первые пять названий те же
  await sweep();
  assert.deepEqual([w.modwatch.get(big.id).count, events.includes(big.id)], [7, true], 'изменилось только число');
  events.length = 0;
  w.later(75);
  w.table[sha1(Buffer.from('old mod 1'))] = version('Mod0', '2.0', Buffer.from('new mod 0'), ''); // у первого мода теперь другая новая версия: число то же (7), но первое название другое
  await sweep();
  assert.deepEqual([w.modwatch.get(big.id).count, w.modwatch.get(big.id).titles[0], events.includes(big.id)], [7, 'Mod0', true], 'число то же, состав другой');
});

test('start(): остановка до первого обхода — обхода не будет вовсе', async (t) => {
  const w = world(t);
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const stop = w.modwatch.start({ onChange: w.onChange });
  stop();
  t.mock.timers.tick(10 * HOUR);
  for (let i = 0; i < 400; i++) await new Promise((r) => setImmediate(r));
  assert.equal(w.calls.length, 0);
});

test('start(): первый обход через три четверти минуты, потом раз в несколько часов; остановка гасит таймеры', async (t) => {
  const w = world(t);
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  // Файлы хэшируются настоящим вводом-выводом, а таймеры подменены: ждём не «столько-то оборотов», а того, чего ждём, и до восьми тысяч оборотов
  const until = async (cond) => {
    for (let i = 0; i < 8000 && !cond(); i++) await new Promise((r) => setImmediate(r));
  };
  const quiet = async () => {
    for (let i = 0; i < 400; i++) await new Promise((r) => setImmediate(r));
  };
  const stop = w.modwatch.start({ onChange: w.onChange });
  t.mock.timers.tick(44 * 1000);
  await quiet();
  assert.equal(w.calls.length, 0, 'за 44 секунды ничего: после запуска лаунчера он сначала занят своим');
  t.mock.timers.tick(1500);
  await until(() => w.modwatch.get(w.inst.id));
  assert.equal(w.modrinth().length, 1, 'на сорок пятой секунде пошёл первый обход');
  assert.equal(w.modwatch.get(w.inst.id).count, 3);
  t.mock.timers.tick(3 * HOUR);
  await quiet();
  assert.equal(w.modrinth().length, 1, 'через три часа проснулся, но сутки ещё не прошли');
  w.later(25);
  t.mock.timers.tick(3 * HOUR);
  await until(() => w.modrinth().length >= 2);
  assert.equal(w.modrinth().length, 2, 'сутки прошли — проверили заново');
  stop();
  await quiet();
  w.later(60);
  t.mock.timers.tick(12 * HOUR);
  await quiet();
  assert.equal(w.modrinth().length, 2, 'после остановки — тишина');
});

// ---------- проводка ----------

test('проводка: каналы и событие, запуск фона, запись итога после окна обновлений, перепроверка после установки, выключатель в настройках по умолчанию включён', () => {
  const main = fs.readFileSync(src('main.js'), 'utf8');
  assert.match(main, /handle\('mods:watch', \(id\) => modwatch\.get\(id\)\)/);
  assert.match(main, /modwatch\.start\(\{\s*onChange: \(id\) => \{[^}]*send\('app:modwatch', \{ id \}\)/, 'фон сообщает окну о находке');
  assert.match(main, /handle\('mods:checkUpdates'[\s\S]*?modwatch\.record\(id, ups\)/, 'окно обновлений приводит значок в соответствие с собой');
  assert.match(main, /handle\('mods:applyUpdates'[\s\S]*?modwatch\.check\(id\)/, 'после установки спрашиваем заново: остальные обновления остаются в значке');
  assert.match(fs.readFileSync(src('preload.js'), 'utf8'), /'app:modwatch'/);
  assert.match(fs.readFileSync(src('core/store.js'), 'utf8'), /modUpdatesCheck: true/);
  assert.match(fs.readFileSync(src('renderer/app/home.js'), 'utf8'), /api\.on\('app:modwatch'/);
});
