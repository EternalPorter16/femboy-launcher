// Пиксельный пейзаж из лаунчера (src/renderer/scenes.js) для сайта: те же холмы, солнце, облака, сакура,
// а ночью — луна и звёзды. Рисуется при сборке страницы; отличие от лаунчера — свой префикс id градиентов,
// чтобы два пейзажа на одной странице не путали свои заливки.

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, t) => '#' + hex(a).map((v, i) => Math.round(v * (1 - t) + hex(b)[i] * t).toString(16).padStart(2, '0')).join('');
const seeded = (seed) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

const KINDS = {
  sakura: { sky: ['#ffdcec', '#ffc3dd'], sun: ['#fff4cf', '#ffb9d7'], hills: ['#f7b6d2', '#ec98be', '#da82b0'], tree: true },
  midnight: { sky: ['#cdeeff', '#c3d3ff'], sun: ['#fff3cc', '#ffd5ee'], hills: ['#b2cdfb', '#93aaf3', '#7a8ce6'], tree: true },
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

/**
 * @param {'sakura'|'midnight'} kind
 * @param {{ id: string, width?: number, sun?: boolean }} opts  width — ширина полотна; sun: false — без солнца и луны
 */
export function sceneSvg(kind, { id, width = 1064, sun = true } = {}) {
  const dark = kind === 'midnight';
  const k0 = KINDS[kind] || KINDS.sakura;
  const k = dark
    ? { sky: ['#0d1230', '#1e1a4a'], sun: ['#fff9e8', mix(k0.sun[1], '#cdbdff', 0.55)], hills: ['#1d2550', '#252b5e', '#2e2f6a'].map((c, i) => mix(c, ['#3a2a6e', '#3b2466', '#43275f'][i], 0.35)), stars: true, moon: true, tree: true, dim: true }
    : k0;
  const W = width;
  const H = 320;
  const R = seeded(29);
  const sunX = Math.round(W * 0.78);
  let o = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMax slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
<defs><linearGradient id="${id}-sk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${k.sky[0]}"/><stop offset="1" stop-color="${k.sky[1]}"/></linearGradient>
<radialGradient id="${id}-sn"><stop offset="0" stop-color="${k.sun[0]}"/><stop offset="1" stop-color="${k.sun[1]}"/></radialGradient></defs>
<rect width="${W}" height="${H}" fill="url(#${id}-sk)"/>`;
  if (k.stars) {
    for (let i = 0; i < Math.round(W / 26); i++) {
      const big = R() > 0.75;
      o += `<rect class="tw" style="animation-delay:-${(R() * 3).toFixed(1)}s" x="${Math.round((R() * W) / 8) * 8}" y="${Math.round((R() * 190) / 8) * 8}" width="${big ? 6 : 4}" height="${big ? 6 : 4}" fill="#fff" opacity="${(0.45 + R() * 0.5).toFixed(2)}"/>`;
    }
  }
  if (sun) o += `<circle cx="${sunX}" cy="98" r="104" fill="${k.sun[1]}" opacity=".16"/><circle cx="${sunX}" cy="98" r="76" fill="${k.sun[1]}" opacity=".24"/><circle cx="${sunX}" cy="98" r="48" fill="url(#${id}-sn)"/>`;
  if (sun && k.moon) o += `<circle cx="${sunX - 14}" cy="88" r="8" fill="#cfc2f5" opacity=".55"/><circle cx="${sunX + 16}" cy="112" r="6" fill="#cfc2f5" opacity=".55"/><circle cx="${sunX + 8}" cy="80" r="4" fill="#cfc2f5" opacity=".5"/>`;
  if (!k.stars) {
    for (const [fx, y, s] of [[0.12, 60, 0.9], [0.46, 40, 1], [0.6, 120, 0.7], [0.9, 52, 0.8]]) {
      o += `<g fill="#fff" opacity=".88" transform="translate(${Math.round(W * fx)} ${y}) scale(${s})"><rect y="12" width="76" height="18" rx="5"/><rect x="14" width="40" height="16" rx="5"/><rect x="48" y="7" width="30" height="14" rx="5"/></g>`;
    }
  }
  o += `<path d="${hills(W, H, 196, 26, 0.4, 16)}" fill="${k.hills[0]}"/><path d="${hills(W, H, 238, 22, 2.1, 16)}" fill="${k.hills[1]}"/>`;
  // деревья сакуры: одно, как в лаунчере, и ещё одно слева на широком полотне
  const trees = W > 1300 ? [Math.round(W * 0.88), Math.round(W * 0.07)] : [Math.round(W * 0.85)];
  for (const tx of trees) {
    const trunk = k.dim ? '#4f3a5c' : '#b98a74';
    o += `<rect x="${tx - 7}" y="178" width="14" height="72" fill="${trunk}"/><rect x="${tx - 14}" y="236" width="28" height="14" fill="${trunk}"/>`;
    const cols = ['#ffb6d3', '#ff9cc6', '#ffd0e3', '#ff86b9'].map((c) => (k.dim ? mix(c, '#2a1442', 0.45) : c));
    for (let dy = -2; dy <= 1; dy++)
      for (let dx = -3; dx <= 3; dx++) if ((dx * dx) / 9 + (dy * dy) / 4 < 1.1 && R() > 0.1) o += `<rect x="${tx + dx * 22 - 11}" y="${158 + dy * 20 - 10}" width="22" height="20" fill="${cols[Math.floor(R() * 4)]}"/>`;
  }
  o += `<path d="${hills(W, H, 280, 14, 4.2, 16)}" fill="${k.hills[2]}"/>`;
  [[0.6, 44, 1.1], [0.92, 120, 0.9], [0.68, 190, 0.8], [0.95, 40, 0.7], [0.53, 120, 0.8], [0.3, 70, 0.9]].forEach(([fx, y, s], n) => (o += sparkle(Math.round(W * fx), y, s, n * 0.7)));
  return o + '</svg>';
}
