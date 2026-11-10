// Импорт сборок: из файла, из других лаунчеров, «Освободить место»

/* ---------- импорт сборок ---------- */
function openImportModal() {
  const box = openModal(`
    <h2>Импорт сборки 📦</h2>
    <p class="hint">Модпак из файла (.mrpack с Modrinth или zip с CurseForge) или сборка из Prism Launcher / MultiMC.</p>
    <div class="det-actions">
      <button class="btn primary" id="impFile">Выбрать файл .mrpack / .zip</button>
      <button class="btn soft" id="impFolder">Папка сборки Prism / MultiMC</button>
      <button class="btn soft" id="impOther">Из других лаунчеров: Legacy Launcher, TLauncher, Prism…</button>
    </div>
    <div class="modal-actions"><button class="btn ghost" id="impCancel">Отмена</button></div>`);
  $('#impCancel', box).onclick = closeModal;
  $('#impOther', box).onclick = () => openOtherImport();
  const run = async (kind) => {
    closeModal();
    say('распаковываю сборку ♡');
    try {
      const r = await call('instances:import', kind);
      if (!r) return;
      state.selected = r.instance.id;
      localStorage.setItem('selected', r.instance.id);
      await refresh();
      showPage('instances');
      toast(`Сборка «${r.instance.name}» импортирована ♡`);
      r.warnings?.forEach((w) => (toast(w, 'err'), log(w, 'error')));
      hearts();
    } catch (err) {
      toast(err.message, 'err');
    }
  };
  $('#impFile', box).onclick = () => run('file');
  $('#impFolder', box).onclick = () => run('folder');
}

// .mrpack, открытый двойным щелчком в Проводнике: главный процесс держит файл, мы спрашиваем человека и просим импорт именно его
async function takePackRequest() {
  if (reloading) return false;
  const req = await call('app:takePack').catch(() => null);
  if (!req) return false;
  showPage('instances');
  if (!confirm(`Поставить модпак «${req.name}» как новую сборку?`)) return true;
  say('распаковываю сборку ♡');
  try {
    const r = await call('instances:importOpened');
    state.selected = r.instance.id;
    localStorage.setItem('selected', r.instance.id);
    await refresh();
    showPage('instances');
    toast(`Сборка «${r.instance.name}» импортирована ♡`);
    r.warnings?.forEach((w) => (toast(w, 'err'), log(w, 'error')));
    hearts();
  } catch (err) {
    toast(err.message, 'err');
  }
  return true;
}
api.on('app:importRequest', takePackRequest);

/* ---------- другие лаунчеры: перенос и «Освободить место» ---------- */
const OL_ICONS = { instance: '📦', world: '🌍', folder: '🗂️', extras: '⚙️' };
const verLabel = (v) => `${v.version || '?'}${v.loader && v.loader !== 'vanilla' ? ' · ' + LOADERS[v.loader] : ''}`;

// Список найденного с галочками. onDone/onBack — для мастера первого запуска
async function openOtherImport({ groups = null, onDone = null, onBack = null } = {}) {
  const box = openModal(`<h2>Перенос из других лаунчеров 🧳</h2><div id="olBody"><div class="skeleton" style="height:160px"></div><p class="hint">Ищу Legacy Launcher, TLauncher, Minecraft, Prism, CurseForge, Modrinth и другие лаунчеры по всему компьютеру…</p></div>`);
  box.classList.add('wide');
  const body = $('#olBody', box);
  try {
    groups = groups || (await call('other:scan'));
  } catch (err) {
    body.innerHTML = `<p class="hint err">${esc(err.message)}</p>`;
    return;
  }
  const back = onBack ? `<button class="btn ghost" id="olBack">Назад</button>` : `<button class="btn ghost" id="olCancel">Отмена</button>`;
  if (!groups.length) {
    body.innerHTML = `
      <div class="empty"><div class="empty-cat" data-cat></div>Других лаунчеров не нашла 🥺
        <small>Ищу Legacy Launcher (TL Legacy), TLauncher и официальный Minecraft, Prism, PolyMC, CurseForge, Modrinth App, ATLauncher и GDLauncher, а ещё любые папки Minecraft на рабочем столе, в «Загрузках» и на других дисках.</small></div>
      <div class="modal-actions">${back}</div>`;
    drawCats(body);
  } else {
    // Список версий нужен только для выпадающих списков. Серверы Mojang бывают недоступны — тогда ждать его не будем,
    // а предложим привычные версии: перенос из других лаунчеров не должен зависеть от интернета
    let releases = ['1.21.4', '1.21.1', '1.20.6', '1.20.4', '1.20.1', '1.19.4', '1.19.2', '1.18.2', '1.17.1', '1.16.5', '1.15.2', '1.14.4', '1.12.2', '1.8.9'];
    try {
      const all = await Promise.race([loadVersions(), new Promise((_, no) => setTimeout(no, 4000))]);
      releases = all.versions.filter((v) => v.type === 'release').map((v) => v.id);
    } catch {}
    const relOptions = (cur) => [...new Set([cur, ...releases].filter(Boolean))].map((v) => `<option value="v:${esc(v)}">${esc(v)}</option>`).join('');
    body.innerHTML = `
      <p class="hint">Отметь, что забрать. Старые лаунчеры при этом не меняются — всё копируется к нам. Большие миры и сборки можно не копировать, а использовать <b>на месте</b>: место не тратится, но данные остаются общими со старым лаунчером.</p>
      <div class="ol-list">${groups
        .map(
          (g) => `
        <div class="ol-group">
          <div class="ol-head"><b>${esc(g.name)}</b><span class="hint">${fmtSize(g.items.reduce((s, i) => s + i.size, 0))}</span></div>
          ${g.path ? `<small class="ol-path" title="${esc(g.path)}">${esc(g.path)}</small>` : ''}
          ${
            g.target
              ? `<label class="field ol-target"><span>Миры, паки и настройки отсюда попадут в новую сборку. Версия игры:</span>
                  <select data-target="${esc(g.id)}">${g.profiles.map((p, n) => `<option value="p:${n}">${esc(verLabel(p))}</option>`).join('')}${relOptions(g.profiles.length ? null : releases[0])}</select></label>`
              : ''
          }
          ${g.items
            .map(
              (i) => `
            <div class="ol-row">
              <label class="ol-main"><input type="checkbox" class="ol-pick" data-key="${i.key}" ${i.imported ? '' : 'checked'}>
                <span class="ol-ico">${OL_ICONS[i.type]}</span>
                <span class="ol-name">${esc(i.name)}${i.count ? ` <small>· ${i.count}</small>` : ''}${i.type === 'instance' && !i.guessed ? ` <small>· ${esc(verLabel(i))}</small>` : ''}${i.imported ? ' <small class="warn">· уже перенесено</small>' : ''}</span>
              </label>
              ${i.type === 'instance' && (i.guessed || !i.version) ? `<select class="ol-ver" data-key="${i.key}" title="Версию не получилось узнать точно — проверь">${relOptions(i.version)}</select>` : ''}
              <span class="ol-size">${fmtSize(i.size)}</span>
              ${i.linkable ? `<label class="check ol-link" title="Не копировать, а использовать папку старого лаунчера"><input type="checkbox" class="ol-linked" data-key="${i.key}"> на месте</label>` : '<span></span>'}
            </div>`
            )
            .join('')}
        </div>`
        )
        .join('')}</div>
      <p class="hint" id="olSum"></p>
      <div class="modal-actions">${back}<button class="btn primary" id="olGo">Перенести ♡</button></div>`;
    const items = groups.flatMap((g) => g.items);
    const sum = () => {
      const picked = items.filter((i) => $(`.ol-pick[data-key="${i.key}"]`, body).checked);
      const copied = picked.filter((i) => !$(`.ol-linked[data-key="${i.key}"]`, body)?.checked);
      $('#olSum', body).textContent = picked.length ? `Выбрано: ${picked.length}. Займёт на диске: ${fmtSize(copied.reduce((s, i) => s + i.size, 0))}` : 'Ничего не выбрано';
      $('#olGo', body).disabled = !picked.length;
    };
    body.onchange = sum;
    sum();
    $('#olGo', body).onclick = async () => {
      const plan = { keys: [], linked: [], targets: {}, versions: {} };
      for (const i of items) {
        if (!$(`.ol-pick[data-key="${i.key}"]`, body).checked) continue;
        plan.keys.push(i.key);
        if ($(`.ol-linked[data-key="${i.key}"]`, body)?.checked) plan.linked.push(i.key);
        const ver = $(`.ol-ver[data-key="${i.key}"]`, body);
        if (ver) plan.versions[i.key] = ver.value.slice(2);
      }
      for (const g of groups.filter((g) => g.target)) {
        const v = $(`select[data-target="${g.id}"]`, body).value;
        plan.targets[g.id] = v.startsWith('p:') ? g.profiles[+v.slice(2)] : { version: v.slice(2), loader: 'vanilla' };
      }
      closeModal();
      say('переношу твои миры ♡');
      try {
        const r = await call('other:import', plan);
        await refresh();
        if (r.created[0]) {
          state.selected = r.created[0].id;
          localStorage.setItem('selected', r.created[0].id);
        }
        showPage('instances');
        renderInstances();
        renderFooter();
        toast(`Перенесено сборок: ${r.created.length} ♡`);
        say('всё переехало! теперь всё в одном месте ♡', 6000);
        hearts(8);
        onDone?.();
      } catch (err) {
        toast(err.message, 'err');
      }
    };
  }
  $('#olCancel', box) && ($('#olCancel', box).onclick = closeModal);
  $('#olBack', box) && ($('#olBack', box).onclick = onBack);
}

const OL_STATUS = {
  ready: '',
  changed: 'менялось в старом лаунчере после переноса — не трогаю',
  linked: 'используется на месте — не трогаю',
  nodest: 'нашей копии больше нет — не трогаю',
};

async function openFreeSpace() {
  const box = openModal(`<h2>Освободить место 🧹</h2><div id="fsBody"><div class="skeleton" style="height:140px"></div></div>`);
  box.classList.add('wide');
  const body = $('#fsBody', box);
  let list;
  try {
    list = await call('other:cleanupInfo');
  } catch (err) {
    body.innerHTML = `<p class="hint err">${esc(err.message)}</p>`;
    return;
  }
  // Уже убранное и общие настройки не показываем
  list = list.map((l) => ({ ...l, items: l.items.filter((i) => OL_STATUS[i.status] !== undefined) })).filter((l) => l.items.length || l.uninstall.length);
  if (!list.length) {
    body.innerHTML = `<div class="empty"><div class="empty-cat" data-cat></div>Освобождать нечего ♡<small>Здесь появятся старые копии того, что ты перенесёшь из других лаунчеров.</small></div>
      <div class="modal-actions"><button class="btn ghost" id="fsClose">Закрыть</button></div>`;
    drawCats(body);
    $('#fsClose', body).onclick = closeModal;
    return;
  }
  body.innerHTML = `
    <p class="hint">Это старые копии того, что уже перенесено в Femboy Launcher. Отмеченное уйдёт в <b>Корзину</b> — передумаешь, восстановишь оттуда. Программу лаунчера удаляет его собственная программа удаления — ты увидишь её окно.</p>
    <div class="ol-list">${list
      .map(
        (l) => `
      <div class="ol-group" data-launcher="${esc(l.id)}">
        <div class="ol-head"><b>${esc(l.name)}</b><span class="hint">${l.free ? `можно освободить ${fmtSize(l.free)}` : 'освобождать нечего'}</span></div>
        ${l.items
          .map(
            (i) => `
          <div class="ol-row fs-row">
            <label class="ol-main"><input type="checkbox" class="fs-pick" value="${i.id}" ${i.status === 'ready' ? '' : 'disabled'}>
              <span class="ol-ico">${OL_ICONS[i.type]}</span>
              <span class="ol-name">${esc(i.name)}${OL_STATUS[i.status] ? ` <small>· ${OL_STATUS[i.status]}</small>` : !i.played && i.type !== 'folder' ? ' <small class="warn">· у нас ещё не запускалось — сначала проверь, что всё работает</small>' : ''}</span>
            </label>
            <span class="ol-size">${fmtSize(i.size)}</span>
          </div>`
          )
          .join('')}
        <div class="det-actions">
          ${l.free ? `<button class="btn soft fs-trash">Убрать отмеченное в Корзину</button>` : ''}
          ${l.uninstall.map((n) => `<button class="btn ghost danger fs-un" data-name="${esc(n)}">Удалить программу «${esc(n)}»</button>`).join('')}
          ${!l.uninstall.length ? `<button class="btn ghost fs-apps">Открыть «Приложения» Windows</button>` : ''}
        </div>
      </div>`
      )
      .join('')}</div>
    <div class="modal-actions"><button class="btn ghost" id="fsClose">Готово</button></div>`;
  $('#fsClose', body).onclick = closeModal;
  body.onclick = async (e) => {
    const grp = e.target.closest('.ol-group');
    if (e.target.closest('.fs-apps')) return call('other:openApps');
    if (e.target.closest('.fs-un')) {
      const name = e.target.closest('.fs-un').dataset.name;
      if (!confirm(`Запустить удаление программы «${name}»? Откроется её собственное окно удаления — там нужно будет подтвердить ещё раз.`)) return;
      return call('other:uninstall', name).catch((err) => toast(err.message, 'err'));
    }
    if (e.target.closest('.fs-trash')) {
      const ids = $$('.fs-pick:checked', grp).map((c) => c.value);
      if (!ids.length) return toast('Отметь, что убрать', 'err');
      if (!confirm(`Убрать старые копии в Корзину (${ids.length} шт.)? В Femboy Launcher всё останется.`)) return;
      try {
        const r = await call('other:trash', ids);
        toast(`Освобождено ${fmtSize(r.freed)} ♡`);
        if (r.skipped.length) toast(`Не тронула: ${r.skipped.join(', ')}`, 'err');
        hearts();
        openFreeSpace();
      } catch (err) {
        toast(err.message, 'err');
      }
    }
  };
}

// Один раз, когда перенесённая сборка успешно отыграла: предложить освободить место
function offerFreeSpace() {
  try {
    if (localStorage.getItem('freeSpaceAsked')) return;
    localStorage.setItem('freeSpaceAsked', '1');
  } catch {
    return;
  }
  if ($('#modal').classList.contains('open')) return;
  const box = openModal(`
    <div class="crash-head"><div class="empty-cat" data-cat></div><div><h2>Перенос удался ♡</h2><p class="sub">Сборка из старого лаунчера работает и у нас</p></div></div>
    <p>Старые копии всё ещё лежат в папках прежних лаунчеров и занимают место. Посмотреть, что можно убрать? Ничего не удалится без твоего подтверждения.</p>
    <div class="modal-actions"><button class="btn ghost" id="ofNo">Не сейчас</button><button class="btn primary" id="ofYes">Посмотреть</button></div>`);
  $('#ofNo', box).onclick = closeModal;
  $('#ofYes', box).onclick = openFreeSpace;
}
$('#otherImport').onclick = () => openOtherImport();
$('#otherFree').onclick = openFreeSpace;
$('#importOffer').onchange = (e) => saveSettings({ importOffer: e.target.checked });

// Тихая проверка при запуске: нашёлся лаунчер, из которого ещё ничего не переносили, — предлагаем один раз
async function offerImport(tries = 0) {
  if (state.settings.importOffer === false) return;
  if ($('#modal').classList.contains('open') || state.launching.size) {
    if (tries < 8) setTimeout(() => offerImport(tries + 1), 10000); // идёт мастер, окно или запуск — не перебиваем
    return;
  }
  let found;
  try {
    found = (await call('other:peek')).filter((g) => g.fresh > 0 && !g.offered);
  } catch {
    return;
  }
  if (!found.length) return;
  call('other:offered', found.map((g) => g.id)).catch(() => {});
  const names = [...new Set(found.map((g) => g.name))].sort((a, b) => (a === 'Minecraft') - (b === 'Minecraft')); // общую .minecraft называем последней
  const el = document.createElement('div');
  el.className = 'toast kitty offer';
  el.innerHTML = `<span class="kt-cat" data-cat="head"></span><div class="of-text"><b></b><small>Могу перенести сюда сборки и миры. Старые лаунчеры при этом не меняются.</small></div>
    <div class="of-btns"><button class="btn primary sm" data-of="go">Перенести</button><button class="btn ghost sm" data-of="no">Не надо</button></div>`;
  $('b', el).textContent = `Нашла на компьютере: ${names.length > 3 ? `${names.slice(0, 3).join(', ')} и ещё ${names.length - 3}` : names.join(', ')}`;
  $('#toasts').append(el);
  drawCats(el);
  const close = () => (el.classList.add('out'), setTimeout(() => el.remove(), 400));
  el.onclick = (e) => {
    const b = e.target.closest('[data-of]');
    if (!b) return;
    close();
    if (b.dataset.of === 'go') openOtherImport();
  };
  setTimeout(close, 40000);
}
