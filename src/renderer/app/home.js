// Главная: полка сборок, карточка выбранной сборки, три карточки под ней

/* ---------- сборки ---------- */
function loaderChip(i) {
  return i.loader !== 'vanilla' && LOADERS[i.loader] ? `<span class="chip ${i.loader}"${i.loaderVersion ? ` title="${LOADERS[i.loader]} ${esc(i.loaderVersion)}"` : ''}>${LOADERS[i.loader]}</span>` : '';
}

// Фильтр списка сборок: поиск, группа, сортировка (сортировку и группу запоминаем)
const F = { q: '', group: localStorage.getItem('instGroup') || 'all', sort: localStorage.getItem('instSort') || 'recent' };
const SORTS = {
  recent: (a, b) => (b.lastPlayed || b.createdAt) - (a.lastPlayed || a.createdAt),
  name: (a, b) => a.name.localeCompare(b.name, 'ru'),
  playtime: (a, b) => (b.playtime || 0) - (a.playtime || 0),
  version: (a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }),
};

function renderGroups() {
  const groups = [...new Set(state.instances.map((i) => i.group).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));
  if (F.group !== 'all' && F.group !== '' && !groups.includes(F.group)) F.group = 'all';
  const ungrouped = state.instances.some((i) => !i.group);
  const chip = (v, label, n) => `<button class="chip-btn ${F.group === v ? 'on' : ''}" data-g="${esc(v)}">${esc(label)} <i>${n}</i></button>`;
  $('#instGroups').innerHTML = groups.length
    ? chip('all', 'Все', state.instances.length) +
      groups.map((g) => chip(g, g, state.instances.filter((i) => i.group === g).length)).join('') +
      (ungrouped ? chip('', 'Без группы', state.instances.filter((i) => !i.group).length) : '')
    : '';
  $('#shelfTools').style.display = state.instances.length > 1 ? '' : 'none';
}

// Плитка сборки на полке
const shortTime = (ms) => {
  const m = Math.round((ms || 0) / 60000);
  return !m ? '' : m < 60 ? `${m} мин` : `${Math.floor(m / 60)} ч`;
};
function tileHtml(i) {
  const upd = packUpdates[i.id];
  return `
    <div class="tile ${i.id === state.selected ? 'selected' : ''}" data-id="${esc(i.id)}">
      ${iconHtml(i)}
      ${upd?.available ? `<i class="t-badge upd" data-act="packupd" title="Вышла версия ${esc(upd.latest)}"><svg><use href="#i-refresh"/></svg></i>` : ''}
      ${state.running.has(i.id) ? '<span class="t-live">играет</span>' : `<span class="t-time">${shortTime(i.playtime)}</span>`}
      <div class="t-name" title="${esc(i.name)}">${esc(i.name)}</div>
      <div class="t-meta">${esc(verLabel(i))}</div>
    </div>`;
}

// Полка сборок: группы, поиск, сортировка. Карточку выбранной сборки это не трогает
function renderTiles() {
  renderGroups();
  $('#instSort').value = F.sort;
  $('#instCount').textContent = state.instances.length;
  $('#trashBtn').hidden = !state.trash?.length; // кнопка «Корзина» есть, только пока в корзине что-то лежит
  $('#trashCount').textContent = state.trash?.length || '';
  $('.search-box').classList.toggle('open', !!F.q);
  const q = F.q.toLowerCase();
  const list = state.instances
    .filter((i) => F.group === 'all' || (i.group || '') === F.group)
    .filter((i) => !q || [i.name, i.version, LOADERS[i.loader], i.group].some((s) => (s || '').toLowerCase().includes(q)))
    .sort(SORTS[F.sort] || SORTS.recent);
  const grid = $('#instGrid');
  grid.classList.add('stagger');
  const empty = state.instances.length && !list.length ? '<div class="empty inst-empty">Ничего не нашлось 🥺</div>' : '';
  grid.innerHTML = empty + list.map(tileHtml).join('') + `<button class="tile add" id="addInst"><span class="plus"><svg><use href="#i-plus"/></svg></span>Новая сборка</button>`;
  stagger(grid);
}

function renderInstances() {
  renderTiles();
  renderHero();
  renderStrip();
}

/* ---------- главная: карточка выбранной сборки и три карточки под ней ---------- */
const heroInfo = {}; // id → { mods, worlds, backup, health, at } — считаем в фоне и держим, чтобы не мигало
let heroId = null;
let sceneKey = '';
let heroDark = null;
let progress = null; // { label, percent } пока идёт запуск или фоновая задача
const plural = (n, one, few, many) => ((n % 100 > 10 && n % 100 < 20) || n % 10 === 0 || n % 10 > 4 ? many : n % 10 === 1 ? one : few);

function healthStat(info) {
  const h = info?.health;
  if (!h) return '<span class="stat dim"><svg><use href="#i-check"/></svg>Проверяю…</span>';
  const n = h.conflicts.length + h.missing.length + h.duplicates.length;
  return n
    ? `<button class="stat warn" data-act="health" title="Открыть проверку сборки"><svg><use href="#i-warn"/></svg>${n} ${plural(n, 'проблема', 'проблемы', 'проблем')}</button>`
    : '<span class="stat ok"><svg><use href="#i-check"/></svg>Всё готово</span>';
}

function statsHtml(inst) {
  const info = heroInfo[inst.id];
  const mods = !info ? '…' : !info.mods && inst.loader === 'vanilla' ? 'без модов' : `${info.mods} ${plural(info.mods, 'мод', 'мода', 'модов')}`;
  const worlds = !info ? '…' : `${info.worlds} ${plural(info.worlds, 'мир', 'мира', 'миров')}`;
  return `${healthStat(info)}
    <span class="stat"><svg><use href="#i-mods"/></svg>${mods}</span>
    <span class="stat"><svg><use href="#i-globe"/></svg>${worlds}</span>
    <span class="stat" title="Память для игры"><svg><use href="#i-chip"/></svg>${fmtRam(inst.maxRam || state.settings.maxRam || 4096)}</span>
    ${updatesStat(info)}${tipsStat(info)}${readyStat(info)}${followStat(inst)}`;
}

// Вышли обновления модов: сколько (считает в фоне core/modwatch.js; после окна «Обновить моды» число то же, что в окне). По щелчку — это окно
function updatesStat(info) {
  const u = info?.updates;
  if (!u || u.count < 1) return '';
  const names = u.titles.join(', ') + (u.count > u.titles.length ? ` и ещё ${u.count - u.titles.length}` : '');
  return `<button class="stat upd" data-act="updates" title="${esc(`Вышли обновления модов: ${names}. Нажми, чтобы посмотреть, что нового, и обновить`)}"><svg><use href="#i-refresh"/></svg>${u.count} ${plural(u.count, 'обновление', 'обновления', 'обновлений')} модов</button>`;
}

// «Пора на новую версию?»: сколько модов сборки уже вышло под самую свежую версию Minecraft (считает в фоне core/readiness.js).
// Показываем, когда готова хотя бы половина: «готовы 2 из 40» только расстраивает
function readyStat(info) {
  const r = info?.ready;
  if (!r || !r.total || r.ready < 1 || r.ready * 2 < r.total) return '';
  return `<button class="stat ready" data-act="ready" title="Столько модов этой сборки уже вышло под новую версию Minecraft. Нажми, чтобы посмотреть, что получится при переносе"><span>🚀</span><b>${esc(r.target)}:</b><span>готовы ${r.ready} из ${r.total} ${plural(r.total, 'мода', 'модов', 'модов')}</span></button>`;
}

// Сборка следует за сборкой друга (окно «Войти к другу» с галочкой «Следовать»): по щелчку — окно, куда вставляют новый код от хозяина
function followStat(inst) {
  if (!inst.follow) return '';
  return `<button class="stat follow" data-act="follow" title="${esc(`Сборка следует за сборкой друга (обновлена ${fmtDate(inst.follow.at)}). Нажми и вставь новый код от друга, чтобы обновиться`)}">👥 как у друга</button>`;
}

// Советы по скорости: появляются, только если есть что поправить
function tipsStat(info) {
  const n = info?.tips?.length || 0;
  return n ? `<button class="stat tip" data-act="tips" title="Что поправить, чтобы игра шла быстрее"><svg><use href="#i-bolt"/></svg>${n} ${plural(n, 'совет', 'совета', 'советов')}</button>` : '';
}

function heroHtml(i) {
  const upd = packUpdates[i.id];
  const when = i.lastPlayed ? ` · последний запуск ${fmtDate(i.lastPlayed)}` : '';
  return `
    <div class="hero-top">
      ${iconHtml(i)}
      <div class="hero-name">
        <h2 class="hero-title" title="${esc(i.name)}">${esc(i.name)}</h2>
        <div class="hero-chips"><span class="chip">${esc(i.version)}</span>${loaderChip(i)}${i.group ? `<span class="chip grp"><svg><use href="#i-heart"/></svg>${esc(i.group)}</span>` : ''}<span class="chip live" id="heroLive" hidden>▶ играет</span>${
          upd?.available ? `<span class="chip upd" data-act="packupd" title="Вышла версия ${esc(upd.latest)}">⬆ обновление</span>` : ''
        }</div>
      </div>
    </div>
    <p class="hero-sub">${i.playtime ? `<b>${fmtPlaytime(i.playtime)}</b> вместе${when}` : '<b>ещё не запускалась</b>'}</p>
    <div class="hero-stats" id="heroStats">${statsHtml(i)}</div>
    <div class="hero-progress" id="heroProgress"><div class="pb-head"><div class="pb-label"></div><button class="pb-cancel" type="button" data-act="cancel">Отменить</button></div><div class="bar"><div class="fill"></div></div></div>
    <div class="hero-actions">
      <button class="play-btn" data-act="play" data-sound="open"><span class="ears" aria-hidden="true"><i></i><i></i></span><span class="shine" aria-hidden="true"></span><svg class="heart"><use href="#i-paw"/></svg><span class="play-text">Играть</span></button>
      <button class="round-btn" data-act="folder" title="Открыть папку (моды, миры)"><svg><use href="#i-folder"/></svg></button>
      <button class="round-btn" data-act="mods" title="Моды"><svg><use href="#i-mods"/></svg></button>
      <button class="round-btn" data-act="edit" title="Изменить"><svg><use href="#i-edit"/></svg></button>
      <button class="round-btn" data-act="more" title="Миры, скриншоты, серверы, экспорт"><svg><use href="#i-more"/></svg></button>
      <button class="round-btn danger" data-act="delete" title="Удалить"><svg><use href="#i-trash"/></svg></button>
    </div>`;
}

const heroEmptyHtml = () => `
  <div class="hero-empty">
    <h2>Создай первую сборку ♡</h2>
    <p>Выбери версию Minecraft и загрузчик модов — остальное лаунчер поставит сам.</p>
    <button class="btn primary" data-act="newinst">Новая сборка</button>
  </div>`;

function renderHero({ animate = false } = {}) {
  const hero = $('#hero');
  const inst = selectedInstance();
  const dark = root.dataset.theme === 'dark';
  heroDark = dark;
  const paint = () => {
    const key = `${inst?.id || ''}|${inst?.color || ''}|${dark}`;
    if (key !== sceneKey) {
      sceneKey = key;
      $('#heroScene').innerHTML = Scenes.svg(inst?.color, dark);
    }
    $('#heroBody').innerHTML = inst ? heroHtml(inst) : heroEmptyHtml();
    hero.classList.remove('sw');
    paintPlay();
  };
  const switching = animate && inst && heroId && heroId !== inst.id;
  heroId = inst?.id || null;
  if (switching) {
    hero.classList.add('sw');
    setTimeout(paint, 180);
  } else paint();
  if (inst) loadHeroInfo(inst.id);
}

// Моды, миры, копии и «здоровье» считаем в фоне: карточка появляется сразу, значки дорисовываются
let heroInfoSeq = 0;
async function loadHeroInfo(id, force = false) {
  const inst = instById(id);
  if (!inst || (!force && Date.now() - (heroInfo[id]?.at || 0) < 3000)) return;
  const seq = ++heroInfoSeq;
  try {
    const [s, ready, updates] = await Promise.all([call('instances:summary', id), call('instances:readiness', id).catch(() => null), call('mods:watch', id).catch(() => null)]);
    heroInfo[id] = { ...heroInfo[id], ...s, ready, updates, at: Date.now(), seq };
    paintHeroInfo(id);
    if (inst.loader === 'vanilla') heroInfo[id].health = { conflicts: [], missing: [], duplicates: [] };
    else {
      const h = await call('mods:health', id);
      if (heroInfo[id]?.seq !== seq) return;
      heroInfo[id].health = h;
    }
    paintHeroInfo(id);
    const tips = await call('perf:check', id).catch(() => []);
    if (heroInfo[id]?.seq !== seq) return;
    heroInfo[id].tips = tips;
    paintHeroInfo(id);
  } catch {}
}
// Фон досчитал готовность модов: если это сборка на карточке, значок появляется сразу (остальные подхватят при выборе)
function onReadiness({ id } = {}) {
  if (id === state.selected) loadHeroInfo(id, true);
}
api.on('app:readiness', onReadiness);
// То же для обновлений модов: фон нашёл новые версии, или окно «Обновить моды» уточнило число, или моды обновили
api.on('app:modwatch', onReadiness);
function paintHeroInfo(id) {
  if (id !== state.selected) return;
  const inst = selectedInstance();
  const box = $('#heroStats');
  if (inst && box) box.innerHTML = statsHtml(inst);
  renderStrip();
}

// Три карточки под главной: ближайшая награда, последняя копия мира, облако
const GO = '<svg class="sc-go"><use href="#i-chev"/></svg>';
const stripCard = (tone, ico, title, sub, extra = '', act = '') =>
  `<div class="strip-card"${act ? ` data-act="${act}"` : ''}><span class="sc-ico ${tone}">${ico}</span><div class="sc-text"><b>${esc(title)}</b><small title="${esc(sub)}">${esc(sub)}</small></div>${extra}</div>`;
function renderStrip() {
  const inst = selectedInstance();
  const info = inst && heroInfo[inst.id];
  if (!inst) return ($('#homeStrip').innerHTML = '');

  const locked = (state.achievements || []).filter((a) => !a.at);
  const pool = locked.filter((a) => a.reward);
  const next = (pool.length ? pool : locked).sort((a, b) => b.progress - a.progress)[0];
  const c1 = next
    ? `<div class="strip-card" data-act="settings"><span class="sc-ico pink">${next.icon}</span><div class="sc-text"><b>${esc(next.rewardName ? `Наряд «${next.rewardName}»` : next.title)}</b><small title="${esc(next.desc)}">${esc(next.desc)}</small>${
        next.progress > 0 ? `<i class="ach-bar"><i style="width:${Math.round(next.progress * 100)}%"></i></i>` : ''
      }</div>${GO}</div>`
    : stripCard('pink', '🏆', 'Все награды собраны', 'котик тобой гордится ♡', '', 'settings');

  const b = info?.backup;
  const c2 = !info
    ? stripCard('mint', '💾', 'Копии миров', '…')
    : b
      ? stripCard('mint', '💾', 'Копия мира сохранена', fmtDate(b.time), '<button class="btn soft" data-act="restore">Вернуть</button>')
      : !info.worlds
        ? stripCard('mint', '💾', 'Миров пока нет', 'создай мир в игре')
        : stripCard('mint', '💾', 'Копий мира пока нет', state.settings.autoBackup === 'off' ? 'автокопии выключены' : 'сохраню после игры', '<button class="btn soft" data-act="restore">Миры</button>');

  const s = state.sync || {};
  const c3 = s.dir && s.error
    ? stripCard('sky', '☁️', 'Синхронизация не удалась', s.error.split(String.fromCharCode(10))[0], '<span class="sc-ok err"><svg><use href="#i-warn"/></svg></span>', 'cloud')
    : s.dir
    ? stripCard('sky', '☁️', 'Облако на связи', s.at ? `синхронизировано ${fmtDate(s.at)}` : 'ещё не синхронизировалось', '<span class="sc-ok"><svg><use href="#i-check"/></svg></span>')
    : stripCard('sky', '☁️', 'Облако не подключено', 'сборки и миры на всех твоих ПК', GO, 'cloud');
  $('#homeStrip').innerHTML = c1 + c2 + c3;
}

const instById = (id) => state.instances.find((i) => i.id === id);
$('#instSearch').oninput = (e) => ((F.q = e.target.value.trim()), renderTiles());
$('#instSort').onchange = (e) => {
  F.sort = e.target.value;
  localStorage.setItem('instSort', F.sort);
  renderTiles();
};
$('#instGroups').onclick = (e) => {
  const b = e.target.closest('[data-g]');
  if (!b) return;
  F.group = b.dataset.g;
  localStorage.setItem('instGroup', F.group);
  renderTiles();
};

// Обновления модпаков проверяем в фоне раз за запуск лаунчера (и после установки нового)
const packUpdates = {};
const packChecked = new Set();
async function checkPackUpdates() {
  for (const i of state.instances.filter((x) => x.pack?.projectId && !packChecked.has(x.id))) {
    packChecked.add(i.id);
    try {
      const r = await call('packs:check', i.id);
      if (r) packUpdates[i.id] = r;
    } catch {}
  }
  if (Object.values(packUpdates).some((u) => u.available)) renderInstances();
}
$('#newInstBtn').onclick = () => openInstanceModal();
$('#browsePacksBtn').onclick = () => openBrowser('modrinth', 'modpack');
$('#importBtn').onclick = () => openImportModal();
$('#trashBtn').onclick = () => openTrash();
// Главная: клики по плиткам полки и по кнопкам карточки выбранной сборки
$('#page-instances').addEventListener('click', (e) => {
  if (e.target.closest('#addInst')) return openInstanceModal();
  const act = e.target.closest('[data-act]')?.dataset.act;
  const tile = e.target.closest('.tile[data-id]');
  const inst = tile ? instById(tile.dataset.id) : selectedInstance();
  if (act === 'packupd') return inst && openDetails(inst, 'more');
  if (act === 'cancel') return cancelOps();
  if (tile) return selectInstance(tile.dataset.id);
  if (!act) return;
  if (act === 'newinst') return openInstanceModal();
  if (act === 'cloud' || act === 'settings') return (showPage('settings'), showSection(act === 'cloud' ? 'cloud' : 'kitty'));
  if (!inst) return;
  if (act === 'play') play();
  else if (act === 'folder') call('instances:openFolder', inst.id).catch((err) => toast(err.message, 'err'));
  else if (act === 'edit') openInstanceModal(inst);
  else if (act === 'delete') confirmDelete(inst);
  else if (act === 'more') openDetails(inst);
  else if (act === 'restore') openDetails(inst, 'worlds');
  else if (act === 'mods') {
    state.mods.inst = inst.id;
    openBrowser('installed', 'mod');
  } else if (act === 'health') {
    const h = heroInfo[inst.id]?.health;
    if (h) healthDialog(inst, h).then((go) => go && play({ skipHealth: true }));
  } else if (act === 'tips') openTips(inst);
  else if (act === 'updates') {
    state.mods.inst = inst.id;
    openBrowser('installed', 'mod');
    checkModUpdates();
  } else if (act === 'ready') {
    const r = heroInfo[inst.id]?.ready;
    if (r) openMigrate(inst.id, r.target);
  } else if (act === 'follow') openJoinModal(inst);
});
$('#instGrid').addEventListener('dblclick', (e) => {
  const tile = e.target.closest('.tile[data-id]');
  if (tile && !e.target.closest('[data-act]')) {
    selectInstance(tile.dataset.id);
    play();
  }
});

function selectInstance(id) {
  state.selected = id;
  localStorage.setItem('selected', id);
  $$('#instGrid .tile[data-id]').forEach((c) => c.classList.toggle('selected', c.dataset.id === id));
  renderHero({ animate: true });
  renderStrip();
  renderFooter();
  $('#page-instances').scrollTo({ top: 0, behavior: 'smooth' });
}

async function loadVersions() {
  if (!state.versions) state.versions = await call('versions:list');
  return state.versions;
}
