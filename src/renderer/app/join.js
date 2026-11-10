// «Войти к другу»: гость вставляет сообщение друга целиком (адрес мира и код сборки), лаунчер сверяет моды (core/modcode.js),
// ставит недостающее и заходит на адрес. Хозяину здесь же: «скопировать код сборки» (кнопки в окнах «Играть с другом» и с адресом, Ctrl+K)

// То же правило, что ADDRESS_RE в core/modcode.js (их сверяет tests/modcode.test.js): имя или IP с портом, либо IPv6 в скобках
const JN_ADDR = /^(?:[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?|\[[0-9A-Fa-f:.]{2,45}\])(?::\d{1,5})?$/;
const jnAddrOk = (s) => {
  const port = /:(\d{1,5})$/.exec(s);
  return s.length <= 259 && JN_ADDR.test(s) && (!port || (Number(port[1]) >= 1 && Number(port[1]) <= 65535));
};

// Хозяину: код сборки в буфер обмена (по нажатию кнопки). withAddress — адрес мира: тогда копируется сообщение «адрес + код», которое
// друг вставляет в окно целиком. Нужна связь с Modrinth: id версий модов берутся оттуда
async function copyModCode(inst, withAddress) {
  const r = await call('instances:modCode', inst.id);
  await call('app:copyText', withAddress ? `${withAddress}\n${I18N.lang === 'en' ? 'Pack code' : 'Код сборки'}: ${r.code}` : r.code);
  toast(withAddress ? 'Адрес и код сборки скопированы — отправь их другу ♡' : 'Код сборки скопирован — отправь его другу вместе с адресом ♡');
  if (r.others.length) {
    toast(`Не с Modrinth: ${r.others.length} — их другу придётся отправить файлами`, 'err');
    log(`Моды не с Modrinth (другу нужно отправить файлы): ${r.others.join(', ')}`, 'info');
  }
  return r;
}

const jnVer = (mc, loader) => `${esc(mc)} · <span>${esc(LOADERS[loader] || loader)}</span>`;
const JN_MANUAL = { other: 'не с Modrinth — попроси файл у друга', differs: 'у тебя файл с таким именем, но другой — попроси у друга его файл', gone: 'версию удалили с Modrinth — поставить нечего' };
const JN_LIST = 60; // длинные списки обрезаем: полный состав виден в «Моды»

// Окно «Войти к другу»; inst — какую сборку выбрать сразу
function openJoinModal(inst) {
  const jn = { plan: null, problem: null, error: null, failed: null, busy: false, seq: 0, chosen: false, touched: false, checked: '' };
  const opt = (i) => `<option value="${esc(i.id)}">${esc(i.name)} · ${esc(i.version)} · ${esc(LOADERS[i.loader] || i.loader)}</option>`;
  const box = openModal(`
    <div class="crash-head"><div class="empty-cat" data-cat></div><div><h2>Войти к другу 🚪</h2><p class="sub">Адрес мира и моды друга — одним сообщением</p></div></div>
    <label class="field"><span>Сообщение друга</span><textarea id="jnText" rows="3" spellcheck="false" placeholder="Вставь сюда всё, что прислал друг: адрес мира и код сборки"></textarea></label>
    <div class="jn-row">
      <label class="field"><span>Адрес мира</span><input id="jnAddr" spellcheck="false" autocomplete="off" placeholder="xxx.e4mc.link или адрес:порт"></label>
      <label class="field"><span>Сборка</span><select id="jnInst"></select></label>
    </div>
    <label class="check-row jn-follow"><input type="checkbox" class="check" id="jnFollow"><span>Следовать за сборкой друга: моды, которых у него нет, отключу (вернуть можно из точки восстановления). Когда друг обновит моды, вставь его новый код сюда же</span></label>
    <div class="jn-result" id="jnResult"></div>
    <div class="modal-actions wrap"><button class="btn ghost" id="jnClose">Закрыть</button><button class="btn soft" id="jnCheck">Сверить моды</button><button class="btn soft" id="jnInstall" disabled>Поставить как у друга</button><button class="btn primary" id="jnPlay" disabled>Зайти ▶</button></div>`);
  box.classList.add('sticky-actions');
  const el = (sel) => $(sel, box);
  const alive = () => box.isConnected && !!el('#jnText');
  const target = () => el('#jnInst').value;
  const address = () => el('#jnAddr').value.trim();
  const follow = () => el('#jnFollow').checked;
  const instOf = (id) => state.instances.find((i) => i.id === id);

  const fillPicker = (keep) => {
    const want = keep ?? target(); // до перезаписи списка: после неё выбранным окажется первый пункт
    const host = jn.plan?.host;
    const fresh = host ? `<option value="new">➕ Новая сборка как у друга · ${esc(host.mc)} · ${esc(LOADERS[host.loader] || host.loader)}</option>` : '';
    el('#jnInst').innerHTML = fresh + state.instances.map(opt).join('');
    el('#jnInst').value = [...el('#jnInst').options].some((o) => o.value === want) ? want : el('#jnInst').options[0]?.value || '';
  };

  const li = (title, small) => `<li><b>${esc(title)}</b>${small ? ` <small>${small}</small>` : ''}</li>`;
  const sec = (cls, label, items, open) => {
    if (!items.length) return '';
    const shown = items.slice(0, JN_LIST).join('') + (items.length > JN_LIST ? `<li><small>и ещё ${items.length - JN_LIST}</small></li>` : '');
    return `<details class="jn-sec ${cls}"${open ? ' open' : ''}><summary><span>${label}</span> <b>${items.length}</b></summary><ul>${shown}</ul></details>`;
  };
  const resultHtml = () => {
    if (jn.error) return `<p class="hint err">${esc(jn.error)}</p>`;
    if (jn.problem) return `<p class="hint err">${esc(jn.problem.message)}</p>`;
    const plan = jn.plan;
    if (!plan) {
      if (!el('#jnText').value.trim()) return '<p class="hint">Друг копирует код кнопкой «Код сборки» в окне «Играть с другом». Если кода нет, достаточно адреса: я просто зайду на него.</p>';
      return address() ? '<p class="hint">Кода сборки в сообщении нет: зайду на адрес без сверки модов.</p>' : '';
    }
    const isNew = target() === 'new';
    const head = `<div class="jn-head"><span>Сборка друга:</span> <b>${jnVer(plan.host.mc, plan.host.loader)}</b> <span>· модов у друга:</span> <b>${plan.host.count}</b></div>`;
    const blocked = !isNew && plan.mine && (plan.mismatch.version || plan.mismatch.loader);
    const warn = blocked
      ? `<p class="hint warn jn-warn"><b>Версия игры или загрузчик не совпадают.</b> <span>У друга:</span> <code>${jnVer(plan.host.mc, plan.host.loader)}</code> <span>у тебя:</span> <code>${jnVer(plan.mine.mc, plan.mine.loader)}</code>. <span>Моды друга под другую версию не подходят: выбери сборку с такой же версией или создай новую «как у друга».</span></p>`
      : !isNew && plan.mismatch.loaderVersion
        ? `<p class="hint jn-warn"><span>Версия загрузчика у друга другая:</span> <code>${esc(plan.host.loaderVersion)}</code> <span>у тебя:</span> <code>${esc(plan.mine.loaderVersion)}</code>. <span>Обычно это не мешает.</span></p>`
        : '';
    const chip = (cls, label, n) => (n ? `<span class="chip ${cls}"><span>${label}</span> <b>${n}</b></span>` : '');
    const chips = `<div class="jn-chips">${chip('jn-ok', 'Совпало', plan.same.length)}${chip('jn-todo', 'Поставлю', plan.missing.length)}${chip('jn-todo', 'Заменю', plan.other.length)}${chip('jn-todo', 'Включу', plan.off.length)}${chip('jn-bad', 'Нужны файлы от друга', plan.manual.length)}${chip('jn-extra', follow() ? 'Отключу лишних' : 'Лишних у тебя', plan.extra.length)}</div>`;
    const done = plan.todo === 0 && !plan.manual.length && !blocked ? '<p class="hint jn-fine"><span>Моды те же, что у друга ♡</span></p>' : '';
    const lists = [
      sec('jn-todo', 'Поставлю', plan.missing.map((x) => li(x.title, esc(x.version))), true),
      sec('jn-todo', 'Заменю на версию друга', plan.other.map((x) => li(x.title, `${esc(x.mine)} → ${esc(x.theirs)}`)), true),
      sec('jn-todo', 'Включу (сейчас выключены)', plan.off.map((x) => li(x.title)), true),
      sec('jn-bad', 'Нужны файлы от друга', plan.manual.map((x) => li(x.name, `<span>${JN_MANUAL[x.why] || JN_MANUAL.other}</span>`)), true),
      sec('jn-extra', follow() ? 'Есть у тебя, но нет у друга: отключу' : 'Есть у тебя, но нет у друга', plan.extra.map((x) => li(x.title, x.known ? '' : '<span>не с Modrinth</span>')), false),
      sec('jn-ok', 'Совпало', plan.same.map((x) => li(x.title, esc(x.version || ''))), false),
    ].join('');
    const failed = jn.failed?.length ? `<p class="hint err"><span>Не получилось поставить:</span></p><ul class="jn-failed">${jn.failed.map((f) => `<li><b>${esc(f.title)}</b> — <span>${esc(f.error)}</span></li>`).join('')}</ul>` : '';
    return head + warn + failed + chips + done + lists;
  };

  const paint = () => {
    if (!alive()) return;
    const plan = jn.plan;
    const isNew = target() === 'new';
    const blocked = !isNew && !!plan?.mine && (plan.mismatch.version || plan.mismatch.loader);
    el('#jnResult').innerHTML = resultHtml();
    el('#jnCheck').disabled = jn.busy;
    el('#jnInstall').disabled = jn.busy || !plan || !target() || (!isNew && (blocked || (plan.todo === 0 && !(follow() && plan.extra.length))));
    el('#jnInstall').textContent = isNew ? 'Создать сборку и поставить моды' : follow() ? 'Сделать как у друга' : 'Поставить как у друга';
    const trouble = !!plan && (plan.todo > 0 || plan.manual.length > 0 || blocked);
    el('#jnPlay').disabled = jn.busy || isNew || !jnAddrOk(address());
    el('#jnPlay').textContent = trouble ? 'Зайти всё равно ▶' : 'Зайти ▶';
  };

  // Какая сборка подойдёт: выбранная, если версия и загрузчик те же, потом любая такая же, иначе новая «как у друга»
  const bestTarget = (host) => {
    const fits = (i) => i.version === host.mc && (i.loader === host.loader || (i.loader === 'quilt' && host.loader === 'fabric'));
    const current = state.instances.find((i) => i.id === target());
    return (current && fits(current) ? current : state.instances.find(fits))?.id || 'new';
  };

  async function check() {
    const text = el('#jnText').value.trim();
    const mine = ++jn.seq;
    const before = target();
    jn.error = jn.failed = null;
    jn.checked = text;
    if (!text) {
      jn.plan = jn.problem = null;
      return paint();
    }
    jn.busy = true;
    el('#jnCheck').textContent = 'Сверяю…';
    paint();
    try {
      const r = await call('instances:joinCheck', before === 'new' ? null : before, text);
      if (!alive() || mine !== jn.seq) return;
      jn.plan = r.plan;
      jn.problem = r.problem;
      if (r.address && (!jn.touched || !address())) {
        el('#jnAddr').value = r.address;
        jn.touched = false;
      }
      if (r.plan && !jn.chosen) {
        // Первая сверка: подбираем подходящую сборку и, если она другая, сверяем уже с ней
        jn.chosen = true;
        const best = bestTarget(r.plan.host);
        fillPicker(best);
        if (best !== before) {
          jn.busy = false;
          return check();
        }
      }
      if (r.plan) fillPicker();
    } catch (err) {
      if (!alive() || mine !== jn.seq) return;
      jn.error = err.message;
      jn.plan = null;
    }
    if (!alive() || mine !== jn.seq) return;
    jn.busy = false;
    el('#jnCheck').textContent = 'Сверить моды';
    paint();
  }

  const first = inst?.id || (state.instances.some((i) => i.id === state.selected) ? state.selected : state.instances[0]?.id);
  fillPicker(first);
  const syncFollow = () => (el('#jnFollow').checked = target() === 'new' || !!instOf(target())?.follow);
  syncFollow();
  paint();
  el('#jnClose').onclick = closeModal;
  el('#jnCheck').onclick = check;
  el('#jnText').addEventListener('paste', () => setTimeout(check, 0)); // вставили сообщение — сразу сверяем
  el('#jnText').addEventListener('change', () => el('#jnText').value.trim() !== jn.checked && check());
  el('#jnAddr').addEventListener('input', () => ((jn.touched = true), paint()));
  el('#jnFollow').addEventListener('change', paint);
  el('#jnInst').addEventListener('change', () => {
    syncFollow();
    jn.chosen = true; // человек выбрал сам — не подменяем
    if (el('#jnText').value.trim()) check();
    else paint();
  });
  el('#jnInstall').onclick = async () => {
    const id = target();
    jn.busy = true;
    jn.failed = null;
    const follows = follow();
    el('#jnInstall').textContent = 'Ставлю…';
    paint();
    try {
      const r = await call('instances:joinInstall', id, el('#jnText').value, { follow: follows });
      await refresh();
      const part = [`поставлено ${r.installed.length}`, `заменено ${r.replaced.length}`, `включено ${r.enabled.length}`];
      if (r.disabled?.length) part.push(`отключено ${r.disabled.length}`);
      toast(`Готово: ${part.join(', ')}${r.failed.length ? `, не вышло ${r.failed.length}` : ''}`, r.failed.length ? 'err' : 'ok');
      if (r.instance) selectInstance(r.instance.id);
      hearts();
      if (!alive()) return;
      jn.busy = false;
      fillPicker(r.instance?.id);
      await check(); // свежая сверка: что осталось
      if (alive() && r.failed.length) {
        jn.failed = r.failed;
        paint();
      }
    } catch (err) {
      toast(err.message, 'err');
      if (!alive()) return;
      jn.busy = false;
      jn.error = err.message;
      paint();
    }
  };
  el('#jnPlay').onclick = () => {
    const id = target();
    const where = address();
    if (id === 'new' || !jnAddrOk(where)) return;
    // «Играть» на запущенной сборке закрыло бы игру: здесь человек хотел зайти, поэтому просим закрыть самому
    if (state.running.has(id) || state.launching.has(id)) return toast('Эта сборка уже запущена: закрой игру и нажми «Зайти» снова', 'err');
    closeModal();
    selectInstance(id);
    play({ server: where });
  };
}
