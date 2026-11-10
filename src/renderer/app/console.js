// Консоль, отчёт для поддержки и лог на mclo.gs

/* ---------- консоль ---------- */
const consoleEl = $('#console');
const logFind = $('#logFind');
const logErrors = $('#logErrors');
const logCount = $('#logCount');
let pendingLines = [];
function log(line, type = 'info') {
  pendingLines.push({ line, type });
  if (pendingLines.length > 4000) pendingLines.splice(0, pendingLines.length - 4000);
  // В спрятанном окне requestAnimationFrame не срабатывает — тогда сбрасываем строки по таймеру
  if (pendingLines.length === 1) document.hidden ? setTimeout(flushLog, 300) : requestAnimationFrame(flushLog);
}
function flushLog() {
  const atBottom = consoleEl.scrollHeight - consoleEl.scrollTop - consoleEl.clientHeight < 40;
  const frag = document.createDocumentFragment();
  const added = [];
  for (const { line, type } of pendingLines) {
    const div = document.createElement('div');
    const isErr = type === 'game' && /\b(ERROR|FATAL|Exception)\b/.test(line);
    div.className = 'l-' + (isErr ? 'error' : type);
    div.textContent = line;
    frag.append(div);
    added.push(div);
  }
  pendingLines = [];
  consoleEl.append(frag);
  while (consoleEl.childElementCount > 4000) consoleEl.firstElementChild.remove();
  if (logFilterOn()) applyLogFilter(added);
  if (atBottom) consoleEl.scrollTop = consoleEl.scrollHeight;
}

// Поиск по консоли: строки без искомого прячутся (регистр не важен), «только ошибки» оставляет красные; новые строки подчиняются тому же фильтру
const logFilterOn = () => !!logFind.value.trim() || logErrors.checked;
function applyLogFilter(lines = consoleEl.children) {
  const q = logFind.value.trim().toLowerCase();
  const on = logFilterOn();
  for (const div of lines) div.classList.toggle('l-hide', on && ((logErrors.checked && !div.classList.contains('l-error')) || (!!q && !div.textContent.toLowerCase().includes(q))));
  paintLogCount();
}
// «Найдено: 2 из 4» — только пока фильтр включён; строки, спрятанные галочкой «отладка», не считаются
function paintLogCount() {
  logCount.hidden = !logFilterOn();
  if (logCount.hidden) return;
  const lines = [...(consoleEl.classList.contains('hide-debug') ? consoleEl.querySelectorAll(':scope > :not(.l-debug)') : consoleEl.children)];
  logCount.textContent = `Найдено: ${lines.filter((d) => !d.classList.contains('l-hide')).length} из ${lines.length}`;
}
logFind.oninput = () => applyLogFilter();
logErrors.onchange = () => applyLogFilter();
$('#logDebug').onchange = (e) => (consoleEl.classList.toggle('hide-debug', !e.target.checked), paintLogCount());
$('#logClear').onclick = () => ((consoleEl.innerHTML = ''), paintLogCount());
$('#logCopy').onclick = async () => {
  await call('app:copyLog', consoleEl.innerText);
  toast('Лог скопирован ✧');
};
$('#logShare').onclick = () => shareLog('console');

/* ---------- отчёт для поддержки и лог на mclo.gs ---------- */
async function buildReport(btn) {
  btn.disabled = true;
  say('собираю отчёт… 📋');
  try {
    const r = await call('report:build', { instId: state.selected, consoleText: consoleEl.innerText });
    toast(`Отчёт готов (${fmtSize(r.size)}) — папка с ним открыта ♡`);
  } catch (err) {
    toast(err.message, 'err');
  }
  btn.disabled = false;
}
$('#reportBuild').onclick = (e) => buildReport(e.currentTarget);

// Лог уходит на сторонний сайт, поэтому сначала спрашиваем
function shareLog(kind, instId) {
  const what = kind === 'console' ? 'лог из консоли лаунчера' : 'лог игры (latest.log и отчёт о вылете, если он есть)';
  const box = openModal(`
    <div class="crash-head"><div class="empty-cat" data-cat></div><div><h2>Поделиться логом? 📤</h2><p class="sub">${esc(what)}</p></div></div>
    <p class="hint">Лог уйдёт на сайт <b>mclo.gs</b> и будет доступен всем, у кого есть ссылка; хранится он там ограниченное время. Перед отправкой я убираю токены, имя пользователя из путей, почту и адреса серверов с портом, но если в логе есть что-то личное, лучше не отправлять.</p>
    <div class="modal-actions"><button class="btn ghost" id="shNo">Не отправлять</button><button class="btn primary" id="shYes">Отправить</button></div>`);
  $('#shNo', box).onclick = closeModal;
  $('#shYes', box).onclick = async (e) => {
    e.target.disabled = true;
    e.target.textContent = 'Отправляю…';
    try {
      const r = await call('report:share', { kind, instId, consoleText: kind === 'console' ? consoleEl.innerText : undefined });
      await call('app:copyText', r.url).catch(() => {});
      box.innerHTML = `
        <div class="crash-head"><div class="empty-cat" data-cat></div><div><h2>Готово ♡</h2><p class="sub">Ссылка уже в буфере обмена</p></div></div>
        <p>Просто вставь её в чат: <a href="${esc(r.url)}" target="_blank">${esc(r.url)}</a></p>
        <div class="modal-actions"><button class="btn primary" id="shOk">Закрыть</button></div>`;
      drawCats(box);
      $('#shOk', box).onclick = closeModal;
    } catch (err) {
      e.target.disabled = false;
      e.target.textContent = 'Отправить';
      toast(err.message, 'err');
    }
  };
}
