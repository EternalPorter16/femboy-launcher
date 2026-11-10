// Импорт коллекции Modrinth: окно «Коллекция Modrinth». Вставил ссылку, выбрал, куда ставить (новая сборка или существующая) и что именно, поставил.
// Данные, «подходит ли» и сама установка — в главном процессе (core/collection.js, каналы browse:collection*), здесь только выбор и показ

const CL_TYPE = { mod: 'мод', resourcepack: 'ресурспак', shader: 'шейдер', modpack: 'модпак' };
const CL_WHY = { version: 'нет под эту версию игры', loader: 'нет под этот загрузчик', type: 'в сборку не ставится: модпаки ставятся из «Моды → Модпаки»' };

let clOpened = 0; // сколько раз окно открывали: ответы старого окна не должны ложиться в новое, открытое после него

// prefill — ссылка, которую уже знаем (например, из буфера или Ctrl+K): сразу показываем коллекцию
function openCollection(prefill = '') {
  const cl = { data: null, status: {}, seq: 0, cseq: 0, busy: false, result: null };
  const instOption = (i) => `<option value="${esc(i.id)}">${esc(i.name)} · ${esc(i.version)} · ${esc(LOADERS[i.loader] || i.loader)}</option>`;
  const box = openModal(`
    <div class="crash-head"><div class="empty-cat" data-cat></div><div><h2>Коллекция Modrinth 📚</h2><p class="sub">Вставь ссылку на коллекцию — поставлю её моды, ресурспаки и шейдеры</p></div></div>
    <label class="field"><span>Ссылка на коллекцию</span><div class="row"><input id="clLink" spellcheck="false" autocomplete="off" placeholder="https://modrinth.com/collection/…"><button class="btn soft" id="clLoad">Показать</button></div></label>
    <div class="cl-body" id="clBody"><p class="hint">Коллекции делают люди на modrinth.com: в них собраны любимые моды, ресурспаки и шейдеры. Закрытые (приватные) коллекции лаунчер не видит.</p></div>
    <div class="modal-actions wrap"><button class="btn ghost" id="clClose">Закрыть</button><button class="btn primary" id="clGo" hidden disabled>Поставить</button></div>`);
  box.classList.add('cl', 'sticky-actions');
  const el = (sel) => $(sel, box);
  const me = (box.dataset.clWindow = String(++clOpened));
  const alive = () => box.isConnected && box.dataset.clWindow === me && !!el('#clLink');
  const lock = (on) => {
    cl.busy = on;
    $$('input, select, button', el('#clBody')).forEach((x) => (x.disabled = on));
    el('#clLoad').disabled = on;
    if (on) el('#clGo').disabled = true;
    else paintStatus(); // «включить всё» выше открыло и то, что в сборку не ставится: отключаем его заново
  };
  const picked = () => $$('.cl-row input:checked', box).map((i) => i.value);
  const target = () => {
    const v = el('#clTarget')?.value;
    return !v || v === 'new' ? { version: el('#clVer').value, loader: el('#clLoader').value, name: el('#clName').value.trim() || undefined } : { instance: v };
  };

  // Что видно у строки: подходит ли под выбранную цель и почему нет
  function paintStatus() {
    $$('.cl-row', box).forEach((row) => {
      const s = cl.status[row.dataset.id] || 'ok';
      row.classList.toggle('bad', s !== 'ok');
      $('.cl-why', row).textContent = s === 'ok' ? '' : CL_WHY[s] || '';
      if (s === 'type') $('input', row).disabled = true;
    });
    countPicked();
  }
  function countPicked() {
    const ids = picked();
    const bad = ids.filter((id) => (cl.status[id] || 'ok') !== 'ok').length;
    el('#clCount').textContent = ids.length ? `Выбрано: ${ids.length}${bad ? ` · не подойдут: ${bad}` : ''}` : 'Ничего не выбрано';
    el('#clGo').textContent = ids.length ? `Поставить: ${ids.length}` : 'Поставить';
    el('#clGo').disabled = cl.busy || !ids.length;
  }
  async function refreshStatus() {
    const mine = ++cl.cseq;
    try {
      const map = await call('browse:collectionCompat', cl.data.id, target());
      if (mine !== cl.cseq || !alive()) return;
      cl.status = map;
      if (!cl.autoPicked) {
        // Первый раз выбираем только подходящее; дальше галочки — дело человека, а смена цели лишь обновляет пометки
        cl.autoPicked = true;
        $$('.cl-row', box).forEach((row) => !$('input', row).disabled && ($('input', row).checked = (map[row.dataset.id] || 'ok') === 'ok'));
      }
      paintStatus();
    } catch (e) {
      if (mine === cl.cseq && alive()) toast(e.message, 'err');
    }
  }

  function paintCollection() {
    const d = cl.data;
    const tip = d.suggest;
    const rows = d.projects
      .map(
        (p) => `<label class="cl-row" data-id="${esc(p.id)}"><input type="checkbox" value="${esc(p.id)}" ${p.importable ? 'checked' : 'disabled'}>
          <div class="mod-icon">${p.icon ? `<img src="${esc(p.icon)}" alt="">` : '🧩'}</div>
          <span class="cl-title"><b>${esc(p.title)}</b><small>${esc(p.description)}</small></span>
          <span class="cl-type">${esc(CL_TYPE[p.type] || p.type)}</span><span class="cl-why"></span></label>`
      )
      .join('');
    el('#clBody').innerHTML = `
      <div class="cl-head"><b>${esc(d.name)}</b><small>${d.projects.length} ${plural(d.projects.length, 'проект', 'проекта', 'проектов')}</small>${d.missing ? `<small>удалено автором: ${d.missing}</small>` : ''}${d.truncated ? `<small>показаны первые ${d.projects.length}, ещё ${d.truncated} не загружены</small>` : ''}${d.description ? `<p class="hint">${esc(d.description)}</p>` : ''}</div>
      <div class="cl-target">
        <label class="field"><span>Куда ставить</span><select id="clTarget"><option value="new">➕ Новая сборка</option>${state.instances.map(instOption).join('')}</select></label>
        <div class="cl-new" id="clNew">
          <label class="field"><span>Версия Minecraft</span><select id="clVer"><option value="">Загружаю версии…</option></select></label>
          <label class="field"><span>Загрузчик</span><select id="clLoader">${Object.entries(LOADERS).map(([v, n]) => `<option value="${v}">${esc(n)}</option>`).join('')}</select></label>
          <label class="field cl-name"><span>Название (как у коллекции)</span><input id="clName" maxlength="40" placeholder="${esc(d.name.slice(0, 40))}"></label>
        </div>
      </div>
      ${tip ? `<p class="hint cl-tip" id="clTip">Для новой сборки подойдёт Minecraft ${esc(tip.version)} · ${esc(LOADERS[tip.loader] || tip.loader)}: под него есть ${tip.fits} из ${tip.total}</p>` : ''}
      <div class="cl-tools"><button class="btn ghost" id="clAll" type="button">Все подходящие</button><button class="btn ghost" id="clNone" type="button">Снять все</button><small id="clCount"></small></div>
      <div class="cl-list" id="clList">${rows || '<p class="hint">В коллекции пока ничего нет.</p>'}</div>`;
    el('#clGo').hidden = false;
    el('#clLoader').value = tip?.loader || 'fabric';
    fillVersionSelect(el('#clVer'), { current: tip?.version }).then(() => alive() && refreshStatus());
    // Все подходящие: выбрать то, что ставится и подходит; остальное снять
    el('#clAll').onclick = () => {
      $$('.cl-row', box).forEach((row) => !$('input', row).disabled && ($('input', row).checked = (cl.status[row.dataset.id] || 'ok') === 'ok'));
      countPicked();
    };
    el('#clNone').onclick = () => {
      $$('.cl-row input', box).forEach((i) => (i.checked = false));
      countPicked();
    };
    el('#clList').onchange = countPicked;
    el('#clTarget').onchange = () => {
      const fresh = el('#clTarget').value === 'new';
      el('#clNew').hidden = !fresh;
      if (el('#clTip')) el('#clTip').hidden = !fresh; // совет — про новую сборку, к существующей он не относится
      refreshStatus();
    };
    el('#clVer').onchange = el('#clLoader').onchange = refreshStatus;
    countPicked();
  }

  async function load() {
    const text = el('#clLink').value.trim();
    if (!text || cl.busy) return;
    const mine = ++cl.seq;
    el('#clLoad').disabled = true;
    el('#clBody').innerHTML = '<p class="hint">Читаю коллекцию…</p>';
    try {
      const data = await call('browse:collection', text);
      if (mine !== cl.seq || !alive()) return;
      cl.data = data;
      cl.status = {};
      cl.autoPicked = false;
      paintCollection();
    } catch (e) {
      if (mine !== cl.seq || !alive()) return;
      cl.data = null;
      el('#clGo').hidden = true;
      el('#clBody').innerHTML = `<p class="hint err">${esc(e.message)}</p>`;
    } finally {
      if (alive()) el('#clLoad').disabled = false;
    }
  }

  // Итог установки: что поставилось, что нет и почему, предупреждения лаунчера
  function paintResult(r) {
    const list = (items, fmt) => (items.length ? `<ul>${items.map((x) => `<li>${fmt(x)}</li>`).join('')}</ul>` : '');
    el('#clBody').innerHTML = `
      <div class="cl-result">
        <p class="cl-done"><b>${r.created ? `Создана сборка «${esc(r.instance.name)}»` : `Готово: «${esc(r.instance.name)}»`}</b> <small>${r.installed.length ? `поставлено: ${r.installed.length}` : 'ничего не поставилось'}</small></p>
        ${list(r.installed, (t) => esc(t))}
        ${r.failed.length ? `<p class="cl-bad"><b>Не вышло: ${r.failed.length}</b></p>${list(r.failed, (f) => `<b>${esc(f.title)}</b> <small>${esc(f.error)}</small>`)}` : ''}
        ${r.notes.length || r.warnings.length ? `<p class="hint">${[...r.notes, ...r.warnings].map(esc).join('<br>')}</p>` : ''}
      </div>`;
    el('#clGo').textContent = 'Открыть сборку';
    el('#clGo').hidden = false;
    el('#clGo').disabled = false;
    el('#clGo').onclick = () => {
      closeModal();
      showPage('instances');
      selectInstance(r.instance.id);
    };
    el('#clLink').disabled = true;
    el('#clLoad').hidden = true;
  }

  async function install() {
    const ids = picked();
    if (cl.busy || !ids.length || !cl.data) return;
    lock(true);
    try {
      const r = await call('browse:collectionImport', cl.data.id, target(), ids);
      await refresh(); // новая сборка и новые моды видны сразу
      toast(r.installed.length ? `Поставлено: ${r.installed.length} ♡` : 'Ничего не поставилось', r.installed.length ? 'ok' : 'err');
      if (r.installed.length) hearts();
      if (!alive()) return; // окно заменили другим, пока шла установка: итог остался в уведомлении
      cl.result = r;
      paintResult(r);
    } catch (e) {
      toast(e.message, 'err');
      if (alive()) lock(false);
    }
  }

  el('#clClose').onclick = closeModal;
  el('#clLoad').onclick = load;
  el('#clLink').onkeydown = (e) => e.key === 'Enter' && load();
  el('#clLink').addEventListener('paste', () => setTimeout(load, 60)); // вставил — сразу показываем
  el('#clGo').onclick = install;
  if (prefill) {
    el('#clLink').value = prefill;
    load();
  } else el('#clLink').focus();
}

$('#modsCollection').onclick = () => openCollection();
