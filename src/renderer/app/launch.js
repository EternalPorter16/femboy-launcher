// Запуск: ход подготовки, кнопка «Играть», запуск из ярлыка

/* ---------- запуск ---------- */
// Мини-плеер внизу (на всех страницах, кроме главной) и кнопка «Играть» в карточке сборки работают в паре
function renderFooter() {
  const inst = selectedInstance();
  const others = [...state.running].filter((id) => id !== state.selected).length;
  $('#pbInst').innerHTML = inst
    ? `${iconHtml(inst)}<div style="min-width:0"><b>${esc(inst.name)}</b><span>${esc(inst.version)}${inst.loader !== 'vanilla' ? ' · ' + LOADERS[inst.loader] : ''}${others ? ` · ещё запущено: ${others}` : ''}</span></div>`
    : `<div class="inst-icon">🌸</div><div><b>Нет сборки</b><span>создай первую ♡</span></div>`;
  paintPlay();
}
function paintPlay() {
  const inst = selectedInstance();
  const running = inst && state.running.has(inst.id);
  const busy = inst && state.launching.has(inst.id);
  $$('.play-btn').forEach((btn) => {
    btn.disabled = !!busy;
    btn.classList.toggle('stop', !!running);
    $('.play-text', btn).textContent = running ? 'Закрыть игру' : busy ? 'Загрузка…' : 'Играть';
  });
  const live = $('#heroLive');
  if (live) live.hidden = !running;
  paintHeroProgress();
}

// Ход запуска или фоновой задачи: полоса в мини-плеере, а на главной — в карточке сборки вместо значков
function paintHeroProgress() {
  const hero = $('#hero');
  hero.classList.toggle('busy', !!progress);
  const box = $('#heroProgress');
  if (!progress || !box) return;
  $('.pb-label', box).textContent = progress.label;
  $('.pb-cancel', box).disabled = cancelling;
  $('.bar', box).classList.toggle('indeterminate', progress.percent == null);
  if (progress.percent != null) $('.fill', box).style.width = Math.min(100, progress.percent).toFixed(1) + '%';
}
// После «Отменить» подпись «Отменяю…» не перебиваем свежими цифрами загрузки, пока всё не остановится
let cancelling = false;
function setProgress(label, percent, force = false) {
  if (cancelling && !force) return;
  progress = { label, percent };
  $('#pbProgress').classList.add('show');
  $('#pbLabel').textContent = label;
  $('#pbCancel').disabled = cancelling;
  $('#pbProgress .bar').classList.toggle('indeterminate', percent == null);
  if (percent != null) $('#pbFill').style.width = Math.min(100, percent).toFixed(1) + '%';
  paintHeroProgress();
}
function hideProgress() {
  if (state.launching.size || state.packBusy) return;
  cancelling = false;
  progress = null;
  $('#pbProgress').classList.remove('show');
  $('#pbFill').style.width = '0';
  paintHeroProgress();
}
// «Отменить»: гасим подготовку запуска и фоновую задачу. Загрузки обрываются сразу, недокачанное удаляется
async function cancelOps() {
  if (cancelling || !progress) return;
  cancelling = true;
  setProgress('Отменяю…', null, true);
  await Promise.all([...state.launching].map((id) => call('game:cancel', id)).concat(call('task:cancel'))).catch(() => {});
}
$('#pbCancel').onclick = cancelOps;

// friends: игру запускают из окна «Играть с другом» — только тогда отмеченные друзья записываются в белый список (на один мир, потом он очищается)
async function play({ server, world, skipHealth = false, bisect = false, friends = false } = {}) {
  const inst = selectedInstance();
  if (!inst) {
    toast('Сначала создай сборку ♡', 'err');
    return openInstanceModal();
  }
  // Идёт поиск виновника: часть модов выключена, так что обычный запуск был бы странным. Окно поиска продолжит его или вернёт моды
  if (!bisect && Bisect.active.has(inst.id)) {
    toast('Идёт поиск виновника: часть модов выключена ♡', 'err');
    return Bisect.open(inst.id);
  }
  if (state.launching.has(inst.id)) return;
  if (state.running.has(inst.id)) return call('game:kill', inst.id);
  if (!activeAccount()) {
    toast('Добавь аккаунт, чтобы играть ♡', 'err');
    return showPage('accounts');
  }
  // Проверяем сборку до запуска: конфликты, недостающие моды, дубли
  if (inst.loader !== 'vanilla' && !skipHealth) {
    try {
      const h = await call('mods:health', inst.id);
      if (h.conflicts.length || h.missing.length || h.duplicates.length) {
        const go = await healthDialog(inst, h);
        if (!go) return;
      }
    } catch {}
  }
  // Ноутбук с двумя видеокартами: один раз предлагаем мощную для игры (запуск идёт в любом случае)
  if (state.gpu?.hybrid && state.gpu.laptop && !state.settings.gpuAsked) await gpuDialog(state.gpu);
  state.launching.add(inst.id);
  renderFooter();
  setProgress('Готовлюсь…', null);
  say(server ? `захожу на ${server}… 😳` : world ? 'захожу в мир… 😳' : 'запускаю… 😳');
  log(`♡ Запуск «${inst.name}» (${inst.version}${inst.loader !== 'vanilla' ? ', ' + LOADERS[inst.loader] : ''}) как ${activeAccount().name}${server ? ' → ' + server : ''}${world ? ` → мир «${world}»` : ''}`, 'info');
  try {
    await call('game:launch', inst.id, { server, world, friends });
  } catch (err) {
    if (err.cancelled) {
      log('Запуск отменён', 'info');
      toast('Запуск отменён');
      say('хорошо, не запускаю ♡');
    } else {
      log(err.message, 'error');
      toast(err.message, 'err');
      say('ой… загляни в консоль 🥺');
    }
  } finally {
    state.launching.delete(inst.id);
    hideProgress();
    renderFooter();
  }
}
$('#playBtn').onclick = () => play();

// Запуск из ярлыка сборки или командной строки (--launch <id> [--world <мир>] [--server <адрес>]). Игру, которая уже идёт,
// не закрываем: «Играть» на запущенной сборке означает «закрыть игру», а тут человек просто кликнул по ярлыку второй раз
async function launchRequest({ launch: id, world, server } = {}) {
  showPage('instances');
  if (!instById(id)) return toast('Сборка из ярлыка не найдена — возможно, её удалили', 'err');
  selectInstance(id);
  if (state.running.has(id) || state.launching.has(id)) return toast('Эта сборка уже запущена ♡');
  play({ world, server });
}
// Забирает запрос у главного процесса: он ждёт нас и при старте, и когда второй запуск лаунчера передал аргументы.
// Пока окно собирается перезагрузиться, запрос не трогаем: он пропал бы вместе с этой страницей, а новая найдёт его на месте
async function takeLaunchRequest() {
  if (reloading) return false;
  const req = await call('app:takeLaunch').catch(() => null);
  if (req) launchRequest(req);
  return !!req;
}
api.on('app:launchRequest', takeLaunchRequest);
