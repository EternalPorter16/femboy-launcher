const { contextBridge, ipcRenderer, webUtils } = require('electron');

const INVOKE = /^(win|state|versions|accounts|skins|instances|friends|mods|browse|worlds|servers|storage|files|packs|settings|update|app|game|other|sync|hw|perf|power|net|task|snapshots|java|report|migrate|bisect):[a-zA-Z]+$/;
const EVENTS = ['game:log', 'game:progress', 'game:state', 'game:share', 'game:lan', 'game:players', 'task:progress', 'update:status', 'app:notify', 'app:refresh', 'app:readiness', 'app:modwatch', 'app:launchRequest', 'app:importRequest','net:state', 'power:state'];

contextBridge.exposeInMainWorld('api', {
  invoke: (channel, ...args) => {
    if (!INVOKE.test(channel)) throw new Error('Неизвестный канал ' + channel);
    return ipcRenderer.invoke(channel, ...args);
  },
  on: (channel, fn) => {
    if (EVENTS.includes(channel)) ipcRenderer.on(channel, (_e, data) => fn(data));
  },
  // Путь к перетащенному файлу (в Electron 32+ у File больше нет поля path)
  pathForFile: (file) => webUtils.getPathForFile(file),
});
