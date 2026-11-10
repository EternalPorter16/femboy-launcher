// Forge и NeoForge: качаем официальный установщик и запускаем его без окна (--installClient) в общую папку игры.
// Получившийся профиль versions/<id>/<id>.json запускается как обычная custom-версия.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const AdmZip = require('adm-zip');
const net = require('./net');
const fsx = require('./fsx');

const { getJson, download } = net;

const FORGE_MAVEN = 'https://maven.minecraftforge.net/net/minecraftforge/forge';
const NEO_MAVEN = 'https://maven.neoforged.net/releases/net/neoforged';
const NAMES = { forge: 'Forge', neoforge: 'NeoForge' };

// NeoForge нумерует версии по версии игры: 1.21.1 → 21.1.x, 1.21 → 21.0.x
function neoPrefix(mc) {
  const m = /^1\.(\d+)(?:\.(\d+))?$/.exec(mc);
  return m ? `${m[1]}.${m[2] || 0}.` : `${mc}.`;
}

function compareDesc(a, b) {
  const pa = a.split(/[.+-]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.split(/[.+-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pb[i] || 0) - (pa[i] || 0);
  }
  return 0;
}

async function latestVersion(loader, mc) {
  if (loader === 'forge') {
    const { promos } = await getJson('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json');
    const v = promos[`${mc}-recommended`] || promos[`${mc}-latest`];
    if (!v) throw new Error(`Forge для ${mc} не найден`);
    return v;
  }
  // Для 1.20.1 NeoForge ещё публиковался под старым именем net.neoforged:forge
  const artifact = mc === '1.20.1' ? 'forge' : 'neoforge';
  const { versions } = await getJson(`https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/${artifact}`);
  const prefix = mc === '1.20.1' ? '1.20.1-' : neoPrefix(mc);
  const all = versions.filter((v) => v.startsWith(prefix));
  const stable = all.filter((v) => !/beta|alpha|rc/i.test(v));
  const pick = (stable.length ? stable : all).sort(compareDesc)[0];
  if (!pick) throw new Error(`NeoForge для ${mc} не найден`);
  return mc === '1.20.1' ? pick.slice('1.20.1-'.length) : pick;
}

// Все версии под игру mc (в любом порядке) и то, что Forge сам считает рекомендуемым и свежим: для выбора версии в настройках
async function versionList(loader, mc) {
  if (loader === 'forge') {
    const meta = await getJson('https://files.minecraftforge.net/net/minecraftforge/forge/maven-metadata.json');
    // «1.20.1-47.4.28» → «47.4.28»; версии с хвостами для совсем старых игр (1.7.10-…-1.7.10) не берём
    const versions = (meta[mc] || []).map((v) => (v.startsWith(mc + '-') ? v.slice(mc.length + 1) : '')).filter((v) => /^\d+(\.\d+)*$/.test(v));
    if (!versions.length) throw new Error(`Forge для ${mc} не найден`);
    let promos = {};
    try {
      promos = (await getJson('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json')).promos || {};
    } catch (e) {
      if (e.cancelled) throw e; // подсказки «рекомендуемая» — удобство, без них список всё равно полезен
    }
    return { versions, recommended: promos[`${mc}-recommended`] || null, latest: promos[`${mc}-latest`] || null };
  }
  const artifact = mc === '1.20.1' ? 'forge' : 'neoforge';
  const { versions } = await getJson(`https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/${artifact}`);
  const prefix = mc === '1.20.1' ? '1.20.1-' : neoPrefix(mc);
  const found = versions.filter((v) => v.startsWith(prefix)).map((v) => (mc === '1.20.1' ? v.slice(prefix.length) : v));
  if (!found.length) throw new Error(`NeoForge для ${mc} не найден`);
  return { versions: found, recommended: null, latest: null };
}

function installerUrl(loader, mc, ver) {
  if (loader === 'forge') return `${FORGE_MAVEN}/${mc}-${ver}/forge-${mc}-${ver}-installer.jar`;
  if (mc === '1.20.1') return `${NEO_MAVEN}/forge/1.20.1-${ver}/forge-1.20.1-${ver}-installer.jar`;
  return `${NEO_MAVEN}/neoforge/${ver}/neoforge-${ver}-installer.jar`;
}

function readProfile(installer) {
  const zip = new AdmZip(installer);
  const profile = JSON.parse(zip.readAsText('install_profile.json'));
  if (!profile.version || profile.install) throw new Error('Этот Forge слишком старый (поддерживается 1.12.2 и новее)');
  return profile.version;
}

// Установщик запускает дочерние процессы Java, так что на Windows закрываем всё дерево сразу
function killTree(proc) {
  if (process.platform === 'win32' && proc.pid) spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => proc.kill());
  else proc.kill();
}

function runInstaller(javaPath, installer, root, log) {
  // Для консоли нужен java.exe, а не javaw.exe
  const java = javaPath.replace(/javaw(\.exe)?$/i, (m, ext) => 'java' + (ext || ''));
  return new Promise((resolve, reject) => {
    const cancel = net.cancelSignal();
    if (cancel?.aborted) return reject(new net.Cancelled());
    const tail = [];
    const proc = spawn(fs.existsSync(java) ? java : javaPath, ['-jar', installer, '--installClient', root], { cwd: root, windowsHide: true });
    // «Отменить» закрывает установщик, а не ждёт, пока он закончит сам
    const stop = () => (killTree(proc), reject(new net.Cancelled()));
    cancel?.addEventListener('abort', stop, { once: true });
    const onData = (d) =>
      String(d)
        .split(/\r?\n/)
        .filter(Boolean)
        .forEach((line) => {
          tail.push(line);
          if (tail.length > 12) tail.shift();
          log(line);
        });
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('error', (e) => (cancel?.removeEventListener('abort', stop), reject(e)));
    proc.on('close', (code) => {
      cancel?.removeEventListener('abort', stop);
      code === 0 ? resolve() : reject(new Error(`Установщик завершился с ошибкой (код ${code}):\n${tail.join('\n')}`));
    });
  });
}

// Возвращает id версии для запуска (например 1.20.1-forge-47.4.0 или neoforge-21.1.77)
async function install(root, mc, loader, ver, javaPath, { log = () => {}, status = () => {} } = {}) {
  if (!NAMES[loader]) throw new Error('Неизвестный загрузчик ' + loader);
  ver = (ver || (await latestVersion(loader, mc))).replace(/^1\.20\.1-/, '');

  const installersDir = path.join(root, 'installers');
  fs.mkdirSync(installersDir, { recursive: true });
  const installer = path.join(installersDir, `${loader}-${mc}-${ver}-installer.jar`);
  if (!fs.existsSync(installer)) {
    status(`Скачиваю установщик ${NAMES[loader]} ${ver}…`);
    try {
      await download(installerUrl(loader, mc, ver), installer + '.part');
    } catch (e) {
      // Версию выбрали руками (или она из старого модпака), а такой у загрузчика нет: говорим об этом, а не «HTTP 404»
      if (e.status === 404) throw new Error(`${NAMES[loader]} ${ver} для Minecraft ${mc} не найден — выбери другую версию загрузчика в настройках сборки`);
      throw e;
    }
    fs.renameSync(installer + '.part', installer);
  }

  const id = readProfile(installer);
  const versionDir = path.join(root, 'versions', id);
  const marker = path.join(versionDir, '.installed');
  if (!fs.existsSync(marker)) {
    // Установщик требует файл профилей официального лаунчера
    const profiles = path.join(root, 'launcher_profiles.json');
    if (!fs.existsSync(profiles)) fsx.writeJsonAtomic(profiles, { profiles: {} });
    // Установщик сам качает библиотеки; при обрыве сети просто запускаем его ещё раз — скачанное он не повторяет
    for (let attempt = 1; ; attempt++) {
      net.throwIfCancelled();
      status(`Устанавливаю ${NAMES[loader]} ${ver}${attempt > 1 ? ` (попытка ${attempt})` : ''} — при первом запуске это 1–3 минуты…`);
      try {
        await runInstaller(javaPath, installer, root, log);
        break;
      } catch (e) {
        if (e.cancelled || attempt >= 3) throw e;
        log(`Установщик упал, пробую ещё раз: ${e.message.split('\n')[0]}`);
        // Сбои сети/DNS обычно кратковременные — даём им пройти (пауза прерывается отменой)
        await net.sleep(attempt * 8000);
      }
    }
    if (!fs.existsSync(path.join(versionDir, id + '.json'))) throw new Error(`Установщик не создал профиль ${id}`);
    fs.writeFileSync(marker, new Date().toISOString());
  }

  // Официальный лаунчер кладёт клиент под именем профиля — Forge на это рассчитывает (ignoreList)
  const jar = path.join(versionDir, id + '.jar');
  const vanillaJar = path.join(root, 'versions', mc, mc + '.jar');
  if (!fs.existsSync(jar) && fs.existsSync(vanillaJar)) fs.copyFileSync(vanillaJar, jar);
  return { id, version: ver };
}

// JVM-аргументы из профиля (модульная система Forge 1.17+), с подстановкой переменных
function jvmArgs(root, id) {
  const json = JSON.parse(fs.readFileSync(path.join(root, 'versions', id, id + '.json'), 'utf8'));
  const vars = {
    library_directory: path.join(root, 'libraries'),
    classpath_separator: path.delimiter,
    version_name: id,
  };
  return (json.arguments?.jvm || [])
    .filter((a) => typeof a === 'string')
    .map((a) => a.replace(/\$\{(\w+)\}/g, (m, k) => vars[k] ?? m));
}

module.exports = { install, jvmArgs, latestVersion, versionList, NAMES };
