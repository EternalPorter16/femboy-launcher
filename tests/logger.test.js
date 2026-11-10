const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { src } = require('./helpers');

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'femboy-log-')));
const fresh = () => {
  delete require.cache[require.resolve(src('core/logger'))];
  return require(src('core/logger'));
};

test('строки пишутся с временем и уровнем, а токены и имя пользователя Windows в них очищаются', () => {
  const dir = tmp();
  try {
    const log = fresh();
    const file = log.init(path.join(dir, 'logs'));
    assert.equal(file, path.join(dir, 'logs', 'launcher.log'));
    log.info('Запуск', 'версия 0.8.0');
    log.warn('IPC', 'accounts:addElyby', 'Неверный логин или пароль');
    log.error('Сбой с токеном --accessToken abcdef123456 в C:\\Users\\Bart\\AppData\\x', new Error('boom'));
    const lines = fs.readFileSync(file, 'utf8').trimEnd().split('\n');
    assert.match(lines[0], /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} \[INFO\] Запуск версия 0\.8\.0$/);
    assert.match(lines[1], /\[WARN\] IPC accounts:addElyby Неверный логин или пароль$/);
    const err = fs.readFileSync(file, 'utf8');
    assert.ok(!err.includes('abcdef123456') && !err.includes('Bart'), 'токен и имя пользователя не попали в лог');
    assert.match(err, /\[ERROR\] Сбой с токеном --accessToken \*\*\* в C:\\Users\\<user>\\AppData\\x Error: boom/);
    assert.match(err, /\n {4,}at /, 'стек ошибки записан с отступом, чтобы строки лога не путались');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('записи до init не теряются: ждут папку и попадают в файл', () => {
  const dir = tmp();
  try {
    const log = fresh();
    log.error('Ошибка при самом старте');
    assert.equal(log.file(), null);
    log.init(path.join(dir, 'logs'));
    log.info('дальше всё хорошо');
    const text = fs.readFileSync(log.file(), 'utf8');
    assert.match(text, /Ошибка при самом старте\n.*дальше всё хорошо/s);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('большой файл превращается в launcher.1.log, потом .2, самый старый удаляется', () => {
  const dir = tmp();
  try {
    let log = fresh();
    const logs = path.join(dir, 'logs');
    fs.mkdirSync(logs, { recursive: true });
    const big = 'x'.repeat(log.MAX_BYTES + 10);
    fs.writeFileSync(path.join(logs, 'launcher.log'), 'поколение 0 ' + big);
    fs.writeFileSync(path.join(logs, 'launcher.1.log'), 'поколение 1');
    fs.writeFileSync(path.join(logs, 'launcher.2.log'), 'поколение 2 (самое старое)');
    log.init(logs);
    log.info('новая запись');
    const read = (n) => fs.readFileSync(path.join(logs, n), 'utf8');
    assert.match(read('launcher.log'), /^\d{4}-.*новая запись\n$/, 'новый файл начинается с чистого листа');
    assert.ok(read('launcher.1.log').startsWith('поколение 0 '));
    assert.equal(read('launcher.2.log'), 'поколение 1');
    assert.equal(fs.readdirSync(logs).length, 3, 'старше двух предыдущих ничего не хранится');
    // маленький файл при перезапуске не трогаем
    log = fresh();
    log.init(logs);
    log.info('ещё запись');
    assert.equal(fs.readdirSync(logs).length, 3);
    assert.match(read('launcher.log'), /новая запись\n.*ещё запись/s);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('последние строки для отчёта: хвост большого файла, а не весь', () => {
  const dir = tmp();
  try {
    const log = fresh();
    log.init(path.join(dir, 'logs'));
    for (let i = 0; i < 50; i++) log.info('строка', i);
    const t = log.tail(5).split('\n');
    assert.equal(t.length, 5);
    assert.match(t.at(-1), /строка 49$/);
    assert.equal(fresh().tail(), null, 'до init логу взяться неоткуда');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('диск недоступен: лог молча не пишется, лаунчер не падает', () => {
  const dir = tmp();
  try {
    fs.writeFileSync(path.join(dir, 'logs'), 'я файл, а не папка');
    const log = fresh();
    assert.equal(log.init(path.join(dir, 'logs')), null);
    assert.doesNotThrow(() => log.info('никуда'));
    assert.doesNotThrow(() => log.error(new Error('и это тоже')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('неожиданные ошибки: пишутся в лог всегда, окно — не чаще раза в полминуты, сообщение о фоновых — раз в минуту', () => {
  const { createHandlers } = require(src('core/fatal'));
  const lines = [];
  const shown = [];
  const notified = [];
  let t = 1_000_000;
  const h = createHandlers({ log: { error: (...a) => lines.push(a.map(String).join(' ')) }, showDialog: (e) => shown.push(e.message), notify: (r) => notified.push(String(r)), now: () => t });
  assert.equal(h.onException(new Error('первая')), true);
  assert.equal(h.onException(new Error('вторая сразу')), false, 'повторное окно не показываем');
  t += 31_000;
  assert.equal(h.onException(new Error('третья через 31 с')), true);
  assert.deepEqual(shown, ['первая', 'третья через 31 с']);
  assert.equal(lines.length, 3, 'а в лог попали все три');

  assert.equal(h.onRejection(new Error('фон 1')), true);
  assert.equal(h.onRejection('фон 2'), false);
  t += 61_000;
  assert.equal(h.onRejection('фон 3'), true);
  assert.equal(notified.length, 2);
  assert.equal(lines.length, 6);

  // сбой самого окна не должен породить новую ошибку
  const bad = createHandlers({ log: { error() {} }, showDialog: () => { throw new Error('окно не открылось'); }, notify: () => { throw new Error('и это'); } });
  assert.doesNotThrow(() => (bad.onException(new Error('x')), bad.onRejection('y')));
});
