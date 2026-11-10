// Окна вокруг запуска: советы по скорости, графика, видеокарта, проверка сборки, вылет

/* ---------- советы по скорости ---------- */
// Тексты советов собираем здесь из данных, которые прислал perf:check (id + параметры)
const TIPS = {
  gpu: (p) => ({ ico: '🎮', title: 'Игра может идти на слабой видеокарте', text: `В ноутбуке две видеокарты: ${p.integrated} и ${p.discrete}. Если Windows запустит игру на встроенной, кадров будет мало.`, btn: 'Включить мощную' }),
  ramLow: (p) => ({ ico: '🧠', title: 'Модам мало памяти', text: `Игре отдано ${fmtRam(p.max)}. С ${fmtRam(p.rec)} сборка грузится быстрее и реже подвисает.`, btn: `Поставить ${fmtRam(p.rec)}` }),
  ramHigh: (p) => ({ ico: '🧠', title: 'Памяти отдано слишком много', text: `Игре отдано ${fmtRam(p.max)} из ${fmtRam(p.total)}. Остальному в Windows не хватает, а Java долго убирает мусор — отсюда подвисания.`, btn: `Поставить ${fmtRam(p.rec)}` }),
  optimize: (p) => ({ ico: '⚡', title: 'В сборке нет модов для скорости', text: `Не нашла ${p.names.join(', ')}${p.more ? ` и ещё ${p.more}` : ''}. Они заметно прибавляют кадров.`, btn: 'Открыть оптимизацию' }),
  distance: (p) => ({ ico: '🔭', title: 'Слишком большая дальность прорисовки', text: `Сейчас ${p.rd} чанков — для этого компьютера тяжеловато.`, btn: p.profile === 'eco' ? 'Экономная графика' : 'Сбалансированная графика' }),
  shaders: () => ({ ico: '✨', title: 'Включены шейдеры', text: 'Компьютер скромный, а шейдеры сильно режут кадры. Если игра тормозит — выключи их.', btn: 'Выключить шейдеры' }),
  packs: (p) => ({ ico: '🖼️', title: 'Тяжёлые ресурспаки', text: `Ресурспаки занимают ${p.mb} МБ: игра дольше грузится и ест больше памяти.`, btn: 'Открыть ресурспаки' }),
  battery: () => ({ ico: '🔋', title: 'Ноутбук работает от батареи', text: 'От батареи Windows урезает мощность, и игра идёт хуже. Подключи зарядку.', btn: '' }),
};

async function applyTip(inst, t) {
  if (t.id === 'gpu') {
    const r = await call('perf:gpuSet', true);
    state.gpu = r;
    state.settings = r.settings;
    renderSettings();
    toast('Игра будет запускаться на мощной видеокарте ♡');
  } else if (t.id === 'ramLow' || t.id === 'ramHigh') {
    if (inst.maxRam) {
      await call('instances:update', inst.id, { maxRam: t.rec });
      await refresh();
    } else await saveSettings({ maxRam: t.rec, minRam: Math.min(state.settings.minRam, t.rec) });
    toast(`Игре дано ${fmtRam(t.rec)} памяти ♡`);
  } else if (t.id === 'distance') {
    await call('perf:graphicsSet', inst.id, t.profile);
    toast('Настройки графики подобрала ♡');
  } else if (t.id === 'shaders') {
    await call('perf:fix', inst.id, 'shadersOff');
    toast('Шейдеры выключены — включить их можно в настройках игры');
  } else if (t.id === 'optimize') {
    closeModal();
    return openOptimize(inst.id);
  } else if (t.id === 'packs') {
    closeModal();
    state.mods.inst = inst.id;
    return openBrowser('installed', 'resourcepack');
  }
  hearts();
}

async function openTips(inst) {
  const box = openModal(`
    <div class="crash-head"><div class="empty-cat" data-cat></div><div><h2>Как ускорить игру ⚡</h2><p class="sub">${esc(inst.name)}</p></div></div>
    <div class="opt-body" id="tipsBody"><p class="hint">Смотрю на сборку и на компьютер…</p></div>
    <div class="modal-actions"><button class="btn ghost" id="tipsNo">Закрыть</button></div>`);
  $('#tipsNo', box).onclick = closeModal;
  const paint = async () => {
    const tips = await call('perf:check', inst.id).catch(() => []);
    heroInfo[inst.id] = { ...heroInfo[inst.id], tips };
    paintHeroInfo(inst.id);
    const body = $('#tipsBody', box);
    if (!body?.isConnected) return; // окно успели закрыть
    body.innerHTML =
      (tips.length
        ? tips
            .map((t, n) => {
              const v = TIPS[t.id](t);
              return `<div class="tip-row"><span class="tip-ico">${v.ico}</span><div class="opt-txt"><b>${esc(v.title)}</b><span>${esc(v.text)}</span></div>${v.btn ? `<button class="btn soft sm" data-tip="${n}">${esc(v.btn)}</button>` : ''}</div>`;
            })
            .join('')
        : '<div class="empty"><div class="empty-cat" data-cat></div>Всё в порядке — больше нечего советовать ♡</div>') +
      '<p class="hint">Если игра долго грузится, добавь папку лаунчера в исключения антивируса: он проверяет каждый файл при запуске. Это настройка самой Windows, за тебя я её не трогаю.</p>';
    drawCats(body);
    $$('[data-tip]', body).forEach(
      (b) =>
        (b.onclick = async () => {
          b.disabled = true;
          try {
            await applyTip(instById(inst.id) || inst, tips[+b.dataset.tip]);
          } catch (err) {
            toast(err.message, 'err');
          }
          if ($('#tipsBody')?.isConnected) paint();
        })
    );
  };
  await paint();
}

// Графика игры одной кнопкой (вкладка «Ещё» окна сборки)
async function paintGfx(inst, host) {
  const g = await call('perf:graphics', inst.id).catch(() => null);
  if (!g || !host.isConnected) return;
  const fps = Number(g.current.maxFps);
  const dis = g.exists ? '' : 'disabled';
  const btn = (k, label) => `<button data-g="${k}" class="${g.profile === k ? 'on' : ''}" ${dis}>${label}</button>`;
  host.innerHTML = `
    <h4 class="opt-h">Графика игры${g.exists && g.current.renderDistance ? `<small>Сейчас: ${esc(g.current.renderDistance)} чанков · ${fps >= 260 ? '∞' : fps || '?'} FPS</small>` : ''}</h4>
    <div class="seg small">${btn('eco', 'Экономная')}${btn('mid', 'Сбалансированная')}${btn('max', 'Красивая')}</div>
    <div class="row gfx-row"><button class="btn ghost sm" data-g="restore" ${g.backup ? '' : 'disabled'}>Вернуть как было</button></div>
    <p class="hint">${
      g.exists
        ? 'Подкручиваю дальность прорисовки, частицы, кадры в секунду и ещё несколько настроек в options.txt сборки. Клавиши, язык и звук не трогаю. Игра при этом должна быть закрыта.'
        : 'Настроек игры ещё нет: запусти сборку один раз и закрой её — тогда здесь появятся кнопки.'
    }</p>`;
  host.onclick = async (e) => {
    const b = e.target.closest('[data-g]');
    if (!b || b.disabled) return;
    try {
      await call('perf:graphicsSet', inst.id, b.dataset.g);
      toast(b.dataset.g === 'restore' ? 'Настройки графики вернула как были' : 'Настройки графики подобрала ♡');
      loadHeroInfo(inst.id, true);
    } catch (err) {
      toast(err.message, 'err');
    }
    paintGfx(inst, host);
  };
}

// Вопрос про мощную видеокарту. Закрывается любым ответом, запоминает, что уже спрашивали
function gpuDialog(g) {
  return new Promise((resolve) => {
    let decided = false;
    const done = async (on) => {
      if (decided) return;
      decided = true;
      try {
        if (on) {
          const r = await call('perf:gpuSet', true);
          state.gpu = r;
          state.settings = r.settings;
          toast('Игра будет запускаться на мощной видеокарте ♡');
        } else state.settings = await call('perf:gpuSkip');
        renderSettings();
      } catch (err) {
        toast(err.message, 'err');
      }
      resolve();
    };
    const box = openModal(`
      <div class="crash-head"><div class="empty-cat" data-cat></div><div><h2>Запускать игру на мощной видеокарте?</h2><p class="sub">Спрашиваю один раз — потом это можно поменять в настройках</p></div></div>
      <p class="hint">В твоём ноутбуке две видеокарты: ${esc(g.integrated)} (встроенная) и ${esc(g.discrete)}. Windows нередко запускает Minecraft на встроенной, и тогда кадров мало. Могу попросить Windows запускать Java лаунчера на мощной: это обычная настройка «Параметры графики», драйверы я не трогаю.</p>
      <div class="modal-actions wrap">
        <button class="btn ghost" id="gpNo">Не надо</button>
        <button class="btn primary" id="gpYes">Включить мощную</button>
      </div>`);
    box.dispose = () => done(false);
    $('#gpNo', box).onclick = () => closeModal();
    $('#gpYes', box).onclick = () => {
      box.dispose = null;
      done(true);
      closeModal();
    };
  });
}

// Окно «в сборке есть проблемы» перед запуском. Возвращает true, если всё же запускаем
function healthDialog(inst, h) {
  return new Promise((resolve) => {
    let decided = false;
    const done = (v) => {
      if (decided) return;
      decided = true;
      resolve(v);
    };
    const render = (h) => {
      const hard = h.conflicts.filter((c) => c.hard);
      const box = openModal(`
        <div class="crash-head"><div class="empty-cat" data-cat></div><div><h2>Подожди, в сборке проблемы 🥺</h2><p class="sub">${esc(inst.name)} — так говорят сами моды</p></div></div>
        <div class="health-list">
          ${h.missing
            .map(
              (m) => `<div class="health-row ${m.wrongVersion ? 'warn' : 'bad'}"><b>${m.wrongVersion ? `Не та версия ${esc(m.id)}` : `Не хватает ${esc(m.id)}`}</b>
                <span>${m.wrongVersion ? `стоит ${esc(m.have)}, а ` : ''}нужно ${esc(m.need && m.need !== '*' ? m.need : 'любая версия')} — для ${esc(m.by)}</span></div>`
            )
            .join('')}
          ${h.conflicts
            .map(
              (c) => `<div class="health-row ${c.hard ? 'bad' : 'warn'}"><b>«${esc(c.by)}» ${c.hard ? 'несовместим' : 'плохо работает'} с «${esc(c.other)}»</b>
                <span>${c.hard ? 'вместе игра не запустится' : 'возможны глюки'}</span>
                <div class="health-btns">${c.byFile ? `<button class="btn ghost sm" data-off="${esc(c.byFile)}">Выключить «${esc(c.by)}»</button>` : ''}<button class="btn ghost sm" data-off="${esc(c.file)}">Выключить «${esc(c.other)}»</button></div></div>`
            )
            .join('')}
          ${h.duplicates
            .map(
              (d) => `<div class="health-row bad"><b>«${esc(d.name)}» стоит ${d.files.length} раза</b><span>${d.files.map(esc).join(', ')}</span>
                <button class="btn ghost sm" data-off="${esc(d.files[d.files.length - 1])}">Выключить лишний</button></div>`
            )
            .join('')}
        </div>
        <div class="modal-actions wrap">
          <button class="btn ghost" id="hlCancel">Не запускать</button>
          <button class="btn soft" id="hlGo">${hard.length || h.duplicates.length ? 'Запустить всё равно' : 'Запустить'}</button>
          ${h.missing.length ? '<button class="btn primary" id="hlFix">Поставить недостающее</button>' : ''}
        </div>`);
      box.dispose = () => done(false);
      $('#hlCancel', box).onclick = () => (done(false), closeModal());
      $('#hlGo', box).onclick = () => (done(true), (box.dispose = null), closeModal());
      $$('[data-off]', box).forEach(
        (b) =>
          (b.onclick = async () => {
            await call('mods:toggle', inst.id, b.dataset.off, false).catch((err) => toast(err.message, 'err'));
            toast('Мод выключен — его можно включить обратно во вкладке «Моды»');
            recheck();
          })
      );
      if (h.missing.length) {
        $('#hlFix', box).onclick = async (e) => {
          e.target.disabled = true;
          e.target.textContent = 'Ставлю…';
          try {
            const r = await call('mods:fixMissing', inst.id, h.missing.map((m) => m.id));
            if (r.installed.length) toast(`Поставлено: ${r.installed.join(', ')}`);
            r.warnings.forEach((w) => (toast(w, 'err'), log(w, 'error')));
          } catch (err) {
            toast(err.message, 'err');
          }
          recheck();
        };
      }
    };
    // После каждого исправления проверяем заново; если всё чисто — сразу запускаем
    const recheck = async () => {
      const next = await call('mods:health', inst.id);
      if (!next.conflicts.length && !next.missing.length && !next.duplicates.length) {
        toast('Сборка в порядке ♡ Запускаю');
        hearts();
        done(true);
        $('#modalBox').dispose = null;
        closeModal();
      } else render(next);
    };
    render(h);
  });
}

// Что изменилось с последнего удачного запуска (sinceGood из core/snapshots.js): имена модов и смена версий. Не причина вылета, а факты:
// если изменений нет, так и сказано, и виновников никто не придумывает. Названия в строке — до шести, остальные счётом
const SINCE_MODS = [['added', 'Добавлено:'], ['enabled', 'Включено:'], ['changed', 'Изменено:'], ['removed', 'Убрано:'], ['disabled', 'Выключено:']];
const SINCE_FIELDS = [['version', 'Minecraft:'], ['loader', 'Загрузчик:'], ['loaderVersion', 'Версия загрузчика:'], ['pack', 'Модпак:']];
function sinceGoodHtml(sg) {
  const when = `<small>${esc(fmtDate(sg.time))}</small>`;
  if (!sg.any) return `<div class="crash-since"><b>Моды, загрузчик и версия игры те же, что при последнем удачном запуске ${when}</b></div>`;
  const names = (list) => `${esc(list.slice(0, 6).join(', '))}${list.length > 6 ? ` <span>и ещё ${list.length - 6}</span>` : ''}`;
  const val = (k, v) => `<span>${v == null ? (k === 'pack' ? 'без модпака' : 'авто (последняя)') : esc(k === 'loader' ? LOADERS[v] || v : v)}</span>`;
  const rows = [
    ...SINCE_MODS.filter(([k]) => sg.mods[k].length).map(([k, label]) => `<li><b>${label}</b> ${names(sg.mods[k])}</li>`),
    ...SINCE_FIELDS.filter(([k]) => sg.instance[k]).map(([k, label]) => `<li><b>${label}</b> ${val(k, sg.instance[k].from)} → ${val(k, sg.instance[k].to)}</li>`),
  ];
  return `<div class="crash-since"><b>С последнего удачного запуска ${when}</b><ul>${rows.join('')}</ul></div>`;
}

// Окно вылета: причина, подсказки и кнопка, которая сразу чинит, если это возможно
function showCrash(id, crash) {
  const inst = instById(id);
  const sg = crash.sinceGood;
  say('ой… игра упала 🥺', 6000);
  const fixBtn =
    crash.fix?.type === 'install'
      ? `<button class="btn primary" id="crFix">Поставить ${esc(crash.fix.mod.name)}</button>`
      : crash.fix?.type === 'settings'
        ? '<button class="btn primary" id="crFix">Открыть настройки</button>'
        : '';
  const goodLabel = '🕘 Откатить на последний удачный запуск';
  const box = openModal(`
    <div class="crash-head"><div class="empty-cat" data-cat></div><div><h2>Игра вылетела 🥺</h2><p class="sub">${esc(inst?.name || '')}</p></div></div>
    <p class="crash-reason">${esc(crash.reason)}</p>
    <ul class="crash-hints">${(crash.hints || []).map((h) => `<li>${esc(h)}</li>`).join('')}</ul>
    ${sg ? sinceGoodHtml(sg) : ''}
    <div class="modal-actions wrap">
      <button class="btn ghost" id="crClose">Закрыть</button>
      <button class="btn soft" id="crLog">Консоль</button>
      ${crash.report ? '<button class="btn soft" id="crReport">Открыть отчёт</button>' : ''}
      <button class="btn soft" id="crShare">Поделиться логом</button>
      ${inst && inst.loader !== 'vanilla' ? '<button class="btn soft" id="crBisect" title="Лаунчер по очереди включит части модов и найдёт тот, из-за которого вылет">🔎 Найти виновника</button>' : ''}
      ${sg?.any ? `<button class="btn ${crash.fix ? 'soft' : 'primary'}" id="crGood" title="Вернёт моды, папку config и версию загрузчика такими, какими они были при последнем удачном запуске. Нынешнее состояние я сохраню, так что откат можно отменить">${goodLabel}</button>` : ''}
      ${fixBtn}
    </div>`);
  $('#crClose', box).onclick = closeModal;
  if ($('#crBisect', box)) $('#crBisect', box).onclick = () => Bisect.open(id, { report: crash.report });
  if ($('#crGood', box)) {
    $('#crGood', box).onclick = async (e) => {
      e.target.disabled = true;
      e.target.textContent = 'Возвращаю…';
      try {
        await restorePoint(id, sg.id);
        closeModal();
      } catch (err) {
        e.target.disabled = false;
        e.target.textContent = goodLabel;
        toast(err.message, 'err');
      }
    };
  }
  $('#crLog', box).onclick = () => (closeModal(), showPage('console'));
  $('#crShare', box).onclick = () => shareLog('game', id);
  if (crash.report) $('#crReport', box).onclick = () => call('app:openPath', crash.report).catch((err) => toast(err.message, 'err'));
  if (crash.fix) {
    $('#crFix', box).onclick = async (e) => {
      if (crash.fix.type === 'settings') {
        closeModal();
        return inst ? openInstanceModal(inst) : showPage('settings');
      }
      e.target.disabled = true;
      e.target.textContent = 'Ставлю…';
      try {
        await call('browse:install', crash.fix.mod.source, id, crash.fix.mod.id, 'mod');
        closeModal();
        toast(`${crash.fix.mod.name} установлен — пробуй запустить снова ♡`);
        hearts();
      } catch (err) {
        e.target.disabled = false;
        e.target.textContent = 'Не вышло 🥺';
        toast(err.message, 'err');
      }
    };
  }
}
