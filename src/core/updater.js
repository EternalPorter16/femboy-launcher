// Автообновление через electron-updater. Установленная версия (Setup) качает обновление в фоне
// и ставит его по кнопке или при закрытии; portable-версия только сообщает о новой версии.
const { app, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const net = require('./net');

const CHECK_EVERY_MS = 2 * 60 * 60 * 1000;
const portable = !!process.env.PORTABLE_EXECUTABLE_FILE;

let status = { state: 'idle', current: app.getVersion() };
let notify = () => {};
let canRestart = () => true;

function set(patch) {
  status = { ...status, ...patch };
  notify(status);
}

// Постоянный HTTPS-источник имеет приоритет. Старый провайдер остаётся для совместимости.
const { url: feedUrl, downloadPage, yandex, github: repo = '' } = require('../../package.json').updates || {};
if (feedUrl && (new URL(feedUrl).protocol !== 'https:' || new URL(feedUrl).username || new URL(feedUrl).password)) {
  throw new Error('Источник обновлений должен быть HTTPS-адресом без учётных данных');
}
const releasesUrl = downloadPage || yandex || (/^[\w.-]+\/[\w.-]+$/.test(repo) ? `https://github.com/${repo}/releases/latest` : null);
const HOST = feedUrl ? new URL(feedUrl).hostname : yandex ? 'cloud-api.yandex.net' : 'api.github.com';

function init({ onStatus, isBusy }) {
  notify = onStatus;
  canRestart = () => !isBusy();
  // В режиме разработки (npm start) обновляться нечему
  if (!app.isPackaged) return set({ state: 'dev' });

  autoUpdater.autoDownload = !portable;
  autoUpdater.autoInstallOnAppQuit = !portable;
  autoUpdater.logger = null;
  if (feedUrl) {
    autoUpdater.setFeedURL({ provider: 'generic', url: feedUrl, useMultipleRangeRequest: false });
    // Публикуем полный Setup без .blockmap: не делаем лишних запросов к отсутствующим файлам.
    autoUpdater.disableDifferentialDownload = true;
  } else if (yandex) {
    autoUpdater.setFeedURL({ provider: 'custom', updateProvider: require('./yandex-updates').YandexDiskProvider, url: yandex });
    // Ссылки Диска временные, докачка кусками по .blockmap с ними не работает — всегда качаем файл целиком
    autoUpdater.disableDifferentialDownload = true;
  }

  // Проверка обновлений идёт при запуске и раз в два часа: заодно это «пульс» для индикатора связи в заголовке окна
  autoUpdater.on('checking-for-update', () => set({ state: 'checking', error: null }));
  autoUpdater.on('update-not-available', () => (net.noteResult(HOST, true), set({ state: 'latest', checkedAt: Date.now() })));
  autoUpdater.on('update-available', (info) => {
    net.noteResult(HOST, true);
    set({ state: portable ? 'available' : 'downloading', version: info.version, percent: 0, notes: info.releaseNotes || null });
  });
  autoUpdater.on('download-progress', (p) => set({ state: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (info) => set({ state: 'ready', version: info.version, percent: 100 }));
  autoUpdater.on('error', (e) => {
    if (net.isNetworkError(e)) net.noteResult(HOST, false); // отсутствие файла источника — это не про связь
    set({ state: 'error', error: String(e?.message || e).split('\n')[0] });
  });

  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(check, 8000);
  setInterval(check, CHECK_EVERY_MS);
}

async function check() {
  if (!app.isPackaged) throw new Error('Обновления работают только в установленной версии');
  await autoUpdater.checkForUpdates();
  return status;
}

function install() {
  if (status.state !== 'ready') throw new Error('Обновление ещё не скачано');
  if (!canRestart()) throw new Error('Сначала закрой игру — обновление поставится после этого');
  // isSilent: без окна установщика; isForceRunAfter: сразу открыть лаунчер снова
  setImmediate(() => autoUpdater.quitAndInstall(true, true));
}

// Portable обновить себя не может — открываем страницу релиза, где лежит новая версия
function openDownload() {
  if (!releasesUrl) throw new Error('Не указано, откуда брать обновления (updates в package.json)');
  shell.openExternal(releasesUrl);
}

module.exports = { init, check, install, openDownload, status: () => status, portable };
