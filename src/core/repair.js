// «Починить файлы игры»: то, что лаунчер проверяет перед каждым запуском, но до конца и без запуска игры: профиль и клиент версии,
// профиль загрузчика (Fabric/Quilt), библиотеки и ВСЕ ресурсы по хэшам. Битое и недостающее скачивается заново из тех же источников.
// Чужого не трогает: ни миры, ни моды, ни настройки сборки, ни файлы других версий. Forge и NeoForge ставит свой установщик при запуске,
// их файлы здесь не проверяются
const fs = require('fs');
const path = require('path');
const versions = require('./versions');
const gamefiles = require('./gamefiles');
const forge = require('./forge');

const mb = (n) => (n / 1048576).toFixed(0);

// Профиль загрузчика читается и похож на профиль
function profileOk(file) {
  try {
    return Array.isArray(JSON.parse(fs.readFileSync(file, 'utf8')).libraries);
  } catch {
    return false;
  }
}

// Отвечает отчётом: { version, client: { fixed }, profile: { fixed }, loader: { name, state }, libraries: { checked, fixed }, assets: { checked, fixed } }.
// loader.state: 'vanilla' | 'unknown-version' (игра с этой сборкой ещё не запускалась) | 'ok' | 'fixed' (профиль был битым или его не было) | 'at-launch' (Forge/NeoForge)
async function run({ root, version, loader, loaderVersion }, { progress = () => {} } = {}) {
  progress('Проверяю профиль и клиент игры…', null);
  const profileFixed = versions.dropBrokenProfile(version);
  const vanillaJson = await versions.versionJson(version);
  const clientFixed = await versions.ensureClientJar(root, version, (got, total) =>
    progress(`Скачиваю Minecraft ${version}: ${mb(got)}${total ? ' / ' + mb(total) : ''} МБ`, total ? (got / total) * 100 : null)
  );

  let customJson = null;
  const loaderReport = { name: null, state: 'vanilla' };
  if (versions.LOADER_NAMES[loader]) {
    loaderReport.name = versions.LOADER_NAMES[loader];
    if (!loaderVersion) loaderReport.state = 'unknown-version';
    else {
      progress(`Проверяю ${loaderReport.name}…`, null);
      const id = versions.loaderId(loader, version, loaderVersion);
      const file = path.join(root, 'versions', id, id + '.json');
      const had = fs.existsSync(file) && profileOk(file);
      if (!had) fs.rmSync(file, { force: true }); // оборванный профиль убираем: installLoader скачает новый
      const res = await versions.installLoader(root, version, loader, loaderVersion);
      customJson = JSON.parse(fs.readFileSync(path.join(root, 'versions', res.id, res.id + '.json'), 'utf8'));
      loaderReport.state = had ? 'ok' : 'fixed';
    }
  } else if (forge.NAMES[loader]) {
    Object.assign(loaderReport, { name: forge.NAMES[loader], state: 'at-launch' });
  }

  const { libraries, assets } = await gamefiles.prefetch(root, vanillaJson, customJson, progress, { deep: true });
  return { version, client: { fixed: clientFixed }, profile: { fixed: profileFixed }, loader: loaderReport, libraries, assets };
}

module.exports = { run };
