// Профиль для проверки интерфейса: аккаунт и три сборки с модами и миром. Всё собирается кодом лаунчера во временной папке,
// настоящие данные пользователя не нужны и не трогаются
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const SRC = path.join(__dirname, '..', '..', 'src');

// Мод-пустышка с описанием, которое читает лаунчер
function jar(id, version, name) {
  const zip = new AdmZip();
  zip.addFile('fabric.mod.json', Buffer.from(JSON.stringify({ schemaVersion: 1, id, version, name, depends: { minecraft: '*' } })));
  return zip.toBuffer();
}

function build(dir) {
  const store = require(path.join(SRC, 'core/store'));
  store.init(dir);
  const accounts = require(path.join(SRC, 'core/accounts'));
  const instances = require(path.join(SRC, 'core/instances'));
  accounts.addOffline('Boykisser_');
  // Ничего лишнего: ни Discord, ни копий миров, ни предложения перенести сборки из других лаунчеров
  // readinessCheck и modUpdatesCheck: фоновые проверки («пора на новую версию?», «вышли обновления модов») ходят в сеть через полминуты после старта — проверке окон это ни к чему
  store.updateSettings({ discordRpc: false, autoBackup: 'off', importOffer: false, readinessCheck: false, modUpdatesCheck: false });
  const cosy = instances.create({ name: 'Уютное выживание', version: '1.21.1', loader: 'fabric', loaderVersion: '0.16.9' });
  instances.create({ name: 'Ванилька', version: '1.21.4', loader: 'vanilla' });
  instances.create({ name: 'Старая добрая', version: '1.12.2', loader: 'forge', loaderVersion: '14.23.5.2860' });
  const game = instances.gameDir(cosy.id);
  const put = (rel, data) => {
    const f = path.join(game, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, data);
  };
  put('mods/sodium-0.6.0.jar', jar('sodium', '0.6.0', 'Sodium'));
  put('mods/lithium-0.14.0.jar', jar('lithium', '0.14.0', 'Lithium'));
  put('mods/ferritecore-7.0.0.jar', jar('ferritecore', '7.0.0', 'FerriteCore'));
  put('saves/Мир выживания/level.dat', 'x');
  put('options.txt', 'renderDistance:16\nmaxFps:120\n');
  store.save();
}

module.exports = { build };
