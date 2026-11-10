// Проверки, которым нужен настоящий Электрон (стек Chromium, safeStorage): сеть через прокси, вход Microsoft, форма-загрузка и
// «Проверить связь». Запуск: npm run test:electron (через run.js, он забирает результат из файла)
const { app, session } = require('electron');
const fs = require('fs');
const path = require('path');
const http = require('http');

const SRC = path.join(__dirname, '..', '..', 'src');
const OUT = process.env.ELECTRON_TEST_OUT;
const out = (s) => OUT && fs.appendFileSync(OUT, s + '\n');
let bad = 0;
const ok = (cond, label, extra = '') => (out(`  ${cond ? '✔' : '✘'} ${label}${extra ? '  ' + extra : ''}`), cond || bad++);
app.setPath('userData', process.env.ELECTRON_TEST_UD);
// A temporary window is destroyed before the final network checks. Only the
// explicit app.exit below may end this test run.
app.on('window-all-closed', () => {});

// Обычный fetch из Node ломаем сразу: тест должен проверять именно путь через Chromium
const nodeCalls = [];
globalThis.fetch = async (url) => {
  nodeCalls.push(String(url));
  throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
};

// Поддельный прокси: записывает, куда просили соединиться (CONNECT), и либо отказывает, либо молчит
function startProxy() {
  const px = { mode: 'refuse', log: [], sockets: new Set() };
  const server = http.createServer((req, res) => (px.log.push('HTTP ' + req.url), (res.statusCode = 502), res.end()));
  server.on('connect', (req, socket) => {
    px.log.push(req.url);
    px.sockets.add(socket);
    socket.on('close', () => px.sockets.delete(socket));
    socket.on('error', () => {});
    if (px.mode === 'refuse') socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      px.url = `http://127.0.0.1:${server.address().port}`;
      px.close = () => (px.sockets.forEach((s) => s.destroy()), server.close());
      resolve(px);
    })
  );
}

async function main() {
  const net = require(path.join(SRC, 'core/net'));
  const proxy = require(path.join(SRC, 'core/proxy'));
  const store = require(path.join(SRC, 'core/store'));
  const accounts = require(path.join(SRC, 'core/accounts'));
  const netcheck = require(path.join(SRC, 'core/netcheck'));
  store.init(process.env.ELECTRON_TEST_UD);
  const px = await startProxy();
  await proxy.apply(session.defaultSession, px.url);

  out('сеть идёт стеком Chromium через прокси из настроек');
  const e1 = await net.netFetch('https://example.com/').then(() => null, (e) => e);
  ok(e1 && net.isNetworkError(e1), 'отказ прокси узнаётся как «нет связи»', String(e1).slice(0, 80));
  ok(px.log.some((l) => l.startsWith('example.com:443')), 'запрос ушёл через прокси', px.log.join(', '));

  out('\nвход Microsoft идёт тем же путём (msmc подключается через require, а не import)');
  const acc = { id: 'ms-test', type: 'microsoft', name: 'Fem', uuid: '0123456789abcdef0123456789abcdef', refresh: 'fake-refresh-token' };
  store.get().accounts.push(acc);
  px.log.length = 0;
  let offline = 0;
  const auth = await accounts.getAuth(acc, { fallback: true, onOffline: () => offline++ }).catch((e) => ({ error: e }));
  ok(!auth.error && auth.name === 'Fem' && auth.uuid === acc.uuid && auth.meta.type === 'mojang' && offline === 1, 'нет связи с Microsoft → вход без аккаунта, ник и UUID те же', auth.error?.message);
  ok(px.log.some((l) => l.startsWith('login.live.com:443')), 'msmc стучался в login.live.com через Chromium, а не мимо него', px.log.join(', '));
  const strict = await accounts.getAuth(acc).then(() => null, (e) => e);
  ok(/^Нет связи с Microsoft/.test(strict?.message || ''), 'без запасного входа (скины, плащи) — понятная ошибка про связь', strict?.message);

  out('\nотмена ожидания Microsoft');
  px.mode = 'hang';
  const token = net.cancelToken();
  const t0 = Date.now();
  const pending = net.runCancellable(token, () => accounts.getAuth(acc, { fallback: true }));
  setTimeout(() => token.cancel(), 700);
  await pending.then(() => ok(false, 'вход не должен завершиться, пока прокси молчит'), (e) => ok(e.cancelled === true && Date.now() - t0 < 3000, 'вход прерван отменой, а не через 25 секунд', `${Date.now() - t0} мс`));
  px.sockets.forEach((s) => s.destroy()); // зависшие соединения закрываем, иначе Chromium ждёт их в следующих проверках
  px.mode = 'refuse';

  out('\nформа-загрузка (скин) через Chromium');
  await proxy.apply(session.defaultSession, '');
  let got = null;
  const up = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => ((got = { type: req.headers['content-type'], auth: req.headers.authorization, body: Buffer.concat(chunks).toString('latin1') }), res.end('{}')));
  });
  await new Promise((r) => up.listen(0, '127.0.0.1', r));
  const form = new FormData();
  form.append('variant', 'slim');
  form.append('file', new Blob([Buffer.from('PNGDATA')], { type: 'image/png' }), 'skin.png');
  const r = await net.netFetch(`http://127.0.0.1:${up.address().port}/skin`, { method: 'POST', body: form, headers: { Authorization: 'Bearer abc' } }).catch((e) => ({ error: e }));
  ok(!r.error && r.ok && /^multipart\/form-data; boundary=/.test(got?.type) && got.auth === 'Bearer abc' && got.body.includes('PNGDATA') && got.body.includes('name="variant"'), 'multipart-запрос дошёл целиком', r.error ? String(r.error) : got?.type);
  up.close();

  out('\nярлык сборки (клик по нему запускает именно эту сборку)');
  const shortcut = require(path.join(SRC, 'core/shortcut'));
  const cli = require(path.join(SRC, 'core/cli'));
  const lnkDir = path.join(process.env.ELECTRON_TEST_UD, 'shortcuts');
  fs.mkdirSync(lnkDir, { recursive: true });
  const made = shortcut.create({ id: 'instance-4c2c54', name: 'Шейдеры: «красота»?' }, { dir: lnkDir });
  ok(path.basename(made.file) === 'Шейдеры_ «красота»_ - Femboy Launcher.lnk' && fs.existsSync(made.file), 'файл ярлыка создан, символы, недопустимые в имени, заменены', path.basename(made.file));
  const link = require('electron').shell.readShortcutLink(made.file);
  ok(/--launch=instance-4c2c54$/.test(link.args) && cli.parse(link.args.split(' '))?.launch === 'instance-4c2c54', 'в ярлыке — аргумент --launch с id сборки, и лаунчер разбирает его обратно', link.args);
  ok(link.target === process.execPath, 'ярлык ведёт на программу', link.target);
  ok(/Femboy Launcher: Шейдеры/.test(link.description), 'у ярлыка есть подсказка с названием сборки', link.description);
  const again = shortcut.create({ id: 'instance-4c2c54', name: 'Шейдеры: «красота»?' }, { dir: lnkDir });
  ok(again.file === made.file, 'повторное создание заменяет свой же ярлык, а не плодит копии');
  let bad = null;
  try { shortcut.create({ id: 'a b', name: 'x' }, { dir: lnkDir }); } catch (e) { bad = e; }
  ok(/Некорректный id/.test(bad?.message || ''), 'мусорный id в ярлык не попадает');

  out('\nкартинка «Итогов»: PNG из холста читается Электроном (буфер обмена и окно сохранения не трогаем)');
  const { nativeImage } = require('electron');
  const imagesave = require(path.join(SRC, 'core/imagesave'));
  const { makePng } = require(path.join(__dirname, '..', 'helpers'));
  const real = makePng(16, 12);
  const decoded = imagesave.decodePng(`data:image/png;base64,${real.toString('base64')}`);
  const img = nativeImage.createFromBuffer(decoded);
  ok(decoded.equals(real) && !img.isEmpty() && img.getSize().width === 16 && img.getSize().height === 12, 'настоящий PNG проходит проверку и открывается как картинка 16×12', JSON.stringify(img.getSize()));
  const hollow = Buffer.concat([real.subarray(0, 8), Buffer.from('это не данные картинки'), real.subarray(real.length - 12)]);
  ok(imagesave.decodePng(hollow.toString('base64')).equals(hollow) && nativeImage.createFromBuffer(hollow).isEmpty(), 'подпись и конец есть, а внутри мусор: проверка пропускает, Электрон отдаёт пустую картинку (её ловит main.js)');

  out('\nпанель задач: полоска прогресса и список переходов на значке (свой идентификатор программы: настоящий список лаунчера не затрагивается)');
  const { BrowserWindow } = require('electron');
  const taskbar = require(path.join(SRC, 'core/taskbar'));
  const jumplist = require(path.join(SRC, 'core/jumplist'));
  const hidden = new BrowserWindow({ show: false });
  const seen = [];
  const bar = taskbar.create({ apply: (value, mode) => (hidden.setProgressBar(value, { mode }), seen.push(`${value}:${mode}`)) });
  bar.task(40);
  bar.launch('a', null);
  bar.launchEnd('a');
  bar.taskEnd();
  ok(seen.join(' ') === '0.4:normal 1:indeterminate 0.4:normal -1:none', 'Электрон принимает все состояния полоски (обычная, бегущая, скрыть)', seen.join(' '));
  hidden.destroy();
  ok(!hidden.isDestroyed() === false && (() => { try { bar.task(10); return true; } catch { return false; } })(), 'окно закрыто, а загрузка идёт: полоска молчит, ничего не падает');
  app.setAppUserModelId('dev.femboy.launcher.jumplist-test');
  const exe = process.execPath;
  const cats = jumplist.build(
    [{ id: 'instance-a1b2c3', name: 'Уютное выживание «тест» & <b>', version: '1.21.1', loader: 'fabric', lastPlayed: 5 }, { id: 'instance-d4e5f6', name: 'Без модов', version: '1.20.1', loader: 'vanilla' }],
    { exe }
  );
  const jl = app.setJumpList(cats);
  ok(jl === 'ok' || jl === 'customCategoryAccessDeniedError', 'своя категория: Windows принимает или отказывает только из-за настроек приватности («недавние элементы» выключены)', jl);
  const asTasks = app.setJumpList(jumplist.asTasks(cats));
  ok(asTasks === 'ok', 'те же ссылки среди «Задач» Windows принимает всегда (запасной путь main.js)', asTasks);
  ok(app.setJumpList(null) === 'ok', 'список сбрасывается обратно');

  out('\n«Проверить связь» при мёртвом прокси');
  await proxy.apply(session.defaultSession, px.url);
  px.log.length = 0;
  const rep = await netcheck.run(session.defaultSession, px.url);
  ok(rep.verdict === 'down' && rep.items.length === netcheck.TARGETS.length && rep.items.every((i) => !i.ok), 'прокси отказывает → «связи нет совсем»');
  ok(rep.items.every((i) => i.reason === 'proxy'), 'причина у каждой строки — «прокси не отвечает»', [...new Set(rep.items.map((i) => i.reason))].join(','));
  ok(rep.custom === true && /^PROXY 127\.0\.0\.1:\d+/.test(rep.route), 'видно, что идём через свой прокси', rep.route);
  ok(netcheck.TARGETS.every((t) => px.log.some((l) => l.startsWith(new URL(t.url).host + ':443'))), 'все серверы проверены через прокси');
  px.close();
}

app.whenReady().then(async () => {
  try {
    await main();
  } catch (e) {
    out('СБОЙ ' + (e.stack || e));
    bad++;
  }
  out(bad ? `ПРОВАЛЕНО: ${bad}` : 'Всё хорошо');
  app.exit(bad ? 1 : 0);
});
