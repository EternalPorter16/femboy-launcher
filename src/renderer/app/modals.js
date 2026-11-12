// Модальные окна: каркас, создание и правка сборки, подтверждение удаления

/* ---------- модалки ---------- */
let modalCloseTimer = null;
function openModal(html) {
  const m = $('#modal');
  const box = $('#modalBox');
  clearTimeout(modalCloseTimer); // окно сразу после закрытия другого: отложенное закрытие не должно спрятать новое
  m.classList.remove('closing');
  box.className = 'modal-box card';
  box.isDirty = box.dispose = null;
  box.innerHTML = html;
  drawCats(box);
  m.classList.add('open');
  Sounds.play('open');
  return box;
}
// Закрытие по фону/Esc: редактор скинов спрашивает про несохранённое и освобождает 3D-просмотр
function closeModal() {
  const m = $('#modal');
  const box = $('#modalBox');
  if (!m.classList.contains('open')) return;
  if (box.isDirty?.() && !confirm('Выйти без сохранения?')) return;
  box.dispose?.();
  box.isDirty = box.dispose = null;
  Sounds.play('close');
  m.classList.add('closing');
  modalCloseTimer = setTimeout(() => m.classList.remove('open', 'closing'), 190);
}
$('#modal').addEventListener('mousedown', (e) => e.target.id === 'modal' && closeModal());
document.addEventListener('keydown', (e) => e.key === 'Escape' && closeModal());

async function fillVersionSelect(select, { snapshots = false, current } = {}) {
  try {
    const { versions, latest } = await loadVersions();
    const shown = versions.filter((v) => v.type === 'release' || (snapshots && v.type === 'snapshot') || v.id === current);
    const want = select.value || current || latest.release;
    select.innerHTML = shown.map((v) => `<option value="${esc(v.id)}">${esc(v.id)}${v.type === 'snapshot' ? ' (снапшот)' : ''}</option>`).join('');
    select.value = shown.some((v) => v.id === want) ? want : latest.release;
  } catch (err) {
    select.innerHTML = '<option value="">Нет связи с серверами Mojang</option>';
    toast(err.message, 'err');
  }
}

function openInstanceModal(inst) {
  const editing = !!inst;
  const draft = {
    name: inst?.name || '',
    version: inst?.version || '',
    loader: inst?.loader || 'fabric',
    icon: inst?.icon || pick(ICONS),
    color: inst?.color || pick(COLORS),
    maxRam: inst?.maxRam || '',
  };
  const win = inst?.window || {};
  const box = openModal(`
    <h2>${editing ? 'Изменить сборку' : 'Новая сборка'} 🎀</h2>
    <div class="icon-head">
      <div class="inst-icon" id="mPrev"></div>
      <label class="field" style="flex:1;margin:0"><span>Название</span><input id="mName" maxlength="40" placeholder="Моя милая сборка"></label>
    </div>
    <div class="field"><span>Версия Minecraft</span>
      <div class="row"><select id="mVersion"><option value="">Загружаю версии…</option></select>
      <label class="check"><input type="checkbox" id="mSnap"> снапшоты</label></div>
    </div>
    <label class="field"><span>Группа (необязательно) — сборки с одной группой показываются вместе</span>
      <input id="mGroup" list="mGroupList" maxlength="30" placeholder="например, С друзьями">
      <datalist id="mGroupList">${[...new Set(state.instances.map((i) => i.group).filter(Boolean))].map((g) => `<option value="${esc(g)}">`).join('')}</datalist>
    </label>
    <div class="field"><span>Загрузчик модов</span>
      <div class="seg seg-3" id="mLoader">${Object.entries(LOADERS).map(([v, n]) => `<button data-v="${v}">${n}</button>`).join('')}</div>
    </div>
    <div class="field" id="mLvField" hidden><span>Версия загрузчика</span>
      <div class="row"><select id="mLoaderVer"><option value="">Загружаю…</option></select>
      <label class="check"><input type="checkbox" id="mLvBeta"> пре-релизы</label></div>
      <small class="hint" id="mLvHint">После первого запуска лаунчер запоминает версию загрузчика, чтобы его новый выход не сломал моды. Хочешь обновить её или вернуть старую — выбери здесь.</small>
      <div id="mLvErr"></div>
      <div id="mLvWarn"></div>
    </div>
    <div class="field"><span>Иконка</span>
      <div class="icon-grid" id="mIcons">${ICONS.map((i) => `<button data-v="${i}">${i}</button>`).join('')}</div>
      <div class="color-row" id="mColors">${COLORS.map((c) => `<button data-v="${c}" style="background:${c}"></button>`).join('')}</div>
    </div>
    <details class="adv" ${inst?.javaPath || inst?.jvmArgs || win.width || win.fullscreen || inst?.maxRam ? 'open' : ''}>
      <summary>Дополнительно: память, окно, Java</summary>
      <label class="field"><span>Память для этой сборки, МБ (пусто — из настроек)</span><input id="mRam" type="number" min="512" step="256" placeholder="${state.settings.maxRam}"></label>
      <div class="field"><span>Размер окна игры (пусто — как обычно)</span>
        <div class="win-row"><input id="mW" type="number" min="320" placeholder="ширина"><input id="mH" type="number" min="240" placeholder="высота"><label class="check"><input type="checkbox" id="mFull"> во весь экран</label></div>
      </div>
      <label class="field"><span>Своя Java для этой сборки (пусто — общая)</span><input id="mJava" placeholder="авто ♡" spellcheck="false"></label>
      <label class="field"><span>Доп. аргументы JVM для этой сборки</span><input id="mJvm" placeholder="-XX:+UseZGC" spellcheck="false"></label>
    </details>
    <div class="modal-actions"><button class="btn ghost" id="mCancel">Отмена</button><button class="btn primary" id="mSave">${editing ? 'Сохранить' : 'Создать ♡'}</button></div>
  `);

  const paint = () => {
    const prev = $('#mPrev', box);
    prev.innerHTML = inst?.iconUrl && draft.icon === inst.icon ? `<img src="${esc(inst.iconUrl)}" alt="">` : esc(draft.icon);
    prev.style.setProperty('--c', draft.color);
    $$('#mIcons button', box).forEach((b) => b.classList.toggle('on', b.dataset.v === draft.icon));
    $$('#mColors button', box).forEach((b) => b.classList.toggle('on', b.dataset.v === draft.color));
    $$('#mLoader button', box).forEach((b) => b.classList.toggle('on', b.dataset.v === draft.loader));
  };
  $('#mName', box).value = draft.name;
  $('#mGroup', box).value = inst?.group || (F.group !== 'all' ? F.group : '');
  $('#mRam', box).value = draft.maxRam;
  $('#mW', box).value = win.width || '';
  $('#mH', box).value = win.height || '';
  $('#mFull', box).checked = !!win.fullscreen;
  $('#mJava', box).value = inst?.javaPath || '';
  $('#mJvm', box).value = inst?.jvmArgs || '';
  $('#mIcons', box).onclick = (e) => e.target.dataset.v && ((draft.icon = e.target.dataset.v), paint());
  $('#mColors', box).onclick = (e) => e.target.dataset.v && ((draft.color = e.target.dataset.v), paint());
  $('#mLoader', box).onclick = (e) => e.target.dataset.v && ((draft.loader = e.target.dataset.v), paint(), lvLoad());
  $('#mCancel', box).onclick = closeModal;
  paint();
  $('#mName', box).focus();

  const select = $('#mVersion', box);

  // Версия загрузчика: список под выбранную игру и загрузчик. Выбранная версия запоминается в сборке и сама больше не меняется
  // (иначе новый выход загрузчика ломал бы моды); «Последняя стабильная» поставит свежую при следующем запуске
  const lvSel = $('#mLoaderVer', box);
  let lvList = [];
  let lvValue = editing ? inst.loaderVersion || '' : ''; // пока список версий грузится, сохранение не должно стереть запомненную
  let lvSeq = 0;
  let lvWarnSeq = 0;
  // Запомненная версия относится только к той игре и тому загрузчику, с которыми она была поставлена
  const lvKeep = () => (editing && inst.loader === draft.loader && inst.version === select.value ? inst.loaderVersion || '' : '');
  const lvRender = () => {
    const shown = lvList.filter((v) => $('#mLvBeta', box).checked || !v.beta || v.version === lvValue);
    const tag = (v) => (v.tag === 'recommended' ? ' · рекомендуемая' : v.tag === 'latest' ? ' · последняя' : v.beta ? ' · пре-релиз' : '');
    lvSel.innerHTML =
      '<option value="">Последняя стабильная (поставлю при запуске)</option>' +
      (lvValue && !lvList.some((v) => v.version === lvValue) ? `<option value="${esc(lvValue)}">${esc(lvValue)} · сейчас</option>` : '') +
      shown.map((v) => `<option value="${esc(v.version)}">${esc(v.version)}${tag(v)}</option>`).join('');
    lvSel.value = lvValue;
  };
  // Моды, которым выбранная версия загрузчика не подходит (по их собственным описаниям)
  const lvCheck = async () => {
    const warn = $('#mLvWarn', box);
    warn.innerHTML = '';
    if (!editing || inst.loader !== draft.loader || !['fabric', 'quilt'].includes(draft.loader)) return;
    const version = lvValue || lvList.find((v) => !v.beta)?.version; // без выбора поставится последняя стабильная
    if (!version) return;
    const n = ++lvWarnSeq;
    try {
      const bad = await call('instances:loaderCheck', inst.id, draft.loader, version);
      if (n !== lvWarnSeq || !bad.length) return;
      warn.innerHTML =
        '<p class="hint warn">С выбранной версией эти моды могут не запуститься:</p>' +
        bad.slice(0, 6).map((b) => `<p class="hint warn"><b>${esc(b.title)}</b> <span>требует загрузчик</span> <b>${esc(b.need)}</b></p>`).join('');
    } catch {}
  };
  const lvLoad = async () => {
    const field = $('#mLvField', box);
    if (!field) return; // окно уже закрыли, а список версий игры дозагрузился позже
    field.hidden = draft.loader === 'vanilla';
    if (field.hidden || !select.value) return; // игра ещё не выбрана (список версий не загрузился)
    const n = ++lvSeq;
    lvValue = lvKeep();
    lvSel.disabled = true;
    lvSel.innerHTML = '<option value="">Загружаю…</option>';
    $('#mLvErr', box).innerHTML = '';
    try {
      lvList = await call('versions:loaders', draft.loader, select.value);
      if (n !== lvSeq || !field.isConnected) return;
      if (lvList.find((v) => v.version === lvValue)?.beta) $('#mLvBeta', box).checked = true;
    } catch (err) {
      if (n !== lvSeq || !field.isConnected) return;
      // Для этой игры у загрузчика нет версий (или нет связи): о выборе версии речи нет, остаётся «последняя стабильная»
      lvList = [];
      $('#mLvErr', box).innerHTML = `<p class="hint err">${esc(err.message)}</p>`;
    }
    lvSel.disabled = false;
    lvRender();
    lvCheck();
  };
  lvSel.onchange = () => {
    lvValue = lvSel.value;
    lvCheck();
  };
  $('#mLvBeta', box).onchange = lvRender;

  const fill = () => fillVersionSelect(select, { snapshots: $('#mSnap', box).checked, current: draft.version }).then(lvLoad);
  $('#mSnap', box).onchange = fill;
  fill();
  select.addEventListener('change', lvLoad);
  // Java: проверяем против версии игры, которая выбрана в этом окне
  const javaPick = attachJavaPicker($('#mJava', box), () => select.value);
  select.addEventListener('change', () => javaPick.verify());

  $('#mSave', box).onclick = async () => {
    const data = {
      ...draft,
      version: select.value,
      name: $('#mName', box).value.trim() || select.value,
      group: $('#mGroup', box).value.trim(),
      maxRam: $('#mRam', box).value || null,
      window: { width: $('#mW', box).value, height: $('#mH', box).value, fullscreen: $('#mFull', box).checked },
      javaPath: $('#mJava', box).value,
      jvmArgs: $('#mJvm', box).value,
      loaderVersion: draft.loader === 'vanilla' ? null : lvValue || null,
    };
    if (!editing || draft.icon !== inst.icon) data.iconUrl = null;
    if (!data.version) return toast('Выбери версию', 'err');
    try {
      const saved = editing ? await call('instances:update', inst.id, data) : await call('instances:create', data);
      closeModal();
      state.selected = saved.id;
      localStorage.setItem('selected', saved.id);
      await refresh();
      toast(editing ? 'Сохранено ✧' : `Сборка «${saved.name}» создана ♡`);
      if (!editing) (say('новая сборка! поставим моды? :3'), hearts());
    } catch (err) {
      toast(err.message, 'err');
    }
  };
}

// «Удалить» убирает сборку в корзину: пока лаунчер открыт, её можно вернуть, а когда он закроется, она исчезнет навсегда
function confirmDelete(inst) {
  const box = openModal(`
    <h2>Убрать сборку в корзину? 🥺</h2>
    <p><b>${esc(inst.name)}</b> уедет в корзину вместе со всеми мирами, модами и скриншотами. Пока лаунчер открыт, её можно вернуть кнопкой «Корзина» на главной. Когда ты закроешь лаунчер, она удалится навсегда.</p>
    <div class="modal-actions"><button class="btn ghost" id="dNo">Оставить</button><button class="btn danger-fill" id="dYes">В корзину</button></div>
  `);
  $('#dNo', box).onclick = closeModal;
  $('#dYes', box).onclick = async () => {
    try {
      await call('instances:remove', inst.id);
      closeModal();
      await refresh();
      toast('Сборка в корзине — вернуть её можно кнопкой «Корзина» ♡');
    } catch (err) {
      toast(err.message, 'err');
    }
  };
}

// Корзина: удалённые сборки лежат в ней целиком, пока лаунчер открыт
async function openTrash() {
  const box = openModal(`
    <div class="crash-head"><div class="empty-cat" data-cat></div><div><h2>Корзина 🗑️</h2><p class="sub">Удалённые сборки, пока лаунчер открыт</p></div></div>
    <div class="rp-list" id="trList"></div>
    <p class="hint">Сборка лежит здесь целиком — с мирами, модами и скриншотами. Когда ты закроешь лаунчер, корзина очистится, а сборки удалятся навсегда.</p>
    <div class="modal-actions"><button class="btn ghost" id="trClose">Закрыть</button><button class="btn danger-fill" id="trEmpty">Очистить корзину</button></div>`);
  const list = $('#trList', box);
  $('#trClose', box).onclick = closeModal;
  // Необратимое просит второй клик: кнопка меняет подпись и ждёт 4 секунды
  const sure = (b, label, ask) => {
    if (b.dataset.sure) return true;
    b.dataset.sure = '1';
    b.textContent = ask;
    setTimeout(() => {
      if (!b.isConnected || b.disabled) return;
      delete b.dataset.sure;
      b.textContent = label;
    }, 4000);
    return false;
  };
  const paint = () => {
    const items = state.trash || [];
    $('#trEmpty', box).hidden = !items.length;
    list.innerHTML = items.length
      ? items
          .map(
            (i) => `<div class="rp-row" data-id="${esc(i.id)}"><div class="tr-icon">${iconHtml(i)}</div><div class="rp-main"><b>${esc(i.name)}</b><small><span>${esc(verLabel(i))}</span> · <span>${esc(fmtDate(i.deletedAt))}</span></small></div><button class="btn soft sm" data-tr="restore">Вернуть</button><button class="btn ghost danger sm" data-tr="purge" title="Стереть сборку насовсем">Удалить навсегда</button></div>`
          )
          .join('')
      : '<p class="hint">В корзине пусто ♡</p>';
  };
  const reload = async () => {
    await refresh();
    if (list.isConnected) paint();
  };
  list.onclick = async (e) => {
    const b = e.target.closest('[data-tr]');
    if (!b) return;
    const id = b.closest('.rp-row').dataset.id;
    try {
      if (b.dataset.tr === 'purge') {
        if (!sure(b, 'Удалить навсегда', 'Точно удалить?')) return;
        b.disabled = true;
        await call('instances:trashPurge', id);
        toast('Сборка удалена навсегда');
      } else {
        b.disabled = true;
        const inst = await call('instances:trashRestore', id);
        toast(`Сборка «${inst.name}» вернулась ♡`);
        say('вернула сборку из корзины ♡');
      }
    } catch (err) {
      toast(err.message, 'err');
    }
    await reload();
  };
  $('#trEmpty', box).onclick = async (e) => {
    if (!sure(e.target, 'Очистить корзину', 'Точно очистить?')) return;
    e.target.disabled = true;
    try {
      await call('instances:trashEmpty');
      toast('Корзина очищена');
    } catch (err) {
      toast(err.message, 'err');
    }
    e.target.disabled = false;
    await reload();
  };
  await refresh(); // что лежит в корзине сейчас, а не когда в последний раз обновляли список
  if (list.isConnected) paint();
}
