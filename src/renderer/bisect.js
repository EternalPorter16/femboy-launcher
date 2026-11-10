// Поиск мода-виновника: окно-помощник. Всё состояние поиска хранит главный процесс (папка сборки), здесь только показ и
// кнопки. Пользуется функциями из app/ (call, openModal, play…): все они в общей области видимости, но только когда уже вызваны,
// поэтому подключается ДО app/ — иначе файлы app/ могли бы обратиться к Bisect раньше, чем он создан.
// Подписи собраны так, чтобы каждая фраза была отдельным текстом (так их переводит i18n)
const Bisect = (() => {
  const active = new Set(); // сборки с незаконченным поиском: обычный «Играть» на них открывает это окно, а не запускает игру
  let run = null; // что сейчас с игрой в окне: { id, ui: 'ready' | 'running' | 'ask', crash }

  const KIND = {
    vanilla: ['Игра без модов', 'Сначала проверю, что проблема вообще из-за модов.'],
    search: ['Часть модов', 'Сужаю круг: если проблемы нет, виновник среди выключенных, если есть — среди включённых.'],
    confirm: ['Только подозреваемый', 'Проверяю найденного: правда ли он виноват один.'],
    combo: ['Сочетания модов', 'Один мод не виноват — ищу сочетание.'],
  };

  const head = (inst, extra = '') => `<div class="crash-head"><div class="empty-cat" data-cat></div><div><h2>Найти мод-виновника 🔎</h2><p class="sub"><span>${esc(inst.name)}</span>${extra}</p></div></div>`;
  const stepOf = (v) => ` · <span>проба</span> <span>${v.step}</span> <span>из</span> <span>~${v.stepsMax}</span>`;

  async function open(id, { report } = {}) {
    const inst = instById(id);
    if (!inst) return;
    let v;
    try {
      v = await call('bisect:status', id);
    } catch (err) {
      return toast(err.message, 'err');
    }
    if (v) active.add(id);
    else active.delete(id);
    if (!v) return intro(inst, report);
    if (v.phase === 'done') return result(inst, v);
    if (run?.id === id && run.ui === 'ask') return ask(inst, v);
    test(inst, v);
  }

  async function intro(inst, report) {
    if (inst.loader === 'vanilla') return toast('В ванильной сборке нет модов', 'err');
    let count = 0;
    try {
      count = (await call('mods:list', inst.id)).filter((m) => m.enabled).length;
    } catch {}
    const box = openModal(`
      ${head(inst)}
      <p class="bs-lead">Если игра вылетает или ведёт себя странно, я найду мод, из-за которого это происходит: буду включать часть модов и запускать игру, а ты будешь говорить, повторилась ли проблема. Каждая проба сужает круг вдвое, так что хватит нескольких запусков.</p>
      <p class="hint">Включено модов: <b>${count}</b></p>
      ${count < 2 ? '<p class="hint err">Для поиска нужно хотя бы два включённых мода.</p>' : ''}
      <p class="hint">Все твои моды я потом верну как были (или выключу найденный — как решишь). Перед началом сохраню точку восстановления.</p>
      <div class="modal-actions"><button class="btn ghost" id="bsNo">Закрыть</button><button class="btn primary" id="bsGo"${count < 2 ? ' disabled' : ''}>Начать поиск</button></div>`);
    $('#bsNo', box).onclick = closeModal;
    $('#bsGo', box).onclick = async (e) => {
      e.target.disabled = true;
      try {
        const v = await call('bisect:start', inst.id, { report });
        active.add(inst.id);
        say('ищу виновника: включаю моды по частям 🔎');
        test(inst, v);
      } catch (err) {
        e.target.disabled = false;
        toast(err.message, 'err');
      }
    };
  }

  const chip = (h, i) => `<span class="chip ${h.crashed ? 'bad' : 'live'}" title="${h.crashed ? 'Проблема повторилась' : 'Всё в порядке'}">${i + 1} · ${h.count || '—'} ${h.crashed ? '✗' : '✓'}</span>`;

  function test(inst, v) {
    const t = v.test;
    const [what, why] = KIND[t.kind];
    const busy = run?.id === inst.id && run.ui === 'running';
    const box = openModal(`
      ${head(inst, stepOf(v))}
      <p class="bs-what"><b>${what}</b>${t.count ? ` <span class="chip live">${t.count} / ${v.total}</span>` : ''}</p>
      <p class="hint">${why}</p>
      ${t.count ? mgGroup(t.mods.map((title) => ({ title, enabled: true })), 'live', 'Включены', 'вместе с нужными им библиотеками') : ''}
      <p class="hint">Запусти игру, воспроизведи проблему (или дождись вылета) и закрой игру. Потом я спрошу, повторилась ли она.</p>
      ${v.history.length ? `<div class="bs-hist">${v.history.map(chip).join('')}</div>` : ''}
      <div class="modal-actions wrap"><button class="btn ghost" id="bsStop">Вернуть всё как было</button><button class="btn ghost" id="bsClose">Закрыть</button><button class="btn primary" id="bsGo"${busy ? ' disabled' : ''}>${busy ? 'Игра запущена…' : 'Запустить игру'}</button></div>`);
    $('#bsClose', box).onclick = closeModal;
    $('#bsStop', box).onclick = () => stop(inst);
    $('#bsGo', box).onclick = () => launch(inst);
  }

  async function launch(inst) {
    if (state.running.has(inst.id) || state.launching.has(inst.id)) return toast('Игра уже запущена: закрой её, и я задам вопрос ♡', 'err');
    run = { id: inst.id, ui: 'running', crash: null };
    open(inst.id); // кнопка станет «Игра запущена…»
    selectInstance(inst.id);
    try {
      await play({ skipHealth: true, bisect: true });
    } catch {}
    // Игра не запустилась (ошибка запуска): даём попробовать снова. Если она уже успела закрыться, окно показывает вопрос
    if (run?.id === inst.id && run.ui === 'running' && !state.running.has(inst.id)) {
      run.ui = 'ready';
      open(inst.id);
    }
  }

  function ask(inst, v) {
    const crash = run.crash;
    const box = openModal(`
      ${head(inst, stepOf(v))}
      <h3 class="bs-q">Проблема повторилась? 🤔</h3>
      ${crash ? `<p class="hint">Игра вылетела:</p><p class="crash-reason">${esc(crash.reason)}</p>` : '<p class="hint">Игра закрыта без вылета.</p>'}
      <div class="modal-actions wrap"><button class="btn ghost" id="bsClose">Закрыть</button><button class="btn ${crash ? 'soft' : 'primary'}" id="bsNo">Нет, всё в порядке</button><button class="btn ${crash ? 'primary' : 'soft'}" id="bsYes">Да, повторилась</button></div>`);
    $('#bsClose', box).onclick = closeModal;
    const send = async (crashed) => {
      try {
        const next = await call('bisect:answer', inst.id, crashed);
        run = null;
        if (next.phase === 'done') result(inst, next);
        else test(inst, next);
      } catch (err) {
        toast(err.message, 'err');
      }
    };
    $('#bsNo', box).onclick = () => send(false);
    $('#bsYes', box).onclick = () => send(true);
  }

  // Конец поиска: моды возвращены как были; files — виновники, которых человек решил оставить выключенными
  async function done(inst, files) {
    try {
      const r = await call('bisect:finish', inst.id, files);
      active.delete(inst.id);
      run = null;
      closeModal();
      toast(r.disabled.length ? `Выключила: ${r.disabled.join(', ')}. Остальное вернула как было ♡` : 'Моды вернула как были ♡');
      if (r.disabled.length) hearts();
      refresh();
    } catch (err) {
      toast(err.message, 'err');
    }
  }

  function stop(inst) {
    if (confirm('Вернуть все моды как были и закончить поиск?')) done(inst, []);
  }

  function result(inst, v) {
    const r = v.result;
    if (r.kind === 'not-mods' || r.kind === 'all') {
      // Выбирать нечего: моды уже как были, поиск заканчиваем сразу
      call('bisect:finish', inst.id, []).then(() => (active.delete(inst.id), refresh()), () => {});
      const box = openModal(`
        ${head(inst)}
        <h3 class="bs-q">${r.kind === 'all' ? 'Один мод не виноват 🤔' : 'Дело не в модах 🤔'}</h3>
        <p class="bs-lead">${
          r.kind === 'all'
            ? 'Проблема появляется только когда включены все моды сразу. Так бывает, когда не хватает памяти или сборка слишком тяжёлая: выдели игре больше памяти или убери самые тяжёлые моды.'
            : 'Проблема повторилась и без модов, значит, виноваты не они. Загляни в «Консоль» и проверь Java, память и драйвер видеокарты.'
        }</p>
        <p class="hint">Все моды я вернула как были.</p>
        <div class="modal-actions"><button class="btn primary" id="bsOk">Закрыть</button></div>`);
      $('#bsOk', box).onclick = closeModal;
      return;
    }
    const combo = r.kind === 'combo';
    const rows = r.culprits.map((c, i) => `<label class="opt-row"><input type="checkbox" class="check bs-pick" value="${esc(c.file)}"${combo && i ? '' : ' checked'}><div class="opt-txt"><b>${esc(c.title)}</b></div></label>`).join('');
    const box = openModal(`
      ${head(inst)}
      <h3 class="bs-q">${combo ? 'Нашла сочетание 🎯' : 'Нашла виновника 🎯'}</h3>
      <p class="hint">${combo ? 'Проблема появляется только когда эти моды включены вместе. Обычно хватает выключить один из них:' : 'Проблема повторяется, когда включён:'}</p>
      <div class="opt-list">${rows}</div>
      ${r.libs.length ? `<p class="hint">Вместе с ним включаются нужные ему моды: <b>${esc(r.libs.join(', '))}</b>. Если проблема останется и без него, поищи ещё раз: возможно, дело в одном из них.</p>` : ''}
      <div class="modal-actions wrap"><button class="btn ghost" id="bsKeep">Вернуть всё как было</button><button class="btn primary" id="bsOff">Выключить и закончить</button></div>`);
    const picked = () => [...box.querySelectorAll('.bs-pick:checked')].map((i) => i.value);
    const off = $('#bsOff', box);
    box.addEventListener('change', () => (off.disabled = !picked().length));
    $('#bsKeep', box).onclick = () => done(inst, []);
    off.onclick = () => done(inst, picked());
  }

  // Игра закрылась. Если идёт поиск и это его проба — вылет здесь не «авария», а ответ на вопрос
  function onGameEnd(id, crash) {
    if (!run || run.id !== id || run.ui !== 'running') return false;
    run.ui = 'ask';
    run.crash = crash ? { reason: crash.reason, report: crash.report } : null;
    open(id);
    return true;
  }

  // После перезапуска лаунчера: поиск мог остаться недоделанным, а часть модов — выключенной
  async function checkPending() {
    try {
      const list = await call('bisect:pending');
      list.forEach((x) => active.add(x.id));
      if (list.length) toast(`Поиск виновника в «${list[0].name}» не закончен: часть модов выключена. «Ещё → Продолжить поиск виновника» продолжит или вернёт всё как было`, 'err');
    } catch {}
  }

  return { open, active, onGameEnd, checkPending };
})();
