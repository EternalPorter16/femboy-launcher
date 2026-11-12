// Подробности сборки: миры, скриншоты, серверы, «Ещё», оптимизация

/* ---------- подробности сборки: миры, скриншоты, серверы, действия ---------- */
function openDetails(inst, tab = 'worlds') {
  const box = openModal(`
    <div class="det-head">${iconHtml(inst)}<div><h2>${esc(inst.name)}</h2><p class="sub">${esc(inst.version)}${inst.loader !== 'vanilla' ? ' · ' + LOADERS[inst.loader] : ''} · ${fmtPlaytime(inst.playtime)}</p></div></div>
    <div class="seg small" id="detTab"><button data-v="worlds">Миры</button><button data-v="shots">Скриншоты</button><button data-v="servers">Серверы</button><button data-v="more">Ещё</button></div>
    <div class="det-body" id="detBody"></div>
    <div class="modal-actions"><button class="btn ghost" id="detClose">Закрыть</button></div>`);
  box.classList.add('wide');
  $('#detClose', box).onclick = closeModal;
  const body = $('#detBody', box);
  const show = async (t) => {
    setSeg('detTab', t);
    body.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
    try {
      if (t === 'worlds') await renderWorlds(inst, body);
      if (t === 'shots') await renderShots(inst, body);
      if (t === 'servers') renderServers(inst, body);
      if (t === 'more') renderMore(inst, body);
    } catch (err) {
      body.innerHTML = `<div class="empty">Не получилось 🥺 <small>${esc(err.message)}</small></div>`;
    }
  };
  $('#detTab', box).onclick = (e) => e.target.dataset.v && show(e.target.dataset.v);
  show(tab);
}

async function renderWorlds(inst, body) {
  const [list, copies] = await Promise.all([call('worlds:list', inst.id), call('worlds:backups', inst.id).catch(() => [])]);
  const copiesHtml = copies.length
    ? `<h4 class="det-sub">Копии миров</h4>${copies
        .slice(0, 30)
        .map(
          (b) => `
      <div class="world-row" data-copy="${esc(b.file)}">
        <div class="world-ico">${b.auto ? '🕒' : '💾'}</div>
        <div class="info"><b>${esc(b.world)}</b><span>${fmtDate(b.time)} · ${fmtSize(b.size)} · ${b.auto ? 'автокопия' : 'вручную'}</span></div>
        <button class="btn soft sm" data-w="restore">Восстановить</button>
      </div>`
        )
        .join('')}`
    : '';
  body.innerHTML =
    (list.length
      ? list
          .map(
            (w) => `
      <div class="world-row" data-world="${esc(w.name)}">
        ${w.icon ? `<img src="${w.icon}" alt="">` : '<div class="world-ico">🌍</div>'}
        <div class="info"><b>${esc(w.name)}</b><span>${fmtSize(w.size)} · играли ${fmtDate(w.lastPlayed)}</span></div>
        ${w.canPlay ? '<button class="btn primary sm" data-w="play" title="Запустить игру и сразу зайти в этот мир">Играть</button>' : ''}
        <button class="btn soft sm" data-w="backup">Резервная копия</button>
        <button class="btn ghost danger sm" data-w="remove">Удалить</button>
      </div>`
          )
          .join('')
      : '<div class="empty"><div class="empty-cat" data-cat></div>Миров пока нет — создай первый в игре ♡</div>') +
    copiesHtml +
    `<div class="det-actions"><button class="btn ghost" data-w="folder">Открыть папку миров</button>${copies.length ? '<button class="btn ghost" data-w="copies">Открыть папку копий</button>' : ''}</div>`;
  drawCats(body);
  body.onclick = async (e) => {
    const act = e.target.closest('[data-w]')?.dataset.w;
    const name = e.target.closest('[data-world]')?.dataset.world;
    if (!act) return;
    try {
      if (act === 'folder') await call('worlds:openFolder', inst.id);
      if (act === 'copies') await call('worlds:openBackups', inst.id);
      if (act === 'play') {
        // Игра уже идёт или готовится — «Играть» на ней означало бы закрыть игру, так что просто говорим об этом
        if (state.running.has(inst.id) || state.launching.has(inst.id)) return toast('Эта сборка уже запущена: зайди в мир прямо в игре ♡', 'err');
        closeModal();
        selectInstance(inst.id);
        play({ world: name });
      }
      if (act === 'restore') {
        const restored = await call('worlds:restore', inst.id, e.target.closest('[data-copy]').dataset.copy);
        toast(`Мир восстановлен как «${restored}» ♡`);
        hearts();
        renderWorlds(inst, body);
      }
      if (act === 'backup') {
        e.target.disabled = true;
        e.target.textContent = 'Копирую…';
        await call('worlds:backup', inst.id, name);
        toast(`Копия мира «${name}» сохранена ♡`);
        e.target.textContent = 'Готово ✓';
      }
      if (act === 'remove') {
        if (!confirm(`Удалить мир «${name}» навсегда? Лучше сначала сделай резервную копию.`)) return;
        await call('worlds:remove', inst.id, name);
        toast('Мир удалён');
        renderWorlds(inst, body);
      }
    } catch (err) {
      toast(err.message, 'err');
    }
  };
}

async function renderShots(inst, body) {
  const list = await call('worlds:screenshots', inst.id);
  body.innerHTML = list.length
    ? `<div class="shots">${list.map((s) => `<button data-shot="${esc(s.file)}" title="${esc(s.file)}"><img src="${esc(s.url)}" loading="lazy" alt=""></button>`).join('')}</div>`
    : '<div class="empty"><div class="empty-cat" data-cat></div>Скриншотов нет — в игре нажми F2 ♡</div>';
  drawCats(body);
  body.onclick = (e) => {
    const f = e.target.closest('[data-shot]')?.dataset.shot;
    if (f) call('worlds:openScreenshot', inst.id, f).catch((err) => toast(err.message, 'err'));
  };
}

function renderServers(inst, body) {
  const servers = instById(inst.id)?.servers || [];
  const offline = activeAccount()?.type === 'offline';
  body.innerHTML = `
    ${offline ? '<p class="hint">С оффлайн-аккаунтом можно зайти только на серверы без проверки лицензии (online-mode=false).</p>' : ''}
    ${servers
      .map(
        (s, i) => `
      <div class="srv-row" data-i="${i}">
        <div class="world-ico" data-fav>🖥️</div>
        <div class="info"><b>${esc(s.name)}</b><span data-motd>${esc(s.address)}</span></div>
        <span class="srv-status" data-status>…</span>
        <button class="btn primary sm" data-s="join">Зайти</button>
        <button class="btn ghost danger sm" data-s="remove">✕</button>
      </div>`
      )
      .join('') || '<div class="empty">Серверов пока нет — добавь адрес ниже ♡</div>'}
    <form class="srv-add" id="srvAdd"><input id="srvName" placeholder="Название" maxlength="40"><input id="srvAddr" placeholder="адрес, например play.example.ru" spellcheck="false"><button class="btn soft" type="submit">Добавить</button></form>`;
  // Пингуем все серверы параллельно
  servers.forEach(async (s, i) => {
    const row = $(`.srv-row[data-i="${i}"]`, body);
    try {
      const r = await call('servers:ping', s.address);
      if (!row.isConnected) return;
      const st = $('[data-status]', row);
      st.className = 'srv-status ' + (r.online ? 'on' : 'off');
      st.textContent = r.online ? `● ${r.players}/${r.max} · ${r.latency} мс` : `● ${r.error || 'офлайн'}`;
      if (r.motd) $('[data-motd]', row).textContent = r.motd;
      if (r.favicon) {
        const img = document.createElement('img');
        img.src = r.favicon;
        img.alt = '';
        $('[data-fav]', row).replaceWith(img);
      }
    } catch {}
  });
  const save = async (list) => {
    await call('instances:update', inst.id, { servers: list });
    await refresh();
    renderServers(inst, body);
  };
  $('#srvAdd', body).onsubmit = async (e) => {
    e.preventDefault();
    const address = $('#srvAddr', body).value.trim();
    if (!/^[\w.-]+(:\d{1,5})?$/.test(address)) return toast('Адрес вида play.example.ru или 1.2.3.4:25565', 'err');
    await save([...servers, { name: $('#srvName', body).value.trim() || address, address }]).catch((err) => toast(err.message, 'err'));
  };
  body.onclick = async (e) => {
    const act = e.target.closest('[data-s]')?.dataset.s;
    const i = Number(e.target.closest('.srv-row')?.dataset.i);
    if (!act || Number.isNaN(i)) return;
    if (act === 'remove') return save(servers.filter((_, j) => j !== i)).catch((err) => toast(err.message, 'err'));
    if (act === 'join') {
      closeModal();
      selectInstance(inst.id);
      play({ server: servers[i].address });
    }
  };
}

function packBlock(inst) {
  const p = instById(inst.id)?.pack;
  if (!p?.projectId) return '';
  const u = packUpdates[inst.id];
  return `
    <div class="pack-box">
      <div><b>Модпак с ${p.source === 'modrinth' ? 'Modrinth' : 'CurseForge'}</b><span>установлена версия ${esc(p.version)}</span></div>
      ${
        u?.available
          ? `<button class="btn primary with-ico" data-m="packupdate"><svg class="bi"><use href="#i-refresh"/></svg>Обновить до ${esc(u.latest)}</button>`
          : `<button class="btn soft" data-m="packcheck">${u ? 'Последняя версия ✓ Проверить ещё' : 'Проверить обновление'}</button>`
      }
    </div>
    <p class="hint">При обновлении миры, скриншоты, твои моды и настройки игры (options.txt, серверы) остаются; файлы модпака заменяются новыми.</p>`;
}

function renderMore(inst, body) {
  body.innerHTML = `
    <div id="updateRecovery"></div>
    ${packBlock(inst)}
    <div class="det-actions">
      <button class="btn primary with-ico" data-m="export"><svg class="bi"><use href="#i-import"/></svg>Экспорт в .mrpack</button>
      <button class="btn soft" data-m="duplicate">Сделать копию</button>
      <button class="btn soft with-ico" data-m="optimize"><svg class="bi"><use href="#i-bolt"/></svg>Оптимизация</button>
      <button class="btn soft with-ico" data-m="updates"><svg class="bi"><use href="#i-refresh"/></svg>Обновить моды</button>
    </div>
    <div class="det-actions">
      <button class="btn soft" data-m="share">💌 Поделиться</button>
      <button class="btn soft" data-m="friend">💞 Играть с другом</button>
      <button class="btn soft" data-m="join" title="Вставить сообщение друга: адрес мира и код сборки. Лаунчер сверит моды, поставит недостающее и зайдёт">🚪 Войти к другу</button>
      <button class="btn soft" data-m="shaders">✨ Шейдеры под мой ПК</button>
      <button class="btn soft" data-m="points">🕘 Точки восстановления</button>
      <button class="btn soft" data-m="shortcut" title="Клик по ярлыку сразу запускает эту сборку">🖥️ Ярлык на рабочий стол</button>
      <button class="btn soft" data-m="migrate" title="Копия сборки на другой версии Minecraft: лаунчер подберёт версии модов">🚀 На новую версию</button>
      ${inst.migratedFrom ? '<button class="btn soft" data-m="mreport" title="Что при переносе обновилось и чего не нашлось">📋 Отчёт о переносе</button>' : ''}
      ${inst.loader !== 'vanilla' ? `<button class="btn soft" data-m="bisect" title="Поможет найти мод, из-за которого игра вылетает или глючит">${Bisect.active.has(inst.id) ? '🔎 Продолжить поиск виновника' : '🔎 Найти виновника'}</button>` : ''}
      <button class="btn soft" data-m="repair" title="Заново проверит клиент игры, библиотеки и ресурсы по хэшам и скачает то, что повреждено. Миры, моды и настройки не трогает">🔧 Починить файлы игры</button>
      <button class="btn soft" data-m="gamelog" title="Откроет latest.log последнего запуска в программе для текстов">📜 Лог игры</button>
      <button class="btn soft" data-m="logsdir" title="Папка logs этой сборки: latest.log и логи прошлых запусков">📂 Папка логов</button>
    </div>
    <div class="gfx" id="gfxBlock"></div>
    <p class="hint">Экспорт: моды с Modrinth попадут в файл ссылками (он будет лёгким), остальные — внутрь. Миры в экспорт не входят. «Поделиться» сразу копирует файл — вставь его в чат Discord или Telegram, а друг просто перетащит его в лаунчер.</p>`;
  paintGfx(inst, $('#gfxBlock', body));
  const recoveryPanel = $('#updateRecovery', body);
  call('packs:recoveryStatus', inst.id).then((r) => {
    if (!recoveryPanel.isConnected || !body.contains(recoveryPanel) || !r?.pending) return;
    recoveryPanel.innerHTML = `<div class="hint"><b>Прерванное обновление</b><p>${esc(r.busy ? 'Обновление ещё выполняется' : r.canRecover ? 'Можно проверить резервные файлы и завершить восстановление' : r.reason)}</p>
      ${r.canRecover ? '<button class="btn soft" data-m="recoverupdate">Проверить и восстановить</button>' : ''}
      ${!r.busy ? '<button class="btn ghost" data-m="recoveryfiles">Показать резервные файлы</button>' : ''}</div>`;
  }).catch(() => { if (recoveryPanel.isConnected) recoveryPanel.textContent = 'Не удалось проверить восстановление обновления'; });
  body.onclick = async (e) => {
    const act = e.target.closest('[data-m]')?.dataset.m;
    if (!act) return;
    try {
      if (act === 'recoverupdate') {
        e.target.disabled = true;
        await call('packs:recover', inst.id);
        await refresh();
        toast('Восстановление обновления завершено');
        renderMore(instById(inst.id) || inst, body);
      }
      if (act === 'recoveryfiles') await call('packs:recoveryFolder', inst.id);
      if (act === 'packcheck') {
        e.target.disabled = true;
        e.target.textContent = 'Проверяю…';
        packUpdates[inst.id] = await call('packs:check', inst.id);
        renderMore(inst, body);
        if (!packUpdates[inst.id]?.available) toast('Это последняя версия модпака ♡');
      }
      if (act === 'packupdate') {
        e.target.disabled = true;
        e.target.textContent = 'Обновляю…';
        say('обновляю модпак, миры не трогаю ♡');
        const r = await call('packs:update', inst.id);
        delete packUpdates[inst.id];
        await refresh();
        toast(r.updated ? `Модпак обновлён: ${r.from} → ${r.to}${r.removed ? ` (убрано старых файлов: ${r.removed})` : ''}` : 'Обновлять нечего ♡');
        (r.warnings || []).forEach((w) => (toast(w, 'err'), log(w, 'error')));
        hearts();
        renderMore(instById(inst.id), body);
      }
      if (act === 'export') {
        const r = await call('instances:export', inst.id);
        if (r) toast(`Экспорт готов ♡ (${r.linked} модов ссылками, ${r.embedded} внутри)`);
      }
      if (act === 'duplicate') {
        const copy = await call('instances:duplicate', inst.id);
        closeModal();
        state.selected = copy.id;
        await refresh();
        toast(`Готова копия «${copy.name}»`);
      }
      if (act === 'optimize') openOptimize(inst.id);
      if (act === 'points') openRestorePoints(inst.id);
      if (act === 'migrate') openMigrate(inst.id);
      if (act === 'bisect') Bisect.open(inst.id);
      if (act === 'mreport') {
        const rep = await call('migrate:report', inst.id);
        if (!rep) return toast('Отчёта о переносе нет');
        showMigrated({ instance: inst, report: rep }, true);
      }
      if (act === 'repair') {
        const btn = e.target.closest('[data-m]');
        btn.disabled = true;
        btn.textContent = 'Проверяю…';
        say('проверяю файлы игры по хэшам, это может занять минуту 🔧', 7000);
        try {
          openRepairReport(inst, await call('instances:repair', inst.id));
        } finally {
          if (btn.isConnected) {
            btn.disabled = false;
            btn.textContent = '🔧 Починить файлы игры';
          }
        }
      }
      if (act === 'gamelog') await call('instances:openLog', inst.id, 'latest');
      if (act === 'logsdir') await call('instances:openLog', inst.id, 'folder');
      if (act === 'shortcut') {
        await call('instances:shortcut', inst.id);
        toast('Ярлык создан на рабочем столе ♡');
      }
      if (act === 'share') {
        say('упаковываю сборку для друга 💌');
        const r = await call('instances:share', inst.id);
        toast(r.copied ? 'Файл сборки скопирован — вставь его в чат Discord или Telegram (Ctrl+V) ♡' : 'Файл сборки готов — перетащи его в чат ♡');
        hearts();
        refresh();
      }
      if (act === 'friend') openFriendModal(inst);
      if (act === 'join') openJoinModal(inst);
      if (act === 'shaders') {
        say('подбираю шейдеры под твой компьютер ✨');
        const r = await call('instances:shaders', inst.id);
        toast(r.installed.length ? `Поставлено: ${r.installed.join(', ')}` : `Шейдеры ${r.shader} уже стоят ♡`);
        (r.notes || []).forEach((n) => toast(n));
        (r.warnings || []).forEach((w) => toast(w, 'err'));
        await refresh();
        hearts();
      }
      if (act === 'updates') {
        closeModal();
        state.mods.inst = inst.id;
        openBrowser('installed', 'mod');
        checkModUpdates();
      }
    } catch (err) {
      if (act === 'recoverupdate') e.target.disabled = false;
      toast(err.message, 'err');
    }
  };
}

// Итог «Починить файлы игры»: что проверено и что пришлось скачать заново (жёлтым). Отчёт приходит от core/repair.js
const REPAIR_LOADER = {
  ok: ['ok', 'профиль в порядке'],
  fixed: ['warn', 'профиль был оборван или отсутствовал — скачан заново'],
  'unknown-version': ['ok', 'версия загрузчика выберется при первом запуске — проверять пока нечего'],
  'at-launch': ['ok', 'файлы ставит установщик при запуске — здесь не проверяются'],
};
function openRepairReport(inst, r) {
  const row = (tone, title, text) => `<div class="nc-row fc ${tone}"><span class="nc-dot"></span><div class="nc-name"><b>${title}</b><small>${text}</small></div></div>`;
  const counts = (c) => `проверено ${c.checked}, скачано заново: ${c.fixed}`;
  const loader = REPAIR_LOADER[r.loader?.state];
  const rows = [
    row(r.client.fixed ? 'warn' : 'ok', `Клиент игры <code>${esc(r.version)}</code>`, r.client.fixed ? 'скачан заново: файла не было или он был повреждён' : 'в порядке'),
    row(r.profile.fixed ? 'warn' : 'ok', 'Профиль версии', r.profile.fixed ? 'был оборван при записи — скачан заново' : 'в порядке'),
    ...(r.loader?.name && loader ? [row(loader[0], esc(r.loader.name), loader[1])] : []),
    row(r.libraries.fixed ? 'warn' : 'ok', 'Библиотеки', counts(r.libraries)),
    row(r.assets.fixed ? 'warn' : 'ok', 'Ресурсы игры', counts(r.assets)),
  ];
  const fixed = r.client.fixed || r.profile.fixed || r.loader?.state === 'fixed' || r.libraries.fixed > 0 || r.assets.fixed > 0;
  const box = openModal(`
    <div class="crash-head"><div class="empty-cat" data-cat></div><div><h2>Файлы игры проверены 🔧</h2><p class="sub">${esc(inst.name)}</p></div></div>
    <p class="fc-verdict ${fixed ? 'warn' : 'ok'}">${fixed ? 'Часть файлов пришлось скачать заново — они отмечены жёлтым ♡' : 'Всё в порядке: чинить ничего не пришлось ♡'}</p>
    <div class="nc-list fc-list">${rows.join('')}</div>
    <p class="hint">Миры, моды и настройки сборки не тронуты. Если игра всё равно вылетает — попробуй «Найти виновника» во вкладке «Ещё» или «Отчёт для поддержки» в Настройках.</p>
    <div class="modal-actions"><button class="btn primary" id="rpOk">Готово</button></div>`);
  $('#rpOk', box).onclick = closeModal;
}

// Ставит «Основу» (или выбранное в окне). Без окна её зовёт мастер создания сборки
async function runOptimize(instId, keys) {
  const inst = instById(instId);
  if (!inst || inst.loader === 'vanilla') return toast('Оптимизация ставит моды — включи в сборке Fabric или другой загрузчик', 'err');
  say('ускоряю игру ⚡');
  try {
    const r = await call('instances:optimize', instId, keys);
    toast(r.installed.length ? `Поставлено: ${r.installed.join(', ')}` : 'Всё уже стоит ♡');
    r.notes.forEach((n) => toast(n));
    r.warnings.forEach((w) => (toast(w, 'err'), log(w, 'error')));
    if (r.skipped.length) log(`Оптимизация: не поставила — ${r.skipped.join('; ')}`, 'info');
    hearts();
    loadHeroInfo(instId, true);
    if ($('#page-mods').classList.contains('active')) loadMods();
  } catch (err) {
    toast(err.message, 'err');
  }
}

// Окно «Оптимизация»: что подходит этой сборке. «Основа» уже отмечена, дополнительное — по желанию
async function openOptimize(instId) {
  const inst = instById(instId);
  if (!inst || inst.loader === 'vanilla') return toast('Оптимизация ставит моды — включи в сборке Fabric или другой загрузчик', 'err');
  const box = openModal(`
    <div class="crash-head"><div class="empty-cat" data-cat></div><div><h2>Оптимизация ⚡</h2><p class="sub">${esc(inst.name)} · ${LOADERS[inst.loader]} ${esc(inst.version)}</p></div></div>
    <div class="opt-body" id="optBody"><p class="hint">Смотрю, что вышло под эту версию…</p></div>
    <div class="modal-actions"><button class="btn ghost" id="opNo">Закрыть</button><button class="btn primary" id="opYes" disabled>Поставить</button></div>`);
  $('#opNo', box).onclick = closeModal;
  let pl;
  try {
    pl = await call('instances:optimizePlan', instId);
  } catch (err) {
    closeModal();
    return toast(err.message, 'err');
  }
  if (!$('#optBody', box)?.isConnected) return; // окно успели закрыть
  const row = (i) => {
    const can = i.state === 'available';
    const chip = i.state === 'installed' ? '<span class="chip live">уже стоит</span>' : i.state === 'missing' || i.state === 'unknown' ? `<span class="chip">${esc(i.reason)}</span>` : '';
    return `<label class="opt-row ${i.state}"><input type="checkbox" class="check" value="${i.key}" ${i.state === 'installed' || (can && i.core) ? 'checked' : ''} ${can ? '' : 'disabled'}>
      <div class="opt-txt"><b>${esc(i.name)}</b><span>${esc(i.desc)}</span></div>${chip}</label>`;
  };
  const group = (title, note, list) => (list.length ? `<h4 class="opt-h">${title}<small>${note}</small></h4><div class="opt-list">${list.map(row).join('')}</div>` : '');
  $('#optBody', box).innerHTML =
    (pl.items.some((i) => i.state === 'unknown') ? '<p class="hint err">Не получилось связаться с Modrinth, поэтому часть модов проверить не вышло. Проверь интернет и открой окно ещё раз.</p>' : '') +
    group('Основа', 'рекомендую', pl.items.filter((i) => i.core)) +
    group('Дополнительно', 'по желанию', pl.items.filter((i) => !i.core)) +
    '<p class="hint">Всё скачивается с Modrinth вместе с нужными библиотеками. Убрать можно во вкладке «Моды».</p>';
  const count = () => $$('.opt-list input:checked:not(:disabled)', box).length;
  const paint = () => {
    const n = count();
    const yes = $('#opYes', box);
    yes.disabled = !n;
    yes.textContent = n ? `Поставить (${n})` : 'Нечего ставить';
  };
  $('#optBody', box).addEventListener('change', paint);
  paint();
  $('#opYes', box).onclick = () => {
    const keys = $$('.opt-list input:checked:not(:disabled)', box).map((i) => i.value);
    closeModal();
    runOptimize(instId, keys);
  };
}
