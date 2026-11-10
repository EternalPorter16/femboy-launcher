// Перетаскивание файлов в окно

/* ---------- перетаскивание файлов в окно ---------- */
// Куда класть: на странице модов — в выбранную там сборку, иначе — в выбранную на главной
const dropTarget = () => ($('#page-mods').classList.contains('active') ? M.inst : state.selected) || null;
let dragDepth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
function showDrop() {
  const inst = instById(dropTarget());
  $('#dropTitle').textContent = inst ? `Отпусти — добавлю в «${inst.name}» ♡` : 'Отпусти — я всё разложу ♡';
  $('#dropOverlay').classList.add('show');
}
const hideDrop = () => $('#dropOverlay').classList.remove('show');
window.addEventListener('dragenter', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  if (dragDepth++ === 0) showDrop();
});
window.addEventListener('dragover', (e) => hasFiles(e) && e.preventDefault());
window.addEventListener('dragleave', (e) => {
  if (!hasFiles(e)) return;
  if (--dragDepth <= 0) ((dragDepth = 0), hideDrop());
});
window.addEventListener('drop', async (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  hideDrop();
  const files = [...e.dataTransfer.files];
  // Картинка — это скин: открываем редактор с ней
  const png = files.find((f) => /\.png$/i.test(f.name));
  const rest = files.filter((f) => f !== png);
  if (png) {
    if (!activeAccount()) toast('Добавь аккаунт, чтобы поставить скин ♡', 'err');
    else {
      const reader = new FileReader();
      reader.onload = () => (showPage('accounts'), openSkinEditor(reader.result, 'classic'));
      reader.readAsDataURL(png);
    }
  }
  if (!rest.length) return;
  const paths = rest.map((f) => api.pathForFile(f)).filter(Boolean);
  say('раскладываю файлы ♡');
  try {
    const r = await call('files:drop', dropTarget(), paths);
    if (r.done.length) toast(`Добавлено: ${r.done.join(', ')}`);
    r.notes.forEach((n) => (toast(n), log(n, 'info')));
    r.warnings.forEach((w) => (toast(w, 'err'), log(w, 'error')));
    await refresh();
    if (r.imported) {
      state.selected = r.imported.id;
      localStorage.setItem('selected', r.imported.id);
      showPage('instances');
      renderInstances();
      renderFooter();
    } else if ($('#page-mods').classList.contains('active')) loadMods();
    if (r.done.length) hearts();
  } catch (err) {
    toast(err.message, 'err');
  }
});
