// Копии миров, синхронизация, железо (карточки настроек)

/* ---------- копии, синхронизация, железо ---------- */
function renderSync() {
  const s = state.sync || {};
  $('#syncInfo').textContent = s.dir
    ? `Папка: ${s.dir}. Последняя синхронизация: ${s.at ? fmtDate(s.at) : 'ещё не было'}. Сборки синхронизируются перед игрой и после неё.${s.error ? ` Последняя попытка не удалась: ${s.error}` : ''}`
    : 'Выбери папку облака (Яндекс.Диск, OneDrive, Google Drive) — и сборки с мирами будут одинаковыми на всех твоих компьютерах. Аккаунты туда не попадают.';
  $('#syncNow').disabled = $('#syncOff').disabled = $('#syncRestore').disabled = !s.dir;
  $('#syncMigrate').hidden = !(s.dir && s.legacy);
}
const syncResult = (r) => {
  if (!r) return;
  if (r.errors?.length || r.ahead?.length) toast('Синхронизация завершилась с ошибками. Проверь сообщения ниже.', 'err');
  else if (r.conflicts?.length || r.warnings?.length) toast('Синхронизация завершилась с предупреждениями ♡', 'err');
  else toast(`Синхронизировано ♡ Отдано файлов: ${r.up}, получено: ${r.down}`);
  r.errors?.forEach((e) => toast(e, 'err'));
  r.conflicts?.forEach((e) => toast(e, 'err'));
  r.warnings?.forEach((e) => toast(e, 'err'));
  if (r.skipped?.length) toast(`Пропущено (идёт игра): ${r.skipped.join(', ')}`);
};
$('#syncPick').onclick = async () => {
  try {
    syncResult(await call('sync:pick'));
    await refresh();
  } catch (err) {
    toast(err.message, 'err');
  }
};
$('#syncNow').onclick = async () => {
  try {
    syncResult(await call('sync:now'));
    await refresh();
  } catch (err) {
    toast(err.message, 'err');
  }
};
// «Восстановить облако с этого компьютера» (sync.publishLocal): выход, если облако застряло на «Облако ещё обновляется»,
// а другой компьютер не возвращается. Только после подтверждения: состояние выбранной сборки здесь станет облачным, прежняя
// облачная копия уходит в «Корзину» папки облака. При запущенной игре кнопка подтверждения недоступна; успех — только по ответу
function restoreCloudDialog() {
  if (!state.instances.length) return toast('Сначала создай сборку ♡', 'err');
  const first = [state.sync?.errorId, state.selected].find((id) => id && instById(id)) || state.instances[0].id;
  const box = openModal(`
    <div class="crash-head"><div class="empty-cat" data-cat></div><div><h2>Восстановить облако с этого компьютера?</h2><p class="sub">Выход, если облако застряло на «Облако ещё обновляется»</p></div></div>
    <label class="field"><span>Сборка</span><select id="srInst">${state.instances.map((i) => `<option value="${esc(i.id)}">${esc(i.name)}</option>`).join('')}</select></label>
    <p class="hint" id="srText"></p>
    <p class="hint">На другом компьютере ничего не перезапишется: где его сборка отличается от этой, при его следующей синхронизации обе версии сохранятся рядом (конфликтная копия) и уйдут в облако.</p>
    <p class="hint" id="srBusy" hidden></p>
    <div class="modal-actions wrap">
      <button class="btn ghost" id="srNo">Отмена</button>
      <button class="btn soft" id="srYes">Восстановить облако</button>
    </div>`);
  const sel = $('#srInst', box);
  sel.value = first;
  const paint = () => {
    const inst = instById(sel.value);
    const busy = state.running.has(inst.id) || state.launching.has(inst.id);
    $('#srText', box).textContent = `Состояние сборки «${inst.name}» на этом компьютере станет новым облачным состоянием. Прежняя облачная копия сохранится в корзине синхронизации: папка «Корзина» в папке облака.`;
    $('#srBusy', box).textContent = busy ? `Сборка «${inst.name}» сейчас запущена: сначала закрой игру.` : '';
    $('#srBusy', box).hidden = !busy;
    $('#srYes', box).disabled = busy;
  };
  sel.onchange = paint;
  paint();
  $('#srNo', box).onclick = () => closeModal();
  $('#srYes', box).onclick = async () => {
    const id = sel.value;
    if (state.running.has(id) || state.launching.has(id)) return paint();
    closeModal();
    try {
      const r = await call('sync:publishLocal', id);
      toast(`Облако восстановлено с этого компьютера: «${r.name}» ♡`);
      [...(r.conflicts || []), ...(r.warnings || [])].forEach((e) => toast(e, 'err'));
      if (r.all) [...(r.all.errors || []), ...(r.all.conflicts || []), ...(r.all.warnings || [])].forEach((e) => toast(e, 'err'));
    } catch (err) {
      toast(err.message, 'err');
    }
    await refresh().catch(() => {});
  };
}
$('#syncRestore').onclick = () => restoreCloudDialog();
// «Перевести облако на новый формат» (sync.migrate): один раз после обновления с 0.10.2. Только после подтверждения.
// Если в прежней папке есть изменения другого компьютера, которых нет здесь, эти сборки не переводятся: второе окно
// показывает, что именно отличается, и переводит без них только по отдельному подтверждению (force)
async function runMigrate(force) {
  try {
    const r = await call('sync:migrate', force);
    if (r?.migrated) toast(`Переведено сборок: ${r.migrated} ♡ Обнови лаунчер на других компьютерах`);
    syncResult(r);
    if (r?.ahead?.length) migrateAheadDialog(r.ahead);
  } catch (err) {
    toast(err.message, 'err');
  }
  await refresh().catch(() => {});
}
function migrateAheadDialog(list) {
  const box = openModal(`
    <div class="crash-head"><div class="empty-cat" data-cat></div><div><h2>Не всё переведено</h2><p class="sub">В прежней папке облака есть изменения другого компьютера</p></div></div>
    ${list.map((t) => `<p class="hint">${esc(t)}</p>`).join('')}
    <p class="hint">Лучше обнови лаунчер на том компьютере и переведи облако оттуда: тогда его изменения попадут в новую папку.</p>
    <p class="hint">Если перевести отсюда, эти изменения в новую папку не попадут: они останутся в прежней папке облака и на том компьютере, а после обновления лаунчера там сохранятся рядом как конфликтные копии.</p>
    <div class="modal-actions wrap">
      <button class="btn ghost" id="saNo">Отмена</button>
      <button class="btn soft" id="saYes">Перевести без них</button>
    </div>`);
  $('#saNo', box).onclick = () => closeModal();
  $('#saYes', box).onclick = () => (closeModal(), runMigrate(true));
}
$('#syncMigrate').onclick = () => {
  const box = openModal(`
    <div class="crash-head"><div class="empty-cat" data-cat></div><div><h2>Перевести облако на новый формат?</h2><p class="sub">Нужно один раз после обновления лаунчера</p></div></div>
    <p class="hint">Лаунчер отдаст сборки с этого компьютера в новую папку облака («v2» в папке «Femboy Launcher Sync»). Прежняя копия только сверяется и остаётся нетронутой; в облаке понадобится ещё столько же места.</p>
    <p class="hint">Если в прежней папке есть изменения другого компьютера, которых нет здесь, такая сборка не переводится: лаунчер покажет, что именно отличается.</p>
    <p class="hint">Лаунчеры 0.10.2 и раньше на других компьютерах перестанут синхронизировать переведённые сборки — обнови лаунчер там. Их изменения не пропадут: после обновления, где сборки отличаются, обе версии сохранятся рядом.</p>
    <div class="modal-actions wrap">
      <button class="btn ghost" id="smNo">Отмена</button>
      <button class="btn soft" id="smYes">Перевести</button>
    </div>`);
  $('#smNo', box).onclick = () => closeModal();
  $('#smYes', box).onclick = () => (closeModal(), runMigrate(false));
};
$('#syncOff').onclick = async () => {
  await call('sync:off').catch((err) => toast(err.message, 'err'));
  await refresh();
  toast('Синхронизация выключена — копия в облаке осталась');
};
$('#backupSeg').onclick = (e) => e.target.dataset.v && saveSettings({ autoBackup: e.target.dataset.v });
$('#backupKeep').onchange = (e) => saveSettings({ backupKeep: +e.target.value });

const TIERS = { weak: 'скромный — бережём FPS', mid: 'средний — хватит на лёгкие шейдеры', strong: 'мощный — тянет красивые шейдеры ✨' };
let hw = null;
async function renderHardware() {
  try {
    hw = hw || (await call('hw:info'));
  } catch {
    $('#hwInfo').innerHTML = '<p class="hint">Не получилось узнать железо.</p>';
    return;
  }
  $('#hwInfo').innerHTML = `
    <div class="hw-list">
      <div><span>Память</span><b>${Math.round(hw.ramMb / 1024)} ГБ</b></div>
      <div><span>Видеокарта</span><b>${esc(hw.gpus.join(', ') || 'не определилась')}</b></div>
      <div><span>Процессор</span><b>${esc(hw.cpu)} · ${hw.cores} потоков</b></div>
      <div><span>Компьютер</span><b>${TIERS[hw.tier]}</b></div>
    </div>
    <p class="hint">Советую: ${fmtRam(hw.maxRam)} памяти для игры${hw.shader ? `, шейдеры ${esc(hw.shader.name)} (кнопка «Шейдеры под мой ПК» в сборке)` : ', без шейдеров — лучше включи «Оптимизацию» в сборке'}.</p>`;
  $('#hwApply').disabled = state.settings.maxRam === hw.maxRam;
}
$('#hwApply').onclick = async () => {
  if (!hw) return;
  await saveSettings({ maxRam: hw.maxRam, minRam: Math.min(state.settings.minRam, hw.maxRam) });
  toast(`Игре дано ${fmtRam(hw.maxRam)} памяти ♡`);
  renderHardware();
};
