// Заметки об обновлении для latest.yml: берёт запись «Что нового» текущей версии (package.json) из src/renderer/whatsnew.js и кладёт её в
// build/release-notes.md. electron-builder сам переносит этот файл в latest.yml, а установленный лаунчер показывает заметки перед обновлением.
// Нет записи для этой версии — файла нет; заметки прошлого выпуска, оставшиеся в build, удаляются первым делом, чтобы чужое не попало в новый latest.yml.
// Запускает release.bat; из командной строки скрипт никогда не падает: заметки не должны останавливать выпуск
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function generate(root) {
  const out = path.join(root, 'build', 'release-notes.md');
  fs.rmSync(out, { force: true });
  const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (!version) throw new Error('в package.json нет version');
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'src', 'renderer', 'whatsnew.js'), 'utf8'), sandbox);
  const entry = (sandbox.window.CHANGELOG || []).find((c) => c.version === version);
  if (!entry) return { version, written: false };
  fs.writeFileSync(out, require(path.join(root, 'src', 'renderer', 'updatenotes.js')).render(entry));
  return { version, written: true, file: out };
}

if (require.main === module) {
  try {
    const r = generate(path.join(__dirname, '..'));
    console.log(r.written ? `Release notes for ${r.version}: ${r.file}` : `No "What's new" entry for ${r.version}: update notes are not generated`);
  } catch (e) {
    console.log(`Release notes were not generated: ${e.message}`);
  }
}

module.exports = { generate };
