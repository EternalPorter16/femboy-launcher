// «Итоги игры»: окно с картинкой за неделю или месяц. Числа и подписи на нужном языке считает core/recap.js (канал game:recap), здесь —
// рисование на холсте, выбор срока, скрытие названий сборок и две кнопки: сохранить файлом (диалог открывает главный процесс) и скопировать

const RC = { W: 1080, H: 1350, PAD: 72, KEY: 'recapOpts' };

function rcSaved() {
  try {
    const o = JSON.parse(localStorage.getItem(RC.KEY) || '{}');
    return { period: o.period === 'month' ? 'month' : 'week', hide: o.hide === true };
  } catch {
    return { period: 'week', hide: false };
  }
}
function rcRemember(o) {
  try {
    localStorage.setItem(RC.KEY, JSON.stringify({ period: o.period, hide: o.hide }));
  } catch {}
}

// Шрифты лаунчера подгружаются по мере надобности; на холсте их надо дождаться, иначе первая картинка выйдет системным шрифтом
let rcFontsReady = null;
const rcFonts = () =>
  (rcFontsReady ||= Promise.all(['700 40px Comfortaa', '700 34px Fredoka', '700 30px Nunito', '800 30px Nunito'].map((f) => document.fonts.load(f, 'Aa Яя 0123456789').catch(() => null))));

// Котик на картинке: тот же рисунок, что в окне, но отдельным SVG со своими стилями (страничные стили в картинку не попадают) и в том наряде, что выбран
let rcCatCache = null;
function rcCatImage() {
  const acc = root.dataset.acc && root.dataset.acc !== 'none' ? `acc-${root.dataset.acc}` : ['halloween', 'newyear', 'winter'].includes(root.dataset.season) ? `acc-${root.dataset.season}` : '';
  if (rcCatCache?.acc === acc) return rcCatCache.promise;
  const css = `.ln{stroke:#231a29;stroke-width:3.4;stroke-linecap:round;stroke-linejoin:round}.ln:not([fill]){fill:none}.ln.thin{stroke-width:2.2}.acc{display:none}${acc ? `.${acc}{display:inline}` : ''}`;
  const svg = boykisser()
    .replace(/<svg\b/, '<svg width="412" height="472"')
    .replace(/<svg\b[^>]*>/, (open) => `${open}<style>${css}</style>`);
  const img = new Image();
  const promise = new Promise((done) => {
    img.onload = () => done(img);
    img.onerror = () => done(null); // без котика картинка всё равно получится
  });
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  rcCatCache = { acc, promise };
  return promise;
}

/* ---------- рисование ---------- */
function rcRound(c, x, y, w, h, r) {
  const k = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + k, y);
  c.arcTo(x + w, y, x + w, y + h, k);
  c.arcTo(x + w, y + h, x, y + h, k);
  c.arcTo(x, y + h, x, y, k);
  c.arcTo(x, y, x + w, y, k);
  c.closePath();
}
function rcText(c, s, x, y, font, color, align = 'left') {
  c.font = font;
  c.fillStyle = color;
  c.textAlign = align;
  c.textBaseline = 'alphabetic';
  c.fillText(s, x, y);
}
// Самый большой размер шрифта (не больше px и не меньше min), при котором строка влезает в maxW
function rcFit(c, s, fontOf, px, maxW, min = 22) {
  for (; px > min; px -= 2) {
    c.font = fontOf(px);
    if (c.measureText(s).width <= maxW) break;
  }
  return px;
}
// Длинное название обрезаем многоточием (по символам, а не по половинкам эмодзи)
function rcCut(c, s, maxW) {
  if (c.measureText(s).width <= maxW) return s;
  const chars = [...s];
  while (chars.length > 1 && c.measureText(`${chars.join('')}…`).width > maxW) chars.pop();
  return `${chars.join('').trimEnd()}…`;
}
function rcWrap(c, s, maxW) {
  const lines = [];
  let line = '';
  for (const word of s.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && c.measureText(next).width > maxW) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}
// То же, но строки выходят ровнее: число строк остаётся прежним, а ширина сужается до самой узкой, при которой оно не растёт
// (так на второй строке не повисает одинокое «:3» или эмодзи)
function rcWrapEven(c, s, maxW) {
  const lines = rcWrap(c, s, maxW);
  if (lines.length < 2) return lines;
  let lo = maxW * 0.4;
  let hi = maxW;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (rcWrap(c, s, mid).length > lines.length) lo = mid;
    else hi = mid;
  }
  return rcWrap(c, s, hi);
}
function rcGlow(c, x, y, r, color, alpha) {
  const g = c.createRadialGradient(x, y, 0, x, y, r);
  c.save();
  c.globalAlpha = alpha;
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, RC.W, RC.H);
  c.restore();
}
function rcStar(c, x, y, r, color, alpha) {
  c.save();
  c.globalAlpha = alpha;
  c.fillStyle = color;
  c.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (Math.PI / 4) * i - Math.PI / 2;
    const d = i % 2 ? r * 0.28 : r;
    c.lineTo(x + Math.cos(a) * d, y + Math.sin(a) * d);
  }
  c.closePath();
  c.fill();
  c.restore();
}
function rcPanel(c, x, y, w, h, r) {
  rcRound(c, x, y, w, h, r);
  c.fillStyle = 'rgba(255,255,255,0.075)';
  c.fill();
  c.lineWidth = 1.5;
  c.strokeStyle = 'rgba(255,255,255,0.13)';
  c.stroke();
}

// Рисует карточку целиком; card — ответ game:recap, cat — картинка котика (или null)
function paintRecap(canvas, card, cat) {
  const c = canvas.getContext('2d');
  const { W, H, PAD } = RC;
  const css = getComputedStyle(root);
  const A = css.getPropertyValue('--accent').trim() || '#ff5fa8'; // цвета берём у выбранной темы
  const B = css.getPropertyValue('--accent-2').trim() || '#8ec9ff';
  const display = (px) => `700 ${px}px Comfortaa, Nunito, "Segoe UI", sans-serif`;
  const body = (w, px) => `${w} ${px}px Nunito, "Segoe UI", sans-serif`;
  const MUTED = '#cbbfe0';
  const inner = W - PAD * 2;

  c.clearRect(0, 0, W, H);
  const bg = c.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#2c1c42');
  bg.addColorStop(1, '#150f21');
  c.fillStyle = bg;
  c.fillRect(0, 0, W, H);
  rcGlow(c, W * 0.12, 90, 560, A, 0.34);
  rcGlow(c, W * 0.96, 1150, 640, B, 0.22);
  for (const [x, y, r, a] of [[948, 74, 16, 0.9], [1004, 138, 9, 0.6], [880, 36, 8, 0.5], [820, 150, 6, 0.4], [1020, 52, 6, 0.5]]) rcStar(c, x, y, r, '#fff', a);

  // шапка
  rcText(c, card.brand, PAD, 92, `700 34px Fredoka, Comfortaa, sans-serif`, B);
  rcText(c, card.title, PAD, 176, display(rcFit(c, card.title, display, 78, inner)), '#fff');
  rcText(c, card.range, PAD, 224, body(700, 32), MUTED);

  // главное число
  rcPanel(c, PAD, 252, inner, 256, 36);
  const bigPx = rcFit(c, card.big, display, 132, inner - 80, 56);
  c.font = display(bigPx);
  const bigW = c.measureText(card.big).width;
  const grad = c.createLinearGradient(W / 2 - bigW / 2, 0, W / 2 + bigW / 2, 0);
  grad.addColorStop(0, A);
  grad.addColorStop(1, B);
  rcText(c, card.big, W / 2, 385, display(bigPx), grad, 'center');
  rcText(c, card.bigLabel, W / 2, 434, body(700, 34), MUTED, 'center');
  if (card.delta) {
    const d = card.delta;
    const dPx = rcFit(c, d.text, (p) => body(800, p), 28, inner - 140);
    c.font = body(800, dPx);
    const pw = c.measureText(d.text).width + 84;
    const px = (W - pw) / 2;
    rcRound(c, px, 452, pw, 42, 21);
    c.fillStyle = 'rgba(255,255,255,0.1)';
    c.fill();
    const col = d.dir > 0 ? '#8ee6b8' : d.dir < 0 ? '#ffb1d0' : MUTED;
    c.fillStyle = col;
    c.beginPath();
    if (d.dir) {
      const s = d.dir > 0 ? -1 : 1;
      c.moveTo(px + 30, 473 + 8 * s);
      c.lineTo(px + 39, 473 - 6 * s);
      c.lineTo(px + 21, 473 - 6 * s);
      c.closePath();
      c.fill();
    } else rcRound(c, px + 20, 471, 20, 4, 2), c.fill();
    rcText(c, d.text, px + 52, 482, body(800, dPx), '#fff');
  }

  // столбики по дням
  rcPanel(c, PAD, 528, inner, 190, 32);
  const n = card.days.length;
  const left = PAD + 36;
  const slot = (inner - 72) / n;
  const peak = Math.max(...card.days.map((d) => d.ms), 1);
  const today = c.createLinearGradient(0, 568, 0, 676);
  today.addColorStop(0, A);
  today.addColorStop(1, B);
  card.days.forEach((d, i) => {
    const bw = Math.min(56, slot * (n > 10 ? 0.62 : 0.5));
    const x = left + slot * i + (slot - bw) / 2;
    const h = d.ms ? Math.max(12, Math.round((d.ms / peak) * 108)) : 5;
    rcRound(c, x, 676 - h, bw, h, Math.min(bw / 2, 12));
    c.save();
    c.globalAlpha = d.ms ? (d.today ? 1 : 0.6) : 0.18;
    c.fillStyle = d.ms ? (d.today ? today : A) : '#fff';
    c.fill();
    c.restore();
    if (d.tick) rcText(c, d.label, x + bw / 2, 706, body(d.today ? 800 : 700, n > 10 ? 22 : 25), d.today ? '#fff' : '#b9aad2', 'center');
  });

  // четыре факта
  const cw = (inner - 24) / 2;
  card.facts.forEach((f, i) => {
    const x = PAD + (i % 2) * (cw + 24);
    const y = 738 + Math.floor(i / 2) * 112;
    rcPanel(c, x, y, cw, 96, 28);
    rcText(c, f.label, x + 28, y + 34, body(700, 22), MUTED);
    c.font = body(700, 22);
    const subW = f.sub ? c.measureText(f.sub).width + 18 : 0;
    const vPx = rcFit(c, f.value, display, 40, cw - 56 - subW, 24);
    rcText(c, f.value, x + 28, y + 78, display(vPx), '#fff');
    if (f.sub) rcText(c, f.sub, x + cw - 28, y + 78, body(700, 22), MUTED, 'right');
  });

  // любимая сборка (название можно скрыть)
  const fav = card.favourite;
  if (fav) {
    rcPanel(c, PAD, 966, inner, 100, 28);
    const named = !!fav.name;
    rcText(c, fav.label, PAD + 28, named ? 998 : 1010, body(700, named ? 22 : 26), MUTED);
    const stat = `${fav.value} · ${fav.percent}`;
    rcText(c, stat, W - PAD - 28, named ? 998 : 1010, body(800, 24), '#fff', 'right');
    if (named) {
      c.font = display(32);
      rcText(c, rcCut(c, fav.name, inner - 56), PAD + 28, 1036, display(32), '#fff');
    }
    const by = named ? 1048 : 1032;
    rcRound(c, PAD + 28, by, inner - 56, 12, 6);
    c.fillStyle = 'rgba(255,255,255,0.14)';
    c.fill();
    const fill = c.createLinearGradient(PAD + 28, 0, W - PAD - 28, 0);
    fill.addColorStop(0, A);
    fill.addColorStop(1, B);
    rcRound(c, PAD + 28, by, Math.max(12, (inner - 56) * fav.share), 12, 6);
    c.fillStyle = fill;
    c.fill();
  }

  // котик с репликой
  const catH = 262;
  const catW = Math.round((catH * 206) / 236);
  if (cat) c.drawImage(cat, PAD - 14, H - catH, catW, catH);
  const bx = PAD + catW;
  const bw = W - PAD - bx;
  let px = 34;
  c.font = body(800, px);
  let lines = rcWrapEven(c, card.comment, bw - 64);
  if (lines.length > 3) {
    px = 28;
    c.font = body(800, px);
    lines = rcWrapEven(c, card.comment, bw - 64);
  }
  const lh = Math.round(px * 1.28);
  const bh = Math.max(96, lines.length * lh + 44);
  const by = H - catH * 0.56 - bh / 2; // середина пузыря — на уровне лица котика
  rcRound(c, bx, by, bw, bh, 30);
  c.fillStyle = '#fff';
  c.fill();
  c.beginPath();
  c.moveTo(bx + 2, by + bh / 2 - 15);
  c.lineTo(bx - 26, by + bh / 2 + 4);
  c.lineTo(bx + 2, by + bh / 2 + 15);
  c.closePath();
  c.fill();
  lines.forEach((l, i) => rcText(c, l, bx + 32, by + 22 + lh * (i + 0.8), body(800, px), '#231a29'));
}

// Текстовое описание картинки для экранных помощников; по нему же проверки видят, что нарисовано
const rcSummary = (k) =>
  [
    k.title,
    k.range,
    `${k.big} — ${k.bigLabel}`,
    k.delta?.text,
    ...k.facts.map((f) => `${f.label}: ${f.value}${f.sub ? ` (${f.sub})` : ''}`),
    k.favourite && `${k.favourite.label}: ${[k.favourite.name, k.favourite.value, k.favourite.percent].filter(Boolean).join(', ')}`,
    k.comment,
  ]
    .filter(Boolean)
    .join('. ');

/* ---------- окно ---------- */
function openRecap() {
  const rc = { ...rcSaved(), seq: 0, card: null, busy: false };
  const box = openModal(`
    <div class="crash-head"><div class="empty-cat" data-cat></div><div><h2>Итоги игры 🖼️</h2><p class="sub">Картинка за неделю или месяц — можно показать друзьям</p></div></div>
    <div class="rc-body">
      <div class="rc-stage"><canvas id="rcCanvas" width="${RC.W}" height="${RC.H}" role="img"></canvas></div>
      <div class="rc-side">
        <div class="field"><span>За какой срок</span><div class="seg" id="rcPeriod"><button data-v="week">Неделя</button><button data-v="month">Месяц</button></div></div>
        <label class="toggle"><input type="checkbox" id="rcHide"><span class="knob"></span>Скрыть названия сборок</label>
        <p class="hint rc-note" id="rcNote"></p>
        <p class="hint">Картинка рисуется здесь же и никуда не отправляется. Если покажешь её друзьям, названия сборок можно скрыть.</p>
      </div>
    </div>
    <div class="modal-actions wrap"><button class="btn ghost" id="rcClose">Закрыть</button><button class="btn soft" id="rcCopy" disabled>Скопировать</button><button class="btn primary" id="rcSave" disabled>Сохранить картинку</button></div>`);
  box.classList.add('rc', 'sticky-actions');
  const el = (sel) => $(sel, box);
  const alive = () => box.isConnected && !!el('#rcCanvas');
  const lang = () => (I18N.lang === 'en' ? 'en' : 'ru');
  const lock = (on) => {
    rc.busy = on;
    el('#rcSave').disabled = el('#rcCopy').disabled = on || !rc.card;
  };

  async function refresh() {
    const mine = ++rc.seq;
    lock(true);
    try {
      const [card, cat] = await Promise.all([call('game:recap', rc.period, { lang: lang(), hideNames: rc.hide }), rcCatImage(), rcFonts()]);
      if (mine !== rc.seq || !alive()) return; // пока считалось, срок переключили или окно закрыли
      rc.card = card;
      paintRecap(el('#rcCanvas'), card, cat);
      el('#rcCanvas').setAttribute('aria-label', rcSummary(card));
      el('#rcNote').textContent = card.empty ? 'За этот срок игр ещё не было — сыграй, и тут появятся итоги ♡' : '';
    } catch (e) {
      if (mine === rc.seq && alive()) toast(e.message, 'err');
    }
    if (mine === rc.seq && alive()) lock(false);
  }
  const syncUi = () => {
    $$('#rcPeriod button', box).forEach((b) => b.classList.toggle('on', b.dataset.v === rc.period));
    el('#rcHide').checked = rc.hide;
  };

  el('#rcPeriod').onclick = (e) => {
    const v = e.target.closest('button')?.dataset.v;
    if (!v || v === rc.period) return;
    rc.period = v;
    rcRemember(rc);
    syncUi();
    refresh();
  };
  el('#rcHide').onchange = () => {
    rc.hide = el('#rcHide').checked;
    rcRemember(rc);
    refresh();
  };
  el('#rcClose').onclick = closeModal;
  el('#rcCopy').onclick = async () => {
    if (rc.busy || !rc.card) return;
    try {
      await call('app:copyImage', el('#rcCanvas').toDataURL('image/png'));
      toast('Картинка скопирована ♡');
    } catch (e) {
      toast(e.message, 'err');
    }
  };
  el('#rcSave').onclick = async () => {
    if (rc.busy || !rc.card) return;
    try {
      const file = await call('app:saveImage', el('#rcCanvas').toDataURL('image/png'), { period: rc.period, lang: lang() });
      if (file) toast('Картинка сохранена ♡');
    } catch (e) {
      toast(e.message, 'err');
    }
  };
  syncUi();
  refresh();
}

// Кнопка в карточке «Время в игре» (её содержимое перерисовывается, поэтому слушаем всю карточку)
$('#playStats').addEventListener('click', (e) => {
  if (e.target.closest('[data-act="recap"]')) openRecap();
});
