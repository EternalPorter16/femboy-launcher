// Отчёт для поддержки: один ZIP с тем, что нужно, чтобы разобраться с проблемой (версии, железо, Java, связь, логи, список
// модов). Паролей и токенов в нём нет, личные пути и адреса серверов обезличены. Сам никуда не отправляется: файл остаётся
// на компьютере, и человек решает, кому его показать
const fs = require('fs');
const path = require('path');
const os = require('os');
const AdmZip = require('adm-zip');
const scrub = require('./scrub');
const logger = require('./logger');
const store = require('./store');
const instances = require('./instances');
const mods = require('./mods');
const fsx = require('./fsx');

const TAIL_LINES = 4000;
const TAIL_BYTES = 3 * 1024 * 1024;
const KEEP = 5; // сколько последних отчётов хранить

// Последние строки большого файла, не читая его целиком
function tail(file, lines = TAIL_LINES) {
  try {
    const size = fs.statSync(file).size;
    const take = Math.min(size, TAIL_BYTES);
    const buf = Buffer.alloc(take);
    const fd = fs.openSync(file, 'r');
    try {
      fs.readSync(fd, buf, 0, take, size - take);
    } finally {
      fs.closeSync(fd);
    }
    let text = buf.toString('utf8');
    if (size > take) text = text.slice(text.indexOf('\n') + 1); // первая строка могла обрезаться посередине
    const all = text.split(/\r?\n/);
    return (all.length > lines ? all.slice(-lines) : all).join('\n');
  } catch {
    return null;
  }
}

const newest = (dir, re) => {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => re.test(f))
      .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t)[0]?.f;
  } catch {
    return undefined;
  }
};

// Логи игры сборки: latest.log, свежий отчёт о вылете игры и свежий hs_err (вылет самой Java)
function gameLogs(instId) {
  const g = instances.gameDir(instId);
  const out = { latest: tail(path.join(g, 'logs', 'latest.log')), crash: null, hs: null };
  const crash = newest(path.join(g, 'crash-reports'), /^crash-.*\.txt$/i);
  if (crash) out.crash = { name: crash, text: tail(path.join(g, 'crash-reports', crash)) };
  const hs = newest(g, /^hs_err_pid\d+\.log$/i);
  if (hs) out.hs = { name: hs, text: tail(path.join(g, hs), 600) };
  return out;
}

const mb = (n) => (n / 1048576).toFixed(1);

function describeInstance(instId) {
  const inst = instances.get(instId);
  const s = store.get().settings;
  const origins = fsx.readJson(path.join(instances.dirOf(instId), 'origins.json')).data || {};
  const list = mods.list(instId);
  const rows = list.map((m) => `  ${m.enabled ? '+' : '-'} ${m.file} · ${mb(m.size)} МБ${m.source ? ' · ' + m.source : origins[m.file] ? ' · ' + origins[m.file].status : ''}`);
  return [
    `Название: ${inst.name}`,
    `Minecraft: ${inst.version} · загрузчик: ${inst.loader}${inst.loaderVersion ? ' ' + inst.loaderVersion : ''}`,
    `Память: ${inst.maxRam || s.maxRam} МБ (мин. ${s.minRam}) · Java сборки: ${inst.javaPath || 'авто'} · аргументы JVM: ${[s.jvmArgs, inst.jvmArgs].filter(Boolean).join(' ') || 'нет'}`,
    inst.pack?.projectId ? `Модпак: ${inst.pack.source} ${inst.pack.projectId} версия ${inst.pack.version}` : 'Модпак: нет',
    `Игра запускалась раз: ${inst.playtime ? 'играли ' + Math.round(inst.playtime / 60000) + ' мин' : 'ещё не запускалась'}`,
    `Модов: ${list.length}`,
    ...rows,
  ].join('\n');
}

// ctx: { launcher, hardware, javas, net, consoleText, instId } — всё, что знает главный процесс; отчёт только собирает это вместе
function build(ctx = {}, outDir = path.join(store.baseDir(), 'reports')) {
  const s = store.get();
  const L = ctx.launcher || {};
  const hw = ctx.hardware;
  const lines = [];
  const add = (title, body) => lines.push(`== ${title} ==`, body, '');
  lines.push('Femboy Launcher — отчёт для поддержки', `Создан: ${new Date().toLocaleString('ru-RU')}`, '');

  let free = '';
  try {
    const st = fs.statfsSync(store.baseDir());
    free = ` · свободно на диске: ${(st.bavail * st.bsize / 1073741824).toFixed(1)} ГБ`;
  } catch {}
  add('Лаунчер', [`Версия: ${L.version || '?'}${L.portable ? ' (portable)' : ''} · язык: ${s.settings.lang}`, `Electron ${L.electron || '?'} · Chromium ${L.chrome || '?'} · Node ${L.node || '?'}`, `Система: ${os.type()} ${L.osVersion || os.release()} (${process.platform} ${os.arch()})`, `Папка данных: ${store.baseDir()}${free}`, `Работает: ${Math.round((L.uptimeSec || 0) / 60)} мин`].join('\n'));
  add('Компьютер', hw ? [`Процессор: ${hw.cpu} (${hw.cores} потоков)`, `Память: ${hw.ramMb} МБ`, `Видеокарты: ${(hw.gpus || []).join('; ') || 'не определены'}${hw.hybrid ? ' (две видеокарты)' : ''}${hw.laptop ? ' · ноутбук' : ''}`].join('\n') : 'не определён');
  add('Java', [(ctx.javas || []).map((j) => `  Java ${j.major} (${j.version}) ${j.vendor || ''} ${j.bits}-бит · ${j.source} · ${j.path}`).join('\n') || '  на компьютере не найдена (лаунчер скачивает свою)', `В настройках: ${s.settings.javaPath || 'авто'}`].join('\n'));
  add('Настройки (без ключей)', JSON.stringify(scrub.settings(s.settings), null, 2));
  const count = (t) => s.accounts.filter((a) => a.type === t).length;
  const active = s.accounts.find((a) => a.id === s.activeAccount);
  add('Аккаунты', `Активный: ${active ? active.type : 'нет'} · всего: Microsoft ${count('microsoft')}, Ely.by ${count('elyby')}, оффлайн ${count('offline')} (имена и токены в отчёт не попадают)`);
  const n = ctx.net;
  add('Связь', n ? [`Как лаунчер ходит в сеть: ${n.route || '?'}${n.custom ? ' (свой прокси из настроек)' : ''}${n.bypass ? ' · часть запросов идёт в обход прокси' : ''}`, ...n.items.map((i) => `  ${i.ok ? 'ок ' : 'НЕТ'} ${i.label} (${i.host}) ${i.ok ? i.ms + ' мс' : i.reason || ''}${i.via === 'node' ? ' · в обход прокси' : ''}`), `Вывод: ${n.verdict}`].join('\n') : 'не проверялась');

  const zip = new AdmZip();
  const files = ['report.txt'];
  let instBlock = 'сборка не выбрана';
  if (ctx.instId) {
    try {
      instBlock = describeInstance(ctx.instId);
      const g = gameLogs(ctx.instId);
      for (const [name, text] of [['latest.log', g.latest], [g.crash?.name, g.crash?.text], [g.hs?.name, g.hs?.text]]) {
        if (!name || text == null) continue;
        zip.addFile(`game/${name}`, Buffer.from(scrub.text(text), 'utf8'));
        files.push(`game/${name}`);
      }
    } catch (e) {
      instBlock = `не прочиталась: ${e.message}`;
    }
  }
  add('Сборка', instBlock);
  if (ctx.consoleText) {
    zip.addFile('launcher-console.txt', Buffer.from(scrub.text(String(ctx.consoleText).split(/\r?\n/).slice(-TAIL_LINES).join('\n')), 'utf8'));
    files.push('launcher-console.txt');
  }
  // Лог самого лаунчера: в нём то, что было до перезапуска, а консоль окна помнит только текущий сеанс
  const launcherLog = logger.tail(3000);
  if (launcherLog) {
    zip.addFile('launcher.log', Buffer.from(scrub.text(launcherLog), 'utf8'));
    files.push('launcher.log');
  }
  lines.push(`Файлы в архиве: ${files.join(', ')}`);
  // Весь текст отчёта ещё раз пропускаем через очистку: в путях и аргументах мог остаться лишнее
  zip.addFile('report.txt', Buffer.from(scrub.text(lines.join('\n')), 'utf8'));

  fs.mkdirSync(outDir, { recursive: true });
  const d = new Date();
  const p = (x) => String(x).padStart(2, '0');
  const file = path.join(outDir, `femboy-report-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.zip`);
  zip.writeZip(file);
  const old = fs.readdirSync(outDir).filter((f) => /^femboy-report-.*\.zip$/.test(f)).sort().reverse().slice(KEEP);
  for (const f of old) fs.rmSync(path.join(outDir, f), { force: true });
  return { file, size: fs.statSync(file).size, files };
}

module.exports = { build, gameLogs, tail };
