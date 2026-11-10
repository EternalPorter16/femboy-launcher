const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/core/updater.js'), 'utf8');
function load(updates, { portable = false, packaged = true } = {}) {
  const handlers = {}, feeds = [], external = [], network = [], timers = [];
  const updater = { on(name, fn) { handlers[name] = fn; }, setFeedURL(v) { feeds.push(v); }, checkForUpdates: async () => {}, quitAndInstall() {} };
  const module = { exports: {} };
  vm.runInNewContext(source, { module, URL, Date, process: { env: portable ? { PORTABLE_EXECUTABLE_FILE: 'test.exe' } : {} }, setTimeout: fn => timers.push(fn), setInterval: fn => timers.push(fn), setImmediate: fn => fn(), require(name) {
    if (name === 'electron') return { app: { getVersion: () => '0.10.0', isPackaged: packaged }, shell: { openExternal: url => external.push(url) } };
    if (name === 'electron-updater') return { autoUpdater: updater };
    if (name === './net') return { noteResult: (...args) => network.push(args), isNetworkError: () => true };
    if (name === '../../package.json') return { updates };
    if (name === './yandex-updates') return { YandexDiskProvider: class Legacy {} };
    throw new Error('Unexpected require: ' + name);
  }});
  module.exports.init({ onStatus() {}, isBusy: () => false });
  return { api: module.exports, updater, handlers, feeds, external, network, timers };
}
const config = { url: 'https://downloads.femboylauncher.ru/', yandex: 'https://disk.yandex.ru/d/example', downloadPage: 'https://femboylauncher.ru/#download' };
test('постоянный HTTPS источник имеет приоритет перед Диском, скачивает полный Setup', () => {
  const t = load(config);
  assert.equal(t.feeds.length, 1);
  assert.equal(t.feeds[0].provider, 'generic');
  assert.equal(t.feeds[0].url, config.url);
  assert.equal(t.updater.disableDifferentialDownload, true);
  assert.equal(t.updater.autoDownload, true);
  assert.equal(t.updater.autoInstallOnAppQuit, true);
  t.handlers['update-not-available']();
  assert.equal(t.network[0][0], 'downloads.femboylauncher.ru');
  t.handlers.error(new Error('network'));
  assert.equal(t.network[1][0], 'downloads.femboylauncher.ru');
  assert.equal(t.network[1][1], false);
});
test('Portable только сообщает об обновлении и открывает страницу скачивания сайта', () => {
  const t = load(config, { portable: true });
  assert.equal(t.updater.autoDownload, false);
  assert.equal(t.updater.autoInstallOnAppQuit, false);
  t.handlers['update-available']({ version: '0.10.1' });
  assert.equal(t.api.status().state, 'available');
  t.api.openDownload();
  assert.deepEqual(t.external, [config.downloadPage]);
});
test('старый конфиг без нового источника сохраняет Яндекс.Диск', () => {
  const t = load({ yandex: config.yandex });
  assert.equal(t.feeds[0].provider, 'custom');
  assert.equal(t.feeds[0].url, config.yandex);
});
test('разработка не включает сеть или периодические проверки обновлений', () => {
  const t = load(config, { packaged: false });
  assert.equal(t.api.status().state, 'dev');
  assert.equal(t.feeds.length, 0);
  assert.equal(t.timers.length, 0);
});
test('небезопасный источник обновлений отклоняется', () => {
  for (const url of ['http://example.org/', 'https://user:secret@example.org/', 'not a URL']) assert.throws(() => load({ url }));
});
