// Страница приватности установщика (build/installer-privacy.nsh): выбор переживает «Назад -> Далее» в пределах одного запуска
// Setup, новый запуск начинает со всех четырёх выключенных, тихая установка запись не пишет. Настоящая навигация NSIS
// проверяется отдельно: npm run test:installer (tests/installer/run.js — окно стенда на несколько секунд)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const nsh = fs.readFileSync(path.join(ROOT, 'build', 'installer-privacy.nsh'), 'utf8');
const fn = (name) => {
  const m = new RegExp(`^Function ${name}\\r?\\n([\\s\\S]*?)^FunctionEnd`, 'm').exec(nsh);
  assert.ok(m, `функция ${name} не найдена`);
  return m[1];
};
const BOXES = ['FLPrivacyUpdates', 'FLPrivacyDiscord', 'FLPrivacyMods', 'FLPrivacyReadiness'];
const VARS = ['FLPrivacyU', 'FLPrivacyD', 'FLPrivacyM', 'FLPrivacyR'];

test('каждый флажок при щелчке сразу сохраняет выбор (иначе «Назад» его терял: leave-функция вызывается только по «Далее»)', () => {
  const page = fn('FLPrivacyPage');
  for (const box of BOXES) assert.match(page, new RegExp(`\\$\\{NSD_OnClick\\} \\$${box} FLPrivacyClick`), box);
  const click = fn('FLPrivacyClick');
  assert.match(click, /Exch \$0\s+Pop \$0/, 'дескриптор флажка снимается со стека, $0 не портится');
  assert.match(click, /Call FLPrivacySave/);
  const save = fn('FLPrivacySave');
  BOXES.forEach((box, i) => assert.match(save, new RegExp(`NSD_GetState\\} \\$${box} \\$0[\\s\\S]*?StrCpy \\$${VARS[i]} "true"`), box));
  assert.match(save, /^\s*Push \$0/m);
  assert.match(save, /^\s*Pop \$0/m);
  assert.doesNotMatch(save, /FLPrivacyAccepted/, 'щелчок не подтверждает выбор');
});

test('страница восстанавливает текущий выбор при каждом показе, а не только после «Далее»; при первом показе всё выключено', () => {
  const page = fn('FLPrivacyPage');
  const restore = page.slice(page.indexOf('NSD_OnClick'), page.indexOf('nsDialogs::Show'));
  assert.doesNotMatch(restore, /FLPrivacyAccepted/, 'восстановление не зависит от того, нажимали ли «Далее»');
  BOXES.forEach((box, i) => assert.match(restore, new RegExp(`\\$\\{If\\} \\$${VARS[i]} == "true"\\s+\\$\\{NSD_Check\\} \\$${box}`), box));
  // новый запуск Setup ничего не наследует: читается только встроенный текст политики, ни прежняя запись выбора, ни реестр;
  // переменные выбора пусты (= выключено), «true» в них пишет только FLPrivacySave по состоянию флажков
  const opened = [...nsh.matchAll(/FileOpen \$\d "([^"]+)" r\b/g)].map((m) => m[1]);
  assert.deepEqual(opened, ['$PLUGINSDIR\\privacy-notice.txt']);
  assert.doesNotMatch(nsh, /ReadRegStr|ReadRegDWORD|ReadINIStr|ReadEnvStr/);
  const setsTrue = nsh.split(/^Function /m).filter((part) => /StrCpy \$FLPrivacy[UDMR] "true"/.test(part)).map((part) => part.split(/\r?\n/)[0]);
  assert.deepEqual(setsTrue, ['FLPrivacySave']);
});

test('«Далее» подтверждает выбор; запись пишется только после подтверждения и не в тихом режиме', () => {
  const leave = fn('FLPrivacyLeave');
  assert.match(leave, /StrCpy \$FLPrivacyAccepted 1/);
  assert.match(leave, /Call FLPrivacySave/);
  assert.equal((nsh.match(/StrCpy \$FLPrivacyAccepted 1/g) || []).length, 1, 'подтверждает только «Далее»');
  assert.match(fn('FLPrivacyPage'), /IfSilent fl_privacy_skip/);
  const install = /!macro customInstall([\s\S]*?)!macroend/.exec(nsh)[1];
  assert.match(install, /\$\{IfNot\} \$\{Silent\}\s+\$\{If\} \$FLPrivacyAccepted == 1/);
  assert.match(install, /backgroundUpdateChecks\$\\":\$FLPrivacyU,\$\\"discordRpc\$\\":\$FLPrivacyD,\$\\"modUpdatesCheck\$\\":\$FLPrivacyM,\$\\"readinessCheck\$\\":\$FLPrivacyR/);
});

test('проверка настоящей навигации подключена: стенд, драйвер и npm run test:installer', () => {
  for (const f of ['run.js', 'drive-privacy.ps1', 'privacy-harness.nsi']) assert.ok(fs.existsSync(path.join(__dirname, 'installer', f)), f);
  assert.equal(require(path.join(ROOT, 'package.json')).scripts['test:installer'], 'node tests/installer/run.js');
  const harness = fs.readFileSync(path.join(__dirname, 'installer', 'privacy-harness.nsi'), 'utf8');
  assert.match(harness, /!include "\$\{BUILD_RESOURCES_DIR\}\\installer-privacy\.nsh"/, 'стенд собирает ту же страницу');
  assert.match(harness, /MUI_PAGE_DIRECTORY[\s\S]*customPageAfterChangeDir[\s\S]*MUI_PAGE_INSTFILES/, 'тот же порядок страниц, что в Setup');
  const driver = fs.readFileSync(path.join(__dirname, 'installer', 'drive-privacy.ps1'), 'utf8');
  assert.match(driver, /refusing to press Next on the privacy page of the real Setup/, 'на настоящем Setup «Далее» на странице приватности не нажимается');
});
