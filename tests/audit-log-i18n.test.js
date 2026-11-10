const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), vm = require('vm');
const scrub = require('../src/core/scrub');
const read = (file) => fs.readFileSync(path.join(__dirname, '../src', file), 'utf8');

test('quoted tokens and bracketed remote IPv6 addresses are scrubbed; localhost stays useful', () => {
  const text = "--accessToken 'TEST TOKEN WITH SPACES' refresh_token='TEST_REFRESH_TOKEN' [2001:db8::7]:25565 [::1]:25565";
  const cleaned = scrub.text(text);
  assert.ok(!cleaned.includes('TEST TOKEN') && !cleaned.includes('TEST_REFRESH') && !cleaned.includes('2001:db8'));
  assert.ok(cleaned.includes('[::1]:25565'));
});

test('the main process removes launch tokens before sending any game log to the renderer', () => {
  const source = read('main.js');
  const snippet = source.slice(source.indexOf('const send ='), source.indexOf('// Ответ всегда'));
  const seen = [];
  const send = vm.runInNewContext(snippet + '\nsend;', { scrub, logger: { info() {}, error() {}, warn() {} }, win: { isDestroyed: () => false, webContents: { send: (channel, payload) => seen.push({ channel, payload }) } } });
  send('game:log', { line: '--accessToken FAKE_SECRET_123456', type: 'debug' });
  assert.equal(seen[0].payload.type, 'debug');
  assert.ok(!seen[0].payload.line.includes('FAKE_SECRET'));
});

test('copy log sanitizes on the IPC boundary without touching the real clipboard', () => {
  const source = read('main.js');
  const line = source.split('\n').find((line) => line.startsWith("handle('app:copyLog'"));
  assert.ok(line);
  let handler, copied;
  vm.runInNewContext(line, { handle: (_, fn) => { handler = fn; }, scrub, require: () => ({ clipboard: { writeText: (value) => { copied = value; } } }) });
  handler("password='TEST_PASSWORD_123' --accessToken TEST_ACCESS_TOKEN");
  assert.ok(!copied.includes('TEST_PASSWORD') && !copied.includes('TEST_ACCESS_TOKEN'));
});

test('an unchanged broad skin pattern does not suppress a later specific English translation', () => {
  const body = { nodeType: 1, tagName: 'BODY', childNodes: [], getAttribute: () => null };
  const sandbox = { localStorage: { getItem: () => 'en', setItem() {} }, document: { readyState: 'complete', documentElement: {}, body, addEventListener() {} }, MutationObserver: class { observe() {} }, confirm: () => true };
  sandbox.window = sandbox;
  vm.runInNewContext(read('renderer/i18n.js'), sandbox);
  for (const text of ['Скин «CodexAudit» загружен с example.test ✧', 'Скин «CodexAudit» не найден', 'Скин не подключён: тест']) {
    const translated = sandbox.I18N.tr(text);
    if (text.endsWith('тест')) assert.ok(translated.startsWith('Skin not attached:'));
    else assert.doesNotMatch(translated, /[А-Яа-яЁё]/);
  }
});

test('Modrinth filenames cannot escape their directory', () => {
  const source = read('core/modrinth.js');
  const a = source.indexOf('function checkedFilename'), b = source.indexOf('\n}', a) + 2;
  const check = vm.runInNewContext('(' + source.slice(a, b) + ')', { path });
  for (const name of ['../outside.jar', '..\\outside.jar', '/outside.jar', 'C:\\outside.jar', '..']) assert.throws(() => check(name));
  assert.equal(check('normal mod.jar'), 'normal mod.jar');
});
