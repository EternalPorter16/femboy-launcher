// Импорт коллекции Modrinth (core/collection.js): ссылка → проекты коллекции → установка выбранных в сборку обычным путём (версия под игру и загрузчик,
// зависимости, несовместимость). Modrinth подменён по форме настоящего ответа: коллекция — API v3, проекты — v2, порядок проектов в ответе другой
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { profile, src } = require('./helpers');

const sha1 = (b) => crypto.createHash('sha1').update(b).digest('hex');
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const DAY = 24 * 3600e3;

// Проект: type mod/resourcepack/shader/modpack, loaders и game_versions — «вообще», versions — настоящие версии: { number, mc, loaders, deps }
const P = (title, type, loaders, mc, versions, extra = {}) => ({ title, type, loaders, game_versions: mc, versions, ...extra });
const V = (number, mc, loaders, deps = []) => ({ number, mc, loaders, deps });
const SPEC = {
  collections: {
    sp6gQaWQ: { name: 'Моя подборка', description: '  Лучшие\n\nмоды   на свете  ', projects: ['AAAA0001', 'BBBB0002', 'CCCC0003', 'DDDD0004', 'EEEE0005', 'FFFF0006', 'GONE0000'] },
    longname: { name: 'Д'.repeat(100), description: '', projects: ['AAAA0001'] },
  },
  projects: {
    AAAA0001: P('Sodium', 'mod', ['fabric', 'quilt'], ['1.20.1', '1.21.1'], [V('1.0', ['1.21.1'], ['fabric']), V('0.9', ['1.20.1'], ['fabric'])]),
    BBBB0002: P('Lithium', 'mod', ['fabric'], ['1.21.1'], [V('2.0', ['1.21.1'], ['fabric'], ['LIBL0007'])]),
    CCCC0003: P('Старый мод', 'mod', ['forge'], ['1.12.2'], [V('1.0', ['1.12.2'], ['forge'])]),
    DDDD0004: P('Красивые текстуры', 'resourcepack', ['minecraft'], ['1.21.1'], [V('3', ['1.21.1'], ['minecraft'])]),
    EEEE0005: P('Сборка друга', 'modpack', ['fabric'], ['1.21.1'], [V('1', ['1.21.1'], ['fabric'])]),
    FFFF0006: P('Только Forge', 'mod', ['forge', 'neoforge'], ['1.21.1'], [V('1.0', ['1.21.1'], ['forge', 'neoforge'])]),
    LIBL0007: P('Библиотека', 'mod', ['fabric'], ['1.21.1'], [V('1.5', ['1.21.1'], ['fabric'])]),
  },
};

// Подменённая сеть. state.onFile(url) — хук на скачивание файла (отмена посреди установки), state.down — Modrinth отвечает 503
function world(t, spec = SPEC) {
  const real = globalThis.fetch;
  const realNow = Date.now;
  const state = { down: false, onFile: null, onApi: null, projectsAnswer: null };
  const calls = [];
  const files = new Map();
  const info = (id) => {
    const p = spec.projects[id];
    return { id, slug: id.toLowerCase(), title: p.title, description: `Описание ${p.title}`, body: 'очень длинный текст '.repeat(100), project_type: p.type, loaders: p.loaders, game_versions: p.game_versions, icon_url: 'https://cdn.modrinth.com/data/' + id + '/icon.png', ...(p.raw || {}) };
  };
  const versionOf = (pid, v) => {
    const bytes = Buffer.from(`jar ${pid} ${v.number}`);
    const url = `https://cdn.modrinth.com/${pid}-${v.number}.jar`;
    files.set(url, bytes);
    return { id: `v-${pid}-${v.number}`, project_id: pid, version_number: v.number, version_type: 'release', loaders: v.loaders, game_versions: v.mc, dependencies: v.deps.map((d) => ({ project_id: d, dependency_type: 'required' })), files: [{ primary: true, url, filename: `${pid}-${v.number}.jar`, hashes: { sha1: sha1(bytes) } }] };
  };
  const find = (idOrSlug) => Object.keys(spec.projects).find((id) => id === idOrSlug || id.toLowerCase() === idOrSlug.toLowerCase());
  globalThis.fetch = async (url, opts = {}) => {
    const u = new URL(String(url));
    calls.push({ path: u.pathname, search: u.search, host: u.host });
    if (state.down) return new Response('сбой', { status: 503 });
    let m;
    if ((m = /^\/v3\/collection\/(.+)$/.exec(u.pathname))) {
      if (!/^[A-Za-z0-9]+$/.test(m[1]) || m[1] === 'BADREQ00') return json({ error: 'request_error', description: 'parsing collection ID' }, 400);
      const c = spec.collections[m[1]];
      return c ? json({ id: m[1], user: 'USER0001', name: c.name, description: c.description, icon_url: null, color: 10296838, status: 'listed', created: '2026-01-01T00:00:00Z', updated: '2026-07-31T19:21:33Z', projects: c.projects }) : json({ error: 'not_found', description: 'resource not found' }, 404);
    }
    if (u.host === 'api.modrinth.com' && u.pathname === '/v2/projects') {
      const ids = JSON.parse(u.searchParams.get('ids'));
      if (state.projectsAnswer) return json(state.projectsAnswer(ids)); // свой (странный) ответ вместо настоящего
      return json(ids.filter((id) => spec.projects[id]).reverse().map(info)); // как у настоящего: порядок другой, неизвестные пропущены
    }
    if ((m = /^\/v2\/project\/([^/]+)\/version$/.exec(u.pathname))) {
      const id = find(m[1]);
      if (!id) return json({ error: 'not_found' }, 404);
      const gv = JSON.parse(u.searchParams.get('game_versions') || 'null');
      const ld = JSON.parse(u.searchParams.get('loaders') || 'null');
      return json(spec.projects[id].versions.filter((v) => (!gv || v.mc.some((x) => gv.includes(x))) && (!ld || v.loaders.some((x) => ld.includes(x)))).map((v) => versionOf(id, v)));
    }
    if ((m = /^\/v2\/project\/([^/]+)$/.exec(u.pathname))) {
      const hook = state.onApi;
      state.onApi = null;
      hook?.();
      const id = find(m[1]);
      return id ? json(info(id)) : json({ error: 'not_found' }, 404);
    }
    if (files.has(String(url))) {
      state.onFile?.(String(url));
      const bytes = files.get(String(url));
      return new Response(bytes, { status: 200, headers: { 'content-length': String(bytes.length) } });
    }
    return new Response('нет такого', { status: 404 });
  };
  const p = profile();
  t.after(() => {
    globalThis.fetch = real;
    Date.now = realNow;
    p.done();
  });
  const instances = p.load('core/instances');
  const inst = instances.create({ name: 'Моя', version: '1.21.1', loader: 'fabric' });
  return {
    p, state, calls, instances, inst, spec,
    collection: p.load('core/collection'),
    net: p.load('core/net'),
    mods: p.load('core/mods'),
    api: () => calls.filter((c) => c.host === 'api.modrinth.com'),
    later: (ms) => { Date.now = () => realNow() + ms; },
    jars: (id = inst.id) => { try { return fs.readdirSync(path.join(instances.gameDir(id), 'mods')).sort(); } catch { return []; } },
  };
}

// ---------- ссылка ----------

test('ссылка на коллекцию находится в любом тексте: с https и без, www, хвосты /mods ?… #…, адрес API, просто код; чужие сайты и похожие адреса не годятся', (t) => {
  const { collection } = world(t);
  const ok = (text, id = 'sp6gQaWQ') => assert.equal(collection.parseLink(text), id, text);
  ok('https://modrinth.com/collection/sp6gQaWQ');
  ok('http://modrinth.com/collection/sp6gQaWQ/');
  ok('modrinth.com/collection/sp6gQaWQ');
  ok('https://www.modrinth.com/collection/sp6gQaWQ/mods');
  ok('https://modrinth.com/collection/sp6gQaWQ/resourcepacks?l=fabric#top');
  ok('https://api.modrinth.com/v3/collection/sp6gQaWQ');
  ok('HTTPS://MODRINTH.COM/collection/sp6gQaWQ');
  ok('sp6gQaWQ');
  ok('  sp6gQaWQ \n');
  ok('Смотри мою подборку: https://modrinth.com/collection/sp6gQaWQ/mods. Там всё нужное!');
  ok('(https://modrinth.com/collection/sp6gQaWQ)');
  ok('Вот ссылка: https://modrinth.com/collection/sp6gQaWQ!');
  ok('(modrinth.com/collection/sp6gQaWQ).');
  ok('«https://modrinth.com/collection/sp6gQaWQ»');
  ok('Две: https://modrinth.com/collection/aaaabbbb и https://modrinth.com/collection/ccccdddd', 'aaaabbbb');
  for (const bad of ['', '   ', null, undefined, 5, 'просто текст', 'https://evil.com/collection/sp6gQaWQ', 'https://modrinth.com.evil.com/collection/sp6gQaWQ', 'https://evilmodrinth.com/collection/sp6gQaWQ', 'https://modrinth.com/mod/sodium', 'https://modrinth.com/user/sp6gQaWQ', 'https://modrinth.com/collection/', 'https://modrinth.com/collection/abc', 'https://modrinth.com/collection/sp6g QaWQ', 'https://modrinth.com/collection/sp6gQaWQsp6gQaWQ', 'https://modrinth.com/collection/sp6gQaW', 'https://modrinth.com/collection/sp6gQaWQx', 'https://evil.com/?r=https://modrinth.com/collection/sp6gQaWQ', 'evilmodrinth.com/collection/sp6gQaWQ', 'https://sub.modrinth.com/collection/sp6gQaWQ', 'https://modrinth.com@evil.com/collection/sp6gQaWQ', 'abcdefg', 'abcdefghi', 'sp6gQaW!', 'коллекция', 'ftp://modrinth.com/collection/sp6gQaWQ'.replace('ftp', 'file')]) assert.equal(collection.parseLink(bad), null, String(bad));
  assert.equal(collection.parseLink('Привет, вот код: sp6gQaWQ'), null, 'голый код принимается только как всё сообщение целиком, иначе любое слово из восьми букв сошло бы за код');
});

// ---------- загрузка ----------

test('коллекция читается так: название и описание в одну строку, проекты в порядке коллекции (хотя API отдаёт в другом), у каждого тип, значок, списки версий и «ставится ли»', async (t) => {
  const w = world(t);
  const c = await w.collection.load('https://modrinth.com/collection/sp6gQaWQ/mods');
  assert.deepEqual([c.id, c.name, c.description, c.missing, c.truncated], ['sp6gQaWQ', 'Моя подборка', 'Лучшие моды на свете', 1, 0]);
  assert.deepEqual(Object.keys(c).sort(), ['description', 'id', 'missing', 'name', 'projects', 'truncated'], 'только то, что нужно окну');
  assert.deepEqual(c.projects.map((p) => p.title), ['Sodium', 'Lithium', 'Старый мод', 'Красивые текстуры', 'Сборка друга', 'Только Forge'], 'как в коллекции; удалённый проект пропущен, но посчитан');
  const sodium = c.projects[0];
  assert.deepEqual([sodium.id, sodium.type, sodium.loaders, sodium.versions, sodium.importable, sodium.icon], ['AAAA0001', 'mod', ['fabric', 'quilt'], ['1.20.1', '1.21.1'], true, 'https://cdn.modrinth.com/data/AAAA0001/icon.png']);
  assert.equal(sodium.description, 'Описание Sodium');
  assert.ok(!('body' in sodium) && !JSON.stringify(c).includes('очень длинный текст'), 'длинное «тело» проектов окну не нужно');
  assert.deepEqual(c.projects.map((p) => p.importable), [true, true, true, true, false, true], 'модпак в сборку не ставится');
  assert.deepEqual(w.api().map((x) => x.path), ['/v3/collection/sp6gQaWQ', '/v2/projects'], 'два запроса: сама коллекция и её проекты одним списком');
  assert.equal(w.api()[0].host, 'api.modrinth.com');
});

test('странный ответ не ломает окно: нет типа — мод, значок только по https, нет названия — слаг, длинное описание обрезается, мусор в списках выбрасывается, пустое название коллекции заменено', async (t) => {
  const spec = {
    collections: { oddcolls: { name: '  ', description: 5, projects: ['AAAA0001', 'BBBB0002'] }, longcoll: { name: 'Н'.repeat(200), description: 'д'.repeat(1000), projects: [] } },
    projects: {
      AAAA0001: { ...P('', 'mod', ['fabric'], ['1.21.1'], []), raw: { project_type: undefined, title: undefined, icon_url: 'http://insecure.example/i.png', description: 'д'.repeat(500), loaders: ['fabric', 5, null], game_versions: ['1.21.1', {}, 7] } },
      BBBB0002: { ...P('Нормальный', 'mod', ['fabric'], ['1.21.1'], []), raw: { icon_url: 'javascript:alert(1)', slug: null } },
    },
  };
  const w = world(t, spec);
  const c = await w.collection.load('oddcolls');
  assert.deepEqual([c.name, c.description], ['Коллекция', '']);
  const long = await w.collection.load('longcoll');
  assert.deepEqual([long.name.length, long.description.length], [80, 400], 'длинное название и описание коллекции обрезаются');
  const [a, b] = c.projects;
  assert.deepEqual([a.type, a.title, a.icon, a.loaders, a.versions, a.importable], ['mod', 'aaaa0001', null, ['fabric'], ['1.21.1'], true]);
  assert.equal(a.description.length, 200);
  assert.deepEqual([b.title, b.slug, b.icon], ['Нормальный', null, null]);
});

test('большая коллекция: проекты спрашиваются пачками по сто, повторы и негодные коды выбрасываются, больше трёхсот не берём — остаток считается', async (t) => {
  const ids = Array.from({ length: 350 }, (_, i) => `Z${String(i).padStart(7, '0')}`);
  // негодные коды стоят в начале: если бы их приняли, они заняли бы места среди первых трёхсот
  const spec = { collections: { bigbigbi: { name: 'Большая', description: '', projects: ['abc', 'ABCDEFG', 'ABCDEFGHI', 'плохой код', 'a b', 5, null, ...ids, ids[0]] } }, projects: Object.fromEntries(ids.map((id) => [id, P(`Мод ${id}`, 'mod', ['fabric'], ['1.21.1'], [V('1', ['1.21.1'], ['fabric'])])])) };
  const w = world(t, spec);
  const c = await w.collection.load('bigbigbi'.slice(0, 8));
  assert.equal(c.projects.length, 300);
  assert.equal(c.truncated, 50);
  assert.deepEqual(c.projects.slice(0, 2).map((p) => p.id), [ids[0], ids[1]]);
  const asked = w.api().filter((x) => x.path === '/v2/projects').map((x) => JSON.parse(new URL(`https://x${x.search}`).searchParams.get('ids')).length);
  assert.deepEqual(asked, [100, 100, 100], 'три запроса по сто');
  assert.ok(w.api().every((x) => x.search.length < 2500), 'адреса короткие');
});

test('странный ответ про проекты не ломает чтение: не список — проектов нет, а все они «удалены»; мусор внутри списка выбрасывается', async (t) => {
  const w = world(t);
  w.state.projectsAnswer = () => ({ error: 'что-то пошло не так' });
  const a = await w.collection.load('sp6gQaWQ', { force: true });
  assert.deepEqual([a.projects.length, a.missing], [0, 7]);
  w.state.projectsAnswer = (ids) => [null, 5, 'x', { title: 'без кода' }, { id: 7 }, { id: ids[0], title: 'Один', project_type: 'mod', loaders: ['fabric'], game_versions: ['1.21.1'] }];
  const b = await w.collection.load('sp6gQaWQ', { force: true });
  assert.deepEqual(b.projects.map((p) => p.title), ['Один']);
  assert.equal(b.missing, 6);
});

test('пустая коллекция читается; закрытая или несуществующая — понятная ошибка про ссылку и приватность; сбой Modrinth остаётся сбоем; не коллекция — тоже ошибка', async (t) => {
  const w = world(t, { collections: { emptycol: { name: 'Пустая', description: null, projects: [] }, weirdcol: { name: 'x', projects: 'не список' } }, projects: {} });
  const e = await w.collection.load('emptycol');
  assert.deepEqual([e.projects, e.name, e.description], [[], 'Пустая', '']);
  await assert.rejects(() => w.collection.load('https://modrinth.com/collection/NOPE0000'), /Коллекция не найдена.*приватные/);
  await assert.rejects(() => w.collection.load('https://modrinth.com/collection/BADREQ00'), /Коллекция не найдена/, 'и «плохой запрос» от Modrinth по ссылке — это тоже «проверь ссылку»');
  await assert.rejects(() => w.collection.load('просто слова'), /Не вижу ссылки на коллекцию Modrinth/);
  await assert.rejects(() => w.collection.load('weirdcol'), /Modrinth ответил не так, как ожидалось/);
  w.state.down = true;
  await assert.rejects(() => w.collection.load('https://modrinth.com/collection/sp6gQaWQ', { force: true }), (err) => /503|Нет связи|HTTP/.test(err.message) && !/не найдена/.test(err.message));
});

test('загруженная коллекция запоминается на десять минут: выбор цели и галочек не ходит в сеть; force и срок давности перезагружают; в памяти не больше пяти', async (t) => {
  const w = world(t);
  await w.collection.load('sp6gQaWQ');
  const n = w.api().length;
  await w.collection.load('https://modrinth.com/collection/sp6gQaWQ/mods');
  await w.collection.loadById('sp6gQaWQ');
  assert.equal(w.api().length, n, 'из памяти');
  await w.collection.load('sp6gQaWQ', { force: true });
  assert.equal(w.api().length, n + 2, 'force — заново');
  w.later(9 * 60e3);
  await w.collection.load('sp6gQaWQ');
  assert.equal(w.api().length, n + 2);
  w.later(11 * 60e3);
  await w.collection.load('sp6gQaWQ');
  assert.equal(w.api().length, n + 4, 'через одиннадцать минут — заново');
  const many = {};
  for (let i = 0; i < 7; i++) many[`col${String(i).padStart(5, '0')}`] = { name: `К${i}`, description: '', projects: [] };
  const w2 = world(t, { collections: many, projects: {} });
  for (const id of Object.keys(many)) await w2.collection.loadById(id);
  const before = w2.api().length;
  await w2.collection.loadById('col00006');
  await w2.collection.loadById('col00002');
  assert.equal(w2.api().length, before, 'пять последних в памяти (со второй по шестую)');
  await w2.collection.loadById('col00001');
  assert.ok(w2.api().length > before, 'самая давняя вытеснена');
  for (const bad of ['плохой код', 'abc', 'sp6gQaW', 'sp6gQaWQ1', '']) await assert.rejects(() => w2.collection.loadById(bad), /Некорректный код/);
});

// ---------- подходит ли и что предложить ----------

test('подходит ли проект: версия игры, загрузчик (Quilt берёт и Fabric, у ванильной сборки подойдёт любой), у ресурспаков и шейдеров загрузчик не важен, модпак не ставится', async (t) => {
  const w = world(t);
  const c = await w.collection.load('sp6gQaWQ');
  const by = Object.fromEntries(c.projects.map((p) => [p.title, p]));
  const at = (title, mc, loader) => w.collection.compat(by[title], mc, loader);
  assert.equal(at('Sodium', '1.21.1', 'fabric'), 'ok');
  assert.equal(at('Sodium', '1.20.1', 'fabric'), 'ok');
  assert.equal(at('Sodium', '1.19.4', 'fabric'), 'version');
  assert.equal(at('Sodium', '1.21.1', 'forge'), 'loader');
  assert.equal(at('Lithium', '1.21.1', 'quilt'), 'ok', 'Quilt запускает моды Fabric');
  assert.equal(at('Sodium', '1.21.1', 'quilt'), 'ok');
  assert.equal(at('Только Forge', '1.21.1', 'fabric'), 'loader');
  assert.equal(at('Только Forge', '1.21.1', 'neoforge'), 'ok');
  assert.equal(at('Только Forge', '1.21.1', 'quilt'), 'loader');
  assert.equal(at('Lithium', '1.21.1', 'vanilla'), 'ok', 'ванильной сборке загрузчик поставится сам');
  assert.equal(at('Lithium', '1.19', 'vanilla'), 'version');
  assert.equal(at('Красивые текстуры', '1.21.1', 'fabric'), 'ok');
  assert.equal(at('Красивые текстуры', '1.21.1', 'forge'), 'ok');
  assert.equal(at('Красивые текстуры', '1.20.1', 'fabric'), 'version');
  assert.equal(at('Сборка друга', '1.21.1', 'fabric'), 'type');
  assert.equal(w.collection.compat({ importable: true, type: 'mod', loaders: [], versions: [] }, '1.21.1', 'fabric'), 'version');
});

test('что предложить для новой сборки: версия и загрузчик, под которые подходит больше всего проектов; без модов — ванилла; нет данных — ничего', async (t) => {
  const w = world(t);
  const c = await w.collection.load('sp6gQaWQ');
  const s = w.collection.suggest(c.projects, ['1.21.4', '1.21.1', '1.20.1']);
  assert.deepEqual([s.version, s.loader, s.fits, s.total], ['1.21.1', 'fabric', 3, 5], 'Fabric и 1.21.1: Sodium, Lithium и текстуры — три из пяти; Quilt даёт столько же, но при равенстве берётся Fabric');
  const mk = (title, loaders, versions, type = 'mod') => ({ id: title, title, type, loaders, versions, importable: true });
  const old = [mk('A', ['forge'], ['1.12.2']), mk('B', ['forge'], ['1.12.2', '1.7.10']), mk('C', ['fabric'], ['1.21.1'])];
  const o = w.collection.suggest(old, ['1.21.1', '1.12.2']);
  assert.deepEqual([o.version, o.loader, o.fits], ['1.12.2', 'forge', 2], 'двух из трёх хватает: под старую версию и Forge');
  const newer = w.collection.suggest([mk('A', ['fabric'], ['1.21.1', '1.21.4']), mk('B', ['fabric'], ['1.21.1', '1.21.4'])], ['1.21.4', '1.21.1']);
  assert.equal(newer.version, '1.21.4', 'при равенстве — более свежая версия игры');
  const packs = w.collection.suggest([mk('T', ['minecraft'], ['1.21.1'], 'resourcepack'), mk('S', ['iris'], ['1.21.1'], 'shader')], ['1.21.1']);
  assert.deepEqual([packs.version, packs.loader, packs.fits], ['1.21.1', 'vanilla', 2], 'одни ресурспаки и шейдеры — ванильная сборка');
  assert.equal(w.collection.suggest([], ['1.21.1']), null);
  assert.equal(w.collection.suggest(old, []), null);
  assert.equal(w.collection.suggest(old, null), null);
  assert.equal(w.collection.suggest([mk('X', ['fabric'], ['1.8'])], ['1.21.1']), null, 'ни под одну свежую версию — не предлагаем');
  // смотрим на двенадцать самых свежих релизов: тринадцатый уже «старьё»
  const fresh = Array.from({ length: 11 }, (_, i) => `1.21.${20 - i}`);
  assert.equal(w.collection.suggest([mk('Z', ['fabric'], ['1.8'])], [...fresh, '1.20.4', '1.8']), null, 'версия 1.8 — тринадцатая по счёту');
  assert.equal(w.collection.suggest([mk('Z', ['fabric'], ['1.20.4'])], [...fresh, '1.20.4', '1.8']).version, '1.20.4', 'а двенадцатая ещё считается');
  assert.equal(w.collection.suggest([{ ...mk('P', [], []), type: 'modpack', importable: false }], ['1.21.1']), null);
});

test('ответ на «Показать»: коллекция с советом для новой сборки по релизам (снапшоты не в счёт); нет списка версий — совета нет, а коллекция показывается; не ссылка — понятная ошибка', async (t) => {
  const w = world(t);
  const list = (versions) => async () => ({ versions });
  const rel = (id) => ({ id, type: 'release' });
  const snap = (id) => ({ id, type: 'snapshot' });
  const a = await w.collection.show('смотри: https://modrinth.com/collection/sp6gQaWQ ♡', list([snap('1.21.4'), rel('1.21.1'), rel('1.20.1')]));
  assert.equal(a.id, 'sp6gQaWQ');
  assert.equal(a.projects.length, 6);
  assert.deepEqual([a.suggest.version, a.suggest.loader, a.suggest.fits, a.suggest.total], ['1.21.1', 'fabric', 3, 5]);
  // снапшот 1.21.1 подошёл бы лучше всех, но предлагать для новой сборки можно только релизы
  const b = await w.collection.show('sp6gQaWQ', list([snap('1.21.1'), rel('1.20.1')]));
  assert.deepEqual([b.suggest.version, b.suggest.loader, b.suggest.fits], ['1.20.1', 'fabric', 1]);
  const c = await w.collection.show('sp6gQaWQ', async () => { throw new Error('Нет связи с серверами Mojang'); });
  assert.equal(c.suggest, null);
  assert.equal(c.projects.length, 6, 'коллекция показывается и без совета');
  assert.equal((await w.collection.show('sp6gQaWQ', async () => ({}))).suggest, null, 'странный ответ про версии — тоже без совета');
  // не ссылка: список версий даже не спрашивается
  let asked = 0;
  await assert.rejects(() => w.collection.show('просто слова', async () => { asked++; return { versions: [] }; }), /Не вижу ссылки на коллекцию Modrinth/);
  assert.equal(asked, 0);
  // ответ — данные коллекции как есть и одно поле поверх; сама загруженная коллекция в памяти не меняется
  const loaded = await w.collection.load('sp6gQaWQ');
  assert.deepEqual(Object.keys(a).sort(), [...Object.keys(loaded), 'suggest'].sort());
  assert.equal('suggest' in loaded, false);
});

test('«подходит ли» под выбранную цель: версия с загрузчиком или существующая сборка (её версию и загрузчик даёт поиск по коду); цели нет — ничего не подходит, но и не ломается', async (t) => {
  const w = world(t);
  const find = (id) => w.instances.get(id);
  const fabric = { AAAA0001: 'ok', BBBB0002: 'ok', CCCC0003: 'version', DDDD0004: 'ok', EEEE0005: 'type', FFFF0006: 'loader' };
  assert.deepEqual(await w.collection.fits('sp6gQaWQ', { version: '1.21.1', loader: 'fabric' }, find), fabric);
  assert.deepEqual(await w.collection.fits('sp6gQaWQ', { instance: w.inst.id }, find), fabric, 'сборка «Моя»: 1.21.1 и Fabric');
  const old = w.instances.create({ name: 'Старая', version: '1.12.2', loader: 'forge' });
  assert.deepEqual(await w.collection.fits('sp6gQaWQ', { instance: old.id }, find), { AAAA0001: 'version', BBBB0002: 'version', CCCC0003: 'ok', DDDD0004: 'version', EEEE0005: 'type', FFFF0006: 'version' });
  assert.deepEqual(await w.collection.fits('sp6gQaWQ', { version: '1.21.1', loader: 'forge' }, find), { AAAA0001: 'loader', BBBB0002: 'loader', CCCC0003: 'version', DDDD0004: 'ok', EEEE0005: 'type', FFFF0006: 'ok' });
  assert.deepEqual(await w.collection.fits('sp6gQaWQ', { version: '1.21.1', loader: 'vanilla' }, find), { AAAA0001: 'ok', BBBB0002: 'ok', CCCC0003: 'version', DDDD0004: 'ok', EEEE0005: 'type', FFFF0006: 'ok' });
  // цель не выбрана: ответ всё равно приходит
  for (const none of [undefined, null, {}]) assert.deepEqual(Object.values(await w.collection.fits('sp6gQaWQ', none, find)).sort(), ['type', 'version', 'version', 'version', 'version', 'version']);
  // нет такой сборки или код не тот: ошибка доходит до окна
  await assert.rejects(() => w.collection.fits('sp6gQaWQ', { instance: 'no-such' }, find), /Сборка не найдена/);
  await assert.rejects(() => w.collection.fits('не код', { version: '1.21.1', loader: 'fabric' }, find), /Некорректный код коллекции/);
  // пометки не качают коллекцию заново: она уже в памяти
  const before = w.api().length;
  await w.collection.fits('sp6gQaWQ', { version: '1.21.1', loader: 'fabric' }, find);
  assert.equal(w.api().length, before);
});

// ---------- установка ----------

test('в существующую сборку: ставятся выбранные моды, ресурспак и обязательная зависимость; точка восстановления одна и до первой установки; прогресс называет проекты', async (t) => {
  const w = world(t);
  await w.collection.load('sp6gQaWQ');
  const points = [];
  const labels = [];
  const r = await w.collection.run('sp6gQaWQ', { instance: w.inst.id }, ['AAAA0001', 'BBBB0002', 'DDDD0004'], { point: (id) => points.push([id, w.jars().length]), progress: (label, percent) => labels.push([label, Math.round(percent)]) });
  assert.deepEqual(points, [[w.inst.id, 0]], 'точка до первой установки, одна');
  assert.deepEqual(r.installed.slice().sort(), ['Lithium', 'Sodium', 'Библиотека', 'Красивые текстуры'].sort(), 'вместе с зависимостью Lithium; каждое название один раз');
  assert.equal(new Set(r.installed).size, r.installed.length);
  assert.deepEqual(r.failed, []);
  assert.equal(r.created, false);
  assert.equal(r.instance.id, w.inst.id);
  assert.deepEqual(w.jars(), ['AAAA0001-1.0.jar', 'BBBB0002-2.0.jar', 'LIBL0007-1.5.jar']);
  const resource = fs.readdirSync(path.join(w.instances.gameDir(w.inst.id), 'resourcepacks'));
  assert.deepEqual(resource, ['DDDD0004-3.jar'], 'ресурспак в свою папку');
  assert.deepEqual(labels.map((x) => x[0]), ['Ставлю «Sodium» (1 / 3)…', 'Ставлю «Lithium» (2 / 3)…', 'Ставлю «Красивые текстуры» (3 / 3)…']);
  assert.deepEqual(labels.map((x) => x[1]), [0, 33, 67]);
  const meta = w.mods.readMeta(w.inst.id);
  assert.equal(meta['AAAA0001-1.0.jar'].projectId, 'AAAA0001', 'запись о происхождении: обновления потом найдут мод');
});

test('что не подошло, не ломает остальное: нет версии под игру, модпак, чужой проект, повтор — отчёт «не вышло» с причинами, остальное поставлено', async (t) => {
  const w = world(t);
  await w.collection.load('sp6gQaWQ');
  const labels = [];
  const r = await w.collection.run('sp6gQaWQ', { instance: w.inst.id }, ['CCCC0003', 'AAAA0001', 'AAAA0001', 'EEEE0005', 'FFFF0006', 'НЕТ-ТАКОГО', 'ZZZZ9999', 5, null], { progress: (label) => labels.push(label) });
  assert.deepEqual(r.installed, ['Sodium']);
  assert.deepEqual(labels, ['Ставлю «Старый мод» (1 / 3)…', 'Ставлю «Sodium» (2 / 3)…', 'Ставлю «Только Forge» (3 / 3)…'], 'повтор Sodium — не вторая установка и не лишний шаг в счёте');
  const why = Object.fromEntries(r.failed.map((f) => [f.title, f.error]));
  assert.match(why['Старый мод'], /нет версии для 1\.21\.1/, 'нет версии под эту игру');
  assert.match(why['Только Forge'], /нет версии для 1\.21\.1 на Fabric — есть только для Forge, NeoForge/);
  assert.match(why['Сборка друга'], /модпак в сборку так не ставится/);
  assert.match(why['ZZZZ9999'], /нет в этой коллекции/);
  assert.equal(r.failed.length, 5, 'повтор Sodium не считается ни ошибкой, ни второй установкой');
  assert.deepEqual(w.jars(), ['AAAA0001-1.0.jar']);
  await assert.rejects(() => w.collection.run('sp6gQaWQ', { instance: w.inst.id }, []), /Ничего не выбрано/);
  await assert.rejects(() => w.collection.run('sp6gQaWQ', { instance: w.inst.id }, ['EEEE0005']), /ничего поставить нельзя/);
});

test('больше трёхсот выбранных за раз не берём: лишнее отсекается, а не ставится', async (t) => {
  const w = world(t);
  const unknown = Array.from({ length: 400 }, (_, i) => `U${String(i).padStart(7, '0')}`);
  const r = await w.collection.run('sp6gQaWQ', { instance: w.inst.id }, ['AAAA0001', ...unknown, 'BBBB0002']);
  assert.deepEqual(r.installed, ['Sodium']);
  assert.equal(r.failed.length, 299, 'на всё триста мест: Sodium и 299 неизвестных; Lithium стоял после трёхсотого');
  assert.deepEqual(w.jars(), ['AAAA0001-1.0.jar']);
});

test('в существующую сборку ничего не поставилось: сборка на месте, отчёт называет причину, ошибки нет', async (t) => {
  const w = world(t);
  const r = await w.collection.run('sp6gQaWQ', { instance: w.inst.id }, ['CCCC0003']);
  assert.deepEqual([r.created, r.installed, r.failed.map((f) => f.title)], [false, [], ['Старый мод']]);
  assert.equal(r.instance.id, w.inst.id);
  assert.ok(w.instances.list().some((i) => i.id === w.inst.id));
});

test('итог собирает то, что сообщила установка каждого проекта: поставленное (общая зависимость один раз), предупреждения и заметки лаунчера', async (t) => {
  const w = world(t);
  const modrinth = w.p.load('core/modrinth');
  const real = modrinth.install;
  t.after(() => { modrinth.install = real; });
  modrinth.install = async (instId, pid) => ({ installed: pid === 'AAAA0001' ? ['Sodium', 'Библиотека'] : ['Lithium', 'Библиотека'], warnings: [`Предупреждение ${pid}`], notes: [`Заметка ${pid}`] });
  const r = await w.collection.run('sp6gQaWQ', { instance: w.inst.id }, ['AAAA0001', 'BBBB0002']);
  assert.deepEqual(r.installed, ['Sodium', 'Библиотека', 'Lithium']);
  assert.deepEqual(r.warnings, ['Предупреждение AAAA0001', 'Предупреждение BBBB0002']);
  assert.deepEqual(r.notes, ['Заметка AAAA0001', 'Заметка BBBB0002']);
  modrinth.install = async () => ({ installed: ['Sodium'], warnings: [] }); // в ответе нет заметок
  const bare = await w.collection.run('sp6gQaWQ', { instance: w.inst.id }, ['AAAA0001']);
  assert.deepEqual([bare.installed, bare.notes, bare.failed], [['Sodium'], [], []], 'нет заметок — это не сбой установки');
});

test('точка восстановления — подстраховка: сбой в ней установке не мешает', async (t) => {
  const w = world(t);
  const r = await w.collection.run('sp6gQaWQ', { instance: w.inst.id }, ['AAAA0001'], { point: () => { throw new Error('диск полон'); } });
  assert.deepEqual(r.installed, ['Sodium']);
});

test('новая сборка: создаётся с выбранной версией и загрузчиком (название по умолчанию — коллекции, не длиннее сорока знаков), моды ставятся в неё; точка восстановления не нужна', async (t) => {
  const w = world(t);
  const points = [];
  const r = await w.collection.run('sp6gQaWQ', { version: '1.21.1', loader: 'fabric' }, ['AAAA0001', 'DDDD0004'], { point: (id) => points.push(id) });
  assert.equal(r.created, true);
  assert.deepEqual(points, [], 'у новой сборки откатывать нечего');
  assert.deepEqual([r.instance.name, r.instance.version, r.instance.loader], ['Моя подборка', '1.21.1', 'fabric']);
  assert.deepEqual(w.jars(r.instance.id), ['AAAA0001-1.0.jar']);
  assert.ok(w.instances.list().some((i) => i.id === r.instance.id));
  const named = await w.collection.run('sp6gQaWQ', { version: '1.21.1', loader: 'quilt', name: 'М'.repeat(100) }, ['AAAA0001']);
  assert.equal(named.instance.name.length, 40);
  assert.equal(named.instance.loader, 'quilt');
  const spaced = await w.collection.run('sp6gQaWQ', { version: '1.21.1', loader: 'fabric', name: '  Моя\n   сборка  ' }, ['AAAA0001']);
  assert.equal(spaced.instance.name, 'Моя сборка', 'название в одну строку');
  assert.equal(r.instance.icon, '📚');
  const long = await w.collection.run('longname', { version: '1.21.1', loader: 'fabric' }, ['AAAA0001']);
  assert.equal(long.instance.name.length, 40, 'название по умолчанию — коллекции, но не длиннее сорока знаков');
  const odd = await w.collection.run('sp6gQaWQ', { version: '1.21.1', loader: 'выдумка' }, ['DDDD0004']);
  assert.equal(odd.instance.loader, 'vanilla', 'незнакомый загрузчик — ванилла (а не мусор в сборке)');
  await assert.rejects(() => w.collection.run('sp6gQaWQ', { loader: 'fabric' }, ['AAAA0001']), /Не выбрана версия/);
  await assert.rejects(() => w.collection.run('sp6gQaWQ', { version: '../../x', loader: 'fabric' }, ['AAAA0001']), /Не выбрана версия/);
  await assert.rejects(() => w.collection.run('sp6gQaWQ', null, ['AAAA0001']), /Не выбрана версия/);
});

test('новая сборка, в которую ничего не поставилось, не остаётся пустой: удаляется, а ошибка называет причины', async (t) => {
  const w = await world(t);
  const before = w.instances.list().length;
  await assert.rejects(() => w.collection.run('sp6gQaWQ', { version: '1.12.2', loader: 'fabric' }, ['AAAA0001', 'BBBB0002']), /Не получилось поставить ничего: «Sodium» — .*«Lithium»/);
  assert.equal(w.instances.list().length, before);
  const ok = await w.collection.run('sp6gQaWQ', { version: '1.20.1', loader: 'fabric' }, ['AAAA0001', 'BBBB0002']);
  assert.deepEqual([ok.installed, ok.failed.map((f) => f.title)], [['Sodium'], ['Lithium']], 'хоть что-то поставилось — сборка остаётся, а что не вышло, в отчёте');
  assert.equal(w.instances.list().length, before + 1);
});

test('«Отменить» останавливает всё сразу; в существующей сборке уже поставленное остаётся, новая сборка без единого мода убирается', async (t) => {
  const w = world(t);
  await w.collection.run('sp6gQaWQ', { instance: w.inst.id }, ['AAAA0001']);
  assert.deepEqual(w.jars(), ['AAAA0001-1.0.jar']);
  const cancelAfterFirstFile = (token) => {
    let n = 0;
    w.state.onFile = () => { if (++n === 1) token.cancel(); };
  };
  const t1 = w.net.cancelToken();
  cancelAfterFirstFile(t1);
  await assert.rejects(() => w.net.runCancellable(t1, () => w.collection.run('sp6gQaWQ', { instance: w.inst.id }, ['BBBB0002', 'DDDD0004'])), (e) => e.cancelled === true);
  assert.deepEqual(w.jars(), ['AAAA0001-1.0.jar'], 'уже установленный мод остался; отменённый файл не применён');
  const before = w.instances.list().length;
  const t2 = w.net.cancelToken();
  w.state.onFile = null;
  w.state.onApi = () => t2.cancel(); // отмена на самом первом запросе новой сборки: ни один мод ещё не встал
  await assert.rejects(() => w.net.runCancellable(t2, () => w.collection.run('sp6gQaWQ', { version: '1.21.1', loader: 'fabric' }, ['AAAA0001', 'BBBB0002'])), (e) => e.cancelled === true);
  assert.equal(w.instances.list().length, before, 'новая сборка без единого мода удалена');
});

test('отмена при получении первого файла не устанавливает ещё не проверенный мод', async (t) => {
  const w = world(t);
  const token = w.net.cancelToken();
  w.state.onFile = () => token.cancel();
  await assert.rejects(() => w.net.runCancellable(token, () => w.collection.run('sp6gQaWQ', { instance: w.inst.id }, ['AAAA0001', 'BBBB0002'])), (e) => e.cancelled === true);
  assert.deepEqual(w.jars(), []);
});

test('проводка main.js: три канала; показ и «подходит ли» считает ядро (список версий и поиск сборки подаются ему), установка идёт в области отмены, перед ней — точка восстановления', () => {
  const main = fs.readFileSync(src('main.js'), 'utf8');
  assert.match(main, /handle\('browse:collection', \(text\) => collection\.show\(text, \(\) => versions\.listMinecraft\(\)\)\);/);
  assert.match(main, /handle\('browse:collectionCompat', \(id, target\) => collection\.fits\(id, target, \(instId\) => instances\.get\(instId\)\)\);/);
  assert.match(main, /handle\('browse:collectionImport', \(id, target, ids\) =>\s*withTask\(/);
  assert.match(main, /collection\.run\(id, [\s\S]*?point: \(instId\) => autoPoint\(instId, 'Перед импортом коллекции'\)/, 'точка восстановления');
});
