// «Код сборки» (core/modcode.js): хозяин копирует короткий код со своими модами, гость вставляет его вместе с адресом мира, лаунчер сверяет
// моды и ставит точные версии с Modrinth. Modrinth подменён: на неизвестный адрес он отвечает 404, в настоящую сеть тесты не ходят
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { profile, put } = require('./helpers');

const sha1 = (b) => crypto.createHash('sha1').update(b).digest('hex');
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const B62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const randomId = () => Array.from(crypto.randomBytes(8), (b) => B62[b % 62]).join('');

// Подменённый Modrinth: проекты, версии с файлами и «CDN». calls — что у него спрашивали; state — что в нём сломать
function modrinth() {
  const versions = new Map(); // id версии → объект версии
  const byHash = new Map(); // sha1 файла → id версии
  const projects = new Map();
  const cdn = new Map(); // адрес файла → байты
  const calls = [];
  const state = { corrupt: new Set(), down: new Set(), failLookup: false, failVersions: false, gone: new Set() };
  let seq = 0;
  return {
    calls,
    state,
    // Добавляет версию мода (и проект, если его ещё нет); возвращает { version, file, bytes, sha1, project }
    mod(slug, ver, { title = slug[0].toUpperCase() + slug.slice(1), filename = `${slug}-${ver}.jar`, url } = {}) {
      let project = [...projects.values()].find((p) => p.slug === slug);
      if (!project) {
        project = { id: `PRJ${String(projects.size + 1).padStart(5, '0')}`, slug, title, icon_url: `https://cdn.modrinth.com/icons/${slug}.png` };
        projects.set(project.id, project);
      }
      const bytes = Buffer.from(`jar:${slug}:${ver}`);
      const file = { primary: true, url: url ?? `https://cdn.modrinth.com/data/${project.id}/${filename}`, filename, hashes: { sha1: sha1(bytes) }, size: bytes.length };
      const version = { id: `VER${String(++seq).padStart(5, '0')}`, project_id: project.id, name: `${title} ${ver}`, version_number: ver, game_versions: ['1.20.1'], loaders: ['fabric'], files: [file] };
      versions.set(version.id, version);
      byHash.set(file.hashes.sha1, version.id);
      cdn.set(file.url, bytes);
      return { version, file: filename, bytes, sha1: file.hashes.sha1, project };
    },
    fetch: async (url, opts = {}) => {
      const u = new URL(String(url));
      const body = opts.body ? JSON.parse(opts.body) : null;
      calls.push({ method: opts.method || 'GET', path: u.pathname, body, url: String(url) });
      if (u.host === 'api.modrinth.com') {
        if (u.pathname === '/v2/version_files' && opts.method === 'POST') {
          if (state.failLookup) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
          return json(Object.fromEntries(body.hashes.filter((h) => byHash.has(h)).map((h) => [h, versions.get(byHash.get(h))])));
        }
        if (u.pathname === '/v2/versions' && state.failVersions) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
        if (u.pathname === '/v2/versions') return json(JSON.parse(u.searchParams.get('ids')).filter((i) => !state.gone.has(i)).map((i) => versions.get(i)).filter(Boolean));
        if (u.pathname === '/v2/projects') return json(JSON.parse(u.searchParams.get('ids')).map((i) => projects.get(i)).filter(Boolean));
      }
      if (cdn.has(String(url)) && !state.down.has(String(url))) {
        const bytes = state.corrupt.has(String(url)) ? Buffer.from('испорченный файл') : cdn.get(String(url));
        return new Response(bytes, { status: 200, headers: { 'content-length': String(bytes.length) } });
      }
      return new Response('нет', { status: 404 }); // в настоящую сеть тесты не ходят
    },
  };
}

const HOST = { mc: '1.20.1', loader: 'fabric', loaderVersion: '0.15.0' };

// Сборка гостя (или хозяина) на временном профиле. fetch подменяем до profile(): net.js запоминает его при загрузке.
// Одна подмена на тест: ещё сборки того же профиля делает s.more()
function setup(t, { loader = 'fabric', version = '1.20.1', name = 'Мои моды' } = {}) {
  const mr = modrinth();
  const real = globalThis.fetch;
  globalThis.fetch = mr.fetch;
  const p = profile();
  t.after(() => {
    globalThis.fetch = real;
    p.done();
  });
  const instances = p.load('core/instances');
  const build = (o) => {
    const inst = instances.create({ name: o.name, version: o.version, loader: o.loader, loaderVersion: o.loader === 'vanilla' ? null : '0.15.0' });
    const g = instances.gameDir(inst.id);
    fs.mkdirSync(path.join(g, 'mods'), { recursive: true });
    return { inst, g, jar: (file, bytes) => put(g, { [`mods/${file}`]: bytes }), ls: () => fs.readdirSync(path.join(g, 'mods')).sort() };
  };
  return {
    mr, p, instances,
    ...build({ name, version, loader }),
    more: (o = {}) => build({ name: 'Ещё сборка', version: '1.20.1', loader: 'fabric', ...o }),
    mods: p.load('core/mods'),
    modcode: p.load('core/modcode'),
    api: (method = 'POST') => mr.calls.filter((c) => c.method === method),
  };
}
const titles = (list) => list.map((x) => x.title);

// ---------- формат кода ----------

test('код сборки: упаковка и распаковка возвращают то же самое, а для одного набора модов код один и тот же', (t) => {
  const { modcode } = setup(t);
  const payload = { ...HOST, ids: ['VER00002', 'VER00001'], others: [{ name: 'my-mod.jar', hash: '0123456789abcdef' }] };
  const code = modcode.pack(payload);
  const m = /^FLM1:(\d+):([A-Za-z0-9+/]+)$/.exec(code);
  assert.ok(m, code);
  assert.equal(Number(m[1]), m[2].length, 'в заголовке — длина тела: по ней находится конец кода в тексте и видно, что код обрезан');
  assert.deepEqual(modcode.unpack(code), { ...HOST, ids: ['VER00001', 'VER00002'], others: [{ name: 'my-mod.jar', hash: '0123456789abcdef' }] });
  assert.equal(modcode.pack({ ...payload, ids: ['VER00001', 'VER00002'] }), code, 'порядок файлов в папке на код не влияет');
  assert.equal(modcode.pack({ ...payload, ids: ['VER00001', 'VER00002', 'VER00001'] }), code, 'повторы id не раздувают код');
  assert.equal(modcode.unpack(`${code} и ещё какой-то текст после кода`).ids.length, 2, 'всё после кода (по длине из заголовка) игнорируется');
  assert.throws(() => modcode.pack({ ...payload, ids: ['короткий'] }), (e) => e.code === 'bad');
  assert.throws(() => modcode.pack({ ...payload, others: [{ name: '../x.jar', hash: '0123456789abcdef' }] }), (e) => e.code === 'bad', 'то, что не принял бы разбор, код не попадает');
  assert.deepEqual(modcode.unpack(modcode.pack({ mc: '26.3', loader: 'vanilla', ids: [], others: [] })), { mc: '26.3', loader: 'vanilla', loaderVersion: null, ids: [], others: [] }, 'и ванильная сборка без модов, и версия без загрузчика');
});

test('размер: код для 60, 150 и 220 модов остаётся в одном сообщении чата (до 2000 знаков), у не-Modrinth модов добавляются имя и отпечаток', (t) => {
  const { modcode } = setup(t);
  for (const [count, max] of [[60, 700], [150, 1500], [220, 2000]]) {
    const ids = Array.from({ length: count }, randomId);
    const code = modcode.pack({ ...HOST, ids, others: [] });
    assert.ok(code.length <= max, `${count} модов: ${code.length} знаков (нужно не больше ${max})`);
    assert.deepEqual(modcode.unpack(code).ids, [...new Set(ids)].sort());
  }
  const own = modcode.pack({ ...HOST, ids: Array.from({ length: 60 }, randomId), others: Array.from({ length: 5 }, (_, i) => ({ name: `sodium-extra-fabric-0.5.${i}+mc1.20.1.jar`, hash: sha1(String(i)).slice(0, 16) })) });
  assert.ok(own.length <= 1200, `60 модов и 5 чужих файлов: ${own.length} знаков`);
});

// Воспроизводимые наборы вместо случайных id. LEGACY_* — настоящие коды лаунчера 0.10.2 (без поля h) для тех же наборов
const IDS_118 = ['DVA2JIsN', 'SDSEsPG7', 'izDThKKX', 'icph2Wlj', '756lCdPA', '90CLSrRI', 'LTzyEfNB', 'JFEGONb6', 'AcXknOeI', 'BXmFqB8I', 'tJwgBAjU', '9Trda1gQ', 'BQuoR954', 't9qEtLra', 'AGgvIHBu', 'LBXSpL8w', 'o7x9P0Ms', 'PNfCccf7', 'lrrONOLH', 'CG5oBd9g', 'L9WfPsEt', 'kIz5MZa2', '8nbLZoSh', 'aWMo48vn', 'cJirnlon', '1php8GfS', '0ulz4kgI', 'a7DrwSoy', 'PxuXoRyV', 'GJMa8td4'];
const IDS_7 = ['AD8rgZcO', 'itPJvgMW', 'ShS8P2LI', 'JShvE4im', 'q7m5zCKW', 'aBFvWad6', 'rqUWII4T', 'LnUCq5hz', 'o5Hgo37z', 'k77iyAfU', 'siu8izan', 'tiTOAB6z', 'nAmks9R9', 'oxmzI9fj', 'JYNy1to9', 'lt7eOkx0', 'LidgLPbd', 'KAKBG28D', 'KZetWWxs', 'xgxZiSgw', 'EPzzwaW5', 'PWdzZ8ib', 'UhS2j90e', 'br5ioKqY', 'l1XSFqt7', 'TQEs5wz7', 'O8RhYsvm', 'smkQzdIs', 'cii37JGR', 'gY41g4Re'];
const IDS_42 = ['lb0pKgQm', '1dP2uTMf', 'qlAdzDkB', 'QDLwgBK0', 'eyTbCDik'];
const OTHERS_42 = [{ name: 'own-mod-1.0.jar', hash: '0123456789abcdef' }, { name: 'sodium-extra-fabric-0.5.1+mc1.20.1.jar', hash: 'fedcba9876543210' }];
const LEGACY_118 = 'FLM1:348:eNoVx8mOgjAAANB/6dkQICCUGwXEYlm0jhJvtQyLIsWyODKZf5/4bu8XzMDRVuDBgQM0RVcVDaxACxxQsqts+CczcICqaKaighV4fDK1i3GvsNbXvR2W1DLXrVdkrt1dyUXQGqoeofKA4VEWTKv2bljNeIsml+f3Lv3GaD+JAzQNlD82T2RjLzQFKmDln1w9wkMSRjGzx8KINkGYJtc1gecyG4KRoJz2xH6R4/IOygRlSelxXlrZz5SLw/tEfRoMWWgxy5cvKt7sHAvDnjseNbJrRdfwvtbP7a1Z/GO92+V3vJjxhemtlGmSkq2wfmCmxsMIn8FIJBujV4Xc2xf4+wf5DV3q';
const LEGACY_7 = 'FLM1:347:eNoVx8lygjAYAOB3+c8OQ5AY4IZrWVoQZFK4sRkiRoaliHH67p1+t+8NM1hoBaIEC5CiqQqCFdzBgmteDLz8zwwWqArCigorEGCBvTcGlpXBIZTymVPsxs180Llw068XmjrTs73tSTP2XlZPlC6jzyvmh0XlP5JdjxsZGFGTjrMIaSUzgxdxExuh5juX82HET0mSJtZuplrn2+NM82pTDJh3Xp+WnK+Je4pYqiOmRzWfQndmn7QlhL/sa3JH3/Gxn8h9InXQLurDFu1oRmaHP1i3JrJbhHTM660nAsudR4c+oY6jX0b+Y3CZP0bRnmXljBO/BPZ2Ixe2ZDxmT/j9A2GnYHo';
const LEGACY_42 = 'FLM1:232:eNotjssOgjAUBf/lbG2bWxDR7lR2aqKJO8KiDzAIFUXxGf/dEFyeZCZzPrhDSQZvoSBFQEKCoYZCoU1b2n7coUBCRoLA4HvObYNuvyl2yfpxWKwof+3NMimr2tB5ddj5Sz1376RagKGBSlM0jxP3jeNSkDjqFgwkg3AcTeLpTBvr8gIZS3FtXNl5nj9vreZDn5OIhBx5O3z720XurNGzaTyJxmEgCVn2/QE7ajlv';
const SETS = [
  { name: '30 модов (найденный случай)', data: { ...HOST, ids: IDS_118, others: [] }, legacy: LEGACY_118 },
  { name: '30 модов', data: { ...HOST, ids: IDS_7, others: [] }, legacy: LEGACY_7 },
  { name: '5 модов и 2 чужих файла', data: { ...HOST, ids: IDS_42, others: OTHERS_42 }, legacy: LEGACY_42 },
];
const bodyAt = (code) => code.indexOf(':', 5) + 1;
// i-й знак тела кода заменён на ch
const swapAt = (code, i, ch) => code.slice(0, bodyAt(code) + i) + ch + code.slice(bodyAt(code) + i + 1);
const inflated = (code) => zlib.inflateSync(Buffer.from(code.slice(bodyAt(code)), 'base64'));
const rawCode = (obj) => {
  const body = zlib.deflateSync(Buffer.from(JSON.stringify(obj))).toString('base64').replace(/=+$/, '');
  return `FLM1:${body.length}:${body}`;
};

test('распаковка: чужой текст, обрезанный, повреждённый, слишком большой и «из будущего» код — понятная причина, а не падение', (t) => {
  const { modcode } = setup(t);
  const code = modcode.pack({ ...HOST, ids: IDS_7, others: [] }); // постоянный набор: порча знака 40 этого кода заведомо меняет поток
  const fails = (text, kind, re) => assert.throws(() => modcode.unpack(text), (e) => e.code === kind && re.test(e.message), `${kind}: ${String(text).slice(0, 40)}`);
  fails('просто текст', 'foreign', /не код сборки/);
  fails('', 'foreign', /не код сборки/);
  fails(undefined, 'foreign', /не код сборки/);
  fails(code.slice(0, code.length - 12), 'truncated', /обрезан.*не хватает 12/);
  const i = code.indexOf(':', 6) + 40;
  fails(code.slice(0, i) + (code[i] === 'A' ? 'B' : 'A') + code.slice(i + 1), 'corrupt', /повреждён/);
  fails(`FLM2:12:${'A'.repeat(12)}`, 'newer', /более новой версией лаунчера/);
  fails('FLM1:999999:AAAA', 'big', /слишком большой/);
  // маленький код, который распаковывается в мегабайты (бомба): отвергается, память не съедена
  const bomb = zlib.deflateSync(Buffer.alloc(8_000_000, 0x20)).toString('base64').replace(/=+$/, '');
  fails(`FLM1:${bomb.length}:${bomb}`, 'big', /слишком большой/);
  fails('FLM1:12:ab!cd?efgh123', 'corrupt', /повреждён/);
});

test('распаковка: содержимое проверяется — типы, id, загрузчик, версия игры, имена файлов; лишние поля из будущего не мешают', (t) => {
  const { modcode } = setup(t);
  const make = (o) => {
    const body = zlib.deflateSync(Buffer.from(JSON.stringify(o))).toString('base64').replace(/=+$/, '');
    return `FLM1:${body.length}:${body}`;
  };
  const good = { v: 1, mc: '1.20.1', l: 'fabric', lv: '0.15.0', m: 'VER00001VER00002', o: [['a.jar', '0123456789abcdef']] };
  assert.equal(modcode.unpack(make({ ...good, future: { x: 1 } })).ids.length, 2, 'неизвестные поля пропускаются');
  const bad = [
    ['версия кода', { ...good, v: 2 }],
    ['версия игры с путём', { ...good, mc: '../1.20' }],
    ['версия игры не строка', { ...good, mc: 1.2 }],
    ['загрузчик не из списка', { ...good, l: 'evil' }],
    ['версия загрузчика с мусором', { ...good, lv: 'a b;c' }],
    ['id не строкой', { ...good, m: 12345678 }],
    ['id не кратны 8', { ...good, m: 'VER0000' }],
    ['id с символами не из base62', { ...good, m: 'VER000-1' }],
    ['слишком много модов', { ...good, m: 'A'.repeat(8 * 2001) }],
    ['чужие файлы не списком', { ...good, o: 'a.jar' }],
    ['имя файла с путём', { ...good, o: [['../evil.jar', '0123456789abcdef']] }],
    ['имя файла с обратной чертой', { ...good, o: [['x\\evil.jar', '0123456789abcdef']] }],
    ['имя файла с управляющим символом', { ...good, o: [['a\u0000.jar', '0123456789abcdef']] }],
    ['слишком длинное имя', { ...good, o: [['a'.repeat(300) + '.jar', '0123456789abcdef']] }],
    ['отпечаток не из шестнадцатеричных', { ...good, o: [['a.jar', 'zzzzzzzzzzzzzzzz']] }],
    ['слишком много чужих файлов', { ...good, o: Array.from({ length: 501 }, (_, i) => [`a${i}.jar`, '0123456789abcdef']) }],
    ['корень не объект', [1, 2, 3]],
  ];
  for (const [what, o] of bad) assert.throws(() => modcode.unpack(make(o)), (e) => e.code === 'bad', what);
});

test('порча одного знака, найденный случай: другая запись тех же длин кодов Хаффмана — данные те же, и код принимается', (t) => {
  const { modcode } = setup(t);
  // Знак 39 тела LEGACY_118 ('L' → 'A') лежит в заголовке блока deflate: запись «повтори предыдущую длину кода (6) три раза»
  // (символ 16) превращается в три явных «6». Таблица длин та же, значит те же деревья Хаффмана, те же байты после распаковки и та же
  // сумма Adler-32. Это другая допустимая запись тех же данных, а не их изменение. Прежний тест требовал отказа для любой замены знака
  // в случайном коде и поэтому падал примерно на 0,7 % случайных наборов
  const bad = swapAt(LEGACY_118, 39, 'A');
  assert.notEqual(bad, LEGACY_118);
  assert.ok(inflated(bad).equals(inflated(LEGACY_118)), 'после распаковки байты те же');
  assert.deepEqual(modcode.unpack(bad), modcode.unpack(LEGACY_118));
  assert.deepEqual(modcode.unpack(LEGACY_118), { ...HOST, ids: [...IDS_118].sort(), others: [] });
});

test('порча одного знака, меняющая данные: сумма zlib (Adler-32) её не видит, сумма кода h — видит', (t) => {
  const { modcode } = setup(t);
  // Найденные случаи в настоящих кодах 0.10.2 (без h): распаковка проходит, но данные уже другие — поэтому в код добавлена сумма h
  const ids7 = modcode.unpack(swapAt(LEGACY_7, 234, 'x')).ids;
  assert.ok(ids7.includes('gY41g4Ri') && !ids7.includes('gY41g4Re'), 'id «…4ReitPJ…» → «…4RiaxPJ…»: +4, −8, +4 у соседних байтов, Adler-32 не меняется');
  const others42 = modcode.unpack(swapAt(LEGACY_42, 23, 'F')).others.map((o) => o.hash);
  assert.deepEqual(others42, ['0123456879abcdef', 'fedcba9786543210'], 'в таблице Хаффмана поменялись коды цифр 7 и 8');
  // Те же наборы новым кодом: любая замена любого знака тела на любой знак base64 либо отвергается как повреждение,
  // либо даёт ровно те же данные (другая запись того же). Тихой подмены данных нет
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  for (const set of SETS) {
    const code = modcode.pack(set.data);
    const ref = JSON.stringify(modcode.unpack(code));
    const body = code.slice(bodyAt(code));
    let rejected = 0;
    let same = 0;
    for (let i = 0; i < body.length; i++) {
      for (const ch of B64) {
        if (ch === body[i]) continue;
        let got;
        try {
          got = JSON.stringify(modcode.unpack(swapAt(code, i, ch)));
        } catch (e) {
          assert.equal(e.code, 'corrupt', `${set.name}: знак ${i} → ${ch}: ${e.message}`);
          rejected++;
          continue;
        }
        assert.equal(got, ref, `${set.name}: знак ${i} → ${ch} тихо изменил данные`);
        same++;
      }
    }
    assert.ok(rejected > 50 * same, `${set.name}: отвергнуто ${rejected}, та же запись ${same}`);
  }
});

test('сумма кода: старые коды без неё читаются как раньше, новые с ней — те же данные; неверная сумма — повреждение', (t) => {
  const { modcode } = setup(t);
  for (const set of SETS) {
    const expected = { ...set.data, ids: [...set.data.ids].sort(), others: [...set.data.others].sort((a, b) => (a.name < b.name ? -1 : 1)) };
    assert.deepEqual(modcode.unpack(set.legacy), expected, `${set.name}: код 0.10.2`);
    const code = modcode.pack(set.data);
    assert.deepEqual(modcode.unpack(code), expected, `${set.name}: новый код`);
    const json = JSON.parse(inflated(code).toString('utf8'));
    assert.match(json.h, /^[0-9a-f]{12}$/);
    // лаунчер 0.10.2 читает новые коды: его разбор пропускает незнакомые поля (проверено в «разбор: только допустимое содержимое»)
    assert.throws(() => modcode.unpack(rawCode({ ...json, h: '000000000000' })), (e) => e.code === 'corrupt', `${set.name}: чужая сумма`);
    assert.throws(() => modcode.unpack(rawCode({ ...json, h: 12345 })), (e) => e.code === 'corrupt', `${set.name}: сумма не строкой`);
    assert.throws(() => modcode.unpack(rawCode({ ...json, m: json.m.replace(/^./, (c) => (c === 'A' ? 'B' : 'A')) })), (e) => e.code === 'corrupt', `${set.name}: id изменён, сумма прежняя`);
    // сумма не зависит от порядка ключей в JSON
    const { h, ...rest } = json;
    assert.deepEqual(modcode.unpack(rawCode({ h, ...Object.fromEntries(Object.entries(rest).reverse()) })), expected);
  }
});

test('вставленное сообщение друга: адрес и код находятся в любом тексте, код переживает переносы, кавычки и чужие слова вокруг', (t) => {
  const { modcode } = setup(t);
  const code = modcode.pack({ ...HOST, ids: Array.from({ length: 40 }, randomId), others: [] });
  const wrap = (s, n = 50) => s.match(new RegExp(`.{1,${n}}`, 'g')).join('\n');
  const addr = 'pink-cat-123.e4mc.link';
  const cases = [
    ['две строки', `${addr}\nКод сборки: ${code}`],
    ['адрес после кода, лишние слова', `Смотри, вот код ${code} и заходи на ${addr}, жду!`],
    ['код разбит на строки по 50 знаков (так делят длинные сообщения чаты)', `${addr}\n${wrap(code)}`],
    ['код с пробелами и в кавычках', `"${code.replace(/(.{40})/g, '$1 ')}"  ${addr}`],
    ['код в блоке кода', `\`\`\`\n${code}\n\`\`\`\n${addr}`],
    ['Markdown вокруг адреса и кода', `**${addr}**\n_${code}_`],
  ];
  for (const [what, text] of cases) {
    const r = modcode.parseInvite(text);
    assert.equal(r.code, code, what);
    assert.equal(r.address, addr, what);
    assert.equal(r.codeError, null, what);
  }
  assert.equal(modcode.parseInvite(`${code}${code}`).code, code, 'два кода подряд — берётся первый, остальное игнорируется');
});

test('вставленное сообщение друга: разные виды адреса, версии и имена файлов за адрес не принимаются, обрезанный код не мешает найти адрес', (t) => {
  const { modcode } = setup(t);
  const addr = (text) => modcode.parseInvite(text).address;
  assert.equal(addr('вот: abc-def-ghi.e4mc.link'), 'abc-def-ghi.e4mc.link');
  assert.equal(addr('192.168.1.5:61223'), '192.168.1.5:61223');
  assert.equal(addr('в VPN: 26.12.34.56:61223 (Radmin)'), '26.12.34.56:61223');
  assert.equal(addr('[2a02:6b8::1]:61223 по IPv6'), '[2a02:6b8::1]:61223');
  assert.equal(addr('сервер play.example.com:25565, заходи'), 'play.example.com:25565');
  assert.equal(addr('Minecraft 1.20.1, моды sodium-fabric-0.5.8.jar и lithium.jar'), null, 'версии игры и имена файлов — не адрес');
  assert.equal(addr('play.example.com или abc.e4mc.link'), 'abc.e4mc.link', 'адрес e4mc важнее обычного имени');
  assert.equal(addr('1.20.1 192.168.0.9 свой'), '192.168.0.9', 'IP-адрес важнее обычного имени');
  assert.equal(addr('999.1.1.1 и 300.2.3.4:25565'), null, 'не IP: октет больше 255');
  assert.equal(addr('192.168.1.5:99999'), null, 'не адрес: порт больше 65535');
  assert.equal(addr('привет'), null);
  assert.deepEqual(modcode.parseInvite(''), { code: null, codeError: null, address: null });
  assert.deepEqual(modcode.parseInvite(undefined), { code: null, codeError: null, address: null });
  const code = modcode.pack({ ...HOST, ids: Array.from({ length: 30 }, randomId), others: [] });
  const cut = modcode.parseInvite(`abc.e4mc.link ${code.slice(0, code.length - 20)}`);
  assert.equal(cut.code, null);
  assert.equal(cut.codeError.code, 'truncated');
  assert.match(cut.codeError.message, /обрезан/);
  assert.equal(cut.address, 'abc.e4mc.link');
  // огромный текст не вешает разбор (слова без пробелов — худший случай для регулярных выражений) и не ищется целиком
  const started = Date.now();
  assert.equal(addr(`${'x'.repeat(100000)} abc.e4mc.link`), null);
  assert.equal(addr(`${'a-'.repeat(20000)}.${'b'.repeat(20000)}`), null);
  assert.ok(Date.now() - started < 1500, `разбор огромного текста занял ${Date.now() - started} мс`);
  // регулярное выражение адреса одно на все: то же правило проверяет окно перед «Зайти»
  for (const ok of ['abc.e4mc.link', 'host:25565', '127.0.0.1', '[::1]:25565', '192.168.1.5:61223', 'localhost']) assert.equal(modcode.isAddress(ok), true, ok);
  for (const bad of ['', 'a b', 'host:99999x', 'host:99999', 'host:0', 'host/path', '[::1', 'a;b', 'host:', ':25565', '-start', 'x'.repeat(300)]) assert.equal(modcode.isAddress(bad), false, bad);
  assert.equal(modcode.ADDRESS_RE.test('host:25565'), true);
});

test('окно «Войти к другу» и лаунчер проверяют адрес одним правилом, а причины «нужен файл от друга» в окне описаны все', async (t) => {
  const s = scene(t);
  const win = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app', 'join.js'), 'utf8');
  assert.ok(win.includes(s.modcode.ADDRESS_RE.toString()), 'регулярное выражение адреса в окне отличается от core/modcode.js');
  assert.ok(win.includes('Number(port[1]) >= 1 && Number(port[1]) <= 65535'), 'границы порта в окне другие');
  s.jar('own.jar', 'другое содержимое');
  const plan = await s.modcode.compare({ ...HOST, ids: [s.gone.version.id], others: [{ name: 'own.jar', hash: sha1(s.own).slice(0, 16) }, { name: 'tools.jar', hash: sha1('tools').slice(0, 16) }] }, s.inst.id);
  const used = [...new Set(plan.manual.map((x) => x.why))].sort();
  assert.deepEqual(used, ['differs', 'gone', 'other']);
  const table = /const JN_MANUAL = \{([\s\S]*?)\};/.exec(win)[1];
  assert.deepEqual([...table.matchAll(/(\w+): '/g)].map((m) => m[1]).sort(), used, 'у каждой причины в окне есть текст');
});

// ---------- хозяин: код своей сборки ----------

test('код своей сборки: id версий Modrinth по хэшам включённых модов, остальные файлы — именем и отпечатком; выключенные и чужие файлы не в счёт', async (t) => {
  const { mr, p, inst, jar, modcode, api } = setup(t, { name: 'Секретное название сборки' });
  const a = mr.mod('alpha', '1.0');
  const b = mr.mod('beta', '2.1');
  jar(a.file, a.bytes);
  jar(b.file, b.bytes);
  jar('own-mod.jar', 'мой собственный мод');
  jar('off.jar.disabled', 'выключен');
  jar('readme.txt', 'не мод');
  const r = await modcode.encode(inst.id);
  assert.equal(r.total, 3);
  assert.equal(r.modrinth, 2);
  assert.deepEqual(r.others, ['own-mod.jar']);
  assert.deepEqual(modcode.unpack(r.code), { ...HOST, ids: [a.version.id, b.version.id].sort(), others: [{ name: 'own-mod.jar', hash: sha1('мой собственный мод').slice(0, 16) }] });
  assert.equal(api().length, 1, 'у Modrinth спросили один раз, сразу про все файлы');
  assert.deepEqual([...api()[0].body.hashes].sort(), [a.sha1, b.sha1, sha1('мой собственный мод')].sort(), 'выключенный мод и не-jar в запрос не попали');
  // в коде только то, что нужно для сверки: ни названия сборки, ни путей, ни аккаунтов
  const raw = zlib.inflateSync(Buffer.from(r.code.replace(/^FLM1:\d+:/, ''), 'base64')).toString('utf8');
  // h — сумма содержимого (12 шестнадцатеричных знаков SHA-256), не данные человека
  assert.deepEqual(Object.keys(JSON.parse(raw)).sort(), ['h', 'l', 'lv', 'm', 'mc', 'o', 'v']);
  assert.match(JSON.parse(raw).h, /^[0-9a-f]{12}$/);
  assert.ok(!raw.includes('Секретное') && !raw.includes(p.dir) && !raw.includes(path.basename(p.dir)) && !/Users|AppData/.test(raw), raw);
});

test('код своей сборки: у двух сборок с одним набором модов код одинаковый; без модов в сеть не ходим; версия загрузчика необязательна', async (t) => {
  const s = setup(t);
  const a = s.mr.mod('alpha', '1.0');
  const b = s.mr.mod('beta', '1.0');
  s.jar(a.file, a.bytes);
  s.jar(b.file, b.bytes);
  const code1 = (await s.modcode.encode(s.inst.id)).code;
  const copy = s.more();
  copy.jar(b.file, b.bytes);
  copy.jar(a.file, a.bytes);
  assert.equal((await s.modcode.encode(copy.inst.id)).code, code1);

  const bare = s.more({ version: '1.21.1', loader: 'vanilla' });
  s.mr.calls.length = 0;
  const r = await s.modcode.encode(bare.inst.id);
  assert.equal(s.mr.calls.length, 0, 'модов нет — спрашивать нечего');
  assert.deepEqual(s.modcode.unpack(r.code), { mc: '1.21.1', loader: 'vanilla', loaderVersion: null, ids: [], others: [] });
  assert.equal(r.total, 0);
});

test('код своей сборки: нет связи с Modrinth — понятная ошибка, а не код, по которому другу ничего не поставить', async (t) => {
  const { mr, inst, jar, modcode } = setup(t);
  const a = mr.mod('alpha', '1.0');
  jar(a.file, a.bytes);
  mr.state.failLookup = true;
  await assert.rejects(() => modcode.encode(inst.id), /Нет связи с Modrinth/);
  await assert.rejects(() => modcode.encode('нет-такой-сборки'), /не найдена|Некорректный/);
});

// ---------- гость: сверка ----------

// Хозяин: Alpha 1.0, Beta 1.0, Gamma 1.0, Delta 2.0, свой own.jar и мод, версию которого уже удалили с Modrinth.
// Гость (guestWithMods): Alpha 1.0 (то же), Beta 0.9 (другая версия), Gamma 1.0 выключен, Delta нет, Zeta и custom.jar лишние, own.jar тот же
function scene(t, guest = {}) {
  const s = setup(t, guest);
  const { mr } = s;
  const alpha = mr.mod('alpha', '1.0');
  const beta1 = mr.mod('beta', '1.0');
  const beta0 = mr.mod('beta', '0.9');
  const gamma = mr.mod('gamma', '1.0');
  const delta = mr.mod('delta', '2.0');
  const zeta = mr.mod('zeta', '1.0');
  const gone = mr.mod('vanished', '3.0');
  mr.state.gone.add(gone.version.id);
  const own = Buffer.from('мой собственный мод');
  const payload = { ...HOST, ids: [alpha, beta1, gamma, delta, gone].map((x) => x.version.id), others: [{ name: 'own.jar', hash: sha1(own).slice(0, 16) }] };
  const out = { ...s, alpha, beta1, beta0, gamma, delta, zeta, gone, own, payload };
  out.guestWithMods = (g = s) => {
    g.jar(alpha.file, alpha.bytes);
    g.jar(beta0.file, beta0.bytes);
    g.jar(`${gamma.file}.disabled`, gamma.bytes);
    g.jar(zeta.file, zeta.bytes);
    g.jar('custom.jar', 'неизвестный мод');
    g.jar('own.jar', own);
  };
  return out;
}

test('сверка: совпало, выключен, другая версия, нет, лишний, чужой файл и удалённая версия — каждый в своём списке, за три запроса', async (t) => {
  const s = scene(t);
  s.guestWithMods();
  const plan = await s.modcode.compare(s.payload, s.inst.id);
  assert.deepEqual(titles(plan.same), ['Alpha', 'own.jar']);
  assert.deepEqual(plan.off, [{ title: 'Gamma', file: 'gamma-1.0.jar', version: '1.0' }]);
  assert.deepEqual(plan.other.map((x) => [x.title, x.mine, x.theirs, x.file]), [['Beta', '0.9', '1.0', 'beta-0.9.jar']]);
  assert.deepEqual(plan.missing.map((x) => [x.title, x.version, x.versionId]), [['Delta', '2.0', s.delta.version.id]]);
  assert.deepEqual(plan.manual, [{ name: s.gone.version.id, why: 'gone' }], 'версию удалили с Modrinth: поставить нечего, но видно, что она была');
  assert.deepEqual(plan.extra.map((x) => [x.title, x.known]), [['custom.jar', false], ['Zeta', true]]);
  assert.equal(plan.todo, 3, 'поставить: Delta, заменить Beta, включить Gamma');
  assert.deepEqual(plan.mismatch, { version: false, loader: false, loaderVersion: false });
  assert.deepEqual(plan.host, { ...HOST, count: 6 });
  assert.deepEqual(plan.mine, HOST);
  assert.deepEqual(s.mr.calls.map((c) => `${c.method} ${c.path}`).sort(), ['GET /v2/projects', 'GET /v2/versions', 'POST /v2/version_files'], 'по одному запросу на всё');
  JSON.stringify(plan); // можно отправить окну
});

test('сверка: у гостя те же моды — ничего делать не надо; у обоих нет модов — в сеть не ходим', async (t) => {
  const s = setup(t);
  const a = s.mr.mod('alpha', '1.0');
  s.jar(a.file, a.bytes);
  const plan = await s.modcode.compare({ ...HOST, ids: [a.version.id], others: [] }, s.inst.id);
  assert.equal(plan.todo, 0);
  assert.deepEqual([plan.missing, plan.other, plan.off, plan.manual, plan.extra], [[], [], [], [], []]);
  assert.deepEqual(titles(plan.same), ['Alpha']);
  const bare = s.more();
  s.mr.calls.length = 0;
  const p2 = await s.modcode.compare({ ...HOST, ids: [], others: [] }, bare.inst.id);
  assert.equal(s.mr.calls.length, 0);
  assert.equal(p2.todo, 0);
});

test('сверка: нужная версия выключена, а другая включена — заменяем включённую (иначе будет два одинаковых мода); выключенная другая версия не мешает', async (t) => {
  const s = scene(t);
  s.jar(s.beta0.file, s.beta0.bytes);
  s.jar(`${s.beta1.file}.disabled`, s.beta1.bytes);
  const plan = await s.modcode.compare({ ...HOST, ids: [s.beta1.version.id], others: [] }, s.inst.id);
  assert.deepEqual(plan.other.map((x) => [x.title, x.mine, x.theirs]), [['Beta', '0.9', '1.0']]);
  assert.deepEqual([plan.off.length, plan.missing.length, plan.extra.length], [0, 0, 0]);
  // у гостя только выключенная ДРУГАЯ версия: нужную надо ставить, а выключенную не трогаем
  const g = s.more();
  g.jar(`${s.beta0.file}.disabled`, s.beta0.bytes);
  const p2 = await s.modcode.compare({ ...HOST, ids: [s.beta1.version.id], others: [] }, g.inst.id);
  assert.deepEqual(titles(p2.missing), ['Beta']);
  assert.deepEqual([p2.other.length, p2.off.length], [0, 0]);
});

test('сверка: чужие (не с Modrinth) моды хозяина узнаются по отпечатку, а файл с тем же именем, но другим содержимым, — отдельное замечание', async (t) => {
  const s = scene(t);
  s.jar('own.jar', 'другое содержимое');
  const plan = await s.modcode.compare({ ...HOST, ids: [], others: [{ name: 'own.jar', hash: sha1(s.own).slice(0, 16) }, { name: 'tools.jar', hash: sha1('tools').slice(0, 16) }] }, s.inst.id);
  assert.deepEqual(plan.manual, [{ name: 'own.jar', why: 'differs' }, { name: 'tools.jar', why: 'other' }]);
  assert.deepEqual(plan.extra.map((x) => x.file), ['own.jar'], 'у гостя другой own.jar — для сверки он лишний');
  assert.equal(plan.todo, 0, 'поставить такое лаунчер не может: нужен файл от друга');
  // тот же файл, но выключен, — «включить»
  const g = s.more();
  g.jar('own.jar.disabled', s.own);
  const p2 = await s.modcode.compare({ ...HOST, ids: [], others: [{ name: 'own.jar', hash: sha1(s.own).slice(0, 16) }] }, g.inst.id);
  assert.deepEqual(p2.off, [{ title: 'own.jar', file: 'own.jar', version: null }]);
});

test('сверка: другая версия игры или загрузчик — об этом сказано в первую очередь; Quilt на Fabric-модах — не помеха; версия загрузчика — только сведение', async (t) => {
  const s = scene(t);
  const mismatch = async (guest, payload = s.payload) => (await s.modcode.compare(payload, s.more(guest).inst.id)).mismatch;
  assert.deepEqual(await mismatch({ version: '1.21.1' }), { version: true, loader: false, loaderVersion: false });
  assert.deepEqual(await mismatch({ loader: 'forge' }), { version: false, loader: true, loaderVersion: false });
  assert.deepEqual(await mismatch({ loader: 'quilt' }), { version: false, loader: false, loaderVersion: false }, 'Quilt запускает моды Fabric');
  assert.equal((await mismatch({ loader: 'fabric' }, { ...s.payload, loader: 'quilt' })).loader, true, 'а Fabric моды Quilt не запускает');
  assert.equal((await mismatch({ loader: 'vanilla' })).loader, true);
  const other = s.more();
  s.instances.touch(other.inst.id, { loaderVersion: '0.16.0' });
  assert.deepEqual((await s.modcode.compare(s.payload, other.inst.id)).mismatch, { version: false, loader: false, loaderVersion: true });
});

test('сверка: без сборки гостя (новая сборка по коду) все моды «нет», сверять с чем-то не нужно; нет связи — ошибка', async (t) => {
  const s = scene(t);
  const plan = await s.modcode.compare(s.payload, null);
  assert.equal(plan.mine, null);
  assert.deepEqual(plan.mismatch, { version: false, loader: false, loaderVersion: false });
  assert.deepEqual(titles(plan.missing), ['Alpha', 'Beta', 'Delta', 'Gamma']);
  assert.equal(plan.todo, 4);
  assert.deepEqual(plan.manual.map((x) => x.why).sort(), ['gone', 'other']);
  s.mr.state.failLookup = true;
  s.jar(s.alpha.file, s.alpha.bytes);
  await assert.rejects(() => s.modcode.compare(s.payload, s.inst.id), /Нет связи с Modrinth/);
});

// ---------- гость: установка ----------

const options = () => {
  const points = [];
  const labels = [];
  return { points, labels, progress: (label) => labels.push(label), point: (id, reason) => points.push([id, reason]) };
};

test('установка: недостающее скачано с проверкой хэша, другая версия заменена, выключенное включено, лишнее не тронуто; сведения о модах записаны', async (t) => {
  const s = scene(t);
  s.guestWithMods();
  const o = options();
  const r = await s.modcode.apply(s.inst.id, s.payload, o);
  assert.deepEqual(r.installed, ['Delta']);
  assert.deepEqual(r.replaced, [{ title: 'Beta', from: '0.9', to: '1.0' }]);
  assert.deepEqual(r.enabled, ['Gamma']);
  assert.deepEqual(r.failed, []);
  assert.deepEqual(r.manual, [{ name: s.gone.version.id, why: 'gone' }]);
  assert.deepEqual(s.ls(), ['alpha-1.0.jar', 'beta-1.0.jar', 'custom.jar', 'delta-2.0.jar', 'gamma-1.0.jar', 'own.jar', 'zeta-1.0.jar'], 'Beta заменена, Gamma включена, Zeta и custom.jar на месте, недокачанных файлов нет');
  assert.equal(fs.readFileSync(path.join(s.g, 'mods', 'delta-2.0.jar'), 'utf8'), 'jar:delta:2.0');
  assert.equal(fs.readFileSync(path.join(s.g, 'mods', 'beta-1.0.jar'), 'utf8'), 'jar:beta:1.0');
  const meta = s.mods.readMeta(s.inst.id);
  assert.deepEqual(meta['delta-2.0.jar'], { source: 'modrinth', projectId: s.delta.project.id, title: 'Delta', icon: s.delta.project.icon_url, version: '2.0' });
  assert.equal(meta['beta-1.0.jar'].version, '1.0');
  assert.equal(meta['beta-0.9.jar'], undefined, 'запись о старой версии ушла вместе с файлом');
  assert.deepEqual(o.points, [[s.inst.id, 'Перед установкой модов друга']], 'точка восстановления сохранена один раз, до первой правки');
  assert.ok(o.labels.some((l) => /Delta/.test(l)));
  // после установки сверка чистая
  const again = await s.modcode.compare(s.payload, s.inst.id);
  assert.equal(again.todo, 0);
  assert.deepEqual(again.missing.concat(again.other, again.off), []);
});

test('установка: когда делать нечего — ни точки восстановления, ни скачиваний; выключенная копия нужной версии заменяется включённой, дубля не остаётся', async (t) => {
  const s = scene(t);
  s.jar(s.alpha.file, s.alpha.bytes);
  const o = options();
  const r = await s.modcode.apply(s.inst.id, { ...HOST, ids: [s.alpha.version.id], others: [] }, o);
  assert.deepEqual([r.installed, r.replaced, r.enabled, r.failed], [[], [], [], []]);
  assert.deepEqual(o.points, []);
  assert.ok(!s.mr.calls.some((c) => /cdn\./.test(c.url)));
  // включена другая версия, а нужная лежит выключенной: ставится нужная, выключенная копия уходит, другая версия заменена
  const g = s.more();
  g.jar(s.beta0.file, s.beta0.bytes);
  g.jar(`${s.beta1.file}.disabled`, s.beta1.bytes);
  const r2 = await s.modcode.apply(g.inst.id, { ...HOST, ids: [s.beta1.version.id], others: [] }, options());
  assert.deepEqual(r2.replaced, [{ title: 'Beta', from: '0.9', to: '1.0' }]);
  assert.deepEqual(g.ls(), ['beta-1.0.jar']);
});

test('установка: битый файл (хэш не совпал), недоступный файл и опасное имя из ответа сервера — отдельные ошибки, остальное ставится, лишнего на диске нет', async (t) => {
  const s = scene(t);
  const ev = s.mr.mod('evil', '1.0', { filename: '../../evil.jar' });
  const http = s.mr.mod('plain', '1.0', { url: 'http://cdn.modrinth.com/plain.jar' });
  const noExt = s.mr.mod('noext', '1.0', { filename: 'noext.txt' });
  // имена с путём внутри (а не только с «..» в начале): ни подпапка, ни выход за папку mods, ни обратная черта Windows
  const up = s.mr.mod('traverse', '1.0', { filename: 'a/../../outside.jar' });
  const nested = s.mr.mod('nested', '1.0', { filename: 'sub/nested.jar' });
  const back = s.mr.mod('backslash', '1.0', { filename: 'a\\..\\..\\outside2.jar' });
  s.mr.state.corrupt.add(s.alpha.version.files[0].url);
  s.mr.state.down.add(s.beta1.version.files[0].url);
  const payload = { ...s.payload, ids: [s.alpha, s.beta1, s.delta, ev, http, noExt, up, nested, back].map((x) => x.version.id), others: [] };
  const r = await s.modcode.apply(s.inst.id, payload, options());
  assert.deepEqual(r.installed, ['Delta']);
  assert.equal(r.failed.length, 8);
  const by = Object.fromEntries(r.failed.map((f) => [f.title, f.error]));
  assert.match(by.Alpha, /хэш|повреждён/);
  assert.match(by.Beta, /404|HTTP/);
  assert.match(by.Evil, /Некорректное имя файла/);
  assert.match(by.Plain, /https/);
  assert.match(by.Noext, /Некорректное имя файла/);
  for (const k of ['Traverse', 'Nested', 'Backslash']) assert.match(by[k], /Некорректное имя файла/, k);
  assert.deepEqual(s.ls(), ['delta-2.0.jar'], 'в папке только то, что поставилось целиком');
  for (const f of [path.join(s.g, '..', 'evil.jar'), path.join(s.g, 'evil.jar'), path.join(s.g, 'outside.jar'), path.join(s.g, 'outside2.jar'), path.join(s.g, 'mods', 'sub')]) assert.ok(!fs.existsSync(f), `за папку mods ничего не записано: ${f}`);
});

test('установка: чужой файл с тем же именем не перезаписывается — понятная ошибка, файл на месте', async (t) => {
  const s = setup(t);
  const a = s.mr.mod('alpha', '1.0');
  s.jar(a.file, 'чужой файл с таким же именем');
  const payload = { ...HOST, ids: [a.version.id], others: [] };
  assert.equal((await s.modcode.compare(payload, s.inst.id)).missing.length, 1);
  const r = await s.modcode.apply(s.inst.id, payload, options());
  assert.deepEqual(r.installed, []);
  assert.equal(r.failed.length, 1);
  assert.match(r.failed[0].error, /уже есть/);
  assert.equal(fs.readFileSync(path.join(s.g, 'mods', a.file), 'utf8'), 'чужой файл с таким же именем');
  // то же с выключенным чужим файлом
  const g = s.more();
  g.jar(`${a.file}.disabled`, 'чужой выключенный');
  const r2 = await s.modcode.apply(g.inst.id, payload, options());
  assert.match(r2.failed[0].error, /уже есть/);
  assert.deepEqual(g.ls(), [`${a.file}.disabled`]);
});

test('установка: другая версия игры или загрузчик — отказ до любых правок; нет связи — ошибка и сборка не тронута', async (t) => {
  const s = scene(t);
  const wrong = s.more({ version: '1.21.1' });
  s.guestWithMods(wrong);
  const before = wrong.ls();
  const o = options();
  await assert.rejects(() => s.modcode.apply(wrong.inst.id, s.payload, o), /другая версия игры|другой загрузчик|не подходят/);
  assert.deepEqual(wrong.ls(), before);
  assert.deepEqual(o.points, []);
  s.guestWithMods();
  s.mr.state.failLookup = true;
  await assert.rejects(() => s.modcode.apply(s.inst.id, s.payload, options()), /Нет связи с Modrinth/);
});

// ---------- гость: от вставленного текста до сборки ----------

test('проверка вставленного текста: адрес и сверка, только адрес, обрезанный код, мусор — окну всегда приходит понятный ответ', async (t) => {
  const s = scene(t);
  s.guestWithMods();
  const code = s.modcode.pack(s.payload);
  const full = await s.modcode.check(s.inst.id, `Заходи: pink.e4mc.link\nКод сборки: ${code}`);
  assert.equal(full.address, 'pink.e4mc.link');
  assert.equal(full.problem, null);
  assert.equal(full.plan.todo, 3);
  const onlyAddr = await s.modcode.check(s.inst.id, 'pink.e4mc.link');
  assert.deepEqual([onlyAddr.address, onlyAddr.plan, onlyAddr.problem], ['pink.e4mc.link', null, null], 'без кода — просто зайти по адресу');
  const cut = await s.modcode.check(s.inst.id, `pink.e4mc.link ${code.slice(0, code.length - 15)}`);
  assert.equal(cut.address, 'pink.e4mc.link');
  assert.equal(cut.plan, null);
  assert.equal(cut.problem.code, 'truncated');
  assert.match(cut.problem.message, /не хватает 15/);
  const n = Number(code.split(':')[1]);
  assert.equal((await s.modcode.check(s.inst.id, `FLM1:${n}:${'A'.repeat(n)}`)).problem.code, 'corrupt');
  const junk = await s.modcode.check(s.inst.id, 'ничего полезного');
  assert.deepEqual([junk.address, junk.plan, junk.problem.code], [null, null, 'empty']);
  assert.equal(junk.problem.message, 'В тексте нет ни адреса, ни кода сборки');
  assert.equal((await s.modcode.check(null, `x.e4mc.link ${code}`)).plan.mine, null, 'сборку ещё не выбрали — сверка с пустой');
});

test('«новая сборка как у друга»: создаётся сборка с версией игры и загрузчиком хозяина и ставятся все его моды; имя не повторяется', async (t) => {
  const s = scene(t, { name: 'Старая' });
  const o = options();
  const code = s.modcode.pack(s.payload);
  const r = await s.modcode.join('new', `x.e4mc.link ${code}`, o);
  assert.equal(r.instance.name, 'Сборка друга');
  assert.deepEqual([r.instance.version, r.instance.loader, r.instance.loaderVersion], ['1.20.1', 'fabric', '0.15.0']);
  assert.deepEqual(r.installed.sort(), ['Alpha', 'Beta', 'Delta', 'Gamma']);
  assert.deepEqual(fs.readdirSync(path.join(s.instances.gameDir(r.instance.id), 'mods')).sort(), ['alpha-1.0.jar', 'beta-1.0.jar', 'delta-2.0.jar', 'gamma-1.0.jar']);
  assert.deepEqual(o.points, [], 'сборка новая — точку восстановления делать не с чего');
  const second = await s.modcode.join('new', code, options());
  assert.equal(second.instance.name, 'Сборка друга 2');
  assert.equal(s.instances.list().length, 3);
  const english = await s.modcode.join('new', code, { ...options(), name: 'Friend’s pack' });
  assert.equal(english.instance.name, 'Friend’s pack', 'название берётся на языке окна');
});

test('«новая сборка как у друга»: отдельные ошибки загрузки не мешают сборке появиться; без кода — отказ', async (t) => {
  const s = scene(t);
  const code = s.modcode.pack(s.payload);
  const before = s.instances.list().length;
  s.mr.state.down.add(s.alpha.version.files[0].url);
  const r = await s.modcode.join('new', code, options());
  assert.equal(r.failed.length, 1);
  assert.equal(s.instances.list().length, before + 1, 'один мод не скачался, но остальные в сборке есть');
  await assert.rejects(() => s.modcode.join('new', 'просто адрес x.e4mc.link', options()), /нет кода сборки/);
  await assert.rejects(() => s.modcode.join(s.inst.id, 'просто адрес x.e4mc.link', options()), /нет кода сборки/);
  assert.equal(s.instances.list().length, before + 1);
});

test('«новая сборка как у друга»: нет связи с Modrinth — ничего не создаётся; отмена посреди установки убирает созданную сборку', async (t) => {
  const s = scene(t);
  const code = s.modcode.pack({ ...s.payload, ids: [s.alpha.version.id] }); // один мод: отмену видно по ошибке самой установки, а не по соседней очереди
  const before = s.instances.list().length;
  s.mr.state.failVersions = true;
  await assert.rejects(() => s.modcode.join('new', code, options()), /Нет связи с Modrinth/);
  assert.equal(s.instances.list().length, before, 'сборка не создавалась: сначала сверка, потом создание');
  s.mr.state.failVersions = false;
  // «Отменить» нажали, когда установка уже пошла: созданная ради неё сборка убирается
  const net = s.p.load('core/net');
  const token = net.cancelToken();
  const o = options();
  o.progress = () => token.cancel();
  await assert.rejects(() => net.runCancellable(token, () => s.modcode.join('new', code, o)), (e) => e.cancelled === true);
  assert.equal(s.instances.list().length, before, 'отменили — пустой сборки не осталось');
});

test('установка в существующую сборку по вставленному тексту: то же, что apply, плюс точка восстановления', async (t) => {
  const s = scene(t);
  s.guestWithMods();
  const o = options();
  const r = await s.modcode.join(s.inst.id, `x.e4mc.link ${s.modcode.pack(s.payload)}`, o);
  assert.deepEqual(r.installed, ['Delta']);
  assert.equal(o.points.length, 1);
  assert.equal(r.instance.id, s.inst.id);
});

// ---------- «следовать за сборкой друга» ----------

test('следование: моды, которых у друга нет, отключаются (не удаляются), точка восстановления одна и до правок, сборка запоминает, что следует за другом', async (t) => {
  const s = scene(t);
  s.guestWithMods();
  const o = options();
  const r = await s.modcode.apply(s.inst.id, s.payload, { ...o, follow: true });
  assert.deepEqual(r.disabled, ['custom.jar', 'Zeta']);
  assert.deepEqual(r.installed, ['Delta']);
  assert.deepEqual(s.ls(), ['alpha-1.0.jar', 'beta-1.0.jar', 'custom.jar.disabled', 'delta-2.0.jar', 'gamma-1.0.jar', 'own.jar', 'zeta-1.0.jar.disabled'], 'лишние выключены, файлы целы');
  assert.deepEqual(o.points, [[s.inst.id, 'Перед установкой модов друга']]);
  const follow = s.instances.get(s.inst.id).follow;
  assert.equal(follow.mods, 6, 'пять модов Modrinth и один свой у хозяина');
  assert.ok(Math.abs(follow.at - Date.now()) < 60000);
  const again = await s.modcode.compare(s.payload, s.inst.id);
  assert.deepEqual([again.todo, again.extra], [0, []], 'после следования лишних нет');
});

test('следование: даже когда ставить нечего, лишние моды отключаются (точка восстановления перед этим); без следования лишнее не тронуто и отметки нет', async (t) => {
  const s = scene(t);
  s.guestWithMods();
  await s.modcode.apply(s.inst.id, s.payload, options()); // обычная установка
  assert.equal(s.instances.get(s.inst.id).follow, undefined);
  assert.ok(s.ls().includes('zeta-1.0.jar'));
  const o = options();
  const r = await s.modcode.apply(s.inst.id, s.payload, { ...o, follow: true });
  assert.deepEqual([r.installed, r.replaced, r.enabled, r.disabled], [[], [], [], ['custom.jar', 'Zeta']]);
  assert.equal(o.points.length, 1);
  const calm = options();
  const none = await s.modcode.apply(s.inst.id, s.payload, { ...calm, follow: true });
  assert.deepEqual(none.disabled, [], 'второй раз делать нечего');
  assert.equal(calm.points.length, 0, 'и точку не сохраняем');
});

test('следование: новая сборка «как у друга» сразу помечается; отметка проверяется при записи в файл сборки', async (t) => {
  const s = scene(t);
  const r = await s.modcode.join('new', s.modcode.pack(s.payload), { ...options(), follow: true });
  assert.equal(r.instance.follow.mods, 6);
  assert.equal((await s.modcode.join('new', s.modcode.pack(s.payload), options())).instance.follow, undefined);
  for (const bad of [{ at: 'x', mods: 1 }, { at: 1, mods: -1 }, { at: 1, mods: 1.5 }, 5, 'да']) assert.equal(s.instances.update(r.instance.id, { follow: bad }).follow, null, JSON.stringify(bad));
  assert.deepEqual(Object.keys(s.instances.update(r.instance.id, { follow: { at: 5.7, mods: 3, лишнее: 1 } }).follow), ['at', 'mods']);
});

test('следование: окно (галочка, подписи, отметка на карточке, ответ с «отключено») и главный процесс связаны', () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
  assert.match(read('main.js'), /handle\('instances:joinInstall', \(id, text, opts\) =>[\s\S]*?follow: !!opts\?\.follow/);
  const join = read('renderer/app/join.js');
  assert.match(join, /call\('instances:joinInstall', id, el\('#jnText'\)\.value, \{ follow: follows \}\)/);
  assert.match(join, /target\(\) === 'new' \|\| !!instOf\(target\(\)\)\?\.follow/, 'галочка включена для новой и уже следующей сборки');
  assert.match(read('renderer/app/home.js'), /else if \(act === 'follow'\) openJoinModal\(inst\)/);
  assert.match(read('renderer/app/home.js'), /\$\{readyStat\(info\)\}\$\{followStat\(inst\)\}/);
});

test('следование: если один лишний мод отключить не вышло, он назван в «не вышло», остальные отключены, отметка ставится', async (t) => {
  const s = scene(t);
  s.guestWithMods();
  const real = s.mods.setEnabled;
  s.mods.setEnabled = (id, file, on) => {
    if (file === 'zeta-1.0.jar') throw new Error('файл занят');
    return real(id, file, on);
  };
  t.after(() => (s.mods.setEnabled = real));
  const r = await s.modcode.apply(s.inst.id, s.payload, { ...options(), follow: true });
  assert.deepEqual(r.disabled, ['custom.jar']);
  assert.deepEqual(r.failed, [{ title: 'Zeta', error: 'файл занят' }]);
  assert.ok(s.ls().includes('zeta-1.0.jar') && s.ls().includes('custom.jar.disabled'));
  assert.ok(s.instances.get(s.inst.id).follow);
});
