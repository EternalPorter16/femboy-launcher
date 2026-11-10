// Картинки установщика (NSIS): боковые полосы приветствия/завершения и шапка остальных экранов.
// Рисуются из HTML тем же котиком и тем же пиксельным пейзажем, что на карточке сборки в лаунчере (src/renderer/cat.js и scenes.js),
// а build/art/render.js сохраняет их в build/*.bmp. Запуск: npx electron build/art/render.js
// Фон шапки и страниц задан в build/installer.nsh (MUI_BGCOLOR) — цвет BG ниже должен совпадать с ним.
const path = require('path');
const { pathToFileURL } = require('url');

const BG = '#fff5fa';
// Шрифт лежит в проекте, из интернета ничего не берём
const FONT = pathToFileURL(path.join(__dirname, '..', '..', 'src', 'renderer', 'fonts', 'fredoka-latin.woff2')).href;
const FONTS = `<style>@font-face { font-family: 'Fredoka'; font-weight: 600 700; src: url('${FONT}') format('woff2'); }</style>`;

const CAT_CSS = `
  .cat { display: block; width: 100%; height: 100%; overflow: visible; }
  .cat .ln { stroke: #231a29; stroke-width: 3.4; stroke-linecap: round; stroke-linejoin: round; }
  .cat .ln:not([fill]) { fill: none; }
  .cat .ln.thin { stroke-width: 2.2; }
  .cat .acc { display: none; }
  .bow .cat .acc-bow { display: inline; }
`;
const heart = (x, y, s, c, r = 0) =>
  `<svg class="deco" style="left:${x}px;top:${y}px;width:${s}px;height:${s}px;transform:rotate(${r}deg)" viewBox="0 0 20 20"><path d="M10 17.5S1.5 12.3 1.5 6.6C1.5 3.8 3.6 2 5.9 2c1.8 0 3.2 1 4.1 2.4C10.9 3 12.3 2 14.1 2c2.3 0 4.4 1.8 4.4 4.6 0 5.7-8.5 10.9-8.5 10.9z" fill="${c}"/></svg>`;
const spark = (x, y, s, c = '#fff', o = 1) =>
  `<svg class="deco" style="left:${x}px;top:${y}px;width:${s}px;height:${s}px;opacity:${o}" viewBox="0 0 20 20"><path d="M10 0C10.8 6 14 9.2 20 10 14 10.8 10.8 14 10 20 9.2 14 6 10.8 0 10 6 9.2 9.2 6 10 0z" fill="${c}"/></svg>`;
const paw = (x, y, s, c, r = 0) =>
  `<svg class="deco" style="left:${x}px;top:${y}px;width:${s}px;height:${s}px;transform:rotate(${r}deg)" viewBox="0 0 20 20" fill="${c}"><ellipse cx="10" cy="13.5" rx="5" ry="4.2"/><circle cx="4" cy="8" r="2.2"/><circle cx="8" cy="4.6" r="2.2"/><circle cx="12" cy="4.6" r="2.2"/><circle cx="16" cy="8" r="2.2"/></svg>`;
const tear = (x, y, s) =>
  `<svg class="deco" style="left:${x}px;top:${y}px;width:${s}px;height:${s * 1.4}px" viewBox="0 0 10 14"><path d="M5 0C6.5 4 9.5 6.5 9.5 9.4A4.5 4.5 0 0 1 .5 9.4C.5 6.5 3.5 4 5 0z" fill="#7ec8ff" stroke="#231a29" stroke-width="1"/></svg>`;

const page = (w, h, body, css) => `<!doctype html><html><head><meta charset="utf-8">${FONTS}<style>
  html, body { margin: 0; width: ${w}px; height: ${h}px; overflow: hidden; }
  body { position: relative; font-family: 'Fredoka', 'Segoe UI', sans-serif; }
  .deco { position: absolute; }
  ${CAT_CSS}${css}
</style></head><body>${body}</body></html>`;

// Пейзаж с карточки сборки (scenes.js), обрезанный под полосу: справа вишня и солнце, слева края холмов
const scene = (color, dark) =>
  `<script>(function(){var s=Scenes.svg('${color}',${dark}).replace('viewBox="0 0 1064 320" preserveAspectRatio="xMidYMid slice"','viewBox="860 104 204 216" preserveAspectRatio="xMidYMax slice"');document.getElementById('scene').innerHTML=s;})();</script>`;

// Боковая полоса 164×314: название сверху, пейзаж снизу, котик впереди справа. Украшения не заходят на название (оно до y≈90)
const sidebar = ({ gradient, ink, bow, extra, sceneColor, dark }) =>
  page(
    164,
    314,
    `<div class="title">Femboy<br>Launcher</div>
     <div class="scene" id="scene"></div>
     <div class="catbox ${bow ? 'bow' : ''}" data-cat></div>
     ${extra}${scene(sceneColor, dark)}`,
    `body { background: ${gradient}; }
     /* название «наклейкой»: цветные буквы в белой (или тёмной, ночью) обводке */
     .title { position: absolute; top: 24px; width: 100%; text-align: center; color: ${ink}; font-weight: 700; font-size: 27px; line-height: 1.02;
              -webkit-text-stroke: 6px ${dark ? '#2d2358' : '#fff'}; paint-order: stroke fill; letter-spacing: 0.3px; z-index: 3;
              filter: drop-shadow(0 2px 0 rgba(120, 40, 110, 0.18)); }
     .scene { position: absolute; left: 0; bottom: 0; width: 164px; height: 190px; -webkit-mask-image: linear-gradient(180deg, transparent 0, #000 46px); }
     .scene svg { width: 164px; height: 190px; display: block; }
     .catbox { position: absolute; right: -8px; bottom: -16px; width: 140px; height: 160px; z-index: 2; }
     .deco { z-index: 3; }`
  );

module.exports = {
  installerSidebar: {
    w: 164,
    h: 314,
    html: sidebar({
      gradient: 'linear-gradient(180deg, #fff0f7 0%, #ffd6ea 38%, #ffc3dd 100%)',
      ink: '#ff4f9e',
      bow: true,
      dark: false,
      sceneColor: '#ffd1e8',
      extra:
        spark(16, 104, 13, '#fff') + spark(132, 98, 10, '#fff') + spark(98, 130, 9, '#fff', 0.85) +
        heart(22, 152, 13, '#ff5fa8', -12) + heart(54, 122, 10, '#ff9ccb', 10) +
        paw(10, 8, 13, 'rgba(255,255,255,0.8)', -20) + paw(142, 8, 11, 'rgba(255,255,255,0.7)', 18),
    }),
  },
  // Удаление: тот же пейзаж, но ночью, а котик грустит — слезинки
  uninstallerSidebar: {
    w: 164,
    h: 314,
    html: sidebar({
      gradient: 'linear-gradient(180deg, #4a3c8f 0%, #2d2358 55%, #231b48 100%)',
      ink: '#a99bff',
      bow: false,
      dark: true,
      sceneColor: '#e3d5ff',
      extra:
        tear(50, 252, 7) + tear(106, 255, 6) + spark(20, 112, 10, '#fff', 0.9) + spark(136, 132, 12, '#fff', 0.9) +
        heart(122, 104, 13, '#9db4ff', 10) + paw(12, 12, 12, 'rgba(255,255,255,0.45)', -20),
    }),
  },
  // Шапка 150×57 справа вверху: розовое облачко с головой котика, слева растворяется в фон
  installerHeader: {
    w: 150,
    h: 57,
    html: page(
      150,
      57,
      `<div class="cloud"></div>
       <div class="catbox bow" data-cat="head"></div>
       ${heart(64, 8, 11, '#ff5fa8', -10) + heart(54, 34, 8, '#ffb1d0', 12) + spark(84, 4, 9, '#ffb1d0') + spark(140, 40, 8, '#cbb8ff')}`,
      `body { background: ${BG}; }
       .cloud { position: absolute; inset: 0; background: radial-gradient(ellipse 70% 120% at 100% 50%, #ffc4df 0%, #ffd9eb 45%, ${BG} 75%); }
       .catbox { position: absolute; right: 12px; top: 3px; width: 50px; height: 52px; }`
    ),
  },
};
