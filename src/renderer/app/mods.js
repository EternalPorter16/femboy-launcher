// Моды, модпаки, ресурспаки, шейдеры: поиск, установка, обновления

/* ---------- моды, модпаки, ресурспаки, шейдеры ---------- */
const M = state.mods;
const modsInst = () => state.instances.find((i) => i.id === M.inst);

function renderModsInstPicker() {
  if (!state.instances.some((i) => i.id === M.inst)) M.inst = state.selected;
  const sel = $('#modsInst');
  sel.innerHTML = state.instances.length
    ? state.instances.map((i) => `<option value="${esc(i.id)}">${esc(i.name)} · ${esc(i.version)}${i.loader !== 'vanilla' ? ' · ' + LOADERS[i.loader] : ''}</option>`).join('')
    : '<option value="">Нет сборок</option>';
  sel.value = M.inst || '';
}

function openBrowser(tab, type) {
  M.tab = tab;
  M.type = type;
  if (!M.inst) M.inst = state.selected;
  showPage('mods');
}

function setSeg(id, value) {
  $$(`#${id} button`).forEach((b) => b.classList.toggle('on', b.dataset.v === value));
}

function note(html) {
  const n = $('#modsNote');
  n.innerHTML = html || '';
  n.classList.toggle('show', !!html);
}

// Категории для фильтра подгружаем под текущий источник и тип
const catCache = new Map();
async function fillCategories() {
  const sel = $('#modsCat');
  if (M.tab === 'installed' || (M.tab === 'curseforge' && !state.settings.cfApiKey)) return;
  const key = `${M.tab}:${M.type}`;
  try {
    if (!catCache.has(key)) catCache.set(key, await call('browse:categories', M.tab, M.type));
    sel.innerHTML = '<option value="">Все категории</option>' + catCache.get(key).map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
    sel.value = M.category;
  } catch {
    sel.innerHTML = '<option value="">Все категории</option>';
  }
}

async function loadMods(reset = true) {
  const installedTab = M.tab === 'installed';
  if (installedTab && M.type === 'modpack') M.type = 'mod';
  setSeg('modsTab', M.tab);
  setSeg('modsType', M.type);
  $('#modsType [data-v="modpack"]').style.display = installedTab ? 'none' : '';
  $('#modsCat').style.display = installedTab ? 'none' : '';
  $('#modsSort').style.display = installedTab ? 'none' : '';
  $('#modsUpdates').style.display = installedTab && M.type === 'mod' ? '' : 'none';
  $('#modsOptimize').style.display = installedTab && M.type === 'mod' ? '' : 'none';
  $('#modsFolder').style.display = installedTab ? '' : 'none';
  $('.inst-pick').style.visibility = !installedTab && M.type === 'modpack' ? 'hidden' : '';
  $('#modsQuery').placeholder = installedTab
    ? 'Фильтр по названию…'
    : M.tab === 'curseforge'
      ? 'Поиск или Project ID с curseforge.com…'
      : { mod: 'Поиск модов… например, sodium', modpack: 'Поиск модпаков… например, Fabulously Optimized', resourcepack: 'Поиск ресурспаков… например, Faithful', shader: 'Поиск шейдеров… например, Complementary' }[M.type];
  fillCategories();
  const inst = modsInst();
  const list = $('#modList');
  if (reset) {
    M.offset = 0;
    M.items = [];
  }

  try {
    M.installed = inst ? await call('mods:list', inst.id, M.type === 'modpack' ? 'mod' : M.type) : [];
  } catch {
    M.installed = [];
  }

  if (installedTab) {
    $('#modsMore').style.display = 'none';
    if (M.originsFor !== inst?.id) [M.origins, M.originsFor] = [{}, inst?.id];
    const vanilla = inst && inst.loader === 'vanilla' && M.type === 'mod' && M.installed.length;
    note(vanilla ? 'Это ванильная сборка — моды не загрузятся, пока не выберешь загрузчик (Fabric, Quilt, Forge или NeoForge) в настройках сборки.' : '');
    renderInstalled();
    if (inst && M.type === 'mod' && M.installed.length) checkOrigins(inst.id, !!vanilla);
    return;
  }

  if (M.type !== 'modpack' && !inst) return note('Сначала создай сборку — всё ставится в неё ♡'), (list.innerHTML = '');
  if (M.tab === 'curseforge' && !state.settings.cfApiKey) {
    note('CurseForge пускает лаунчеры только с личным API-ключом. Добавь его в <a href="#" data-goto="settings">Настройках</a> — это бесплатно. А Modrinth работает сразу ♡');
    list.innerHTML = '';
    $('#modsMore').style.display = 'none';
    return;
  }
  if (M.type === 'modpack') note('Модпак установится как новая сборка. Forge и NeoForge доустановятся при первом запуске (1–3 минуты).');
  else if (M.type === 'mod' && inst.loader === 'vanilla') note(`«${esc(inst.name)}» — ванильная сборка. При установке мода лаунчер сам переведёт её на подходящий загрузчик (обычно Fabric) ♡`);
  else if (M.type === 'shader') note(inst.loader === 'vanilla' ? `При установке шейдера лаунчер сам переведёт «${esc(inst.name)}» на Fabric и поставит Iris с Sodium ♡` : 'Вместе с шейдером лаунчер сам поставит Iris (или Oculus для Forge) — если их ещё нет.');
  else note('');

  const req = ++M.req;
  if (reset) list.innerHTML = '<div class="skeleton"></div>'.repeat(5);
  $('#modsMore').disabled = true;
  try {
    const r = await call('browse:search', M.tab, {
      query: M.query,
      type: M.type,
      gameVersion: inst?.version,
      loader: inst?.loader,
      offset: M.offset,
      category: M.category || undefined,
      sort: M.sort || undefined,
    });
    if (req !== M.req) return;
    if (r.searchBlocked) {
      note(
        'Твой ключ CurseForge рабочий, но поиск CurseForge открывает только одобренным лаунчерам. ' +
          'Установка при этом работает: открой мод или модпак на curseforge.com, скопируй <b>Project ID</b> (он справа на странице) и вставь его в поле поиска ♡'
      );
      list.innerHTML = `<div class="empty"><div class="empty-cat" data-cat></div>Вставь Project ID, например <code>238222</code> — это JEI</div>`;
      drawCats(list);
      $('#modsMore').style.display = 'none';
      return;
    }
    M.total = r.total;
    M.items = M.items.concat(r.items);
    renderResults();
  } catch (err) {
    if (req !== M.req) return;
    list.innerHTML = `<div class="empty"><div class="empty-cat" data-cat></div>Не получилось загрузить 🥺<small>${esc(err.message)}</small></div>`;
    drawCats(list);
  }
}

// Откуда моды: проверка идёт тихо, по хэшам файлов; без связи просто ничего не помечаем
async function checkOrigins(instId, hasOtherNote) {
  try {
    const o = await call('mods:origins', instId);
    if (M.tab !== 'installed' || M.type !== 'mod' || M.originsFor !== instId) return; // пока считали, человек ушёл
    M.origins = o;
    renderInstalled();
    const n = Object.values(o).filter((v) => v === 'unknown').length;
    if (n && !hasOtherNote) note(`У ${n} ${plural(n, 'мода', 'модов', 'модов')} неизвестный источник: этих файлов нет на Modrinth. Так бывает с модами с других сайтов, но если не помнишь, откуда файл взялся, лучше убрать его: чужие jar-файлы могут быть вредоносными.`);
  } catch {}
}

function renderInstalled() {
  const list = $('#modList');
  const q = M.query.toLowerCase();
  const items = M.installed.filter((m) => !q || (m.title || m.file).toLowerCase().includes(q));
  const kindName = { mod: 'Модов', resourcepack: 'Ресурспаков', shader: 'Шейдеров' }[M.type];
  if (!items.length) {
    list.innerHTML = `<div class="empty"><div class="empty-cat" data-cat></div>${M.installed.length ? 'Ничего не нашлось' : `${kindName} пока нет… поищем на Modrinth? :3`}<button class="btn soft sm" data-goto-browse>Найти</button></div>`;
    return drawCats(list);
  }
  const isMod = M.type === 'mod';
  list.innerHTML = items
    .map(
      (m) => {
        // Источник: записан лаунчером при установке или найден по хэшу файла на Modrinth
        const src = m.source || (isMod && M.origins?.[m.file] === 'modrinth' ? 'modrinth' : '');
        const stranger = isMod && !m.source && M.origins?.[m.file] === 'unknown';
        return `
    <div class="card mod-row ${m.enabled ? '' : 'off'}" data-file="${esc(m.file)}">
      <div class="mod-icon">${m.icon ? `<img src="${esc(m.icon)}" alt="">` : m.folder ? '📁' : isMod ? '🧩' : '🎨'}</div>
      <div class="mod-info"><b>${esc(m.title || m.file)}</b><span class="by">${esc(m.version || '')}</span>${
        stranger ? '<span class="chip warn" title="Этого файла нет на Modrinth: так бывает с модами с других сайтов и самодельными. Если не знаешь, откуда он взялся, лучше убрать: чужие jar-файлы могут быть вредоносными">неизвестный источник</span>' : ''
      }${isMod && m.pinned ? '<span class="chip">📌 закреплён</span>' : ''}<p>${esc(m.file)}${m.size ? ' · ' + fmtSize(m.size) : ''}${src ? ' · ' + (src === 'modrinth' ? 'Modrinth' : 'CurseForge') : ''}</p></div>
      ${isMod ? `<button class="btn ghost sm pin ${m.pinned ? 'on' : ''}" data-act="pin" title="${m.pinned ? 'Закреплён: «Обновить моды» его пропускает. Нажми, чтобы открепить' : 'Закрепить эту версию: «Обновить моды» её пропустит'}">📌</button>` : ''}
      ${isMod ? `<label class="toggle" title="Включён"><input type="checkbox" data-act="toggle" ${m.enabled ? 'checked' : ''}><span class="knob"></span></label>` : ''}
      <button class="btn ghost danger sm" data-act="remove">Удалить</button>
    </div>`;
      }
    )
    .join('');
  stagger(list);
  list.classList.add('stagger');
}

function renderResults() {
  const list = $('#modList');
  const installedIds = new Set(M.installed.filter((m) => m.source === M.tab).map((m) => String(m.projectId)));
  const inst = modsInst();
  // Ванильную сборку лаунчер сам переведёт на нужный загрузчик при установке — кнопка доступна всегда
  const canInstall = M.type === 'modpack' || !!inst;
  if (!M.items.length) {
    list.innerHTML = `<div class="empty"><div class="empty-cat" data-cat></div>Ничего не нашлось под ${esc(inst?.version || 'эту версию')} 🥺</div>`;
    drawCats(list);
  } else {
    const from = list.querySelectorAll('.mod-row').length;
    list.innerHTML = M.items
      .map((m, idx) => {
        const has = installedIds.has(String(m.id));
        return `
      <div class="card mod-row" data-id="${esc(m.id)}" style="--i:${Math.max(0, Math.min(idx - from, 14))}">
        <div class="mod-icon">${m.icon ? `<img src="${esc(m.icon)}" alt="" loading="lazy">` : '🧩'}</div>
        <div class="mod-info"><b>${esc(m.title)}</b><span class="by">${m.author ? 'от ' + esc(m.author) : ''}</span><p title="${esc(m.description)}">${esc(m.description)}</p></div>
        <span class="mod-stats">⬇ ${fmtNum(m.downloads)}</span>
        ${m.url ? `<a class="btn ghost sm" href="${esc(m.url)}" target="_blank" title="Открыть страницу">↗</a>` : ''}
        <button class="btn sm ${has ? 'done' : 'primary'}" data-act="install" ${has || !canInstall || state.packBusy ? 'disabled' : ''}>${has ? 'Установлен ✓' : M.type === 'modpack' ? 'Установить' : 'Поставить'}</button>
      </div>`;
      })
      .join('');
    list.classList.add('stagger');
  }
  $('#modsMore').style.display = M.items.length < M.total ? '' : 'none';
  $('#modsMore').disabled = false;
}

let queryTimer;
$('#modsQuery').oninput = (e) => {
  M.query = e.target.value.trim();
  clearTimeout(queryTimer);
  queryTimer = setTimeout(() => (M.tab === 'installed' ? renderInstalled() : loadMods()), M.tab === 'installed' ? 0 : 350);
};
$('#modsTab').onclick = (e) => {
  if (!e.target.dataset.v || e.target.dataset.v === M.tab) return;
  M.tab = e.target.dataset.v;
  M.category = '';
  loadMods();
};
$('#modsType').onclick = (e) => {
  if (!e.target.dataset.v || e.target.dataset.v === M.type) return;
  M.type = e.target.dataset.v;
  M.category = '';
  loadMods();
};
$('#modsCat').onchange = (e) => ((M.category = e.target.value), loadMods());
$('#modsSort').onchange = (e) => ((M.sort = e.target.value), loadMods());
$('#modsInst').onchange = (e) => {
  M.inst = e.target.value;
  loadMods();
};
$('#modsMore').onclick = () => {
  M.offset = M.items.length;
  loadMods(false);
};
$('#modsFolder').onclick = () => M.inst && call('mods:openFolder', M.inst, M.type).catch((err) => toast(err.message, 'err'));
$('#modsOptimize').onclick = () => M.inst && openOptimize(M.inst);
$('#modsUpdates').onclick = () => checkModUpdates();

// Обновления модов: проверяем, показываем список, ставим выбранные
async function checkModUpdates() {
  const inst = modsInst();
  if (!inst) return;
  const btn = $('#modsUpdates');
  btn.disabled = true;
  say('ищу обновления модов 👀');
  try {
    const ups = await call('mods:checkUpdates', inst.id);
    // Закреплённые моды не проверялись: говорим, сколько их, чтобы «все свежие» не вводило в заблуждение
    const pinned = (await call('mods:list', inst.id, 'mod').catch(() => [])).filter((m) => m.pinned).length;
    if (!ups.length) return toast(pinned ? `Все остальные моды свежие ♡ Закреплено, не проверялось: ${pinned}` : 'Все моды свежие ♡');
    const box = openModal(`
      <h2>Обновления модов ✨</h2>
      <p class="hint">Для «${esc(inst.name)}» нашлось обновлений: ${ups.length}. Сними галочки с тех, что обновлять не нужно.</p>
      ${pinned ? `<p class="hint">Закреплённые моды не обновляются: ${pinned}.</p>` : ''}
      <div class="upd-list">${ups
        .map(
          (u) => `
        <div class="upd-item">
          <label class="upd-row"><input type="checkbox" class="check" checked value="${esc(u.file)}">
            <div class="mod-icon">${u.icon ? `<img src="${esc(u.icon)}" alt="">` : '🧩'}</div>
            <b>${esc(u.title)}</b><span class="v">${esc(u.from)} → <b>${esc(u.to)}</b></span></label>
          ${u.changelog ? `<details class="upd-log"><summary>Что нового</summary><div class="upd-notes">${esc(u.changelog)}</div></details>` : ''}
        </div>`
        )
        .join('')}</div>
      <div class="modal-actions"><button class="btn ghost" id="upNo">Позже</button><button class="btn primary" id="upYes">Обновить</button></div>`);
    $('#upNo', box).onclick = closeModal;
    $('#upYes', box).onclick = async () => {
      const files = $$('.upd-list input:checked', box).map((i) => i.value);
      if (!files.length) return closeModal();
      closeModal();
      try {
        const r = await call('mods:applyUpdates', inst.id, files);
        toast(`Обновлено модов: ${r.done.length} ♡`);
        r.failed.forEach((f) => (toast(f, 'err'), log(f, 'error')));
        hearts();
        loadMods();
      } catch (err) {
        toast(err.message, 'err');
      }
    };
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    btn.disabled = false;
  }
}

$('#modsNote').addEventListener('click', async (e) => {
  const a = e.target.closest('a');
  if (!a) return;
  e.preventDefault();
  if (a.dataset.goto) showPage(a.dataset.goto);
  if ('fixLoader' in a.dataset) {
    await call('instances:update', M.inst, { loader: 'fabric' });
    await refresh();
    toast('Fabric включён ♡');
    loadMods();
  }
});

$('#modList').addEventListener('click', async (e) => {
  if (e.target.closest('[data-goto-browse]')) {
    M.tab = 'modrinth';
    return loadMods();
  }
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const row = btn.closest('.mod-row');
  if (btn.dataset.act === 'toggle') {
    try {
      await call('mods:toggle', M.inst, row.dataset.file, btn.checked);
      row.classList.toggle('off', !btn.checked);
    } catch (err) {
      toast(err.message, 'err');
    }
  } else if (btn.dataset.act === 'pin') {
    const m = M.installed.find((x) => x.file === row.dataset.file);
    try {
      await call('mods:pin', M.inst, row.dataset.file, !m?.pinned);
      if (m) m.pinned = !m.pinned;
      renderInstalled();
    } catch (err) {
      toast(err.message, 'err');
    }
  } else if (btn.dataset.act === 'remove') {
    try {
      await call('mods:remove', M.inst, row.dataset.file, M.type);
      row.style.transition = 'opacity .25s, transform .3s';
      row.style.opacity = '0';
      row.style.transform = 'translateX(20px)';
      setTimeout(() => loadMods(), 260);
    } catch (err) {
      toast(err.message, 'err');
    }
  } else if (btn.dataset.act === 'install') {
    const item = M.items.find((m) => String(m.id) === row.dataset.id);
    if (M.type === 'modpack') installPack(item, btn);
    else installItem(item, btn);
  }
});

async function installItem(item, btn) {
  btn.disabled = true;
  btn.textContent = 'Ставлю…';
  try {
    const r = await call('browse:install', M.tab, M.inst, item.id, M.type);
    btn.className = 'btn sm done';
    btn.textContent = 'Установлен ✓';
    toast(r.installed.length > 1 ? `Установлено: ${r.installed.join(', ')}` : `«${item.title}» установлен ♡`);
    (r.notes || []).forEach((n) => (toast(n), log(n, 'info')));
    r.warnings.forEach((w) => (toast(w, 'err'), log(w, 'error')));
    say(pick(['ещё модик! :3', 'вкусно 😳', 'ставь ещё ♡']));
    hearts(4);
    // Если сборку перевели на загрузчик — обновляем карточки и подсказку над списком
    if (r.notes?.length) {
      await refresh();
      note('');
    }
    M.installed = await call('mods:list', M.inst, M.type);
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Поставить';
    toast(err.message, 'err');
  }
}

async function installPack(item, btn) {
  state.packBusy = true;
  $$('#modList [data-act="install"]').forEach((b) => (b.disabled = true));
  btn.textContent = 'Устанавливаю…';
  log(`♡ Установка модпака «${item.title}» (${M.tab})`, 'info');
  say('качаю модпак, подожди чуть-чуть ♡');
  try {
    const r = await call('browse:installPack', M.tab, item.id);
    state.selected = r.instance.id;
    localStorage.setItem('selected', r.instance.id);
    await refresh();
    toast(`Модпак «${r.instance.name}» готов! Жми «Играть» ♡`);
    packChecked.add(r.instance.id); // только что поставили — свежий
    r.warnings.forEach((w) => (toast(w, 'err'), log(w, 'error')));
    say('модпак готов! играем? 😳');
    hearts();
    showPage('instances');
  } catch (err) {
    toast(err.message, 'err');
    log(err.message, 'error');
    say('ой… что-то пошло не так 🥺');
  } finally {
    state.packBusy = false;
    if (M.tab !== 'installed') renderResults();
  }
}
