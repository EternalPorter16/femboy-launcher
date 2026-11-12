// Восстановление мира: пределы распаковки и место на диске проверяются по заголовкам до записи (не настоящие «бомбы», только подделанные заголовки)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const AdmZip = require('adm-zip');
const { profile } = require('./helpers');

const FILE = 'World-2026-01-01-00-00-00.zip';
function setup(t, entries) {
  const p = profile(); t.after(() => p.done());
  const instances = p.load('core/instances'), worlds = p.load('core/worlds');
  const inst = instances.create({ name: 'W', version: '1.20.1' });
  const saves = path.join(instances.gameDir(inst.id), 'saves');
  fs.mkdirSync(path.join(saves, 'Original'), { recursive: true });
  fs.writeFileSync(path.join(saves, 'Original', 'level.dat'), 'ORIG');
  const dir = path.join(instances.dirOf(inst.id), 'backups'); fs.mkdirSync(dir, { recursive: true });
  const z = new AdmZip();
  for (const [name, text] of Object.entries(entries || { 'World/level.dat': 'LEVEL', 'World/region/r.0.0.mca': 'REGION'.repeat(100) })) z.addFile(name, Buffer.from(text));
  const file = path.join(dir, FILE);
  return { p, worlds, id: inst.id, saves, file, zip: z, write: () => z.writeZip(file), patch(fn) { // правка центрального каталога: fn(buffer, смещение записи, номер)
    z.writeZip(file); const b = fs.readFileSync(file); let n = 0;
    for (let i = b.length - 22; i >= 0; i--) if (b.readUInt32LE(i) === 0x06054b50) { let o = b.readUInt32LE(i + 16); for (let k = 0; k < b.readUInt16LE(i + 10); k++) { fn(b, o, n++); o += 46 + b.readUInt16LE(o + 28) + b.readUInt16LE(o + 30) + b.readUInt16LE(o + 32); } break; }
    fs.writeFileSync(file, b); } };
}
const work = (f) => path.join(f.p.load('core/instances').gameDir(f.id), '.cache', '.world-restore');
function assertClean(f, before) {
  assert.deepEqual(fs.readdirSync(f.saves), ['Original']);
  assert.equal(fs.readFileSync(path.join(f.saves, 'Original', 'level.dat'), 'utf8'), 'ORIG');
  assert.deepEqual(fs.readFileSync(f.file), before);
  assert.equal(fs.existsSync(work(f)) ? fs.readdirSync(work(f)).length : 0, 0, 'временная папка восстановления осталась');
}

test('обычный мир восстанавливается как раньше', (t) => {
  const f = setup(t); f.write();
  const name = f.worlds.restore(f.id, FILE);
  assert.match(name, /^World \(копия от /);
  assert.equal(fs.readFileSync(path.join(f.saves, name, 'level.dat'), 'utf8'), 'LEVEL');
  assert.ok(fs.existsSync(path.join(f.saves, name, 'region', 'r.0.0.mca')));
  assert.equal(fs.readdirSync(work(f)).length, 0);
});

const cases = {
  'шифрование': [(b, o) => b.writeUInt16LE(b.readUInt16LE(o + 8) | 1, o + 8), /зашифрован/],
  'неизвестный метод сжатия': [(b, o) => b.writeUInt16LE(99, o + 10), /неподдерживаем/],
  'размер записи выше предела': [(b, o, n) => { if (n === 1) b.writeUInt32LE(0xFFFFFFFF, o + 24); }, /превышает допустимый размер/],
  'сумма выше предела': [(b, o) => b.writeUInt32LE(0x7FFFFFFF, o + 24), /превышает допустимый размер после распаковки/],
  'размер 0 при непустом потоке': [(b, o) => b.writeUInt32LE(0, o + 24), /некорректный размер/],
};
for (const [label, [fn, re]] of Object.entries(cases)) {
  test(`восстановление отклоняет копию: ${label}`, (t) => {
    const entries = { 'World/level.dat': 'LEVEL'.repeat(50), 'World/a': 'x'.repeat(500), 'World/b': 'y'.repeat(500) };
    for (let i = 0; i < 16; i++) entries[`World/f${i}`] = 'z'.repeat(300);
    const f = setup(t, entries);
    // для «размера 0» поток должен быть сжатым и непустым
    f.patch(fn);
    const before = fs.readFileSync(f.file);
    assert.throws(() => f.worlds.restore(f.id, FILE), re);
    assertClean(f, before);
  });
}

test('восстановление отклоняет копию, если на диске не хватит места, до записи', (t) => {
  const f = setup(t, { 'World/level.dat': 'LEVEL'.repeat(50) });
  f.patch((b, o) => b.writeUInt32LE(1024 * 1048576, o + 24)); // заголовок обещает 1 ГБ
  const before = fs.readFileSync(f.file);
  const real = fs.statfsSync;
  fs.statfsSync = () => ({ bavail: 100, bsize: 1048576 }); // свободно 100 МБ
  t.after(() => { fs.statfsSync = real; });
  assert.throws(() => f.worlds.restore(f.id, FILE), /не хватает места/);
  assertClean(f, before);
});

test('пределы можно сузить: слишком много записей', (t) => {
  const archive = require('../src/core/archive');
  const z = new AdmZip(); for (let i = 0; i < 5; i++) z.addFile(`W/${i}`, Buffer.from('a'));
  assert.throws(() => archive.inspect(z, { ...archive.WORLD_LIMITS, entries: 3 }), /слишком много файлов/);
  assert.ok(archive.inspect(z, archive.WORLD_LIMITS));
});
