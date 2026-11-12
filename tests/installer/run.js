// Real navigation check of the installer privacy page (npm run test:installer). Compiles tests/installer/privacy-harness.nsi
// with the NSIS that electron-builder uses (build/installer-privacy.nsh inside), then drives the pages with Win32 messages:
// first open — all four off; Back -> Next keeps the current choice; a changed choice survives Back -> Next too; the record
// written on install equals the last confirmed choice; a new run starts with all four off again; silent install writes no
// record. A small installer window appears for a few seconds; nothing is installed outside a temporary folder.
// SETUP=<path to a real FemboyLauncher-Setup.exe> additionally drives the real Setup up to the privacy page and back,
// never pressing Next there (that would install), and cancels it.
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const OFF = [0, 0, 0, 0];
let failed = 0;
const check = (ok, name, info = '') => {
  console.log(`${ok ? 'ok ' : 'БЕДА'} ${name.padEnd(64)} ${info}`);
  if (!ok) failed++;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function makensis() {
  const cache = path.join(process.env.LOCALAPPDATA || '', 'electron-builder', 'Cache', 'nsis');
  const dirs = fs.existsSync(cache) ? fs.readdirSync(cache).filter((d) => /^nsis-\d/.test(d)).sort().reverse() : [];
  for (const d of dirs) for (const exe of [path.join(cache, d, 'Bin', 'makensis.exe'), path.join(cache, d, 'makensis.exe')]) if (fs.existsSync(exe)) return exe;
  return null;
}
function drive(exe, scenario, extra = {}) {
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'drive-privacy.ps1'), '-Exe', exe, '-Scenario', scenario];
  for (const [k, v] of Object.entries(extra)) if (v) args.push(`-${k}`, v);
  const r = spawnSync('powershell.exe', args, { encoding: 'utf8', timeout: 120000, windowsHide: true });
  const line = (r.stdout || '').trim().split(/\r?\n/).filter((l) => l.startsWith('{')).pop();
  try {
    return JSON.parse(line);
  } catch {
    return { ok: false, error: `driver output: ${(r.stdout || '').slice(-400)} ${(r.stderr || '').slice(-400)}` };
  }
}

function main() {
  if (process.platform !== 'win32') return console.log('пропуск: только Windows'), 0;
  const nsis = makensis();
  if (!nsis) return console.log('пропуск: NSIS из кэша electron-builder не найден (соберите Setup один раз)'), 0;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fl-privacy-nav-'));
  try {
    const exe = path.join(tmp, 'privacy-harness.exe');
    const c = spawnSync(nsis, ['/V2', `/DBUILD_RESOURCES_DIR=${path.join(ROOT, 'build')}`, `/DOUTFILE=${exe}`, path.join(__dirname, 'privacy-harness.nsi')], { encoding: 'utf8', windowsHide: true });
    check(c.status === 0 && fs.existsSync(exe), 'стенд собран тем же NSIS, что и Setup', c.status === 0 ? path.basename(nsis) : (c.stdout + c.stderr).slice(-600));
    if (c.status !== 0) return 1;
    for (const lang of ['1049', '1033']) {
      const dir = path.join(tmp, `install-${lang}`);
      const r = drive(exe, 'harness-nav', { InstDir: dir, LangId: lang });
      check(r.ok, `${lang}: навигация прошла`, r.error || '');
      check(same(r.initial, OFF), `${lang}: первое открытие — все четыре выключены`, JSON.stringify(r.initial));
      check(same(r.afterFirstChoice, [1, 0, 1, 0]), `${lang}: отмечены обновления и проверки модов`, JSON.stringify(r.afterFirstChoice));
      check(r.backPage && r.backPage.privacy === false && r.backPage.edit === true, `${lang}: «Назад» ведёт на страницу папки`, JSON.stringify(r.backPage));
      check(same(r.afterBackNext1, [1, 0, 1, 0]), `${lang}: «Назад → Далее» сохраняет выбор`, JSON.stringify(r.afterBackNext1));
      check(same(r.afterSecondChoice, [1, 1, 0, 0]), `${lang}: выбор изменён (Discord вкл., моды выкл.)`, JSON.stringify(r.afterSecondChoice));
      check(same(r.afterBackNext2, [1, 1, 0, 0]), `${lang}: и изменённый выбор переживает «Назад → Далее»`, JSON.stringify(r.afterBackNext2));
      const rec = r.record;
      check(!!rec && rec.backgroundUpdateChecks === true && rec.discordRpc === true && rec.modUpdatesCheck === false && rec.readinessCheck === false, `${lang}: записан последний подтверждённый выбор`, JSON.stringify(rec));
      const f = drive(exe, 'fresh', { LangId: lang, InstDir: path.join(tmp, `fresh-${lang}`) });
      check(f.ok && same(f.initial, OFF), `${lang}: новый запуск — снова все четыре выключены`, f.error || JSON.stringify(f.initial));
    }
    const silentDir = path.join(tmp, 'silent');
    const s = spawnSync(exe, ['/S', `/D=${silentDir}`], { timeout: 60000, windowsHide: true });
    check(s.status === 0 && fs.existsSync(path.join(silentDir, 'resources')) && !fs.existsSync(path.join(silentDir, 'resources', 'privacy-install.json')), 'тихая установка: страницы нет, запись выбора не создаётся', `код ${s.status}`);
    if (process.env.SETUP) {
      const real = drive(process.env.SETUP, 'real-nav');
      check(real.ok, 'настоящий Setup: дошли до страницы и закрыли без установки', real.error || `код ${real.exitCode}`);
      check(same(real.initial, OFF), 'настоящий Setup: первое открытие — все четыре выключены', JSON.stringify(real.initial));
      check(same(real.afterBackNext1, [1, 0, 1, 0]) && same(real.afterBackNext2, [1, 1, 0, 0]), 'настоящий Setup: «Назад → Далее» сохраняет выбор', `${JSON.stringify(real.afterBackNext1)} ${JSON.stringify(real.afterBackNext2)}`);
      const again = drive(process.env.SETUP, 'fresh');
      check(again.ok && same(again.initial, OFF), 'настоящий Setup: новый запуск — все четыре выключены', again.error || JSON.stringify(again.initial));
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
  console.log(failed ? `\nПРОВАЛЕНО: ${failed}` : '\nВсё хорошо');
  return failed ? 1 : 0;
}

process.exitCode = main();
