// Inspect untrusted modpack contents before reading a manifest or extracting
// entries. These are application limits, not claims about ZIP parser safety.
const fs = require('fs');
const zlib = require('zlib');
const AdmZip = require('adm-zip');

const LIMITS = Object.freeze({
  archiveBytes: 1024 * 1024 * 1024,
  entries: 10000,
  entryBytes: 256 * 1024 * 1024,
  totalBytes: 2 * 1024 * 1024 * 1024,
  manifestBytes: 8 * 1024 * 1024,
});

// Копии миров бывают куда больше модпаков, поэтому у них свои, более широкие пределы (но те же проверки заголовков)
const WORLD_LIMITS = Object.freeze({
  archiveBytes: 16 * 1024 * 1024 * 1024,
  entries: 200000,
  entryBytes: 2 * 1024 * 1024 * 1024,
  totalBytes: 32 * 1024 * 1024 * 1024,
  manifestBytes: LIMITS.manifestBytes,
  what: 'копии мира',
});

function inspect(zip, limits = LIMITS) {
  const what = limits.what || 'модпаке';
  const entries = zip.getEntries();
  if (entries.length > limits.entries) throw new Error(`В ${what} слишком много файлов`);
  let total = 0;
  for (const entry of entries) {
    const { size, compressedSize, method, encrypted } = entry.header;
    if (!Number.isSafeInteger(size) || size < 0 || !Number.isSafeInteger(compressedSize) || compressedSize < 0) throw new Error('Архив содержит некорректный размер файла');
    if (size > limits.entryBytes || compressedSize > limits.archiveBytes) throw new Error(`Файл в ${what} превышает допустимый размер`);
    total += size;
    if (total > limits.totalBytes) throw new Error(`Содержимое (${what}) превышает допустимый размер после распаковки`);
    if (encrypted || ![0, 8].includes(method)) throw new Error('Архив содержит зашифрованный или неподдерживаемый файл');
    const name = entry.entryName.replace(/\\/g, '/');
    if (/(^|\/)(modrinth\.index\.json|manifest\.json|mmc-pack\.json)$/.test(name) && size > limits.manifestBytes) throw new Error('Описание модпака слишком большое');
    // adm-zip omits maxOutputLength for a declared size of zero. Verify this
    // corner case with a bounded inflate before any library getData call.
    if (!entry.isDirectory && size === 0 && compressedSize > 0 && method === 8) {
      try {
        if (zlib.inflateRawSync(entry.getCompressedData(), { maxOutputLength: 1 }).length !== 0) throw new Error('non-empty');
      } catch { throw new Error('Архив содержит некорректный размер файла'); }
    }
  }
  return zip;
}

function open(file) {
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > LIMITS.archiveBytes) throw new Error('Архив модпака слишком большой или недоступен');
  return inspect(new AdmZip(file));
}

module.exports = { open, inspect, LIMITS, WORLD_LIMITS };
