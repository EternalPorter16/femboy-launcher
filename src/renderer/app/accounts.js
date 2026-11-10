// Аккаунты и скин: список, 3D-превью, плащи, вход через Microsoft, Ely.by и оффлайн

/* ---------- аккаунты ---------- */
function renderAccounts() {
  const list = $('#accList');
  list.innerHTML = state.accounts.length
    ? state.accounts
        .map((a) => {
          const active = a.id === state.activeAccount;
          return `
      <div class="card acc-row ${active ? 'active' : ''}" data-id="${esc(a.id)}">
        ${avatarHtml(a, 'lg')}
        <div class="acc-info"><b>${esc(a.name)}</b><span class="badge ${esc(a.type)}">${a.type === 'offline' ? 'Оффлайн' : esc(ACC_TYPES[a.type] || a.type) + ' ✓'}</span><code>${esc(a.uuid)}</code></div>
        ${active ? '<span class="current">выбран ♡</span>' : '<button class="btn soft" data-act="select">Выбрать</button>'}
        <button class="btn ghost" data-act="copy" title="Скопировать ник, чтобы отправить его другу">Копировать ник</button>
        <button class="btn ghost danger" data-act="remove">Удалить</button>
      </div>`;
        })
        .join('')
    : '<div class="empty"><div class="empty-cat" data-cat></div>Пока пусто… добавь аккаунт выше ♡</div>';
  drawCats(list);
  renderSkinCard();
}

/* ---------- скин активного аккаунта ---------- */
let skinViewer = null;
// 3D-превью живёт своим циклом отрисовки: если оставить его включённым на других страницах, WebGL весь день рисует невидимого
// человечка 60 раз в секунду. Поэтому создаём его, когда открыта страница аккаунтов, и ставим на паузу, когда уходим или лаунчер уснул
const pauseSkin = () => skinViewer && (skinViewer.renderPaused = document.body.dataset.page !== 'accounts' || Calm.asleep);
Calm.watch(pauseSkin);
function renderSkinCard() {
  const acc = activeAccount();
  $('#skinCard').style.display = acc ? '' : 'none';
  if (!acc) return;
  if (!skinViewer && document.body.dataset.page === 'accounts') skinViewer = Skins.createViewer($('#skinView'), 240, 300);
  pauseSkin();
  const offline = acc.type === 'offline';
  const ely = acc.type === 'elyby';
  const src = acc.skin?.data || `https://mc-heads.net/skin/${offline || ely ? 'MHF_Steve' : acc.uuid}`;
  Skins.showSkin(skinViewer, src, acc.skin?.model);
  $('#skinModel').textContent = acc.skin ? (acc.skin.model === 'slim' ? 'Slim' : 'Classic') : offline || ely ? 'стандартный' : 'лицензия';
  $('#skinNote').textContent = ely
    ? 'Скин и плащ Ely.by меняются на сайте ely.by. В игре новый скин появится сам, а здесь его можно подтянуть кнопкой «Обновить скин».'
    : offline
      ? acc.skin
        ? 'Скин виден тебе в игре. На серверах его увидят только там, где стоит SkinsRestorer.'
        : 'Сейчас стандартный скин. Нарисуй свой, загрузи PNG или возьми скин по нику ♡'
      : 'Скин и плащ лицензии меняются прямо здесь — их увидят все игроки.';
  $('#skinActions').innerHTML = ely
    ? `<a class="btn primary" href="https://ely.by/skins" target="_blank">Сменить на ely.by</a>
       <button class="btn soft" data-skin="elysync">Обновить скин</button>`
    : `<button class="btn primary" data-skin="edit">🎨 Редактор</button>
       <button class="btn soft" data-skin="upload">Загрузить PNG</button>
       ${offline && acc.skin ? '<button class="btn ghost danger" data-skin="reset">Сбросить</button>' : ''}
       ${offline ? '' : '<div class="capes" id="capes"></div>'}`;
  if (!offline && !ely) renderCapes(acc);
}

// Плащи лицензионного аккаунта
async function renderCapes(acc) {
  const host = $('#capes');
  try {
    const p = await call('skins:msProfile', acc.id);
    if (!host.isConnected || !p.capes.length) return;
    host.innerHTML = `<select id="capeSel" class="mini-select"><option value="">Без плаща</option>${p.capes.map((c) => `<option value="${esc(c.id)}" ${c.active ? 'selected' : ''}>Плащ: ${esc(c.alias)}</option>`).join('')}</select>`;
    $('#capeSel').onchange = async (e) => {
      try {
        await call('skins:msCape', acc.id, e.target.value || null);
        toast('Плащ обновлён ♡');
      } catch (err) {
        toast(err.message, 'err');
      }
    };
  } catch {}
}

async function openSkinEditor(src, model) {
  const acc = activeAccount();
  const ms = acc.type === 'microsoft';
  // Для лицензии берём текущий скин по нику, чтобы редактировать его, а не рисовать с нуля
  if (ms && !src) {
    try {
      const r = await call('skins:fromName', acc.name);
      [src, model] = [r.data, r.model];
    } catch {}
  }
  Skins.openEditor({
    src,
    model,
    title: `Скин ${esc(acc.name)}`,
    openModal,
    closeModal,
    toast,
    fromName: (name) => call('skins:fromName', name),
    onSave: async (data, m) => {
      if (ms) await call('skins:msUpload', acc.id, data, m);
      else await call('skins:save', acc.id, data, m);
      await refresh();
      toast(ms ? 'Скин лицензии обновлён — его увидят все ♡' : 'Скин сохранён ♡ Он появится при следующем запуске игры');
      say('какой милый скин 😳');
      hearts();
    },
  });
}

$('#skinActions').addEventListener('click', async (e) => {
  const act = e.target.closest('[data-skin]')?.dataset.skin;
  const acc = activeAccount();
  if (!act || !acc) return;
  if (act === 'edit') openSkinEditor(acc.skin?.data, acc.skin?.model);
  if (act === 'upload') $('#skinFile').click();
  if (act === 'elysync') {
    try {
      await call('accounts:refreshSkin', acc.id);
      await refresh();
      toast('Скин обновила ♡');
    } catch (err) {
      toast(err.message, 'err');
    }
  }
  if (act === 'reset') {
    await call('skins:reset', acc.id).catch((err) => toast(err.message, 'err'));
    await refresh();
    toast('Стандартный скин возвращён');
  }
});
$('#skinFile').onchange = (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => openSkinEditor(reader.result, 'classic');
  reader.readAsDataURL(file);
};

// Ник в буфер обмена: его просят друзья, чтобы записать в свой белый список
async function copyNick(name) {
  if (!name) return toast('Сначала добавь аккаунт ♡', 'err');
  try {
    await call('app:copyText', name);
    toast(`Ник «${name}» скопирован ✧`);
  } catch (err) {
    toast(err.message, 'err');
  }
}

$('#accList').addEventListener('click', async (e) => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  const id = e.target.closest('.acc-row')?.dataset.id;
  if (!act || !id) return;
  if (act === 'copy') return copyNick(state.accounts.find((a) => a.id === id)?.name);
  const channel = { select: 'accounts:select', remove: 'accounts:remove' }[act]; // незнакомое действие не должно превращаться в удаление
  if (!channel) return;
  try {
    await call(channel, id);
    await refresh();
  } catch (err) {
    toast(err.message, 'err');
  }
});

async function loginMicrosoft(btn) {
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = 'Жду вход в окне…';
  try {
    const acc = await call('accounts:addMicrosoft');
    await refresh();
    toast(`Добро пожаловать, ${acc.name} ♡`);
    say(`привет, ${acc.name} 😳`);
    return acc;
  } catch (err) {
    toast(err.message, 'err');
    return null;
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}
$('#msLogin').onclick = (e) => loginMicrosoft(e.currentTarget);

// Вход через Ely.by: логин, пароль и (только если аккаунт под двухфакторной защитой) код из приложения
function openElyLogin() {
  const box = openModal(`
    <div class="crash-head"><div class="empty-cat" data-cat></div><div><h2>Вход через Ely.by 🦊</h2><p class="sub">Скины и серверы Ely.by</p></div></div>
    <label class="field"><span>Логин или почта</span><input id="elyUser" autocomplete="username" spellcheck="false"></label>
    <label class="field"><span>Пароль</span><input id="elyPass" type="password" autocomplete="current-password"></label>
    <label class="field" id="elyCodeRow" hidden><span>Код из приложения двухфакторной защиты</span><input id="elyCode" inputmode="numeric" maxlength="10" autocomplete="one-time-code" spellcheck="false"></label>
    <p class="hint">Пароль уходит только на сервер ely.by и нигде не сохраняется: лаунчер оставляет себе токен входа, зашифрованный средствами Windows. Аккаунт можно создать на <a href="https://account.ely.by/register" target="_blank">account.ely.by</a>.</p>
    <div class="modal-actions"><button class="btn ghost" id="elyNo">Отмена</button><button class="btn primary" id="elyGo">Войти</button></div>`);
  const go = async () => {
    const btn = $('#elyGo', box);
    if (btn.disabled) return;
    btn.disabled = true;
    btn.textContent = 'Вхожу…';
    try {
      const acc = await call('accounts:addElyby', { username: $('#elyUser', box).value.trim(), password: $('#elyPass', box).value, code: $('#elyCode', box).value.trim() });
      closeModal();
      await refresh();
      toast(`Добро пожаловать, ${acc.name} ♡`);
      say(`привет, ${acc.name} 😳`);
      hearts();
    } catch (err) {
      toast(err.message, 'err');
      if (err.needs2fa) {
        $('#elyCodeRow', box).hidden = false;
        $('#elyCode', box).focus();
      } else $('#elyPass', box).select();
    } finally {
      if (btn.isConnected) {
        btn.disabled = false;
        btn.textContent = 'Войти';
      }
    }
  };
  $('#elyNo', box).onclick = closeModal;
  $('#elyGo', box).onclick = go;
  $$('input', box).forEach((i) => (i.onkeydown = (e) => e.key === 'Enter' && go()));
  $('#elyUser', box).focus();
}
$('#elyLogin').onclick = openElyLogin;

$('#offlineName').oninput = (e) => {
  const v = e.target.value;
  const hint = $('#offlineHint');
  const bad = v && !NAME_RE.test(v);
  hint.classList.toggle('err', !!bad);
  hint.textContent = bad ? 'Только A–Z, 0–9 и _, от 3 до 16 символов' : '3–16 символов: A–Z, 0–9, _';
};
$('#offlineForm').onsubmit = async (e) => {
  e.preventDefault();
  const name = $('#offlineName').value.trim();
  if (!NAME_RE.test(name)) return toast('Ник: 3–16 символов, латиница, цифры и _', 'err');
  try {
    await call('accounts:addOffline', name);
    $('#offlineName').value = '';
    await refresh();
    toast(`Ник «${name}» добавлен ✧`);
    say(`${name}? милый ник 😳`);
  } catch (err) {
    toast(err.message, 'err');
  }
};
