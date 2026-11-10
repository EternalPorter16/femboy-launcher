// Источник обновлений для electron-updater — публичная папка на Яндекс.Диске.
// Публичная ссылка Диска ведёт на страницу, а не на файл, поэтому прямые ссылки на latest.yml
// и установщик берём у открытого API Диска (без ключей). Ссылки временные — получаем их при каждой проверке.
const { URL } = require('url');
const { Provider } = require('electron-updater');
const { parseUpdateInfo, getFileList } = require('electron-updater/out/providers/Provider');

const API = 'https://cloud-api.yandex.net/v1/disk/public/resources/download';

class YandexDiskProvider extends Provider {
  constructor(configuration, updater, runtimeOptions) {
    super(runtimeOptions);
    this.configuration = configuration;
    this.updater = updater;
    this.links = new Map();
  }

  // Прямая ссылка на файл из публичной папки (dir — подпапка, по умолчанию корень)
  async link(name) {
    const dir = (this.configuration.dir || '').replace(/^\/+|\/+$/g, '');
    const url = new URL(API);
    url.searchParams.set('public_key', this.configuration.url);
    url.searchParams.set('path', `/${dir ? dir + '/' : ''}${name}`);
    let res;
    try {
      res = JSON.parse(await this.httpRequest(url));
    } catch (e) {
      if (e.statusCode === 404) throw new Error(`На Яндекс.Диске нет файла ${name}`);
      throw e;
    }
    if (!res?.href) throw new Error(`Яндекс.Диск не выдал ссылку на ${name}`);
    return new URL(res.href);
  }

  async getLatestVersion() {
    const channelFile = 'latest.yml';
    const ymlUrl = await this.link(channelFile);
    const info = parseUpdateInfo(await this.httpRequest(ymlUrl), channelFile, ymlUrl);
    // Ссылки на сами файлы нужны resolveFiles, а он синхронный — получаем их заранее
    this.links.clear();
    for (const f of getFileList(info)) this.links.set(f.url, await this.link(f.url));
    return info;
  }

  resolveFiles(info) {
    return getFileList(info).map((f) => ({ url: this.links.get(f.url), info: f }));
  }
}

module.exports = { YandexDiskProvider };
