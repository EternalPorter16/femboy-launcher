// Перенос сборки на новую версию Minecraft

/* ---------- перенос на новую версию ---------- */
// Копия сборки на новой версии Minecraft. Окно сразу показывает, у каких модов есть версия под неё, а у каких нет;
// старая сборка остаётся как была. Подписи собраны так, чтобы каждая фраза была отдельным текстом (так их переводит i18n)
const mgRow = (it) => {
  // Номер версии мода мог не измениться, а файл другой (под новую игру): тогда «1.11.3 → 1.11.3» ничего не говорит
  const note = it.error || it.reason || (it.status === 'update' ? (it.from === it.to ? 'файл под новую игру' : `${it.from ? it.from + ' → ' : '→ '}${it.to}`) : it.declared ? 'подходит по описанию мода' : !it.enabled && it.status !== 'unknown' ? 'выключен' : '');
  return `<div class="mg-row">${it.icon ? `<img src="${esc(it.icon)}" alt="" loading="lazy">` : ''}<b>${esc(it.title)}</b>${note ? `<span>${esc(note)}</span>` : ''}</div>`;
};
const mgGroup = (items, chip, title, note, { open = false, row = mgRow } = {}) =>
  items.length ? `<details class="mg-group"${open ? ' open' : ''}><summary><span class="chip ${chip}">${items.length}</span><b>${title}</b><small>${note}</small></summary><div class="mg-list">${items.map(row).join('')}</div></details>` : '';

function renderMigratePlan(pl) {
  const by = (s) => pl.mods.filter((m) => m.status === s);
  const lib = (e) => `<div class="mg-row"><b>${esc(e.title)}</b><span>${e.available ? esc(e.requiredBy.join(', ')) : 'под эту версию нет'}</span></div>`;
  return [
    pl.loaderVersion ? `<p class="hint">Загрузчик: <b>${LOADERS[pl.loader]} ${esc(pl.loaderVersion)}</b> (подберётся сам)</p>` : '',
    pl.counts.total ? '' : '<p class="hint">Модов в сборке нет — в копию перейдут настройки, ресурспаки, шейдеры и миры.</p>',
    mgGroup(by('missing'), 'bad', `Нет под <span>${esc(pl.to)}</span>`, 'в копию не попадут: у мода пока нет файла для этой версии', { open: true }),
    mgGroup(by('unknown'), 'warn', 'Неизвестный источник', 'перенесу выключенными — включи в «Моды», если нужно', { open: true }),
    mgGroup(by('update'), 'live', 'Обновятся', 'скачаю версию под новую игру'),
    mgGroup(by('same'), 'live', 'Подойдут как есть', 'файл остаётся тем же'),
    mgGroup(pl.extras, 'live', 'Добавлю библиотеки', 'они нужны новым версиям модов', { row: lib }),
    pl.java ? `<p class="hint ${pl.java.level === 'bad' ? 'err' : 'warn'}">${esc(pl.java.message)}</p>` : '',
    pl.worlds.count ? `<label class="toggle mg-worlds"><input type="checkbox" id="mgWorlds" checked><span class="knob"></span><span>Скопировать миры</span><small>${pl.worlds.count} · ${fmtSize(pl.worlds.size)}</small></label>` : '',
    '<p class="hint">Это копия: старая сборка останется как есть. Миры в копии откроются новой версией игры и обновятся — в старой сборке они не меняются. Настройки, ресурспаки и шейдеры переедут как есть.</p>',
  ].join('');
}

// preselect — какую версию выбрать сразу (значок «пора на новую версию?» ведёт сюда с той, что посчитал)
async function openMigrate(instId, preselect) {
  const inst = instById(instId);
  if (!inst) return;
  const box = openModal(`
    <div class="crash-head"><div class="empty-cat" data-cat></div><div><h2>Перенос на новую версию 🚀</h2><p class="sub">${esc(inst.name)} · ${LOADERS[inst.loader] || LOADERS.vanilla} ${esc(inst.version)}</p></div></div>
    <label class="field"><span>Новая версия Minecraft</span><select id="mgVer"><option>Загружаю версии…</option></select></label>
    <div class="mg-body" id="mgBody"><p class="hint">Выбери версию — я посмотрю, что для неё вышло.</p></div>
    <div class="modal-actions"><button class="btn ghost" id="mgNo">Закрыть</button><button class="btn primary" id="mgYes" disabled>Создать копию</button></div>`);
  const sel = $('#mgVer', box);
  const body = $('#mgBody', box);
  const yes = $('#mgYes', box);
  $('#mgNo', box).onclick = closeModal;
  let list;
  try {
    const { versions } = await loadVersions();
    const cur = versions.find((v) => v.id === inst.version);
    // Предлагаем только релизы новее нынешней версии: у снапшотов почти нет модов, а на старую версию миры не вернуть
    list = versions.filter((v) => v.type === 'release' && v.id !== inst.version && (!cur || new Date(v.releaseTime) > new Date(cur.releaseTime)));
  } catch (err) {
    closeModal();
    return toast(err.message, 'err');
  }
  if (!body.isConnected) return; // окно успели закрыть
  if (!list.length) {
    sel.innerHTML = '';
    sel.disabled = true;
    body.innerHTML = '<p class="hint">Это самая свежая версия Minecraft ♡</p>';
    return;
  }
  sel.innerHTML = list.map((v) => `<option value="${esc(v.id)}">${esc(v.id)}</option>`).join('');
  if (preselect && list.some((v) => v.id === preselect)) sel.value = preselect;
  let seq = 0;
  let plan = null;
  const check = async () => {
    const n = ++seq;
    const to = sel.value;
    plan = null;
    yes.disabled = true;
    yes.textContent = 'Создать копию';
    body.innerHTML = `<p class="hint">Смотрю, что вышло под <span>${esc(to)}</span>…</p>`;
    try {
      const pl = await call('migrate:plan', instId, to);
      if (n !== seq || !body.isConnected) return;
      plan = pl;
      body.innerHTML = renderMigratePlan(pl);
      yes.innerHTML = `Создать копию на <span>${esc(to)}</span>`;
      yes.disabled = false;
    } catch (err) {
      if (n === seq && body.isConnected) body.innerHTML = `<p class="hint err">${esc(err.message)}</p>`;
    }
  };
  sel.onchange = check;
  yes.onclick = async () => {
    if (!plan) return;
    if (state.running.has(instId)) return toast('Сначала закрой игру: в мирах идёт запись ♡', 'err');
    const worlds = !!$('#mgWorlds', box)?.checked;
    closeModal();
    say('переношу сборку на новую версию, старая останется как есть ♡');
    try {
      const r = await call('migrate:run', instId, plan.to, { worlds });
      state.selected = r.instance.id;
      try {
        localStorage.setItem('selected', r.instance.id);
      } catch {}
      await refresh();
      hearts();
      showMigrated(r);
    } catch (err) {
      if (err.cancelled) toast('Перенос отменён: ничего не создано ♡');
      else toast(err.message, 'err');
    }
  };
  check();
}

// Итог переноса: что обновилось и чего не хватает; то же коротко пишем в консоль, она переживёт закрытие окна.
// later — отчёт открыт позже, кнопкой в «Ещё»: тогда это не новость, в консоль ничего не пишем
function showMigrated({ instance, report }, later = false) {
  const c = report.counts;
  const by = (s) => report.mods.filter((m) => m.status === s);
  const stat = (n, label) => `<div class="mg-stat"><b>${n}</b><span>${label}</span></div>`;
  const h = report.health;
  openModal(`
    <div class="crash-head"><div class="empty-cat" data-cat></div><div><h2>${later ? 'Отчёт о переносе' : 'Копия готова'} 🚀</h2><p class="sub">${esc(instance.name)}</p></div></div>
    <div class="mg-body">
      <div class="mg-stats">${stat(c.update, 'обновлено')}${stat(c.same, 'без изменений')}${stat(c.missing + c.unknown + c.failed, 'требуют внимания')}</div>
      ${mgGroup(by('missing'), 'bad', `Нет под <span>${esc(report.to)}</span>`, 'в копию не попали; в старой сборке всё осталось', { open: true })}
      ${mgGroup(by('failed'), 'bad', 'Не скачались', 'попробуй перенос ещё раз', { open: true })}
      ${mgGroup(by('unknown'), 'warn', 'Перенесены выключенными', 'неизвестный источник — включи в «Моды», если нужно', { open: true })}
      ${report.installed.length ? `<p class="hint">Добавлены библиотеки: <b>${esc(report.installed.join(', '))}</b></p>` : ''}
      ${report.warnings.map((w) => `<p class="hint warn">${esc(w)}</p>`).join('')}
      <p class="hint">${h.conflicts + h.missing + h.duplicates ? 'У некоторых модов есть замечания: перед первым запуском лаунчер покажет, что поправить.' : 'Проверка сборки: замечаний нет ✓'}</p>
    </div>
    <div class="modal-actions"><button class="btn primary" id="mgOk">Закрыть</button></div>`);
  $('#mgOk').onclick = closeModal;
  if (later) return;
  const names = (s) => by(s).map((m) => m.title).join(', ');
  log(`Перенос «${report.from.name}» на ${report.to}: обновлено ${c.update}, без изменений ${c.same}${c.missing ? `; нет под новую версию: ${names('missing')}` : ''}${c.unknown ? `; выключены (неизвестный источник): ${names('unknown')}` : ''}${c.failed ? `; не скачались: ${names('failed')}` : ''}`, 'info');
}
