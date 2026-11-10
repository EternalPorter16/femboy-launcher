// Запускает main.js в Электроне и показывает его отчёт (у Электрона на Windows нет консоли, поэтому результат идёт через файл).
// npm run test:electron
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const electron = require('electron'); // из обычного Node это путь к electron.exe
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'femboy-electron-test-'));
const report = path.join(tmp, 'report.txt');
const r = spawnSync(electron, [path.join(__dirname, 'main.js')], {
  env: { ...process.env, ELECTRON_TEST_OUT: report, ELECTRON_TEST_UD: path.join(tmp, 'userData') },
  stdio: 'ignore',
  timeout: 240000,
});
const text = fs.existsSync(report) ? fs.readFileSync(report, 'utf8') : '';
const completed = text.trimEnd().split(/\r?\n/).at(-1) === 'Всё хорошо';
console.log(text || 'Электрон не оставил отчёта (не запустился?)');
if (!completed) console.log('Тест Electron не завершён успешно: нет итоговой строки «Всё хорошо».');
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(r.status === 0 && !r.error && completed ? 0 : 1);
