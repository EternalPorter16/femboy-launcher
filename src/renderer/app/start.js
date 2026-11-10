// «Что нового», мастер первого запуска и стартовая цепочка. Подключается последним

/* ---------- мастер первого запуска ---------- */
// «Что нового» — один раз после обновления. При первой установке просто запоминаем версию
function showWhatsNew() {
  const cur = state.system.version;
  let seen = null;
  try {
    seen = localStorage.getItem('seenVersion');
    localStorage.setItem('seenVersion', cur);
  } catch {
    return;
  }
  if (!seen || seen === cur) return;
  const cmp = (a, b) => a.split('.').map(Number).reduce((r, x, i) => r || x - (+b.split('.')[i] || 0), 0);
  // Все версии, вышедшие после той, что была у человека
  const fresh = (window.CHANGELOG || []).filter((c) => cmp(c.version, seen) > 0 && cmp(c.version, cur) <= 0);
  if (!fresh.length) return;
  const en = I18N.lang === 'en';
  openModal(`
    <div class="crash-head"><div class="empty-cat" data-cat></div><div><h2>${en ? 'What’s new' : 'Что нового'} ✨</h2><p class="sub">Femboy Launcher ${esc(cur)}</p></div></div>
    <div class="whatsnew">
      ${fresh
        .map(
          (c) => `${fresh.length > 1 ? `<h4>${esc(c.version)}</h4>` : ''}${(en ? c.en : c.ru)
            .map(([ico, title, text]) => `<div class="wn-row"><span class="wn-ico">${ico}</span><div><b>${esc(title)}</b><span>${esc(text)}</span></div></div>`)
            .join('')}`
        )
        .join('')}
    </div>
    <div class="modal-actions"><button class="btn primary" id="wnOk">${en ? 'Yay ♡' : 'Ура ♡'}</button></div>`);
  $('#wnOk').onclick = () => closeModal();
}

function openWizard({ start = 'account', found = null } = {}) {
  const draft = { name: '', loader: 'fabric', optimize: true };
  const box = openModal(`
    <div class="wiz-cat" data-cat></div>
    <div id="wizBody"></div>`);
  const body = $('#wizBody', box);
  const finish = () => {
    try {
      localStorage.setItem('wizardDone', '1');
    } catch {}
  };
  // Пока человек вводит ник, ищем другие лаунчеры — если что-то есть, предложим перенести.
  // И сразу даём игре столько памяти, сколько советует подбор под компьютер
  const scanning = found ? Promise.resolve(found) : call('other:scan').catch(() => []);
  if (!found)
    call('hw:info')
      .then((h) => saveSettings({ maxRam: h.maxRam, minRam: Math.min(state.settings.minRam, h.maxRam) }))
      .catch(() => {});
  const next = async () => {
    const groups = await scanning;
    groups.length ? stepFound(groups) : step2();
  };

  const stepFound = (groups) => {
    const count = (g, t) => g.items.filter((i) => i.type === t).length;
    body.innerHTML = `
      <div class="wiz-step">Шаг 2 из 2</div>
      <h2>Нашла твои старые лаунчеры ♡</h2>
      <p class="hint">Могу перенести сюда сборки, миры и паки — будет всё в одном месте. Старые лаунчеры при этом не меняются.</p>
      <div class="storage-list">${groups
        .map(
          (g) => `
        <div class="storage-row"><span></span><span class="st-name">${esc(g.name)}</span><span class="st-size">${fmtSize(g.items.reduce((s, i) => s + i.size, 0))}</span>
          <span class="st-free">${[count(g, 'instance') && `сборок: ${count(g, 'instance')}`, count(g, 'world') && `миров: ${count(g, 'world')}`].filter(Boolean).join(' · ') || 'паки и настройки'}</span></div>`
        )
        .join('')}</div>
      <div class="modal-actions"><button class="btn ghost" id="wzNew">Нет, сделать новую сборку</button><button class="btn primary" id="wzImp">Выбрать, что перенести</button></div>`;
    $('#wzNew', body).onclick = step2;
    $('#wzImp', body).onclick = () => openOtherImport({ groups, onDone: finish, onBack: () => openWizard({ start: 'found', found: groups }) });
  };

  const step1 = () => {
    body.innerHTML = `
      <div class="wiz-step">Шаг 1 из 2</div>
      <h2>Привет! Давай знакомиться ♡</h2>
      <label class="field"><span>Придумай ник для игры</span><input id="wzName" placeholder="например, PinkCat_" maxlength="16" spellcheck="false"></label>
      <div class="wiz-or">— или —</div>
      <button class="btn soft" id="wzMs" style="width:100%">Войти через Microsoft (лицензия)</button>
      <div class="modal-actions"><button class="btn ghost" id="wzSkip">Пропустить</button><button class="btn primary" id="wzNext">Дальше</button></div>`;
    $('#wzName', body).focus();
    $('#wzSkip', body).onclick = () => (finish(), closeModal());
    $('#wzMs', body).onclick = async (e) => (await loginMicrosoft(e.currentTarget)) && next();
    $('#wzNext', body).onclick = async () => {
      const name = $('#wzName', body).value.trim();
      if (!NAME_RE.test(name)) return toast('Ник: 3–16 символов, латиница, цифры и _', 'err');
      try {
        await call('accounts:addOffline', name);
        await refresh();
        next();
      } catch (err) {
        toast(err.message, 'err');
      }
    };
  };

  const step2 = () => {
    body.innerHTML = `
      <div class="wiz-step">Шаг 2 из 2</div>
      <h2>Первая сборка 🎀</h2>
      <label class="field"><span>Версия Minecraft</span><select id="wzVer"><option>Загружаю версии…</option></select></label>
      <div class="field"><span>Какую сборку хочешь?</span>
        <div class="seg" id="wzLoader"><button data-v="vanilla">Обычный Minecraft</button><button data-v="fabric">С модами (Fabric)</button></div>
      </div>
      <label class="toggle" id="wzOptRow"><input type="checkbox" id="wzOpt" checked><span class="knob"></span>Сразу поставить моды для FPS (Sodium и др.)</label>
      <div class="modal-actions"><button class="btn ghost" id="wzSkip2">Позже</button><button class="btn primary" id="wzDone">Готово ♡</button></div>`;
    fillVersionSelect($('#wzVer', body));
    const paint = () => {
      setSeg('wzLoader', draft.loader);
      $('#wzOptRow', body).style.display = draft.loader === 'vanilla' ? 'none' : '';
    };
    $('#wzLoader', body).onclick = (e) => e.target.dataset.v && ((draft.loader = e.target.dataset.v), paint());
    paint();
    $('#wzSkip2', body).onclick = () => (finish(), closeModal());
    $('#wzDone', body).onclick = async () => {
      const version = $('#wzVer', body).value;
      if (!version) return;
      try {
        const inst = await call('instances:create', { name: draft.loader === 'vanilla' ? `Minecraft ${version}` : `${I18N.lang === 'en' ? 'My instance' : 'Моя сборка'} ${version}`, version, loader: draft.loader, icon: '🌸', color: '#ffd1e8' });
        finish();
        closeModal();
        state.selected = inst.id;
        localStorage.setItem('selected', inst.id);
        await refresh();
        say('всё готово! жми «Играть» ♡', 6000);
        hearts(8);
        if (draft.loader !== 'vanilla' && $('#wzOpt', body).checked) runOptimize(inst.id);
      } catch (err) {
        toast(err.message, 'err');
      }
    };
  };
  start === 'found' ? stepFound(found) : step1();
}

refresh()
  .then(() => {
    moveIndicator();
    let done = false;
    try {
      done = !!localStorage.getItem('wizardDone');
    } catch {}
    if (!done && !state.accounts.length && !state.instances.length) openWizard();
    // Запустили из ярлыка: сразу играем, «Что нового» не перебивает (покажется при обычном запуске).
    // Если окно сейчас перезагрузится (язык), ни то ни другое здесь не трогаем: после перезагрузки всё случится как надо
    else if (!reloading) takeLaunchRequest().then(async (launched) => ((await takePackRequest()) || launched) || showWhatsNew());
    checkPackUpdates();
    Bisect.checkPending();
    renderHardware();
    loadGpu();
    setTimeout(offerImport, 9000);
  })
  .catch((err) => toast(err.message, 'err'));
