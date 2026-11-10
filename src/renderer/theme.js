// Ставим тему до первой отрисовки, чтобы при запуске не мигало белым
(function () {
  try {
    const t = localStorage.getItem('theme') || 'light';
    const dark = t === 'dark' || t === 'midnight' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.documentElement.dataset.variant = t === 'sakura' || t === 'midnight' ? t : '';
    document.documentElement.dataset.accent = localStorage.getItem('accent') || 'pink';
    document.documentElement.dataset.acc = localStorage.getItem('acc') || 'none';
  } catch {}
})();
