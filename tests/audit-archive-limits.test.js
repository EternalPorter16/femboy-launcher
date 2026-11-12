const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), zlib = require('zlib');
const AdmZip = require('adm-zip');
const archive = require('../src/core/archive');

function entry(size, extra = {}) {
  return { entryName: 'overrides/config/a', isDirectory: false,
    header: { size, compressedSize: 1, method: 8, encrypted: false },
    getData() { throw new Error('must not extract'); }, ...extra };
}
function inspect(entries) { return archive.inspect({ getEntries: () => entries }); }

test('archive budgets reject entries, total expansion and file count before extraction', () => {
  assert.throws(() => inspect([entry(archive.LIMITS.entryBytes + 1)]), /размер/);
  assert.throws(() => inspect(Array.from({ length: 9 }, () => entry(archive.LIMITS.entryBytes))), /после распаковки/);
  assert.throws(() => inspect(Array.from({ length: archive.LIMITS.entries + 1 }, () => entry(1))), /много файлов/);
});
test('archive rejects oversized manifests, encryption and unsupported methods', () => {
  for (const name of ['modrinth.index.json', 'nested/manifest.json', 'mmc-pack.json']) {
    assert.throws(() => inspect([entry(archive.LIMITS.manifestBytes + 1, { entryName: name })]), /Описание/);
  }
  for (const header of [{ size: 1, compressedSize: 1, method: 99 }, { size: 1, compressedSize: 1, method: 8, encrypted: true }]) {
    assert.throws(() => inspect([entry(1, { header })]), /неподдерживаемый/);
  }
});
test('declared zero size cannot bypass bounded decompression', () => {
  const bomb = zlib.deflateRawSync(Buffer.alloc(1024 * 1024, 65));
  assert.throws(() => inspect([entry(0, { getCompressedData: () => bomb })]), /некорректный размер/);
  const empty = zlib.deflateRawSync(Buffer.alloc(0));
  assert.doesNotThrow(() => inspect([entry(0, { getCompressedData: () => empty })]));
});
test('normal ZIP manifest and overrides survive inspection and extraction', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'launcher-archive-limit-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const zip = new AdmZip();
  const manifest = { files: [], dependencies: { minecraft: '1.20.1' } };
  zip.addFile('modrinth.index.json', Buffer.from(JSON.stringify(manifest)));
  zip.addFile('overrides/config/example.txt', Buffer.from('normal content'));
  zip.addFile('overrides/empty.txt', Buffer.alloc(0));
  const file = path.join(dir, 'normal.mrpack'); zip.writeZip(file);
  const checked = archive.open(file);
  assert.deepEqual(JSON.parse(checked.readAsText('modrinth.index.json')), manifest);
  assert.equal(checked.readAsText('overrides/config/example.txt'), 'normal content');
  assert.equal(checked.getEntry('overrides/empty.txt').getData().length, 0);
});
