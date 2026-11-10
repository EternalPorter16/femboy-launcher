import { test } from 'node:test';
import assert from 'node:assert/strict';
import { yandexRequestUrl, getYandexDownload, initYandexDownloads, navigateToDownload } from '../src/lib/yandex-download.js';

const folder = 'https://disk.yandex.ru/d/example';
test('переход к файлу не передаёт Referer и удаляет временную ссылку', () => {
  let clicked = false;
  let removed = false;
  const link = { click() {
    assert.equal(this.href, 'https://downloader.disk.yandex.ru/disk/test');
    assert.equal(this.referrerPolicy, 'no-referrer');
    assert.equal(this.rel, 'noreferrer');
    clicked = true;
  }, remove() { removed = true; } };
  navigateToDownload('https://downloader.disk.yandex.ru/disk/test', {
    createElement: () => link, body: { append: (el) => assert.equal(el, link) },
  });
  assert.equal(clicked, true);
  assert.equal(removed, true);
});
test('публичный запрос указывает конкретный файл и кодирует имя', () => {
  const url = yandexRequestUrl(folder, 'Лаунчер 1.exe');
  assert.equal(url.searchParams.get('public_key'), folder);
  assert.equal(url.searchParams.get('path'), '/Лаунчер 1.exe');
  assert.throws(() => yandexRequestUrl('https://evil.example/d/x', 'x.exe'));
  assert.throws(() => yandexRequestUrl(folder, '../x.exe'));
});

test('при каждом запросе получается новая ссылка без учётных данных', async () => {
  let calls = 0;
  const fetcher = async (url, options) => {
    assert.equal(options.credentials, 'omit');
    assert.equal(options.cache, 'no-store');
    assert.ok(options.signal);
    return { ok: true, json: async () => ({ href: `https://downloader.disk.yandex.ru/disk/${++calls}` }) };
  };
  const first = await getYandexDownload(folder, 'x.exe', fetcher);
  const second = await getYandexDownload(folder, 'x.exe', fetcher);
  assert.notEqual(first, second);
});

test('ошибки сервиса и посторонние ссылки отклоняются', async () => {
  await assert.rejects(getYandexDownload(folder, 'x.exe', async () => ({ ok: false, status: 404 })));
  for (const href of [undefined, 'http://downloader.disk.yandex.ru/x', 'https://evil.example/x', 'https://yandex.net.evil.example/x', 'https://user:pass@downloader.disk.yandex.ru/x']) {
    await assert.rejects(getYandexDownload(folder, 'x.exe', async () => ({ ok: true, json: async () => ({ href }) })));
  }
});

function fixture(getLink, navigate) {
  const label = { textContent: 'Скачать установщик' };
  const status = { textContent: '' };
  let click;
  const button = {
    dataset: { folderUrl: folder, fileName: 'x.exe' }, disabled: false,
    querySelector: () => label, getAttribute: () => 'status',
    setAttribute() {}, removeAttribute() {},
    addEventListener: (name, handler) => { click = handler; },
  };
  initYandexDownloads({ querySelectorAll: () => [button], getElementById: () => status }, getLink, navigate);
  return { button, label, status, click: () => click() };
}

test('кнопка блокирует повторный запрос, передаёт ссылку браузеру и восстанавливается', async () => {
  let resolve;
  let calls = 0;
  const urls = [];
  const ui = fixture(() => { calls++; return new Promise((r) => { resolve = r; }); }, (url) => urls.push(url));
  const pending = ui.click();
  assert.equal(ui.button.disabled, true);
  await ui.click();
  assert.equal(calls, 1);
  resolve('https://downloader.disk.yandex.ru/disk/test');
  await pending;
  assert.equal(urls.length, 1);
  assert.equal(ui.button.disabled, false);
  assert.equal(ui.label.textContent, 'Скачать установщик');
});

test('при сетевой ошибке есть запасной путь с именем файла и повторная попытка', async () => {
  const ui = fixture(async () => { throw new Error('Network'); }, () => assert.fail('перехода быть не должно'));
  await ui.click();
  assert.match(ui.status.textContent, /Не удалось.*Открыть файлы на Яндекс.Диске.*x\.exe/);
  assert.equal(ui.button.disabled, false);
  await ui.click();
  assert.equal(ui.label.textContent, 'Скачать установщик');
});

test('ограничение API объясняется без перехода и автоматических повторов', async () => {
  let calls = 0;
  const ui = fixture(() => getYandexDownload(folder, 'x.exe', async () => {
    calls++;
    return { ok: false, status: 429 };
  }), () => assert.fail('перехода быть не должно'));
  await ui.click();
  assert.equal(calls, 1);
  assert.match(ui.status.textContent, /временно ограничил.*Открыть файлы.*x\.exe/);
  assert.equal(ui.button.disabled, false);
  assert.equal(ui.label.textContent, 'Скачать установщик');
});
