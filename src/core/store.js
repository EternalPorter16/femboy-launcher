// Хранилище настроек и аккаунтов лаунчера (JSON в userData)
const fs = require('fs');
const os = require('os');
const path = require('path');
const fsx = require('./fsx');

let base = '';
let file = '';
let data = null;

const totalMb = Math.floor(os.totalmem() / 1024 / 1024);

function defaults() {
  return {
    accounts: [],
    activeAccount: null,
    settings: {
      minRam: 1024,
      maxRam: Math.min(4096, Math.max(2048, Math.floor(totalMb / 2 / 256) * 256)),
      javaPath: '',
      jvmArgs: '',
      closeOnLaunch: false,
      accent: 'pink',
      theme: 'light', // light | dark | system
      soundOn: true,
      soundVolume: 40,
      downloadSource: 'auto', // auto | official | mirror
      proxy: '', // свой прокси для загрузок (http://адрес:порт, socks5://адрес:порт); пусто — как настроен Windows
      background: null,
      bgOpacity: 35,
      bgBlur: 0,
      mascotAccessory: 'none',
      seasonal: true, // праздничные наряды котика
      motion: 'on', // анимации: on | system | off
      catPhrases: [], // свои фразы котика
      accentColor: '#ff5fa8', // для акцента «свой цвет»
      cfApiKey: '',
      lang: 'ru', // язык интерфейса: ru | en
      backgroundUpdateChecks: true, // scheduled launcher update checks/downloads
      discordRpc: true, // показывать игру в Discord
      discordHideServer: false, // не показывать адрес сервера в Discord
      clearWhitelist: true, // очищать белый список, когда закрыт мир, открытый для друзей, и когда закрыта игра
      backupBeforeFriends: true, // сохранять копию мира, когда его открывают для друзей по сети
      gameProxy: true, // передавать игре прокси лаунчера флагами Java (core/proxy.js forGame); выключено — игра идёт в сеть напрямую
      readinessCheck: true, // в фоне раз в сутки смотреть, сколько модов сборки готово к новой версии Minecraft (core/readiness.js)
      modUpdatesCheck: true, // в фоне раз в сутки смотреть, вышли ли обновления модов сборок: значок «⬆ N обновлений» (core/modwatch.js)
      autoBackup: 'daily', // копии миров после игры: session | daily | off
      backupKeep: 5, // сколько автокопий каждого мира хранить
      syncDir: '', // папка облака для синхронизации сборок (пусто — выключено)
      cursor: 'paw', // курсор в лаунчере: paw | kitty | system
      eco: 'auto', // экономный режим: убирает фоновые эффекты — auto (на батарее) | on | off
      gpuHigh: false, // Windows: запускать игру на мощной видеокарте
      gpuAsked: false, // уже спрашивали про мощную видеокарту (ноутбук с двумя видеокартами)
      importOffer: true, // при запуске предлагать перенести сборки из найденных на компьютере лаунчеров
      uiScale: 100, // масштаб интерфейса, %: 90 | 100 | 110 | 125 | 150
    },
    friends: [], // друзья для игры по сети: [{ nick, offline, uuid, on }], общий для всех сборок (core/friends.js)
    stats: {}, // счётчики для достижений котика
    achievements: {}, // id достижения → когда открыто
    gpuPrev: {}, // путь к java.exe → что было в «Параметрах графики» Windows до нас (чтобы вернуть при выключении)
    offeredLaunchers: [], // id лаунчеров, про которые уже предлагали перенос (чтобы не надоедать)
  };
}

// Счётчики событий для достижений: launches, nightLaunches, friendShares, backups, imports, shares
function bump(key, by = 1) {
  data.stats = data.stats || {};
  data.stats[key] = (data.stats[key] || 0) + by;
  save();
}

// Что случилось с файлом настроек при запуске: 'restored' — он был испорчен, вернули копию; 'reset' — копии не нашлось
let note = null;
let lastBackup = 0;
const BACKUP_EVERY = 15 * 60 * 1000;

function init(userData) {
  base = userData;
  file = path.join(base, 'launcher.json');
  const def = defaults();
  note = null;
  lastBackup = 0;
  let saved = null;
  const first = fsx.readJson(file);
  if (first.ok) saved = first.data;
  else if (first.exists) {
    // Файл есть, но не читается (обрезан при сбое питания или испорчен). Молча затирать его настройками по умолчанию нельзя:
    // вместе с ним пропали бы аккаунты. Откладываем испорченный в сторону и ищем копию
    try {
      fs.renameSync(file, `${file}.damaged-${new Date().toISOString().replace(/[:.]/g, '-')}`);
    } catch {}
    const bak = fsx.readJson(file + '.bak');
    if (bak.ok) {
      saved = bak.data;
      note = 'restored';
      try {
        fsx.writeJsonAtomic(file, saved);
      } catch {}
    } else note = 'reset';
  }
  data = saved && typeof saved === 'object' ? { ...def, ...saved, settings: { ...def.settings, ...saved.settings } } : def;
  if (saved && note !== 'restored') backup(); // снимок исправного состояния при запуске
  if (!Array.isArray(data.settings.catPhrases)) data.settings.catPhrases = [];
  // В 0.1 «ночь» была акцентом, теперь это отдельная тёмная тема
  if (data.settings.accent === 'night') Object.assign(data.settings, { accent: 'pink', theme: 'dark' });
  for (const p of Object.values(paths())) fs.mkdirSync(p, { recursive: true });
}

// Копия «последнего исправного»: не чаще раза в 15 минут и только если текущий файл читается
function backup() {
  lastBackup = Date.now();
  try {
    if (fsx.readJson(file).ok) fs.copyFileSync(file, file + '.bak');
  } catch {}
}

function save() {
  if (Date.now() - lastBackup > BACKUP_EVERY) backup(); // прежнее содержимое → .bak: так копия ещё и спасает от собственных ошибок
  fsx.writeJsonAtomic(file, data);
  if (!fs.existsSync(file + '.bak')) backup(); // самая первая копия, если её ещё не было
}

// Сообщение для интерфейса о том, что с файлом настроек случилось при запуске (показываем один раз)
function takeNote() {
  const n = note;
  note = null;
  return n;
}

function get() {
  return data;
}

function updateSettings(patch) {
  data.settings = { ...data.settings, ...patch };
  save();
  return data.settings;
}

function paths() {
  return {
    root: path.join(base, 'minecraft'), // общие версии, библиотеки, ассеты
    instances: path.join(base, 'instances'),
    java: path.join(base, 'java'),
    skins: path.join(base, 'skins'),
  };
}

module.exports = { init, save, get, updateSettings, paths, bump, takeNote, totalMb, baseDir: () => base };
