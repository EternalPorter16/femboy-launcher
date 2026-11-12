const { app, BrowserWindow, ipcMain, shell, nativeTheme, dialog, Tray, Menu, nativeImage, powerMonitor, session, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const store = require('./core/store');
const accounts = require('./core/accounts');
const instances = require('./core/instances');
const versions = require('./core/versions');
const game = require('./core/game');
const mods = require('./core/mods');
const modupdates = require('./core/modupdates');
const skins = require('./core/skins');
const msskin = require('./core/msskin');
const updater = require('./core/updater');
const modrinth = require('./core/modrinth');
const curseforge = require('./core/curseforge');
const packs = require('./core/packs');
const worlds = require('./core/worlds');
const { ping } = require('./core/ping');
const storage = require('./core/storage');
const dropin = require('./core/dropin');
const health = require('./core/health');
const discord = require('./core/discord');
const other = require('./core/otherlaunchers');
const achievements = require('./core/achievements');
const sync = require('./core/sync');
const hardware = require('./core/hardware');
const gpu = require('./core/gpu');
const optimize = require('./core/optimize');
const graphics = require('./core/graphics');
const speed = require('./core/speed');
const net = require('./core/net');
const proxy = require('./core/proxy');
const e4mc = require('./core/e4mc');
const friendlist = require('./core/friendlist');
const friendbook = require('./core/friends');
const friendcheck = require('./core/friendcheck');
const lansession = require('./core/lansession');
const lanplayers = require('./core/lanplayers');
const lanaddress = require('./core/lanaddress');
const gamelog = require('./core/gamelog');
const playlog = require('./core/playlog');
const recap = require('./core/recap');
const imagesave = require('./core/imagesave');
const repair = require('./core/repair');
const trash = require('./core/trash');
const netcheck = require('./core/netcheck');
const snapshots = require('./core/snapshots');
const packupdate = require('./core/packupdate');
const javafind = require('./core/javafind');
const origins = require('./core/origins');
const modcode = require('./core/modcode');
const readiness = require('./core/readiness');
const modwatch = require('./core/modwatch');
const report = require('./core/report');
const mclogs = require('./core/mclogs');
const cli = require('./core/cli');
const shortcut = require('./core/shortcut');
const migrate = require('./core/migrate');
const bisect = require('./core/bisect');
const loaders = require('./core/loaders');
const logger = require('./core/logger');
const scrub = require('./core/scrub');

const SOURCES = { modrinth, curseforge };
let win;
// Полоска прогресса на значке в панели задач: загрузки и подготовка к запуску видны, и когда окно свёрнуто
const taskbar = require('./core/taskbar').create({ apply: (value, mode) => win && !win.isDestroyed() && win.setProgressBar(value, { mode }) });
// Список переходов на значке (правый щелчок): последние сборки. Только в установленной и portable-версии: из исходников и в проверках его не трогаем
const jumplist = require('./core/jumplist');
const JUMP_CHANNELS = /^(instances:(create|update|remove|duplicate|import|importOpened|joinInstall|trashRestore|trashPurge|trashEmpty)|migrate:run|packs:update|snapshots:restore|browse:collectionImport)$/;
const jumps = jumplist.enabled({ platform: process.platform, packaged: app.isPackaged, portable: !!process.env.PORTABLE_EXECUTABLE_FILE })
  ? jumplist.scheduler({
      get: () => jumplist.build(instances.list(), { exe: process.env.PORTABLE_EXECUTABLE_FILE || process.execPath, lang: store.get().settings.lang === 'en' ? 'en' : 'ru' }),
      apply: (cats) => {
        const r = app.setJumpList(cats);
        return r === 'customCategoryAccessDeniedError' ? app.setJumpList(jumplist.asTasks(cats)) : r; // «недавние элементы» выключены: те же ссылки среди «Задач»
      },
      onResult: (r) => r !== 'ok' && logger.warn('Список переходов на значке не обновился:', r),
    })
  : { schedule() {}, stop() {} };
let tray = null;

// Portable: данные лежат рядом с программой (папка data). Задать путь нужно до того, как что-то прочитает userData
const portableDir = require('./core/portable').dataDir({ exeDir: path.dirname(app.getPath('exe')), packaged: app.isPackaged, oldDataDir: app.getPath('userData') });
if (portableDir) app.setPath('userData', portableDir);
// portable-версия, у которой данные остались в профиле Windows (там уже были сборки): интерфейс подскажет, как их перенести
const portableLegacy = !!process.env.PORTABLE_EXECUTABLE_DIR && !portableDir;

// Неожиданные ошибки главного процесса: в лог и понятное окно с кнопкой «Собрать отчёт» (вместо сырого окна Electron)
function showFatalDialog(err) {
  if (!app.isReady()) return; // до готовности Electron окно показать нельзя, а ошибка уже в логе
  let en = false;
  try {
    en = store.get().settings.lang === 'en';
  } catch {}
  const brief = scrub.text(String(err?.message || err)).slice(0, 300);
  dialog
    .showMessageBox(win && !win.isDestroyed() ? win : undefined, {
      type: 'error',
      title: 'Femboy Launcher',
      message: en ? 'The launcher ran into an unexpected error' : 'Лаунчер столкнулся с неожиданной ошибкой',
      detail: `${brief}\n\n${en ? 'The details are in the launcher log.' : 'Подробности записаны в лог лаунчера.'}`,
      buttons: en ? ['Build a report', 'Continue', 'Quit the launcher'] : ['Собрать отчёт', 'Продолжить', 'Закрыть лаунчер'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    })
    .then(async ({ response }) => {
      if (response === 0) await buildSupportReport({}).catch((e) => logger.error('Отчёт не собрался:', e));
      else if (response === 2) app.quit();
    })
    .catch(() => {});
}
const fatal = require('./core/fatal').createHandlers({
  log: logger,
  showDialog: showFatalDialog,
  notify: () => send('app:notify', { text: 'Что-то пошло не так в фоне — подробности в логе лаунчера', kind: 'err' }),
});
process.on('uncaughtException', fatal.onException);
process.on('unhandledRejection', fatal.onRejection);

// Один лаунчер на одни данные: повторный запуск (двойной клик, ярлык сборки) показывает уже открытое окно и передаёт ему
// аргументы, а не открывает второе окно: оно держало бы свою копию настроек и затирало изменения первого.
// Аргументы едут отдельным списком: в обычном argv Chromium переставляет флаги вперёд, и «--launch id» приходит как «--launch» и «id» врозь
const singleLock = app.requestSingleInstanceLock({ argv: process.argv });
if (!singleLock) app.exit(0);
let pendingLaunch = cli.parse(process.argv); // запуск сборки из ярлыка или командной строки: ждёт, пока окно будет готово
let pendingPack = cli.pack(process.argv); // .mrpack, открытый двойным щелчком: окно спросит, ставить ли
let openedPack = null; // файл, о котором окно уже спросило человека: импортируется только он, путь из окна не принимается
app.on('second-instance', (_e, argv, _cwd, data) => {
  showWindow();
  const own = Array.isArray(data?.argv) ? data.argv.filter((a) => typeof a === 'string') : [];
  const req = cli.parse(own) || cli.parse(argv);
  const pack = cli.pack(own) || cli.pack(argv);
  logger.info('Лаунчер запущен повторно' + (req ? ': сборка ' + req.launch : '') + (pack ? ': модпак ' + path.basename(pack) : ''));
  if (req) {
    pendingLaunch = req;
    send('app:launchRequest');
  }
  if (pack) {
    pendingPack = pack;
    send('app:importRequest');
  }
});

// Масштаб интерфейса: окно не даём сделать меньше, чем нужно макету при этом масштабе (но и не больше экрана)
const SCALES = [90, 100, 110, 125, 150];
function applyScale() {
  if (!win || win.isDestroyed()) return;
  const pct = +store.get().settings.uiScale;
  const f = (SCALES.includes(pct) ? pct : 100) / 100;
  win.webContents.setZoomFactor(f);
  const wa = screen.getDisplayMatching(win.getBounds()).workArea;
  const need = [Math.min(Math.round(980 * f), wa.width), Math.min(Math.round(640 * f), wa.height)];
  win.setMinimumSize(...need);
  // Минимум сам окно не увеличивает: если оно стало тесным для этого масштаба, растим и не даём уехать за край экрана
  const b = win.getBounds();
  if (!win.isMaximized() && !win.isFullScreen() && (b.width < need[0] || b.height < need[1])) {
    const width = Math.max(b.width, need[0]);
    const height = Math.max(b.height, need[1]);
    win.setBounds({ x: Math.max(wa.x, Math.min(b.x, wa.x + wa.width - width)), y: Math.max(wa.y, Math.min(b.y, wa.y + wa.height - height)), width, height });
  }
}

// Переносим данные из старой версии (Sugarcube Launcher), чтобы не потерять сборки и скачанное
function migrateOldData(userData) {
  const old = path.join(app.getPath('appData'), 'Sugarcube Launcher');
  if (!fs.existsSync(path.join(old, 'launcher.json')) || fs.existsSync(path.join(userData, 'launcher.json'))) return;
  fs.mkdirSync(userData, { recursive: true });
  for (const name of ['launcher.json', 'instances', 'java', 'minecraft']) {
    const from = path.join(old, name);
    if (fs.existsSync(from)) fs.renameSync(from, path.join(userData, name));
  }
}

function isDark() {
  const t = store.get().settings.theme;
  return t === 'dark' || t === 'midnight' || (t === 'system' && nativeTheme.shouldUseDarkColors);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1220,
    height: 780,
    minWidth: 980,
    minHeight: 640,
    frame: false,
    backgroundColor: isDark() ? '#150f1f' : '#f8f2f7',
    title: 'Femboy Launcher',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false, // avoid background dictionary downloads in launcher fields
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.on('close', (event) => lifecycle.close(event));
  win.webContents.on('did-finish-load', applyScale);
  // Окно (отрисовщик) может неожиданно упасть, например из-за видеодрайвера или нехватки памяти: пишем причину и открываем заново
  let lastReload = 0;
  win.webContents.on('render-process-gone', (_e, d) => {
    logger.error('Окно лаунчера неожиданно закрылось:', d.reason, 'код', d.exitCode);
    if (d.reason === 'clean-exit' || win.isDestroyed() || Date.now() - lastReload < 20000) return; // не зацикливаемся, если оно падает сразу после перезапуска
    lastReload = Date.now();
    win.webContents.once('did-finish-load', () => send('app:notify', { text: 'Окно лаунчера неожиданно закрылось и открыто заново — подробности в логе', kind: 'err' }));
    win.webContents.reload();
  });
  win.webContents.on('unresponsive', () => logger.warn('Окно лаунчера не отвечает'));
  // Брошенный в окно файл не должен открываться вместо лаунчера — его разбирает сам интерфейс
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  // Внешние ссылки — в браузер, а не внутри лаунчера
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

const send = (channel, payload) => {
  if (channel === 'game:log' && payload?.line != null) payload = { ...payload, line: scrub.text(payload.line) };
  // В лог идёт то, что человек видит как ход запуска и как ошибки; строки самой игры и отладку не пишем: у игры свой лог
  if (channel === 'game:log' && (payload?.type === 'info' || payload?.type === 'error')) (payload.type === 'error' ? logger.error : logger.info)('Игра:', payload.line);
  else if (channel === 'app:notify' && payload?.kind === 'err') logger.warn('Уведомление:', payload.text);
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
};

// Ответ всегда {ok, data} | {ok:false, error}, чтобы в интерфейс доходил чистый текст ошибки
function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      const data = await fn(...args);
      if (JUMP_CHANNELS.test(channel)) jumps.schedule(); // сборки изменились — список переходов на значке обновится после затишья
      return { ok: true, data };
    } catch (e) {
      // В лог идёт только канал и текст ошибки, без аргументов: в них бывают пароли и токены
      if (!e?.cancelled) logger.warn('IPC', channel, e?.message || String(e));
      // cancelled: человек сам нажал «Отменить» — интерфейс не должен ругаться красной ошибкой
      // needs2fa: Ely.by просит код двухфакторной защиты — окно входа покажет для него поле
      return { ok: false, error: e?.message || String(e), ...(e?.cancelled && { cancelled: true }), ...(e?.needs2fa && { needs2fa: true }), ...(e?.syncFailed && { syncFailed: true }) };
    }
  });
}

function source(name) {
  const s = SOURCES[name];
  if (!s) throw new Error('Неизвестный источник ' + name);
  return s;
}

const taskProgress = (label, percent) => {
  send('task:progress', { label, percent });
  if (label === null && percent === null) taskbar.taskEnd(); // «нет ни подписи, ни процента» — задача закончилась
  else taskbar.task(percent);
};
// Подготовка сборки к запуску: событие идёт и в окно, и на значок в панели задач
const launchProgress = (id, label, percent) => {
  send('game:progress', { id, label, percent });
  taskbar.launch(id, percent);
};

// «Отменить»: долгая операция идёт в своей области отмены. Загрузки, очередь файлов и паузы между повторами
// прерываются сразу, а недокачанное удаляется
const tasks = new Set();
const launches = new Map(); // id сборки → токен отмены подготовки к запуску
const packUpdates = new Set();
const modInstalls = new Set();
const backgroundJobs = new Set();
const hasBackgroundWork = () => !!(game.isRunning() || launches.size || tasks.size || packUpdates.size || modInstalls.size || backgroundJobs.size);
const lifecycle = require('./core/lifecycle').create({ isBusy: hasBackgroundWork, hide: hideToTray, quit: () => app.quit() });
function trackBackground(job) {
  backgroundJobs.add(job);
  const done = () => { backgroundJobs.delete(job); lifecycle.idle(); };
  job.then(done, (e) => { logger.warn('Фоновая задача не завершилась:', e?.message || String(e)); done(); });
  return job;
}
async function withTask(fn) {
  const token = net.cancelToken();
  tasks.add(token);
  try {
    return await net.runCancellable(token, () => fn(taskProgress));
  } finally {
    tasks.delete(token);
    taskProgress(null, null);
    lifecycle.idle();
  }
}

function withModTask(id, reason, fn) {
  if (game.isRunning(id) || launches.has(id) || packUpdates.has(id) || modInstalls.has(id)) throw new Error('Сначала закрой игру и дождись завершения задач сборки');
  packupdate.recover(id);
  modInstalls.add(id);
  return withTask((p) => {
    autoPoint(id, reason, { required: true });
    return fn(p);
  }).finally(() => { modInstalls.delete(id); lifecycle.idle(); });
}

// Перед тем как лаунчер сам меняет моды (обновление, оптимизация, недостающее), сохраняем точку восстановления:
// если что-то сломается, «Вернуть» откатит изменения. Для модпака снимок обязателен.
function autoPoint(id, reason, { required = false } = {}) {
  try {
    const s = snapshots.create(id, reason, { force: required });
    if (!s.reused) send('app:notify', { text: 'Сохранила точку восстановления — вернуть можно в «Ещё»', kind: 'ok', quiet: true });
  } catch (e) {
    send('game:log', { line: `Точка восстановления не сохранилась: ${e.message}`, type: 'error' });
    if (required) throw e;
  }
}

/* ---------- трей: пока лаунчер спрятан на время игры ---------- */
function showWindow() {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  win.focus();
  tray?.destroy();
  tray = null;
}
function hideToTray() {
  if (!win || win.isDestroyed()) return;
  if (tray) { win.hide(); return; }
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png')).resize({ width: 16, height: 16 }));
  const en = store.get().settings.lang === 'en';
  tray.setToolTip(en ? 'Femboy Launcher — running in background' : 'Femboy Launcher — работает в фоне');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: en ? 'Open launcher' : 'Открыть лаунчер', click: showWindow },
      { label: en ? 'Close all games' : 'Закрыть все игры', click: () => game.runningIds().forEach((id) => game.kill(id)) },
      { type: 'separator' },
      { label: hasBackgroundWork() ? (en ? 'Quit when tasks finish' : 'Выйти после завершения задач') : (en ? 'Quit launcher' : 'Выйти из лаунчера'), click: () => app.quit() },
    ])
  );
  tray.on('click', showWindow);
  win.hide();
}

function backgroundUrl() {
  const bg = store.get().settings.background;
  const file = bg && path.join(store.baseDir(), bg);
  return file && fs.existsSync(file) ? `${pathToFileURL(file).href}?v=${Math.round(fs.statSync(file).mtimeMs)}` : null;
}

// Питание: на батарее лаунчер включает экономный режим (если в настройках «Авто»)
const powerState = () => ({ battery: powerMonitor.isOnBatteryPower() });

// Прокси для загрузок: пусто — как настроен Windows, иначе тот, что вписан в настройках
// (если в файле осталось что-то непонятное, остаёмся на системном — лаунчер должен открыться)
async function applyProxy() {
  try {
    await proxy.apply(session.defaultSession, store.get().settings.proxy);
  } catch {
    await proxy.apply(session.defaultSession, '');
  }
}

app.whenReady().then(async () => {
  if (!singleLock) return; // второй экземпляр уже выходит: окно и данные принадлежат первому
  session.defaultSession.setSpellCheckerEnabled(false);
  session.defaultSession.setSpellCheckerLanguages([]);
  // electron-updater ходит в своей сессии (R4-PRIV-01): без этого Chromium качает словарь орфографии (bdic) в фоне. Параметры те же, что у electron-updater
  try {
    const updaterSession = session.fromPartition('electron-updater', { cache: false });
    updaterSession.setSpellCheckerEnabled(false);
    updaterSession.setSpellCheckerLanguages([]);
  } catch {}
  if (!portableDir) migrateOldData(app.getPath('userData')); // у portable свои данные, из профиля Windows ничего не тянем
  store.init(app.getPath('userData'));
  const initialPrivacy = require('./core/privacy-first-run');
  const hadProfile = initialPrivacy.hasProfile(path.join(app.getPath('userData'), 'launcher.json'));
  let installerPrivacy = 'absent';
  logger.init(path.join(store.baseDir(), 'logs'));
  if (app.isPackaged && !portableDir && !process.env.PORTABLE_EXECUTABLE_FILE) {
    const privacyChoice = installerPrivacy = require('./core/privacy-install').apply(path.join(process.resourcesPath, 'privacy-install.json'), store);
    if (privacyChoice === 'invalid') logger.warn('Installer privacy choices could not be read; existing settings retained');
  }
  let firstPrivacy = null;
  if (app.isPackaged && !hadProfile && !['applied', 'already-applied'].includes(installerPrivacy)) {
    firstPrivacy = await initialPrivacy.show({
      BrowserWindow, ipcMain, store, lang: store.get().settings.lang,
      policyFiles: { ru: path.join(process.resourcesPath, 'licenses', 'PRIVACY-NOTICE.txt'), en: path.join(process.resourcesPath, 'licenses', 'PRIVACY-NOTICE-EN.txt') },
    });
    if (!firstPrivacy.accepted) { app.quit(); return; }
  }
  logger.info(`Femboy Launcher ${app.getVersion()} · Electron ${process.versions.electron} · ${process.platform} ${process.arch} ${require('os').release()} · данные: ${store.baseDir()}${portableDir ? ' (portable)' : ''}${pendingLaunch ? ' · запуск сборки ' + pendingLaunch.launch : ''}`);
  app.on('child-process-gone', (_e, d) => logger.error('Служебный процесс Chromium упал:', d.type, d.reason, 'код', d.exitCode));
  net.installGlobalFetch(); // библиотеки со своим fetch (вход Microsoft и др.) тоже пойдут через системный прокси
  net.onNetState((s) => {
    send('net:state', s); // индикатор связи в заголовке окна
    logger.info('Связь:', s.state, s.bad.join(', '));
  });
  applyProxy();
  await recoverGames(); // до окна и фоновой синхронизации: сборки с живой игрой с прошлого запуска уже числятся запущенными
  createWindow();
  firstPrivacy?.close(); // keep one window alive until the main window exists
  powerMonitor.on('on-battery', () => send('power:state', powerState()));
  powerMonitor.on('on-ac', () => send('power:state', powerState()));
  let lastUpdateState = null;
  updater.init({
    settings: () => store.get().settings,
    onStatus: (s) => {
      send('update:status', s);
      if (s.state !== lastUpdateState) logger.info('Обновления:', s.state, s.version || '', s.error || '');
      lastUpdateState = s.state;
    },
    isBusy: hasBackgroundWork,
  });
  discord.init();
  // «Пора на новую версию?»: в фоне раз в сутки считаем, сколько модов каждой сборки уже вышло под свежую версию Minecraft (core/readiness.js)
  readiness.start({
    onChange: (id) => {
      logger.info('Готовность модов к новой версии посчитана:', id);
      send('app:readiness', { id });
    },
  });
  modwatch.start({
    onChange: (id) => {
      logger.info('Обновления модов проверены:', id);
      send('app:modwatch', { id });
    },
  });
  jumps.schedule(); // при старте: список переходов на значке — по тому, что есть сейчас
  try {
    trash.sweep(); // недостёртое прошлой корзины (процесс-удалитель могли прервать выключением компьютера)
  } catch (e) {
    logger.warn('Остатки корзины не стёрты:', e?.message || String(e));
  }
  // Сборки с других компьютеров: забираем из облака в фоне и обновляем список
  if (store.get().settings.syncDir) {
    setTimeout(() => {
      trackBackground(sync
        .syncAll()
        .then((r) => {
          // Ошибки сборок, конфликты и предупреждения показываем, а не только исключения; список обновляем, чтобы «Облако» показало итог
          for (const e of r.errors) send('app:notify', { text: `Синхронизация: ${e}`, kind: 'err' });
          for (const c of [...r.conflicts, ...r.warnings]) send('app:notify', { text: `Синхронизация: ${c}`, kind: 'err' });
          send('app:refresh');
        })
        .catch((e) => send('app:notify', { text: `Синхронизация: ${e.message}`, kind: 'err' })));
    }, 3000);
  }
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', (event) => lifecycle.beforeQuit(event));

// Лаунчер закрывается: корзина очищается. Папки стирает отдельный процесс (окно не ждёт), а здесь только убираем хвосты стёртых сборок
let trashRetired = false;
app.on('will-quit', () => {
  if (trashRetired) return;
  trashRetired = true;
  try {
    for (const i of trash.list()) {
      try {
        snapshots.removeAll(i.id);
      } catch {}
      try {
        sync.forget(i.id);
      } catch {}
    }
    trash.retire();
  } catch (e) {
    logger.warn('Корзина не очищена при выходе:', e?.message || String(e)); // останется до следующего выхода: сборки в ней можно вернуть
  }
});

// Запуск сборки из ярлыка или командной строки: окно забирает его, когда готово (и при старте, и по событию от второго запуска)
handle('app:takeLaunch', () => {
  const req = pendingLaunch;
  pendingLaunch = null;
  return req;
});

// .mrpack, открытый двойным щелчком: окно забирает имя, спрашивает человека и только потом просит импорт (сам путь окну не отдаём)
handle('app:takePack', () => {
  const file = pendingPack;
  pendingPack = null;
  if (!file || !fs.existsSync(file)) return null;
  openedPack = file;
  return { name: path.basename(file) };
});
handle('instances:importOpened', () => {
  const file = openedPack;
  openedPack = null;
  if (!file) throw new Error('Файл модпака не выбран');
  return withTask((p) => packs.importPath(file, p));
});

handle('win:minimize', () => win.minimize());
handle('win:maximize', () => (win.isMaximized() ? win.unmaximize() : win.maximize()));
handle('win:close', () => win.close());
// location.reload() в окне блокируется запретом навигации, поэтому перезагружаем отсюда
handle('win:reload', () => win.webContents.reload());

handle('state:get', () => ({
  accounts: accounts.list(),
  activeAccount: store.get().activeAccount,
  settings: store.get().settings,
  instances: instances.list(),
  trash: trash.list(),
  friends: friendbook.list(),
  running: game.runningIds(),
  importPending: other.pendingInstanceIds(),
  achievements: achievements.list(),
  sync: sync.status(),
  system: { totalMem: store.totalMb, dataDir: store.baseDir(), version: app.getVersion(), backgroundUrl: backgroundUrl(), discord: discord.configured(), storeNote: store.takeNote(), portable: !!portableDir, portableLegacy, logFile: logger.file(), net: net.netState() },
}));

handle('power:get', () => powerState());

// Видеокарта для игры: что есть в компьютере и стоит ли мощная в «Параметрах графики» Windows
const gpuState = async () => {
  const hw = await hardware.info();
  const { gpuHigh, gpuAsked } = store.get().settings;
  return { hybrid: hw.hybrid, laptop: hw.laptop, discrete: hw.discreteGpu, integrated: hw.integratedGpu, on: !!gpuHigh, asked: !!gpuAsked, ...(await gpu.state()) };
};
handle('perf:gpuState', gpuState);
handle('perf:gpuSet', async (on, asked = true) => {
  const settings = store.updateSettings({ gpuHigh: !!on, ...(asked ? { gpuAsked: true } : {}) });
  await gpu.apply(!!on);
  return { ...(await gpuState()), settings };
});
// Ответ «не надо» на вопрос про видеокарту: запоминаем, чтобы больше не спрашивать
handle('perf:gpuSkip', () => store.updateSettings({ gpuAsked: true }));

// Помощник по скорости и профили графики (options.txt сборки)
handle('perf:check', (id) => speed.check(id, powerState()));
handle('perf:fix', (id, what) => speed.fix(id, what));
handle('perf:graphics', (id) => graphics.state(id));
handle('perf:graphicsSet', (id, name) => {
  // Игра пишет options.txt при выходе и стёрла бы наши настройки
  if (game.isRunning(id)) throw new Error('Сначала закрой игру: она перезаписывает настройки, когда выходит');
  return name === 'restore' ? graphics.restore(id) : graphics.apply(id, name);
});

handle('versions:list', () => versions.listMinecraft());
// Версии загрузчика под версию игры (для выбора в настройках сборки) и моды, которым выбранная версия не подходит
handle('versions:loaders', (loader, mc) => loaders.list(String(loader), String(mc)));
handle('instances:loaderCheck', (id, loader, version) => loaders.check(id, String(loader), String(version || '')));

// Выбор Java: найти установленные, выбрать файл, проверить, подходит ли выбранная версии игры
handle('java:find', () => javafind.find());
handle('java:check', async (p, version) => {
  let major = null;
  try {
    if (version) major = (await Promise.race([versions.javaInfo(String(version)), new Promise((_, no) => setTimeout(() => no(new Error('долго')), 6000))])).major;
  } catch {} // версию игры узнать не вышло (нет связи) — тогда просто описываем Java
  return javafind.check(String(p || ''), major);
});
handle('java:pick', async () => {
  const pick = await dialog.showOpenDialog(win, { title: 'Java (javaw.exe или java.exe)', properties: ['openFile'], filters: [{ name: 'Java', extensions: ['exe'] }] });
  return pick.canceled || !pick.filePaths[0] ? null : pick.filePaths[0];
});

handle('accounts:addOffline', (name) => accounts.addOffline(name));
handle('accounts:addMicrosoft', () => accounts.addMicrosoft());
handle('accounts:addElyby', (data) => accounts.addElyby(data || {}));
handle('accounts:refreshSkin', (id) => accounts.refreshElySkin(id));
handle('accounts:remove', (id) => accounts.remove(id));
handle('accounts:select', (id) => accounts.select(id));

handle('skins:save', (accountId, dataUrl, model) => skins.save(accountId, dataUrl, model));
handle('skins:reset', (accountId) => skins.reset(accountId));
handle('skins:fromName', (name) => skins.fromName(name));
handle('skins:msProfile', (accountId) => msskin.profile(accountId));
handle('skins:msUpload', (accountId, dataUrl, model) => msskin.uploadSkin(accountId, dataUrl, model));
handle('skins:msCape', (accountId, capeId) => msskin.setCape(accountId, capeId));

handle('instances:create', (data) => instances.create(data));
handle('instances:update', (id, data) => instances.update(id, data));
// «Удалить» убирает сборку в корзину: пока лаунчер открыт, её можно вернуть. Навсегда она исчезает, когда лаунчер закрывается
// (или кнопкой в корзине): тогда же стираются её точки восстановления, а из облака она уходит и с других компьютеров
const eraseTrashed = (id) => {
  trash.purge(id);
  snapshots.removeAll(id);
  try {
    sync.forget(id);
  } catch {}
};
handle('instances:remove', (id) => {
  if (game.isRunning(id)) throw new Error('Сначала закрой игру');
  return trash.move(id);
});
handle('instances:trashList', () => trash.list());
handle('instances:trashRestore', (id) => trash.restore(id));
handle('instances:trashPurge', (id) => {
  eraseTrashed(id);
});
handle('instances:trashEmpty', () => {
  const ids = trash.list().map((i) => i.id);
  ids.forEach(eraseTrashed);
  trash.purgeAll(); // и всё лишнее, что лежит в корзине рядом со сборками
  return ids.length;
});
// Поделиться: лёгкий .mrpack, копируем сам файл в буфер обмена — его можно вставить в Discord или Telegram
handle('instances:share', async (id) => {
  const inst = instances.get(id);
  const dir = path.join(store.baseDir(), 'shares');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${inst.name.replace(/[\\/:*?"<>|]/g, '_')}.mrpack`);
  const res = await withTask((p) => packs.exportMrpack(id, file, p));
  const copied = await new Promise((resolve) =>
    require('child_process').execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Set-Clipboard -LiteralPath $env:FEMBOY_SHARE_FILE'], { windowsHide: true, timeout: 15000, env: { ...process.env, FEMBOY_SHARE_FILE: file } }, (err) => resolve(!err))
  );
  shell.showItemInFolder(file);
  store.bump('shares');
  return { ...res, copied };
});
// Список друзей (общий для всех сборок): кто в нём, галочка «пустить в этот мир», «без лицензии». Хранит его core/friends.js
handle('friends:list', () => friendbook.list());
handle('friends:add', (data) => friendbook.add(data || {}));
handle('friends:update', (nick, patch) => friendbook.update(nick, patch || {}));
handle('friends:remove', (nick) => friendbook.remove(nick));
handle('friends:import', (entries) => friendbook.importLegacy(entries)); // старые ники из окон сборок: один раз при первом открытии окна

// Играть с другом: мод e4mc открывает мир в интернет без настройки роутера. Если в списке друзей кто-то отмечен, ставится ещё
// LAN World Plug-n-Play (белый список, /whitelist, /ban, /op) и отмеченные друзья записываются в whitelist.json: у друга с лицензией
// без известного UUID его сначала спрашивают у Mojang, а команда /whitelist add путает регистр букв в нике друга без лицензии
handle('instances:friend', (id) =>
  withTask(async (p) => {
    const chosen = friendbook.selected();
    p('Ставлю e4mc — мод для игры с другом…', null);
    const r = await modrinth.installMod(id, 'e4mc');
    if (chosen.length) {
      p('Ставлю LAN World Plug-n-Play — белый список и вход без лицензии…', null);
      const r2 = await modrinth.installMod(id, 'mcwifipnp');
      for (const k of ['installed', 'warnings', 'notes']) r[k].push(...r2[k]);
    }
    let list = null;
    if (chosen.length) {
      p('Записываю белый список…', null);
      const { notes } = await friendbook.resolveMissing();
      list = await friendlist.sync(instances.gameDir(id), friendbook.selected());
      list.unchecked = notes.filter((n) => n.note === 'unchecked').map((n) => n.nick); // лицензию не проверили: нет связи с Mojang
      list.noLicense = notes.filter((n) => n.note === 'no-license').map((n) => n.nick); // у Mojang такого аккаунта нет: друг стал «без лицензии»
    }
    return { ...r, whitelist: list, instance: instances.get(id), friends: friendbook.list() };
  })
);
// Проверка перед игрой с другом: ничего не ставит и не меняет, только читает сборку и стучится к серверу e4mc тем путём, каким пойдёт сама игра
handle('instances:friendCheck', async (id) => {
  const chosen = friendbook.selected();
  return friendcheck.run({
    gameDir: instances.gameDir(id),
    mods: mods.list(id),
    nicks: chosen.map((f) => f.nick),
    offline: chosen.some((f) => f.offline),
    route: await session.defaultSession.resolveProxy(proxy.ROUTE_URL).catch(() => 'DIRECT'),
  });
});
// «Войти к другу»: код сборки (core/modcode.js). Хозяин копирует код своих модов; гость вставляет сообщение друга целиком, лаунчер находит в нём
// адрес и код, сверяет моды с Modrinth и ставит точные версии. Перед правкой модов существующей сборки сохраняется точка восстановления
const pasted = (text) => String(text ?? '').slice(0, 200000);
handle('instances:modCode', (id) =>
  withTask((p) => {
    p('Собираю код сборки…', null);
    return modcode.encode(id);
  })
);
handle('instances:joinCheck', (id, text) =>
  withTask((p) => {
    p('Сверяю моды с Modrinth…', null);
    return modcode.check(typeof id === 'string' && id !== 'new' ? id : null, pasted(text)); // без сборки (или «новая сборка») сверяем с пустой
  })
);
handle('instances:joinInstall', (id, text, opts) => {
  if (typeof id !== 'string' || !id) throw new Error('Выбери сборку');
  if (id !== 'new') notRunning(id);
  return withTask((p) => modcode.join(id, pasted(text), { progress: p, point: autoPoint, follow: !!opts?.follow, name: store.get().settings.lang === 'en' ? 'Friend’s pack' : undefined }));
});
// «Починить файлы игры» (вкладка «Ещё»): клиент, профили, библиотеки и все ресурсы по хэшам, битое докачивается (core/repair.js).
// Библиотеки и ресурсы общие у всех сборок, поэтому пока идёт или готовится любая игра, их не заменить
handle('instances:repair', (id) =>
  withTask(async (p) => {
    if (game.isRunning() || launches.size) throw new Error('Сначала закрой игру (или дождись, пока она запустится): пока она идёт, общие файлы игры заменить нельзя');
    const inst = instances.get(id);
    return repair.run({ root: store.paths().root, version: inst.version, loader: inst.loader, loaderVersion: inst.loaderVersion }, { progress: p });
  })
);
// Шейдеры под этот компьютер
handle('instances:shaders', (id) =>
  withTask(async (p) => {
    const hw = await hardware.info();
    if (!hw.shader) throw new Error('Для этого компьютера шейдеры будут тормозить — лучше поставь «Оптимизацию»');
    p(`Ставлю шейдеры ${hw.shader.name}…`, null);
    const r = await modrinth.install(id, hw.shader.slug, 'shader');
    return { ...r, shader: hw.shader.name };
  })
);
handle('instances:openFolder', (id) => shell.openPath(instances.gameDir(id)));
handle('instances:shortcut', (id) => shortcut.create(instances.get(id))); // ярлык на рабочем столе, который сразу запускает сборку
handle('instances:duplicate', (id) => {
  if (game.isRunning(id) || launches.has(id) || packUpdates.has(id) || modInstalls.has(id)) throw new Error('Сначала закрой игру и дождись завершения задач сборки');
  return packs.duplicate(id);
});
// «Оптимизация»: окно показывает, что подходит сборке (plan), потом ставит выбранное (без выбора — всю «Основу»)
handle('instances:optimizePlan', (id) => optimize.plan(id));
handle('instances:optimize', (id, keys) =>
  withTask((p) => {
    autoPoint(id, 'Перед оптимизацией');
    return optimize.run(id, Array.isArray(keys) ? keys.map(String) : undefined, p);
  })
);

// Перенос на новую версию Minecraft: окно показывает, что получится (plan), потом создаётся копия сборки (run). Старая сборка не меняется
handle('migrate:plan', (id, target) => migrate.plan(id, String(target || '')));
handle('migrate:run', (id, target, opts) => {
  if (game.isRunning(id)) throw new Error('Сначала закрой игру: в мирах идёт запись, и копия получилась бы неполной');
  return withTask((p) => migrate.run(id, String(target || ''), { worlds: opts?.worlds !== false }, p));
});
handle('migrate:report', (id) => migrate.report(id));

// Поиск мода-виновника: окно ведёт человека по пробам, а состояние поиска лежит в папке сборки. Пока игра идёт, моды не трогаем
const notRunning = (id) => {
  if (game.isRunning(id)) throw new Error('Сначала закрой игру: она держит моды открытыми');
};
handle('bisect:pending', () => bisect.pending());
handle('bisect:status', (id) => bisect.view(id));
handle('bisect:start', (id, opts) => {
  notRunning(id);
  autoPoint(id, 'Перед поиском виновника');
  return bisect.start(id, { report: opts?.report });
});
handle('bisect:answer', (id, crashed) => (notRunning(id), bisect.answer(id, !!crashed)));
handle('bisect:finish', (id, disable) => (notRunning(id), bisect.finish(id, Array.isArray(disable) ? disable.map(String) : [])));

// Точки восстановления: список, сохранить вручную, вернуться, удалить
handle('snapshots:list', (id) => snapshots.list(id));
handle('snapshots:create', (id, name) => snapshots.create(id, String(name || '').trim().slice(0, 60) || 'Точка вручную', { auto: false, force: true }));
handle('snapshots:restore', (id, snapId) => {
  if (game.isRunning(id)) throw new Error('Сначала закрой игру: она держит моды открытыми');
  return snapshots.restore(id, snapId);
});
handle('snapshots:remove', (id, snapId) => snapshots.remove(id, snapId));
handle('instances:export', async (id) => {
  const inst = instances.get(id);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Экспорт сборки',
    defaultPath: path.join(app.getPath('downloads'), `${inst.name.replace(/[\\/:*?"<>|]/g, '_')}.mrpack`),
    filters: [{ name: 'Модпак Modrinth', extensions: ['mrpack'] }],
  });
  if (canceled || !filePath) return null;
  const res = await withTask((p) => packs.exportMrpack(id, filePath, p));
  shell.showItemInFolder(filePath);
  return res;
});
handle('instances:import', async (kind) => {
  const pick =
    kind === 'folder'
      ? await dialog.showOpenDialog(win, { title: 'Папка сборки Prism / MultiMC', properties: ['openDirectory'] })
      : await dialog.showOpenDialog(win, {
          title: 'Импорт сборки',
          properties: ['openFile'],
          filters: [{ name: 'Модпаки (.mrpack, .zip)', extensions: ['mrpack', 'zip'] }],
        });
  if (pick.canceled || !pick.filePaths[0]) return null;
  return withTask((p) => packs.importPath(pick.filePaths[0], p));
});

// Другие лаунчеры: найти, перенести, потом освободить место
handle('other:scan', async () => {
  const groups = await other.scan();
  other.markOffered(groups.map((g) => g.id)); // человек видит найденное в окне — второй раз предлагать не нужно
  return groups;
});
// Тихая проверка при запуске: какие лаунчеры нашлись и есть ли в них что-то ещё не перенесённое
handle('other:peek', () => other.peek());
handle('other:offered', (ids) => other.markOffered(Array.isArray(ids) ? ids : []));
handle('other:import', async (plan) => {
  const r = await withTask((p) => other.importSelected(plan, p));
  if (r.created.length) store.bump('imports');
  return r;
});
handle('other:cleanupInfo', () => other.cleanupInfo());
handle('other:trash', (ids) => other.trash(ids, (p) => shell.trashItem(p)));
handle('other:uninstall', (name) => other.uninstall(name));
handle('other:openApps', () => shell.openExternal('ms-settings:appsfeatures'));

handle('mods:list', (id, kind) => mods.list(id, kind));
handle('mods:toggle', (id, file, enabled) => mods.setEnabled(id, file, enabled));
handle('mods:remove', (id, file, kind) => mods.remove(id, file, kind));
handle('mods:pin', (id, file, pinned) => mods.setPinned(id, file, !!pinned)); // закреплённый мод «Обновить моды» пропускает
handle('mods:openFolder', (id, kind) => {
  fs.mkdirSync(mods.dir(id, kind), { recursive: true });
  return shell.openPath(mods.dir(id, kind));
});
handle('mods:checkUpdates', async (id) => {
  const ups = await modupdates.check(id);
  try {
    modwatch.record(id, ups); // значок на карточке показывает то же число, что окно обновлений (с учётом совместимости)
    send('app:modwatch', { id });
  } catch {}
  return ups;
});
handle('mods:watch', (id) => modwatch.get(id)); // значок «⬆ N обновлений» (из фонового обхода; null — итога нет), без запросов в сеть
handle('mods:origins', (id) => origins.check(id)); // откуда каждый мод: Modrinth, CurseForge или неизвестный источник
handle('mods:health', (id) => health.check(id));
// Поставить недостающие моды (по id мода ищем на Modrinth) и заменить неподходящие версии
handle('mods:fixMissing', (id, ids) =>
  withModTask(id, 'Перед установкой недостающих модов', async (p) => {
    const result = { installed: [], warnings: [], notes: [] };
    for (const [i, modId] of (ids || []).slice(0, 30).entries()) {
      p(`Ставлю недостающее: ${modId} (${i + 1} / ${ids.length})`, (i / ids.length) * 100);
      const m = health.check(id).missing.find((x) => x.id === modId);
      // Условие на версию передаём установщику — он подберёт подходящую, а не самую свежую
      const parent = m ? { title: m.by, depends: new Map([[modId, m.pred]]), kind: m.kind } : null;
      try {
        const r = await modrinth.installMod(id, modId, new Set(), parent, m?.wrongVersion ? m.file : null);
        result.installed.push(...r.installed);
        result.warnings.push(...r.warnings);
      } catch (e) {
        if (e.cancelled) throw e;
        result.warnings.push(`${modId}: ${e.message}`);
      }
    }
    return result;
  })
);
handle('mods:applyUpdates', async (id, files) => {
  const r = await withModTask(id, 'Перед обновлением модов', (p) => {
    return modupdates.apply(id, files, p);
  });
  // Моды изменились, значок со старым числом уже не годится: спрашиваем заново (одним запросом, без шума), остальные обновления остаются в значке
  modwatch.check(id).then(() => send('app:modwatch', { id }), () => send('app:modwatch', { id }));
  return r;
});

handle('browse:search', (src, params) => source(src).search(params));
handle('browse:categories', (src, type) => source(src).categories(type));
handle('browse:install', (src, instId, projectId, kind) => withModTask(instId, 'Перед установкой модов', () => source(src).install(instId, projectId, kind)));
handle('browse:installPack', (src, projectId) => withTask((p) => source(src).installModpack(projectId, p)));
// Импорт коллекции Modrinth («Моды» → «Из коллекции», Ctrl+K): ссылка → проекты коллекции с советом для новой сборки; «подходит ли» считается
// по выбранной цели (существующая сборка или версия с загрузчиком); установка выбранного идёт в области отмены, перед ней — точка восстановления
const collection = require('./core/collection');
handle('browse:collection', (text) => collection.show(text, () => versions.listMinecraft()));
handle('browse:collectionCompat', (id, target) => collection.fits(id, target, (instId) => instances.get(instId)));
handle('browse:collectionImport', (id, target, ids) =>
  withTask((p) => collection.run(id, target, ids, { progress: p, point: (instId) => autoPoint(instId, 'Перед импортом коллекции') }))
);

// У каждого мира есть признак canPlay: в него можно зайти одной кнопкой (нужен Minecraft 1.20 и новее). Если версию узнать
// не вышло (нет профиля на диске и связи), разрешаем: если что, ошибку объяснит сам запуск
handle('worlds:list', async (id) => {
  const list = worlds.list(id);
  let canPlay = true;
  try {
    const meta = await within(versions.versionMeta(instances.get(id).version), 3000);
    if (meta) canPlay = game.supportsQuickPlay(meta.releaseTime);
  } catch {}
  return list.map((w) => ({ ...w, canPlay }));
});
// Значки в карточке сборки на главной: сколько модов и миров, когда сохранена последняя копия мира
handle('instances:readiness', (id) => readiness.get(id)); // готовность модов к самой свежей версии игры (из фонового обхода; null — итога нет), без запросов в сеть
handle('instances:summary', (id) => {
  let mods = 0;
  try {
    mods = fs.readdirSync(path.join(instances.gameDir(id), 'mods')).filter((f) => /\.jar$/i.test(f)).length;
  } catch {}
  const b = worlds.backups(id)[0];
  return { mods, worlds: worlds.count(id), backup: b ? { time: b.time, world: b.world } : null };
});
handle('worlds:backup', async (id, name) => {
  const file = await worlds.backup(id, name);
  store.bump('backups');
  shell.showItemInFolder(file);
  return file;
});
handle('worlds:backups', (id) => worlds.backups(id));
handle('worlds:restore', (id, file) => worlds.restore(id, file));
handle('worlds:openBackups', (id) => {
  fs.mkdirSync(worlds.backupsDir(id), { recursive: true });
  return shell.openPath(worlds.backupsDir(id));
});

// Синхронизация через папку облака
handle('sync:pick', async () => {
  const pick = await dialog.showOpenDialog(win, { title: 'Папка облака (Яндекс.Диск, OneDrive, Google Drive…)', properties: ['openDirectory'] });
  if (pick.canceled || !pick.filePaths[0]) return null;
  const dir = path.resolve(pick.filePaths[0]);
  if ((dir + path.sep).startsWith(path.resolve(store.baseDir()) + path.sep)) throw new Error('Это папка самого лаунчера — выбери папку облака');
  store.updateSettings({ syncDir: dir });
  return withTask(async (p) => (p('Синхронизирую сборки…', null), sync.syncAll((id) => game.isRunning(id))));
});
handle('sync:now', () => withTask(async (p) => (p('Синхронизирую сборки…', null), sync.syncAll((id) => game.isRunning(id)))));
handle('sync:off', () => store.updateSettings({ syncDir: '' }));
// «Восстановить облако с этого компьютера» (sync.publishLocal): выход, если облако застряло на «Облако ещё обновляется».
// Только по нажатию после подтверждения в окне; не при запущенной игре и не во время задач сборки. Запуск этой сборки
// на время восстановления запрещён (launchGame). Потом обычная синхронизация всех сборок: окно показывает итог, а не прежнюю ошибку
const cloudPublishes = new Set();
handle('sync:publishLocal', async (id) => {
  if (!store.get().settings.syncDir) throw new Error('Сначала выбери папку облака');
  if (game.isRunning(id) || launches.has(id) || packUpdates.has(id) || modInstalls.has(id) || cloudPublishes.has(id)) throw new Error('Сначала закрой игру и дождись завершения задач сборки');
  const name = instances.get(id).name;
  cloudPublishes.add(id);
  try {
    return await withTask(async (p) => {
      p(`Восстанавливаю облако с этого компьютера: ${name}…`, null);
      const r = await sync.publishLocal(id);
      if (!r) throw new Error('Облако не восстановлено: синхронизация этой сборки сейчас невозможна');
      logger.info('Облако восстановлено с этого компьютера:', id);
      let all;
      try {
        all = await sync.syncAll((x) => game.isRunning(x));
      } catch (e) {
        all = { errors: [e.message], conflicts: [], warnings: [], skipped: [] };
      }
      return { name, conflicts: r.conflicts, warnings: r.warnings, all };
    });
  } finally {
    cloudPublishes.delete(id);
  }
});
// «Перевести облако на новый формат» (sync.migrate): только по нажатию после подтверждения в окне и когда игры не идут.
// force — второе подтверждение: переводить и сборки, где в прежней папке есть изменения другого компьютера
handle('sync:migrate', (force) => {
  if (!store.get().settings.syncDir) throw new Error('Сначала выбери папку облака');
  const busy = instances.list().some((i) => game.isRunning(i.id) || launches.has(i.id) || packUpdates.has(i.id) || modInstalls.has(i.id) || cloudPublishes.has(i.id));
  if (busy) throw new Error('Сначала закрой игру и дождись завершения задач сборки');
  return withTask(async (p) => (p('Перевожу облако на новый формат…', null), sync.migrate((id) => game.isRunning(id), force === true)));
});

handle('hw:info', () => hardware.info());

// Отчёт для поддержки (ZIP на компьютере) и «поделиться логом» (mclo.gs, только по кнопке и после подтверждения)
const within = (promise, ms) => Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);
// Общее для кнопки «Собрать отчёт» и для окна неожиданной ошибки
async function buildSupportReport({ instId, consoleText } = {}, progress = () => {}) {
  progress('Собираю отчёт для поддержки…', null);
  const [hw, javas, netReport] = await Promise.all([
    within(hardware.info(), 12000).catch(() => null),
    within(javafind.find(), 12000).catch(() => []),
    within(netcheck.run(session.defaultSession, store.get().settings.proxy), 14000).catch(() => null),
  ]);
  const launcher = { version: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node, osVersion: require('os').release(), uptimeSec: Math.round(process.uptime()), portable: !!updater.portable };
  const r = report.build({ launcher, hardware: hw, javas: javas || [], net: netReport, consoleText: String(consoleText || '').slice(-800000), instId });
  shell.showItemInFolder(r.file);
  return r;
}
handle('report:build', (args) => withTask((p) => buildSupportReport(args || {}, p)));
handle('report:share', ({ kind, instId, consoleText } = {}) =>
  withTask(async (p) => {
    let text;
    if (kind === 'console') text = String(consoleText || '');
    else {
      const g = report.gameLogs(instId);
      text = [g.crash && `===== ${g.crash.name} =====\n${g.crash.text}`, g.hs && `===== ${g.hs.name} =====\n${g.hs.text}`, g.latest != null && `===== latest.log =====\n${g.latest}`].filter(Boolean).join('\n\n');
      if (!text) throw new Error('У этой сборки ещё нет логов игры — запусти её хотя бы раз');
    }
    p('Отправляю лог на mclo.gs…', null);
    return mclogs.upload(text);
  })
);
handle('worlds:remove', (id, name) => {
  if (game.isRunning(id)) throw new Error('Сначала закрой игру');
  worlds.remove(id, name);
});
handle('worlds:openFolder', (id) => {
  fs.mkdirSync(worlds.savesDir(id), { recursive: true });
  return shell.openPath(worlds.savesDir(id));
});
handle('worlds:screenshots', (id) => worlds.screenshots(id));
handle('worlds:openScreenshot', (id, file) => shell.openPath(worlds.screenshotPath(id, file)));

handle('servers:ping', (address) => ping(address));

handle('files:drop', (instId, paths) => {
  if (!Array.isArray(paths) || !paths.length) return { done: [], notes: [], warnings: [] };
  return withTask((p) => dropin.handle(instId, paths.slice(0, 50).map(String), p));
});

handle('packs:recoveryStatus', (id) => {
  instances.get(id);
  return packupdate.status(id);
});
handle('packs:recover', (id) => {
  instances.get(id);
  if (game.isRunning(id) || launches.has(id) || packUpdates.has(id) || modInstalls.has(id)) throw new Error('Сначала закрой игру и дождись завершения задач сборки');
  packUpdates.add(id);
  return withTask(() => {
    const recovered = packupdate.recover(id);
    return { recovered };
  }).finally(() => { packUpdates.delete(id); lifecycle.idle(); });
});
handle('packs:recoveryFolder', (id) => {
  instances.get(id);
  const dir = path.join(instances.dirOf(id), '.pack-update');
  if (!fs.lstatSync(dir).isDirectory()) throw new Error('Папка восстановления не найдена');
  return shell.openPath(dir);
});
handle('packs:check', (id) => {
  const pack = instances.get(id).pack;
  if (!pack?.projectId) return null;
  return source(pack.source).checkModpackUpdate(id);
});
handle('packs:update', (id) => {
  if (game.isRunning(id)) throw new Error('Сначала закрой игру');
  if (launches.has(id) || packUpdates.has(id) || modInstalls.has(id)) throw new Error('Сборка уже занята запуском или обновлением');
  packupdate.recover(id);
  const pack = instances.get(id).pack;
  if (!pack?.projectId) throw new Error('Сборка сделана не из модпака с Modrinth/CurseForge');
  packUpdates.add(id);
  return withTask((p) => {
    autoPoint(id, 'Перед обновлением модпака', { required: true });
    return source(pack.source).updateModpack(id, p);
  }).finally(() => { packUpdates.delete(id); lifecycle.idle(); });
});

handle('storage:scan', () => storage.scan());
handle('storage:clean', (ids) => {
  if (hasBackgroundWork()) throw new Error('Сначала дождись завершения игр и фоновых задач');
  if (game.isRunning()) throw new Error('Сначала закрой игру — сейчас эти файлы могут использоваться');
  return storage.clean(ids);
});

// Одинаковые моды в разных сборках одним файлом: сначала подсчёт, потом по кнопке; у сборок с идущей игрой моды не трогаются
const dedupe = require('./core/dedupe');
handle('storage:dedupeScan', () => dedupe.scan());
handle('storage:dedupeApply', () => dedupe.apply({ busy: game.runningIds() }));

handle('update:status', () => ({ ...updater.status(), portable: updater.portable }));
handle('update:check', () => updater.check());
handle('update:install', () => updater.install());
handle('update:download', () => updater.openDownload());

handle('settings:update', async (patch) => {
  if (patch && 'proxy' in patch) {
    patch = { ...patch, proxy: String(patch.proxy || '').trim() };
    await proxy.apply(session.defaultSession, patch.proxy); // непонятный адрес — ошибка, и ничего не сохраняется
    net.resetRoutes();
  }
  const s = store.updateSettings(patch);
  discord.refresh();
  if (patch && 'backgroundUpdateChecks' in patch) updater.refresh();
  if (patch && 'uiScale' in patch) applyScale();
  return s;
});

// Проверка связи с серверами лаунчера и «Отменить» для долгих операций
handle('net:check', () => netcheck.run(session.defaultSession, store.get().settings.proxy));
handle('task:cancel', () => {
  const n = tasks.size;
  tasks.forEach((t) => t.cancel());
  return n;
});
handle('game:cancel', (id) => {
  const t = launches.get(id);
  t?.cancel();
  return !!t;
});
handle('app:privacy', () => {
  const en = store.get().settings.lang === 'en';
  return shell.openPath(app.isPackaged ? path.join(process.resourcesPath, 'licenses', en ? 'PRIVACY-NOTICE-EN.txt' : 'PRIVACY-NOTICE.txt') : path.join(__dirname, '..', 'build', en ? 'privacy-notice-en.txt' : 'privacy-notice.txt'));
});
handle('app:openDataDir', () => shell.openPath(store.baseDir()));
handle('app:openPath', (p) => {
  // Открываем только файлы внутри папки лаунчера (например, отчёт о вылете)
  const full = path.resolve(p);
  if (!full.startsWith(path.resolve(store.baseDir()) + path.sep)) throw new Error('Можно открывать только файлы лаунчера');
  return shell.openPath(full);
});
handle('app:setTheme', (dark) => win.setBackgroundColor(dark ? '#150f1f' : '#f8f2f7'));
handle('app:pickBackground', async () => {
  const pick = await dialog.showOpenDialog(win, { title: 'Картинка для фона', properties: ['openFile'], filters: [{ name: 'Картинки', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }] });
  if (pick.canceled || !pick.filePaths[0]) return null;
  const src = pick.filePaths[0];
  if (fs.statSync(src).size > 25 * 1024 * 1024) throw new Error('Картинка больше 25 МБ — выбери поменьше');
  const prev = store.get().settings.background;
  if (prev) fs.rmSync(path.join(store.baseDir(), prev), { force: true });
  const name = 'background' + path.extname(src).toLowerCase();
  fs.copyFileSync(src, path.join(store.baseDir(), name));
  store.updateSettings({ background: name });
  return backgroundUrl();
});
handle('app:clearBackground', () => {
  const prev = store.get().settings.background;
  if (prev) fs.rmSync(path.join(store.baseDir(), prev), { force: true });
  store.updateSettings({ background: null });
});

handle('game:kill', (id) => game.kill(id));

// Игры от прошлого запуска лаунчера, который завершили принудительно (FL-GAME-01): живую подхватываем (сборка занята, ждём выхода),
// закрывшуюся без нас только обслуживаем (копия миров); время игры при этом не начисляем, а код выхода неизвестен
async function recoverGames() {
  try {
    if (!require('./core/livegames').has()) return;
    const r = await game.recover({
      adopted: (id) => logger.info('Найдена игра, оставшаяся от прошлого запуска лаунчера', id),
      unverified: (ids) => logger.warn('Не удалось проверить, жива ли игра от прошлого запуска (Windows не ответила вовремя); запись сохранена, сборка может быть запущена повторно:', ids.join(', ')),
      gone: (id, rec) => {
        logger.info('Игра закрылась, пока лаунчер был выключен; время игры не начисляю', id);
        trackBackground(afterGame(id, rec.startedAt));
      },
      closed: (id, _code, rec) => {
        send('game:log', { line: 'Игра закрыта (код выхода неизвестен: лаунчер был перезапущен, пока игра шла)', type: 'info' });
        send('game:state', { id, running: false, code: null, crash: null });
        jumps.schedule();
        trackBackground(afterGame(id, rec.startedAt));
        if (!lifecycle.quitPending && !game.isRunning()) showWindow();
      },
    });
    if (r.adopted.length) logger.info('Подхвачены игры:', r.adopted.join(', '));
  } catch (e) {
    logger.warn('Не удалось проверить игры от прошлого запуска:', e?.message || String(e));
  }
}

// После игры: копии миров, потом синхронизация с облаком — в фоне, окно не ждёт
async function afterGame(id, startedAt) {
  const s = store.get().settings;
  try {
    const saved = await worlds.autoBackup(id, startedAt, { mode: s.autoBackup, keep: s.backupKeep });
    if (saved.length) {
      store.bump('backups', saved.length);
      send('app:notify', { text: `Сохранила копию: ${saved.join(', ')} ♡`, kind: 'ok', quiet: true });
    }
  } catch (e) {
    send('app:notify', { text: `Копия мира не сохранилась: ${e.message}`, kind: 'err' });
  }
  if (s.syncDir && !game.isRunning(id)) {
    await sync
      .syncInstance(id)
      .then((r) => [...(r?.conflicts || []), ...(r?.warnings || [])].forEach((c) => send('app:notify', { text: `Синхронизация: ${c}`, kind: 'err' })))
      .catch((e) => send('app:notify', { text: `Синхронизация: ${e.message}`, kind: 'err' }));
    send('app:refresh');
  }
}

handle('game:launch', async (id, opts) => {
  // Подготовка к запуску (скачивание Java, файлов игры, загрузчика) идёт в области отмены: кнопка «Отменить» её прерывает
  const token = net.cancelToken();
  launches.set(id, token);
  try {
    return await net.runCancellable(token, () => launchGame(id, opts));
  } finally {
    launches.delete(id);
    taskbar.launchEnd(id); // готово, отменено или не получилось — полоска гаснет при любом исходе
    lifecycle.idle();
  }
});

async function launchGame(id, opts) {
  if (packUpdates.has(id)) throw new Error('Сначала дождись обновления модпака');
  if (modInstalls.has(id)) throw new Error('Сначала закрой игру и дождись завершения задач сборки');
  if (cloudPublishes.has(id)) throw new Error('Сначала дождись восстановления облака');
  packupdate.recover(id);
  // Перед игрой забираем свежее с другого компьютера
  // Если синхронизация не удалась, игра сама не стартует: на этом компьютере может быть устаревшая сборка, и правки разойдутся.
  // Окно показывает причину и спрашивает «Запустить без синхронизации»; тогда оно повторяет запуск с skipSync
  if (store.get().settings.syncDir && !game.isRunning(id) && !opts?.skipSync) {
    launchProgress(id, 'Синхронизирую с облаком…', null);
    await sync.syncInstance(id).catch((e) => {
      if (e.cancelled) throw e;
      throw Object.assign(new Error(e.message), { syncFailed: true });
    });
  } else if (opts?.skipSync) send('game:log', { line: 'Синхронизация пропущена по твоему выбору', type: 'info' });
  let startedAt = Date.now();
  // Перед тем как мир откроют для друзей, сохраняем его копию (настройка backupBeforeFriends): если в гостях что-то сломают, останется прежний мир.
  // Замок мира игра создаёт чуть раньше, чем сервер пишет «Starting integrated…», поэтому ищем открытый мир с запасом
  let worldStartedAt = Date.now();
  const backupBeforeFriends = async () => {
    const s = store.get().settings;
    if (s.backupBeforeFriends === false) return;
    try {
      const r = await worlds.backupOpened(id, worldStartedAt - 120000, { keep: s.backupKeep });
      if (!r) return;
      const text = r.reused ? `Копия мира «${r.world}» перед друзьями уже есть: сохранена меньше получаса назад` : `Сохранила копию мира «${r.world}» перед тем, как его откроют друзьям ♡`;
      send('game:log', { line: text, type: 'info' });
      if (!r.reused) {
        store.bump('backups');
        send('app:notify', { text, kind: 'ok', quiet: true });
      }
    } catch (e) {
      send('game:log', { line: `Копия мира перед друзьями не сохранилась: ${e.message}`, type: 'error' });
    }
  };
  // Белый список живёт один мир: за закрытым миром (и за закрытой игрой) его очищаем, чтобы друзья не заходили в каждый следующий мир сами
  const lan = lansession.session({
    started: () => (worldStartedAt = Date.now()),
    opened: backupBeforeFriends,
    clear: () => friendlist.clear(instances.gameDir(id)),
    enabled: () => store.get().settings.clearWhitelist !== false,
    cleared: ({ names }) => {
      const who = names.slice(0, 5).join(', ') + (names.length > 5 ? '…' : '');
      const text = `Белый список очищен: ${who}. В следующий мир друзей нужно добавить заново (в «Играть с другом» — «Подготовить»)`;
      send('game:log', { line: text, type: 'info' });
      send('app:notify', { text, kind: 'ok' });
    },
    failed: (e) => logger.warn('Белый список не очищен:', e?.message || String(e)),
  });
  // Друзья из окна «Играть с другом»: у друга с лицензией без известного UUID его спрашивают у Mojang (раз и навсегда).
  // Не вышло за 6 секунд — запускаем как есть: игра не должна ждать сеть дольше
  let whitelist;
  if (opts?.friends) {
    try {
      const r = await Promise.race([friendbook.resolveMissing(), new Promise((resolve) => setTimeout(() => resolve({ notes: [] }), 6000))]);
      for (const n of r.notes) {
        const line = n.note === 'no-license' ? `У ${n.nick} нет лицензионного аккаунта: друг записан как друг без лицензии` : `Не смогла узнать UUID у ${n.nick}: нет связи с Mojang`;
        send('game:log', { line, type: 'info' });
      }
    } catch {}
    whitelist = friendbook.selected();
  }
  // Прямые адреса для входа по сети (если e4mc недоступен): порт мира берём из строки лога игры, адреса — из таблицы сетевых адаптеров.
  // Они идут в консоль, в окно с адресом e4mc, а когда e4mc не вышел, окном «Мир открыт по сети»
  const lanAddr = lanaddress.watcher({
    found: (port) => {
      const list = lanaddress.candidates(port);
      const line = list.length ? `Мир открыт по сети на порту ${port}. Другу в той же сети или VPN: ${list.map((a) => `${a.address} (${a.name})`).join(', ')}` : `Мир открыт по сети на порту ${port}`;
      send('game:log', { line, type: 'info' });
    },
  });
  const lanNow = () => {
    const port = lanAddr.port();
    return port ? { port, addresses: lanaddress.candidates(port) } : null;
  };
  // Адрес мира для друга и ошибки мода e4mc ловим в строках лога игры
  const e4mcLine = e4mc.watcher({
    address: (address) => {
      lan.opened();
      store.bump('friendShares');
      let whitelist = [];
      try {
        whitelist = friendlist.names(instances.gameDir(id)); // кого пускает мир на самом деле: окно показывает это, а не то, что человек когда-то вписал
      } catch {}
      send('game:share', { id, address, whitelist, lan: lanNow()?.addresses || [] });
    },
    failed: () => {
      send('app:notify', { text: 'e4mc не достучался до своего сервера — мир для друга не открыт. Что мешает, покажет кнопка «Проверить» в окне «Играть с другом»', kind: 'err' });
      const l = lanNow();
      if (l?.addresses.length) send('game:lan', { id, ...l }); // а напрямую по сети друг зайти может: покажем адреса
    },
  });
  // Кто из друзей зашёл в мир и вышел из него: уведомление (оно же строка в консоли), а окно с адресом показывает, кто в мире сейчас
  const crew = lanplayers.watcher({
    changed: ({ guests, joined, left }) => {
      send('game:players', { id, guests });
      if (joined) send('app:notify', { text: `${joined} заходит в мир ♡`, kind: 'ok' });
      else if (left) send('app:notify', { text: `${left} выходит из мира`, kind: 'ok' });
    },
  });
  return game.launch(
    id,
    {
      log: (line, type) => {
        send('game:log', { line, type });
        if (type === 'game') {
          e4mcLine(line);
          lan.line(line);
          crew(line);
          lanAddr(line);
        }
      },
      javaProxy: () => proxy.forGame(session.defaultSession, store.get().settings.proxy),
      status: (label) => {
        launchProgress(id, label, null);
        logger.info('Запуск', id, label);
      },
      progress: (label, percent) => launchProgress(id, label, percent),
      notice: (text) => send('app:notify', { text, kind: 'ok' }),
      started: () => {
        taskbar.launchEnd(id); // игра пошла: подготовка кончилась, полоска не должна бегать всю игру
        logger.info('Игра запущена', id);
        startedAt = Date.now();
        store.bump('launches');
        if (new Date().getHours() < 5) store.bump('nightLaunches');
        send('game:state', { id, running: true });
        discord.started(instances.get(id), opts?.server);
        if (store.get().settings.closeOnLaunch) hideToTray();
      },
      closed: (code, crash) => {
        if (crash) logger.error('Вылет игры', id, 'код', code, crash.reason || '');
        send('game:log', { line: `Игра закрыта (код ${code})`, type: crash ? 'error' : 'info' });
        send('game:state', { id, running: false, code, crash });
        crew.reset();
        lanAddr.reset();
        lan.exited();
        discord.closed(id);
        trackBackground(afterGame(id, startedAt));
        jumps.schedule(); // время последнего запуска сборки изменилось
        // Вылет показываем сразу; после обычного выхода возвращаем окно, когда закрылась последняя игра
        if (!lifecycle.quitPending && (crash || !game.isRunning())) showWindow();
      },
    },
    // Друзья пишутся в белый список, только когда игру запустили из окна «Играть с другом» (friends); кого именно, решает список друзей, а не окно
    { server: opts?.server, world: opts?.world, whitelist }
  );
}
handle('app:copyText', (text) => require('electron').clipboard.writeText(String(text).slice(0, 20000))); // до 20 000 знаков: код сборки на сотни модов длиннее адреса
handle('app:copyLog', (text) => require('electron').clipboard.writeText(scrub.text(String(text).slice(0, 2000000))));

// Лог лаунчера: ошибки самого окна приходят сюда, а кнопка в «О лаунчере» открывает файл
handle('app:logError', ({ message, where } = {}) => logger.error('Ошибка в окне:', String(message || '').slice(0, 500), String(where || '').slice(0, 200)));
handle('app:openLog', async () => {
  const f = logger.file();
  if (!f) throw new Error('Лог лаунчера не ведётся: нет доступа к папке данных');
  const err = await shell.openPath(f);
  if (err) throw new Error(err);
});
// «Время в игре» (Настройки → «Котик и награды»): неделя по дням, сборки за 30 дней, всего. Имена сборок подставляются здесь;
// у сборки, которой уже нет (удалена), имени нет, окно напишет «Удалённая сборка»
handle('game:playStats', () => {
  const s = playlog.summary();
  const names = new Map(instances.list().map((i) => [i.id, i.name]));
  return { ...s, byInstance: s.byInstance.map((x) => ({ ...x, name: names.get(x.id) || null })) };
});
// «Итоги недели/месяца»: данные и подписи картинки на нужном языке (core/recap.js); холст рисует окно и присылает обратно PNG,
// который сохраняется файлом или кладётся в буфер обмена только после проверки core/imagesave.js
handle('game:recap', (period, opts) => recap.card({ period, lang: opts?.lang, hideNames: !!opts?.hideNames, names: new Map(instances.list().map((i) => [i.id, i.name])) }));
handle('app:saveImage', async (data, opts) => {
  const en = opts?.lang === 'en';
  const file = await imagesave.save(data, {
    name: recap.fileName(opts?.period, opts?.lang),
    pick: async (name) => {
      const { canceled, filePath } = await dialog.showSaveDialog(win, { title: en ? 'Save picture' : 'Сохранить картинку', defaultPath: path.join(app.getPath('pictures'), name), filters: [{ name: 'PNG', extensions: ['png'] }] });
      return canceled ? null : filePath;
    },
  });
  if (file) shell.showItemInFolder(file);
  return file;
});
handle('app:copyImage', (data) => {
  const img = nativeImage.createFromBuffer(imagesave.decodePng(data));
  if (img.isEmpty()) throw new Error('Не удалось скопировать картинку');
  require('electron').clipboard.writeImage(img);
});
// Лог игры сборки («Ещё» → «Лог игры» и «Папка логов»): what — 'latest' или 'folder', что именно открыть, решает core/gamelog.js
handle('instances:openLog', async (id, what) => {
  const err = await shell.openPath(gamelog.target(instances.gameDir(id), what));
  if (err) throw new Error(err);
});
