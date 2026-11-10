// Другие лаунчеры на компьютере: находим их сборки, миры и паки, переносим к себе (копией или «на месте»)
// и потом, по желанию, помогаем освободить место — старые копии уходят в Корзину, программы удаляются
// их собственным деинсталлятором. Сами чужие лаунчеры только читаем.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');
const AdmZip = require('adm-zip');
const store = require('./store');
const instances = require('./instances');

// FEMBOY_OTHER_ROOT — подменная «домашняя папка» для проверки на ненастоящих данных
function bases() {
  const fake = process.env.FEMBOY_OTHER_ROOT;
  const home = fake || require('os').homedir();
  const appData = fake ? path.join(fake, 'AppData', 'Roaming') : process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  const localAppData = fake ? path.join(fake, 'AppData', 'Local') : process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  // Диски проверяем осторожно (см. listDir): отключённый сетевой диск не должен подвесить поиск
  const drives = fake ? [path.join(fake, 'Drives', 'D'), path.join(fake, 'Drives', 'E')] : 'CDEFGH'.split('').map((l) => l + ':\\');
  return { home, appData, localAppData, drives, fake: !!fake };
}

const readJson = (f) => {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, ''));
  } catch {
    return null;
  }
};
// .properties Java: «ключ=значение», в значениях \\ \: \uXXXX — так TLauncher и Legacy Launcher хранят свои настройки
function readProps(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  } catch {
    return null;
  }
  const un = (s) => s.replace(/\\u([0-9a-fA-F]{4})|\\(.)/g, (m, hex, ch) => (hex ? String.fromCharCode(parseInt(hex, 16)) : { t: '\t', n: '\n', r: '\r' }[ch] || ch));
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line[0] === '#' || line[0] === '!') continue;
    const m = /^((?:\\.|[^=:\s\\])+)\s*[=:]?\s*(.*)$/.exec(line);
    if (m) out[un(m[1])] = un(m[2]);
  }
  return out;
}
const isDir = (p) => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};
const subdirs = (p) => {
  try {
    return fs.readdirSync(p, { withFileTypes: true }).filter((e) => e.isDirectory() || e.isSymbolicLink()).map((e) => path.join(p, e.name)).filter(isDir);
  } catch {
    return [];
  }
};
const keyOf = (p) => crypto.createHash('sha1').update(path.resolve(p).toLowerCase()).digest('hex').slice(0, 16);
const LOADER_IDS = ['fabric', 'quilt', 'forge', 'neoforge'];
const normLoader = (s) => {
  const l = String(s || '').toLowerCase().replace(/[^a-z]/g, '');
  return LOADER_IDS.includes(l) ? l : 'vanilla';
};

// Сколько весит папка, сколько в ней файлов и когда менялся самый свежий (по ссылкам не ходим)
async function measure(p) {
  let size = 0;
  let count = 0;
  let mtime = 0;
  const walk = async (dir) => {
    let list;
    try {
      list = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of list) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.isFile()) {
        try {
          const st = await fs.promises.stat(full);
          size += st.size;
          count++;
          mtime = Math.max(mtime, st.mtimeMs);
        } catch {}
      }
    }
  };
  try {
    const st = await fs.promises.stat(p);
    if (st.isDirectory()) await walk(p);
    else ((size = st.size), (count = 1), (mtime = st.mtimeMs));
  } catch {}
  return { size, count, mtime };
}

/* ---------- версии игры из чужих профилей ---------- */

// Профиль версии (versions/<id>/<id>.json) → версия игры и загрузчик. Понимает и «склеенные» профили TLauncher
function profileInfo(id, json) {
  const libs = (json?.libraries || []).map((l) => String(l.name || ''));
  const lib = (re) => libs.map((n) => re.exec(n)).find(Boolean);
  let loader = 'vanilla';
  let loaderVersion = null;
  let m;
  if ((m = lib(/^net\.fabricmc:fabric-loader:(.+)$/))) [loader, loaderVersion] = ['fabric', m[1]];
  else if ((m = lib(/^org\.quiltmc:quilt-loader:(.+)$/))) [loader, loaderVersion] = ['quilt', m[1]];
  else if ((m = lib(/^net\.neoforged:(?:neoforge|forge):(.+?)(?::|$)/))) [loader, loaderVersion] = ['neoforge', m[1].replace(/^1\.20\.1-/, '')];
  else if ((m = lib(/^net\.minecraftforge:(?:forge|fmlloader):[\d.]+-([\d.]+)/))) [loader, loaderVersion] = ['forge', m[1]];
  else if (/^fabric-loader-/.test(id)) [loader, loaderVersion] = ['fabric', id.split('-')[2]];
  else if (/^quilt-loader-/.test(id)) [loader, loaderVersion] = ['quilt', id.split('-')[2]];
  else if (/^neoforge-/.test(id)) [loader, loaderVersion] = ['neoforge', id.slice(9)];
  else if ((m = /forge-?([\d.]+)$/i.exec(id))) [loader, loaderVersion] = ['forge', m[1]];
  const version = json?.inheritsFrom || /^\d+\.\d+(\.\d+)?$/.exec(json?.jar || '')?.[0] || /\b1\.\d+(\.\d+)?\b/.exec(id)?.[0] || null;
  return version ? { version, loader, loaderVersion: loaderVersion || null } : null;
}

// Версию неизвестной сборки угадываем по модам: загрузчик — по формату, версию игры — по условию "minecraft"
function guessFromMods(gameDir) {
  const dir = path.join(gameDir, 'mods');
  let jars = [];
  try {
    jars = fs.readdirSync(dir).filter((f) => f.endsWith('.jar')).slice(0, 40);
  } catch {}
  const votes = {};
  let version = null;
  for (const f of jars) {
    try {
      const zip = new AdmZip(path.join(dir, f));
      const fab = zip.readAsText('fabric.mod.json');
      const toml = zip.readAsText('META-INF/neoforge.mods.toml') || zip.readAsText('META-INF/mods.toml');
      let loader = null;
      let range = '';
      if (fab) {
        loader = zip.getEntry('quilt.mod.json') ? 'quilt' : 'fabric';
        const dep = JSON.parse(fab.replace(/^﻿/, '')).depends?.minecraft;
        range = Array.isArray(dep) ? dep[0] : dep || '';
      } else if (toml) {
        loader = zip.getEntry('META-INF/neoforge.mods.toml') ? 'neoforge' : 'forge';
        range = /modId\s*=\s*"minecraft"[\s\S]*?versionRange\s*=\s*"([^"]*)"/.exec(toml)?.[1] || '';
      }
      if (loader) votes[loader] = (votes[loader] || 0) + 1;
      version = version || /1\.\d+(\.\d+)?/.exec(String(range))?.[0] || null;
    } catch {}
  }
  const loader = Object.entries(votes).sort((a, b) => b[1] - a[1])[0]?.[0] || 'vanilla';
  return { version, loader, loaderVersion: null };
}

/* ---------- где и как лежат сборки у разных лаунчеров ---------- */

// Prism / PolyMC: папка сборок может быть переназначена в настройках
function mmcRoots(root, cfgName) {
  const cfg = path.join(root, cfgName);
  let dir = path.join(root, 'instances');
  try {
    const v = /^InstanceDir=(.+)$/m.exec(fs.readFileSync(cfg, 'utf8'))?.[1]?.trim();
    if (v) dir = path.isAbsolute(v) ? v : path.join(root, v);
  } catch {}
  return [dir];
}

function mmcInstance(dir) {
  const pack = readJson(path.join(dir, 'mmc-pack.json'));
  if (!pack) return null;
  const mc = pack.components?.find((c) => c.uid === 'net.minecraft');
  const MAP = { 'net.fabricmc.fabric-loader': 'fabric', 'org.quiltmc.quilt-loader': 'quilt', 'net.minecraftforge': 'forge', 'net.neoforged': 'neoforge' };
  const lc = pack.components?.find((c) => MAP[c.uid]);
  let name = path.basename(dir);
  try {
    name = /^name=(.+)$/m.exec(fs.readFileSync(path.join(dir, 'instance.cfg'), 'utf8'))?.[1]?.trim() || name;
  } catch {}
  const gameDir = ['.minecraft', 'minecraft'].map((d) => path.join(dir, d)).find(isDir);
  if (!gameDir) return null;
  return { name, gameDir, home: dir, version: mc?.version || null, loader: lc ? MAP[lc.uid] : 'vanilla', loaderVersion: lc?.version || null };
}

function curseforgeInstance(dir) {
  const j = readJson(path.join(dir, 'minecraftinstance.json'));
  if (!j) return null;
  const [loader, ...rest] = String(j.baseModLoader?.name || '').split('-');
  return { name: j.name || path.basename(dir), gameDir: dir, home: dir, version: j.gameVersion || j.baseModLoader?.minecraftVersion || null, loader: normLoader(loader), loaderVersion: rest.join('-') || null };
}

function modrinthInstance(dir) {
  const j = readJson(path.join(dir, 'profile.json'));
  const meta = j?.metadata;
  if (meta) return { name: meta.name || path.basename(dir), gameDir: dir, home: dir, version: meta.game_version || null, loader: normLoader(meta.loader), loaderVersion: meta.loader_version?.id || null };
  // Новые версии Modrinth App хранят описание в базе — угадываем по модам
  return { name: path.basename(dir), gameDir: dir, home: dir, ...guessFromMods(dir), guessed: true };
}

function atlInstance(dir) {
  const j = readJson(path.join(dir, 'instance.json'));
  if (!j) return null;
  const lv = j.launcher?.loaderVersion;
  return { name: j.launcher?.name || path.basename(dir), gameDir: dir, home: dir, version: j.id || j.minecraftVersion || null, loader: normLoader(lv?.type), loaderVersion: lv?.version || null };
}

function gdlInstance(dir) {
  const legacy = readJson(path.join(dir, 'config.json'))?.loader;
  if (legacy) return { name: path.basename(dir), gameDir: dir, home: dir, version: legacy.mcVersion || null, loader: normLoader(legacy.loaderType), loaderVersion: legacy.loaderVersion || null };
  const j = readJson(path.join(dir, 'instance.json'));
  const v = j?.game_configuration?.version;
  if (!v) return null;
  const ml = (v.modloaders || [])[0];
  const gameDir = isDir(path.join(dir, 'instance')) ? path.join(dir, 'instance') : dir;
  return { name: j.name || path.basename(dir), gameDir, home: dir, version: v.release || null, loader: normLoader(ml?.type), loaderVersion: ml?.version || null };
}

// Описание всех лаунчеров: откуда брать сборки и как называется их деинсталлятор в Windows
function launchers() {
  const { home, appData } = bases();
  const many = (roots, read) => roots.flatMap(subdirs).map((d) => read(d)).filter(Boolean);
  // dirs — папки самого лаунчера: по ним показываем, откуда взято, и не ищем их второй раз как «неизвестные»
  return [
    { id: 'prism', name: 'Prism Launcher', dirs: [path.join(appData, 'PrismLauncher')], uninstall: /^Prism Launcher/i, instances: () => many(mmcRoots(path.join(appData, 'PrismLauncher'), 'prismlauncher.cfg'), mmcInstance) },
    { id: 'polymc', name: 'PolyMC', dirs: [path.join(appData, 'PolyMC')], uninstall: /^PolyMC/i, instances: () => many(mmcRoots(path.join(appData, 'PolyMC'), 'polymc.cfg'), mmcInstance) },
    { id: 'curseforge', name: 'CurseForge', dirs: [path.join(home, 'curseforge'), path.join(home, 'Documents', 'Curse')], uninstall: /^CurseForge/i, instances: () => many([path.join(home, 'curseforge', 'minecraft', 'Instances'), path.join(home, 'Documents', 'Curse', 'Minecraft', 'Instances')], curseforgeInstance) },
    { id: 'modrinth', name: 'Modrinth App', dirs: [path.join(appData, 'ModrinthApp'), path.join(appData, 'com.modrinth.theseus')], uninstall: /^Modrinth App/i, instances: () => many([path.join(appData, 'ModrinthApp', 'profiles'), path.join(appData, 'com.modrinth.theseus', 'profiles')], modrinthInstance) },
    { id: 'atlauncher', name: 'ATLauncher', dirs: [path.join(appData, 'ATLauncher')], uninstall: /^ATLauncher/i, instances: () => many([path.join(appData, 'ATLauncher', 'instances')], atlInstance) },
    { id: 'gdlauncher', name: 'GDLauncher', dirs: [path.join(appData, 'gdlauncher_next'), path.join(appData, 'gdlauncher_carbon')], uninstall: /^GDLauncher/i, instances: () => many([path.join(appData, 'gdlauncher_next', 'instances'), path.join(appData, 'gdlauncher_carbon', 'data', 'instances')], gdlInstance) },
  ];
}

// Общая папка .minecraft: официальный лаунчер, TLauncher, Legacy Launcher (TL Legacy) и большинство других
const DOT_FOLDERS = { resourcepacks: 'Ресурспаки', shaderpacks: 'Шейдеры', mods: 'Моды', screenshots: 'Скриншоты' };
const DOT_EXTRAS = ['servers.dat', 'options.txt', 'optionsof.txt', 'optionsshaders.txt'];
const PROFILE_FILES = ['launcher_profiles.json', 'tlauncher_profiles.json', 'TlauncherProfiles.json'];

const isFile = (p) => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};
const norm = (p) => path.resolve(p).toLowerCase();

// Настройки TLauncher и Legacy Launcher (он же TL Legacy): лежат в %APPDATA%\.tlauncher, там же сказано, где игра
// (minecraft.gamedir) — её можно было перенести с .minecraft на любой диск
function tlSettings() {
  const dir = path.join(bases().appData, '.tlauncher');
  const out = [];
  for (const [file, name] of [['legacy.properties', 'Legacy Launcher'], ['tlauncher-2.0.properties', 'TLauncher'], ['tlauncher.properties', 'TLauncher']]) {
    const p = readProps(path.join(dir, file));
    if (p) out.push({ name, gameDir: (p['minecraft.gamedir'] || '').trim() || null });
  }
  return out;
}

// Папка похожа на папку игры: есть моды, миры, настройки или сервера
const looksLikeGame = (dir) => ['mods', 'saves', 'resourcepacks', 'shaderpacks', 'config'].some((d) => isDir(path.join(dir, d))) || ['options.txt', 'servers.dat'].some((f) => isFile(path.join(dir, f)));
// Построже, для папок, найденных наугад (options.txt есть у многих программ): нужен настоящий мир или настройки игры
// вместе с папкой, какие бывают только у Minecraft
const looksLikeGameStrict = (dir) =>
  subdirs(path.join(dir, 'saves')).some((w) => isFile(path.join(w, 'level.dat'))) ||
  (['options.txt', 'servers.dat'].some((f) => isFile(path.join(dir, f))) && ['saves', 'mods', 'resourcepacks', 'shaderpacks', 'logs'].some((d) => isDir(path.join(dir, d))));

// Какая версия у сборки из подпапки Legacy Launcher: в режиме «по версиям» имя папки — это id версии, в режиме
// «по семействам» — «1.8», «Forge-1.12» (а у id вида «Forge 1.12.2» загрузчик отделён пробелом)
function homeInfo(name, profiles, gameDir) {
  const known = (p) => ({ version: p.version, loader: p.loader, loaderVersion: p.loaderVersion });
  const exact = profiles.find((p) => p.id === name);
  if (exact) return known(exact);
  const m = /^(?:(forge|fabric|quilt|neoforge)[-_ ]?)?(\d+\.\d+(?:\.\d+)?)$/i.exec(name);
  if (m) {
    const loader = normLoader(m[1]);
    const same = profiles.filter((p) => p.loader === loader && p.version && (p.version === m[2] || p.version.startsWith(m[2] + '.')));
    return same.length ? { ...known(same[0]), guessed: true } : { version: m[2], loader, loaderVersion: null, guessed: true };
  }
  // Профиля версии нет (её удалили): версию берём из имени, а загрузчик, если из имени не понятен, — из модов в папке
  const fromId = profileInfo(name, null);
  const mods = guessFromMods(gameDir);
  if (!fromId) return { ...mods, guessed: true };
  return { ...fromId, loader: fromId.loader === 'vanilla' ? mods.loader : fromId.loader, guessed: true };
}

// Устройство общей папки: установленные версии и сборки, у которых своя игровая папка
function rootInfo(dir) {
  const profiles = [];
  const separated = [];
  for (const vdir of subdirs(path.join(dir, 'versions'))) {
    const id = path.basename(vdir);
    const info = profileInfo(id, readJson(path.join(vdir, id + '.json')));
    if (!info) continue;
    let mtime = 0;
    try {
      mtime = fs.statSync(vdir).mtimeMs;
    } catch {}
    // Отдельная папка игры у версии (так TLauncher хранит свои сборки с модами)
    const own = ['saves', 'mods'].some((s) => isDir(path.join(vdir, s)));
    if (own) separated.push({ name: id, gameDir: vdir, home: vdir, ...info });
    profiles.push({ id, ...info, mtime, own });
  }
  // Для общей папки сначала предлагаем обычные версии, свежие — выше
  profiles.sort((a, b) => a.own - b.own || b.mtime - a.mtime);
  // Legacy Launcher с включёнными «подпапками» раскладывает сборки по home/<семейство или версия>
  for (const h of subdirs(path.join(dir, 'home')).filter(looksLikeGame)) separated.push({ name: path.basename(h), gameDir: h, home: h, ...homeInfo(path.basename(h), profiles, h) });
  // Сборки TLauncher в modpacks/<имя>
  for (const m of subdirs(path.join(dir, 'modpacks')).filter(looksLikeGame)) separated.push({ name: path.basename(m), gameDir: m, home: m, ...guessFromMods(m), guessed: true });
  // Профили лаунчера (launcher_profiles.json и такие же у TLauncher), которым назначена своя папка игры
  for (const f of PROFILE_FILES) {
    for (const [key, p] of Object.entries(readJson(path.join(dir, f))?.profiles || {})) {
      const gd = typeof p?.gameDir === 'string' ? p.gameDir.trim() : '';
      if (!gd || !path.isAbsolute(gd) || !isDir(gd) || norm(gd) === norm(dir) || !looksLikeGame(gd)) continue;
      const vid = typeof p.lastVersionId === 'string' && !/^latest/i.test(p.lastVersionId) ? p.lastVersionId : null;
      const info = vid ? homeInfo(vid, profiles, gd) : { ...guessFromMods(gd), guessed: true };
      separated.push({ name: String(p.name || key).slice(0, 60), gameDir: gd, home: gd, ...info, guessed: !profiles.some((x) => x.id === vid) });
    }
  }
  return { dir, profiles, separated };
}

// Всё, что можно забрать из общей папки: миры, паки, настройки и сборки с собственной папкой
// used — игровые папки, которые уже попали в список (одну сборку не предлагаем дважды)
function rootGroup(dir, id, name, used) {
  const info = rootInfo(dir);
  const items = [];
  for (const w of subdirs(path.join(dir, 'saves')).filter((w) => fs.existsSync(path.join(w, 'level.dat')))) {
    items.push({ type: 'world', name: path.basename(w), src: w, trash: w, dest: path.join('saves', path.basename(w)), linkable: true });
  }
  for (const [folder, label] of Object.entries(DOT_FOLDERS)) {
    const p = path.join(dir, folder);
    let n = 0;
    try {
      n = fs.readdirSync(p).length;
    } catch {}
    if (n) items.push({ type: 'folder', name: label, count: n, src: p, trash: p, dest: folder });
  }
  const extras = DOT_EXTRAS.map((f) => path.join(dir, f)).filter((f) => fs.existsSync(f));
  if (extras.length) items.push({ type: 'extras', name: 'Серверы и настройки игры', src: dir, files: extras, trash: null, dest: '' });
  for (const s of info.separated) {
    if (used.has(norm(s.gameDir))) continue;
    used.add(norm(s.gameDir));
    items.push({ type: 'instance', ...s, src: s.gameDir, trash: s.home, linkable: true });
  }
  return items.length ? { id, name, kind: 'root', target: true, path: dir, profiles: info.profiles, items } : null;
}

// Как назвать общую папку: какие лаунчеры в ней хозяйничают
function rootName(dir, names = []) {
  const set = new Set(names.filter((n) => n && !/^minecraft$/i.test(n)));
  if (!set.has('Legacy Launcher') && PROFILE_FILES.slice(1).some((f) => isFile(path.join(dir, f)))) set.add('TLauncher');
  if (isFile(path.join(dir, 'hmclversion.cfg'))) set.add('HMCL');
  return [...set, 'Minecraft'].join(' / ');
}

/* ---------- лаунчеры, которых нет в списке: ищем по устройству папок ---------- */

// По имени папки или программы понимаем, чей это лаунчер. Порядок важен: Legacy раньше TLauncher
const NAME_HINTS = [
  [/legacy/i, 'Legacy Launcher'],
  [/tlauncher/i, 'TLauncher'],
  [/prism/i, 'Prism Launcher'],
  [/multimc/i, 'MultiMC'],
  [/polymc/i, 'PolyMC'],
  [/manymc/i, 'ManyMC'],
  [/fjord/i, 'Fjord Launcher'],
  [/ultimmc/i, 'UltimMC'],
  [/hmcl/i, 'HMCL'],
  [/(^|[^a-z])pcl(2|[^a-z]|$)|plain ?craft/i, 'PCL'],
  [/sklauncher|sk-?launcher/i, 'SKLauncher'],
  [/bakaxl/i, 'BakaXL'],
  [/lunar/i, 'Lunar Client'],
  [/badlion/i, 'Badlion'],
  [/feather/i, 'Feather'],
  [/technic/i, 'Technic'],
  [/ftb|feed.?the.?beast/i, 'FTB App'],
  [/curse|overwolf/i, 'CurseForge'],
  [/modrinth|theseus/i, 'Modrinth App'],
  [/atlauncher/i, 'ATLauncher'],
  [/gdlauncher/i, 'GDLauncher'],
  [/labymod/i, 'LabyMod'],
];
const hintName = (...parts) => NAME_HINTS.find(([re]) => re.test(parts.filter(Boolean).join(' ')))?.[1] || null;

// Папки, в которых лаунчеров точно нет: систему и чужие программы не обходим
const SKIP_DIRS = /^(windows|program files|program files \(x86\)|programdata|users|\$recycle\.bin|system volume information|recovery|perflogs|msocache|boot|intel|amd|nvidia|windowsapps|microsoft|packages|temp|tmp|npm|node_modules|crashdumps|connecteddevicesplatform|d3dscache|google|mozilla|discord|slack|code|\.git|\.cache|\.vscode|\.docker|\.gradle|\.m2|\.nuget|\.android|\.config)$/i;
// Внутри таких папок смотрим ещё на уровень глубже: туда часто кладут портативные лаунчеры
const BOXES = /^(games?|minecraft|mc|launchers?|portable|игры|майнкрафт)$/i;

// Список папок без зависаний: отключённый сетевой диск отвечает не сразу, ждать его дольше секунды не будем
const listDir = (dir, ms = 1500) =>
  Promise.race([
    fs.promises.readdir(dir, { withFileTypes: true }).then(
      (l) => l.filter((e) => e.isDirectory()).map((e) => path.join(dir, e.name)),
      () => []
    ),
    new Promise((resolve) => setTimeout(() => resolve([]), ms)),
  ]);

async function candidates() {
  const { home, appData, localAppData, drives } = bases();
  const docs = ['Documents', 'Desktop', 'Downloads'].flatMap((d) => [path.join(home, d), path.join(home, 'OneDrive', d)]);
  const parents = [appData, localAppData, path.join(localAppData, 'Programs'), home, ...docs, ...drives, ...drives.map((d) => path.join(d, 'Games'))];
  const first = (await Promise.all(parents.map((p) => listDir(p)))).flat().filter((c) => !SKIP_DIRS.test(path.basename(c)));
  const deeper = (await Promise.all(first.filter((c) => BOXES.test(path.basename(c))).map((c) => listDir(c)))).flat().filter((c) => !SKIP_DIRS.test(path.basename(c)));
  const seen = new Set();
  return [...first, ...deeper].filter((c) => !seen.has(norm(c)) && seen.add(norm(c)));
}

// Это общая папка Minecraft: в versions лежит хотя бы один настоящий профиль версии
function isRoot(dir) {
  return subdirs(path.join(dir, 'versions'))
    .slice(0, 40)
    .some((v) => {
      const j = readJson(path.join(v, path.basename(v) + '.json'));
      return !!j && !!(j.mainClass || j.inheritsFrom || j.minecraftArguments || j.arguments);
    });
}

// Сборки одного лаунчера: Prism и его родня, CurseForge, ATLauncher, GDLauncher, Modrinth; или просто папки с игрой
function foundInstances(dir) {
  const out = [];
  for (const sub of ['instances', 'Instances', 'profiles', path.join('minecraft', 'Instances')]) {
    for (const d of subdirs(path.join(dir, sub))) {
      const metaProfile = readJson(path.join(d, 'profile.json'))?.metadata;
      const atl = readJson(path.join(d, 'instance.json'))?.launcher;
      const inst = mmcInstance(d) || curseforgeInstance(d) || (atl ? atlInstance(d) : null) || gdlInstance(d) || (metaProfile ? modrinthInstance(d) : null);
      if (inst) out.push(inst);
    }
  }
  if (out.length) return out;
  // Незнакомый лаунчер: сборки лежат папками с настройками игры (Technic, FTB и другие)
  for (const sub of ['modpacks', 'packs', 'instances', 'Instances']) {
    for (const d of subdirs(path.join(dir, sub))) if (looksLikeGameStrict(d)) out.push({ name: path.basename(d), gameDir: d, home: d, ...guessFromMods(d), guessed: true });
  }
  return out;
}

// Что нашлось в одной папке: общая папка Minecraft и/или сборки. claimed — то, что уже известно и в списке есть
function examine(c, claimed, used) {
  const found = [];
  const insideClaimed = (p) => [...claimed].some((k) => norm(p) === k || norm(p).startsWith(k + path.sep));
  if (insideClaimed(c)) return found;
  let files = [];
  try {
    files = fs.readdirSync(c);
  } catch {}
  // Чей лаунчер: по имени папки, соседней папки и программ рядом (HMCL-3.6.exe, PCL2.exe, legacy.jar…)
  const portable = isFile(path.join(c, 'launcher', 'config', 'legacy.properties')) ? 'legacy' : '';
  const launcher = hintName(path.basename(c), path.basename(path.dirname(c)), portable, ...files.filter((f) => /\.(exe|jar|properties)$/i.test(f))) || path.basename(c).replace(/^\./, '') || c;
  const id = 'found-' + keyOf(c).slice(0, 8);
  let gotRoot = false;
  for (const r of [c, path.join(c, '.minecraft'), path.join(c, 'minecraft'), path.join(c, 'game')]) {
    if (!isDir(r) || insideClaimed(r) || !isRoot(r)) continue;
    const g = rootGroup(r, r === c ? id : 'found-' + keyOf(r).slice(0, 8), rootName(r, [launcher]), used);
    if (g) {
      found.push(g);
      claimed.add(norm(r));
      gotRoot = true;
    }
  }
  const list = foundInstances(c).filter((i) => !used.has(norm(i.gameDir)));
  if (list.length) {
    list.forEach((i) => used.add(norm(i.gameDir)));
    found.push({ id: gotRoot ? id + '-i' : id, name: launcher, kind: 'instances', path: c, items: list.map((i) => ({ type: 'instance', ...i, src: i.gameDir, trash: i.home, linkable: true })) });
    claimed.add(norm(c));
  } else if (!gotRoot && looksLikeGameStrict(c) && !used.has(norm(c))) {
    // Просто папка с игрой, без лаунчера вокруг
    used.add(norm(c));
    found.push({ id, name: launcher, kind: 'instances', path: c, items: [{ type: 'instance', name: path.basename(c).replace(/^\./, ''), gameDir: c, home: c, src: c, trash: c, linkable: true, ...guessFromMods(c), guessed: true }] });
    claimed.add(norm(c));
  }
  return found;
}

/* ---------- поиск ---------- */

let lastScan = null;

// Всё найденное вместе с путями (в интерфейс пути не уходят). measureSizes — считать ли размеры (для быстрой проверки не нужно)
async function collect({ measureSizes }) {
  const { appData, home, localAppData } = bases();
  const groups = [];
  const claimed = new Set();
  const used = new Set();
  const claim = (...ps) => ps.filter(Boolean).forEach((p) => claimed.add(norm(p)));
  // Чужие данные не трогаем только читаем; свои (и нашего предшественника) пропускаем
  claim(path.join(appData, 'Femboy Launcher'), path.join(appData, 'Sugarcube Launcher'), store.baseDir?.());

  // 1. Общая папка Minecraft и папки игры, которые назначены в настройках TLauncher / Legacy Launcher
  // (Стандартная .minecraft принадлежит им, только если игра не переназначена на другую папку)
  const tl = tlSettings();
  const standard = path.join(appData, '.minecraft');
  const roots = [{ dir: standard, id: 'minecraft', names: tl.filter((t) => !t.gameDir || norm(t.gameDir) === norm(standard)).map((t) => t.name) }];
  for (const t of tl) {
    if (t.gameDir && norm(t.gameDir) !== norm(standard) && isDir(t.gameDir)) {
      const known = roots.find((r) => norm(r.dir) === norm(t.gameDir));
      if (known) known.names.push(t.name);
      else roots.push({ dir: t.gameDir, id: 'mc-' + keyOf(t.gameDir).slice(0, 8), names: [t.name] });
    }
  }
  for (const r of roots) {
    if (!isDir(r.dir)) continue;
    claim(r.dir);
    const g = rootGroup(r.dir, r.id, rootName(r.dir, [...new Set(r.names)]), used);
    if (g) groups.push(g);
  }
  // Папка самого TLauncher / Legacy с настройками — не игровая
  claim(path.join(appData, '.tlauncher'));

  // 2. Лаунчеры из списка, у каждого своя папка со сборками
  for (const l of launchers()) {
    claim(...l.dirs);
    let list = [];
    try {
      list = l.instances().filter((i) => !used.has(norm(i.gameDir)));
    } catch {}
    list.forEach((i) => used.add(norm(i.gameDir)));
    if (list.length) groups.push({ id: l.id, name: l.name, kind: 'instances', path: l.dirs.find(isDir) || l.dirs[0], items: list.map((i) => ({ type: 'instance', ...i, src: i.gameDir, trash: i.home, linkable: true })) });
  }

  // 3. Всё остальное: портативные и малоизвестные лаунчеры (HMCL, PCL, MultiMC и другие) — по устройству папок
  let n = 0;
  for (const c of await candidates()) {
    if (groups.length >= 24) break;
    try {
      groups.push(...examine(c, claimed, used));
    } catch {}
    if (++n % 25 === 0) await new Promise((r) => setImmediate(r)); // даём лаунчеру подышать: проверка идёт в основном процессе
  }

  for (const g of groups) {
    for (const it of g.items) {
      it.key = keyOf(it.src + '|' + it.type + '|' + it.name);
      if (measureSizes) it.size = (it.type === 'extras' ? { size: it.files.reduce((s, f) => s + fs.statSync(f).size, 0) } : await measure(it.src)).size;
      else it.size = 0;
    }
  }
  // Уже перенесённое (и ещё живое у нас) отмечаем, чтобы не сделать дубликат
  const ours = new Set(instances.list().map((i) => i.id));
  const done = new Set((store.get().imports || []).filter((r) => !r.trashed && ours.has(r.instanceId)).map((r) => path.resolve(r.src).toLowerCase()));
  for (const it of groups.flatMap((g) => g.items)) it.imported = done.has(path.resolve(it.src).toLowerCase());
  return groups;
}

async function scan() {
  const groups = await collect({ measureSizes: true });
  lastScan = groups;
  // В интерфейс уходят только описания — пути к файлам остаются здесь (папка лаунчера нужна, чтобы человек понял, откуда это)
  return groups.map((g) => ({
    id: g.id,
    name: g.name,
    path: g.path || '',
    target: !!g.target,
    profiles: (g.profiles || []).map(({ id, version, loader, loaderVersion }) => ({ id, version, loader, loaderVersion })),
    items: g.items.map(({ key, type, name, size, count, version, loader, loaderVersion, guessed, linkable, imported }) => ({ key, type, name, size, count, version, loader, loaderVersion, guessed: !!guessed, linkable: !!linkable, imported })),
  }));
}

// Быстрая проверка без подсчёта размеров: что нашлось и что из этого ещё не переносили. Для предложения «перенеси отсюда»
const MEANINGFUL = new Set(['instance', 'world', 'folder']);
async function peek() {
  const offered = new Set(store.get().offeredLaunchers || []);
  return (await collect({ measureSizes: false })).map((g) => {
    const real = g.items.filter((i) => MEANINGFUL.has(i.type) && i.name !== 'Скриншоты');
    return { id: g.id, name: g.name.split(' / ')[0], path: g.path || '', found: real.length, fresh: real.filter((i) => !i.imported).length, offered: offered.has(g.id) };
  });
}

// Запоминаем, что про этот лаунчер уже говорили, чтобы не надоедать
function markOffered(ids) {
  const data = store.get();
  data.offeredLaunchers = [...new Set([...(data.offeredLaunchers || []), ...(ids || []).map(String)])].slice(-200);
  store.save();
}

/* ---------- перенос ---------- */

// Копируем файлы по одному, чтобы показывать прогресс и не держать большие миры в памяти
// skip — какие имена пропустить в самой верхней папке
async function copyTree(src, dest, onBytes, skip = () => false) {
  const st = await fs.promises.stat(src);
  if (!st.isDirectory()) {
    await fs.promises.mkdir(path.dirname(dest), { recursive: true });
    await fs.promises.copyFile(src, dest);
    return onBytes(st.size);
  }
  await fs.promises.mkdir(dest, { recursive: true });
  for (const e of await fs.promises.readdir(src, { withFileTypes: true })) {
    if (e.name === 'session.lock' || skip(e.name)) continue; // замок мира — его держит запущенная игра
    const from = path.join(src, e.name);
    const to = path.join(dest, e.name);
    if (e.isDirectory()) await copyTree(from, to, onBytes);
    else if (e.isFile()) {
      // Файл, который уже есть в сборке, не перезаписываем
      if (fs.existsSync(to)) continue;
      await fs.promises.copyFile(from, to);
      onBytes((await fs.promises.stat(from)).size);
    }
  }
}

// «На месте»: ссылка-перекрёсток (junction) вместо копии — данные остаются у старого лаунчера
function link(src, dest) {
  if (fs.existsSync(dest)) throw new Error(`Папка «${path.basename(dest)}» уже есть в сборке`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.symlinkSync(src, dest, 'junction');
}

const FOREIGN_META = ['minecraftinstance.json', 'instance.json', 'profile.json', 'config.json', 'mmc-pack.json', 'instance.cfg'];
const groupName = (name) => `Из ${name.split(' / ')[0]}`.slice(0, 30);

// plan: { keys: [...], linked: [...], targets: { [groupId]: { version, loader, loaderVersion } }, versions: { [key]: version } }
async function importSelected(plan, progress = () => {}) {
  if (!lastScan) await scan();
  const keys = new Set(plan?.keys || []);
  const linked = new Set(plan?.linked || []);
  const chosen = lastScan.flatMap((g) => g.items.filter((i) => keys.has(i.key)).map((i) => ({ g, i })));
  if (!chosen.length) throw new Error('Ничего не выбрано');
  const total = chosen.filter(({ i }) => !linked.has(i.key)).reduce((s, { i }) => s + i.size, 0);
  let done = 0;
  let last = 0;
  const onBytes = (n) => {
    done += n;
    if (Date.now() - last > 150) ((last = Date.now()), progress(`Переношу из других лаунчеров… ${Math.round(done / 1048576)} / ${Math.round(total / 1048576)} МБ`, total ? (done / total) * 100 : null));
  };
  const records = [];
  const created = [];
  const record = async (g, i, instanceId, isLinked) => {
    const m = i.type === 'extras' ? { size: i.size, count: i.files.length, mtime: 0 } : await measure(i.src);
    records.push({ id: crypto.randomBytes(6).toString('hex'), launcher: g.id, launcherName: g.name, name: i.name, type: i.type, src: i.src, trash: i.trash, instanceId, dest: i.dest ?? '.minecraft', linked: isLinked, size: m.size, count: m.count, mtime: m.mtime, at: Date.now() });
  };

  // Сборки других лаунчеров — каждая своей сборкой
  for (const { g, i } of chosen.filter(({ i }) => i.type === 'instance')) {
    const version = plan?.versions?.[i.key] || i.version;
    if (!version) throw new Error(`Не знаю версию игры для «${i.name}» — выбери её в списке`);
    const inst = instances.create({ name: i.name, version, loader: i.loader, loaderVersion: plan?.versions?.[i.key] && plan.versions[i.key] !== i.version ? null : i.loaderVersion, icon: '🧳', group: groupName(g.name) });
    created.push(inst.id);
    const dest = instances.gameDir(inst.id);
    progress(`Переношу «${i.name}»…`, total ? (done / total) * 100 : null);
    // У сборки TLauncher в папке лежит и сама версия игры, у других — их файлы описания сборки: нам это не нужно
    const id = path.basename(i.src);
    const skip = g.kind === 'root' ? (n) => n === id + '.jar' || n === id + '.json' || n === 'natives' : (n) => FOREIGN_META.includes(n);
    if (linked.has(i.key)) link(i.src, dest);
    else await copyTree(i.src, dest, onBytes, skip);
    await record(g, i, inst.id, linked.has(i.key));
  }

  // Миры, паки и настройки из .minecraft — в одну новую сборку
  for (const g of lastScan.filter((g) => g.target)) {
    const items = g.items.filter((i) => keys.has(i.key) && i.type !== 'instance');
    if (!items.length) continue;
    const t = plan?.targets?.[g.id] || g.profiles[0] || {};
    if (!t.version) throw new Error('Выбери версию игры для сборки из .minecraft');
    const inst = instances.create({ name: g.name.split(' / ')[0], version: t.version, loader: t.loader || 'vanilla', loaderVersion: t.loaderVersion || null, icon: '🧳', group: groupName(g.name) });
    created.push(inst.id);
    const gameDir = instances.gameDir(inst.id);
    for (const i of items) {
      progress(`Переношу «${i.name}»…`, total ? (done / total) * 100 : null);
      const isLinked = linked.has(i.key) && i.linkable;
      if (i.type === 'extras') for (const f of i.files) await copyTree(f, path.join(gameDir, path.basename(f)), onBytes);
      else if (isLinked) link(i.src, path.join(gameDir, i.dest));
      else await copyTree(i.src, path.join(gameDir, i.dest), onBytes);
      await record(g, i, inst.id, isLinked);
    }
  }

  const data = store.get();
  data.imports = [...(data.imports || []), ...records];
  store.save();
  return { created: created.map((id) => instances.get(id)), copied: done };
}

/* ---------- освободить место ---------- */

// Деинсталляторы из реестра Windows (как в «Параметры → Приложения»)
let uninstallCache = null;
function uninstallers() {
  if (uninstallCache) return uninstallCache;
  const keys = ['HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall', 'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall', 'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall'];
  uninstallCache = Promise.all(
    keys.map(
      (k) =>
        new Promise((resolve) =>
          execFile('reg', ['query', k, '/s'], { windowsHide: true, maxBuffer: 32 * 1024 * 1024 }, (err, out) => {
            const list = [];
            let cur = null;
            for (const line of String(out || '').split(/\r?\n/)) {
              if (/^HKEY_/.test(line)) list.push((cur = {}));
              const m = /^\s+(DisplayName|UninstallString)\s+REG_(?:EXPAND_)?SZ\s+(.+)$/.exec(line);
              if (m && cur) cur[m[1]] = m[2].trim();
            }
            resolve(list.filter((x) => x.DisplayName && x.UninstallString));
          })
        )
    )
  ).then((all) => all.flat());
  return uninstallCache;
}

const UNINSTALL_NAMES = {
  minecraft: [/^Minecraft Launcher$/i, /TLauncher/i, /Legacy Launcher|TL Legacy/i],
  ...Object.fromEntries(launchers().map((l) => [l.id, [l.uninstall]])),
};
// Общая папка, назначенная в настройках TLauncher / Legacy (id «mc-…»), удаляется теми же программами
const uninstallNames = (id) => UNINSTALL_NAMES[id] || (/^mc-/.test(id) ? UNINSTALL_NAMES.minecraft : []);

// Проверяем запись переноса: что с оригиналом и с нашей копией сейчас
async function statusOf(r) {
  if (r.trashed || !fs.existsSync(r.src)) return 'gone';
  let destPath;
  try {
    destPath = path.join(instances.gameDir(r.instanceId), r.dest === '.minecraft' ? '' : r.dest);
  } catch {}
  const haveDest = !!destPath && fs.existsSync(destPath);
  if (r.linked) return haveDest ? 'linked' : 'gone'; // данные общие — удалять нельзя; ссылку уже сняли — и говорить не о чем
  if (!r.trash) return 'keep'; // настройки и серверы общие для всех лаунчеров .minecraft
  if (!haveDest) return 'nodest'; // нашу копию удалили — оригинал теперь единственный
  const now = await measure(r.src);
  // Оригинал менялся после переноса (в старом лаунчере ещё играли) — новые изменения есть только там
  if (now.count !== r.count || now.size !== r.size || now.mtime > (r.mtime || 0) + 2000) return 'changed';
  return 'ready';
}

async function cleanupInfo() {
  const recs = store.get().imports || [];
  const regs = await uninstallers();
  const byLauncher = new Map();
  for (const r of recs) {
    if (!byLauncher.has(r.launcher)) byLauncher.set(r.launcher, { id: r.launcher, name: r.launcherName, items: [] });
    const inst = instances.list().find((i) => i.id === r.instanceId);
    byLauncher.get(r.launcher).items.push({ id: r.id, name: r.name, type: r.type, size: r.size, status: await statusOf(r), played: !!(inst?.lastPlayed && inst.lastPlayed > r.at) });
  }
  return [...byLauncher.values()].map((l) => ({
    ...l,
    free: l.items.filter((i) => i.status === 'ready').reduce((s, i) => s + i.size, 0),
    uninstall: regs.filter((x) => uninstallNames(l.id).some((re) => re.test(x.DisplayName))).map((x) => x.DisplayName),
  }));
}

// Старые копии — в Корзину; перед этим ещё раз проверяем каждую
async function trash(ids, trashItem) {
  const recs = store.get().imports || [];
  let freed = 0;
  const skipped = [];
  for (const r of recs.filter((x) => (ids || []).includes(x.id))) {
    if ((await statusOf(r)) !== 'ready') {
      skipped.push(r.name);
      continue;
    }
    await trashItem(r.trash);
    r.trashed = Date.now();
    freed += r.size;
  }
  store.save();
  return { freed, skipped };
}

// Запускаем собственный деинсталлятор лаунчера — человек сам видит его окно и подтверждает
async function uninstall(displayName) {
  const reg = (await uninstallers()).find((x) => x.DisplayName === displayName);
  if (!reg) throw new Error('Не нашла программу удаления — удали её в «Параметры → Приложения»');
  uninstallCache = null;
  spawn(reg.UninstallString, { shell: true, detached: true, stdio: 'ignore', windowsHide: false }).unref();
}

// Сборки, перенесённые копией, у которых старые копии ещё лежат на месте
function pendingInstanceIds() {
  return [...new Set((store.get().imports || []).filter((r) => !r.linked && !r.trashed && r.trash).map((r) => r.instanceId))];
}

// Перед удалением сборки снимаем ссылки «на месте», чтобы не задеть данные старого лаунчера
function unlinkShared(dir) {
  const walk = (p, depth) => {
    let list;
    try {
      list = fs.readdirSync(p, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of list) {
      const full = path.join(p, e.name);
      if (e.isSymbolicLink()) fs.rmdirSync(full);
      else if (e.isDirectory() && depth < 3) walk(full, depth + 1);
    }
  };
  walk(dir, 0);
}

module.exports = { scan, peek, markOffered, importSelected, cleanupInfo, trash, uninstall, pendingInstanceIds, unlinkShared, profileInfo, readProps };
