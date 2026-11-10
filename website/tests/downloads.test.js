// Проверки конфига скачивания: node --test tests/ (входит в npm run build, сборка остановится на ошибке)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveDownloads, parseDate, formatSize, safeUrl } from '../src/lib/downloads.js';

const real = JSON.parse(readFileSync(new URL('../src/config/downloads.json', import.meta.url), 'utf8'));
const base = () => {
  const c = structuredClone(real);
  c.storage.fileUrlTemplate = '';
  c.files.setup.url = '';
  c.files.portable.url = '';
  return c;
};

test('настоящий конфиг разбирается без предупреждений', () => {
  const d = resolveDownloads(real);
  assert.deepEqual(d.warnings, []);
  assert.ok(d.version);
  assert.ok(d.date, 'дата выпуска указана и верна');
  for (const o of d.options) {
    assert.ok(o.href, `у ${o.id} есть куда вести`);
    assert.match(o.href, /^https:\/\//);
    assert.ok(o.fileName.includes(d.version), `имя файла ${o.id} содержит версию`);
  }
});

test('в настоящем конфиге нет GitHub и локальных путей', () => {
  const text = JSON.stringify(real);
  assert.doesNotMatch(text, /github/i);
  assert.doesNotMatch(text, /[a-z]:\\\\|\\\\Users\\\\|file:/i);
});

test('без прямых адресов кнопки ведут в папку и не называются прямыми', () => {
  const c = base();
  c.files.setup.url = '';
  c.files.portable.url = '';
  c.storage.fileUrlTemplate = '';
  const d = resolveDownloads(c);
  assert.equal(d.mode, 'folder');
  for (const o of d.options) {
    assert.equal(o.direct, false);
    assert.equal(o.href, d.storage.folderUrl);
  }
});

test('шаблон адреса подставляет имя файла и версию', () => {
  const c = base();
  c.release.version = '1.2.3';
  c.storage.fileUrlTemplate = 'https://files.example.org/fl/{version}/{fileName}';
  const d = resolveDownloads(c);
  assert.equal(d.mode, 'direct');
  assert.equal(d.options[0].href, 'https://files.example.org/fl/1.2.3/FemboyLauncher-Setup-1.2.3.exe');
  assert.equal(d.options[1].fileName, 'FemboyLauncher-Portable-1.2.3.exe');
});

test('прямой адрес файла важнее шаблона', () => {
  const c = base();
  c.storage.fileUrlTemplate = 'https://a.example.org/{fileName}';
  c.files.portable.url = 'https://b.example.org/p.exe';
  const d = resolveDownloads(c);
  assert.equal(d.options[1].href, 'https://b.example.org/p.exe');
  assert.match(d.options[0].href, /^https:\/\/a\.example\.org\//);
});

test('только один прямой адрес: смешанный режим', () => {
  const c = base();
  c.files.setup.url = 'https://b.example.org/s.exe';
  assert.equal(resolveDownloads(c).mode, 'mixed');
});

test('небезопасные и кривые значения не попадают на страницу', () => {
  const c = base();
  c.files.setup.url = 'http://insecure.example.org/s.exe';
  c.files.portable.url = 'javascript:alert(1)';
  c.files.setup.sha256 = 'abc';
  c.files.portable.sizeBytes = -5;
  c.release.date = '2026-02-30';
  const d = resolveDownloads(c);
  assert.equal(d.options[0].direct, false);
  assert.equal(d.options[1].direct, false);
  assert.equal(d.options[0].sha256, null);
  assert.equal(d.options[1].size, null);
  assert.equal(d.date, null);
  assert.ok(d.warnings.length >= 4);
});

test('пустой конфиг не ломает разбор', () => {
  for (const c of [undefined, null, {}, { files: [] }, { release: 'x' }]) {
    const d = resolveDownloads(c);
    assert.equal(d.mode, 'none');
    assert.equal(d.version, null);
    for (const o of d.options) {
      assert.equal(o.href, null);
      assert.equal(o.fileName, null);
    }
  }
});

test('без версии имя файла с {version} не выдумывается', () => {
  const c = base();
  delete c.release.version;
  const d = resolveDownloads(c);
  assert.equal(d.options[0].fileName, null);
});

test('мелкие помощники', () => {
  assert.deepEqual(parseDate('2026-11-03'), { iso: '2026-11-03', label: '3 ноября 2026' });
  assert.equal(parseDate('03.11.2026'), null);
  assert.equal(formatSize(77115168), '73,5 МБ');
  assert.equal(formatSize(0), null);
  assert.equal(safeUrl('ftp://x'), null);
  assert.equal(resolveDownloads({ storage: { label: 'S3' } }).storage.where, 'в хранилище «S3»');
});

