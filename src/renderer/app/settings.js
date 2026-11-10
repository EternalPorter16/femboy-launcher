// Настройки, проверка связи, место на диске

/* ---------- настройки ---------- */
// Разделы настроек: слева список, справа карточки выбранного. Последний открытый запоминаем
function showSection(sec) {
  if (!$(`#setNav [data-sec="${sec}"]`)) sec = 'look';
  $$('#setNav button').forEach((b) => b.classList.toggle('on', b.dataset.sec === sec));
  $$('.set-sec').forEach((s) => s.classList.toggle('on', s.dataset.sec === sec));
  try {
    localStorage.setItem('setSec', sec);
  } catch {}
  if (sec === 'kitty') loadPlayStats(); // «Время в игре» живёт в этом разделе
}
$('#setNav').onclick = (e) => {
  const b = e.target.closest('[data-sec]');
  if (b) showSection(b.dataset.sec);
};
showSection(localStorage.getItem('setSec') || 'look');

// Курсоры на плитках настроек рисуем тем же цветом акцента, что и сами курсоры
function paintCursors() {
  const css = getComputedStyle(root).getPropertyValue('--accent').trim();
  const a = /^#[0-9a-f]{3,8}$/i.test(css) ? css : state.settings.accentColor || '#ff5fa8';
  $$('#cursorSeg .cu').forEach((b) => {
    const k = b.dataset.v;
    $('svg', b).innerHTML = k === 'system' ? `<path d='M3 2.5L3 22l5-4.4 3.4 7.9 3.2-1.4-3.3-7.7H18z' fill='#fff' stroke='${INK}' stroke-width='1.6' stroke-linejoin='round'/>` : CURSORS[k].default(a)[0];
  });
}

function renderSettings() {
  const s = state.settings;
  const total = state.system.totalMem || 8192;
  const maxR = $('#maxRam');
  const minR = $('#minRam');
  maxR.max = Math.floor(total / 256) * 256;
  minR.max = Math.floor(total / 2 / 256) * 256;
  maxR.value = s.maxRam;
  minR.value = s.minRam;
  $('#maxRamVal').textContent = fmtRam(s.maxRam);
  $('#minRamVal').textContent = fmtRam(s.minRam);
  $('#ramHint').textContent = `В системе ${fmtRam(total)} ОЗУ. Для модпаков обычно хватает 4–6 ГБ.`;
  for (const id of ['javaPath', 'jvmArgs', 'cfApiKey', 'proxy']) {
    if (document.activeElement !== $('#' + id)) $('#' + id).value = s[id] || '';
  }
  $('#closeOnLaunch').checked = s.closeOnLaunch;
  $('#importOffer').checked = s.importOffer !== false;
  $('#soundOn').checked = s.soundOn;
  $('#soundVol').value = s.soundVolume;
  $('#soundVolVal').textContent = s.soundVolume + '%';
  $('.sound-vol').classList.toggle('muted', !s.soundOn);
  Sounds.configure({ on: s.soundOn, vol: s.soundVolume });
  setSeg('themeSeg', s.theme || 'light');
  setSeg('srcSeg', s.downloadSource || 'auto');
  setSeg('motionSeg', s.motion || 'on');
  setSeg('ecoSeg', s.eco || 'auto');
  setSeg('langSeg', s.lang || 'ru');
  $('#discordRpc').checked = s.discordRpc !== false;
  $('#discordHideServer').checked = !!s.discordHideServer;
  $('#discordHideServer').disabled = s.discordRpc === false;
  $('#clearWhitelist').checked = s.clearWhitelist !== false;
  $('#backupBeforeFriends').checked = s.backupBeforeFriends !== false;
  $('#gameProxy').checked = s.gameProxy !== false;
  $('#readinessCheck').checked = s.readinessCheck !== false;
  $('#modUpdatesCheck').checked = s.modUpdatesCheck !== false;
  $('#discordHint').textContent = state.system.discord
    ? 'Друзья увидят сборку, версию и время в игре. Нужна программа Discord на компьютере (не браузер).'
    : 'Активность Discord появится в следующей версии лаунчера ♡';
  setSeg('accSeg', s.mascotAccessory || 'none');
  setSeg('cursorSeg', s.cursor || 'paw');
  $('#bgOpacity').value = s.bgOpacity;
  $('#bgOpacityVal').textContent = s.bgOpacity + '%';
  $('#bgBlur').value = s.bgBlur;
  $('#bgBlurVal').textContent = s.bgBlur + ' px';
  $('#bgClear').disabled = !state.system.backgroundUrl;
  $('#seasonal').checked = s.seasonal !== false;
  if (document.activeElement !== $('#catPhrases')) $('#catPhrases').value = (s.catPhrases || []).join('\n');
  $('#accentCustom').value = s.accentColor || '#ff5fa8';
  $('.swatch-custom').classList.toggle('on', s.accent === 'custom');
  $('.swatch-custom').style.background = s.accent === 'custom' ? s.accentColor : '';
  $$('#accentSwatches button').forEach((b) => b.classList.toggle('on', b.dataset.accent === s.accent));
  $('#dataDir').textContent = state.system.dataDir || '';
  // Portable: данные рядом с программой, а если там уже были сборки в профиле Windows, говорим, как их перенести
  const pn = $('#portableNote');
  pn.hidden = !state.system.portable && !state.system.portableLegacy;
  pn.textContent = state.system.portable
    ? 'Portable: сборки, миры, Java и настройки лежат рядом с программой, в папке data. Папку целиком можно унести на другой компьютер.'
    : state.system.portableLegacy
      ? 'Это portable-версия, но данные остались в профиле Windows: там уже были твои сборки. Чтобы хранить их рядом с программой, закрой лаунчер, создай рядом с exe папку data и перенеси в неё содержимое папки лаунчера.'
      : '';
  setSeg('scaleSeg', String([90, 100, 110, 125, 150].includes(+s.uiScale) ? s.uiScale : 100));
  setSeg('backupSeg', s.autoBackup || 'daily');
  $('#backupKeep').value = String(s.backupKeep || 5);
  renderSync();
  renderAchievements();
  renderGpu();
  javaGlobal?.verify();
  paintCursors();
  if (hw) $('#hwApply').disabled = s.maxRam === hw.maxRam;
}

// Две видеокарты (встроенная и мощная): карточка есть только на таких компьютерах
function renderGpu() {
  const g = state.gpu;
  $('#gpuCard').hidden = !g?.hybrid;
  if (!g?.hybrid) return;
  $('#gpuHigh').checked = !!state.settings.gpuHigh;
  $('#gpuNames').textContent = `Встроенная: ${g.integrated} · Мощная: ${g.discrete}`;
}
async function loadGpu() {
  state.gpu = await call('perf:gpuState').catch(() => null);
  renderGpu();
}
$('#gpuHigh').onchange = async (e) => {
  try {
    const r = await call('perf:gpuSet', e.target.checked);
    state.gpu = r;
    state.settings = r.settings;
    renderGpu();
    toast(e.target.checked ? 'Игра будет запускаться на мощной видеокарте ♡' : 'Видеокарту для Java вернула как было');
  } catch (err) {
    toast(err.message, 'err');
    e.target.checked = !e.target.checked;
  }
};

async function saveSettings(patch) {
  try {
    state.settings = await call('settings:update', patch);
    applyTheme();
    renderSettings();
  } catch (err) {
    toast(err.message, 'err');
  }
}

$('#maxRam').oninput = (e) => ($('#maxRamVal').textContent = fmtRam(+e.target.value));
$('#minRam').oninput = (e) => ($('#minRamVal').textContent = fmtRam(+e.target.value));
$('#maxRam').onchange = (e) => {
  const max = +e.target.value;
  saveSettings({ maxRam: max, minRam: Math.min(state.settings.minRam, max) });
};
$('#minRam').onchange = (e) => {
  const min = +e.target.value;
  saveSettings({ minRam: min, maxRam: Math.max(state.settings.maxRam, min) });
};
$('#javaPath').onchange = (e) => saveSettings({ javaPath: e.target.value.trim() });
// Общая Java проверяется на выбранной сборке
const javaGlobal = attachJavaPicker($('#javaPath'), () => selectedInstance()?.version);
$('#jvmArgs').onchange = (e) => saveSettings({ jvmArgs: e.target.value.trim() });
$('#cfApiKey').onchange = (e) => saveSettings({ cfApiKey: e.target.value.trim() }).then(() => toast('Ключ CurseForge сохранён ✧'));
$('#proxy').onchange = async (e) => {
  const value = e.target.value.trim();
  await saveSettings({ proxy: value });
  // Непонятный адрес main отвергает, и в настройках остаётся прежний: возвращаем его в поле
  e.target.value = state.settings.proxy || '';
  if (state.settings.proxy === value) toast(value ? 'Прокси сохранён — проверь связь кнопкой ниже ✧' : 'Прокси убран — лаунчер ходит в сеть как Windows ✧');
};
$('#netCheck').onclick = () => openNetCheck();
$('#netDot').onclick = () => openNetCheck();

/* ---------- проверка связи ---------- */
// Тексты по коду причины/вывода, которые прислал net:check
const NC_REASON = {
  timeout: 'не ответил за 10 секунд',
  dns: 'адрес не находится (DNS)',
  proxy: 'прокси не отвечает',
  cert: 'сертификат не прошёл проверку',
  refused: 'соединение отклонено',
  reset: 'соединение сброшено',
  server: 'сервер ответил ошибкой',
  other: 'не достучаться',
};
const NC_VERDICT = {
  ok: ['ok', 'Всё доступно ♡'],
  partial: ['ok', 'Главное работает. Часть остальных сервисов не отвечает — они нужны только для отдельных возможностей, например для входа через Microsoft или для CurseForge.'],
  mirror: ['warn', 'Серверы Mojang не отвечают, но зеркало BMCLAPI доступно: файлы игры лаунчер скачает с него сам (режим загрузки «Авто» или «Сначала зеркало»).'],
  core: ['bad', 'Не достучаться до серверов, без которых не скачать игру или моды. Проверь интернет, VPN и прокси.'],
  down: ['bad', 'Связи нет совсем. Проверь интернет, VPN и прокси — и нажми «Проверить ещё раз».'],
};
// Как Chromium ходит в сеть: «DIRECT» или «PROXY адрес:порт»
function ncRoute(r) {
  const first = String(r.route || '').split(';')[0].trim();
  const m = /^(PROXY|HTTPS|SOCKS5?|SOCKS4)\s+(.+)$/i.exec(first);
  if (!m) return 'Лаунчер ходит в сеть напрямую (без прокси).';
  const where = `${m[1].toUpperCase().startsWith('SOCKS') ? 'SOCKS' : m[1].toUpperCase() === 'HTTPS' ? 'HTTPS' : 'HTTP'}-прокси ${m[2]}`;
  return r.custom ? `Лаунчер ходит через ${where} (из настроек).` : `Лаунчер ходит через ${where} (так настроен Windows).`;
}
async function openNetCheck() {
  const box = openModal(`
    <div class="crash-head"><div class="empty-cat" data-cat></div><div><h2>Проверка связи 📡</h2><p class="sub" id="ncRoute">Стучусь к серверам лаунчера…</p></div></div>
    <div class="nc-list" id="ncList"></div>
    <p class="hint" id="ncVerdict"></p>
    <div class="modal-actions"><button class="btn ghost" id="ncClose">Закрыть</button><button class="btn primary" id="ncAgain" disabled>Проверить ещё раз</button></div>`);
  $('#ncClose', box).onclick = closeModal;
  const run = async () => {
    $('#ncAgain', box).disabled = true;
    $('#ncVerdict', box).textContent = '';
    $('#ncVerdict', box).className = 'hint';
    $('#ncList', box).innerHTML = '<div class="nc-row wait"><span class="nc-dot"></span><b>Проверяю…</b></div>';
    let r;
    try {
      r = await call('net:check');
    } catch (err) {
      if (!$('#ncList', box)?.isConnected) return;
      $('#ncList', box).innerHTML = '';
      $('#ncVerdict', box).textContent = err.message;
      $('#ncVerdict', box).className = 'hint err';
      $('#ncAgain', box).disabled = false;
      return;
    }
    if (!$('#ncList', box)?.isConnected) return; // окно успели закрыть
    $('#ncRoute', box).textContent = ncRoute(r);
    $('#ncList', box).innerHTML = r.items
      .map(
        (i) => `<div class="nc-row ${i.ok ? 'ok' : 'bad'}"><span class="nc-dot"></span><div class="nc-name"><b>${esc(i.label)}</b><small>${esc(i.host)}</small></div>${
          i.via === 'node' ? '<span class="chip" title="Прокси не сработал, зато напрямую дошло">в обход прокси</span>' : ''
        }<span class="nc-res">${i.ok ? `${i.ms} мс` : esc(NC_REASON[i.reason] || NC_REASON.other)}</span></div>`
      )
      .join('');
    const [tone, text] = NC_VERDICT[r.verdict] || NC_VERDICT.core;
    $('#ncVerdict', box).textContent = text;
    $('#ncVerdict', box).className = 'hint' + (tone === 'ok' ? '' : tone === 'warn' ? ' warn' : ' err');
    $('#ncAgain', box).disabled = false;
  };
  $('#ncAgain', box).onclick = run;
  run();
}
$('#closeOnLaunch').onchange = (e) => saveSettings({ closeOnLaunch: e.target.checked });
$('#discordRpc').onchange = (e) => saveSettings({ discordRpc: e.target.checked });
$('#discordHideServer').onchange = (e) => saveSettings({ discordHideServer: e.target.checked });
$('#clearWhitelist').onchange = (e) => saveSettings({ clearWhitelist: e.target.checked });
$('#backupBeforeFriends').onchange = (e) => saveSettings({ backupBeforeFriends: e.target.checked });
$('#gameProxy').onchange = (e) => saveSettings({ gameProxy: e.target.checked });
$('#readinessCheck').onchange = (e) => saveSettings({ readinessCheck: e.target.checked });
$('#modUpdatesCheck').onchange = (e) => saveSettings({ modUpdatesCheck: e.target.checked });
$('#soundOn').onchange = (e) => saveSettings({ soundOn: e.target.checked });
$('#soundVol').oninput = (e) => {
  $('#soundVolVal').textContent = e.target.value + '%';
  Sounds.configure({ vol: +e.target.value });
};
$('#soundVol').onchange = (e) => {
  saveSettings({ soundVolume: +e.target.value });
  Sounds.play('meow');
};
$('#themeSeg').onclick = (e) => {
  const b = e.target.closest('[data-v]');
  if (b) saveSettings({ theme: b.dataset.v });
};
$('#srcSeg').onclick = (e) => e.target.dataset.v && saveSettings({ downloadSource: e.target.dataset.v });$('#motionSeg').onclick = (e) => e.target.dataset.v && saveSettings({ motion: e.target.dataset.v });
$('#ecoSeg').onclick = (e) => e.target.dataset.v && saveSettings({ eco: e.target.dataset.v });

// Масштаб интерфейса: кнопки в настройках и Ctrl + «+», «−», «0» (меню у окна нет, поэтому встроенного масштаба в Chromium тоже нет)
const UI_SCALES = [90, 100, 110, 125, 150];
const setUiScale = (pct) => saveSettings({ uiScale: pct });
const stepUiScale = (d) => {
  const cur = UI_SCALES.indexOf(+state.settings.uiScale);
  const next = UI_SCALES[Math.min(UI_SCALES.length - 1, Math.max(0, (cur < 0 ? 1 : cur) + d))];
  if (next !== +state.settings.uiScale) setUiScale(next);
};
$('#scaleSeg').onclick = (e) => e.target.dataset.v && setUiScale(+e.target.dataset.v);
document.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  if (e.key === '+' || e.key === '=') stepUiScale(1);
  else if (e.key === '-' || e.key === '_') stepUiScale(-1);
  else if (e.key === '0') setUiScale(100);
  else return;
  e.preventDefault();
});
// На английский переключаемся на лету, обратно на русский — перезагрузкой окна (это делает applyTheme)
$('#langSeg').onclick = (e) => e.target.dataset.v && saveSettings({ lang: e.target.dataset.v });
$('#accSeg').onclick = (e) => {
  const b = e.target.closest('[data-v]:not([disabled])');
  if (!b) return;
  saveSettings({ mascotAccessory: b.dataset.v }).then(() => b.dataset.v !== 'none' && (say('мне идёт? 😳'), hearts(4)));
};
$('#cursorSeg').onclick = (e) => {
  const b = e.target.closest('[data-v]');
  if (b) saveSettings({ cursor: b.dataset.v }).then(() => b.dataset.v !== 'system' && say('теперь я у тебя в руке ♡'));
};
$('#accentSwatches').onclick =(e) => e.target.dataset.accent && saveSettings({ accent: e.target.dataset.accent });
$('#accentCustom').oninput = (e) => {
  root.style.setProperty('--accent', e.target.value);
  root.style.setProperty('--accent-2', `color-mix(in srgb, ${e.target.value} 45%, #8ec9ff)`);
};
$('#accentCustom').onchange = (e) => saveSettings({ accent: 'custom', accentColor: e.target.value });
$('#seasonal').onchange = (e) => saveSettings({ seasonal: e.target.checked });
$('#catPhrases').onchange = (e) =>
  saveSettings({
    catPhrases: e.target.value
      .split('\n')
      .map((s) => s.trim().slice(0, 80))
      .filter(Boolean)
      .slice(0, 30),
  }).then(() => say('запомнил ♡'));
$('#bgOpacity').oninput = (e) => {
  $('#bgOpacityVal').textContent = e.target.value + '%';
  $('#bgImage').style.setProperty('--bg-op', e.target.value / 100);
};
$('#bgOpacity').onchange = (e) => saveSettings({ bgOpacity: +e.target.value });
$('#bgBlur').oninput = (e) => {
  $('#bgBlurVal').textContent = e.target.value + ' px';
  $('#bgImage').style.setProperty('--bg-blur', e.target.value + 'px');
};
$('#bgBlur').onchange = (e) => saveSettings({ bgBlur: +e.target.value });
$('#bgPick').onclick = async () => {
  try {
    if (await call('app:pickBackground')) await refresh();
  } catch (err) {
    toast(err.message, 'err');
  }
};
$('#bgClear').onclick = async () => {
  await call('app:clearBackground').catch((err) => toast(err.message, 'err'));
  await refresh();
};
$('#openData').onclick = () => call('app:openDataDir');
$('#openLog').onclick = () => call('app:openLog').catch((err) => toast(err.message, 'err'));

/* ---------- место на диске ---------- */
let storageCats = [];
async function scanStorage() {
  const body = $('#storageBody');
  const btn = $('#storageScan');
  btn.disabled = true;
  $('#storageClean').disabled = true;
  body.innerHTML = '<div class="skeleton" style="height:120px"></div>';
  try {
    const r = await call('storage:scan');
    storageCats = r.categories;
    const freeTotal = storageCats.reduce((s, c) => s + c.free, 0);
    body.innerHTML = `
      <div class="storage-list">${storageCats
        .map(
          (c) => `
        <label class="storage-row">
          <input type="checkbox" class="check" value="${c.id}" ${c.free ? 'checked' : 'disabled'}>
          <span class="st-name">${esc(c.name)}</span>
          <span class="st-size">${fmtSize(c.total)}</span>
          <span class="st-free ${c.free ? '' : 'zero'}">${c.free ? 'можно убрать ' + fmtSize(c.free) : 'всё нужно'}</span>
        </label>`
        )
        .join('')}</div>
      <p class="hint">Сборки (миры, моды, настройки): ${fmtSize(r.instancesSize)} — их очистка не трогает. Всё, что удаляется, лаунчер сам скачает заново, если понадобится.</p>
      ${storageCats.some((c) => c.id === 'logs') ? '<p class="hint">Старые логи игры остались от тех версий лаунчера, где Java запускалась из общей папки: теперь у каждой сборки свои, эти больше нигде не нужны (заново они не скачиваются).</p>' : ''}`;
    $('#storageClean').disabled = !freeTotal;
    $('#storageClean').textContent = freeTotal ? `Очистить ${fmtSize(freeTotal)}` : 'Нечего чистить ♡';
  } catch (err) {
    body.innerHTML = `<p class="hint err">${esc(err.message)}</p>`;
  } finally {
    btn.disabled = false;
  }
}
$('#storageScan').onclick = scanStorage;
$('#storageClean').onclick = async () => {
  const ids = $$('#storageBody input:checked').map((i) => i.value);
  if (!ids.length) return;
  const free = storageCats.filter((c) => ids.includes(c.id)).reduce((s, c) => s + c.free, 0);
  if (!confirm(`Удалить неиспользуемые файлы (${fmtSize(free)})? Сборки, миры и моды не пострадают.`)) return;
  try {
    const r = await call('storage:clean', ids);
    toast(`Освобождено ${fmtSize(r.freed)} ♡`);
    say('стало просторнее ✨');
    hearts();
    scanStorage();
  } catch (err) {
    toast(err.message, 'err');
  }
};

/* ---------- одинаковые моды в разных сборках: один файл на диске ---------- */
let dedupeSaved = 0;
$('#dedupeScan').onclick = async () => {
  const info = $('#dedupeInfo');
  const btn = $('#dedupeScan');
  btn.disabled = true;
  $('#dedupeGo').hidden = true;
  info.textContent = 'Сверяю моды…';
  try {
    const r = await call('storage:dedupeScan');
    dedupeSaved = r.saved;
    info.textContent = r.files ? `Одинаковых файлов: ${r.files}, освободится ${fmtSize(r.saved)}` : 'Одинаковых модов нет ♡';
    $('#dedupeGo').hidden = !r.files;
    $('#dedupeGo').disabled = !r.files;
  } catch (err) {
    info.textContent = err.message;
  } finally {
    btn.disabled = false;
  }
};
$('#dedupeGo').onclick = async () => {
  if (!confirm(`Объединить одинаковые моды (освободится ${fmtSize(dedupeSaved)})? Названия и содержимое файлов останутся прежними; у сборок, где идёт игра, моды не трогаются.`)) return;
  $('#dedupeGo').disabled = true;
  try {
    const r = await call('storage:dedupeApply');
    toast(`Объединено файлов: ${r.linked}, освобождено ${fmtSize(r.freed)} ♡${r.skipped ? ` · пропущено: ${r.skipped}` : ''}`);
    hearts();
    $('#dedupeScan').click();
  } catch (err) {
    toast(err.message, 'err');
    $('#dedupeGo').disabled = false;
  }
};
