const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makePng, src } = require('./helpers');
const imagesave = require('../src/core/imagesave');

const png = makePng(8, 6);
const b64 = png.toString('base64');
const URL = `data:image/png;base64,${b64}`;
const tmp = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'femboy-img-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const refuses = (data, re) => assert.throws(() => imagesave.decodePng(data), re, String(data).slice(0, 40));

test('настоящий PNG принимается и как data-URL холста, и как голый base64', () => {
  assert.ok(imagesave.decodePng(URL).equals(png));
  assert.ok(imagesave.decodePng(b64).equals(png));
  assert.ok(imagesave.decodePng(`DATA:IMAGE/PNG;BASE64,${b64}`).equals(png), 'регистр заголовка не важен');
});

test('всё остальное отвергается: не строка, пусто, другой формат, не base64, обрезанный или раздутый файл', () => {
  for (const bad of [undefined, null, 5, {}, [], '', 'data:image/png;base64,']) refuses(bad, /не получена/);
  refuses(`data:image/jpeg;base64,${b64}`, /не PNG|не получена/);
  refuses(`${b64}!`, /не получена/);
  refuses(`${b64}\n`, /не получена/);
  refuses(b64.slice(0, -1), /не получена/);
  // длина кратна четырём, но знаки не из base64: Buffer.from такие молча пропускает, поэтому их ловит только проверка алфавита
  refuses(`${b64.slice(0, -4)}%%%%`, /не получена/);
  refuses(`${b64.slice(0, 8)}!!!!${b64.slice(12)}`, /не получена/);
  refuses(`${b64.slice(0, 8)} ${b64.slice(8, -1)}`.padEnd(b64.length, 'A'), /не получена/);
  refuses(Buffer.from('просто текст, а не картинка').toString('base64'), /не PNG/);
  refuses(Buffer.concat([Buffer.from('ffd8ffe000104a464946', 'hex'), Buffer.alloc(80)]).toString('base64'), /не PNG/);
  refuses(png.subarray(0, png.length - 12).toString('base64'), /не PNG/);
  refuses(png.subarray(0, 40).toString('base64'), /не PNG/);
  refuses(Buffer.concat([png, Buffer.from('хвост')]).toString('base64'), /не PNG/);
  refuses(Buffer.concat([Buffer.from('x'), png]).toString('base64'), /не PNG/);
  const sized = (bytes) => Buffer.concat([png.subarray(0, 8), Buffer.alloc(bytes - 20), png.subarray(png.length - 12)]);
  refuses(sized(imagesave.MAX_BYTES + 1).toString('base64'), /слишком большая/);
  refuses(sized(imagesave.MAX_BYTES + 2000).toString('base64'), /слишком большая/);
  refuses('A'.repeat(Math.ceil(imagesave.MAX_BYTES / 3) * 4 + 4), /слишком большая/);
});

test('обычная картинка итогов проходит: предел размера не меньше 8 МБ, и пять мегабайт — не помеха', () => {
  assert.ok(imagesave.MAX_BYTES >= 8 * 1024 * 1024);
  const five = Buffer.concat([png.subarray(0, 8), Buffer.alloc(5 * 1024 * 1024), png.subarray(png.length - 12)]);
  assert.equal(imagesave.decodePng(five.toString('base64')).length, five.length);
});

test('граница размера: ровно 16 МБ ещё картинка, на байт больше — уже нет', () => {
  const exact = Buffer.concat([png.subarray(0, 8), Buffer.alloc(imagesave.MAX_BYTES - 20), png.subarray(png.length - 12)]);
  assert.equal(exact.length, imagesave.MAX_BYTES);
  assert.equal(imagesave.decodePng(exact.toString('base64')).length, imagesave.MAX_BYTES);
});

test('сохранение: спрашивает место с готовым именем, пишет проверенные байты, добавляет .png; отмена ничего не пишет', async (t) => {
  const dir = tmp(t);
  const asked = [];
  const pickTo = (target) => async (name) => (asked.push(name), target);
  const a = await imagesave.save(URL, { name: 'Итоги недели 2026-10-29.png', pick: pickTo(path.join(dir, 'a')) });
  assert.equal(a, path.join(dir, 'a.png'));
  assert.ok(fs.readFileSync(a).equals(png));
  const b = await imagesave.save(URL, { name: 'x.png', pick: pickTo(path.join(dir, 'B.PNG')) });
  assert.equal(b, path.join(dir, 'B.PNG'), 'расширение в любом регистре оставляем как есть');
  assert.deepEqual(asked, ['Итоги недели 2026-10-29.png', 'x.png']);
  assert.equal(await imagesave.save(URL, { name: 'x.png', pick: async () => null }), null, 'закрыли окно выбора места');
  assert.equal(await imagesave.save(URL, { name: 'x.png', pick: async () => '' }), null);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['B.PNG', 'a.png'], 'отмена файлов не оставила');
});

test('сохранение поверх старого файла заменяет его целиком и не оставляет временных файлов', async (t) => {
  const dir = tmp(t);
  const target = path.join(dir, 'recap.png');
  fs.writeFileSync(target, 'старое содержимое, которое длиннее новой картинки'.repeat(500));
  assert.equal(await imagesave.save(URL, { name: 'n', pick: async () => target }), target);
  assert.ok(fs.readFileSync(target).equals(png));
  assert.deepEqual(fs.readdirSync(dir), ['recap.png']);
});

test('негодная картинка отвергается ДО окна выбора места; ошибка записи называется понятно', async (t) => {
  let asked = 0;
  const pick = async () => (asked++, path.join(os.tmpdir(), 'никогда.png'));
  await assert.rejects(() => imagesave.save('data:image/png;base64,AAAA', { name: 'n', pick }), /не PNG/);
  await assert.rejects(() => imagesave.save(undefined, { name: 'n', pick }), /не получена/);
  assert.equal(asked, 0, 'человек не должен выбирать место для файла, который всё равно не сохранится');
  const dir = tmp(t);
  const blocker = path.join(dir, 'файл');
  fs.writeFileSync(blocker, 'я файл, а не папка');
  await assert.rejects(() => imagesave.save(URL, { name: 'n', pick: async () => path.join(blocker, 'внутри.png') }), /^Error: Не удалось сохранить картинку: /);
  await assert.rejects(() => imagesave.save(URL, { name: 'n', pick: async () => { throw new Error('окно не открылось'); } }), /окно не открылось/);
});

test('main.js: в файл и в буфер обмена идёт только то, что прошло проверку decodePng, а диалог открывается из main', () => {
  const main = fs.readFileSync(src('main.js'), 'utf8');
  assert.match(main, /handle\('app:copyImage'[^;]*imagesave\.decodePng\(/, 'копирование');
  assert.match(main, /handle\('app:saveImage'[\s\S]*?imagesave\.save\([\s\S]*?showSaveDialog/, 'сохранение');
  assert.match(main, /handle\('game:recap'[^\n]*recap\.card\(/, 'данные итогов');
  const line = main.split('\n').find((l) => l.includes("handle('game:recap'"));
  assert.match(line, /period/, 'срок передаётся');
  assert.match(line, /lang: opts\?\.lang/, 'язык передаётся');
  assert.match(line, /hideNames: !!opts\?\.hideNames/, 'скрытие названий передаётся');
  assert.match(line, /names: new Map\(instances\.list\(\)\.map\(\(i\) => \[i\.id, i\.name\]\)\)/, 'имена сборок подставляются по коду');
  assert.match(main, /handle\('app:saveImage'[\s\S]*?name: recap\.fileName\(opts\?\.period, opts\?\.lang\)/, 'имя файла берётся из срока и языка');
  const preload = fs.readFileSync(src('preload.js'), 'utf8');
  assert.doesNotMatch(preload, /clipboard|writeImage|showSaveDialog/, 'окну эти возможности напрямую не даём');
});
