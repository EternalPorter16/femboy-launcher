// Дымовая проверка интерфейса в настоящем Электроне. Запускает лаунчер из исходников на временном профиле, по очереди открывает
// все окна и функции и убеждается, что они работают, а в странице нет ошибок. Окно лаунчера на это время (около минуты) появляется
// на экране: не трогай его. Настоящие данные пользователя не нужны и не меняются; буфер обмена и Проводник подменены заглушками.
// npm run test:ui (в npm test и release.bat не входит: открывает окно)
// UI_ONLY=«часть названия» (несколько через |) гоняет только такие проверки: быстрый прогон при разработке и проверка самих тестов; без неё идёт всё
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { connect } = require('./cdp');
const { build } = require('./profile');
const { DIALOGS, extra } = require('./checks');

const ROOT = path.join(__dirname, '..', '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () =>
  new Promise((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
// Предупреждения Chromium, которые зависят от видеокарты и не про лаунчер: шейдеры просмотра скина (three.js)
const KNOWN_WARNING = /THREE\.WebGLProgram/;
const only = (process.env.UI_ONLY || '').split('|').filter(Boolean);
const wanted = ([name]) => !only.length || only.some((o) => name.includes(o));

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'femboy-ui-test-'));
  const userData = path.join(tmp, 'userData');
  fs.mkdirSync(userData);
  build(userData);
  const version = require(path.join(ROOT, 'package.json')).version;
  const scriptsInHtml = (fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8').match(/<script src="app\//g) || []).length;
  const port = await freePort();
  const flags = [`--user-data-dir=${userData}`, `--remote-debugging-port=${port}`, '--disable-features=CalculateNativeWinOcclusion', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'];
  const child = spawn(require('electron'), ['.', ...flags], { cwd: ROOT, stdio: 'ignore' });
  let failed = 0;
  const check = (ok, name, info = '') => {
    console.log(`${ok ? 'ok ' : 'БЕДА'} ${name.padEnd(46)} ${info}`);
    if (!ok) failed++;
  };
  try {
    for (let i = 0; i < 200; i++) {
      try {
        if ((await (await fetch(`http://127.0.0.1:${port}/json`)).json()).some((x) => x.type === 'page')) break;
      } catch {}
      await sleep(300);
    }
    const c = await connect(port);
    let ready = false;
    for (let i = 0; i < 100 && !ready; i++) {
      ready = await c.ev(`return !!document.querySelector('#heroBody h2')`);
      if (!ready) await sleep(300);
    }
    check(ready === true, 'главный экран открылся');
    await sleep(2500);
    const scripts = await c.ev(`return [...document.scripts].filter((x) => (x.getAttribute('src') || '').startsWith('app/')).length`);
    check(scripts === scriptsInHtml, 'скрипты интерфейса загружены', `${scripts} из ${scriptsInHtml}`);
    // Заглушки: буфер обмена не трогаем; окно «Что нового» профиль уже показал — закрываем всё, что открыто
    await c.ev(`const o = call; window.call = async (ch, ...a) => (ch === 'app:copyText' || ch === 'app:copyLog' || ch === 'app:copyImage' ? true : ch === 'app:saveImage' ? null : o(ch, ...a)); Clipboard.prototype.writeText = async () => {}; localStorage.setItem('seenVersion', '${version}'); const b = document.querySelector('#modalBox'); b.isDirty = null; closeModal(); await s(400); return 1`);

    for (const [name, code] of DIALOGS.filter(wanted)) {
      const r = await c.ev(`try { await (async () => { ${code} })(); } catch (e) { return 'EXC ' + e.message }
        const open = document.querySelector('#modal').classList.contains('open');
        const len = document.querySelector('#modalBox').innerText.length;
        document.querySelector('#modalBox').isDirty = null; closeModal(); await s(450);
        return { open, len }`);
      check(!!r && r.open && r.len > 20, name, typeof r === 'string' ? r : `окно ${r?.open ? 'открыто' : 'НЕ открылось'}, текста ${r?.len}`);
    }
    for (const [name, code] of extra(version).filter(wanted)) {
      const r = await c.ev(code);
      check(r !== undefined && r !== null && r !== false && !(typeof r === 'string' && r.startsWith('EXC')), name, JSON.stringify(r)?.slice(0, typeof r === 'string' && r.startsWith('EXC') ? 4000 : 80)); // причина провала — целиком: по ней видно, что именно сломано
    }
    await sleep(500);
    check(c.seen.exceptions.length === 0, 'в странице нет необработанных исключений', JSON.stringify(c.seen.exceptions));
    check(c.seen.errors.length === 0, 'в консоли страницы нет ошибок', JSON.stringify(c.seen.errors));
    const warnings = c.seen.warnings.filter((w) => !KNOWN_WARNING.test(w));
    if (warnings.length) console.log(`   предупреждения консоли (не ошибки): ${JSON.stringify(warnings).slice(0, 400)}`);
    c.close();
  } finally {
    try {
      execFileSync('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore' });
    } catch {}
    await sleep(800);
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
  console.log(failed ? `\nПРОВАЛЕНО: ${failed}` : '\nВсё хорошо');
  return failed;
}

main().then(
  (failed) => process.exit(failed ? 1 : 0),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);
