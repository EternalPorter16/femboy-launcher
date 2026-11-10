// Обложки сборок: пиксельные пейзажи в цвете сборки (для большой карточки на главной).
// Scenes.svg(цвет сборки, тёмная ли тема) → строка <svg>. Рисуется детерминированно: одна и та же сборка — один и тот же пейзаж
(function () {
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const mix = (a, b, t) => '#' + hex(a).map((v, i) => Math.round(v * (1 - t) + hex(b)[i] * t).toString(16).padStart(2, '0')).join('');
  const seeded = (seed) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  // По цвету иконки сборки (см. COLORS в app/core.js) выбираем набор красок пейзажа
  const KINDS = {
    '#ffd1e8': { sky: ['#ffdcec', '#ffc3dd'], sun: ['#fff4cf', '#ffb9d7'], hills: ['#f7b6d2', '#ec98be', '#da82b0'], tree: true },
    '#e3d5ff': { sky: ['#e8deff', '#cdbdff'], sun: ['#fffbe9', '#d9ccff'], hills: ['#c4b1f7', '#a995ec', '#8f78df'], sparkles: true },
    '#cdeeff': { sky: ['#d9efff', '#c3d3ff'], sun: ['#fff3cc', '#ffd5ee'], hills: ['#b2cdfb', '#93aaf3', '#7a8ce6'], sparkles: true },
    '#d4f7e3': { sky: ['#dcf7ee', '#b8eddb'], sun: ['#fffcd6', '#ffe590'], hills: ['#a3e2c8', '#74d1ad', '#4cbb92'] },
    '#fff1c9': { sky: ['#fff3d6', '#ffe0a8'], sun: ['#fffbe3', '#ffcf80'], hills: ['#f9d28c', '#f2b86b', '#e49b4f'] },
    '#ffd9cc': { sky: ['#ffe6dc', '#ffcdbb'], sun: ['#fffbe3', '#ffc9a8'], hills: ['#f8b9a2', '#f0987f', '#df7d66'], tree: true },
  };

  function hills(w, h, base, amp, phase, step) {
    let d = `M0 ${h}`;
    for (let x = 0; x <= w; x += step) {
      const v = base + amp * Math.sin(x * 0.0105 + phase) + amp * 0.55 * Math.sin(x * 0.027 + phase * 1.7);
      d += ` V${Math.round(v / step) * step} H${x + step}`;
    }
    return d + ` V${h} Z`;
  }
  const sparkle = (x, y, s, delay) =>
    `<path class="tw" style="animation-delay:-${delay}s" transform="translate(${x} ${y}) scale(${s})" fill="#fff" d="M0 -9 L2.4 -2.4 L9 0 L2.4 2.4 L0 9 L-2.4 2.4 L-9 0 L-2.4 -2.4 Z"/>`;

  function svg(color, dark) {
    const k0 = KINDS[String(color || '').toLowerCase()] || KINDS['#ffd1e8'];
    // Ночью тот же пейзаж, но с луной и звёздами
    const k = dark
      ? { sky: [mix(k0.sky[0], '#1b1232', 0.8), mix(k0.sky[1], '#35205a', 0.7)], sun: ['#fff9e8', mix(k0.sun[1], '#cdbdff', 0.55)], hills: k0.hills.map((c) => mix(c, '#190f2e', 0.58)), stars: true, moon: true, tree: k0.tree, sparkles: k0.sparkles, dim: true }
      : k0;
    const R = seeded(11 + String(color).length * 7 + (hex(k0.hills[0])[0] % 17));
    let o = `<svg viewBox="0 0 1064 320" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
<defs><linearGradient id="sc-sk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${k.sky[0]}"/><stop offset="1" stop-color="${k.sky[1]}"/></linearGradient>
<radialGradient id="sc-sn"><stop offset="0" stop-color="${k.sun[0]}"/><stop offset="1" stop-color="${k.sun[1]}"/></radialGradient></defs>
<rect width="1064" height="320" fill="url(#sc-sk)"/>`;
    if (k.stars) {
      for (let i = 0; i < 34; i++) {
        const big = R() > 0.75;
        o += `<rect class="tw" style="animation-delay:-${(R() * 3).toFixed(1)}s" x="${Math.round((R() * 1064) / 8) * 8}" y="${Math.round((R() * 190) / 8) * 8}" width="${big ? 6 : 4}" height="${big ? 6 : 4}" fill="#fff" opacity="${(0.5 + R() * 0.5).toFixed(2)}"/>`;
      }
    }
    o += `<circle cx="800" cy="98" r="104" fill="${k.sun[1]}" opacity=".16"/><circle cx="800" cy="98" r="76" fill="${k.sun[1]}" opacity=".24"/><circle cx="800" cy="98" r="48" fill="url(#sc-sn)"/>`;
    if (k.moon) o += `<circle cx="786" cy="88" r="8" fill="#cfc2f5" opacity=".55"/><circle cx="816" cy="112" r="6" fill="#cfc2f5" opacity=".55"/><circle cx="808" cy="80" r="4" fill="#cfc2f5" opacity=".5"/>`;
    if (!k.stars) {
      for (const [x, y, s] of [[600, 70, 1], [930, 52, 0.8], [700, 138, 0.7]]) {
        o += `<g fill="#fff" opacity=".88" transform="translate(${x} ${y}) scale(${s})"><rect y="12" width="76" height="18" rx="5"/><rect x="14" width="40" height="16" rx="5"/><rect x="48" y="7" width="30" height="14" rx="5"/></g>`;
      }
    }
    o += `<path d="${hills(1064, 320, 196, 26, 0.4, 16)}" fill="${k.hills[0]}"/><path d="${hills(1064, 320, 238, 22, 2.1, 16)}" fill="${k.hills[1]}"/>`;
    if (k.tree) {
      const trunk = k.dim ? '#6f5262' : '#b98a74';
      o += `<rect x="905" y="178" width="14" height="72" fill="${trunk}"/><rect x="898" y="236" width="28" height="14" fill="${trunk}"/>`;
      const cols = ['#ffb6d3', '#ff9cc6', '#ffd0e3', '#ff86b9'].map((c) => (k.dim ? mix(c, '#2a1442', 0.4) : c));
      for (let dy = -2; dy <= 1; dy++)
        for (let dx = -3; dx <= 3; dx++) if ((dx * dx) / 9 + (dy * dy) / 4 < 1.1 && R() > 0.1) o += `<rect x="${912 + dx * 22 - 11}" y="${158 + dy * 20 - 10}" width="22" height="20" fill="${cols[Math.floor(R() * 4)]}"/>`;
    }
    o += `<path d="${hills(1064, 320, 280, 14, 4.2, 16)}" fill="${k.hills[2]}"/>`;
    if (k.sparkles || k.tree) [[640, 44, 1.1], [980, 120, 0.9], [720, 190, 0.8], [1010, 40, 0.7], [560, 120, 0.8]].forEach(([x, y, s], n) => (o += sparkle(x, y, s, n * 0.7)));
    if (k.stars) o += sparkle(640, 60, 1.1, 0.2) + sparkle(960, 140, 0.9, 1.1);
    return o + '</svg>';
  }

  window.Scenes = { svg };
})();
