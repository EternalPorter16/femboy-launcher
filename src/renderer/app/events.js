// События главного процесса: ход игры и задач; автообновление

api.on('game:log', ({ line, type }) => log(line, type));
api.on('game:progress', ({ label, percent }) => state.launching.size && setProgress(label, percent));
api.on('task:progress', ({ label, percent }) => {
  if (label) setProgress(label, percent);
  else hideProgress();
});
function onGameState({ id, running, crash }) {
  if (running) ((runStart[id] = Date.now()), state.running.add(id));
  else (delete runStart[id], state.running.delete(id));
  state.launching.delete(id);
  hideProgress();
  renderFooter();
  if (running) {
    Sounds.play('meow');
    toast('Игра запущена, приятной игры ✧');
    say('удачи в игре ♡');
    hearts();
  } else {
    refresh();
    if (Bisect.onGameEnd(id, crash)) return; // идёт поиск виновника: вылет — ответ на его пробу, а не повод для окна «Игра вылетела»
    if (crash) showCrash(id, crash);
    else if (state.importPending?.includes(id)) setTimeout(offerFreeSpace, 1200);
  }
}
api.on('game:state', onGameState);

/* ---------- автообновление ---------- */
let update = {};
function renderUpdate() {
  const u = update;
  const pill = $('#updatePill');
  const shown = ['downloading', 'ready', 'available'].includes(u.state);
  pill.hidden = !shown;
  pill.className = 'update-pill ' + (u.state || '');
  pill.disabled = u.state === 'downloading';
  pill.textContent =
    u.state === 'downloading'
      ? `✨ Качаю версию ${u.version}… ${u.percent || 0}%`
      : u.state === 'ready'
        ? `✨ Версия ${u.version} готова — перезапустить ♡`
        : u.state === 'available'
          ? `✨ Вышла версия ${u.version} — скачать`
          : '';

  $('#appVersion').textContent = u.current || state.system.version || '';
  $('#updateText').textContent =
    {
      dev: 'Запущено из исходников — обновления проверяются только в установленной версии.',
      checking: 'Проверяю…',
      latest: 'У тебя последняя версия ♡',
      downloading: `Скачиваю версию ${u.version}: ${u.percent || 0}%`,
      ready: `Версия ${u.version} скачана. Нажми плашку сверху или просто закрой лаунчер — обновится сам.`,
      available: `Вышла версия ${u.version}. Portable-версия не обновляется сама — скачай новую.`,
      error: `Не получилось проверить: ${u.error || 'нет связи'}`,
    }[u.state] || 'Лаунчер сам проверяет обновления при запуске и каждые 2 часа.';
  $('#updateCheck').disabled = u.state === 'dev' || u.state === 'checking' || u.state === 'downloading';
}

// Заметки об обновлении (UpdateNotes) показываем один раз за версию, прежде чем обновлять: что нового, а потом уже «Перезапустить» или «Скачать»
const notesShown = new Set();
function openUpdateNotes(items) {
  const u = update;
  const en = I18N.lang === 'en';
  const ready = u.state === 'ready';
  notesShown.add(u.version);
  const box = openModal(`
    <div class="crash-head"><div class="empty-cat" data-cat></div><div><h2>${en ? 'What’s new' : 'Что нового'} ✨</h2><p class="sub">Femboy Launcher ${esc(u.version)}</p></div></div>
    <div class="whatsnew">${items.map(([ico, title, text]) => `<div class="wn-row"><span class="wn-ico">${esc(ico)}</span><div><b>${esc(title)}</b><span>${esc(text)}</span></div></div>`).join('')}</div>
    <div class="modal-actions"><button class="btn ghost" id="unLater">Позже</button><button class="btn primary" id="unGo">${ready ? 'Перезапустить и обновить ♡' : 'Скачать'}</button></div>`);
  $('#unLater', box).onclick = closeModal;
  $('#unGo', box).onclick = () => (closeModal(), $('#updatePill').click());
}

$('#updatePill').onclick = async () => {
  try {
    if (['ready', 'available'].includes(update.state) && !notesShown.has(update.version)) {
      const items = UpdateNotes.parse(update.notes, I18N.lang === 'en' ? 'en' : 'ru');
      if (items.length) return openUpdateNotes(items);
    }
    if (update.state === 'ready') {
      say('сейчас вернусь уже обновлённым ♡');
      await call('update:install');
    } else if (update.state === 'available') await call('update:download');
  } catch (err) {
    toast(err.message, 'err');
  }
};
$('#updateCheck').onclick = () => call('update:check').catch((err) => toast(err.message, 'err'));

let announced = null;
api.on('update:status', (s) => {
  update = s;
  renderUpdate();
  if (s.state === 'ready' && announced !== s.version) {
    announced = s.version;
    toast(`Обновление ${s.version} скачано ✧`);
    say('я обновился! ну почти… перезапусти меня ♡', 6000);
  }
});
call('update:status')
  .then((s) => ((update = s), renderUpdate()))
  .catch(() => {});
