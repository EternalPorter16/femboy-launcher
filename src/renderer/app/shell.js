// Оболочка окна: навигация, кнопки заголовка, маскот, профиль в сайдбаре

/* ---------- навигация и окно ---------- */
function moveIndicator() {
  const active = $('.nav-btn.active');
  if (active) $('#navIndicator').style.setProperty('--y', active.offsetTop + 'px');
}
function showPage(p) {
  document.body.dataset.page = p; // от страницы зависит, показывать ли мини-плеер внизу
  $$('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.page === p));
  $$('.page').forEach((s) => s.classList.toggle('active', s.id === 'page-' + p));
  moveIndicator();
  if (p === 'mods') loadMods();
  if (p === 'instances' && state.selected) loadHeroInfo(state.selected, true); // моды и миры могли поменяться
  if (p === 'settings' && $('.set-sec.on')?.dataset.sec === 'kitty') loadPlayStats(); // после игры данные другие
  if (p === 'accounts' && !skinViewer) renderSkinCard();
  else pauseSkin();
}
document.body.dataset.page = 'instances';
$$('.nav-btn').forEach((b) => (b.onclick = () => showPage(b.dataset.page)));
window.addEventListener('resize', moveIndicator);
$('#meCard').onclick = () => showPage('accounts');
$('#meCard').oncontextmenu = (e) => (e.preventDefault(), copyNick(activeAccount()?.name)); // правый клик по своему профилю копирует ник
$('#wMin').onclick = () => call('win:minimize');
$('#wMax').onclick = () => call('win:maximize');
$('#wClose').onclick = () => call('win:close');
document.addEventListener('error', (e) => e.target.tagName === 'IMG' && e.target.classList.add('broken'), true);

/* ---------- маскот ---------- */
let bubbleTimer;
// Котик живёт на главной. Пока ты на другой странице, его слова приходят маленьким уведомлением с мордочкой
function kittyToast(text, ms) {
  const el = document.createElement('div');
  el.className = 'toast kitty';
  el.innerHTML = '<span class="kt-cat" data-cat="head"></span><span class="kt-text"></span>';
  $('.kt-text', el).textContent = text;
  $('#toasts').append(el);
  drawCats(el);
  setTimeout(() => el.classList.add('out'), ms);
  setTimeout(() => el.remove(), ms + 400);
}
function say(text, ms = 4000) {
  wake();
  if (!$('#page-instances').classList.contains('active')) return kittyToast(text, Math.min(ms, 4500));
  const bubble = $('#bubble');
  const mascot = $('#mascot');
  bubble.classList.add('hide');
  setTimeout(() => {
    bubble.textContent = text;
    bubble.classList.remove('hide');
  }, 160);
  mascot.classList.remove('bounce');
  void mascot.offsetWidth;
  mascot.classList.add('bounce');
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => bubble.classList.add('hide'), ms);
}
// Сердечки вылетают из котика, когда что-то получилось
function hearts(n = 6) {
  const mascot = $('#mascot');
  for (let i = 0; i < n; i++) {
    const h = document.createElement('span');
    h.className = 'heart-pop';
    h.textContent = pick(['♥', '♡', '✦']);
    h.style.left = 40 + Math.random() * 60 + '%';
    h.style.setProperty('--dx', (Math.random() * 60 - 30).toFixed(0) + 'px');
    h.style.setProperty('--rot', (Math.random() * 60 - 30).toFixed(0) + 'deg');
    h.style.animationDelay = i * 0.08 + 's';
    mascot.append(h);
    setTimeout(() => h.remove(), 1600 + i * 80);
  }
}
const SEASON_PHRASES = {
  winter: ['укутайся потеплее ♡', 'за окном снег, а здесь уютно ❄️', 'горячий чай и новая стройка? ☕'],
  halloween: ['кошелёк или жизнь? 🎃', 'я страшный ведьмак 😳🧙', 'бу! испугался? :3'],
  newyear: ['с наступающим! 🎄', 'хочу мандаринку 🍊', 'загадал желание… про тебя 😳'],
  valentine: ['ты мне нравишься 😳💖', 'держи сердечко ♡', 'будешь моим валентинкой? :3'],
};
const HOUR_PHRASES = () => {
  const h = new Date().getHours();
  if (h < 5) return ['уже ночь… иди спать 😳', 'ну ещё одну катку и спать, да? 🌙', 'зеваю… *мяу* 💤'];
  if (h < 11) return ['доброе утро ☀️', 'утречко! кофе и майнкрафт? ☕'];
  if (h < 17) return ['привет! поиграем? :3', 'хороший денёк для стройки ⛏️'];
  if (h < 23) return ['добрый вечер ✨', 'вечерняя катка? 😳'];
  return ['поздно уже… но я с тобой ♡', 'ночной майнкрафт — самый уютный 🌙'];
};
// Фразы котика: обычные, по времени суток, праздничные и свои из настроек
function phrasePool() {
  return [...PHRASES, ...HOUR_PHRASES(), ...(SEASON_PHRASES[root.dataset.season] || []), ...(state.settings.catPhrases || [])];
}
$('#mascot').onclick = () => {
  say(pick(phrasePool().filter((p) => p !== $('#bubble').textContent)));
  hearts(root.dataset.season === 'valentine' ? 8 : 3);
};
// Приветствие при запуске — по времени суток или празднику
setTimeout(() => {
  const s = root.dataset.season;
  say(s && Math.random() < 0.6 ? pick(SEASON_PHRASES[s]) : pick(HOUR_PHRASES()), 6000);
  $('#mascot').classList.toggle('tired', new Date().getHours() < 5);
}, 900);

// Долгая игра: каждые 2 часа котик напоминает отдохнуть (и уведомлением Windows, если лаунчер спрятан)
const runStart = {};
const remindedAt = {};
setInterval(() => {
  for (const id of state.running) {
    const hours = Math.floor((Date.now() - (runStart[id] || Date.now())) / 3600000);
    if (hours >= 2 && hours % 2 === 0 && remindedAt[id] !== hours) {
      remindedAt[id] = hours;
      const text = `ты играешь уже ${hours} ч… попей водички и разомнись 💧`;
      say(text, 8000);
      if (document.hidden && 'Notification' in window) new Notification('Femboy Launcher', { body: text, silent: true });
    }
  }
}, 60000);

// Если долго ничего не трогать — котик засыпает
let idleTimer;
let sleeping = false;
function wake() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(sleep, 90000);
  if (!sleeping) return;
  sleeping = false;
  $('#mascot').classList.remove('sleep');
  $('#bubble').classList.add('hide');
}
function sleep() {
  if (state.launching.size) return wake();
  sleeping = true;
  $('#mascot').classList.add('sleep');
  const bubble = $('#bubble');
  bubble.textContent = 'zzz… 💤';
  bubble.classList.remove('hide');
}
['mousemove', 'keydown', 'mousedown'].forEach((e) => document.addEventListener(e, wake, { passive: true }));
wake();

/* ---------- профиль в сайдбаре ---------- */
function avatarHtml(acc, cls = '', dot = false) {
  const head = localSkinData(manualSkinPreviews.get(acc?.id)?.head) || localSkinData(acc?.head);
  const picture = head ? `<img src="${esc(head)}" alt="">` : `<div class="fallback">${esc((acc?.name || '?').slice(0, 1).toUpperCase())}</div>`;
  return `<div class="avatar ${cls}">${picture}${dot && acc ? `<i class="dot ${acc.type}"></i>` : ''}</div>`;
}


// Внизу боковой панели: аватарка, ник и точка — зелёная у Microsoft, жёлтая у оффлайн-аккаунта
function renderMe() {
  const acc = activeAccount();
  $('#meCard').innerHTML = acc ? `${avatarHtml(acc, '', true)}<span class="me-name">${esc(acc.name)}</span>` : `${avatarHtml(null)}<span class="me-name">Добавить</span>`;
  $('#meCard').title = acc ? `${acc.name} · ${ACC_TYPES[acc.type] || acc.type}` : 'Добавить аккаунт';
  $('#hello').textContent = acc ? `Привет, ${acc.name} ~` : 'Привет ~';
}
