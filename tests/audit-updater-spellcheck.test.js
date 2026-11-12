// R4-PRIV-01: сессия electron-updater тоже без проверки орфографии, и это делается до первого запроса обновлений
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');

test('сессия electron-updater: орфография и языки отключены до updater.init', () => {
  const s = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
  const start = s.indexOf('app.whenReady().then(');
  const part = s.indexOf("session.fromPartition('electron-updater', { cache: false })", start);
  assert.ok(part > start, 'нужна та же сессия и те же параметры, что у electron-updater');
  assert.ok(s.indexOf('updaterSession.setSpellCheckerEnabled(false)', part) > part);
  assert.ok(s.indexOf('updaterSession.setSpellCheckerLanguages([])', part) > part);
  assert.ok(part < s.indexOf('  updater.init({', start));
  const exec = fs.readFileSync(path.join(__dirname, '../node_modules/electron-updater/out/electronHttpExecutor.js'), 'utf8');
  assert.match(exec, /NET_SESSION_NAME = "electron-updater"/);
  assert.match(exec, /fromPartition\(exports\.NET_SESSION_NAME, \{\s*cache: false/);
});
