// Копии миров, синхронизация, железо (карточки настроек)

/* ---------- копии, синхронизация, железо ---------- */
function renderSync() {
  const s = state.sync || {};
  $('#syncInfo').textContent = s.dir
    ? `Папка: ${s.dir}. Последняя синхронизация: ${s.at ? fmtDate(s.at) : 'ещё не было'}. Сборки синхронизируются перед игрой и после неё.`
    : 'Выбери папку облака (Яндекс.Диск, OneDrive, Google Drive) — и сборки с мирами будут одинаковыми на всех твоих компьютерах. Аккаунты туда не попадают.';
  $('#syncNow').disabled = $('#syncOff').disabled = !s.dir;
}
const syncResult = (r) => {
  if (!r) return;
  if (r.errors?.length) toast('Синхронизация завершилась с ошибками. Проверь сообщения ниже.', 'err');
  else toast(`Синхронизировано ♡ Отдано файлов: ${r.up}, получено: ${r.down}`);
  r.errors?.forEach((e) => toast(e, 'err'));
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
