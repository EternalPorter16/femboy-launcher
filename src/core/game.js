// Запуск игры через minecraft-launcher-core. Можно держать несколько сборок запущенными одновременно.
const fs = require('fs');
const path = require('path');
const { Client } = require('minecraft-launcher-core');
const store = require('./store');
const accounts = require('./accounts');
const instances = require('./instances');
const versions = require('./versions');
const java = require('./java');
const forge = require('./forge');
const yggdrasil = require('./yggdrasil');
const gamefiles = require('./gamefiles');
const crash = require('./crash');
const gpu = require('./gpu');
const net = require('./net');
const elyby = require('./elyby');
const javafind = require('./javafind');
const worlds = require('./worlds');
const friendlist = require('./friendlist');
const playlog = require('./playlog');
const snapshots = require('./snapshots');
const bisect = require('./bisect');

// Короче этого сессия «удачным запуском» не считается: за пару минут могли только дойти до меню
const GOOD_MIN_MS = 3 * 60 * 1000;

const TASKS = {
  assets: 'ресурсы',
  'assets-copy': 'копирую ресурсы',
  natives: 'нативные библиотеки',
  classes: 'библиотеки',
  'classes-custom': 'библиотеки загрузчика',
  'classes-maven-custom': 'библиотеки загрузчика',
};

const running = new Map(); // id сборки → { proc, startedAt, killed, modsAtLaunch }
const launching = new Set();

const mb = (n) => (n / 1024 / 1024).toFixed(1);

// JVM-аргументы из профиля версии Mojang. Движок запуска их не передаёт, а новым версиям они нужны:
// например, 26.x без -XX:StackShadowPages=32 падает в нативном коде (код 0xC0000005) без отчёта.
// Classpath, путь к нативным библиотекам и HeapDumpPath движок задаёт сам — их пропускаем.
const SKIP_JVM = /^(-cp|\$\{classpath\}|-Djava\.library\.path=|-XX:HeapDumpPath=)/;
function vanillaJvmArgs(json, nativesDir) {
  const os = { win32: 'windows', darwin: 'osx', linux: 'linux' }[process.platform];
  const arch = { x64: 'x86_64', ia32: 'x86', arm64: 'arm64' }[process.arch] || process.arch;
  const ruleOk = (rules) =>
    !rules ||
    rules.reduce((ok, r) => {
      const match = (!r.os?.name || r.os.name === os) && (!r.os?.arch || r.os.arch === arch) && !r.features;
      return match ? r.action === 'allow' : ok;
    }, false);
  const vars = {
    natives_directory: nativesDir,
    launcher_name: 'femboy-launcher',
    launcher_version: require('../../package.json').version,
  };
  const out = [];
  for (const a of json.arguments?.jvm || []) {
    const values = typeof a === 'string' ? [a] : ruleOk(a.rules) ? [].concat(a.value) : [];
    for (const v of values) {
      const s = v.replace(/\$\{(\w+)\}/g, (m, k) => vars[k] ?? m);
      if (!SKIP_JVM.test(s) && !/\$\{/.test(s)) out.push(s);
    }
  }
  return out;
}

// Быстрый вход: с 1.20 (снапшот 23w14a) игра понимает --quickPlay*, раньше есть только --server/--port, а входа в мир нет
const QUICKPLAY_FROM = new Date('2023-04-05');
const supportsQuickPlay = (releaseTime) => new Date(releaseTime) >= QUICKPLAY_FROM;
function quickPlay({ server, world } = {}, releaseTime) {
  const modern = supportsQuickPlay(releaseTime);
  if (world) {
    // На старых версиях неизвестный аргумент ломает запуск, поэтому лучше сразу понятная ошибка
    if (!modern) throw new Error('Быстрый вход в мир работает с Minecraft 1.20 и новее');
    return { type: 'singleplayer', identifier: world };
  }
  if (!server) return undefined;
  return { type: modern ? 'multiplayer' : 'legacy', identifier: server };
}

// Java запускаем из папки сборки, как лаунчер Mojang: тогда log4j пишет logs/latest.log, а JVM кладёт отчёт о вылете
// hs_err_pid*.log рядом с игрой, а не в общую папку, и две запущенные сборки не делят один лог. Отчёт о проблеме и разбор
// вылетов (core/report.js, core/crash.js) ищут логи именно здесь.
// Для Minecraft 1.7–1.16 движок запуска скачивает конфиг log4j в рабочую папку и ссылается на него коротким именем. Общий
// конфиг, скачанный раньше, лежит в корне игры: если он есть, указываем его полным путём (в движке поле пишется logj4…)
const LOG4J_OLD = [
  [12, 'log4j2_112-116.xml'],
  [7, 'log4j2_17-111.xml'],
];
function launchOverrides(root, gameDirectory, version) {
  const overrides = { gameDirectory, cwd: gameDirectory };
  const minor = parseInt(String(version).split('.')[1], 10); // у снимков вроде 24w14a здесь NaN: условия ниже не сработают
  const old = minor < 17 ? LOG4J_OLD.find(([from]) => minor >= from) : null;
  const shared = old && path.join(root, old[1]);
  if (shared && fs.existsSync(shared)) overrides.logj4ConfigurationFile = shared;
  return overrides;
}

// Движок запуска отмену не понимает. Если человек нажал «Отменить», ждём не его, а отмену, а игру, которую он всё же
// успеет запустить, сразу закрываем
function raceCancel(promise, onLate) {
  const cancel = net.cancelSignal();
  if (!cancel) return promise;
  return new Promise((resolve, reject) => {
    const stop = () => {
      reject(new net.Cancelled());
      promise.then(onLate, () => {});
    };
    if (cancel.aborted) return stop();
    cancel.addEventListener('abort', stop, { once: true });
    promise.then(
      (v) => (cancel.removeEventListener('abort', stop), resolve(v)),
      (e) => (cancel.removeEventListener('abort', stop), reject(e))
    );
  });
}

async function launch(id, ui, { server, world, whitelist } = {}) {
  if (running.has(id) || launching.has(id)) throw new Error('Эта сборка уже запущена');
  launching.add(id);
  try {
    return await doLaunch(id, ui, { server, world, whitelist });
  } catch (e) {
    // Без связи запускается только то, что уже скачано: первый запуск версии, Java или загрузчика без интернета не обойдётся
    if (!e.cancelled && net.isNetworkError(e)) throw new Error(`${e.message} — без интернета запускается только то, что уже скачано (для первого запуска нужна связь)`);
    throw e;
  } finally {
    launching.delete(id);
  }
}

async function doLaunch(id, ui, { server, world, whitelist } = {}) {
  const inst = instances.get(id);
  const { settings } = store.get();
  const acc = accounts.getActive();
  if (!acc) throw new Error('Сначала добавь аккаунт ♡');
  // Мир проверяем до скачиваний: пропавший мир или версия без быстрого входа — это сразу понятная ошибка
  if (world) {
    worlds.assertWorld(id, world);
    quickPlay({ world }, (await versions.versionMeta(inst.version)).releaseTime);
  }

  ui.status('Проверяю аккаунт…');
  const provider = acc.type === 'elyby' ? 'Ely.by' : 'Microsoft';
  const authorization = await accounts.getAuth(acc, {
    fallback: true, // нет связи с сервером входа — играем без входа, а не отказываем
    onOffline: () => {
      ui.log(`Нет связи с ${provider}: запускаю без входа в аккаунт`, 'info');
      ui.notice?.(`Нет связи с ${provider} — запускаю без входа в аккаунт. Одиночная игра работает, на серверы зайти не получится`);
    },
  });
  net.throwIfCancelled();

  ui.status('Ищу подходящую Java…');
  const { major, component } = await versions.javaInfo(inst.version);
  const ownJava = (inst.javaPath || '').trim() || (settings.javaPath || '').trim();
  let javaPath;
  if (ownJava) {
    // Свою Java проверяем до запуска: слишком старая или пропавшая Java даёт непонятный вылет, а так причина ясна сразу
    javaPath = javafind.normalize(ownJava);
    const c = await javafind.check(javaPath, major);
    if (c.level === 'bad') throw new Error(`${c.message}. Выбери другую Java в настройках или очисти поле: лаунчер скачает нужную сам`);
    if (c.level === 'warn') ui.log(c.message, 'info');
  } else {
    javaPath = await java.ensureJava(
      major,
      (got, total, from) =>
        ui.progress(`Скачиваю Java ${major} (${from}): ${mb(got)}${total ? ' / ' + mb(total) : ''} МБ`, total ? (got / total) * 100 : null),
      component
    );
  }
  ui.log(`Java: ${javaPath}`, 'info');
  net.throwIfCancelled();

  const root = store.paths().root;
  ui.status('Проверяю файлы игры…');
  const fixed = await versions.ensureClientJar(root, inst.version, (got, total) =>
    ui.progress(`Скачиваю Minecraft ${inst.version}: ${mb(got)}${total ? ' / ' + mb(total) : ''} МБ`, total ? (got / total) * 100 : null)
  );
  if (fixed) ui.log(`Клиент ${inst.version} скачан заново (не было или был повреждён)`, 'info');
  net.throwIfCancelled();

  let custom;
  let loaderArgs = [];
  if (versions.LOADER_NAMES[inst.loader]) {
    ui.status(`Устанавливаю ${versions.LOADER_NAMES[inst.loader]}…`);
    const res = await versions.installLoader(root, inst.version, inst.loader, inst.loaderVersion);
    custom = res.id;
    if (!inst.loaderVersion) instances.touch(id, { loaderVersion: res.version });
    // Без своего окна ошибки Fabric сразу завершает игру при несовместимых модах — тогда вылет ловит лаунчер
    if (inst.loader === 'fabric') loaderArgs.push('-Dfabric.noGui=true');
  } else if (forge.NAMES[inst.loader]) {
    const res = await forge.install(root, inst.version, inst.loader, inst.loaderVersion, javaPath, {
      status: ui.status,
      log: (line) => ui.log(line, 'debug'),
    });
    custom = res.id;
    loaderArgs = forge.jvmArgs(root, custom);
    // Запоминаем версию, чтобы выход нового Forge не сломал моды сборки
    if (!inst.loaderVersion) instances.touch(id, { loaderVersion: res.version });
  }
  if (custom) ui.log(`Профиль загрузчика: ${custom}`, 'info');
  net.throwIfCancelled();

  // Библиотеки и ресурсы качаем сами: параллельно, с проверкой и зеркалом
  ui.status('Проверяю библиотеки и ресурсы…');
  const vanillaJson = await versions.versionJson(inst.version);
  const customJson = custom ? JSON.parse(fs.readFileSync(path.join(root, 'versions', custom, custom + '.json'), 'utf8')) : null;
  await gamefiles.prefetch(root, vanillaJson, customJson, ui.progress);
  net.throwIfCancelled();
  // Повторы вроде --add-exports Java допускает, а свойства -D берутся последние — аргументы загрузчика идут после
  loaderArgs = [...vanillaJvmArgs(vanillaJson, path.join(root, 'natives', inst.version)), ...loaderArgs];

  // Ely.by: authlib-injector с их сервером, тогда работают их скины и вход на серверы Ely
  if (acc.type === 'elyby') {
    ui.status('Подключаю Ely.by…');
    try {
      loaderArgs = [...(await elyby.jvmArgs((l) => ui.log(l, 'info'))), ...loaderArgs];
      ui.log('Ely.by подключён ♡', 'info');
    } catch (e) {
      if (e.cancelled) throw e;
      ui.log(`Ely.by не подключён: ${e.message}`, 'error');
    }
  }

  // Скин оффлайн-аккаунта: подключаем authlib-injector к локальному серверу скинов
  if (acc.type === 'offline' && acc.skin) {
    ui.status('Подключаю скин…');
    try {
      const skinArgs = await yggdrasil.jvmArgs(
        (l) => ui.log(l, 'info'),
        (l) => ui.log(l, 'debug')
      );
      loaderArgs = [...skinArgs, ...loaderArgs];
      ui.log('Скин подключён ♡', 'info');
    } catch (e) {
      ui.log(`Скин не подключён: ${e.message}`, 'error');
    }
  }

  const gameDirectory = instances.gameDir(id);
  fs.mkdirSync(gameDirectory, { recursive: true });
  // Друзьям без лицензии белый список пишем файлом: команда /whitelist add считает UUID от ника в нижнем регистре, и друг
  // с заглавными буквами в нике не проходит. Сбой записи запуску не мешает
  if (whitelist?.length) {
    try {
      const r = await friendlist.sync(gameDirectory, whitelist);
      const nicks = whitelist.map((w) => (typeof w === 'string' ? w : w?.nick)).filter(Boolean);
      if (r.added.length || r.removed.length) ui.log(`Белый список друзей записан: ${nicks.join(', ')}`, 'info');
    } catch (e) {
      ui.log(`Белый список друзей не записан: ${e.message}`, 'error');
    }
  }

  const max = inst.maxRam || settings.maxRam;
  const min = Math.min(settings.minRam, max);
  const jvmExtra = [settings.jvmArgs, inst.jvmArgs].join(' ').split(/\s+/).filter(Boolean);
  ui.log(`Память: ${max} МБ, на старте ${min} МБ${jvmExtra.length ? ` · свои аргументы JVM: ${jvmExtra.join(' ')}` : ''}`, 'info');
  // Java системный прокси не видит: моды с выходом в интернет (e4mc и другие) без него не работают, когда сеть открыта только через VPN-прокси.
  // Настройка «Передавать игре прокси лаунчера» (gameProxy) выключает это целиком: запасной выход, если флаги прокси мешают игре или моду
  const gameProxy = settings.gameProxy === false ? { args: [], note: 'Прокси лаунчера для игры отключён в настройках' } : (await ui.javaProxy?.().catch(() => null)) || { args: [] };
  if (gameProxy.note) ui.log(gameProxy.note, 'info');
  const win = inst.window || {};
  const info = await versions.versionMeta(inst.version); // без списка версий (нет связи) тип и дату берёт из профиля на диске
  const tail = [];
  const client = new Client();
  client.on('debug', (m) => ui.log(String(m).trimEnd(), 'debug'));
  client.on('data', (m) =>
    String(m)
      .split(/\r?\n/)
      .filter(Boolean)
      .forEach((l) => {
        tail.push(l);
        if (tail.length > 400) tail.shift();
        ui.log(l, 'game');
      })
  );
  client.on('progress', (p) => ui.progress(`Скачиваю ${TASKS[p.type] || p.type}: ${p.task} / ${p.total}`, p.total ? (p.task / p.total) * 100 : null));

  client.on('close', (code) => {
    const run = running.get(id);
    running.delete(id);
    if (!run) return;
    try {
      const cur = instances.get(id);
      instances.touch(id, { playtime: (cur.playtime || 0) + (Date.now() - run.startedAt) });
    } catch {}
    // «Время в игре»: сессия в журнал (сбой журнала закрытию игры не мешает)
    try {
      playlog.add(id, run.startedAt, Date.now());
    } catch {}
    // Вылет: ненулевой код, и игру закрыли не мы. Быстрое закрытие в первые секунды — тоже вылет
    const crashed = !run.killed && code !== 0;
    const analysis = crashed ? crash.analyze({ gameDir: gameDirectory, startedAt: run.startedAt, logTail: tail, code }) : null;
    // Что изменилось с последнего удачного запуска: окно вылета назовёт перемены (не виновников) и предложит откат (сбой сравнения вылет не скрывает)
    if (analysis) {
      try {
        analysis.sinceGood = snapshots.sinceGood(id);
      } catch {
        analysis.sinceGood = null;
      }
    }
    ui.closed(code, analysis);
    // «Последний удачный запуск»: нормальный выход после настоящей игры, моды за это время не менялись (новый мод в игру не попал), поиск
    // виновника не идёт. Сбой запуску не мешает, но в консоли виден
    try {
      if (!run.killed && code === 0 && Date.now() - run.startedAt >= GOOD_MIN_MS && !bisect.isActive(id) && snapshots.modsSig(id) === run.modsAtLaunch) snapshots.markGood(id);
    } catch (e) {
      ui.log(`Точка восстановления «последний удачный запуск» не сохранилась: ${e.message}`, 'error');
    }
  });

  // Ноутбук с двумя видеокартами: просим Windows запускать Java на мощной (если это включено в настройках)
  if (settings.gpuHigh) {
    try {
      await gpu.ensure(javaPath);
    } catch (e) {
      ui.log(`Видеокарта: ${e.message}`, 'error');
    }
  }

  net.throwIfCancelled();
  // Моды в тот миг, когда игра стартует: по ним на выходе видно, что за время игры они не менялись
  let modsAtLaunch = null;
  try {
    modsAtLaunch = snapshots.modsSig(id);
  } catch {}
  ui.status(world ? `Запускаю и захожу в мир «${world}»…` : server ? `Запускаю и захожу на ${server}…` : 'Запускаю игру…');
  const proc = await raceCancel(
    client.launch({
      authorization,
      root,
      version: { number: inst.version, type: info.type, custom },
      memory: { max, min },
      javaPath,
      customArgs: [...loaderArgs, ...gameProxy.args, ...jvmExtra],
      window: win.width && win.height ? { width: win.width, height: win.height, fullscreen: !!win.fullscreen } : win.fullscreen ? { fullscreen: true } : undefined,
      quickPlay: quickPlay({ server, world }, info.releaseTime),
      overrides: launchOverrides(root, gameDirectory, inst.version),
    }),
    (late) => late?.kill()
  );
  if (!proc) throw new Error('Игра не запустилась — подробности во вкладке «Консоль»');
  // A failed spawn still returns a ChildProcess, but without a pid. Do not mark
  // it as running before its asynchronous error has been observed.
  if (typeof proc.on === 'function') proc.on('error', (e) => ui.log(`Не удалось запустить Java: ${e.message}`, 'error'));
  if (typeof proc.once === 'function' && !proc.pid) {
    await new Promise((resolve, reject) => {
      const cleanup = () => { proc.removeListener('spawn', started); proc.removeListener('error', failed); };
      const started = () => { cleanup(); resolve(); };
      const failed = (e) => { cleanup(); reject(e); };
      proc.once('spawn', started);
      proc.once('error', failed);
    });
  }

  running.set(id, { proc, startedAt: Date.now(), killed: false, modsAtLaunch });
  instances.touch(id, { lastPlayed: Date.now() });
  ui.started();
}

function kill(id) {
  const run = running.get(id);
  if (!run) return;
  run.killed = true;
  run.proc.kill();
}

module.exports = {
  launch,
  kill,
  isRunning: (id) => (id ? running.has(id) : running.size > 0),
  runningIds: () => [...running.keys()],
  quickPlay,
  supportsQuickPlay,
  launchOverrides,
};
