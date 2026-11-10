// Основа интерфейса: общие помощники, состояние и вызовы главного процесса.
// Файлы этой папки — один скрипт, разрезанный по темам: у них общая область видимости, порядок подключения задаёт index.html (core.js первым, start.js последним).

// window.api приходит из preload.js (contextBridge) и уже доступен как глобальный api
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const root = document.documentElement;

const ICONS = ['🌸', '🎀', '🐱', '🐰', '🍓', '🧁', '🦋', '💖', '🍰', '🌈', '⭐', '🍬', '🐾', '🌙', '🍑', '🫧'];
const COLORS = ['#ffd1e8', '#e3d5ff', '#cdeeff', '#d4f7e3', '#fff1c9', '#ffd9cc'];
const LOADERS = { vanilla: 'Ванилла', fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge' };
const KINDS = { mod: 'Моды', modpack: 'Модпаки', resourcepack: 'Ресурспаки', shader: 'Шейдеры' };
const NAME_RE = /^[A-Za-z0-9_]{3,16}$/;
const PHRASES = [
  'ты ведь любишь майнкрафт, да? 😳',
  'поставь мне модов :3',
  'я слежу за твоими сборками 👀',
  'мяу~ ♡',
  'не забудь Fabric API!',
  'ещё одну катку? ♡',
  'гладь ещё 😳',
  'sodium — это база',
  'шейдеры? шейдеры! ✨',
];

const state = {
  accounts: [],
  activeAccount: null,
  settings: {},
  instances: [],
  friends: [], // друзья для игры по сети (общий список; галочка on — «пустить в этот мир»)
  guests: {}, // сборка → ники друзей, которые сейчас в её мире (лаунчер читает их заходы и выходы из лога игры)
  system: {},
  versions: null,
  selected: localStorage.getItem('selected'),
  power: { battery: false }, // питание: на батарее ли ноутбук
  running: new Set(), // запущенные сборки
  launching: new Set(), // сборки, которые сейчас готовятся к запуску
  packBusy: false,
  mods: { tab: 'installed', type: 'mod', query: '', offset: 0, total: 0, items: [], installed: [], inst: null, req: 0, category: '', sort: '' },
};

async function call(channel, ...args) {
  const r = await api.invoke(channel, ...args);
  if (!r.ok) throw Object.assign(new Error(r.error), r.cancelled && { cancelled: true }, r.needs2fa && { needs2fa: true });
  return r.data;
}

function toast(msg, kind = 'ok') {
  // Человек сам нажал «Отменить» — это не ошибка, красным не пугаем
  if (msg === 'Отменено') [msg, kind] = ['Отменила ♡', 'ok'];
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  $('#toasts').append(el);
  Sounds.play(kind === 'err' ? 'error' : 'success');
  setTimeout(() => el.classList.add('out'), kind === 'err' ? 5000 : 3400);
  setTimeout(() => el.remove(), kind === 'err' ? 5400 : 3800);
}

// Индикатор связи в заголовке: точка. Состояние приходит от сетевого слоя по итогам настоящих запросов, лаунчер ради него в сеть не ходит
function paintNet(s) {
  const el = $('#netDot');
  if (!el) return;
  const st = s?.state || 'unknown';
  const hosts = (s?.bad || []).join(', ');
  el.className = 'net-dot ' + st;
  el.title =
    st === 'ok'
      ? 'Связь в порядке'
      : st === 'warn'
        ? `Не отвечают: ${hosts}. Нажми, чтобы проверить`
        : st === 'bad'
          ? `Нет связи: ${hosts}. Нажми, чтобы проверить`
          : 'Связь ещё не проверялась. Нажми, чтобы проверить';
}
api.on('net:state', paintNet);

// Ошибки самого окна уходят в лог лаунчера: после перезапуска консоль пуста, а лог остаётся. Не больше 20 за сеанс
let sentErrors = 0;
const reportError = (message, where) => {
  if (sentErrors++ < 20) api.invoke('app:logError', { message: String(message), where: String(where || '') }).catch(() => {});
};
window.addEventListener('error', (e) => reportError(e.message, `${e.filename || ''}:${e.lineno || ''}`));
window.addEventListener('unhandledrejection', (e) => reportError(e.reason?.message || e.reason, 'promise'));

const activeAccount = () => state.accounts.find((a) => a.id === state.activeAccount);
const selectedInstance = () => state.instances.find((i) => i.id === state.selected);
const ACC_TYPES = { microsoft: 'Microsoft', elyby: 'Ely.by', offline: 'Оффлайн' };
const headUrl = (acc) => `https://mc-heads.net/avatar/${acc.type === 'microsoft' ? acc.uuid : 'MHF_Steve'}/64`;
const fmtRam = (mb) => (mb >= 1024 ? `${(mb / 1024).toFixed(mb % 1024 ? 2 : 0)} ГБ` : `${mb} МБ`);
const fmtNum = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'K' : String(n));
const fmtSize = (b) => (b >= 1073741824 ? (b / 1073741824).toFixed(1) + ' ГБ' : b >= 1048576 || !b ? (b / 1048576).toFixed(1) + ' МБ' : Math.max(1, Math.round(b / 1024)) + ' КБ');
const fmtDate = (t) => new Date(t).toLocaleString(I18N.lang === 'en' ? 'en-GB' : 'ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const stagger = (el) => [...el.children].forEach((c, i) => c.style.setProperty('--i', Math.min(i, 14)));

function fmtPlaytime(ms) {
  if (!ms) return 'ещё не запускалась';
  const m = Math.round(ms / 60000);
  return m < 60 ? `${m} мин` : `${Math.floor(m / 60)} ч ${m % 60} мин`;
}

function iconHtml(i) {
  return `<div class="inst-icon" style="--c:${esc(i.color || '#ffd1e8')}">${i.iconUrl ? `<img src="${esc(i.iconUrl)}" alt="">` : esc(i.icon)}</div>`;
}

// Файл настроек при запуске не читался (сбой питания, вылет посреди записи) — сообщаем, что с ним сделали
function announceStoreNote(note) {
  const text =
    note === 'restored'
      ? 'Файл настроек оказался повреждён — вернула его прошлую копию. Посмотри, всё ли на месте ♡'
      : 'Файл настроек оказался повреждён, и копии не нашлось: настройки и аккаунты начаты заново. Испорченный файл лежит рядом (launcher.json.damaged-…)';
  toast(text, 'err');
  log(text, 'error');
}

const headCache = new Map();
async function refresh() {
  const s = await call('state:get');
  Object.assign(state, { ...s, running: new Set(s.running) });
  if (s.system.storeNote) announceStoreNote(s.system.storeNote);
  paintNet(s.system.net);
  state.power = await call('power:get').catch(() => state.power);
  // Аватарки оффлайн-аккаунтов рисуем из их собственного скина
  await Promise.all(
    state.accounts
      .filter((a) => a.skin)
      .map(async (a) => {
        if (!headCache.has(a.skin.data)) headCache.set(a.skin.data, await Skins.headDataUrl(a.skin.data).catch(() => null));
        a.head = headCache.get(a.skin.data);
      })
  );
  if (!selectedInstance()) state.selected = state.instances[0]?.id || null;
  renderAll();
  announceAchievements();
}

function renderAll() {
  applyTheme();
  renderMe();
  renderInstances();
  renderAccounts();
  renderSettings();
  renderFooter();
  renderModsInstPicker();
}
