// Точки восстановления

/* ---------- точки восстановления ---------- */
const diffText = (d) => [d.added && `+${d.added}`, d.removed && `−${d.removed}`, d.changed && `~${d.changed}`].filter(Boolean).join(' ');

// Возврат к точке и обновление окна: общее для списка точек и для окна вылета («Откатить на последний удачный запуск»)
async function restorePoint(instId, snapId) {
  const r = await call('snapshots:restore', instId, snapId);
  toast(`Вернула «${r.restored.reason}» ✧`);
  say('вернула как было ♡');
  hearts();
  await refresh();
  loadHeroInfo(instId, true);
  if ($('#page-mods').classList.contains('active')) loadMods();
  return r;
}

async function openRestorePoints(instId) {
  const inst = instById(instId);
  if (!inst) return;
  const box = openModal(`
    <div class="crash-head"><div class="empty-cat" data-cat></div><div><h2>Точки восстановления 🕘</h2><p class="sub">${esc(inst.name)}</p></div></div>
    <div class="rp-list" id="rpList"><p class="hint">Смотрю…</p></div>
    <p class="hint" id="rpGood" hidden>«Последний удачный запуск» закреплена сверху: я обновляю её сама после каждой нормальной игры (дольше трёх минут, без вылета и без правок модов во время игры) и в лимит точек не считаю. Если игра вылетит, окно вылета покажет, что изменилось с этой точки, и предложит вернуться к ней.</p>
    <p class="hint">Перед обновлением модов и модпака, «Оптимизацией» и установкой недостающих модов я сама сохраняю точку. Возврат меняет моды, папку config и версию загрузчика; миры, скриншоты и настройки игры не трогаются. Нынешнее состояние я перед этим тоже сохраню, так что и возврат можно отменить.</p>
    <div class="modal-actions"><button class="btn ghost" id="rpClose">Закрыть</button><button class="btn soft" id="rpNew">Сохранить точку сейчас</button></div>`);
  $('#rpClose', box).onclick = closeModal;
  const paint = async () => {
    let list;
    try {
      list = await call('snapshots:list', instId);
    } catch (err) {
      if ($('#rpList', box)?.isConnected) $('#rpList', box).innerHTML = `<p class="hint err">${esc(err.message)}</p>`;
      return;
    }
    if (!$('#rpList', box)?.isConnected) return; // окно успели закрыть
    // «Последний удачный запуск» (kind: 'good') приходит первым и подсвечен
    const pin = '<span title="Закреплена: обновляется сама после каждой нормальной игры и в лимит точек не входит">📌</span> ';
    $('#rpList', box).innerHTML = list.length
      ? list
          .map(
            (s) => `<div class="rp-row${s.kind === 'good' ? ' pin' : ''}" data-id="${esc(s.id)}"><div class="rp-main"><b>${s.kind === 'good' ? pin : ''}${esc(s.reason)}</b><small><span>${esc(fmtDate(s.time))}</span> · <span>${s.mods} ${plural(s.mods, 'мод', 'мода', 'модов')}</span> · <span>${
              diffText(s.diff) ? 'с тех пор ' + diffText(s.diff) : 'моды те же'
            }</span></small></div><button class="btn soft sm" data-rp="restore">Вернуть</button><button class="btn ghost sm" data-rp="remove" title="Удалить точку">✕</button></div>`
          )
          .join('')
      : '<p class="hint">Точек пока нет. Они появятся сами перед обновлением модов, а ещё можно сохранить точку сейчас.</p>';
    $('#rpGood', box).hidden = !list.some((s) => s.kind === 'good');
  };
  $('#rpList', box).onclick = async (e) => {
    const b = e.target.closest('[data-rp]');
    if (!b) return;
    const id = b.closest('.rp-row').dataset.id;
    if (b.dataset.rp === 'remove') {
      try {
        await call('snapshots:remove', instId, id);
        paint();
      } catch (err) {
        toast(err.message, 'err');
      }
      return;
    }
    // Возврат меняет файлы сборки, поэтому просим второй клик
    if (!b.dataset.sure) {
      b.dataset.sure = '1';
      b.textContent = 'Точно вернуть?';
      b.classList.replace('soft', 'primary');
      setTimeout(() => {
        if (!b.isConnected || b.disabled) return;
        delete b.dataset.sure;
        b.textContent = 'Вернуть';
        b.classList.replace('primary', 'soft');
      }, 4000);
      return;
    }
    b.disabled = true;
    b.textContent = 'Возвращаю…';
    try {
      await restorePoint(instId, id);
    } catch (err) {
      toast(err.message, 'err');
    }
    paint();
  };
  $('#rpNew', box).onclick = async (e) => {
    e.target.disabled = true;
    try {
      await call('snapshots:create', instId);
      toast('Точка сохранена ♡');
    } catch (err) {
      toast(err.message, 'err');
    }
    e.target.disabled = false;
    paint();
  };
  paint();
}
