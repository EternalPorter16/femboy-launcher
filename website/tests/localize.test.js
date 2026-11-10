import test from 'node:test';
import assert from 'node:assert/strict';
import { englishText, localizeHtml } from '../src/lib/localize.js';

test('English dates, sizes and version labels stay correct for future releases', () => {
  assert.equal(englishText('9 ноября 2026'), '9 November 2026');
  assert.equal(englishText(', 73,5 МБ'), ', 73.5 MB');
  assert.equal(englishText('Версия 0.11.0'), 'Version 0.11.0');
  assert.equal(englishText('Что нового в 0.11.0'), 'What’s new in 0.11.0');
  assert.match(englishText('Версия лаунчера: 0.11.0 Windows и разрядность: Установщик или Portable: Что нажал перед ошибкой: Точный текст ошибки: Что уже попробовал:'), /^Launcher version: 0.11.0\nWindows/);
});
test('English pages localize text and internal destinations without changing downloads, scripts or language links', () => {
  const source = '<!doctype html><html lang="ru"><head><title>Возможности</title></head><body><a href="/guides/setup-or-portable/#start">Как начать</a><a href="/" data-language-link="ru">RU</a><a href="https://downloads.femboylauncher.ru/file.exe" referrerpolicy="no-referrer">Скачать</a><script>const label="Скачать";</script></body></html>';
  const html = localizeHtml(source);
  assert.match(html, /lang="en"/);
  assert.match(html, /<title>Features<\/title>/);
  assert.match(html, /href="\/en\/guides\/setup-or-portable\/#start"/);
  assert.match(html, /href="\/" data-language-link="ru"/);
  assert.match(html, /href="https:\/\/downloads.femboylauncher.ru\/file.exe" referrerpolicy="no-referrer"/);
  assert.match(html, /const label="Скачать"/);
  const subfolder = localizeHtml(source.replaceAll('href="/', 'href="/launcher/'), '/launcher/');
  assert.match(subfolder, /href="\/launcher\/en\/guides\/setup-or-portable\/#start"/);
});
test('untranslated copy stops English output instead of silently mixing languages', () => {
  assert.throws(() => englishText('Новый текст без перевода'), /Missing English/);
});
