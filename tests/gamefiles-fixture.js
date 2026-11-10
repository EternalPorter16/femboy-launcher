// Общее для проверок докачки файлов игры (gamefiles.test.js) и «Починить файлы игры» (repair.test.js): поддельный интернет и крошечная «игра»
const path = require('path');
const crypto = require('crypto');
const { profile } = require('./helpers');

const sha1 = (b) => crypto.createHash('sha1').update(b).digest('hex');
const LIBS = {
  'org/example/liba/1.0/liba-1.0.jar': Buffer.from('library A bytes, long enough to be a file'),
  'org/example/libb/2.0/libb-2.0.jar': Buffer.from('library B bytes, a bit different'),
};
const ASSETS = {
  'minecraft/sounds/a.ogg': Buffer.from('sound a data, some more bytes'),
  'minecraft/lang/ru_ru.json': Buffer.from('{"menu.play":"Играть"}'),
  'icons/icon_16x16.png': Buffer.from('png bytes of the 16x16 icon'),
};
const INDEX = Buffer.from(JSON.stringify({ objects: Object.fromEntries(Object.entries(ASSETS).map(([name, b]) => [name, { hash: sha1(b), size: b.length }])) }));
const assetUrl = (b) => `https://resources.download.minecraft.net/${sha1(b).slice(0, 2)}/${sha1(b)}`;
const libUrl = (rel) => `https://libraries.example/${rel}`;
const VANILLA = {
  libraries: Object.entries(LIBS).map(([rel, b]) => ({ name: 'x:y:1', downloads: { artifact: { path: rel, url: libUrl(rel), sha1: sha1(b), size: b.length } } })),
  assetIndex: { id: '17', sha1: sha1(INDEX), size: INDEX.length, url: 'https://piston-meta.example/17.json' },
};

// Подменённый fetch отдаёт файлы из таблицы served (адрес → Buffer) и считает обращения. Ставить до profile(): net.js запоминает fetch при загрузке
function setup(t) {
  const real = globalThis.fetch;
  const net = { online: true, calls: [] };
  const served = new Map([[VANILLA.assetIndex.url, INDEX]]);
  for (const [rel, b] of Object.entries(LIBS)) served.set(libUrl(rel), b);
  for (const b of Object.values(ASSETS)) served.set(assetUrl(b), b);
  globalThis.fetch = async (url) => {
    url = String(url);
    net.calls.push(url);
    if (!net.online) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
    const b = served.get(url);
    return b ? new Response(b, { status: 200, headers: { 'content-length': String(b.length) } }) : new Response('нет', { status: 404 });
  };
  const p = profile();
  t.after(() => {
    globalThis.fetch = real;
    p.done();
  });
  const root = p.store.paths().root;
  const libFile = (rel) => path.join(root, 'libraries', rel);
  const assetFile = (b) => path.join(root, 'assets', 'objects', sha1(b).slice(0, 2), sha1(b));
  return { p, root, net, served, libFile, assetFile };
}

module.exports = { sha1, LIBS, ASSETS, INDEX, VANILLA, assetUrl, libUrl, setup };
