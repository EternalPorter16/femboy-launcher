// Поведение страницы: тема, меню на телефоне, лайтбокс скриншотов, сравнение тем и копирование контрольной суммы.
// Без библиотек; страница целиком работает и без этого скрипта (меню и галерея тогда просто не раскрываются).

import { initYandexDownloads } from '../lib/yandex-download.js';

initYandexDownloads();

// Ссылку на конкретный ответ можно отправить человеку: раскрываем его при переходе.
function revealHelpAnswer() {
  let id;
  try { id = decodeURIComponent(location.hash.slice(1)); } catch { return; }
  const answer = id && document.getElementById(id);
  if (answer instanceof HTMLDetailsElement) answer.open = true;
}
revealHelpAnswer();
window.addEventListener('hashchange', revealHelpAnswer);

const root = document.documentElement;
const THEME_KEY = 'fl-site-theme';
const en = root.lang === 'en';
const NAMES = { sakura: en ? 'Sakura' : '«Сакура»', midnight: en ? 'Midnight' : '«Полночь»' };

/* ---------- тема ---------- */
function setTheme(theme, save = true) {
  if (theme !== 'sakura' && theme !== 'midnight') return;
  root.dataset.theme = theme;
  root.style.colorScheme = theme === 'midnight' ? 'dark' : 'light';
  document.getElementById('theme-color')?.setAttribute('content', theme === 'midnight' ? '#0b0e1f' : '#fdeef4');
  if (save) {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* без хранилища тема просто не запомнится */
    }
  }
  syncThemeControls();
}
function syncThemeControls() {
  const t = root.dataset.theme;
  const other = t === 'midnight' ? 'sakura' : 'midnight';
  document.querySelectorAll('[data-theme-toggle]').forEach((b) => {
    b.setAttribute('aria-label', `${en ? 'Switch to' : 'Включить тему'} ${NAMES[other]}`);
    b.setAttribute('title', `${en ? 'Theme:' : 'Тема'} ${NAMES[other]}`);
  });
  document.querySelectorAll('[data-set-theme]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.setTheme === t)));
}
document.querySelectorAll('[data-theme-toggle]').forEach((b) =>
  b.addEventListener('click', () => setTheme(root.dataset.theme === 'midnight' ? 'sakura' : 'midnight')),
);
document.querySelectorAll('[data-set-theme]').forEach((b) => b.addEventListener('click', () => setTheme(b.dataset.setTheme)));
// Пока человек сам не выбрал тему, она следует за системой
const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
mq?.addEventListener?.('change', (e) => {
  let saved = null;
  try {
    saved = localStorage.getItem(THEME_KEY);
  } catch {}
  if (!saved) setTheme(e.matches ? 'midnight' : 'sakura', false);
});
syncThemeControls();

/* ---------- меню на телефоне ---------- */
const menuBtn = document.querySelector('.menu-btn');
const nav = document.getElementById('site-nav');
function setMenu(open, focusBack = false) {
  if (!menuBtn || !nav) return;
  nav.classList.toggle('open', open);
  menuBtn.setAttribute('aria-expanded', String(open));
  menuBtn.setAttribute('aria-label', open ? (en ? 'Close menu' : 'Закрыть меню') : (en ? 'Navigation menu' : 'Меню разделов'));
  // фокус на первый пункт, когда панель уже видна (visibility меняется с переходом)
  if (open) setTimeout(() => nav.classList.contains('open') && nav.querySelector('a')?.focus(), 30);
  else if (focusBack) menuBtn.focus();
}
menuBtn?.addEventListener('click', () => setMenu(menuBtn.getAttribute('aria-expanded') !== 'true'));
nav?.addEventListener('click', (e) => {
  if (e.target.closest('a')) setMenu(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && nav?.classList.contains('open')) setMenu(false, true);
});
document.addEventListener('click', (e) => {
  if (nav?.classList.contains('open') && !e.target.closest('.site-header')) setMenu(false);
});
// на широком экране меню всегда видно — сбрасываем состояние телефона
window.matchMedia('(min-width: 961px)').addEventListener('change', (e) => e.matches && setMenu(false));

/* ---------- лайтбокс ---------- */
const dlg = document.getElementById('lightbox');
if (dlg && typeof dlg.showModal === 'function') {
  const img = dlg.querySelector('#lb-img');
  const cap = dlg.querySelector('#lb-caption');
  const count = dlg.querySelector('#lb-count');
  let items = [];
  let index = 0;

  const show = (i) => {
    index = (i + items.length) % items.length;
    const t = items[index];
    img.src = t.dataset.full;
    img.alt = t.dataset.alt || t.dataset.caption || '';
    cap.textContent = t.dataset.caption || '';
    count.textContent = items.length > 1 ? `${index + 1} ${en ? 'of' : 'из'} ${items.length}` : '';
    dlg.querySelectorAll('[data-lb-prev], [data-lb-next]').forEach((b) => (b.hidden = items.length < 2));
  };

  document.querySelectorAll('[data-lb]').forEach((trigger) =>
    trigger.addEventListener('click', () => {
      items = [...document.querySelectorAll(`[data-lb="${trigger.dataset.lb}"]`)];
      show(items.indexOf(trigger));
      dlg.showModal();
      dlg.querySelector('[data-lb-close]').focus();
    }),
  );
  dlg.querySelector('[data-lb-close]').addEventListener('click', () => dlg.close());
  dlg.querySelector('[data-lb-prev]').addEventListener('click', () => show(index - 1));
  dlg.querySelector('[data-lb-next]').addEventListener('click', () => show(index + 1));
  dlg.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') show(index - 1);
    else if (e.key === 'ArrowRight') show(index + 1);
  });
  // щелчок по затемнению вокруг картинки закрывает
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) dlg.close();
  });
  // на телефоне — листание пальцем
  let x0 = null;
  img.addEventListener('pointerdown', (e) => (x0 = e.pointerType === 'mouse' ? null : e.clientX));
  img.addEventListener('pointerup', (e) => {
    if (x0 === null) return;
    const dx = e.clientX - x0;
    x0 = null;
    if (Math.abs(dx) > 50) show(index + (dx < 0 ? 1 : -1));
  });
  // фокус возвращается на кнопку, с которой открыли (так делает и сам <dialog>, но не все браузеры)
  let opener = null;
  document.addEventListener('focusin', (e) => {
    if (!dlg.open && e.target.closest?.('[data-lb]')) opener = e.target.closest('[data-lb]');
  });
  dlg.addEventListener('close', () => {
    img.src = 'data:,';
    opener?.focus();
  });
}

/* ---------- сравнение тем ---------- */
document.querySelectorAll('[data-compare]').forEach((box) => {
  const view = box.querySelector('.compare-view');
  const range = box.querySelector('input[type="range"]');
  const update = () => {
    const v = Number(range.value);
    view.style.setProperty('--pos', `${v}%`);
    range.setAttribute('aria-valuetext', v >= 95 ? (en ? 'Sakura only' : 'Только «Сакура»') : v <= 5 ? (en ? 'Midnight only' : 'Только «Полночь»') : `${NAMES.sakura} ${v}%, ${NAMES.midnight} ${100 - v}%`);
  };
  range.addEventListener('input', update);
  update();
});

/* ---------- копирование контрольной суммы ---------- */
document.querySelectorAll('[data-copy]').forEach((btn) =>
  btn.addEventListener('click', async () => {
    const text = document.getElementById(btn.dataset.copy)?.textContent.trim();
    const label = btn.querySelector('span');
    if (!text || !label) return;
    try {
      await navigator.clipboard.writeText(text);
      label.textContent = en ? 'Copied' : 'Скопировано';
    } catch {
      // без доступа к буферу выделяем строку, чтобы её можно было скопировать вручную
      const sel = window.getSelection();
      const r = document.createRange();
      r.selectNodeContents(document.getElementById(btn.dataset.copy));
      sel.removeAllRanges();
      sel.addRange(r);
      label.textContent = en ? 'Selected: press Ctrl+C' : 'Выделено: нажми Ctrl+C';
    }
    setTimeout(() => (label.textContent = en ? 'Copy' : 'Скопировать'), 2500);
  }),
);
