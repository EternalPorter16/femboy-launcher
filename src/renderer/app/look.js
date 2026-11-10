// Оформление: тема, живой фон, курсоры, мордочка котика

/* ---------- тема, фон, аксессуар котика ---------- */
const systemDark = matchMedia('(prefers-color-scheme: dark)');
let shownLang = null;
let reloading = false; // язык вернули на русский: окно перезагрузится, всё начатое на этой странице пропадёт
// Праздник по дате — котик переодевается сам (если в настройках не выключено)
function season(d = new Date()) {
  const md = (d.getMonth() + 1) * 100 + d.getDate();
  if (md >= 1020 && md <= 1103) return 'halloween';
  if (md >= 1215 || md <= 110) return 'newyear';
  if (md >= 210 && md <= 215) return 'valentine';
  if (md >= 1201 || md <= 229) return 'winter';
  return '';
}

function applyTheme() {
  const { theme = 'light', accent = 'pink', accentColor = '#ff5fa8', mascotAccessory = 'none', bgOpacity = 35, bgBlur = 0, seasonal = true } = state.settings;
  // «Сакура» — светлая тема с другой палитрой, «Полночь» — тёмная
  const dark = theme === 'dark' || theme === 'midnight' || (theme === 'system' && systemDark.matches);
  root.dataset.theme = dark ? 'dark' : 'light';
  root.dataset.variant = theme === 'sakura' || theme === 'midnight' ? theme : '';
  root.dataset.accent = accent;
  root.dataset.acc = mascotAccessory;
  root.dataset.season = seasonal ? season() : '';
  const motion = state.settings.motion || 'on';
  root.dataset.motion = motion === 'off' || (motion === 'system' && matchMedia('(prefers-reduced-motion: reduce)').matches) ? 'reduce' : '';
  // Свой цвет акцента — прямо в переменные (второй цвет градиента подмешиваем голубым)
  if (accent === 'custom') {
    root.style.setProperty('--accent', accentColor);
    root.style.setProperty('--accent-2', `color-mix(in srgb, ${accentColor} 45%, #8ec9ff)`);
  } else {
    root.style.removeProperty('--accent');
    root.style.removeProperty('--accent-2');
  }
  // Экономный режим: без фоновых эффектов и бесконечных анимаций (на батарее — сам, если в настройках «Авто»)
  const eco = ecoActive();
  root.toggleAttribute('data-eco', eco);
  Calm.setEco(eco);
  $('#calmNote').textContent = eco ? ((state.settings.eco || 'auto') === 'auto' ? 'сейчас экономит: ты на батарее' : 'экономный режим включён') : '';
  backgroundFx(eco || root.dataset.motion === 'reduce' ? null : ['winter', 'newyear'].includes(root.dataset.season) ? 'snow' : theme === 'sakura' ? 'sakura' : theme === 'midnight' ? 'stars' : dark ? 'fireflies' : null);
  applyCursor(state.settings.cursor || 'paw');
  try {
    localStorage.setItem('theme', theme);
    localStorage.setItem('accent', accent);
    localStorage.setItem('acc', mascotAccessory);
  } catch {}
  if (!I18N.set(state.settings.lang || 'ru')) {
    reloading = true;
    call('win:reload');
  }
  if (shownLang !== I18N.lang) {
    shownLang = I18N.lang;
    if (heroDark !== null) renderInstances(); // даты и подписи на главной зависят от языка
  }
  const bg = $('#bgImage');
  const url = state.system.backgroundUrl;
  bg.classList.toggle('on', !!url);
  bg.style.backgroundImage = url ? `url("${url}")` : '';
  bg.style.setProperty('--bg-op', bgOpacity / 100);
  bg.style.setProperty('--bg-blur', bgBlur + 'px');
  call('app:setTheme', dark).catch(() => {});
  if (heroDark !== null && heroDark !== dark) renderHero(); // обложка сборки ночью другая
}
systemDark.addEventListener('change', applyTheme);
// Питание приходит из основного процесса; «Авто» в настройках экономного режима значит «пока ноутбук на батарее»
const ecoActive = () => (state.settings.eco || 'auto') === 'on' || ((state.settings.eco || 'auto') === 'auto' && !!state.power?.battery);
api.on('power:state', (p) => ((state.power = p), applyTheme()));

// Живой фон тем: «Сакура» — падающие лепестки, тёмная — светлячки, «Полночь» — звёзды и падающие звёзды
const rnd = (a, b) => a + Math.random() * (b - a);
const FX = {
  snow: () => Array.from({ length: 24 }, () => ['snow', { left: rnd(0, 100) + '%', '--size': rnd(2, 5) + 'px', animationDuration: rnd(14, 25) + 's', animationDelay: -rnd(0, 25) + 's' }]),
  sakura: () =>
    Array.from({ length: 14 }, () => [
      'petal',
      { left: rnd(0, 100) + '%', animationDuration: rnd(9, 18) + 's', animationDelay: -rnd(0, 18) + 's', '--size': rnd(11, 20) + 'px', '--drift': rnd(-60, 60) + 'px' },
    ]),
  fireflies: () => [
    ...Array.from({ length: 22 }, () => ['star dim', { left: rnd(0, 100) + '%', top: rnd(0, 70) + '%', '--size': rnd(1, 2.2) + 'px', animationDuration: rnd(3, 7) + 's', animationDelay: -rnd(0, 7) + 's' }]),
    ...Array.from({ length: 18 }, () => [
      'firefly',
      {
        left: rnd(0, 100) + '%',
        top: rnd(20, 100) + '%',
        '--size': rnd(4, 8) + 'px',
        '--dx': rnd(-90, 90) + 'px',
        '--dy': -rnd(60, 220) + 'px',
        animationDuration: `${rnd(9, 18)}s, ${rnd(2, 4.5)}s`,
        animationDelay: `${-rnd(0, 18)}s, ${-rnd(0, 4)}s`,
      },
    ]),
  ],
  stars: () => [
    ...Array.from({ length: 70 }, () => ['star', { left: rnd(0, 100) + '%', top: rnd(0, 100) + '%', '--size': rnd(1, 2.8) + 'px', animationDuration: rnd(2.5, 6) + 's', animationDelay: -rnd(0, 6) + 's' }]),
    ...Array.from({ length: 3 }, (_, i) => ['shooting', { left: rnd(30, 95) + '%', top: rnd(-5, 35) + '%', animationDuration: rnd(11, 19) + 's', animationDelay: i * 5 + rnd(1, 4) + 's' }]),
  ],
};
// Курсоры: лапка и котик в цвет акцента. Картинка 32×32, «x y» — точка, которой кликаешь
const INK = '#231a29';
const CURSORS = {
  paw: {
    default: (a) => [
      `<path d='M3 2.5L3 22l5-4.4 3.4 7.9 3.2-1.4-3.3-7.7H18z' fill='#fff' stroke='${INK}' stroke-width='1.6' stroke-linejoin='round'/>
       <g fill='${a}' stroke='#fff' stroke-width='.8'><ellipse cx='23.5' cy='26' rx='4' ry='3.3'/><circle cx='19' cy='21.6' r='1.7'/><circle cx='22' cy='19.3' r='1.7'/><circle cx='25.4' cy='19.3' r='1.7'/><circle cx='28.2' cy='21.7' r='1.7'/></g>`,
      3,
      2,
    ],
    pointer: (a) => [
      `<g fill='${a}' stroke='${INK}' stroke-width='1.4'><ellipse cx='16' cy='21.5' rx='8' ry='6.5'/><ellipse cx='6.5' cy='12.5' rx='3.2' ry='3.8'/><ellipse cx='12' cy='6.5' rx='3.2' ry='3.8'/><ellipse cx='20' cy='6.5' rx='3.2' ry='3.8'/><ellipse cx='25.5' cy='12.5' rx='3.2' ry='3.8'/></g>
       <ellipse cx='14' cy='19.5' rx='3' ry='1.8' fill='#fff' opacity='.5'/>`,
      16,
      4,
    ],
  },
  kitty: {
    default: (a) => [kittyFace(a, false), 4, 3],
    pointer: (a) => [kittyFace(a, true), 4, 3],
  },
};
// Мордочка котика; кликает кончик левого ушка. happy — зажмурился и с сердечком (над кнопками)
function kittyFace(a, happy) {
  const eyes = happy
    ? `<path d='M9.8 18.6q2.2-2.8 4.4 0M19.2 18.6q2.2-2.8 4.4 0' fill='none' stroke='${INK}' stroke-width='1.5' stroke-linecap='round'/>`
    : `<path d='M9.5 16.5h4.6q-.2 3.6-2.3 3.6t-2.3-3.6zM18.9 16.5h4.6q-.2 3.6-2.3 3.6t-2.3-3.6z' fill='${INK}'/><path d='M9 16.4h5.6M18.4 16.4H24' stroke='${INK}' stroke-width='1.2'/>`;
  return `<path d='M4 3l7.5 7q5-1.7 10 0L28 4.5v11q1.5 12.5-11.5 13Q3.5 28 4.5 15.5z' fill='#fff' stroke='${INK}' stroke-width='1.6' stroke-linejoin='round'/>
    <path d='M6.8 7.2l2.6 3.8M25.4 8.2l-2 3.2' stroke='${a}' stroke-width='1.6' stroke-linecap='round'/>${eyes}
    <path d='M14.6 22.4q1 1.3 2 0q1 1.3 2 0' fill='none' stroke='${INK}' stroke-width='1.2' stroke-linecap='round'/>
    <path d='M6.4 21.6l1.6-.9-.6 1.6 1.6-.9M24 21.6l1.6-.9-.6 1.6 1.6-.9' fill='none' stroke='#e5304d' stroke-width='.9'/>
    ${happy ? `<path d='M27.5 3c-.9-1.7-3.4-1.2-3.4.6 0 1.6 3.4 3.4 3.4 3.4s3.4-1.8 3.4-3.4c0-1.8-2.5-2.3-3.4-.6z' fill='${a}' stroke='#fff' stroke-width='.8'/>` : ''}`;
}
let cursorKey = '';
function applyCursor(kind) {
  const set = CURSORS[kind];
  const accent = getComputedStyle(root).getPropertyValue('--accent').trim();
  const a = /^#[0-9a-f]{3,8}$/i.test(accent) ? accent : state.settings.accentColor || '#ff5fa8';
  if (cursorKey === kind + a) return;
  cursorKey = kind + a;
  const css = (fn, fallback) => {
    const [svg, x, y] = fn(a);
    return `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'>${svg}</svg>`)}") ${x} ${y}, ${fallback}`;
  };
  root.style.setProperty('--cur-default', set ? css(set.default, 'auto') : 'auto');
  root.style.setProperty('--cur-pointer', set ? css(set.pointer, 'pointer') : 'pointer');
}

let fxKind = null;
function backgroundFx(kind) {
  if (kind === fxKind) return;
  fxKind = kind;
  // Лепестки, светлячки и звёзды живут в своём слое: во сне лаунчера он тускнеет целиком
  let layer = $('.fx-layer');
  if (!layer) $('.bg').append((layer = Object.assign(document.createElement('div'), { className: 'fx-layer' })));
  layer.replaceChildren();
  for (const [cls, style] of kind ? FX[kind]() : []) {
    const el = document.createElement('i');
    el.className = 'fx ' + cls;
    for (const [k, v] of Object.entries(style)) k.startsWith('--') ? el.style.setProperty(k, v) : (el.style[k] = v);
    layer.append(el);
  }
}

// Recheck on wake/focus and across midnight without changing saved preferences.
function refreshSeason() {
  if (state.settings.seasonal !== false && root.dataset.season !== season()) applyTheme();
}
setInterval(refreshSeason, 30000);
window.addEventListener('focus', refreshSeason);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshSeason(); });
