const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { profile, put, server, blockInternet } = require('./helpers');

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const read = (zip, name) => zip.getEntry(name)?.getData().toString('utf8');

function setup(t) {
  const p = profile();
  t.after(() => p.done());
  const instances = p.load('core/instances');
  const inst = instances.create({ name: 'Отчётная', version: '1.20.1', loader: 'fabric', loaderVersion: '0.15.0' });
  const g = instances.gameDir(inst.id);
  put(g, {
    'mods/sodium.jar': 'a',
    'mods/stranger.jar.disabled': 'b',
    'logs/latest.log': `[06:55:12] Setting user: Fox\n[06:55:13] launch --accessToken ${JWT} --username Fox\n[06:55:14] Connecting to 203.0.113.7:25565 as fox@example.com\n`,
    'crash-reports/crash-2026-10-28_06.55.20-client.txt': `---- Minecraft Crash Report ----\nDescription: Rendering\nat C:\\Users\\Bart\\AppData\\Roaming\\Femboy Launcher\\x\n`,
    'hs_err_pid1234.log': '# A fatal error has been detected by the Java Runtime Environment\n',
  });
  p.load('core/mods').record(inst.id, 'sodium.jar', { source: 'modrinth', title: 'Sodium' });
  p.store.get().accounts.push({ id: 'ms-1', type: 'microsoft', name: 'SecretName', uuid: 'u', refresh: 'REFRESH-TOKEN-VALUE' }, { id: 'off-1', type: 'offline', name: 'Bun', uuid: 'o' });
  p.store.get().activeAccount = 'ms-1';
  p.store.get().settings.cfApiKey = '$2a$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ab';
  p.store.get().settings.proxy = 'http://user:pass123@proxy.local:8080';
  p.store.save();
  return { p, inst, report: p.load('core/report') };
}

const ctx = (inst, extra = {}) => ({
  launcher: { version: '0.8.0', electron: '33.4.0', chrome: '130', node: '20.18', osVersion: '10.0.26100', uptimeSec: 600 },
  hardware: { cpu: 'Test CPU', cores: 16, ramMb: 31000, gpus: ['GPU A', 'GPU B'], hybrid: true, laptop: false },
  javas: [{ major: 21, version: '21.0.4', vendor: 'Test', bits: 64, source: 'launcher', path: 'C:\\Users\\Bart\\java\\bin\\javaw.exe' }],
  net: { route: 'PROXY 127.0.0.1:10809', custom: false, bypass: false, verdict: 'ok', items: [{ ok: true, label: 'Modrinth', host: 'api.modrinth.com', ms: 120 }, { ok: false, label: 'Mojang', host: 'piston-meta.mojang.com', reason: 'timeout' }] },
  consoleText: `console line\nsession token:abcDEF123456:0123abcd-0123-0123-0123-0123456789ab\n--accessToken ${JWT}\n`,
  instId: inst.id,
  ...extra,
});

test('в архиве всё нужное, а паролей, токенов, ключей, имён и адресов нет', (t) => {
  const { p, inst, report } = setup(t);
  const r = report.build(ctx(inst));
  assert.ok(fs.existsSync(r.file) && r.file.startsWith(path.join(p.dir, 'reports')));
  assert.deepEqual(r.files.sort(), ['game/crash-2026-10-28_06.55.20-client.txt', 'game/hs_err_pid1234.log', 'game/latest.log', 'launcher-console.txt', 'report.txt']);
  const zip = new AdmZip(r.file);
  const text = read(zip, 'report.txt');
  for (const part of ['Версия: 0.8.0', 'Electron 33.4.0', 'Test CPU', 'Java 21 (21.0.4)', 'Активный: microsoft', 'Microsoft 1, Ely.by 0, оффлайн 1', 'ок  Modrinth', 'НЕТ Mojang', 'Название: Отчётная', 'Minecraft: 1.20.1 · загрузчик: fabric 0.15.0', 'Модов: 2', '+ sodium.jar', '- stranger.jar']) {
    assert.ok(text.includes(part), `в отчёте есть «${part}»`);
  }
  assert.match(text, /sodium\.jar · 0\.0 МБ · modrinth/);
  const everything = zip.getEntries().map((e) => e.getData().toString('utf8')).join('\n');
  for (const secret of [JWT, 'REFRESH-TOKEN-VALUE', 'SecretName', 'pass123', 'abcdefghijklmnopqrstuu', 'fox@example.com', '203.0.113.7', 'abcDEF123456', 'C:\\Users\\Bart']) {
    assert.ok(!everything.includes(secret), `«${secret}» в отчёт не попало`);
  }
  assert.ok(everything.includes('C:\\Users\\<user>\\AppData'), 'пути остались, но без имени');
  assert.match(read(zip, 'game/latest.log'), /--accessToken \*\*\*/);
});

test('лог самого лаунчера попадает в отчёт, очищенным', (t) => {
  const { p, inst, report } = setup(t);
  const logger = p.load('core/logger');
  logger.init(path.join(p.dir, 'logs'));
  logger.info('Запуск сборки', inst.id);
  logger.error('Сбой в C:\\Users\\Bart\\AppData\\x');
  const r = report.build(ctx(inst));
  assert.ok(r.files.includes('launcher.log'));
  const text = read(new AdmZip(r.file), 'launcher.log');
  assert.match(text, /\[INFO\] Запуск сборки/);
  assert.match(text, /C:\\Users\\<user>\\AppData\\x/);
  assert.ok(!text.includes('Bart'));
});

test('без выбранной сборки и без консоли отчёт тоже собирается', (t) => {
  const { report } = setup(t);
  const r = report.build({ launcher: { version: '0.8.0' } });
  assert.deepEqual(r.files, ['report.txt']);
  assert.match(read(new AdmZip(r.file), 'report.txt'), /сборка не выбрана/);
});

test('большие логи обрезаются до последних строк, хранятся только последние отчёты', (t) => {
  const { p, inst, report } = setup(t);
  const g = p.load('core/instances').gameDir(inst.id);
  fs.writeFileSync(path.join(g, 'logs/latest.log'), Array.from({ length: 9000 }, (_, i) => `line ${i}`).join('\n'));
  const r = report.build(ctx(inst));
  const lines = read(new AdmZip(r.file), 'game/latest.log').split('\n');
  assert.equal(lines.length, 4000);
  assert.equal(lines.at(-1), 'line 8999');
  const dir = path.join(p.dir, 'reports');
  for (let i = 0; i < 7; i++) fs.writeFileSync(path.join(dir, `femboy-report-2020010${i}-000000.zip`), 'old');
  report.build(ctx(inst));
  assert.equal(fs.readdirSync(dir).length, 5, 'остались пять последних');
});

test('логи игры: свежий отчёт о вылете и hs_err находятся, без логов — пусто', (t) => {
  const { p, inst, report } = setup(t);
  const g = report.gameLogs(inst.id);
  assert.match(g.latest, /Setting user/);
  assert.equal(g.crash.name, 'crash-2026-10-28_06.55.20-client.txt');
  assert.equal(g.hs.name, 'hs_err_pid1234.log');
  const empty = p.load('core/instances').create({ name: 'Пустая', version: '1.21.1', loader: 'vanilla' });
  assert.deepEqual(report.gameLogs(empty.id), { latest: null, crash: null, hs: null });
});

test('mclo.gs: лог очищается и уходит JSON-ом; ошибки сервера и связи понятны', async (t) => {
  const srv = await server((req, body) => {
    if (req.url !== '/1/log') return { status: 404 };
    if (!body?.content) return { status: 400, json: { success: false, error: "Required field 'content' not found." } };
    if (body.content.includes('REJECT')) return { status: 200, json: { success: false, error: 'Log too large' } };
    return { json: { success: true, id: 'abc123', url: 'https://mclo.gs/abc123', raw: 'https://api.mclo.gs/1/raw/abc123' } };
  });
  const unblock = blockInternet();
  const p = profile();
  t.after(async () => {
    unblock();
    await srv.close().catch(() => {});
    p.done();
  });
  const mclogs = p.load('core/mclogs');
  mclogs.configure({ api: srv.url });
  const r = await mclogs.upload(`line\n--accessToken ${JWT}\nfox@example.com C:\\Users\\Bart\\x`);
  assert.deepEqual(r, { url: 'https://mclo.gs/abc123', id: 'abc123' });
  const sent = srv.hits[0];
  assert.equal(sent.method, 'POST');
  assert.match(sent.headers['content-type'], /application\/json/);
  assert.equal(sent.body.source, 'Femboy Launcher');
  assert.ok(!sent.body.content.includes(JWT) && !sent.body.content.includes('fox@example.com') && !sent.body.content.includes('Bart'), 'на сервер ушёл очищенный текст');
  await assert.rejects(mclogs.upload('   '), /Лог пустой/);
  await assert.rejects(mclogs.upload('REJECT me'), /mclo\.gs не принял лог: Log too large/);
  await srv.close();
  await assert.rejects(mclogs.upload('text'), /Нет связи с mclo\.gs/);
});

test('mclo.gs: слишком длинный лог режется, начало и конец остаются', (t) => {
  const p = profile();
  t.after(() => p.done());
  const { prepare } = p.load('core/mclogs');
  const text = Array.from({ length: 40000 }, (_, i) => `row ${i}`).join('\n');
  const lines = prepare(text).split('\n');
  assert.equal(lines.length, 25000);
  assert.equal(lines[0], 'row 0');
  assert.equal(lines.at(-1), 'row 39999');
  assert.match(lines[1000], /^… срезано строк: 15001 …$/);
});
