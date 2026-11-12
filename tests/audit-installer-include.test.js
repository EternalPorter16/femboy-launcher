// R4-INST-01: nsis.include заменяет build/installer.nsh, поэтому файл приватности подключает его сам
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('installer-privacy.nsh подключает фирменный installer.nsh до своих страниц', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.build.nsis.include, 'build/installer-privacy.nsh');
  const priv = read('build/installer-privacy.nsh');
  const inc = priv.search(/^!include\s+"\$\{BUILD_RESOURCES_DIR\}.installer\.nsh"\s*$/m);
  assert.ok(inc >= 0, 'нет !include installer.nsh');
  assert.ok(inc < priv.indexOf('!include MUI2.nsh'));
  assert.ok(inc < priv.indexOf('Function FLPrivacyPage'));
});

test('макросы двух файлов не конфликтуют, фирменные тексты и цвет на месте', () => {
  const macros = (s) => [...s.matchAll(/^\s*!macro\s+(\w+)/gm)].map((m) => m[1]);
  const a = macros(read('build/installer.nsh')), b = macros(read('build/installer-privacy.nsh'));
  assert.deepEqual(a.filter((m) => b.includes(m)), []);
  assert.ok(a.includes('customWelcomePage') && a.includes('customHeader'));
  assert.ok(b.includes('customPageAfterChangeDir') && b.includes('customInstall'));
  const brand = read('build/installer.nsh');
  for (const k of ['fbWelcomeTitle', 'fbDirText', 'fbFinishTitle', 'fbUnWelcomeTitle']) assert.ok(brand.includes(k), k);
  assert.match(brand, /!define MUI_BGCOLOR "FFF5FA"/);
});
