// Игра с другом по сети (мод e4mc)

/* ---------- играть с другом (мод e4mc) ---------- */
// Друзья: один список на все сборки (state.friends, его хранит главный процесс, core/friends.js). У друга есть галочка «пустить в этот мир»
// и пометка «без лицензии»; в белый список попадают только отмеченные
const tickedFriends = () => (state.friends || []).filter((f) => f.on);
const friendNicks = () => tickedFriends().map((f) => f.nick);
const friendsOffline = () => tickedFriends().some((f) => f.offline);

// Раньше ники друзей помнила каждая сборка отдельно (localStorage «friend:<номер>»). Один раз переносим их в общий список:
// отмечены ники сборки, у которой открыли окно, остальные просто попадают в список. «Без лицензии» переходит как было
const splitLegacy = (s) => [...new Set(String(s || '').split(/[\s,;]+/).filter(Boolean))];
async function migrateLegacyFriends(inst) {
  try {
    if (localStorage.getItem('friendsMigrated')) return;
    const entries = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith('friend:')) continue;
      const o = JSON.parse(localStorage.getItem(key)) || {};
      for (const nick of Array.isArray(o.nicks) ? o.nicks : splitLegacy(o.nick)) entries.push({ nick, offline: !!o.offline, on: key === 'friend:' + inst.id });
    }
    if (entries.length) state.friends = (await call('friends:import', entries)).friends;
    localStorage.setItem('friendsMigrated', '1');
  } catch {}
}

// Что вышло с белым списком. Запущенная игра читает файл только после /whitelist reload
function whitelistToast(r, id, nicks) {
  if (r.noLicense?.length) toast(`Лицензионного аккаунта нет у ${r.noLicense.join(', ')} — записала как друзей без лицензии`);
  if (r.unchecked?.length) toast(`Не смогла узнать UUID у ${r.unchecked.join(', ')} (нет связи с Mojang): нажми «Подготовить» ещё раз, когда связь появится`, 'err');
  if (!r.added.length && !r.removed.length) return;
  toast(`Белый список записан: ${nicks.join(', ')} ♡`);
  if (state.running.has(id)) toast('Игра уже запущена: список подхватится, когда откроешь мир; если мир уже открыт — введи в её чате /whitelist reload');
}
const frRow = (f) => `<div class="fr-row ${f.on ? 'on' : ''}" data-nick="${esc(f.nick)}">
    <label class="fr-pick"><input type="checkbox" data-fr="on" ${f.on ? 'checked' : ''}><span class="fr-nick">${esc(f.nick)}</span></label>
    <button type="button" class="fr-lic ${f.offline ? 'off' : ''}" data-fr="lic" title="Нажми, чтобы поменять: с лицензией или без">${f.offline ? 'без лицензии' : 'с лицензией'}</button>
    <button type="button" class="fr-del" data-fr="del" title="Убрать из списка друзей">✕</button>
  </div>`;

function openFriendModal(inst) {
  const box = openModal(`
    <div class="crash-head"><div class="empty-cat" data-cat></div><div><h2>Играть с другом 💞</h2><p class="sub">Без настройки роутера и своего сервера</p></div></div>
    <ol class="friend-steps">
      <li>Нажми «Подготовить» — поставлю в сборку бесплатный мод <b>e4mc</b>.</li>
      <li>Запусти игру, зайди в мир, нажми <b>Esc → «Открыть для сети» → «Начать»</b>.</li>
      <li>Я поймаю адрес вида <code>xxx.e4mc.link</code> и сразу скопирую его — отправь другу.</li>
      <li>У друга должны быть такие же моды: отправь ему адрес и «Код сборки» (кнопка ниже). В лаунчере он нажмёт «Войти к другу», вставит сообщение, и я сверю его моды с твоими и поставлю недостающее. Без лаунчера: «Сетевая игра → Прямое подключение» и адрес.</li>
    </ol>
    <div class="fr-book">
      <div class="fr-head"><b>Друзья</b><small>галочка — пустить в этот мир</small></div>
      <div class="fr-list" id="frList"></div>
      <div class="fr-add">
        <input id="frNick" maxlength="16" placeholder="ник друга, например PinkCat_" spellcheck="false" autocomplete="off">
        <label class="toggle"><input type="checkbox" id="frOffline"><span class="knob"></span>без лицензии</label>
        <button class="btn soft sm" id="frAdd">Добавить</button>
      </div>
    </div>
    <p class="hint" id="frOfflineHint" hidden>В игре в окне «Открыть для сети» поставь <b>Online Mode → Disable + UUID Fixer</b>: проверки лицензии не будет, а у друзей с лицензией сохранятся их вещи и скины. Без проверки игра узнаёт всех только по нику: кто знает адрес и чей-то ник, сможет зайти вместо него — отправляй адрес только своим, лично. Скин офлайн-друга вы, скорее всего, увидите стандартным.</p>
    <p class="hint" id="frCaseHint" hidden>Ник друга без лицензии пиши точь-в-точь, как у него в игре: заглавные и строчные буквы считаются.</p>
    <p class="hint" id="frWlHint">Отмеченных друзей я запишу в белый список сама — когда игру запустят отсюда («Играть ♡») или нажмут «Подготовить»; для этого поставлю ещё мод <b>LAN World Plug-n-Play</b>. <span id="frClearHint">Список живёт один мир: когда мир закроется, лаунчер его очистит, а друзья останутся в этом списке.</span></p>
    <div class="modal-actions wrap"><button class="btn ghost" id="frClose">Закрыть</button><button class="btn soft" id="frCode" title="Короткий текст со списком твоих модов: друг вставит его в «Войти к другу», и лаунчер поставит ему такие же. В код попадают только версия игры, загрузчик и id модов на Modrinth: ни путей, ни названия сборки, ни аккаунтов">📋 Код сборки</button><button class="btn soft" id="frCheck" title="Заранее проверю, получится ли открыть мир для друга: интернет, моды, UDP, белый список">Проверить</button><button class="btn soft" id="frPrep">Подготовить</button><button class="btn primary" id="frPlay">Играть ♡</button></div>`);
  box.classList.add('sticky-actions'); // подсказки длинные: кнопки внизу остаются на виду, пока окно прокручивается
  const list = $('#frList', box);
  const resetPrep = () => {
    // Что-то поменялось — сборку можно подготовить заново
    $('#frPrep', box).disabled = false;
    $('#frPrep', box).textContent = 'Подготовить';
  };
  // Строки списка и подсказки, которые зависят от отмеченных друзей
  const paint = () => {
    if (!$('#frList', box)) return; // окно успели закрыть или открыть другое
    const items = state.friends || [];
    list.innerHTML = items.length ? items.map(frRow).join('') : '<p class="hint fr-empty">Список пока пуст: впиши ник друга ниже ♡</p>';
    const offline = friendsOffline();
    $('#frOfflineHint', box).hidden = !offline;
    $('#frCaseHint', box).hidden = !offline;
    $('#frWlHint', box).hidden = !tickedFriends().length;
    $('#frClearHint', box).hidden = state.settings.clearWhitelist === false;
  };
  // Любое изменение списка идёт через главный процесс; он же проверяет ник и лицензию. Что он заметил про лицензию, говорим уведомлением
  const change = async (nick, fn) => {
    try {
      const r = await fn();
      state.friends = r.friends;
      if (r.note === 'no-license') toast(`Лицензионного аккаунта «${nick}» нет — записала друга как «без лицензии»`);
      else if (r.note === 'unchecked') toast(`Не смогла проверить, есть ли лицензия у «${nick}»: если нет, отметь «без лицензии»`, 'err');
      resetPrep();
      paint();
      return true;
    } catch (err) {
      toast(err.message, 'err');
      return false;
    }
  };
  const addFriend = async () => {
    const input = $('#frNick', box);
    const nick = input.value.trim();
    if (!nick) return input.focus();
    if (!NAME_RE.test(nick)) return toast(`Ник «${nick}»: 3–16 символов, латиница, цифры и _`, 'err');
    const btn = $('#frAdd', box);
    btn.disabled = true;
    const ok = await change(nick, () => call('friends:add', { nick, offline: $('#frOffline', box).checked }));
    btn.disabled = false;
    if (!ok || !$('#frNick', box)) return;
    input.value = '';
    $('#frOffline', box).checked = false;
    input.focus();
  };
  migrateLegacyFriends(inst).then(paint);
  paint();
  $('#frClose', box).onclick = closeModal;
  $('#frCheck', box).onclick = () => openFriendCheck(inst);
  $('#frCode', box).onclick = (e) => copyCodeButton(e.currentTarget, inst);
  $('#frAdd', box).onclick = addFriend;
  $('#frNick', box).onkeydown = (e) => e.key === 'Enter' && addFriend();
  list.onchange = (e) => {
    const cb = e.target.closest('[data-fr="on"]');
    if (!cb) return;
    const nick = cb.closest('.fr-row').dataset.nick;
    change(nick, () => call('friends:update', nick, { on: cb.checked }));
  };
  list.onclick = (e) => {
    const b = e.target.closest('button[data-fr]');
    if (!b) return;
    const nick = b.closest('.fr-row').dataset.nick;
    if (b.dataset.fr === 'del') change(nick, () => call('friends:remove', nick));
    else change(nick, () => call('friends:update', nick, { offline: !(state.friends || []).find((f) => f.nick === nick)?.offline }));
  };
  $('#frPrep', box).onclick = async (e) => {
    const nicks = friendNicks();
    e.target.disabled = true;
    e.target.textContent = 'Ставлю…';
    try {
      const r = await call('instances:friend', inst.id);
      if (r.friends) state.friends = r.friends;
      (r.notes || []).forEach((n) => toast(n));
      (r.warnings || []).forEach((w) => toast(w, 'err'));
      if (r.whitelist) whitelistToast(r.whitelist, inst.id, nicks);
      e.target.textContent = 'Готово ✓';
      toast('e4mc стоит — можно звать друга ♡');
      await refresh();
      paint(); // друг без лицензии в Mojang мог найтись или нет: пометки в списке обновились
    } catch (err) {
      e.target.disabled = false;
      e.target.textContent = 'Подготовить';
      toast(err.message, 'err');
    }
  };
  $('#frPlay', box).onclick = () => {
    closeModal();
    selectInstance(inst.id);
    play({ friends: true });
  };
}

/* ---------- проверка перед игрой с другом ---------- */
// instances:friendCheck присылает коды и данные, а тексты — здесь. Каждая фраза собрана из постоянных кусков и <code> со значениями:
// куски целиком есть в словаре переводов (i18n.js), поэтому английский вариант получается без правил
const fcCode = (v) => `<code>${esc(v)}</code>`;
const FC_TITLE = {
  e4mc: 'Мод e4mc',
  lan: 'Мод LAN World Plug-n-Play',
  route: 'Как игра выходит в интернет',
  broker: 'Сервер адресов e4mc',
  udp: 'Связь с ретранслятором (UDP)',
  whitelist: 'Белый список',
};
// Почему сеть не ответила — одной фразой
const FC_WHY = {
  timeout: 'не ответил за 8 секунд',
  'udp-timeout': 'ответа нет за 3 секунды',
  dns: 'адрес не находится (DNS)',
  refused: 'соединение отклонено',
  reset: 'соединение сброшено',
  tls: 'сертификат не прошёл проверку',
  proxy: 'прокси не пустил дальше',
  http: 'сервер ответил ошибкой',
  'bad-answer': 'ответ сервера не разобрать',
  other: 'не достучаться',
};
const fcWhy = (reason, status) => `<i class="fc-why">Причина: ${esc(FC_WHY[reason] || FC_WHY.other)}${reason === 'http' && status ? ` ${fcCode(status)}` : ''}</i>`;
const fcWorlds = (w) => `${w.length > 1 ? 'В мирах' : 'В мире'} ${fcCode(w.join(', '))}`;
const FC_ROW = {
  'mod-e4mc-ok': () => 'Стоит и включён.',
  'mod-e4mc-off': () => 'Стоит, но выключен: включи его в списке модов сборки.',
  'mod-e4mc-missing': () => 'Не стоит: нажми «Назад», а потом «Подготовить» — мод поставится сам.',
  'mod-lan-ok': () => 'Стоит и включён: белый список и друзья без лицензии заработают.',
  'mod-lan-off': () => 'Стоит, но выключен: без него не работают белый список и вход без лицензии. Включи его в списке модов сборки.',
  'mod-lan-missing': () => 'Не стоит, а нужен для белого списка и друзей без лицензии: нажми «Назад», а потом «Подготовить».',
  'route-direct': () => 'Игра ходит в интернет напрямую: прокси не настроен.',
  'route-proxy': (d) => `Игра пойдёт через HTTP-прокси ${fcCode(`${d.host}:${d.port}`)} — лаунчер сам передаёт его игре.`,
  'route-dead': (d) => `HTTP-прокси ${fcCode(`${d.host}:${d.port}`)} не отвечает, и игра пойдёт напрямую. Если сеть открывается только через VPN — включи его.`,
  'route-unsupported': (d) => `В Windows настроен прокси типа ${fcCode(d.kind)} — Java такие не понимает, и игра пойдёт напрямую.`,
  'broker-ok': (d) => `Ответил за ${fcCode(`${d.ms} мс`)} ${d.via === 'proxy' ? 'через прокси' : 'напрямую'} — игра получит адрес для друга.`,
  'broker-off': (d) => `Сервер адресов выключен в настройках e4mc — мод идёт сразу к ретранслятору ${fcCode(d.host)}.`,
  'broker-bad-answer': () => 'Ответил, но с неожиданным адресом ретранслятора — мод может не открыть мир.',
  'broker-fail-other-ok': (d) => `Через прокси не достучаться, а напрямую получается — игре лучше идти напрямую: выключи прокси в Windows и в настройках лаунчера или почини его. ${fcWhy(d.reason)}`,
  'broker-fail': (d) =>
    `${d.via === 'proxy' ? 'Не достучаться ни через прокси, ни напрямую — игра не получит адрес для друга. Проверь интернет, VPN и прокси.' : 'Напрямую не достучаться — игра не получит адрес для друга. Включи VPN или впиши рабочий HTTP-прокси в настройках лаунчера.'} ${fcWhy(d.reason, d.status)}`,
  'udp-ok': (d) => `Ретранслятор ${fcCode(d.host)} ответил за ${fcCode(`${d.ms} мс`)} — мир сможет с ним соединиться.`,
  'udp-fail': (d) =>
    `UDP до ретранслятора ${fcCode((d.hosts || []).join(', '))} не доходит — мир для друга не откроется. Так бывает, когда сеть или провайдер режут UDP: попробуй другую сеть или VPN, который пропускает UDP (HTTP-прокси для этого не годится). ${fcWhy(d.reason === 'timeout' ? 'udp-timeout' : d.reason)}`,
  'wl-enforced-empty': (d) => `${fcWorlds(d.worlds)} включён белый список, а ников друзей нет — кроме тебя никто не зайдёт. Впиши ники в «Играть с другом» или выключи переключатель «Белый список» в окне «Открыть для сети».`,
  'wl-enforced': (d) => `${fcWorlds(d.worlds)} белый список включён: зайдут только ники из whitelist.json. Друзей без лицензии лаунчер впишет сам, остальным введи в чате игры ${fcCode('/whitelist add Ник')} — команды покажу, когда мир откроется.`,
  'wl-ready': (d) => `Лаунчер впишет друзей в белый список сам, когда игру запустят из окна «Играть с другом» («Играть ♡») или нажмут «Подготовить»: ${fcCode((d.nicks || []).join(', '))}.`,
  'wl-broken': () => 'Файл whitelist.json повреждён — белый список не заработает. Удали его или нажми «Назад» и «Подготовить» (для друзей без лицензии): файл перепишется, а старый останется рядом (.broken).',
  'probe-error': (d) => `Не получилось проверить — ${fcCode(d.message || '')}`,
};
const FC_VERDICT = {
  ok: ['ok', 'Всё готово: можно открывать мир для друга ♡'],
  warn: ['warn', 'Должно получиться, но есть замечания — они ниже.'],
  fail: ['bad', 'Сейчас не получится: исправь красные пункты ниже.'],
};
function fcRow(i) {
  let text;
  try {
    text = FC_ROW[i.code]?.(i.data || {});
  } catch {}
  const cls = i.status === 'ok' ? 'ok' : i.status === 'warn' ? 'warn' : 'bad';
  return `<div class="nc-row fc ${cls}"><span class="nc-dot"></span><div class="nc-name"><b>${esc(FC_TITLE[i.id] || i.id)}</b><small>${text || 'Не получилось разобрать ответ проверки.'}</small></div></div>`;
}
function openFriendCheck(inst) {
  const box = openModal(`
    <div class="crash-head"><div class="empty-cat" data-cat></div><div><h2>Проверка игры с другом 🩺</h2><p class="sub">${esc(inst.name)}</p></div></div>
    <p class="fc-verdict" id="fcVerdict"></p>
    <div class="nc-list fc-list" id="fcList"></div>
    <div class="modal-actions"><button class="btn ghost" id="fcBack">Назад</button><button class="btn soft" id="fcCopy" disabled>Скопировать</button><button class="btn primary" id="fcAgain" disabled>Проверить ещё раз</button></div>`);
  const list = $('#fcList', box);
  const verdict = $('#fcVerdict', box);
  const again = $('#fcAgain', box);
  const copy = $('#fcCopy', box);
  $('#fcBack', box).onclick = () => openFriendModal(inst);
  // Отчёт для чата: то, что видно в окне, обычным текстом
  copy.onclick = () => {
    const mark = { ok: '✓', warn: '!', bad: '✗' };
    const rows = [...list.children].map((r) => `${mark[['ok', 'warn', 'bad'].find((c) => r.classList.contains(c))] || '·'} ${r.querySelector('b').innerText}: ${r.querySelector('small').innerText.replace(/\s*\n\s*/g, ' ')}`);
    const text = [`${$('h2', box).innerText} — ${inst.name}`, ...rows, verdict.innerText].join('\n');
    call('app:copyText', text).then(() => toast('Скопировано ✧'));
  };
  const run = async () => {
    again.disabled = copy.disabled = true;
    verdict.textContent = '';
    verdict.className = 'fc-verdict';
    list.innerHTML = '<div class="nc-row wait"><span class="nc-dot"></span><b>Проверяю…</b></div>';
    let r;
    try {
      r = await call('instances:friendCheck', inst.id); // кого пускать, решает список друзей (главный процесс читает его сам)
    } catch (err) {
      if (!list.isConnected) return;
      list.innerHTML = '';
      verdict.textContent = err.message;
      verdict.className = 'fc-verdict bad';
      again.disabled = false;
      return;
    }
    if (!list.isConnected) return; // окно успели закрыть или открыть другое
    list.innerHTML = r.items.map(fcRow).join('');
    const [tone, text] = FC_VERDICT[r.verdict] || FC_VERDICT.warn;
    verdict.textContent = text;
    verdict.className = 'fc-verdict ' + tone;
    again.disabled = copy.disabled = false;
  };
  again.onclick = run;
  run();
}

// Кто из друзей сейчас в мире: главный процесс читает это из лога игры и присылает весь список целиком. Сами заходы и выходы приходят уведомлениями
const guestsLine = (list) => (list?.length ? `Сейчас в мире: <b>${esc(list.join(', '))}</b>` : 'Пока никто не зашёл');
function onGuests({ id, guests }) {
  state.guests[id] = Array.isArray(guests) ? guests : [];
  const el = $('#shGuests');
  if (el?.dataset.id === id) el.innerHTML = guestsLine(state.guests[id]);
}
api.on('game:players', onGuests);

// Прямые адреса для входа по локальной сети или через VPN, который есть и у тебя, и у друга (core/lanaddress.js): строки с кнопкой «Скопировать»
const lanRows = (list) =>
  list.map((a) => `<div class="share-addr cmd"><code>${esc(a.address)}</code><span class="chip">${esc(a.kind === 'ipv6' ? 'IPv6' : a.name)}</span><button class="btn soft sm" data-copy="${esc(a.address)}">Скопировать</button></div>`).join('');
const onCopyClick = (e) => {
  const t = e.target.closest('[data-copy]')?.dataset.copy;
  if (t) call('app:copyText', t).then(() => toast('Скопировано ✧'));
};
// Когда e4mc не вышел, а напрямую по сети друг зайти может: окно только с этими адресами (в одно время с красным уведомлением про e4mc)
api.on('game:lan', (e) => showLanAddresses(e));
function showLanAddresses({ addresses }) {
  if ($('#modal').classList.contains('open') || !addresses?.length) return;
  const box = openModal(`
    <h2>Мир открыт по сети 🔌</h2>
    <p>Адрес e4mc сейчас недоступен, но друг в той же сети или VPN (Radmin VPN, Hamachi…) может зайти напрямую — в «Сетевая игра → Прямое подключение»:</p>
    ${lanRows(addresses)}
    <p class="hint">Адрес действует, пока мир открыт. Если друг не заходит, проверь, что вы в одной сети или в одной VPN-комнате, и разреши Java в брандмауэре Windows. Белый список, если он включён, действует и здесь.</p>
    <div class="modal-actions"><button class="btn primary" id="lnOk">Понятно ♡</button></div>`);
  box.onclick = onCopyClick;
  $('#lnOk', box).onclick = closeModal;
}

// Мод e4mc открыл мир — показываем и копируем адрес, а с ником друга — ещё и команды белого списка
api.on('game:share', (e) => showFriendShare(e));
async function showFriendShare({ id, address, whitelist, lan }) {
  await call('app:copyText', address).catch(() => {});
  toast(`Адрес для друга скопирован: ${address} ♡`);
  say('мир открыт для друга! адрес уже скопирован 💞', 7000);
  hearts(8);
  if ($('#modal').classList.contains('open')) return;
  const nicks = friendNicks();
  const offline = friendsOffline();
  // Кого мир пускает на самом деле: лаунчер прочитал whitelist.json, когда мир открылся. Белый список живёт один мир, поэтому друзья
  // из списка сами в него не попадают: их записывает «Играть ♡»/«Подготовить» или команда в игре
  const written = Array.isArray(whitelist) ? [...new Set(whitelist)] : []; // у друга с лицензией две записи под одним ником
  const listed = written.length > 0;
  const oneWorld = state.settings.clearWhitelist !== false; // список очистится, когда мир закроется
  const me = activeAccount()?.name;
  const cmds = !listed && nicks.length ? [...new Set([me, ...nicks].filter(Boolean))].map((n) => `/whitelist add ${n}`).concat('/whitelist on') : [];
  const copyCmd = (c) => `<div class="share-addr cmd"><code>${esc(c)}</code><button class="btn soft sm" data-copy="${esc(c)}">Скопировать</button></div>`;
  const notes = listed
    ? `<p>Белый список записан: <b>${esc(written.join(', '))}</b>. Ник друга без лицензии должен совпадать с ником у него в игре буква в букву, с заглавными.</p>
       <p class="hint">Он работает, пока в окне «Открыть для сети» включён переключатель «Белый список» (Whitelist): выключишь его — зайдёт любой, у кого есть адрес. Если друга не пускает с надписью «нет в белом списке», проверь ник и этот переключатель.</p>`
    : offline && nicks.length
      ? `<p>Белый список пуст: друзей из списка лаунчер записывает, когда игру запускают из окна «Играть с другом» («Играть ♡») или нажимают «Подготовить». Сейчас нажми там «Подготовить» и введи в чате игры (T):</p>
         ${copyCmd('/whitelist reload')}
         <p class="hint">Ник друга без лицензии пиши точь-в-точь, как у него в игре: заглавные и строчные буквы считаются.</p>`
      : cmds.length
        ? `<p>Чтобы зашли только <b>${esc(nicks.join(', '))}</b>, введи в чат игры (T) по очереди:</p>
         ${cmds.map(copyCmd).join('')}
         <p class="hint">Если команды не срабатывают — при «Открыть для сети» включи «Разрешить читы».</p>`
        : `<p class="hint">Совет: укажи ники друзей в «Играть с другом» — тогда в мир пустит только их.</p>
         <p class="hint">Если друга не пускает с надписью «нет в белом списке», выключи переключатель «Белый список» (Whitelist) в окне «Открыть для сети».</p>`;
  const box = openModal(`
    <h2>Мир открыт для друга 💞</h2>
    <p>Отправь другу этот адрес — он вставит его в «Сетевая игра → Прямое подключение»:</p>
    <div class="share-addr"><code>${esc(address)}</code><button class="btn soft sm" data-copy="${esc(address)}">Скопировать</button></div>
    <p class="hint" id="shGuests" data-id="${esc(id)}">${guestsLine(state.guests[id])}</p>
    ${notes}
    ${offline ? '<p class="hint warn">Кто-то без лицензии: в окне «Открыть для сети» выбери Online Mode → Disable + UUID Fixer. Игра проверяет только ники — не показывай адрес на стримах и скриншотах. Если зашёл кто-то чужой — <code>/kick Ник</code> и <code>/ban Ник</code>, а лучше выйди из мира: адрес перестанет работать.</p>' : ''}
    ${Array.isArray(lan) && lan.length ? `<p class="hint">Не заходит по адресу e4mc? Друг в той же сети или VPN (Radmin VPN, Hamachi…) может зайти напрямую — в «Сетевая игра → Прямое подключение»:</p>${lanRows(lan)}` : ''}
    <p class="hint">${oneWorld ? 'Адрес и белый список работают, пока ты в этом мире: когда закроешь его, список очистится. У друга должна быть такая же сборка.' : 'Адрес работает, пока ты в этом мире. У друга должна быть такая же сборка.'}</p>
    <div class="modal-actions wrap"><button class="btn soft" id="shCode" title="Скопирует адрес и код сборки одним сообщением: друг вставит его в «Войти к другу», и лаунчер сверит его моды с твоими">📋 Адрес и код сборки</button><button class="btn primary" id="shOk">Ура ♡</button></div>`);
  box.onclick = onCopyClick;
  $('#shCode', box).onclick = (e) => copyCodeButton(e.currentTarget, { id }, address);
  $('#shOk', box).onclick = closeModal;
}

// Кнопка «Код сборки»: собирает и копирует код (нужна связь с Modrinth), пока идёт сборка — недоступна
async function copyCodeButton(btn, inst, address) {
  const was = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Собираю…';
  try {
    await copyModCode(inst, address);
  } catch (err) {
    toast(err.message, 'err');
  }
  if (btn.isConnected) {
    btn.disabled = false;
    btn.textContent = was;
  }
}
api.on('app:notify', ({ text, kind }) => (toast(text, kind || 'ok'), log(text, kind === 'err' ? 'error' : 'info')));
api.on('app:refresh', () => refresh());
