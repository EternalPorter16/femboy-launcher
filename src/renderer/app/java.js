// Выбор Java

/* ---------- выбор Java ---------- */
// Под полем пути: «Найти Java» (список найденных на компьютере), «Выбрать файл…», «Авто» и подсказка, подходит ли выбранная Java игре
function attachJavaPicker(input, getVersion) {
  const wrap = document.createElement('div');
  wrap.className = 'java-pick';
  wrap.innerHTML = `<div class="java-btns"><button class="btn soft sm" type="button" data-j="find">Найти Java</button><button class="btn ghost sm" type="button" data-j="file">Выбрать файл…</button><button class="btn ghost sm" type="button" data-j="auto">Авто</button></div><select class="mini-select" hidden></select><small class="hint"></small>`;
  input.closest('.field').after(wrap);
  const sel = $('select', wrap);
  const hint = $('.hint', wrap);
  let seq = 0;
  let last = null;
  const show = (text, level) => {
    hint.textContent = text;
    hint.className = 'hint' + (level === 'bad' ? ' err' : level === 'warn' ? ' warn' : '');
  };
  const verify = async (force = false) => {
    const v = input.value.trim();
    const version = getVersion?.() || '';
    const key = `${v}|${version}`;
    if (!force && key === last) return;
    last = key;
    const n = ++seq;
    if (!v) return show('', 'ok');
    show('Проверяю…', 'ok');
    try {
      const r = await call('java:check', v, version);
      if (n === seq) show(r.message, r.level);
    } catch (err) {
      if (n === seq) show(err.message, 'bad');
    }
  };
  const set = (v) => {
    input.value = v;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    verify();
  };
  wrap.onclick = async (e) => {
    const b = e.target.closest('[data-j]');
    if (!b) return;
    if (b.dataset.j === 'auto') return set('');
    if (b.dataset.j === 'file') {
      try {
        const p = await call('java:pick');
        if (p) set(p);
      } catch (err) {
        toast(err.message, 'err');
      }
      return;
    }
    b.disabled = true;
    b.textContent = 'Ищу…';
    try {
      const list = await call('java:find');
      sel.innerHTML =
        `<option value="">${list.length ? 'Выбери из найденных…' : 'Java на компьютере не нашлось (лаунчер скачает нужную сам)'}</option>` +
        list.map((j) => `<option value="${esc(j.path)}">Java ${j.major} · ${esc(j.vendor || '—')} · ${esc(j.path)}</option>`).join('');
      sel.hidden = false;
    } catch (err) {
      toast(err.message, 'err');
    }
    b.disabled = false;
    b.textContent = 'Найти Java';
  };
  sel.onchange = () => sel.value && set(sel.value);
  input.addEventListener('input', () => {
    clearTimeout(input._jt);
    input._jt = setTimeout(verify, 500);
  });
  verify();
  return { verify };
}
