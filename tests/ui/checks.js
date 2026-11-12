// Что проверяет дымовая проверка интерфейса. Каждая запись — название и JavaScript, который выполняется в окне лаунчера.
// Выражение внутри async-функции: можно писать await, паузу делает s(мс). Окна запускаются настоящими функциями интерфейса
// (openInstanceModal и другие), параметры подставлены вручную, так что проверка не зависит от сети и данных пользователя.

const INST = `state.instances.find((x) => x.name === 'Уютное выживание') || state.instances[0]`;

// «Проверка игры с другом»: ответ подставлен вручную (сеть и сборка пользователя не нужны), а то, что окно копирует, запоминается в window.__copied
const FRIEND_CHECK = {
  verdict: 'warn',
  ms: 900,
  items: [
    { id: 'e4mc', status: 'ok', code: 'mod-e4mc-ok', data: { file: 'e4mc.jar' } },
    { id: 'route', status: 'ok', code: 'route-proxy', data: { host: '127.0.0.1', port: 10809 } },
    { id: 'broker', status: 'ok', code: 'broker-ok', data: { relay: 'eu', host: 'eu.e4mc.link', ms: 312, via: 'proxy' } },
    { id: 'udp', status: 'fail', code: 'udp-fail', data: { hosts: ['eu.e4mc.link'], reason: 'timeout' } },
    { id: 'whitelist', status: 'warn', code: 'wl-enforced-empty', data: { worlds: ['Мир для друга'] } },
  ],
};
// «Что изменилось с последнего удачного запуска» для окна вылета: ответ подставлен вручную (в профиле проверки удачной точки нет).
// Все виды изменений, больше шести названий в строке («и ещё N») и пустые значения версий
const SINCE_GOOD = {
  id: '20260101-120000-abcd',
  time: Date.now() - 3600e3,
  any: true,
  mods: {
    added: ['sodium-extra-0.6.0.jar', 'iris-1.8.0.jar'],
    enabled: ['lithium-0.14.0.jar'],
    changed: ['ferritecore-7.0.0.jar'],
    removed: ['a1.jar', 'a2.jar', 'a3.jar', 'a4.jar', 'a5.jar', 'a6.jar', 'a7.jar', 'a8.jar'],
    disabled: ['modmenu-11.0.0.jar'],
  },
  instance: { version: { from: '1.21.1', to: '1.21.4' }, loader: { from: 'vanilla', to: 'fabric' }, loaderVersion: { from: null, to: '0.16.9' }, pack: { from: '1.0', to: null } },
};
// «Войти к другу»: ответ сверки подставлен вручную (настоящий Modrinth проверке не нужен). Все списки; сборка гостя подставляется при проверке
const JOIN_PLAN = {
  host: { mc: '1.21.1', loader: 'fabric', loaderVersion: '0.15.0', count: 12 },
  mine: { mc: '1.21.1', loader: 'fabric', loaderVersion: '0.16.0' },
  mismatch: { version: false, loader: false, loaderVersion: true },
  same: [{ title: 'Alpha', file: 'alpha-1.0.jar', version: '1.0' }, { title: 'own.jar', file: 'own.jar', version: null }],
  off: [{ title: 'Gamma', file: 'gamma-1.0.jar', version: '1.0' }],
  missing: [{ title: 'Delta', version: '2.0', versionId: 'VER00004', projectId: 'PRJ00004' }],
  other: [{ title: 'Beta', file: 'beta-0.9.jar', mine: '0.9', theirs: '1.0', versionId: 'VER00002', projectId: 'PRJ00002' }],
  manual: [{ name: 'tools.jar', why: 'other' }, { name: 'own2.jar', why: 'differs' }, { name: 'AbCd1234', why: 'gone' }],
  extra: [{ title: 'Zeta', file: 'zeta-1.0.jar', known: true }, { title: 'custom.jar', file: 'custom.jar', known: false }],
  todo: 3,
};
// Общее начало проверок окна «Войти к другу»: подмена ответов главного процесса и помощники. Конец за каждой проверкой свой (finally)
const JOIN_STUB = `const inst = ${INST}; const van = state.instances.find((x) => x.loader === 'vanilla'); const o2 = window.call; const calls = []; const res = {};
  const base = ${JSON.stringify(JOIN_PLAN)};
  const planFor = (i, extra = {}) => ({ ...base, host: { ...base.host, mc: i.version, loader: i.loader }, mine: { mc: i.version, loader: i.loader, loaderVersion: '0.16.0' }, ...extra });
  let answer = null; let failed = [];
  window.call = async (ch, ...a) => {
    if (ch === 'instances:joinCheck') { calls.push(['check', ...a]); return answer; }
    if (ch === 'instances:joinInstall') { calls.push(['install', ...a]); return { installed: ['Delta'], replaced: [{ title: 'Beta', from: '0.9', to: '1.0' }], enabled: ['Gamma'], failed, manual: base.manual, instance: state.instances.find((x) => x.id === a[0]) || inst }; }
    if (ch === 'game:launch') { calls.push(['launch', ...a]); return true; }
    if (ch === 'mods:health') return { conflicts: [], missing: [], duplicates: [] };
    return o2(ch, ...a);
  };
  const q = (sel) => document.querySelector(sel);
  const txt = () => q('#modalBox').innerText;
  const flat = (el) => el.innerText.replace(/\\s+/g, ' ');
  const open = async (i) => { q('#modalBox').isDirty = null; closeModal(); await s(250); calls.length = 0; openJoinModal(i); await s(450); };
  const paste = async (text) => { q('#jnText').value = text; q('#jnText').dispatchEvent(new Event('paste')); await s(700); };
  const sec = (re) => [...document.querySelectorAll('#modalBox .jn-sec')].find((x) => re.test(x.querySelector('summary').textContent));
  const prevGpu = state.gpu; state.gpu = null;
  const cleanup = () => { window.call = o2; state.gpu = prevGpu; state.running.delete(van.id); q('#modalBox').isDirty = null; closeModal(); selectInstance(inst.id); };`;
// «Итоги игры»: карточки считает настоящее ядро (core/recap.js) по заданному журналу, так что проверки видят то же, что окно получит в жизни.
// В журнале две сборки и одна уже удалённая; есть игра сегодня, на этой неделе, в этом и в прошлом месяце
const recapCore = require('../../src/core/recap');
const RECAP_CARDS = (lang, names) => {
  const now = Date.now();
  const H = 3600e3;
  const at = (back, hour) => {
    const d = new Date(now);
    d.setHours(hour, 0, 0, 0);
    d.setDate(d.getDate() - back);
    return d.getTime();
  };
  const sessions = [[0, 8, 2.5, 'a'], [1, 20, 1, 'b'], [2, 10, 3.2, 'a'], [4, 21, 4, 'b'], [5, 9, 0.5, 'gone'], [9, 19, 2, 'a'], [14, 14, 6, 'b'], [20, 12, 1.5, 'a'], [26, 18, 3, 'gone'], [33, 16, 5, 'a']].map(([back, hour, len, id]) => ({ id, start: at(back, hour), end: at(back, hour) + len * H }));
  const make = (period, hideNames, list = sessions) => recapCore.card({ period, lang, hideNames, names: new Map(Object.entries(names)), now, sessions: list });
  return { week: { show: make('week', false), hide: make('week', true) }, month: { show: make('month', false), hide: make('month', true) }, empty: make('week', false, []) };
};
// Общее начало проверок окна «Итоги игры»: подмена ответов главного процесса (запрос карточки, сохранение, копирование), запись всего, что
// рисуется на холсте (fillText), и уборка за собой (cleanup)
const RECAP_STUB = (cards) => `const o2 = window.call; const cards = ${JSON.stringify(cards)}; const calls = []; const q = (sel) => document.querySelector(sel);
  const drawn = []; const drawnXY = []; const realFill = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function (t, ...r) { drawn.push(String(t)); drawnXY.push([String(t), r[0], r[1]]); return realFill.call(this, t, ...r); };
  const st = { delay: {}, saved: 'C:\\\\Pictures\\\\recap.png', fail: null, empty: false };
  window.call = async (ch, ...a) => {
    if (ch === 'game:recap') { calls.push(['recap', ...a]); await s(st.delay[a[0]] || 0); if (st.empty) return cards.empty; const c = a[0] === 'month' ? cards.month : cards.week; return a[1].hideNames ? c.hide : c.show; }
    if (ch === 'app:saveImage') { calls.push(['save', ...a]); if (st.fail) throw new Error(st.fail); return st.saved; }
    if (ch === 'app:copyImage') { calls.push(['copy', ...a]); if (st.fail) throw new Error(st.fail); return true; }
    return o2(ch, ...a);
  };
  const cleanup = () => { window.call = o2; CanvasRenderingContext2D.prototype.fillText = realFill; localStorage.removeItem('recapOpts'); q('#modalBox').isDirty = null; closeModal(); };`;
// «Коллекция Modrinth»: ответ главного процесса подставлен по форме настоящего (core/collection.js: load → suggest), а «подходит ли» берётся из настоящей
// compat ядра для каждого сочетания версии и загрузчика, так что окно видит то же, что в жизни. Сетевой Modrinth проверке не нужен
const collectionCore = require('../../src/core/collection');
const COLLECTION = (lang) => {
  const ru = lang !== 'en';
  const p = (id, title, type, loaders, versions, importable = true) => ({ id, slug: id.toLowerCase(), title, type, icon: null, description: ru ? `Описание ${title}` : `About ${title}`, loaders, versions, importable });
  const projects = [
    p('AAAA0001', 'Sodium', 'mod', ['fabric', 'quilt'], ['1.20.1', '1.21.1']),
    p('BBBB0002', 'Lithium', 'mod', ['fabric'], ['1.21.1']),
    p('CCCC0003', ru ? 'Старый мод' : 'Old mod', 'mod', ['forge'], ['1.12.2']),
    p('DDDD0004', ru ? 'Красивые текстуры' : 'Pretty textures', 'resourcepack', ['minecraft'], ['1.21.1']),
    p('EEEE0005', ru ? 'Сборка друга' : 'Friend pack', 'modpack', ['fabric'], ['1.21.1'], false),
    p('FFFF0006', 'Only Forge', 'mod', ['forge', 'neoforge'], ['1.21.1']),
  ];
  return { id: 'sp6gQaWQ', name: ru ? 'Моя подборка' : 'My picks', description: ru ? 'Лучшие моды' : 'The best mods', missing: 1, truncated: 0, projects, suggest: collectionCore.suggest(projects, ['1.21.1', '1.20.1']) };
};
const COLLECTION_TABLE = (data) => Object.fromEntries(['1.21.4', '1.21.1', '1.20.1', '1.12.2'].flatMap((v) => ['vanilla', 'fabric', 'quilt', 'forge', 'neoforge'].map((l) => [`${v}|${l}`, Object.fromEntries(data.projects.map((x) => [x.id, collectionCore.compat(x, v, l)]))])));
const COLLECTION_VERSIONS = { latest: { release: '1.21.4', snapshot: '1.21.4' }, versions: ['1.21.1', '1.21.4', '1.20.1', '1.12.2'].map((id) => ({ id, type: 'release', releaseTime: '2024-08-08T00:00:00+00:00' })) };
// Подмена каналов окна: calls — что окно спрашивало; st.responses — очередь ответов на «показать» ({ data, delay }), st.fail — ошибка вместо ответа,
// st.result / st.importFail — что отвечает установка; список версий подставлен, чтобы окно не ходило в настоящую сеть
const COLLECTION_STUB = (data) => `const o2 = window.call; const calls = []; const q = (sel) => document.querySelector(sel); const data = ${JSON.stringify(data)}; const table = ${JSON.stringify(COLLECTION_TABLE(data))};
  const st = { responses: [], fail: null, result: null, importFail: null, importDelay: 0, compatDelay: {} }; const prevVersions = state.versions; state.versions = ${JSON.stringify(COLLECTION_VERSIONS)};
  window.call = async (ch, ...a) => {
    if (ch === 'browse:collection') { calls.push(['load', a[0]]); const r = st.responses.shift() || { data, delay: 0 }; await s(r.delay || 0); if (st.fail) throw new Error(st.fail); return r.data; }
    if (ch === 'browse:collectionCompat') { calls.push(['compat', ...a]); const t = a[1].instance ? state.instances.find((x) => x.id === a[1].instance) : a[1]; await s(st.compatDelay[t.version + '|' + t.loader] || 0); return table[t.version + '|' + t.loader] || {}; }
    if (ch === 'browse:collectionImport') { calls.push(['import', ...a]); await s(st.importDelay || 0); if (st.importFail) throw new Error(st.importFail); return st.result; }
    return o2(ch, ...a);
  };
  const clear = async () => { q('#modalBox').isDirty = null; closeModal(); await s(350); q('#modalBox').innerHTML = ''; };
  const cleanup = () => { window.call = o2; state.versions = prevVersions; q('#modalBox').isDirty = null; closeModal(); };`;
const withFriendCheck = (body) =>
  `const o2 = window.call; window.__copied = null; window.call = async (ch, ...a) => (ch === 'instances:friendCheck' ? ${JSON.stringify(FRIEND_CHECK)} : ch === 'app:copyText' ? ((window.__copied = a[0]), true) : o2(ch, ...a)); try { ${body} } finally { window.call = o2 }`;

// Английский вариант окна проверки: каждый код из таблицы окна с разными данными (путь через прокси и напрямую, один мир и два,
// все причины отказа сети), чтобы нигде не осталось русских слов. Берётся из самой таблицы окна — забытый перевод не проскочит
const FRIEND_CHECK_EN = `
  const codes = Object.keys(FC_ROW);
  const idOf = (c) => (c.startsWith('mod-e4mc') ? 'e4mc' : c.startsWith('mod-lan') ? 'lan' : c.startsWith('route') ? 'route' : c.startsWith('udp') ? 'udp' : c.startsWith('wl-') ? 'whitelist' : 'broker');
  const base = { host: 'eu.e4mc.link', port: 10809, kind: 'SOCKS5', ms: 312, hosts: ['eu.e4mc.link', 'de.e4mc.link'], worlds: ['W1'], nicks: ['Nick', 'Other'], message: 'boom', file: 'e4mc.jar', status: 503, reason: 'timeout', via: 'proxy' };
  const items = [];
  for (const code of codes) {
    items.push({ id: idOf(code), status: 'warn', code, data: base }, { id: idOf(code), status: 'fail', code, data: { ...base, via: 'direct', worlds: ['W1', 'W2'] } });
    for (const reason of Object.keys(FC_WHY)) items.push({ id: idOf(code), status: 'ok', code, data: { ...base, reason } });
  }
  items.push({ id: 'broker', status: 'warn', code: 'нового-кода-нет', data: {} });
  I18N.set('en');
  const o2 = window.call;
  const left = [];
  try {
    for (const verdict of ['ok', 'warn', 'fail']) {
      window.call = async (ch, ...a) => (ch === 'instances:friendCheck' ? { verdict, ms: 1, items } : o2(ch, ...a));
      openFriendCheck({ id: (${INST}).id, name: 'Test pack' });
      await s(900);
      left.push(...document.querySelector('#modalBox').innerText.split('\\n').filter((l) => /[А-Яа-яЁё]/.test(l)));
    }
  } finally {
    window.call = o2;
    closeModal();
  }
  // Окна «Играть с другом» и адрес мира (с белым списком и без) и настройка: тоже без русских слов
  const id = (${INST}).id;
  const grab = async (open) => { closeModal(); await s(250); open(); await s(600); const t = document.querySelector('#modalBox').innerText; document.querySelector('#modalBox').isDirty = null; return t; };
  localStorage.setItem('friendsMigrated', '1');
  const F = (nick, offline, on = true) => ({ nick, offline, uuid: null, on });
  state.friends = [F('PinkDick', true), F('PinkCat_', false), F('Sleepy_Cat', true, false)]; // смешанный список, один друг без галочки
  const texts = [await grab(() => openFriendModal(${INST}))];
  state.friends = [F('PinkDick', true)];
  texts.push(await grab(() => showFriendShare({ id, address: 'test-world.e4mc.link', whitelist: ['PinkDick'] })));
  texts.push(await grab(() => showFriendShare({ id, address: 'test-world.e4mc.link', whitelist: [] })));
  state.guests[id] = ['PinkDick', 'Sleepy_Cat']; // друзья уже в мире
  texts.push(await grab(() => showFriendShare({ id, address: 'test-world.e4mc.link', whitelist: ['PinkDick'] })));
  state.guests[id] = [];
  const lanS = [{ kind: 'lan', name: 'Wi-Fi', host: '192.168.1.5', address: '192.168.1.5:61223' }, { kind: 'ipv6', name: 'Ethernet', host: '2a02::1', address: '[2a02::1]:61223' }];
  texts.push(await grab(() => showFriendShare({ id, address: 'test-world.e4mc.link', whitelist: [], lan: lanS }))); // адреса для входа по сети
  texts.push(await grab(() => showLanAddresses({ id, port: 61223, addresses: lanS })));
  state.friends = [F('PinkCat_', false)];
  texts.push(await grab(() => showFriendShare({ id, address: 'test-world.e4mc.link', whitelist: [] })));
  state.friends = [];
  closeModal();
  texts.push(document.querySelector('#clearWhitelist').closest('.card').innerText);
  texts.push(document.querySelector('#gameProxy').closest('.card').innerText);
  // Карточка синхронизации с кнопкой «Восстановить облако…» и её окно подтверждения. Имена сборок — данные человека, «Корзина» — имя папки в облаке
  texts.push(document.querySelector('#syncRestore').closest('.card').innerText);
  closeModal(); await s(250); restoreCloudDialog(); await s(500);
  {
    const c = document.querySelector('#modalBox').cloneNode(true);
    c.querySelector('#srInst')?.remove();
    let t = c.innerText || c.textContent;
    for (const i of state.instances) t = t.split(i.name).join('');
    texts.push(t.replace(/“Корзина”/g, ''));
  }
  document.querySelector('#modalBox').isDirty = null; closeModal(); await s(250);
  showPage('accounts'); await s(400); texts.push(document.querySelector('#accList').innerText); showPage('instances');
  await copyNick('Boykisser_'); await s(300); texts.push(document.querySelector('#toasts').innerText);
  // Корзина и подтверждение удаления
  const sample = [{ id: 'old-1', name: 'Old pack', version: '1.21.1', loader: 'fabric', icon: '🌸', color: '#ffd1e8', deletedAt: Date.now() }];
  // refresh() сверяет язык с настройками и при расхождении перезагружает окно: поэтому в ответе и язык английский
  window.call = async (ch, ...a) => { if (ch !== 'state:get') return o2(ch, ...a); const real = await o2(ch, ...a); return { ...real, settings: { ...real.settings, lang: 'en' }, trash: sample }; };
  try {
    texts.push(await grab(() => openTrash()));
    texts.push(document.querySelector('#trashBtn').textContent);
    texts.push(await grab(() => confirmDelete({ id, name: 'Test pack' })));
  } finally { window.call = o2; closeModal(); }
  // Консоль с включённым поиском и вкладка «Ещё» сборки (с подсказками кнопок)
  showPage('console'); await s(300);
  const find = document.querySelector('#logFind'); find.value = 'abc'; find.dispatchEvent(new Event('input', { bubbles: true })); await s(200);
  texts.push(document.querySelector('#page-console .page-head').innerText + '\\n' + find.placeholder);
  find.value = ''; find.dispatchEvent(new Event('input', { bubbles: true }));
  showPage('instances'); await s(300);
  closeModal(); await s(250); openDetails(${INST}, 'more'); await s(800); // название сборки в заголовке — данные человека, их не переводим: берём только вкладку
  texts.push(document.querySelector('#detBody').innerText);
  texts.push([...document.querySelectorAll('#detBody [title]')].map((b) => b.title).join('\\n'));
  // Окно вылета с блоком «что изменилось с последнего удачного запуска» (все виды изменений, пустые значения, «и ещё N»; и вариант «без изменений»)
  // и список точек с закреплённым «Последним удачным запуском»
  const sg = ${JSON.stringify(SINCE_GOOD)};
  const noneChanged = { ...sg, any: false, mods: { added: [], enabled: [], changed: [], removed: [], disabled: [] }, instance: {} };
  const instName = (${INST}).name; // название сборки в заголовке — данные человека, их не переводим
  const withoutName = () => document.querySelector('#modalBox').innerText.split('\\n').filter((l) => l.trim() !== instName).join('\\n');
  for (const sinceGood of [sg, noneChanged]) {
    closeModal(); await s(250); showCrash(id, { reason: 'Mod is incompatible', hints: ['Update the mods'], sinceGood }); await s(500);
    texts.push(withoutName());
    texts.push([...document.querySelectorAll('#modalBox [title]')].map((b) => b.title).join('\\n'));
    document.querySelector('#modalBox').isDirty = null;
  }
  closeModal(); await s(250);
  const oRp = window.call;
  const rpt = (sid, reason, extra = {}) => ({ id: sid, time: Date.now(), reason, auto: true, mods: 3, configFiles: 1, diff: { added: 0, removed: 0, changed: 0 }, ...extra });
  window.call = async (ch, ...a) => (ch === 'snapshots:list' ? [rpt('20260101-100000-aaaa', 'Последний удачный запуск', { kind: 'good', auto: false, diff: { added: 1, removed: 2, changed: 3 } }), rpt('20260101-110000-bbbb', 'Перед обновлением модов')] : oRp(ch, ...a));
  try {
    openRestorePoints(id); await s(700);
    texts.push(withoutName());
    texts.push([...document.querySelectorAll('#modalBox [title]')].map((b) => b.title).join('\\n'));
    document.querySelector('#modalBox').isDirty = null; closeModal(); await s(250);
  } finally { window.call = oRp; }
  // «Войти к другу»: пустое окно, сверка со всеми списками, «новая сборка», предупреждение о версии, беда с кодом, только адрес, нет связи,
  // ошибки установки; окна хозяина с кнопками «Код сборки». Название сборки в выпадающем списке — данные человека, его пропускаем
  const jbase = ${JSON.stringify(JOIN_PLAN)};
  const jinst = (${INST});
  const jplan = (extra = {}) => ({ ...jbase, host: { ...jbase.host, mc: jinst.version, loader: jinst.loader }, mine: { mc: jinst.version, loader: jinst.loader, loaderVersion: '0.16.0' }, ...extra });
  let janswer = null; let jfailed = []; let joffline = false;
  const oJ = window.call;
  window.call = async (ch, ...a) => {
    // refresh() сверяет язык с настройками и при расхождении перезагружает окно: поэтому в ответе и язык английский
    if (ch === 'state:get') { const real = await oJ(ch, ...a); return { ...real, settings: { ...real.settings, lang: 'en' } }; }
    if (ch === 'instances:joinCheck') { if (joffline) throw new Error('Нет связи с Modrinth — без неё моды не опознать и не скачать. Проверь интернет и попробуй ещё раз'); return janswer; }
    if (ch === 'instances:joinInstall') return { installed: [], replaced: [], enabled: [], failed: jfailed, manual: [], instance: jinst };
    if (ch === 'instances:modCode') return { code: 'FLM1:3:abc', total: 47, modrinth: 45, others: ['own.jar'] };
    return oJ(ch, ...a);
  };
  const jleaf = () => {
    const c = document.querySelector('#modalBox').cloneNode(true);
    c.querySelector('#jnInst')?.remove();
    const out = [];
    const w = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) if (n.nodeValue.trim()) out.push(n.nodeValue.trim());
    out.push(...[...c.querySelectorAll('[title],[placeholder]')].map((e) => e.title || e.placeholder));
    return out.join('\\n');
  };
  const jopen = async (paste) => {
    document.querySelector('#modalBox').isDirty = null; closeModal(); await s(150); openJoinModal(jinst); await s(250);
    if (paste) { document.querySelector('#jnText').value = paste; document.querySelector('#jnText').dispatchEvent(new Event('paste')); await s(450); }
    return jleaf();
  };
  try {
    texts.push(await jopen());
    janswer = { address: 'pink-cat.e4mc.link', plan: jplan(), problem: null };
    texts.push(await jopen('x'));
    janswer = { address: 'pink-cat.e4mc.link', plan: jplan({ mine: { mc: '1.20.1', loader: 'quilt', loaderVersion: null }, mismatch: { version: true, loader: true, loaderVersion: false } }), problem: null };
    texts.push(await jopen('x'));
    janswer = { address: 'pink-cat.e4mc.link', plan: jplan({ host: { ...jbase.host, mc: '1.19.4', loader: 'vanilla' }, mine: null, mismatch: { version: false, loader: false, loaderVersion: false } }), problem: null };
    texts.push(await jopen('x'));
    janswer = { address: 'pink-cat.e4mc.link', plan: jplan({ todo: 0, missing: [], other: [], off: [], manual: [], mismatch: { version: false, loader: false, loaderVersion: false } }), problem: null };
    texts.push(await jopen('x'));
    janswer = { address: 'pink-cat.e4mc.link', plan: null, problem: { code: 'truncated', message: 'Код обрезан: не хватает 15 знаков в конце. Скопируй сообщение друга целиком (длинные сообщения чаты иногда режут на части)' } };
    texts.push(await jopen('x'));
    janswer = { address: 'play.example.com:25565', plan: null, problem: null };
    texts.push(await jopen('x'));
    joffline = true;
    texts.push(await jopen('x'));
    joffline = false;
    janswer = { address: 'pink-cat.e4mc.link', plan: jplan(), problem: null };
    jfailed = [{ title: 'Delta', error: 'Файл «delta-2.0.jar» уже есть и отличается от нужного — убери его из папки mods и повтори' }, { title: 'Beta', error: 'Некорректное имя файла' }];
    await jopen('x'); document.querySelector('#jnInstall').click(); await s(1000);
    texts.push(jleaf(), document.querySelector('#toasts').innerText);
    document.querySelector('#modalBox').isDirty = null; closeModal(); await s(250);
    openFriendModal(jinst); await s(500); texts.push(jleaf());
    document.querySelector('#frCode').click(); await s(500); texts.push(document.querySelector('#toasts').innerText);
    document.querySelector('#modalBox').isDirty = null; closeModal(); await s(250);
    showFriendShare({ id: jinst.id, address: 'pink-cat.e4mc.link', whitelist: [] }); await s(500); texts.push(jleaf());
  } finally { window.call = oJ; document.querySelector('#modalBox').isDirty = null; closeModal(); await s(250); }
  // Значок «пора на новую версию?» на карточке выбранной сборки (множественное и единственное число в «из N мода/модов»)
  const rinst = (${INST});
  selectInstance(rinst.id); await s(500);
  for (const total of [41, 40]) {
    heroInfo[rinst.id] = { ...heroInfo[rinst.id], ready: { target: '1.99.9', ready: 38, total, checkedAt: 1 }, at: Date.now() };
    paintHeroInfo(rinst.id);
    await s(200); // перевод вставленных узлов идёт следом за вставкой
    texts.push(document.querySelector('#heroStats').innerText + '\\n' + [...document.querySelectorAll('#heroStats [title]')].map((b) => b.title).join('\\n'));
  }
  heroInfo[rinst.id].ready = null;
  // Значок «вышли обновления модов»: единственное, несколько, много (с «и ещё N»)
  for (const [count, titles] of [[1, ['Alpha']], [3, ['Alpha', 'Beta', 'Gamma']], [7, ['A', 'B', 'C', 'D', 'E']]]) {
    heroInfo[rinst.id] = { ...heroInfo[rinst.id], updates: { count, titles, checkedAt: 1 }, at: Date.now() };
    paintHeroInfo(rinst.id);
    await s(200);
    texts.push(document.querySelector('#heroStats').innerText + '\\n' + [...document.querySelectorAll('#heroStats [title]')].map((b) => b.title).join('\\n'));
  }
  heroInfo[rinst.id].updates = null;
  paintHeroInfo(rinst.id);
  // Итог «Починить файлы игры»: чинили / всё в порядке / загрузчики в разных состояниях
  const rep = { version: '1.21.1', client: { fixed: true }, profile: { fixed: true }, loader: { name: 'Fabric', state: 'fixed' }, libraries: { checked: 87, fixed: 1 }, assets: { checked: 3812, fixed: 2 } };
  for (const r of [rep, ...['ok', 'unknown-version', 'at-launch'].map((state) => ({ ...rep, client: { fixed: false }, profile: { fixed: false }, libraries: { checked: 1, fixed: 0 }, assets: { checked: 2, fixed: 0 }, loader: { name: 'Fabric', state } }))]) {
    document.querySelector('#modalBox').isDirty = null; closeModal(); await s(250); openRepairReport({ name: 'Test pack' }, r); await s(400);
    texts.push(document.querySelector('#modalBox').innerText);
  }
  document.querySelector('#modalBox').isDirty = null; closeModal();
  // Моды: закреплённый мод в списке (с подсказкой кнопки) и окно обновлений с замечанием про закреплённые
  window.call = async (ch, ...a) => (ch === 'mods:origins' ? {} : ch === 'mods:checkUpdates' ? [{ file: 'x.jar', title: 'Mod X', from: '1.0', to: '2.0', icon: null, changelog: 'Fixed a crash' }] : o2(ch, ...a));
  try {
    state.mods.inst = id; openBrowser('installed', 'mod'); await s(900);
    const first = document.querySelector('#modList .mod-row').dataset.file;
    await call('mods:pin', id, first, true); await loadMods(); await s(600);
    const pinnedRow = [...document.querySelectorAll('#modList .mod-row')].find((r) => r.dataset.file === first);
    texts.push(pinnedRow.innerText + '\\n' + [...document.querySelectorAll('#modList .mod-row [title]')].map((b) => b.title).join('\\n'));
    await checkModUpdates(); await s(500);
    texts.push(document.querySelector('#modalBox').innerText.split('\\n').filter((l) => !l.includes('Found 1 updates for')).join('\\n')); // в этой строке название сборки — данные человека
    document.querySelector('#modalBox').isDirty = null; closeModal(); await s(250);
    window.call = async (ch, ...a) => (ch === 'mods:origins' ? {} : ch === 'mods:checkUpdates' ? [] : o2(ch, ...a));
    await checkModUpdates(); await s(400);
    texts.push(document.querySelector('#toasts').innerText);
    await call('mods:pin', id, first, false);
  } finally { window.call = o2; showPage('instances'); }
  // «Место на диске» со строкой про старые логи
  const oStore = window.call;
  window.call = async (ch, ...a) => (ch === 'storage:scan' ? { instancesSize: 5242880, categories: [{ id: 'logs', name: 'Старые логи игры', total: 2048, free: 2048, count: 3 }] } : oStore(ch, ...a));
  try { await scanStorage(); await s(300); texts.push(document.querySelector('#storageBody').innerText); } finally { window.call = oStore; }
  // Заметки об обновлении перед установкой (по-английски берётся английский блок)
  update = { state: 'ready', version: '9.9.9', current: '1.0.0', notes: UpdateNotes.render({ ru: [['🌸', 'Новая штука', 'делает так']], en: [['🌸', 'A new thing', 'does this']] }) };
  renderUpdate(); notesShown.clear();
  document.querySelector('#updatePill').click(); await s(500);
  texts.push(document.querySelector('#modalBox').innerText);
  document.querySelector('#modalBox').isDirty = null; closeModal(); update = {}; renderUpdate();
  // «Время в игре»: с данными и пустое
  const DAYMS = 86400e3;
  const wk = [...Array(7)].map((_, i) => ({ at: Date.now() - (6 - i) * DAYMS, ms: (i + 1) * 600e3 }));
  renderPlayStats({ since: Date.now() - 5 * DAYMS, sessions: 4, total: 9 * 3600e3, longest: 3 * 3600e3, week: wk, weekTotal: 9 * 3600e3, byInstance: [{ id: 'a', name: 'Pack A', ms: 6 * 3600e3 }, { id: 'b', name: null, ms: 3 * 3600e3 }] });
  await s(300);
  texts.push(document.querySelector('#playStats').innerText);
  renderPlayStats({ since: null, sessions: 0, total: 0, longest: 0, week: wk, weekTotal: 0, byInstance: [] });
  await s(300);
  texts.push(document.querySelector('#playStats').innerText);
  renderPlayStats({ since: Date.now(), sessions: 4, total: 9 * 3600e3, longest: 3 * 3600e3, week: wk, weekTotal: 9 * 3600e3, byInstance: [] }); // кнопка «Итоги» и её подсказка
  await s(300);
  texts.push(document.querySelector('#playStats').innerText + '\\n' + [...document.querySelectorAll('#playStats [title]')].map((b) => b.title).join('\\n'));
  // «Итоги игры»: окно (с картинкой и с пустым сроком), сохранение, ошибка копирования и всё, что нарисовано на холсте. Названия сборок — данные человека
  const rcEn = ${JSON.stringify(RECAP_CARDS('en', { a: 'Pack A', b: 'Pack B' }))};
  const oRc = window.call; const realFillRc = CanvasRenderingContext2D.prototype.fillText; const rcDrawn = []; let rcEmpty = false;
  CanvasRenderingContext2D.prototype.fillText = function (t, ...r) { rcDrawn.push(String(t)); return realFillRc.call(this, t, ...r); };
  // Запросы окна проверяются и по существу: английский язык и выбранный срок должны дойти до главного процесса; иначе в ответ идёт русская ошибка, и проход её увидит
  // (не ответом-ошибкой: тогда окно застыло бы, а рядом проверяемое не успело бы показаться; поэтому русская метка уходит прямо в список текстов)
  window.call = async (ch, ...a) => {
    if (ch === 'game:recap') { if (a[1]?.lang !== 'en') texts.push('Запрос ушёл не на английском'); return rcEmpty ? rcEn.empty : (a[0] === 'month' ? rcEn.month : rcEn.week)[a[1]?.hideNames ? 'hide' : 'show']; }
    if (ch === 'app:saveImage') { if (a[1]?.lang !== 'en' || a[1]?.period !== 'month') texts.push('Сохранение ушло с другим языком или сроком'); return 'C:\\\\x.png'; }
    if (ch === 'app:copyImage') return Promise.reject(new Error('Это не PNG-картинка'));
    return oRc(ch, ...a);
  };
  try {
    for (const empty of [false, true]) {
      rcEmpty = empty;
      document.querySelector('#modalBox').isDirty = null; closeModal(); await s(250); openRecap(); await s(800);
      texts.push(document.querySelector('#modalBox').innerText);
      texts.push([...document.querySelectorAll('#modalBox [title]')].map((b) => b.title).join('\\n'));
    }
    rcEmpty = false;
    document.querySelector('#rcPeriod [data-v="month"]').click(); await s(700);
    document.querySelector('#rcSave').click(); await s(300);
    document.querySelector('#rcCopy').click(); await s(500);
    texts.push(document.querySelector('#toasts').innerText);
    texts.push(rcDrawn.join('\\n'));
  } finally { window.call = oRc; CanvasRenderingContext2D.prototype.fillText = realFillRc; localStorage.removeItem('recapOpts'); document.querySelector('#modalBox').isDirty = null; closeModal(); await s(250); }
  // «Коллекция Modrinth» по-английски: пустое окно, ошибка, список с пометками (новая сборка, чужая версия, чужой загрузчик), итог установки с причинами.
  // Названия проектов, коллекции и сборок — данные человека (здесь латиницей); выпадающий список сборок в текст не берём
  const oCl = window.call; const prevClVersions = state.versions; let clFail = null; let clSlow = false;
  const clData = ${JSON.stringify(COLLECTION('en'))}; const clTable = ${JSON.stringify(COLLECTION_TABLE(COLLECTION('en')))};
  state.versions = ${JSON.stringify(COLLECTION_VERSIONS)};
  window.call = async (ch, ...a) => {
    if (ch === 'state:get') { const real = await oCl(ch, ...a); return { ...real, settings: { ...real.settings, lang: 'en' } }; }
    if (ch === 'browse:collection') { if (clSlow) await s(900); if (clFail) throw new Error(clFail); return clData; }
    if (ch === 'browse:collectionCompat') { const t = a[1].instance ? state.instances.find((x) => x.id === a[1].instance) : a[1]; return clTable[t.version + '|' + t.loader] || {}; }
    if (ch === 'browse:collectionImport') return { instance: { ...state.instances[0], name: 'New pack' }, created: true, installed: ['Sodium', 'Lithium'], failed: [{ title: 'Old mod', error: 'У «Old mod» нет версии для 1.21.1 на Fabric — есть только для Forge' }, { title: 'Friend pack', error: 'модпак в сборку так не ставится — модпаки ставятся из «Моды → Модпаки»' }, { title: 'Nope', error: 'такого проекта нет в этой коллекции' }, { title: 'Odd', error: 'datapack в сборку так не ставится' }], warnings: [], notes: [] };
    return oCl(ch, ...a);
  };
  const cleaf = () => {
    const c = document.querySelector('#modalBox').cloneNode(true);
    c.querySelector('#clTarget')?.remove();
    const out = [];
    const w = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) if (n.nodeValue.trim()) out.push(n.nodeValue.trim());
    out.push(...[...c.querySelectorAll('[title],[placeholder]')].map((e) => e.title || e.placeholder));
    return out.join('\\n');
  };
  try {
    document.querySelector('#modalBox').isDirty = null; closeModal(); await s(300);
    openCollection(); await s(600); texts.push(cleaf());
    clFail = 'Коллекция не найдена. Проверь ссылку; закрытые (приватные) коллекции лаунчер не видит';
    document.querySelector('#clLink').value = 'sp6gQaWQ'; document.querySelector('#clLoad').click(); await s(600); texts.push(cleaf());
    clFail = 'Не вижу ссылки на коллекцию Modrinth: она выглядит как modrinth.com/collection/abcd1234';
    document.querySelector('#clLoad').click(); await s(600); texts.push(cleaf());
    clFail = null; clSlow = true;
    document.querySelector('#clLoad').click(); await s(350); texts.push(cleaf()); // пока коллекция читается: «Reading the collection…»
    await s(1300); clSlow = false; texts.push(cleaf());
    document.querySelector('#clLoader').value = 'forge'; document.querySelector('#clLoader').dispatchEvent(new Event('change')); await s(600); texts.push(cleaf());
    const oldInst = state.instances.find((x) => x.loader === 'forge');
    document.querySelector('#clTarget').value = oldInst.id; document.querySelector('#clTarget').dispatchEvent(new Event('change')); await s(600); texts.push(cleaf());
    document.querySelector('#clAll').click(); document.querySelector('#clNone').click(); await s(250); texts.push(cleaf()); // перевод вставленного текста идёт следом за вставкой
    document.querySelector('#clTarget').value = 'new'; document.querySelector('#clTarget').dispatchEvent(new Event('change')); await s(500);
    document.querySelector('#clAll').click(); document.querySelector('#clGo').click(); await s(1300); texts.push(cleaf());
    texts.push(document.querySelector('#toasts').innerText);
  } finally { window.call = oCl; state.versions = prevClVersions; document.querySelector('#modalBox').isDirty = null; closeModal(); await s(250); }
  for (const t of texts) left.push(...t.split('\\n').filter((l) => /[А-Яа-яЁё]/.test(l)));
  return left.length ? 'EXC русское в английском: ' + [...new Set(left)].join(' | ') : codes.length`;

// Окна: после вызова окно должно быть открыто и не пустым. Потом оно закрывается
const DIALOGS = [
  ['создание сборки', `openInstanceModal(); await s(1200)`],
  ['правка сборки', `openInstanceModal(${INST}); await s(1200)`],
  ['подробности: миры', `openDetails(${INST}, 'worlds'); await s(1200)`],
  ['подробности: «Ещё»', `openDetails(${INST}, 'more'); await s(1200)`],
  ['импорт сборки', `openImportModal(); await s(600)`],
  ['другие лаунчеры', `openOtherImport(); await s(2500)`],
  ['освободить место', `openFreeSpace(); await s(2500)`],
  ['«Что нового»', `localStorage.setItem('seenVersion', '0.0.1'); showWhatsNew(); await s(900)`],
  ['мастер первого запуска', `openWizard({ start: 'account' }); await s(900)`],
  ['корзина (пустая)', `openTrash(); await s(700)`],
  ['подтверждение удаления сборки', `confirmDelete(${INST}); await s(500)`],
  ['игра с другом', `openFriendModal(${INST}); await s(700)`],
  ['проверка игры с другом', withFriendCheck(`openFriendCheck(${INST}); await s(900);`)],
  ['адрес друга', `showFriendShare({ id: (${INST}).id, address: 'test-world.e4mc.link' }); await s(700)`],
  ['советы по скорости', `openTips(${INST}); await s(2000)`],
  [
    'проверка сборки перед запуском',
    `healthDialog(${INST}, { missing: [{ id: 'fabric-api', need: '*', by: 'Sodium' }, { id: 'sodium', wrongVersion: true, have: '0.4', need: '>=0.5', by: 'Iris' }], conflicts: [{ by: 'A', other: 'B', hard: true, file: 'b.jar', byFile: 'a.jar' }], duplicates: [{ name: 'Lithium', files: ['l1.jar', 'l2.jar'] }] }); await s(700)`,
  ],
  ['видеокарта', `gpuDialog({ integrated: 'AMD Radeon', discrete: 'NVIDIA RTX' }); await s(600)`],
  ['окно вылета', `showCrash((${INST}).id, { reason: 'Не хватает памяти', hints: ['Дай игре больше памяти', 'Убери лишние моды'], fix: { type: 'settings' } }); await s(700)`],
  ['окно вылета с изменениями с удачного запуска', `showCrash((${INST}).id, { reason: 'Игра закрылась с ошибкой (код 1).', hints: ['Подробности — во вкладке «Консоль».'], sinceGood: ${JSON.stringify(SINCE_GOOD)} }); await s(700)`],
  ['войти к другу', `openJoinModal(); await s(600)`],
  ['итоги игры (настоящий ответ: журнал пуст)', `openRecap(); await s(900)`],
  [
    'войти к другу: сверка со всеми списками',
    `${JOIN_STUB}
      try { answer = { address: 'pink-cat.e4mc.link', plan: planFor(inst), problem: null }; openJoinModal(inst); await s(450); await paste('Заходи: pink-cat.e4mc.link\\nКод сборки: FLM1:5:AAAAA'); } finally { window.call = o2; state.gpu = prevGpu; }`,
  ],
  ['вход Ely.by', `openElyLogin(); await s(600)`],
  ['точки восстановления', `openRestorePoints((${INST}).id); await s(1500)`],
  [
    'точки восстановления с закреплённым удачным запуском',
    `const o2 = window.call; window.call = async (ch, ...a) => (ch === 'snapshots:list' ? [{ id: '20260101-100000-aaaa', time: Date.now(), reason: 'Последний удачный запуск', kind: 'good', auto: false, mods: 3, diff: { added: 1, removed: 0, changed: 0 } }] : o2(ch, ...a)); try { openRestorePoints((${INST}).id); await s(900) } finally { window.call = o2 }`,
  ],
  ['перенос на версию', `openMigrate((${INST}).id); await s(2500)`],
  ['оптимизация', `openOptimize((${INST}).id); await s(2000)`],
  ['проверка связи', `openNetCheck(); await s(2500)`],
  ['отправка лога (согласие)', `shareLog('console'); await s(700)`],
];

// Остальное: функции без окон. Результат должен быть «истинным» (не false, не null, не ошибка)
function extra(version) {
  return [
    ['плашка обновления «готово»', `update = { state: 'ready', version: '9.9.9', current: '${version}' }; renderUpdate(); const p = document.querySelector('#updatePill'); const r = { hidden: p.hidden, text: p.textContent }; update = {}; renderUpdate(); return r`],
    // Заметки о новой версии (из latest.yml): первый щелчок по плашке показывает «Что нового», а обновляет второй или кнопка в окне; без заметок — сразу, как раньше
    [
      'плашка обновления: заметки о версии показываются один раз перед обновлением',
      `const o2 = window.call; const calls = []; const res = {};
        window.call = async (ch, ...a) => (ch === 'update:install' || ch === 'update:download' ? (calls.push(ch), true) : o2(ch, ...a));
        const md = UpdateNotes.render({ ru: [['🌸', 'Новая штука', 'делает вот что'], ['🐾', 'Ещё одна', 'и это']], en: [['🌸', 'A new thing', 'does this']] });
        const open = () => document.querySelector('#modal').classList.contains('open');
        const set = (state, ver, notes) => { calls.length = 0; update = { state, version: ver, current: '${version}', notes }; renderUpdate(); };
        const pill = document.querySelector('#updatePill');
        try {
          set('ready', '9.9.9', md); pill.click(); await s(500);
          const t = document.querySelector('#modalBox').innerText;
          res.shown = t.includes('Что нового') && t.includes('9.9.9') && t.includes('Новая штука') && t.includes('Ещё одна') && t.includes('Перезапустить и обновить') && calls.length === 0;
          document.querySelector('#unLater').click(); await s(300);
          res.later = !open() && calls.length === 0;
          pill.click(); await s(400);
          res.second = calls.join() === 'update:install' && !open();
          set('ready', '9.9.10', md); pill.click(); await s(400); document.querySelector('#unGo').click(); await s(500);
          res.go = calls.join() === 'update:install';
          set('available', '9.9.11', md); pill.click(); await s(400);
          res.portable = document.querySelector('#unGo').textContent === 'Скачать'; document.querySelector('#unGo').click(); await s(500);
          res.download = calls.join() === 'update:download';
          set('ready', '9.9.12', null); pill.click(); await s(400);
          res.plain = calls.join() === 'update:install' && !open();
          set('ready', '9.9.13', 'просто текст без пунктов'); pill.click(); await s(400);
          res.junk = calls.join() === 'update:install' && !open();
          return Object.values(res).every(Boolean) ? true : 'EXC ' + JSON.stringify(res);
        } finally { window.call = o2; update = {}; renderUpdate(); document.querySelector('#modalBox').isDirty = null; closeModal(); }`,
    ],
    ['оверлей перетаскивания', `showDrop(); await s(300); const r = document.body.innerHTML.includes('drop'); hideDrop(); return r`],
    ['консоль', `log('проверка консоли', 'info'); log('ошибка для проверки', 'err'); await s(400); showPage('console'); await s(500); const r = consoleEl.innerText; showPage('instances'); return r.includes('проверка консоли') && r.includes('ошибка для проверки')`],
    ['ход запуска', `setProgress('Проверка', 40); await s(300); const a = !!document.querySelector('#pbCancel'); hideProgress(); return a`],
    ['достижения', `renderAchievements(); announceAchievements(); return 1`],
    ['синхронизация и железо', `renderSync(); await renderHardware(); return 1`],
    // «Восстановить облако с этого компьютера»: имя сборки и «Корзина» в подтверждении, отмена ничего не вызывает, при запущенной игре
    // подтверждение недоступно, успех — тост после ответа, ошибка — красный тост без успеха. Сам publishLocal подменён: облака в профиле нет
    ['восстановление облака: подтверждение, отмена, запрет при игре, успех и ошибка', `
      const o2 = window.call; const calls = []; let mode = 'ok';
      window.call = async (ch, ...a) => { if (ch === 'sync:publishLocal') { calls.push(a[0]); if (mode === 'err') throw new Error('EPERM: operation not permitted, rename'); return { name: instById(a[0]).name, conflicts: [], warnings: [], all: { errors: [], conflicts: [], warnings: [] } }; } return o2(ch, ...a); };
      const q = (x) => document.querySelector(x);
      const toastTexts = () => [...document.querySelectorAll('#toasts .toast')].map((t) => t.innerText);
      const inst = ${INST};
      const open = async () => { closeModal(); await s(300); restoreCloudDialog(); await s(350); q('#srInst').value = inst.id; q('#srInst').dispatchEvent(new Event('change')); };
      try {
        await open();
        const text = q('#srText').textContent;
        const named = text.includes('«' + inst.name + '»') && text.includes('«Корзина»') && q('#srInst').options.length === state.instances.length;
        q('#srNo').click(); await s(300);
        const cancelled = !q('#modal').classList.contains('open') && calls.length === 0;
        state.running.add(inst.id); await open();
        const blocked = q('#srYes').disabled && !q('#srBusy').hidden && q('#srBusy').textContent.includes(inst.name);
        q('#srYes').click(); await s(200);
        const blockedCalls = calls.length;
        state.running.delete(inst.id);
        let before = toastTexts().length; await open(); q('#srYes').click(); await s(700);
        const okToast = toastTexts().slice(before).some((t) => t.includes('Облако восстановлено с этого компьютера: «' + inst.name + '»'));
        mode = 'err'; before = toastTexts().length; await open(); q('#srYes').click(); await s(700);
        const after = toastTexts().slice(before);
        const errOk = after.some((t) => t.includes('EPERM')) && !after.some((t) => t.includes('Облако восстановлено'));
        const r = { named, cancelled, blocked, blockedCalls, okToast, errOk, calls: calls.length };
        return named && cancelled && blocked && blockedCalls === 0 && okToast && errOk && calls.length === 2 ? r : 'EXC ' + JSON.stringify(r);
      } finally { window.call = o2; state.running.delete(inst.id); closeModal(); await s(300); }`],
    ['место на диске', `showPage('settings'); await scanStorage(); await s(1500); showPage('instances'); return 1`],
    ['страницы по кругу', `for (const p of ['mods', 'accounts', 'settings', 'console', 'instances']) { showPage(p); await s(500); } return document.body.dataset.page`],
    [
      'отчёт для поддержки (заглушка вместо Проводника)',
      `window.__rb = 0; const o2 = window.call; window.call = async (ch, ...a) => (ch === 'report:build' ? (window.__rb++, { size: 2048 }) : o2(ch, ...a)); buildReport(document.querySelector('#reportBuild')); await s(700); const t = document.querySelector('#toasts').innerText; window.call = o2; return window.__rb === 1 && t.includes('Отчёт готов')`,
    ],
    ['Ctrl+K открывает палитру, Esc закрывает', `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true, bubbles: true })); await s(700); const opened = !document.querySelector('#palette').hidden; const items = document.querySelectorAll('#palList .pal-item').length; document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })); await s(300); return opened && items > 3 && document.querySelector('#palette').hidden`],
    [
      '«Проверить» в «Играть с другом»: окно, отчёт, назад',
      withFriendCheck(`openFriendModal(${INST}); await s(400); document.querySelector('#frCheck').click(); await s(900);
        const t = document.querySelector('#modalBox').innerText;
        const colors = ['ok', 'warn', 'bad'].map((c) => document.querySelectorAll('#fcList .nc-row.' + c).length).join();
        const ready = !document.querySelector('#fcAgain').disabled && !document.querySelector('#fcCopy').disabled;
        document.querySelector('#fcCopy').click(); await s(300);
        const copied = window.__copied || '';
        document.querySelector('#fcBack').click(); await s(400);
        const back = !!document.querySelector('#frCheck');
        closeModal();
        return t.includes('Проверка игры с другом') && t.includes('Должно получиться') && colors === '3,1,1' && ready && back && copied.includes('✓ Мод e4mc') && copied.includes('✗ Связь с ретранслятором (UDP)') && copied.includes('Должно получиться')`),
    ],
    // Белый список живёт один мир: окно адреса показывает то, что на самом деле записано, а не то, что когда-то вписали в окно «Играть с другом»
    [
      'окно адреса: белый список — то, что записано в файле на самом деле',
      `const id = (${INST}).id; const prev = state.settings.clearWhitelist; const prevFriends = state.friends;
        const F = (nick, offline, on = true) => ({ nick, offline, uuid: null, on });
        const show = async (friends, wl) => {
          state.friends = friends; closeModal(); await s(250);
          showFriendShare({ id, address: 'test-world.e4mc.link', whitelist: wl }); await s(500);
          const t = document.querySelector('#modalBox').innerText; document.querySelector('#modalBox').isDirty = null; closeModal(); await s(250); return t;
        };
        try {
          const listed = await show([F('PinkDick', true)], ['PinkDick']);
          const emptyOffline = await show([F('PinkDick', true)], []);
          const emptyOnline = await show([F('PinkCat_', false), F('Other_One', false, false)], []);
          state.settings.clearWhitelist = false;
          const keep = await show([], []);
          return listed.includes('Белый список записан: PinkDick') && !listed.includes('/whitelist add') && listed.includes('список очистится')
            && emptyOffline.includes('Белый список пуст') && emptyOffline.includes('/whitelist reload') && !emptyOffline.includes('/whitelist add')
            && emptyOnline.includes('/whitelist add PinkCat_') && emptyOnline.includes('/whitelist on') && !emptyOnline.includes('Other_One')
            && !keep.includes('список очистится') && keep.includes('Адрес работает, пока ты в этом мире');
        } finally { state.friends = prevFriends; state.settings.clearWhitelist = prev; document.querySelector('#modalBox').isDirty = null; closeModal(); }`,
    ],
    // Кто из друзей сейчас в мире: строка в окне с адресом обновляется по событию главного процесса и помнится, пока окно закрыто
    [
      'окно адреса: строка «Сейчас в мире» следит за друзьями',
      `const id = (${INST}).id; const line = () => document.querySelector('#shGuests')?.innerText || '';
        const open = async () => { closeModal(); await s(250); showFriendShare({ id, address: 'test-world.e4mc.link', whitelist: [] }); await s(500); };
        const res = {};
        try {
          state.guests = {}; await open();
          res.empty = line() === 'Пока никто не зашёл';
          onGuests({ id, guests: ['PinkDick', 'Sleepy_Cat'] });
          res.two = line() === 'Сейчас в мире: PinkDick, Sleepy_Cat';
          onGuests({ id: 'другая-сборка', guests: ['Stranger_X'] });
          res.other = line() === 'Сейчас в мире: PinkDick, Sleepy_Cat' && state.guests['другая-сборка'].join() === 'Stranger_X';
          onGuests({ id, guests: ['Sleepy_Cat'] });
          res.left = line() === 'Сейчас в мире: Sleepy_Cat';
          document.querySelector('#modalBox').isDirty = null; closeModal(); await s(250);
          onGuests({ id, guests: ['Alex_Prem'] }); await open();
          res.remembered = line() === 'Сейчас в мире: Alex_Prem';
          onGuests({ id, guests: [] });
          res.gone = line() === 'Пока никто не зашёл';
          onGuests({ id, guests: null });
          res.junk = state.guests[id].length === 0 && line() === 'Пока никто не зашёл';
          return Object.values(res).every(Boolean) ? true : 'EXC ' + JSON.stringify(res);
        } finally { state.guests = {}; document.querySelector('#modalBox').isDirty = null; closeModal(); }`,
    ],
    // Прямые адреса для входа по сети и VPN: под адресом e4mc в окне с адресом и отдельным окном «Мир открыт по сети» (когда e4mc не вышел)
    [
      'окно адреса и «Мир открыт по сети»: прямые адреса для входа и кнопки «Скопировать»',
      `const id = (${INST}).id; const o2 = window.call; window.__copied = [];
        window.call = async (ch, ...a) => (ch === 'app:copyText' ? (window.__copied.push(a[0]), true) : o2(ch, ...a));
        const lan = [{ kind: 'lan', name: 'Wi-Fi', host: '192.168.1.5', address: '192.168.1.5:61223' }, { kind: 'vpn', name: 'Radmin VPN', host: '26.1.2.3', address: '26.1.2.3:61223' }, { kind: 'ipv6', name: 'Ethernet', host: '2a02::1', address: '[2a02::1]:61223' }];
        const res = {}; const txt = () => document.querySelector('#modalBox').innerText;
        const close = async () => { document.querySelector('#modalBox').isDirty = null; closeModal(); await s(250); };
        try {
          await close(); showFriendShare({ id, address: 'test-world.e4mc.link', whitelist: [], lan }); await s(600);
          res.share = txt().includes('Не заходит по адресу e4mc?') && txt().includes('192.168.1.5:61223') && txt().includes('26.1.2.3:61223') && txt().includes('[2a02::1]:61223') && txt().includes('Radmin VPN') && txt().includes('IPv6');
          const copies = [...document.querySelectorAll('#modalBox [data-copy]')];
          res.buttons = copies.filter((b) => b.dataset.copy.includes('61223')).length === 3;
          window.__copied.length = 0; copies.find((b) => b.dataset.copy === '26.1.2.3:61223').click(); await s(300);
          res.copied = window.__copied.join() === '26.1.2.3:61223';
          await close(); showFriendShare({ id, address: 'test-world.e4mc.link', whitelist: [] }); await s(500);
          res.none = !txt().includes('Не заходит по адресу e4mc?');
          await close(); showFriendShare({ id, address: 'test-world.e4mc.link', whitelist: [], lan: [] }); await s(500);
          res.empty = !txt().includes('Не заходит по адресу e4mc?');
          await close(); showLanAddresses({ id, port: 61223, addresses: lan }); await s(600);
          res.window = txt().includes('Мир открыт по сети') && txt().includes('Адрес e4mc сейчас недоступен') && txt().includes('192.168.1.5:61223') && !txt().includes('Мир открыт для друга');
          window.__copied.length = 0; document.querySelector('#modalBox [data-copy="192.168.1.5:61223"]').click(); await s(300);
          res.copied2 = window.__copied.join() === '192.168.1.5:61223';
          document.querySelector('#lnOk').click(); await s(400);
          res.closed = !document.querySelector('#modal').classList.contains('open');
          showLanAddresses({ id, port: 1, addresses: [] }); await s(300);
          res.noWindow = !document.querySelector('#modal').classList.contains('open');
          openFriendModal(${INST}); await s(500); showLanAddresses({ id, port: 61223, addresses: lan }); await s(300);
          res.noOver = !txt().includes('Мир открыт по сети') && txt().includes('Играть с другом');
          return Object.values(res).every(Boolean) ? true : 'EXC ' + JSON.stringify(res);
        } finally { window.call = o2; document.querySelector('#modalBox').isDirty = null; closeModal(); }`,
    ],
    // Отмеченных друзей белый список записывает только «Играть ♡» из окна «Играть с другом»; обычная кнопка «Играть» ничего не просит записать
    [
      '«Играть ♡» просит записать друзей, а обычная «Играть» — нет',
      `const van = state.instances.find((x) => x.loader === 'vanilla'); const id = van.id; const o2 = window.call; const prevGpu = state.gpu; state.gpu = null; window.__launches = [];
        window.call = async (ch, ...a) => (ch === 'game:launch' ? (window.__launches.push(a), true) : o2(ch, ...a));
        localStorage.setItem('friendsMigrated', '1');
        try {
          selectInstance(id); await play(); await s(300);
          openFriendModal(van); await s(500); document.querySelector('#frPlay').click(); await s(800);
          const [plain, friends] = window.__launches;
          return window.__launches.length === 2 && plain[0] === id && plain[1].friends === false && friends[0] === id && friends[1].friends === true;
        } finally { window.call = o2; state.gpu = prevGpu; selectInstance((${INST}).id); }`,
    ],
    // Список друзей по-настоящему (временный профиль, настоящие IPC; друзья «без лицензии», чтобы не ходить в Mojang): добавить, отметить, убрать
    [
      'список друзей: добавить, отметить галочкой, убрать',
      `const res = {}; localStorage.setItem('friendsMigrated', '1');
        const add = async (nick, offline) => { const i = document.querySelector('#frNick'); i.value = nick; document.querySelector('#frOffline').checked = offline; document.querySelector('#frAdd').click(); await s(800); };
        try {
          openFriendModal(${INST}); await s(700);
          res.empty = document.querySelector('#frList').innerText.includes('пуст');
          await add('PinkDick', true);
          const row = document.querySelector('#frList .fr-row');
          res.added = state.friends.length === 1 && row.innerText.includes('PinkDick') && row.innerText.includes('без лицензии') && row.querySelector('input').checked && document.querySelector('#frNick').value === '';
          res.hints = !document.querySelector('#frOfflineHint').hidden && !document.querySelector('#frWlHint').hidden;
          const i2 = document.querySelector('#frNick'); i2.value = 'Sleepy_Cat'; document.querySelector('#frOffline').checked = true;
          i2.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await s(800);
          res.enter = state.friends.length === 2;
          document.querySelectorAll('#frList .fr-row')[1].querySelector('input').click(); await s(600);
          const saved = await call('friends:list');
          res.untick = state.friends[1].on === false && saved[1].on === false && saved[0].on === true && tickedFriends().length === 1 && friendNicks().join() === 'PinkDick';
          await add('ab', false); res.bad = state.friends.length === 2;
          await add('pinkdick', true); res.dup = state.friends.length === 2 && document.querySelector('#toasts').innerText.includes('уже есть');
          document.querySelectorAll('#frList .fr-row')[1].querySelector('.fr-del').click(); await s(600);
          res.removed = state.friends.length === 1 && (await call('friends:list')).length === 1;
          // Пометка «с лицензией» → «без лицензии» по нажатию (обратно она идёт в Mojang, в проверке сети нет): друг с лицензией заводится переносом старых ников
          await call('friends:import', [{ nick: 'Licensed_One', offline: false, on: false }]); await refresh();
          document.querySelector('#modalBox').isDirty = null; closeModal(); await s(300); openFriendModal(${INST}); await s(700);
          const lic = () => [...document.querySelectorAll('#frList .fr-row')].find((r) => r.dataset.nick === 'Licensed_One');
          res.licensed = !!lic() && lic().innerText.includes('с лицензией') && !lic().innerText.includes('без лицензии');
          lic().querySelector('.fr-lic').click(); await s(700);
          res.flag = state.friends.find((f) => f.nick === 'Licensed_One').offline === true && lic().innerText.includes('без лицензии') && (await call('friends:list')).find((f) => f.nick === 'Licensed_One').offline === true;
          return Object.values(res).every(Boolean) ? true : 'EXC ' + JSON.stringify(res);
        } finally { for (const f of await call('friends:list')) await call('friends:remove', f.nick); await refresh(); document.querySelector('#modalBox').isDirty = null; closeModal(); }`,
    ],
    // Старые ники, которые помнила каждая сборка отдельно, переносятся в общий список один раз
    [
      'список друзей: старые ники сборок переносятся один раз',
      `const id = (${INST}).id; const other = state.instances.find((x) => x.id !== id).id; const res = {};
        try {
          localStorage.removeItem('friendsMigrated');
          localStorage.setItem('friend:' + id, JSON.stringify({ nicks: ['Legacy_One', 'Legacy_Two'], offline: true }));
          localStorage.setItem('friend:' + other, JSON.stringify({ nick: 'Other_Nick Another_Old', offline: false })); // так хранилось раньше: один ник строкой
          openFriendModal(${INST}); await s(900);
          const by = Object.fromEntries(state.friends.map((f) => [f.nick, f]));
          res.merged = Object.keys(by).sort().join() === 'Another_Old,Legacy_One,Legacy_Two,Other_Nick';
          res.ticks = by.Legacy_One.on && by.Legacy_Two.on && !by.Other_Nick.on && !by.Another_Old.on;
          res.offline = by.Legacy_One.offline && by.Legacy_Two.offline && !by.Other_Nick.offline;
          res.flag = localStorage.getItem('friendsMigrated') === '1';
          res.rows = document.querySelectorAll('#frList .fr-row').length === 4;
          for (const f of await call('friends:list')) await call('friends:remove', f.nick);
          await refresh(); document.querySelector('#modalBox').isDirty = null; closeModal(); await s(300);
          openFriendModal(${INST}); await s(700);
          res.once = state.friends.length === 0;
          return Object.values(res).every(Boolean) ? true : 'EXC ' + JSON.stringify(res);
        } finally { localStorage.removeItem('friend:' + id); localStorage.removeItem('friend:' + other); localStorage.setItem('friendsMigrated', '1'); for (const f of await call('friends:list')) await call('friends:remove', f.nick); await refresh(); document.querySelector('#modalBox').isDirty = null; closeModal(); }`,
    ],
    [
      'настройка «Передавать игре прокси лаунчера»: включена по умолчанию, переключается и запоминается',
      `showPage('settings'); await s(500); const box = document.querySelector('#gameProxy'); const before = box.checked;
        box.click(); await s(600); const off = state.settings.gameProxy === false && !box.checked;
        box.click(); await s(600); const on = state.settings.gameProxy === true && box.checked;
        showPage('instances'); return before && off && on`,
    ],
    [
      'настройка «Копия мира перед открытием для друзей»: включена по умолчанию, переключается и запоминается',
      `showPage('settings'); await s(500); const box = document.querySelector('#backupBeforeFriends'); const before = box.checked;
        box.click(); await s(600); const off = state.settings.backupBeforeFriends === false && !box.checked;
        box.click(); await s(600); const on = state.settings.backupBeforeFriends === true && box.checked;
        showPage('instances'); return before && off && on`,
    ],
    // «Место и переезд» → место на диске: старые логи игры из общей папки — своя строка (заглушка ответа: на временном профиле таких логов нет) и пояснение
    [
      'место на диске: строка «Старые логи игры» и пояснение к ней',
      `const o2 = window.call; let withLogs = true;
        const answer = () => ({ instancesSize: 5 * 1048576, categories: [{ id: 'libraries', name: 'Библиотеки', total: 1048576, free: 0, count: 0 }, ...(withLogs ? [{ id: 'logs', name: 'Старые логи игры', total: 2048, free: 2048, count: 3 }] : [])] });
        window.call = async (ch, ...a) => (ch === 'storage:scan' ? answer() : o2(ch, ...a));
        try {
          showPage('settings'); await s(400); await scanStorage(); await s(300);
          const row = [...document.querySelectorAll('#storageBody .storage-row')].find((r) => r.innerText.includes('Старые логи игры'));
          const res = { row: !!row && row.querySelector('input').checked && !row.querySelector('input').disabled && row.innerText.includes('можно убрать'), hint: document.querySelector('#storageBody').innerText.includes('Старые логи игры остались от тех версий лаунчера') };
          withLogs = false; await scanStorage(); await s(300);
          const t = document.querySelector('#storageBody').innerText;
          res.none = !t.includes('Старые логи игры') && !t.includes('остались от тех версий');
          return Object.values(res).every(Boolean) ? true : 'EXC ' + JSON.stringify(res);
        } finally { window.call = o2; showPage('instances'); }`,
    ],
    [
      'настройка «Очищать белый список»: включена по умолчанию, переключается и запоминается',
      `showPage('settings'); await s(500); const box = document.querySelector('#clearWhitelist'); const before = box.checked;
        box.click(); await s(600); const off = state.settings.clearWhitelist === false && !box.checked;
        box.click(); await s(600); const on = state.settings.clearWhitelist === true && box.checked;
        showPage('instances'); return before && off && on`,
    ],
    // Корзина сборок по-настоящему (временный профиль, настоящие IPC): удалить → вернуть → удалить навсегда (с вторым кликом) → очистить
    [
      'корзина: удалить, вернуть, удалить навсегда, очистить',
      `const mk = async (name) => { const i = await call('instances:create', { name, version: '1.21.1', loader: 'vanilla' }); await refresh(); return i; };
        const clickDelete = async (id) => { confirmDelete(instById(id)); await s(400); document.querySelector('#dYes').click(); await s(1000); };
        const res = {};
        const a = await mk('Корзинка А');
        await clickDelete(a.id);
        res.deleted = !instById(a.id) && state.trash.some((t) => t.id === a.id) && !document.querySelector('#trashBtn').hidden && document.querySelector('#trashCount').textContent === '1';
        openTrash(); await s(700);
        res.listed = document.querySelector('#trList').innerText.includes('Корзинка А');
        document.querySelector('#trList [data-tr="restore"]').click(); await s(1100);
        res.restored = !!instById(a.id) && state.trash.length === 0 && document.querySelector('#trashBtn').hidden && document.querySelector('#trList').innerText.includes('пусто');
        document.querySelector('#modalBox').isDirty = null; closeModal(); await s(300);
        await clickDelete(a.id);
        openTrash(); await s(700);
        const purge = document.querySelector('#trList [data-tr="purge"]');
        purge.click(); await s(300);
        res.askedTwice = state.trash.length === 1 && purge.textContent.includes('Точно');
        purge.click(); await s(1100);
        res.purged = state.trash.length === 0 && !instById(a.id) && document.querySelector('#trList').innerText.includes('пусто');
        document.querySelector('#modalBox').isDirty = null; closeModal(); await s(300);
        const b = await mk('Корзинка Б'); const c = await mk('Корзинка В');
        await clickDelete(b.id); await clickDelete(c.id);
        openTrash(); await s(700);
        res.two = state.trash.length === 2;
        const empty = document.querySelector('#trEmpty'); empty.click(); await s(300);
        res.emptyAsks = state.trash.length === 2 && empty.textContent.includes('Точно');
        empty.click(); await s(1300);
        res.emptied = state.trash.length === 0 && !instById(b.id) && !instById(c.id);
        document.querySelector('#modalBox').isDirty = null; closeModal(); await s(300);
        return Object.values(res).every(Boolean) ? true : 'EXC ' + JSON.stringify(res)`,
    ],
    // Копирование ника: кнопка у аккаунта (и она не превращается в «Удалить»), правый клик по профилю внизу и действие в Ctrl+K
    [
      'копирование ника: кнопка, правый клик по профилю и Ctrl+K',
      `const o2 = window.call; window.__copied = []; window.call = async (ch, ...a) => (ch === 'app:copyText' ? (window.__copied.push(a[0]), true) : o2(ch, ...a));
        const before = state.accounts.length; const nick = activeAccount().name;
        try {
          showPage('accounts'); await s(500);
          document.querySelector('#accList [data-act="copy"]').click(); await s(400);
          const toastText = document.querySelector('#toasts').innerText;
          showPage('instances'); await s(300);
          document.querySelector('#meCard').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); await s(400);
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true, bubbles: true })); await s(500);
          const input = document.querySelector('#palInput'); input.value = 'скопировать ник'; input.dispatchEvent(new Event('input')); await s(300);
          const item = [...document.querySelectorAll('#palList .pal-item')].find((x) => x.innerText.includes('Скопировать мой ник'));
          if (item) item.click(); await s(500);
          return !!item && window.__copied.length === 3 && window.__copied.every((x) => x === nick) && toastText.includes('скопирован') && state.accounts.length === before;
        } finally { window.call = o2; document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })); }`,
    ],
    // Поиск по консоли: строки без искомого прячутся (регистр не важен), «только ошибки» оставляет красные, новые строки подчиняются фильтру
    [
      'консоль: поиск по строкам и «только ошибки»',
      `const res = {}; const find = document.querySelector('#logFind'); const errs = document.querySelector('#logErrors'); const count = document.querySelector('#logCount');
        const vis = () => [...consoleEl.children].filter((d) => getComputedStyle(d).display !== 'none').map((d) => d.textContent);
        const setFind = async (v) => { find.value = v; find.dispatchEvent(new Event('input', { bubbles: true })); await s(150); };
        try {
          consoleEl.innerHTML = ''; showPage('console'); await s(300);
          log('Первая строка про Alpha', 'info'); log('вторая строка про beta', 'game'); log('[Render thread/ERROR]: Beta сломалась', 'game'); log('отладочная alpha', 'debug'); await s(500);
          res.all = vis().length === 4 && count.hidden;
          await setFind('alpha'); res.alpha = vis().length === 2 && vis().every((t) => /alpha/i.test(t)) && !count.hidden && count.innerText === 'Найдено: 2 из 4';
          await setFind('   '); res.blank = vis().length === 4 && count.hidden;
          await setFind('нет такого'); res.none = vis().length === 0 && count.innerText === 'Найдено: 0 из 4';
          await setFind('');
          errs.click(); await s(150); res.errors = vis().length === 1 && vis()[0].includes('сломалась') && count.innerText === 'Найдено: 1 из 4';
          await setFind('beta'); res.both = vis().length === 1;
          await setFind('alpha'); res.bothNone = vis().length === 0;
          errs.click(); await s(150); await setFind('');
          res.back = vis().length === 4 && count.hidden;
          // Галочка «отладка» снята: спрятанные ею строки в «Найдено» не входят
          const dbg = document.querySelector('#logDebug'); dbg.click(); await setFind('alpha');
          res.debugOff = vis().length === 1 && count.innerText === 'Найдено: 1 из 3';
          dbg.click(); await s(150);
          await setFind('alpha'); log('ещё одна alpha', 'info'); log('чужая строка', 'info'); await s(500);
          res.live = vis().length === 3 && vis().every((t) => /alpha/i.test(t)) && count.innerText === 'Найдено: 3 из 6';
          document.querySelector('#logClear').click(); await s(150);
          res.cleared = consoleEl.childElementCount === 0 && (count.hidden || count.innerText === 'Найдено: 0 из 0');
          return Object.values(res).every(Boolean) ? true : 'EXC ' + JSON.stringify(res);
        } finally { errs.checked = false; await setFind(''); consoleEl.innerHTML = ''; showPage('instances'); }`,
    ],
    // «Ещё» → «Лог игры» и «Папка логов»: просят у главного процесса открыть именно то, что нужно (заглушка: настоящие окна не открываем); у сборки без логов — понятное сообщение
    [
      'вкладка «Ещё»: кнопки «Лог игры» и «Папка логов»',
      `const o2 = window.call; window.__logs = []; const id = (${INST}).id;
        window.call = async (ch, ...a) => (ch === 'instances:openLog' ? (window.__logs.push(a), true) : o2(ch, ...a));
        const res = {};
        try {
          openDetails(${INST}, 'more'); await s(800);
          const a = document.querySelector('[data-m="gamelog"]'); const b = document.querySelector('[data-m="logsdir"]');
          res.buttons = !!a && !!b;
          if (a && b) { a.click(); await s(200); b.click(); await s(200); }
          res.calls = window.__logs.length === 2 && window.__logs[0].join() === id + ',latest' && window.__logs[1].join() === id + ',folder';
          window.call = o2;
          // Новая сборка: игра с ней не запускалась, логов нет, так что главный процесс ничего не откроет, а скажет об этом
          const fresh = await call('instances:create', { name: 'Без логов', version: '1.21.1', loader: 'vanilla' }); await refresh();
          const say1 = await call('instances:openLog', fresh.id, 'latest').then(() => 'открыл', (e) => e.message);
          const say2 = await call('instances:openLog', fresh.id, 'folder').then(() => 'открыл', (e) => e.message);
          const say3 = await call('instances:openLog', fresh.id, 'что-то-ещё').then(() => 'открыл', (e) => e.message);
          res.nolog = say1.includes('Лога этой сборки ещё нет') && say2.includes('Папки логов этой сборки ещё нет') && say3.includes('Неизвестно, что открыть');
          await call('instances:remove', fresh.id); await call('instances:trashPurge', fresh.id); await refresh();
          return Object.values(res).every(Boolean) ? true : 'EXC ' + JSON.stringify(res);
        } finally { window.call = o2; document.querySelector('#modalBox').isDirty = null; closeModal(); }`,
    ],
    // «Время в игре» в разделе «Котик и награды»: пусто (настоящий IPC, на временном профиле игр не было), неделя столбиками, сборки полосками
    [
      'время в игре: пусто, неделя по дням, сборки за 30 дней',
      `const res = {}; const body = () => document.querySelector('#psBody'); const H = 3600e3;
        const day0 = new Date(); day0.setHours(0, 0, 0, 0);
        const week = [...Array(7)].map((_, i) => { const d = new Date(day0); d.setDate(d.getDate() - (6 - i)); return { at: d.getTime(), ms: [1, 0, 2, 0, 0.5, 4, 1.5][i] * H }; });
        const bars = () => [...document.querySelectorAll('#psBody .ps-row .ps-bar i')].map((i) => i.style.width);
        try {
          showPage('settings'); showSection('kitty'); await s(700);
          res.empty = body().innerText.includes('Пока нет данных') && document.querySelector('#psSince').textContent === '';
          renderPlayStats({ since: Date.now() - 5 * 86400e3, sessions: 4, total: 9 * H, longest: 3 * H, week, weekTotal: 9 * H, byInstance: [{ id: 'a', name: 'Первая сборка', ms: 6 * H }, { id: 'b', name: null, ms: 3 * H }] });
          const days = [...document.querySelectorAll('#psBody .ps-day')];
          res.week = days.length === 7 && days.filter((d) => d.classList.contains('today')).length === 1 && days[6].classList.contains('today');
          res.heights = days[5].querySelector('i').style.height === '100%' && days[1].querySelector('i').style.height === '0%' && days[0].querySelector('i').style.height === '25%' && days[2].querySelector('i').style.height === '50%';
          res.sum = body().innerText.includes('9 ч 0 мин за неделю') && body().innerText.includes('всего 9 ч 0 мин') && body().innerText.includes('самая долгая игра 3 ч 0 мин');
          res.rows = [...document.querySelectorAll('#psBody .ps-row')].map((r) => r.innerText.replace(/\\s+/g, ' ')).join('|') === 'Первая сборка 6 ч 0 мин|Удалённая сборка 3 ч 0 мин';
          res.bars = bars().join() === '100%,50%';
          res.since = document.querySelector('#psSince').textContent.startsWith('считаю с ');
          renderPlayStats({ since: Date.now(), sessions: 1, total: H, longest: H, week, weekTotal: H, byInstance: [] });
          res.noTop = !body().innerText.includes('Сборки за 30 дней');
          return Object.values(res).every(Boolean) ? true : 'EXC ' + JSON.stringify(res);
        } finally { showPage('instances'); }`,
    ],
    // Закрепление версии мода (настоящие IPC на временном профиле): кнопка 📌, метка «закреплён», замечания в окне обновлений и в сообщении «все свежие»
    [
      'моды: закрепить версию мода и открепить',
      `const o2 = window.call; const id = (${INST}).id; const res = {};
        const stub = (updates) => (window.call = async (ch, ...a) => (ch === 'mods:origins' ? {} : ch === 'mods:checkUpdates' ? updates : o2(ch, ...a)));
        const rows = () => [...document.querySelectorAll('#modList .mod-row')];
        const pinned = async () => (await call('mods:list', id, 'mod')).filter((m) => m.pinned).map((m) => m.file);
        try {
          stub([]); state.mods.inst = id; openBrowser('installed', 'mod'); await s(900);
          res.rows = rows().length === 3 && rows().every((r) => r.querySelector('[data-act="pin"]') && !r.innerText.includes('закреплён'));
          const file = rows()[0].dataset.file;
          const row = () => rows().find((r) => r.dataset.file === file);
          row().querySelector('[data-act="pin"]').click(); await s(700);
          res.pinned = (await pinned()).join() === file;
          res.chip = row().innerText.includes('закреплён') && row().querySelector('.pin').classList.contains('on') && rows().filter((r) => r.innerText.includes('закреплён')).length === 1;
          stub([{ file: 'x.jar', title: 'Мод X', from: '1.0', to: '2.0', icon: null }]);
          await checkModUpdates(); await s(500);
          res.note = document.querySelector('#modalBox').innerText.includes('Закреплённые моды не обновляются: 1') && document.querySelector('#modalBox').innerText.includes('нашлось обновлений: 1');
          document.querySelector('#modalBox').isDirty = null; closeModal(); await s(250);
          stub([]); await checkModUpdates(); await s(400);
          res.fresh = document.querySelector('#toasts').innerText.includes('Все остальные моды свежие ♡ Закреплено, не проверялось: 1');
          row().querySelector('[data-act="pin"]').click(); await s(700);
          res.unpinned = (await pinned()).length === 0 && !row().innerText.includes('закреплён') && !row().querySelector('.pin').classList.contains('on');
          await checkModUpdates(); await s(400);
          res.freshAll = document.querySelector('#toasts').innerText.includes('Все моды свежие ♡');
          return Object.values(res).every(Boolean) ? true : 'EXC ' + JSON.stringify(res);
        } finally { window.call = o2; for (const f of await pinned()) await call('mods:pin', id, f, false); showPage('instances'); document.querySelector('#modalBox').isDirty = null; closeModal(); }`,
    ],
    // «Починить файлы игры»: кнопка просит у главного процесса починку своей сборки и показывает итог (заглушка: настоящая починка качает игру целиком)
    [
      'вкладка «Ещё»: «Починить файлы игры» и окно с итогом',
      `const o2 = window.call; const id = (${INST}).id; window.__repairs = [];
        const base = { version: '1.21.1', client: { fixed: false }, profile: { fixed: false }, loader: { name: null, state: 'vanilla' }, libraries: { checked: 87, fixed: 0 }, assets: { checked: 3812, fixed: 0 } };
        const reports = {
          fixed: { ...base, client: { fixed: true }, loader: { name: 'Fabric', state: 'fixed' }, libraries: { checked: 87, fixed: 1 }, assets: { checked: 3812, fixed: 2 } },
          fine: base,
          assetsOnly: { ...base, assets: { checked: 3812, fixed: 2 } },
          forge: { ...base, version: '1.20.1', loader: { name: 'Forge', state: 'at-launch' } },
        };
        let next = 'fixed';
        window.call = async (ch, ...a) => {
          if (ch !== 'instances:repair') return o2(ch, ...a);
          window.__repairs.push(a);
          if (next === 'error') throw new Error('Сначала закрой игру (или дождись, пока она запустится): пока она идёт, общие файлы игры заменить нельзя');
          return reports[next];
        };
        const res = {};
        const open = async () => { document.querySelector('#modalBox').isDirty = null; closeModal(); await s(250); openDetails(${INST}, 'more'); await s(800); };
        const press = async () => { document.querySelector('[data-m="repair"]').click(); await s(700); return document.querySelector('#modalBox').innerText; };
        const rows = (tone) => document.querySelectorAll('#modalBox .nc-row.' + tone).length;
        try {
          await open(); const t1 = await press();
          res.call = window.__repairs.length === 1 && window.__repairs[0].join() === id;
          res.fixedText = t1.includes('Файлы игры проверены') && t1.includes('Часть файлов пришлось скачать заново') && t1.includes('Клиент игры 1.21.1') && t1.includes('Fabric') && t1.includes('проверено 87, скачано заново: 1') && t1.includes('проверено 3812, скачано заново: 2');
          res.yellow = rows('warn') === 4 && rows('ok') === 1;
          next = 'fine'; await open(); const t2 = await press();
          res.fine = t2.includes('Всё в порядке: чинить ничего не пришлось') && rows('warn') === 0 && rows('ok') === 4 && !t2.includes('Fabric');
          next = 'assetsOnly'; await open(); const t2b = await press();
          res.assetsOnly = t2b.includes('Часть файлов пришлось скачать заново') && rows('warn') === 1 && rows('ok') === 3;
          next = 'forge'; await open(); const t3 = await press();
          res.forge = t3.includes('Forge') && t3.includes('здесь не проверяются') && t3.includes('Всё в порядке');
          next = 'error'; await open(); document.querySelector('[data-m="repair"]').click(); await s(600);
          const b = document.querySelector('[data-m="repair"]');
          res.error = document.querySelector('#toasts').innerText.includes('Сначала закрой игру') && !!b && !b.disabled && b.textContent.includes('Починить файлы игры');
          return Object.values(res).every(Boolean) ? true : 'EXC ' + JSON.stringify(res);
        } finally { window.call = o2; document.querySelector('#modalBox').isDirty = null; closeModal(); }`,
    ],
    // Список версий игры дозагрузился уже после того, как окно сборки закрыли и на его месте открыли другое: ошибок быть не должно
    // (раньше lvLoad обращался к полям закрытого окна; ловится итоговой проверкой «в странице нет необработанных исключений»)
    [
      'окно сборки закрыли до загрузки версий игры',
      `const o2 = window.call; const saved = state.versions; state.versions = null;
        window.call = async (ch, ...a) => { if (ch === 'versions:list') { await s(1200); return saved || o2(ch, ...a); } return o2(ch, ...a); };
        try {
          openInstanceModal(${INST}); await s(200);
          document.querySelector('#modalBox').isDirty = null; closeModal(); await s(300);
          openFriendModal(${INST}); await s(1500);
          return !!document.querySelector('#frCheck');
        } finally { window.call = o2; state.versions = saved; document.querySelector('#modalBox').isDirty = null; closeModal(); }`,
    ],
    // «Последний удачный запуск»: окно вылета называет, что изменилось с него, и откатывает одним щелчком (ответы главного процесса подставлены)
    [
      'окно вылета: что изменилось с удачного запуска и откат одним щелчком',
      `const id = (${INST}).id; const o2 = window.call; const calls = []; const res = {};
        const ok = { restored: { reason: 'Последний удачный запуск' }, before: {} };
        window.call = async (ch, ...a) => (ch === 'snapshots:restore' ? (calls.push(a), ok) : o2(ch, ...a));
        const sg = ${JSON.stringify(SINCE_GOOD)};
        const base = { reason: 'Мод несовместим', hints: ['Обнови моды'] };
        const open = async (crash) => { document.querySelector('#modalBox').isDirty = null; closeModal(); await s(250); showCrash(id, crash); await s(500); };
        const txt = () => document.querySelector('#modalBox').innerText;
        const open_ = () => document.querySelector('#modal').classList.contains('open');
        try {
          await open({ ...base, sinceGood: sg });
          const t = txt();
          res.head = t.includes('С последнего удачного запуска');
          res.lists = t.includes('Добавлено: sodium-extra-0.6.0.jar, iris-1.8.0.jar') && t.includes('Включено: lithium-0.14.0.jar') && t.includes('Изменено: ferritecore-7.0.0.jar') && t.includes('Выключено: modmenu-11.0.0.jar');
          res.more = t.includes('Убрано: a1.jar, a2.jar, a3.jar, a4.jar, a5.jar, a6.jar и ещё 2') && !t.includes('a7.jar');
          res.fields = t.includes('Minecraft: 1.21.1 → 1.21.4') && t.includes('Загрузчик: Ванилла → Fabric') && t.includes('Версия загрузчика: авто (последняя) → 0.16.9') && t.includes('Модпак: 1.0 → без модпака');
          res.main = document.querySelector('#crGood').classList.contains('primary') && !!document.querySelector('#crShare');
          document.querySelector('#crGood').click(); await s(700);
          res.call = calls.length === 1 && calls[0][0] === id && calls[0][1] === sg.id;
          res.closed = !open_();
          res.toast = document.querySelector('#toasts').innerText.includes('Вернула «Последний удачный запуск»');
          // есть готовое исправление (память): оно главное, откат рядом второстепенный
          await open({ ...base, fix: { type: 'settings' }, sinceGood: sg });
          res.second = document.querySelector('#crGood').classList.contains('soft') && document.querySelector('#crFix').classList.contains('primary');
          // моды и версии те же: так и сказано, виновников не выдумываем, кнопки отката нет
          await open({ ...base, sinceGood: { ...sg, any: false, mods: { added: [], enabled: [], changed: [], removed: [], disabled: [] }, instance: {} } });
          res.same = txt().includes('те же, что при последнем удачном запуске') && !document.querySelector('#crGood') && !txt().includes('Добавлено:');
          // удачного запуска ещё не было (или старый ответ без поля): окно такое же, как раньше
          await open({ ...base, sinceGood: null });
          res.first = !document.querySelector('#crGood') && !document.querySelector('.crash-since') && txt().includes('Мод несовместим');
          await open(base);
          res.old = !document.querySelector('#crGood') && !document.querySelector('.crash-since');
          // откат не получился: окно на месте, кнопка снова нажимается, причина в уведомлении
          window.call = async (ch, ...a) => (ch === 'snapshots:restore' ? Promise.reject(new Error('Сначала закрой игру: она держит моды открытыми')) : o2(ch, ...a));
          await open({ ...base, sinceGood: sg });
          document.querySelector('#crGood').click(); await s(500);
          const again = document.querySelector('#crGood');
          res.fail = !!again && !again.disabled && again.textContent.includes('Откатить') && open_() && document.querySelector('#toasts').innerText.includes('Сначала закрой игру');
          return Object.values(res).every(Boolean) ? true : 'EXC не сошлось: ' + Object.keys(res).filter((k) => !res[k]).join(',');
        } finally { window.call = o2; document.querySelector('#modalBox').isDirty = null; closeModal(); }`,
    ],
    // Список точек: «Последний удачный запуск» приходит первым, подсвечен и закреплён, возврат к нему идёт через ту же кнопку с вторым щелчком
    [
      'точки восстановления: закреплённый «последний удачный запуск»',
      `const id = (${INST}).id; const o2 = window.call; const calls = []; const res = {};
        const pt = (sid, reason, extra = {}) => ({ id: sid, time: Date.now() - 3600e3, reason, auto: true, mods: 3, configFiles: 1, diff: { added: 0, removed: 0, changed: 0 }, ...extra });
        const GOOD = pt('20260101-100000-aaaa', 'Последний удачный запуск', { kind: 'good', auto: false, diff: { added: 1, removed: 0, changed: 2 } });
        let list = [GOOD, pt('20260101-110000-bbbb', 'Перед обновлением модов')];
        window.call = async (ch, ...a) => (ch === 'snapshots:list' ? list : ch === 'snapshots:restore' ? (calls.push(a), { restored: { reason: 'Последний удачный запуск' }, before: {} }) : o2(ch, ...a));
        const txt = () => document.querySelector('#modalBox').innerText;
        try {
          openRestorePoints(id); await s(700);
          const rows = [...document.querySelectorAll('#rpList .rp-row')];
          res.order = rows.length === 2 && rows[0].classList.contains('pin') && !rows[1].classList.contains('pin');
          res.text = rows[0].innerText.includes('Последний удачный запуск') && rows[0].innerText.includes('📌') && rows[0].innerText.includes('с тех пор +1 ~2') && !rows[1].innerText.includes('📌');
          res.hint = !document.querySelector('#rpGood').hidden && txt().includes('закреплена сверху');
          const btn = rows[0].querySelector('[data-rp="restore"]');
          btn.click(); await s(150);
          res.sure = btn.textContent === 'Точно вернуть?' && calls.length === 0;
          btn.click(); await s(800);
          res.restored = calls.length === 1 && calls[0][0] === id && calls[0][1] === GOOD.id;
          list = [list[1]]; document.querySelector('#modalBox').isDirty = null; closeModal(); await s(250);
          openRestorePoints(id); await s(700);
          res.without = document.querySelector('#rpGood').hidden && !document.querySelector('#rpList .pin') && document.querySelectorAll('#rpList .rp-row').length === 1;
          return Object.values(res).every(Boolean) ? true : 'EXC не сошлось: ' + Object.keys(res).filter((k) => !res[k]).join(',');
        } finally { window.call = o2; document.querySelector('#modalBox').isDirty = null; closeModal(); }`,
    ],
    // «Войти к другу»: вставили сообщение — сверка идёт сама, адрес подставлен, списки по полочкам; поставить и зайти. Ответы главного процесса подставлены
    [
      'войти к другу: вставка, сверка, установка и вход (ответы подставлены)',
      `${JOIN_STUB}
        try {
          await open(inst);
          res.empty = txt().includes('Друг копирует код') && q('#jnInstall').disabled && q('#jnPlay').disabled && q('#jnInst').value === inst.id;
          answer = { address: 'pink-cat.e4mc.link', plan: planFor(inst), problem: null };
          await paste('Заходи: pink-cat.e4mc.link\\nКод сборки: FLM1:5:AAAAA');
          const t = txt();
          res.sent = calls.length === 1 && calls[0][0] === 'check' && calls[0][1] === inst.id && calls[0][2].includes('FLM1:5:AAAAA');
          res.address = q('#jnAddr').value === 'pink-cat.e4mc.link';
          res.head = t.includes('Сборка друга:') && t.includes('1.21.1 · Fabric') && t.includes('модов у друга: 12');
          res.chips = ['Совпало 2', 'Поставлю 1', 'Заменю 1', 'Включу 1', 'Нужны файлы от друга 3', 'Лишних у тебя 2'].every((c) => flat(q('.jn-chips')).includes(c));
          res.todo = sec(/Поставлю/).innerText.includes('Delta') && sec(/Заменю/).innerText.includes('0.9 → 1.0') && sec(/Включу/).innerText.includes('Gamma');
          res.manual = sec(/Нужны файлы/).innerText.includes('tools.jar') && sec(/Нужны файлы/).innerText.includes('попроси файл у друга') && sec(/Нужны файлы/).innerText.includes('поставить нечего');
          res.folded = !sec(/Есть у тебя/).open && sec(/Есть у тебя/).textContent.includes('Zeta') && sec(/Есть у тебя/).textContent.includes('не с Modrinth') && sec(/Совпало/).textContent.includes('Alpha');
          res.loaderVersion = t.includes('Версия загрузчика у друга другая:') && t.includes('0.15.0') && t.includes('0.16.0');
          res.buttons = !q('#jnInstall').disabled && q('#jnInstall').textContent === 'Поставить как у друга' && !q('#jnPlay').disabled && q('#jnPlay').textContent === 'Зайти всё равно ▶';
          // адрес с ошибкой: «Зайти» недоступна, исправили — снова доступна
          q('#jnAddr').value = 'bad addr'; q('#jnAddr').dispatchEvent(new Event('input')); res.badAddr = q('#jnPlay').disabled;
          q('#jnAddr').value = 'pink-cat.e4mc.link'; q('#jnAddr').dispatchEvent(new Event('input')); res.goodAddr = !q('#jnPlay').disabled;
          // поставить: уходят сборка и текст, потом свежая сверка и итог в уведомлении
          answer = { address: 'pink-cat.e4mc.link', plan: planFor(inst, { todo: 0, missing: [], other: [], off: [], manual: [], mismatch: { version: false, loader: false, loaderVersion: false } }), problem: null };
          calls.length = 0; q('#jnInstall').click(); await s(1000);
          res.install = calls[0]?.[0] === 'install' && calls[0][1] === inst.id && calls[0][2].includes('FLM1:5:AAAAA') && calls.some((c, i) => i > 0 && c[0] === 'check');
          res.toast = q('#toasts').innerText.includes('Готово: поставлено 1, заменено 1, включено 1');
          res.fine = txt().includes('Моды те же, что у друга') && q('#jnInstall').disabled && q('#jnPlay').textContent === 'Зайти ▶';
          // только адрес (кода в тексте нет): сверки нет, зайти можно; «Зайти» запускает выбранную сборку на этот адрес
          await open(van);
          answer = { address: 'play.example.com:25565', plan: null, problem: null };
          await paste('сервер play.example.com:25565');
          res.onlyAddr = txt().includes('Кода сборки в сообщении нет') && q('#jnInstall').disabled && !q('#jnPlay').disabled && q('#jnAddr').value === 'play.example.com:25565';
          calls.length = 0; q('#jnPlay').click(); await s(900);
          const launch = calls.find((c) => c[0] === 'launch');
          res.launch = !!launch && launch[1] === van.id && launch[2].server === 'play.example.com:25565' && launch[2].friends === false && !q('#modal').classList.contains('open') && state.selected === van.id;
          // сборка уже запущена: «Играть» закрыла бы чужую игру, поэтому просим закрыть самому
          await open(van);
          await paste('play.example.com:25565');
          state.running.add(van.id); calls.length = 0; q('#jnPlay').click(); await s(400);
          res.running = !calls.some((c) => c[0] === 'launch') && q('#modal').classList.contains('open') && q('#toasts').innerText.includes('уже запущена');
          return Object.values(res).every(Boolean) ? true : 'EXC не сошлось: ' + Object.keys(res).filter((k) => !res[k]).join(',');
        } finally { cleanup(); }`,
    ],
    // «Войти к другу», остальные случаи: другая версия игры, «новая сборка как у друга», беда с кодом, нет связи, часть модов не поставилась
    [
      'войти к другу: другая версия, новая сборка, беда с кодом, нет связи, ошибки установки',
      `${JOIN_STUB}
        try {
          // другая версия игры: предупреждение первым делом, поставить нельзя
          await open(inst);
          answer = { address: 'a.e4mc.link', plan: planFor(inst, { mine: { mc: '1.20.1', loader: inst.loader, loaderVersion: null }, mismatch: { version: true, loader: false, loaderVersion: false } }), problem: null };
          await paste('a.e4mc.link FLM1:5:AAAAA');
          res.mismatch = txt().includes('Версия игры или загрузчик не совпадают.') && txt().includes('У друга:') && txt().includes('1.20.1') && q('#jnInstall').disabled && q('#jnPlay').textContent === 'Зайти всё равно ▶';
          // подходящей сборки нет: «новая сборка как у друга» выбрана сама, сверка повторена без сборки
          await open(inst);
          answer = { address: 'a.e4mc.link', plan: { ...planFor(inst), host: { ...base.host, mc: '1.19.4', loader: 'fabric' }, mine: null, mismatch: { version: false, loader: false, loaderVersion: false } }, problem: null };
          await paste('a.e4mc.link FLM1:5:AAAAA'); await s(300);
          res.newPick = q('#jnInst').value === 'new' && q('#jnInst').options[0].textContent.includes('Новая сборка как у друга · 1.19.4 · Fabric');
          res.newCalls = calls.filter((c) => c[0] === 'check').length === 2 && calls[0][1] === inst.id && calls[1][1] === null;
          res.newButtons = q('#jnInstall').textContent === 'Создать сборку и поставить моды' && !q('#jnInstall').disabled && q('#jnPlay').disabled;
          calls.length = 0; q('#jnInstall').click(); await s(900);
          res.newInstall = calls[0]?.[0] === 'install' && calls[0][1] === 'new';
          // беда с кодом: понятное сообщение, адрес из того же текста всё равно подставлен
          await open(inst);
          answer = { address: 'pink-cat.e4mc.link', plan: null, problem: { code: 'truncated', message: 'Код обрезан: не хватает 15 знаков в конце. Скопируй сообщение друга целиком (длинные сообщения чаты иногда режут на части)' } };
          await paste('pink-cat.e4mc.link FLM1:100:AAAA');
          res.problem = txt().includes('Код обрезан') && q('#jnAddr').value === 'pink-cat.e4mc.link' && q('#jnInstall').disabled && !q('#jnPlay').disabled;
          // нет связи с Modrinth: ошибка в окне, кнопки живы
          const before = window.call;
          window.call = async (ch, ...a) => (ch === 'instances:joinCheck' ? Promise.reject(new Error('Нет связи с Modrinth — без неё моды не опознать и не скачать. Проверь интернет и попробуй ещё раз')) : before(ch, ...a));
          q('#jnCheck').click(); await s(600);
          res.offline = txt().includes('Нет связи с Modrinth') && !q('#jnCheck').disabled && q('#jnCheck').textContent === 'Сверить моды';
          window.call = before;
          // часть модов не поставилась: причины перечислены, остальное сказано в итоге
          await open(inst);
          answer = { address: 'pink-cat.e4mc.link', plan: planFor(inst), problem: null };
          failed = [{ title: 'Delta', error: 'Файл «delta-2.0.jar» уже есть и отличается от нужного — убери его из папки mods и повтори' }];
          await paste('pink-cat.e4mc.link FLM1:5:AAAAA');
          q('#jnInstall').click(); await s(1000);
          res.failed = txt().includes('Не получилось поставить:') && txt().includes('delta-2.0.jar') && q('#toasts').innerText.includes('не вышло 1');
          return Object.values(res).every(Boolean) ? true : 'EXC не сошлось: ' + Object.keys(res).filter((k) => !res[k]).join(',');
        } finally { cleanup(); }`,
    ],
    // «Пора на новую версию?»: значок на карточке (ответ фона подставлен), клик открывает перенос сразу с этой версией; выключатель в настройках
    [
      'значок «пора на новую версию?»: карточка, клик и выключатель',
      `const inst = ${INST}; const o2 = window.call; const res = {}; const q = (sel) => document.querySelector(sel);
        const prevInfo = heroInfo[inst.id]; const prevSel = state.selected; const prevVersions = state.versions;
        const target = '1.99.9';
        window.call = async (ch, ...a) => {
          if (ch === 'versions:list') return { latest: { release: target, snapshot: target }, versions: [{ id: target, type: 'release', releaseTime: '2099-01-01T00:00:00+00:00' }, { id: inst.version, type: 'release', releaseTime: '2024-01-01T00:00:00+00:00' }] };
          if (ch === 'migrate:plan') return { from: inst.version, to: a[1], loader: inst.loader, loaderVersion: '0.1', mods: [], extras: [], counts: { total: 0, update: 0, same: 0, missing: 0, unknown: 0, failed: 0 }, worlds: { count: 0, size: 0 }, packs: { resourcepack: 0, shader: 0 }, java: null };
          return o2(ch, ...a);
        };
        const show = (ready) => { heroInfo[inst.id] = { ...heroInfo[inst.id], ready, at: Date.now() }; paintHeroInfo(inst.id); return q('#heroStats').innerText.replace(/\\s+/g, ' '); };
        try {
          state.versions = null; // список версий для окна переноса берётся из подмены
          selectInstance(inst.id); await s(700);
          const shown = show({ target, ready: 38, total: 40, checkedAt: Date.now() });
          res.text = shown.includes('🚀 ' + target + ': готовы 38 из 40 модов');
          res.plural = show({ target, ready: 25, total: 41, checkedAt: 1 }).includes('готовы 25 из 41 мода');
          res.half = show({ target, ready: 2, total: 4, checkedAt: 1 }).includes('готовы 2 из 4');
          res.low = !show({ target, ready: 1, total: 4, checkedAt: 1 }).includes('готовы');
          res.none = !show(null).includes('готовы') && !show({ target, ready: 0, total: 0, checkedAt: 1 }).includes('готовы');
          show({ target, ready: 38, total: 40, checkedAt: 1 });
          q('#heroStats [data-act="ready"]').click(); await s(900);
          res.opened = q('#modal').classList.contains('open') && q('#modalBox').innerText.includes('Перенос на новую версию');
          res.version = q('#mgVer')?.value === target;
          q('#modalBox').isDirty = null; closeModal(); await s(300);
          // фон досчитал: событие перерисовывает значок выбранной сборки
          window.call = async (ch, ...a) => (ch === 'instances:readiness' ? { target, ready: 5, total: 6, checkedAt: 1 } : o2(ch, ...a));
          delete heroInfo[inst.id]; onReadiness({ id: inst.id }); await s(700);
          res.event = q('#heroStats').innerText.includes('готовы 5 из 6');
          onReadiness({ id: 'другая-сборка' }); onReadiness();
          // выключатель показывает настройку и меняет её (профиль проверки выключил фон, чтобы тест не ходил в сеть; «включено по умолчанию» проверяет tests/readiness.test.js)
          window.call = o2;
          showPage('settings'); await s(300);
          res.shows = q('#readinessCheck').checked === false && state.settings.readinessCheck === false;
          q('#readinessCheck').click(); await s(500);
          res.on = state.settings.readinessCheck === true && q('#readinessCheck').checked;
          q('#readinessCheck').click(); await s(500);
          res.off = state.settings.readinessCheck === false;
          return Object.values(res).every(Boolean) ? true : 'EXC не сошлось: ' + Object.keys(res).filter((k) => !res[k]).join(',');
        } finally { window.call = o2; state.versions = prevVersions; heroInfo[inst.id] = prevInfo; q('#modalBox').isDirty = null; closeModal(); showPage('instances'); selectInstance(prevSel); }`,
    ],
    // Хозяину: кнопки «Код сборки» (окно «Играть с другом») и «Адрес и код сборки» (окно с адресом) копируют код; нет связи — понятная ошибка
    [
      'код сборки: кнопки у хозяина копируют код и адрес (ответы подставлены)',
      `const id = (${INST}).id; const o2 = window.call; window.__copied = []; const res = {}; const q = (sel) => document.querySelector(sel);
        const reply = { code: 'FLM1:3:abc', total: 47, modrinth: 45, others: ['own.jar', 'tools.jar'] };
        window.call = async (ch, ...a) => (ch === 'instances:modCode' ? reply : ch === 'app:copyText' ? (window.__copied.push(a[0]), true) : o2(ch, ...a));
        try {
          openFriendModal(${INST}); await s(500);
          q('#frCode').click(); await s(500);
          res.code = window.__copied.at(-1) === 'FLM1:3:abc';
          res.toast = q('#toasts').innerText.includes('Код сборки скопирован') && q('#toasts').innerText.includes('Не с Modrinth: 2');
          res.back = !q('#frCode').disabled && q('#frCode').textContent.includes('Код сборки');
          res.step = q('#modalBox').innerText.includes('Войти к другу');
          q('#modalBox').isDirty = null; closeModal(); await s(250);
          showFriendShare({ id, address: 'pink-cat.e4mc.link', whitelist: [] }); await s(600);
          q('#shCode').click(); await s(500);
          res.both = window.__copied.at(-1) === 'pink-cat.e4mc.link\\nКод сборки: FLM1:3:abc';
          window.call = async (ch, ...a) => (ch === 'instances:modCode' ? Promise.reject(new Error('Нет связи с Modrinth — без неё моды не опознать и не скачать. Проверь интернет и попробуй ещё раз')) : o2(ch, ...a));
          q('#shCode').click(); await s(500);
          res.err = q('#toasts').innerText.includes('Нет связи с Modrinth') && !q('#shCode').disabled && q('#shCode').textContent.includes('Адрес и код сборки');
          return Object.values(res).every(Boolean) ? true : 'EXC не сошлось: ' + Object.keys(res).filter((k) => !res[k]).join(',');
        } finally { window.call = o2; q('#modalBox').isDirty = null; closeModal(); }`,
    ],
    // Ctrl+K: действия «Войти к другу» и «Скопировать код сборки» находятся по словам и открывают окно
    [
      'Ctrl+K: «Войти к другу» и «Скопировать код сборки для друга»',
      `const q = (sel) => document.querySelector(sel); const find = async (text) => { const inp = q('#palInput'); inp.value = text; inp.dispatchEvent(new Event('input', { bubbles: true })); await s(400); return q('#palList').innerText; };
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true, bubbles: true })); await s(600);
        const a = await find('код сборки'); const b = await find('войти к другу');
        q('#palInput').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })); await s(700);
        const opened = !!q('#jnText'); q('#modalBox').isDirty = null; closeModal(); await s(300);
        return a.includes('Скопировать код сборки для друга') && a.includes('Войти к другу (адрес и код сборки)') && b.includes('Войти к другу') && opened`,
    ],
    // «Вышли обновления модов»: значок на карточке (число и слово по правилам языка, подсказка с названиями и «и ещё N», безопасность названий),
    // щелчок открывает окно обновлений с «Что нового» под каждым обновлением (описание — текстом, а не разметкой), событие фона и выключатель
    [
      'значок «вышли обновления модов»: карточка, окно с описанием версий и выключатель',
      `const inst = ${INST}; const o2 = window.call; const res = {}; const q = (sel) => document.querySelector(sel);
        const ok = (k, f) => { try { res[k] = !!f(); } catch { res[k] = false; } };
        const UPS = [
          { file: 'a.jar', title: 'Alpha', from: '1.0', to: '2.0', source: 'modrinth', icon: null, changelog: 'Что нового\\n• Быстрее загрузка\\n<img src=x onerror="window.__xss = 1"> <b>жирно</b>' },
          { file: 'b.jar', title: 'Beta', from: '0.9', to: '1.0', source: 'modrinth', icon: null, changelog: '' },
        ];
        let watch = null;
        window.call = async (ch, ...a) => (ch === 'mods:watch' ? watch : ch === 'mods:checkUpdates' ? UPS : o2(ch, ...a));
        const stat = () => q('#heroStats .stat.upd');
        const show = async (u) => { heroInfo[inst.id] = { ...heroInfo[inst.id], updates: u, at: Date.now() }; paintHeroInfo(inst.id); await s(200); };
        try {
          selectInstance(inst.id); await s(600);
          await show(null); ok('none', () => !stat());
          await show({ count: 0, titles: [], checkedAt: 1 }); ok('zero', () => !stat());
          await show({ count: 1, titles: ['Alpha'], checkedAt: 1 }); ok('one', () => stat().textContent.trim() === '1 обновление модов');
          await show({ count: 3, titles: ['Alpha', 'Beta', 'Gamma'], checkedAt: 1 }); ok('few', () => stat().textContent.trim() === '3 обновления модов' && stat().title.includes('Alpha, Beta, Gamma.') && !stat().title.includes('и ещё'));
          await show({ count: 7, titles: ['A', 'B', 'C', 'D', 'E'], checkedAt: 1 }); ok('many', () => stat().textContent.trim() === '7 обновлений модов' && stat().title.includes('A, B, C, D, E и ещё 2'));
          await show({ count: 1, titles: ['<b>x</b>"'], checkedAt: 1 }); ok('esc', () => !stat().querySelector('b') && stat().title.includes('<b>x</b>"'));
          await show({ count: 2, titles: ['Alpha', 'Beta'], checkedAt: 1 });
          q('#modalBox').innerHTML = ''; // остатки прошлых окон не должны сойти за открывшееся
          state.mods.inst = state.instances.find((x) => x.id !== inst.id).id; // вкладка «Моды» до этого смотрела другую сборку
          stat()?.click(); await s(1000);
          ok('opened', () => q('#modal').classList.contains('open') && q('#modalBox').innerText.includes('Обновления модов'));
          ok('inst', () => state.mods.inst === inst.id && q('#modalBox').innerText.includes(inst.name));
          ok('rows', () => document.querySelectorAll('#modalBox .upd-row').length === 2 && q('#modalBox .upd-row input').checked);
          ok('log', () => document.querySelectorAll('#modalBox details.upd-log').length === 1 && q('#modalBox details.upd-log summary').textContent === 'Что нового' && !q('#modalBox details.upd-log').open);
          q('#modalBox details.upd-log summary')?.click(); await s(250);
          ok('opens', () => q('#modalBox details.upd-log').open && q('#modalBox .upd-row input').checked);
          ok('text', () => q('#modalBox .upd-notes').textContent.includes('• Быстрее загрузка') && q('#modalBox .upd-notes').textContent.includes('<b>жирно</b>'));
          ok('safe', () => !q('#modalBox .upd-notes img') && !q('#modalBox .upd-notes b') && window.__xss === undefined);
          q('#modalBox').isDirty = null; closeModal(); await s(350);
          watch = { count: 4, titles: ['X'], checkedAt: 1 };
          onReadiness({ id: inst.id }); await s(700);
          ok('event', () => stat()?.textContent.trim() === '4 обновления модов');
          showPage('settings'); showSection('game'); await s(500);
          ok('shows', () => q('#modUpdatesCheck').checked === false && state.settings.modUpdatesCheck === false); // в профиле проверки фон выключен: он ходил бы в настоящую сеть
          q('#modUpdatesCheck').click(); await s(500);
          ok('on', () => state.settings.modUpdatesCheck === true && q('#modUpdatesCheck').checked);
          q('#modUpdatesCheck').click(); await s(500);
          ok('off', () => state.settings.modUpdatesCheck === false);
          return Object.values(res).every(Boolean) ? true : 'EXC не сошлось: ' + Object.keys(res).filter((k) => !res[k]).join(',');
        } finally { window.call = o2; delete window.__xss; if (heroInfo[inst.id]) heroInfo[inst.id].updates = null; q('#modalBox').isDirty = null; closeModal(); showPage('instances'); paintHeroInfo(inst.id); }`,
    ],
    // «Коллекция Modrinth»: вставка ссылки, ошибка, список с типами и пометками «не подойдёт», совет для новой сборки, смена цели, кнопки «Все подходящие» и «Снять все»
    [
      'коллекция Modrinth: ссылка, список, пометки по цели и выбор',
      `${COLLECTION_STUB(COLLECTION('ru'))}
        const res = {}; const ok = (k, f) => { try { res[k] = !!f(); } catch { res[k] = false; } };
        const row = (title) => [...document.querySelectorAll('#modalBox .cl-row')].find((r) => r.querySelector('b').textContent === title);
        const bad = (title) => row(title)?.classList.contains('bad'); const on = (title) => row(title)?.querySelector('input').checked;
        const why = (title) => row(title)?.querySelector('.cl-why').textContent;
        const old = state.instances.find((x) => x.loader === 'forge'); const fab = state.instances.find((x) => x.loader === 'fabric');
        try {
          await clear(); openCollection(); await s(500);
          ok('empty', () => q('#clLink') && q('#clGo').hidden && q('#clBody').innerText.includes('Закрытые (приватные)'));
          st.fail = 'Не вижу ссылки на коллекцию Modrinth: она выглядит как modrinth.com/collection/abcd1234';
          q('#clLink').value = 'просто слова'; q('#clLoad').click(); await s(500);
          ok('error', () => q('#clBody .hint.err')?.textContent.includes('Не вижу ссылки') && q('#clGo').hidden && !q('#clLoad').disabled);
          st.fail = null;
          q('#clLink').value = 'https://modrinth.com/collection/sp6gQaWQ'; q('#clLink').dispatchEvent(new Event('paste')); await s(1100);
          ok('asked', () => JSON.stringify(calls.find((c) => c[0] === 'load' && c[1].includes('sp6gQaWQ'))) === JSON.stringify(['load', 'https://modrinth.com/collection/sp6gQaWQ']));
          ok('head', () => q('#modalBox .cl-head b').textContent === 'Моя подборка' && q('#modalBox .cl-head').innerText.includes('6 проектов') && q('#modalBox .cl-head').innerText.includes('удалено автором: 1') && q('#modalBox .cl-head').innerText.includes('Лучшие моды'));
          ok('rows', () => document.querySelectorAll('#modalBox .cl-row').length === 6 && row('Sodium').innerText.includes('мод') && row('Красивые текстуры').innerText.includes('ресурспак') && row('Сборка друга').innerText.includes('модпак'));
          ok('tip', () => q('#modalBox .cl-tip').textContent === 'Для новой сборки подойдёт Minecraft 1.21.1 · Fabric: под него есть 3 из 5');
          ok('newTarget', () => q('#clTarget').value === 'new' && !q('#clNew').hidden);
          ok('newVer', () => q('#clVer').value === '1.21.1'); // не последняя версия игры (1.21.4), а та, что посоветовало окно
          ok('newLoader', () => q('#clLoader').value === 'fabric');
          ok('newName', () => q('#clName').placeholder === 'Моя подборка');
          ok('picked', () => on('Sodium') && on('Lithium') && on('Красивые текстуры') && !on('Старый мод') && !on('Only Forge') && !on('Сборка друга'));
          ok('badClass', () => bad('Старый мод') && bad('Only Forge'));
          ok('whyVersion', () => why('Старый мод') === 'нет под эту версию игры');
          ok('whyLoader', () => why('Only Forge') === 'нет под этот загрузчик');
          ok('whyType', () => row('Сборка друга').querySelector('input').disabled && why('Сборка друга').startsWith('в сборку не ставится'));
          ok('good', () => !bad('Sodium') && why('Sodium') === '' && !bad('Красивые текстуры'));
          ok('count', () => q('#clCount').textContent === 'Выбрано: 3' && q('#clGo').textContent === 'Поставить: 3' && !q('#clGo').disabled && !q('#clGo').hidden);
          // другая цель — старая сборка на Forge 1.12.2: пометки пересчитываются, выбор остаётся
          q('#clTarget').value = old.id; q('#clTarget').dispatchEvent(new Event('change')); await s(600);
          ok('compatCall', () => JSON.stringify(calls.filter((c) => c[0] === 'compat').at(-1)) === JSON.stringify(['compat', 'sp6gQaWQ', { instance: old.id }]));
          ok('newHidden', () => q('#clNew').hidden);
          ok('tipHidden', () => q('#clTip').hidden);
          ok('remarked', () => !bad('Старый мод') && bad('Sodium') && why('Sodium') === 'нет под эту версию игры' && bad('Красивые текстуры'));
          ok('kept', () => on('Sodium') && on('Lithium') && !on('Старый мод') && q('#clCount').textContent === 'Выбрано: 3 · не подойдут: 3');
          q('#clAll').click();
          ok('allFit', () => on('Старый мод') && !on('Sodium') && !on('Lithium') && !on('Красивые текстуры') && q('#clCount').textContent === 'Выбрано: 1' && q('#clGo').textContent === 'Поставить: 1');
          q('#clNone').click();
          ok('none', () => q('#clCount').textContent === 'Ничего не выбрано' && q('#clGo').disabled && q('#clGo').textContent === 'Поставить' && !on('Старый мод') && row('Сборка друга').querySelector('input').disabled);
          // ванильная цель: подойдёт любой загрузчик, но не та версия
          const van = state.instances.find((x) => x.loader === 'vanilla');
          if (van) { q('#clTarget').value = van.id; q('#clTarget').dispatchEvent(new Event('change')); await s(500); ok('vanilla', () => bad('Sodium') && why('Sodium') === 'нет под эту версию игры' && !bad('Only Forge') === (van.version === '1.21.1')); } else res.vanilla = true;
          // вернулись к новой сборке: пересчёт по выбранной версии и загрузчику
          q('#clTarget').value = 'new'; q('#clTarget').dispatchEvent(new Event('change')); await s(500);
          ok('newVisible', () => !q('#clNew').hidden && !q('#clTip').hidden);
          q('#clLoader').value = 'forge'; q('#clLoader').dispatchEvent(new Event('change')); await s(500);
          ok('byLoader', () => bad('Sodium') && why('Sodium') === 'нет под этот загрузчик' && !bad('Only Forge') && JSON.stringify(calls.filter((c) => c[0] === 'compat').at(-1)[2]) === JSON.stringify({ version: '1.21.1', loader: 'forge' }));
          // медленный ответ про прежнюю цель не должен затереть свежий: выбрали старую сборку (ответ через 0,7 с) и сразу вернулись к новой
          st.compatDelay['1.12.2|forge'] = 700;
          q('#clTarget').value = old.id; q('#clTarget').dispatchEvent(new Event('change')); await s(80);
          q('#clTarget').value = 'new'; q('#clTarget').dispatchEvent(new Event('change')); await s(1000);
          ok('staleCompat', () => why('Sodium') === 'нет под этот загрузчик' && !bad('Only Forge') && !q('#clNew').hidden);
          return Object.values(res).every(Boolean) ? true : 'EXC не сошлось: ' + Object.keys(res).filter((k) => !res[k]).join(',');
        } finally { cleanup(); }`,
    ],
    // «Коллекция Modrinth»: установка (в новую сборку с названием и в существующую), итог с причинами, кнопка «Открыть сборку», сбой установки, самый свежий ответ при двух «Показать»
    [
      'коллекция Modrinth: установка, итог, сбой и гонка двух запросов',
      `${COLLECTION_STUB(COLLECTION('ru'))}
        const res = {}; const ok = (k, f) => { try { res[k] = !!f(); } catch { res[k] = false; } };
        const inst = ${INST}; const prevSel = state.selected;
        const last = (kind) => calls.filter((c) => c[0] === kind).at(-1);
        try {
          await clear(); openCollection('https://modrinth.com/collection/sp6gQaWQ'); await s(1000);
          ok('prefill', () => q('#clLink').value.includes('sp6gQaWQ') && document.querySelectorAll('#modalBox .cl-row').length === 6);
          q('#clName').value = '  Моя сборка из коллекции '; q('#clLoader').value = 'quilt'; q('#clLoader').dispatchEvent(new Event('change')); await s(500);
          ok('quilt', () => document.querySelector('#modalBox .cl-row[data-id="BBBB0002"]') && !document.querySelector('#modalBox .cl-row[data-id="BBBB0002"]').classList.contains('bad'));
          st.result = { instance: inst, created: true, installed: ['Sodium', 'Lithium', 'Библиотека', 'Красивые текстуры'], failed: [{ title: 'Only Forge', error: 'У «Only Forge» нет версии для 1.21.1 на Quilt — есть только для Forge, NeoForge' }], warnings: ['Предупреждение лаунчера'], notes: ['Заметка лаунчера'] };
          q('#clGo').click(); await s(1200);
          ok('args', () => JSON.stringify(last('import')) === JSON.stringify(['import', 'sp6gQaWQ', { version: '1.21.1', loader: 'quilt', name: 'Моя сборка из коллекции' }, ['AAAA0001', 'BBBB0002', 'DDDD0004']]));
          const t = () => q('#clBody').innerText;
          ok('done', () => t().includes('Создана сборка «' + inst.name + '»') && t().includes('поставлено: 4'));
          ok('list', () => [...document.querySelectorAll('#clBody .cl-done + ul li')].map((li) => li.textContent).join('|') === 'Sodium|Lithium|Библиотека|Красивые текстуры');
          ok('failed', () => t().includes('Не вышло: 1') && t().includes('Only Forge') && t().includes('нет версии для 1.21.1 на Quilt'));
          ok('notes', () => t().includes('Заметка лаунчера') && t().includes('Предупреждение лаунчера'));
          ok('toast', () => q('#toasts').innerText.includes('Поставлено: 4 ♡'));
          ok('result', () => q('#clGo').textContent === 'Открыть сборку' && !q('#clGo').disabled && q('#clLink').disabled && q('#clLoad').hidden);
          showPage('instances'); state.selected = null;
          q('#clGo').click(); await s(500);
          ok('opened', () => state.selected === inst.id && !q('#modal').classList.contains('open'));
          // существующая сборка: в вызов уходит только её код, без версии и загрузчика
          await clear(); calls.length = 0; openCollection('sp6gQaWQ'); await s(1000);
          q('#clTarget').value = inst.id; q('#clTarget').dispatchEvent(new Event('change')); await s(500);
          st.result = { instance: inst, created: false, installed: ['Sodium'], failed: [], warnings: [], notes: [] };
          q('#clGo').click(); await s(900);
          ok('existing', () => JSON.stringify(last('import')) === JSON.stringify(['import', 'sp6gQaWQ', { instance: inst.id }, ['AAAA0001', 'BBBB0002', 'DDDD0004']]));
          ok('doneExisting', () => q('#clBody').innerText.includes('Готово: «' + inst.name + '»') && !q('#clBody').innerText.includes('Не вышло'));
          // сбой установки: сообщение, окно остаётся, кнопки снова работают
          await clear(); openCollection('sp6gQaWQ'); await s(1000);
          st.importFail = 'Нет связи с cdn.modrinth.com (ENOTFOUND)';
          q('#clGo').click(); await s(900);
          ok('failToast', () => q('#toasts').innerText.includes('Нет связи с cdn.modrinth.com') && q('#modal').classList.contains('open') && !!q('#clList') && !q('#clGo').disabled && !q('#clLink').disabled);
          ok('failLock', () => !q('#clLoad').disabled && document.querySelector('#modalBox .cl-row[data-id="EEEE0005"] input').disabled && !document.querySelector('#modalBox .cl-row[data-id="AAAA0001"] input').disabled);
          st.importFail = null;
          // пока идёт установка, окно заблокировано (ни второй установки, ни нового «Показать»); окно заменили другим — итог остаётся уведомлением и в новое не ложится
          await clear(); calls.length = 0; openCollection('sp6gQaWQ'); await s(1000);
          st.result = { instance: inst, created: false, installed: ['Sodium', 'Lithium'], failed: [], warnings: [], notes: [] }; st.importDelay = 600;
          q('#clGo').click(); await s(100);
          ok('locked', () => q('#clGo').disabled && q('#clLoad').disabled && [...document.querySelectorAll('#clBody input, #clBody select, #clBody button')].every((x) => x.disabled));
          q('#clLink').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); await s(50);
          ok('noReload', () => calls.filter((c) => c[0] === 'load').length === 1 && calls.filter((c) => c[0] === 'import').length === 1);
          await clear(); openCollection(); await s(1100);
          ok('replaced', () => q('#toasts').innerText.includes('Поставлено: 2 ♡') && !q('#clBody .cl-result') && q('#clGo').hidden && !q('#clLink').disabled);
          st.importDelay = 0;
          // два «Показать» подряд: медленный первый ответ не затирает свежий второй
          await clear(); openCollection(); await s(500);
          const A = { ...data, name: 'Первая (медленная)' };
          const B = { ...data, name: 'Вторая <u>(быстрая)</u>', description: '<i>Описание</i>', projects: [{ ...data.projects[0], title: '<u>Hack</u>', description: '<s>d</s>' }, ...data.projects.slice(1)] };
          st.responses.length = 0; st.responses.push({ data: A, delay: 700 }, { data: B, delay: 50 });
          q('#clLink').value = 'sp6gQaWQ'; q('#clLoad').click(); await s(60);
          q('#clLink').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); await s(1300); // второй запрос — Enter в поле: кнопка, пока идёт первый, недоступна
          ok('race', () => q('#modalBox .cl-head b').textContent.startsWith('Вторая') && !q('#clLoad').disabled);
          // названия и описания приходят из интернета: разметка в них — просто текст
          ok('escName', () => !q('#modalBox .cl-head u') && q('#modalBox .cl-head b').textContent === 'Вторая <u>(быстрая)</u>');
          ok('escDesc', () => !q('#modalBox .cl-head i') && q('#modalBox .cl-head .hint').textContent === '<i>Описание</i>');
          ok('escTitle', () => !q('#modalBox .cl-title u') && q('#modalBox .cl-title b').textContent === '<u>Hack</u>');
          ok('escSmall', () => !q('#modalBox .cl-title s') && q('#modalBox .cl-title small').textContent === '<s>d</s>');
          // окно закрыли, пока читалась коллекция, и открыли новое: старый ответ в новое окно не ложится
          await clear(); openCollection(); await s(300);
          st.responses.length = 0; st.responses.push({ data: A, delay: 800 }); // очередь чистая: от прошлого сценария мог остаться ответ
          q('#clLink').value = 'sp6gQaWQ'; q('#clLoad').click(); await s(100);
          await clear(); openCollection(); await s(1200);
          ok('staleWindow', () => !q('#modalBox .cl-head') && q('#clGo').hidden && q('#clBody').innerText.includes('Закрытые (приватные)'));
          return Object.values(res).every(Boolean) ? true : 'EXC не сошлось: ' + Object.keys(res).filter((k) => !res[k]).join(',');
        } finally { cleanup(); state.selected = prevSel; showPage('instances'); }`,
    ],
    // «Коллекция Modrinth»: кнопка на странице «Моды» и действие в Ctrl+K
    [
      'коллекция Modrinth: кнопка в «Модах» и действие в Ctrl+K',
      `${COLLECTION_STUB(COLLECTION('ru'))}
        const res = {}; const ok = (k, f) => { try { res[k] = !!f(); } catch { res[k] = false; } };
        try {
          await clear(); showPage('mods'); await s(500);
          ok('button', () => q('#modsCollection') && q('#modsCollection').textContent.includes('Коллекция'));
          q('#modsCollection')?.click(); await s(600);
          ok('opened', () => q('#modal').classList.contains('open') && !!q('#clLink') && q('#modalBox').innerText.includes('Коллекция Modrinth'));
          q('#clClose')?.click(); await s(500);
          ok('close', () => !q('#modal').classList.contains('open'));
          await clear(); showPage('instances'); await s(300);
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true, bubbles: true })); await s(600);
          const inp = q('#palInput'); inp.value = 'коллекц'; inp.dispatchEvent(new Event('input', { bubbles: true })); await s(400);
          ok('palette', () => q('#palList').innerText.includes('Импорт коллекции Modrinth (по ссылке)'));
          inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })); await s(900);
          ok('paletteOpens', () => q('#modal').classList.contains('open') && !!q('#clLink'));
          return Object.values(res).every(Boolean) ? true : 'EXC не сошлось: ' + Object.keys(res).filter((k) => !res[k]).join(',');
        } finally { cleanup(); showPage('instances'); }`,
    ],
    // «Одинаковые моды» в настройках: подсчёт, отказ, объединение и итог (ответы главного процесса подставлены)
    [
      'одинаковые моды: подсчёт, вопрос и объединение (ответы подставлены)',
      `const res = {}; const ok = (k, f) => { try { res[k] = !!f(); } catch { res[k] = false; } };
        const o2 = window.call; const oc = window.confirm; const calls = []; const asked = []; let answer = false; let scan = { saved: 5242880, files: 2, examples: [] };
        window.call = async (ch, ...a) => {
          if (ch === 'storage:dedupeScan') { calls.push(ch); return scan; }
          if (ch === 'storage:dedupeApply') { calls.push(ch); scan = { saved: 0, files: 0, examples: [] }; return { linked: 2, skipped: 1, freed: 5242880 }; }
          return o2(ch, ...a);
        };
        window.confirm = (t) => (asked.push(t), answer);
        const q = (sel) => document.querySelector(sel);
        try {
          showPage('settings'); await s(400);
          ok('idle', () => q('#dedupeGo').hidden && q('#dedupeInfo').textContent === '');
          q('#dedupeScan').click(); await s(400);
          ok('found', () => q('#dedupeInfo').textContent === 'Одинаковых файлов: 2, освободится 5.0 МБ' && !q('#dedupeGo').hidden && !q('#dedupeGo').disabled);
          q('#dedupeGo').click(); await s(300);
          ok('declined', () => asked.length === 1 && asked[0].includes('освободится 5.0 МБ') && !calls.includes('storage:dedupeApply'));
          answer = true; q('#dedupeGo').click(); await s(800);
          ok('merged', () => calls.includes('storage:dedupeApply') && q('#toasts').innerText.includes('Объединено файлов: 2, освобождено 5.0 МБ ♡ · пропущено: 1'));
          ok('rescanned', () => q('#dedupeInfo').textContent === 'Одинаковых модов нет ♡' && q('#dedupeGo').hidden);
          return Object.values(res).every(Boolean) ? true : 'EXC не сошлось: ' + Object.keys(res).filter((k) => !res[k]).join(',');
        } finally { window.call = o2; window.confirm = oc; showPage('instances'); }`,
    ],
    // «Следовать за сборкой друга»: отметка на карточке, галочка в окне «Войти к другу» зависит от выбранной сборки
    [
      'следование за другом: отметка на карточке и галочка в окне',
      `const res = {}; const ok = (k, f) => { try { res[k] = !!f(); } catch { res[k] = false; } };
        const q = (sel) => document.querySelector(sel);
        const a = state.instances[0]; const b = state.instances[1]; const prev = a.follow;
        try {
          a.follow = { at: Date.now(), mods: 4 }; delete b.follow;
          ok('chip', () => statsHtml(a).includes('data-act="follow"') && statsHtml(a).includes('как у друга') && !statsHtml(b).includes('data-act="follow"'));
          openJoinModal(a); await s(400);
          ok('onForFollower', () => q('#jnInst').value === a.id && q('#jnFollow').checked);
          q('#jnInst').value = b.id; q('#jnInst').dispatchEvent(new Event('change')); await s(200);
          ok('offForOther', () => !q('#jnFollow').checked);
          q('#jnFollow').click(); await s(100);
          ok('toggle', () => q('#jnFollow').checked);
          q('#jnInst').value = a.id; q('#jnInst').dispatchEvent(new Event('change')); await s(200);
          ok('backOn', () => q('#jnFollow').checked);
          return Object.values(res).every(Boolean) ? true : 'EXC не сошлось: ' + Object.keys(res).filter((k) => !res[k]).join(',');
        } finally { if (prev === undefined) delete a.follow; else a.follow = prev; q('#modalBox').isDirty = null; closeModal(); }`,
    ],
    // .mrpack, открытый двойным щелчком: главный процесс отдаёт имя файла, окно спрашивает; отказ ничего не ставит, согласие просит импорт и открывает сборку
    [
      'модпак двойным щелчком: вопрос, отказ и импорт (ответы подставлены)',
      `const res = {}; const ok = (k, f) => { try { res[k] = !!f(); } catch { res[k] = false; } };
        const o2 = window.call; const oc = window.confirm; const calls = []; const asked = []; let answer = false; let pending = null;
        const inst = ${INST}; const prevSel = state.selected;
        window.call = async (ch, ...a) => {
          if (ch === 'app:takePack') { calls.push(ch); const r = pending; pending = null; return r; }
          if (ch === 'instances:importOpened') { calls.push(ch); return { instance: inst, warnings: [] }; }
          return o2(ch, ...a);
        };
        window.confirm = (t) => (asked.push(t), answer);
        try {
          res.none = (await takePackRequest()) === false && !calls.includes('instances:importOpened');
          pending = { name: 'Мой модпак.mrpack' }; answer = false;
          const declined = await takePackRequest();
          ok('declined', () => declined === true && asked[0] === 'Поставить модпак «Мой модпак.mrpack» как новую сборку?' && !calls.includes('instances:importOpened'));
          pending = { name: 'Мой модпак.mrpack' }; answer = true; state.selected = null;
          const done = await takePackRequest(); await s(300);
          ok('imported', () => done === true && calls.includes('instances:importOpened') && state.selected === inst.id && document.querySelector('#toasts').innerText.includes('импортирована'));
          return Object.values(res).every(Boolean) ? true : 'EXC не сошлось: ' + Object.keys(res).filter((k) => !res[k]).join(',');
        } finally { window.call = o2; window.confirm = oc; state.selected = prevSel; showPage('instances'); }`,
    ],
    // «Итоги игры»: настоящий канал game:recap на пустом журнале профиля (проводка main.js: срок, язык, скрытие названий)
    [
      'итоги игры: настоящий ответ главного процесса',
      `const res = {};
        const ru = await call('game:recap', 'week', { lang: 'ru', hideNames: false });
        const en = await call('game:recap', 'month', { lang: 'en', hideNames: true });
        const odd = await call('game:recap', 'год', { lang: 'de' });
        const none = await call('game:recap');
        res.ru = ru.title === 'Итоги недели' && ru.lang === 'ru' && ru.days.length === 7 && ru.empty === true && ru.favourite === null;
        res.en = en.title === 'Monthly recap' && en.lang === 'en' && en.days.length === 30;
        res.odd = odd.period === 'week' && odd.lang === 'ru';
        res.none = none.period === 'week' && none.lang === 'ru';
        return Object.values(res).every(Boolean) ? true : 'EXC не сошлось: ' + Object.keys(res).filter((k) => !res[k]).join(',')`,
    ],
    // «Итоги игры»: рисунок на холсте (текст, котик, пузырь), неделя и месяц, скрытие названий, запоминание выбора
    [
      'итоги игры: неделя, месяц, скрытие названий и запоминание выбора (ответы настоящего ядра)',
      `${RECAP_STUB(RECAP_CARDS('ru', { a: 'Уютное выживание', b: 'Техно' }))}
        const res = {}; const ok = (k, f) => { try { res[k] = !!f(); } catch { res[k] = false; } }; const W = cards.week.show; const M = cards.month.show;
        const px = (x, y) => q('#rcCanvas').getContext('2d').getImageData(x, y, 1, 1).data;
        const whites = (x0, y0, x1, y1) => { let n = 0; for (let x = x0; x < x1; x += 4) for (let y = y0; y < y1; y += 4) { const d = px(x, y); if (d[0] > 235 && d[1] > 235 && d[2] > 235) n++; } return n; };
        const said = () => drawn.join(' | ');
        try {
          localStorage.removeItem('recapOpts');
          W.comment = 'Пусто-пусто. Может, заглянем в мир? 🌙'; // фраза, которая при простом переносе оставляет эмодзи одно на второй строке
          openRecap(); await s(900);
          const cv = q('#rcCanvas');
          ok('size', () => (cv.width === 1080 && cv.height === 1350));
          ok('ask', () => (JSON.stringify(calls[0]) === JSON.stringify(['recap', 'week', { lang: 'ru', hideNames: false }])));
          ok('tTitle', () => (drawn.includes(W.title) && drawn.includes(W.range) && drawn.includes(W.brand)));
          ok('tBig', () => (drawn.includes(W.big) && drawn.includes(W.bigLabel)));
          ok('tDelta', () => (drawn.includes(W.delta.text)));
          ok('tFav', () => (drawn.includes(W.favourite.name) && drawn.includes(W.favourite.label) && drawn.includes(W.favourite.value + ' · ' + W.favourite.percent)));
          ok('tFacts', () => (W.facts.every((f) => drawn.includes(f.label) && drawn.includes(f.value) && (!f.sub || drawn.includes(f.sub)))));
          ok('tDays', () => (W.days.every((d) => drawn.includes(d.label))));
          ok('comment', () => (W.comment.split(' ').every((w) => said().includes(w))));
          const bubble = drawnXY.filter((d) => d[2] > 1150);
          ok('wrap', () => (bubble.length === 2 && bubble.map((d) => d[0]).join(' ') === W.comment && bubble[1][0].length > 8));
          ok('label', () => (cv.getAttribute('aria-label').includes(W.favourite.name) && cv.getAttribute('aria-label').includes(W.title)));
          ok('bg', () => (px(4, 4)[3] === 255 && px(4, 4)[0] < 140 && px(1075, 1345)[3] === 255));
          ok('cat', () => (whites(60, 1130, 260, 1346) > 200));
          ok('bubble', () => (whites(300, 1150, 1000, 1290) > 800));
          ok('note', () => (q('#rcNote').textContent === '' && !q('#rcSave').disabled && !q('#rcCopy').disabled));
          // столбики: у самого длинного дня в середине высокого столбика цвет, у дня без игры в том же месте — фон; сегодняшний выделен другим цветом
          const peakAt = W.days.findIndex((d) => d.ms === Math.max(...W.days.map((x) => x.ms)));
          const zeroAt = W.days.findIndex((d) => d.ms === 0);
          const colX = (i) => Math.round(108 + (864 / 7) * i + 864 / 14);
          ok('bars', () => (px(colX(peakAt), 610)[0] > 140 && (zeroAt < 0 || px(colX(zeroAt), 610)[0] < 120)));
          const a = px(colX(6), 668); const b = px(colX(5), 668);
          ok('today', () => (W.days[6].ms > 0 && W.days[5].ms > 0 && (Math.abs(a[0] - b[0]) > 20 || Math.abs(a[2] - b[2]) > 20)));
          ok('seg', () => (q('#rcPeriod [data-v="week"]').classList.contains('on') && !q('#rcPeriod [data-v="month"]').classList.contains('on') && !q('#rcHide').checked));
          drawn.length = 0; drawnXY.length = 0;
          q('#rcPeriod [data-v="month"]').click(); await s(800);
          ok('month', () => (JSON.stringify(calls.at(-1)) === JSON.stringify(['recap', 'month', { lang: 'ru', hideNames: false }]) && drawn.includes(M.title) && drawn.includes(M.range) && !drawn.includes(W.title)));
          ok('ticks', () => (M.days.filter((d) => d.tick).every((d) => drawn.includes(d.label))));
          ok('keep', () => (JSON.parse(localStorage.getItem('recapOpts')).period === 'month'));
          drawn.length = 0; drawnXY.length = 0;
          q('#rcHide').click(); await s(800);
          ok('hide', () => (calls.at(-1)[2].hideNames === true && !said().includes(M.favourite.name) && !q('#rcCanvas').getAttribute('aria-label').includes(M.favourite.name) && said().includes(M.favourite.value)));
          ok('keepHide', () => (JSON.parse(localStorage.getItem('recapOpts')).hide === true));
          q('#modalBox').isDirty = null; closeModal(); await s(300);
          calls.length = 0; openRecap(); await s(800);
          ok('reopen', () => (q('#rcPeriod [data-v="month"]').classList.contains('on') && q('#rcHide').checked && JSON.stringify(calls[0]) === JSON.stringify(['recap', 'month', { lang: 'ru', hideNames: true }])));
          return Object.values(res).every(Boolean) ? true : 'EXC не сошлось: ' + Object.keys(res).filter((k) => !res[k]).join(',');
        } finally { cleanup(); }`,
    ],
    // «Итоги игры»: сохранение и копирование (что уходит в главный процесс, отмена, ошибки), пустой срок, кнопки на время расчёта, быстрое переключение
    [
      'итоги игры: сохранить, скопировать, отмена, ошибки, пустой срок и быстрое переключение',
      `${RECAP_STUB(RECAP_CARDS('ru', { a: 'Уютное выживание', b: 'Техно' }))}
        const res = {}; const ok = (k, f) => { try { res[k] = !!f(); } catch { res[k] = false; } }; const toasts = () => [...document.querySelectorAll('#toasts .toast')];
        try {
          localStorage.removeItem('recapOpts');
          openRecap(); await s(900);
          q('#rcSave').click(); await s(500);
          const sv = calls.find((c) => c[0] === 'save');
          ok('save', () => (!!sv && sv[1].startsWith('data:image/png;base64,') && sv[1].length > 5000 && JSON.stringify(sv[2]) === JSON.stringify({ period: 'week', lang: 'ru' })));
          let im = null; try { im = new Image(); im.src = sv[1]; await im.decode(); } catch {}
          ok('png', () => (im.naturalWidth === 1080 && im.naturalHeight === 1350));
          ok('savedToast', () => (toasts().some((t) => t.textContent.includes('Картинка сохранена'))));
          const n = toasts().length; st.saved = null; q('#rcSave').click(); await s(400);
          ok('cancel', () => (toasts().length === n && calls.filter((c) => c[0] === 'save').length === 2));
          q('#rcCopy').click(); await s(500);
          const cp = calls.find((c) => c[0] === 'copy');
          ok('copy', () => (!!cp && cp[1].startsWith('data:image/png;base64,') && toasts().some((t) => t.textContent.includes('Картинка скопирована'))));
          const errs = () => toasts().filter((t) => t.classList.contains('err') && t.textContent.includes('Это не PNG-картинка')).length;
          st.fail = 'Это не PNG-картинка'; q('#rcSave').click(); await s(400);
          ok('errSave', () => (errs() === 1));
          q('#rcCopy').click(); await s(400);
          ok('errCopy', () => (errs() === 2));
          st.fail = null; st.delay = { month: 300 };
          q('#rcPeriod [data-v="month"]').click(); await s(60);
          ok('locked', () => (q('#rcSave').disabled && q('#rcCopy').disabled));
          await s(700);
          ok('unlocked', () => (!q('#rcSave').disabled && !q('#rcCopy').disabled));
          q('#rcSave').click(); await s(300);
          ok('saveMonth', () => (JSON.stringify(calls.filter((c) => c[0] === 'save').at(-1)[2]) === JSON.stringify({ period: 'month', lang: 'ru' })));
          st.delay = { month: 600, week: 20 }; calls.length = 0;
          q('#rcPeriod [data-v="week"]').click(); await s(30); q('#rcPeriod [data-v="month"]').click(); await s(60); q('#rcPeriod [data-v="week"]').click(); await s(1000);
          const label = q('#rcCanvas').getAttribute('aria-label') || '';
          ok('race', () => (label.includes(cards.week.show.title) && !label.includes(cards.month.show.title) && q('#rcPeriod [data-v="week"]').classList.contains('on') && !q('#rcSave').disabled));
          st.empty = true; q('#rcHide').click(); await s(700);
          ok('empty', () => (q('#rcNote').textContent.includes('игр ещё не было') && !q('#rcSave').disabled && q('#rcCanvas').getAttribute('aria-label').includes(cards.empty.title)));
          st.empty = false; q('#rcHide').click(); await s(700);
          ok('back', () => (q('#rcNote').textContent === ''));
          return Object.values(res).every(Boolean) ? true : 'EXC не сошлось: ' + Object.keys(res).filter((k) => !res[k]).join(',');
        } finally { cleanup(); }`,
    ],
    // «Итоги игры»: помощники рисования на настоящем холсте окна: подгонка размера, обрезка длинных названий (эмодзи не рвём), ровный перенос строк
    [
      'итоги игры: подгонка шрифта, обрезка названий и ровный перенос строк',
      `const res = {}; const c = document.createElement('canvas').getContext('2d');
        await rcFonts();
        const f = (px) => '700 ' + px + 'px Comfortaa, Nunito, sans-serif';
        c.font = f(32);
        const wide = 'W'.repeat(40); const cut = rcCut(c, wide, 600);
        res.cutEnds = cut.endsWith('…') && cut.length < wide.length && cut.length > 3;
        c.font = f(32); res.cutFits = c.measureText(cut).width <= 600;
        res.cutShort = rcCut(c, 'Ванилька', 600) === 'Ванилька';
        const flowers = '🌸'.repeat(60); const cutF = rcCut(c, flowers, 300);
        res.cutEmoji = cutF.endsWith('…') && !/[\\uD800-\\uDBFF](?![\\uDC00-\\uDFFF])|(?<![\\uD800-\\uDBFF])[\\uDC00-\\uDFFF]/.test(cutF) && [...cutF].length > 2;
        res.cutOne = rcCut(c, 'WWWW', 1) === 'W…';
        const big = rcFit(c, 'Очень длинная строка, которая не влезает', f, 132, 700, 22);
        c.font = f(big); res.fitFits = big < 132 && big >= 24 && c.measureText('Очень длинная строка, которая не влезает').width <= 700;
        res.fitSmall = rcFit(c, 'Привет', f, 40, 900, 22) === 40;
        res.fitFloor = rcFit(c, 'W'.repeat(80), f, 40, 50, 22) === 22;
        c.font = '800 34px Nunito, "Segoe UI", sans-serif';
        const text = 'Пусто-пусто. Может, заглянем в мир? 🌙';
        const greedy = rcWrap(c, text, 642); const even = rcWrapEven(c, text, 642);
        res.same = greedy.length === 2 && even.length === 2;
        res.even = even.length === 2 && even[1].length > 8 && even.join(' ') === text;
        res.oneLine = rcWrapEven(c, 'Привет!', 642).join('|') === 'Привет!';
        res.keepWords = rcWrapEven(c, 'Ого, сколько всего построено! Попей водички 💧', 642).join(' ') === 'Ого, сколько всего построено! Попей водички 💧';
        return Object.values(res).every(Boolean) ? true : 'EXC не сошлось: ' + Object.keys(res).filter((k) => !res[k]).join(',')`,
    ],
    // «Итоги игры»: кнопка в карточке «Время в игре» (только когда есть данные) и действие в Ctrl+K
    [
      'итоги игры: кнопка в «Время в игре» и действие в Ctrl+K',
      `const q = (sel) => document.querySelector(sel); const res = {}; const H = 3600e3;
        const ok = (k, f) => { try { res[k] = !!f(); } catch { res[k] = false; } };
        const clear = async () => { q('#modalBox').isDirty = null; closeModal(); await s(350); q('#modalBox').innerHTML = ''; }; // закрытое окно хранит разметку: без очистки «открылось» видно и по остаткам прошлого
        const day0 = new Date(); day0.setHours(0, 0, 0, 0);
        const week = [...Array(7)].map((_, i) => { const d = new Date(day0); d.setDate(d.getDate() - (6 - i)); return { at: d.getTime(), ms: H }; });
        try {
          await clear();
          showPage('settings'); showSection('kitty'); await s(600);
          renderPlayStats({ since: null, sessions: 0, total: 0, longest: 0, week, weekTotal: 0, byInstance: [] });
          ok('hiddenWhenEmpty', () => !q('#psBody [data-act="recap"]'));
          renderPlayStats({ since: Date.now(), sessions: 2, total: 2 * H, longest: H, week, weekTotal: 2 * H, byInstance: [] });
          ok('button', () => !!q('#psBody [data-act="recap"]') && q('#psBody [data-act="recap"]').textContent.includes('Итоги недели и месяца'));
          q('#psBody [data-act="recap"]')?.click(); await s(800);
          ok('opened', () => !!q('#rcCanvas') && q('#modal').classList.contains('open'));
          await clear();
          showPage('instances'); await s(300);
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true, bubbles: true })); await s(600);
          const inp = q('#palInput'); inp.value = 'итоги'; inp.dispatchEvent(new Event('input', { bubbles: true })); await s(400);
          ok('palette', () => q('#palList').innerText.includes('Итоги недели и месяца (картинка)'));
          inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })); await s(900);
          ok('paletteOpens', () => !!q('#rcCanvas') && q('#modal').classList.contains('open'));
          return Object.values(res).every(Boolean) ? true : 'EXC не сошлось: ' + Object.keys(res).filter((k) => !res[k]).join(',');
        } finally { localStorage.removeItem('recapOpts'); q('#modalBox').isDirty = null; closeModal(); showPage('instances'); }`,
    ],
    ['восстановление обновления: резервная запись и безопасный отказ', `
      const originalCall = window.call;
      let mode = 'ready', recovered = 0, opened = 0, failOnce = true;
      window.call = async (ch, ...args) => {
        if (ch === 'packs:recoveryStatus') return mode === 'ready' ? { pending: true, canRecover: true, source: 'backup' } : mode === 'blocked' ? { pending: true, canRecover: false, reason: 'FIXTURE <img id="recovery-x">' } : { pending: false };
        if (ch === 'packs:recover') { if (failOnce) { failOnce = false; throw new Error('FIXTURE retry'); } recovered++; mode = 'none'; return { recovered: true }; }
        if (ch === 'packs:recoveryFolder') { opened++; return ''; }
        return originalCall(ch, ...args);
      };
      try {
        const inst = ${INST}; openDetails(inst, 'more'); await s(700);
        const recover = document.querySelector('[data-m="recoverupdate"]');
        if (!recover || !document.querySelector('#updateRecovery').innerText.includes('Прерванное обновление')) return false;
        recover.click(); await s(300); if (recover.disabled) return false;
        recover.click(); await s(900);
        if (recovered !== 1 || document.querySelector('[data-m="recoverupdate"]')) return false;
        mode = 'blocked'; renderMore(inst, document.querySelector('#detBody')); await s(600);
        if (document.querySelector('[data-m="recoverupdate"]') || document.querySelector('#recovery-x')) return false;
        const folder = document.querySelector('[data-m="recoveryfiles"]'); if (!folder) return false;
        folder.click(); await s(200);
        return opened === 1 && document.querySelector('#updateRecovery').innerText.includes('FIXTURE');
      } finally { window.call = originalCall; document.querySelector('#modalBox').isDirty = null; closeModal(); }
    `],
    ['приватность: фоновые обновления и локальный текст RU/EN', `
      const originalCall = window.call;
      let policyOpened = 0;
      window.call = async (ch, ...args) => { if (ch === 'app:privacy') { policyOpened++; return ''; } return originalCall(ch, ...args); };
      const old = state.settings.backgroundUpdateChecks;
      try {
        showPage('settings'); await s(300);
        const toggle = document.querySelector('#backgroundUpdateChecks');
        if (!toggle || !document.querySelector('#openPrivacy')) return false;
        toggle.checked = false; toggle.dispatchEvent(new Event('change')); await s(300);
        if (state.settings.backgroundUpdateChecks !== false) return false;
        document.querySelector('#openPrivacy').click(); await s(100);
        toggle.checked = true; toggle.dispatchEvent(new Event('change')); await s(300);
        return policyOpened === 1 && state.settings.backgroundUpdateChecks === true;
      } finally { window.call = originalCall; await saveSettings({backgroundUpdateChecks: old !== false}); }
    `],
    ['сезонное оформление', `
      const oldSettings = { ...state.settings };
      const realSeason = season;
      try {
        state.settings = { ...state.settings, seasonal: true, mascotAccessory: 'none', eco: 'off', motion: 'on' };
        season = () => 'winter'; applyTheme();
        if (root.dataset.season !== 'winter' || document.querySelectorAll('.fx.snow').length !== 24) return false;
        if (getComputedStyle(document.querySelector('#mascot .acc-winter')).display === 'none') return false;
        state.settings.mascotAccessory = 'bow'; applyTheme();
        if (getComputedStyle(document.querySelector('#mascot .acc-winter')).display !== 'none') return false;
        state.settings.motion = 'off'; applyTheme();
        if (document.querySelectorAll('.fx.snow').length) return false;
        state.settings.motion = 'on'; state.settings.eco = 'on'; applyTheme();
        if (document.querySelectorAll('.fx.snow').length) return false;
        state.settings.eco = 'off'; state.settings.seasonal = false; applyTheme();
        if (root.dataset.season || document.querySelectorAll('.fx.snow').length) return false;
        state.settings.seasonal = true; season = () => ''; refreshSeason();
        if (root.dataset.season) return false;
        season = () => 'newyear'; refreshSeason();
        return root.dataset.season === 'newyear';
      } finally { season = realSeason; state.settings = oldSettings; applyTheme(); }
    `],
    // Последней: русский на лету обратно не включить
    ['английский: проверка игры с другом', FRIEND_CHECK_EN],
  ];
}

module.exports = { DIALOGS, extra, COLLECTION, COLLECTION_TABLE, COLLECTION_VERSIONS }; // последние три — ещё и для скриптов со снимками окна
