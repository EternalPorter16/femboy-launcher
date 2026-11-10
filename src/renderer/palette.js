// Быстрый поиск по Ctrl+K: страницы, настройки, сборки, действия и моды выбранной сборки. Подключается после app/ и
// пользуется её функциями (showPage, play, openOptimize…): все они лежат в общей области видимости
(() => {
  const box = document.createElement('div');
  box.id = 'palette';
  box.hidden = true;
  box.innerHTML = `
    <div class="pal-box card" role="dialog" aria-label="Быстрый поиск">
      <input class="pal-input" id="palInput" placeholder="Что открыть или сделать? Сборка, страница, действие, мод…" spellcheck="false" autocomplete="off">
      <div class="pal-list" id="palList"></div>
      <div class="pal-foot"><span><kbd>↑</kbd><kbd>↓</kbd> выбрать</span><span><kbd>Enter</kbd> выполнить</span><span><kbd>Esc</kbd> закрыть</span></div>
    </div>`;
  document.body.append(box);
  const input = box.querySelector('#palInput');
  const listEl = box.querySelector('#palList');

  const KIND_RANK = { действие: 0, страница: 1, настройки: 2, сборка: 3, мод: 4, поиск: 5 };
  const norm = (s) => String(s).toLowerCase().replace(/ё/g, 'е');
  let items = [];
  let shown = [];
  let idx = 0;
  let epoch = 0;

  const goSettings = (sec) => (showPage('settings'), showSection(sec));
  const click = (sel) => setTimeout(() => document.querySelector(sel)?.click(), 60);

  function build() {
    const out = [];
    const sel = selectedInstance();
    const add = (ico, label, kind, run, extra = {}) => out.push({ ico, label, kind, run, ...extra });

    // Действия над выбранной сборкой — первыми: чаще всего нужны именно они
    if (sel) {
      add('▶️', 'Играть', 'действие', () => (showPage('instances'), play()), { keywords: `запустить старт ${sel.name}`, hint: sel.name });
      add('⚡', 'Оптимизация сборки', 'действие', () => openOptimize(sel.id), { keywords: 'ускорить sodium fps', hint: sel.name });
      add('🕘', 'Точки восстановления', 'действие', () => openRestorePoints(sel.id), { keywords: 'откат вернуть резервная копия', hint: sel.name });
      add('✏️', 'Настройки сборки', 'действие', () => openInstanceModal(sel), { keywords: 'изменить память java', hint: sel.name });
      if (sel.loader !== 'vanilla') add('🔎', 'Найти мод, из-за которого вылет', 'действие', () => Bisect.open(sel.id), { keywords: 'виновник вылет краш баг глючит моды по очереди bisect', hint: sel.name });
      add('🚀', 'Перенести сборку на новую версию Minecraft', 'действие', () => openMigrate(sel.id), { keywords: 'обновить версию майнкрафта копия перенос апгрейд', hint: sel.name });
      add('🖥️', 'Ярлык сборки на рабочий стол', 'действие', () => call('instances:shortcut', sel.id).then(() => toast('Ярлык создан на рабочем столе ♡'), (e) => toast(e.message, 'err')), { keywords: 'создать ярлык запуск', hint: sel.name });
      add('📂', 'Открыть папку сборки', 'действие', () => call('instances:openFolder', sel.id).catch((e) => toast(e.message, 'err')), { keywords: 'проводник миры', hint: sel.name });
      add('🔄', 'Обновить моды', 'действие', () => (state.mods.inst = sel.id, openBrowser('installed', 'mod'), checkModUpdates()), { keywords: 'обновления', hint: sel.name });
    }
    add('🚪', 'Войти к другу (адрес и код сборки)', 'действие', () => openJoinModal(sel), { keywords: 'присоединиться зайти адрес код сборки e4mc моды друг сверить мир' });
    if (sel) add('📋', 'Скопировать код сборки для друга', 'действие', () => copyModCode(sel).catch((e) => toast(e.message, 'err')), { keywords: 'поделиться моды друг отправить код сборки', hint: sel.name });
    add('🖼️', 'Итоги недели и месяца (картинка)', 'действие', () => openRecap(), { keywords: 'статистика время в игре часы поделиться картинка итоги неделя месяц recap' });
    add('📚', 'Импорт коллекции Modrinth (по ссылке)', 'действие', () => openCollection(), { keywords: 'коллекция подборка моды modrinth ссылка collection импорт поставить' });
    add('➕', 'Новая сборка', 'действие', () => openInstanceModal(), { keywords: 'создать' });
    add('📦', 'Импорт сборки', 'действие', () => openImportModal(), { keywords: 'mrpack zip перенести tlauncher prism' });
    add('📡', 'Проверить связь', 'действие', () => openNetCheck(), { keywords: 'интернет прокси сеть vpn' });
    add('📋', 'Собрать отчёт для поддержки', 'действие', () => (goSettings('about'), click('#reportBuild')), { keywords: 'помощь ошибка проблема zip' });
    add('📤', 'Поделиться логом на mclo.gs', 'действие', () => shareLog('console'), { keywords: 'консоль лог отправить' });
    add('🦊', 'Войти через Ely.by', 'действие', () => (showPage('accounts'), openElyLogin()), { keywords: 'аккаунт ely' });
    add('🪟', 'Войти через Microsoft', 'действие', () => (showPage('accounts'), click('#msLogin')), { keywords: 'аккаунт лицензия' });
    add('🐾', 'Добавить оффлайн-аккаунт', 'действие', () => (showPage('accounts'), setTimeout(() => document.querySelector('#offlineName')?.focus(), 80)), { keywords: 'ник аккаунт' });
    add('📋', 'Скопировать мой ник', 'действие', () => copyNick(activeAccount()?.name), { keywords: 'имя nickname аккаунт друг отправить белый список', hint: activeAccount()?.name });
    add('☕', 'Найти Java', 'действие', () => (goSettings('game'), click('[data-j="find"]')), { keywords: 'путь установить джава' });
    add('⬆️', 'Проверить обновления лаунчера', 'действие', () => (goSettings('about'), click('#updateCheck')), { keywords: 'версия' });
    add('🗂️', 'Открыть папку лаунчера', 'действие', () => call('app:openDataDir'), { keywords: 'данные проводник' });
    for (const [v, name] of [['light', 'Светлая'], ['sakura', 'Сакура'], ['dark', 'Тёмная'], ['midnight', 'Полночь'], ['system', 'Как в системе']]) add('🎨', `Тема: ${name}`, 'действие', () => saveSettings({ theme: v }), { keywords: 'оформление цвет' });
    add('🌐', 'Язык: English', 'действие', () => saveSettings({ lang: 'en' }), { keywords: 'language english' });
    add('🌐', 'Язык: Русский', 'действие', () => saveSettings({ lang: 'ru' }), { keywords: 'language russian' });
    for (const p of [90, 100, 110, 125, 150]) add('🔍', `Масштаб интерфейса: ${p}%`, 'действие', () => setUiScale(p), { keywords: 'размер крупнее мельче zoom' });

    for (const [p, name, ico] of [['instances', 'Сборки', '🧱'], ['mods', 'Моды', '🧩'], ['accounts', 'Аккаунты', '🐾'], ['console', 'Консоль', '💬'], ['settings', 'Настройки', '⚙️']]) add(ico, name, 'страница', () => showPage(p));
    for (const [sec, name] of [['look', 'Оформление'], ['kitty', 'Котик и награды'], ['game', 'Игра и Java'], ['cloud', 'Миры и облако'], ['data', 'Место и переезд'], ['about', 'О лаунчере']]) add('⚙️', `Настройки: ${name}`, 'настройки', () => goSettings(sec));

    for (const i of state.instances) {
      const hint = `${i.version} · ${LOADERS[i.loader] || i.loader}`;
      add(i.icon || '🧱', i.name, 'сборка', () => (showPage('instances'), selectInstance(i.id)), { hint, keywords: `${i.version} ${i.loader}` });
      add('▶️', `Играть: ${i.name}`, 'сборка', () => (showPage('instances'), selectInstance(i.id), play()), { hint, keywords: `запустить ${i.version}` });
    }
    return out;
  }

  // Моды выбранной сборки подгружаем отдельно: список читается с диска
  async function loadMods(token) {
    const sel = selectedInstance();
    if (!sel) return;
    try {
      const list = await call('mods:list', sel.id, 'mod');
      if (token !== epoch) return; // окно уже закрыли или открыли заново
      for (const m of list) {
        const name = m.title || m.file;
        items.push({
          ico: m.icon ? `<img src="${esc(m.icon)}" alt="">` : '🧩',
          rawIco: !!m.icon,
          label: name,
          kind: 'мод',
          hint: m.file,
          run: () => {
            state.mods.inst = sel.id;
            state.mods.tab = 'installed';
            state.mods.type = 'mod';
            showPage('mods');
            const q = $('#modsQuery');
            q.value = name;
            q.dispatchEvent(new Event('input'));
          },
        });
      }
      render();
    } catch {}
  }

  function score(item, tokens) {
    // По-английски ищем и по переведённой подписи: «theme», «play», «optimize»
    const hay = norm(`${item.label} ${I18N.lang === 'en' ? I18N.tr(item.label) : ''} ${item.keywords || ''} ${item.hint || ''}`);
    let s = 0;
    for (const t of tokens) {
      const i = hay.indexOf(t);
      if (i < 0) return -1;
      s += i === 0 ? 6 : hay[i - 1] === ' ' ? 4 : 1;
    }
    return s;
  }

  function render() {
    const q = norm(input.value).trim();
    const tokens = q.split(/\s+/).filter(Boolean);
    if (!tokens.length) shown = items.filter((i) => i.kind !== 'мод').slice(0, 40);
    else {
      shown = items
        .map((it) => ({ it, s: score(it, tokens) }))
        .filter((x) => x.s >= 0)
        .sort((a, b) => b.s - a.s || KIND_RANK[a.it.kind] - KIND_RANK[b.it.kind])
        .map((x) => x.it)
        .slice(0, 40);
      if (q.length >= 2) {
        const text = input.value.trim();
        shown.push({
          ico: '🔎',
          label: `Искать «${text}» на Modrinth`,
          kind: 'поиск',
          run: () => {
            state.mods.tab = 'modrinth';
            state.mods.type = 'mod';
            showPage('mods');
            const f = $('#modsQuery');
            f.value = text;
            f.dispatchEvent(new Event('input'));
          },
        });
      }
    }
    idx = Math.min(idx, Math.max(0, shown.length - 1));
    listEl.innerHTML = shown.length
      ? shown
          .map((it, i) => `<div class="pal-item ${i === idx ? 'on' : ''}" data-i="${i}"><span class="pal-ico">${it.rawIco ? it.ico : esc(it.ico)}</span><span class="pal-label">${esc(it.label)}${it.hint ? `<small>${esc(it.hint)}</small>` : ''}</span><span class="pal-kind">${esc(it.kind)}</span></div>`)
          .join('')
      : '<div class="pal-empty">Ничего не нашлось</div>';
    listEl.querySelector('.pal-item.on')?.scrollIntoView({ block: 'nearest' });
  }

  function open() {
    if (document.querySelector('#modal.open')) return; // поверх окон не открываем
    epoch++;
    items = build();
    input.value = '';
    idx = 0;
    render();
    box.hidden = false;
    input.focus();
    loadMods(epoch);
  }
  function close() {
    box.hidden = true;
    epoch++;
  }
  function run(i) {
    const it = shown[i];
    if (!it) return;
    close();
    setTimeout(() => it.run(), 0);
  }

  input.addEventListener('input', () => ((idx = 0), render()));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      idx = (idx + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % Math.max(1, shown.length);
      render();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(idx);
    }
  });
  listEl.addEventListener('mousemove', (e) => {
    const el = e.target.closest('.pal-item');
    if (!el || +el.dataset.i === idx) return;
    idx = +el.dataset.i;
    listEl.querySelectorAll('.pal-item').forEach((n, i) => n.classList.toggle('on', i === idx));
  });
  listEl.addEventListener('click', (e) => {
    const el = e.target.closest('.pal-item');
    if (el) run(+el.dataset.i);
  });
  box.addEventListener('mousedown', (e) => e.target === box && close());
  document.addEventListener('keydown', (e) => {
    // e.code, а не e.key: так работает и на русской раскладке (Ctrl+Л)
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.code === 'KeyK') {
      e.preventDefault();
      box.hidden ? open() : close();
    } else if (e.key === 'Escape' && !box.hidden) {
      e.stopPropagation();
      close();
    }
  }, true);
  document.querySelector('#wSearch')?.addEventListener('click', open);
})();
