// Чистка папки сборки после выпуска: dist-release копит установщики каждой версии (около 150 МБ на версию), а после выкладки нужны только текущие.
// Убирает FemboyLauncher-Setup/Portable-<версия>.exe и .blockmap ВСЕХ версий, кроме текущей (из package.json). Остального не касается: latest.yml,
// win-unpacked (по нему сверяют состав следующей сборки), служебные файлы electron-builder, чужие файлы и папки. Прошлая версия лежит в archive
// на Диске, так что откат не страдает. Нет файлов текущей версии (сборка не удалась, не та папка) — не делает ничего.
// Запускает release.bat ПОСЛЕ удачной выкладки; сбой здесь выпуск не останавливает. Вручную: node build/clean-dist.js dist-release [--dry-run]
const fs = require('fs');
const path = require('path');

const V = String.raw`\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]*)?`;
const VERSION = new RegExp(`^${V}$`);
const NAME = new RegExp(String.raw`^FemboyLauncher-(?:Setup|Portable)-(${V})\.exe(?:\.blockmap)?$`);

// dryRun — только посчитать, ничего не удаляя. Возвращает { removed: [{ name, size }], failed: [{ name, error }], kept: [имена], refused, dryRun }
function clean(dir, version, { dryRun = false } = {}) {
  const result = { removed: [], failed: [], kept: [], refused: null, dryRun };
  const refuse = (why) => ({ ...result, refused: why });
  if (typeof version !== 'string' || !VERSION.test(version)) return refuse(`bad version ${JSON.stringify(version)}`);
  let names;
  try {
    names = fs.readdirSync(dir).sort();
  } catch {
    return refuse('folder not found');
  }
  // Только обычные файлы: папка с похожим именем и ссылка не в счёт
  const isFile = (name) => {
    try {
      return fs.lstatSync(path.join(dir, name)).isFile();
    } catch {
      return false;
    }
  };
  const missing = [`FemboyLauncher-Setup-${version}.exe`, `FemboyLauncher-Portable-${version}.exe`, 'latest.yml'].filter((n) => !isFile(n));
  if (missing.length) return refuse(`no files of the current build (${missing.join(', ')})`);
  for (const name of names) {
    const m = NAME.exec(name);
    if (!m || !isFile(name)) continue;
    if (m[1] === version) {
      result.kept.push(name);
      continue;
    }
    const file = path.join(dir, name);
    try {
      const { size } = fs.lstatSync(file);
      if (!dryRun) fs.unlinkSync(file);
      result.removed.push({ name, size });
    } catch (e) {
      result.failed.push({ name, error: e.code || e.message }); // занят антивирусом и т. п.: остальные файлы убираем дальше
    }
  }
  return result;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const arg = args.find((a) => !a.startsWith('--'));
  try {
    if (!arg) {
      console.log('Usage: node build/clean-dist.js <folder> [--dry-run]');
      process.exitCode = 1;
    } else {
      const { version } = require('../package.json');
      const r = clean(path.resolve(arg), version, { dryRun });
      if (r.refused) {
        console.log(`Not cleaning ${arg}: ${r.refused}`);
        process.exitCode = 1;
      } else if (!r.removed.length && !r.failed.length) {
        console.log(`Old installers in ${arg}: nothing to remove (current version ${version})`);
      } else {
        const mb = (r.removed.reduce((s, x) => s + x.size, 0) / 1048576).toFixed(1);
        console.log(`Old installers in ${arg}: ${dryRun ? 'would remove' : 'removed'} ${r.removed.length} file(s), ${mb} MB (kept version ${version})`);
      }
      for (const f of r.failed) console.log(`Could not remove ${f.name}: ${f.error}`);
    }
  } catch (e) {
    console.log(`Old installers were not cleaned: ${e.message}`);
    process.exitCode = 1;
  }
}

module.exports = { clean };
