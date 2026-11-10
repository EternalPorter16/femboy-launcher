// Аккаунты: Microsoft (через msmc), Ely.by и оффлайн
const crypto = require('crypto');
const store = require('./store');
const skins = require('./skins');
const net = require('./net');
const elyby = require('./elyby');

// Вне Электрона (тесты в обычном Node) шифрования средствами ОС нет — тогда токены лежат как есть
let safeStorage = null;
try {
  ({ safeStorage } = require('electron'));
} catch {}

const NAME_RE = /^[A-Za-z0-9_]{3,16}$/;
const MS_TIMEOUT = 25000;

// msmc ходит в сеть через node-fetch, а тот про системный прокси и сертификаты Windows ничего не знает: у кого интернет
// идёт через прокси или VPN, вход через Microsoft просто не доставал до серверов. Подставляем ему fetch лаунчера
// (стек Chromium). Делать надо до первой загрузки msmc, и грузить его через require: ESM-сборка (import) берёт
// node-fetch в обход кэша модулей, и подмена до неё не доходит
let routed = false;
function routeThroughChromium() {
  if (routed) return;
  routed = true;
  try {
    const real = require('node-fetch');
    const patched = Object.assign((url, opts) => net.netFetch(url, opts), real);
    patched.default = patched;
    require.cache[require.resolve('node-fetch')].exports = patched;
  } catch {}
}

async function msmc() {
  routeThroughChromium();
  const mod = require('msmc');
  return mod.Auth ? mod : mod.default;
}

// У Microsoft бывает, что запрос принят и молчит — не ждём дольше, чем нужно; «Отменить» прерывает ожидание сразу
function withTimeout(promise, ms) {
  let timer;
  let stop;
  const cancel = net.cancelSignal();
  if (cancel?.aborted) return Promise.reject(new net.Cancelled());
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Нет связи с Microsoft (timeout)')), ms);
    stop = () => reject(new net.Cancelled());
    cancel?.addEventListener('abort', stop, { once: true });
  });
  return Promise.race([promise, guard]).finally(() => {
    clearTimeout(timer);
    cancel?.removeEventListener('abort', stop);
  });
}

// Токены храним зашифрованными средствами ОС, если это доступно
const enc = (s) => (safeStorage?.isEncryptionAvailable?.() ? 'enc:' + safeStorage.encryptString(s).toString('base64') : s);
const dec = (s) => (s && s.startsWith('enc:') ? safeStorage.decryptString(Buffer.from(s.slice(4), 'base64')) : s);

// Тот же UUID, что выдаёт оффлайн-сервер: UUID.nameUUIDFromBytes("OfflinePlayer:" + name)
function offlineUUID(name) {
  const md5 = crypto.createHash('md5').update('OfflinePlayer:' + name).digest();
  md5[6] = (md5[6] & 0x0f) | 0x30;
  md5[8] = (md5[8] & 0x3f) | 0x80;
  const h = md5.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function publicView(a) {
  // У оффлайн-аккаунта скин свой, у Ely.by он лишь для аватарки в лаунчере (в игре его отдаёт сервер Ely.by)
  return { id: a.id, type: a.type, name: a.name, uuid: a.uuid, skin: a.type === 'offline' || a.type === 'elyby' ? skins.read(a) : null };
}

function list() {
  return store.get().accounts.map(publicView);
}

function upsert(acc) {
  const data = store.get();
  const i = data.accounts.findIndex((a) => a.id === acc.id);
  if (i >= 0) data.accounts[i] = acc;
  else data.accounts.push(acc);
  data.activeAccount = acc.id;
  store.save();
  return publicView(acc);
}

function addOffline(name) {
  name = String(name || '').trim();
  if (!NAME_RE.test(name)) throw new Error('Ник: 3–16 символов, только латиница, цифры и _');
  const id = 'off-' + name.toLowerCase();
  const prev = store.get().accounts.find((a) => a.id === id);
  return upsert({ id, type: 'offline', name, uuid: offlineUUID(name), ...(prev?.skin && { skin: prev.skin }) });
}

function explainMsError(e) {
  const msg = String(e && (e.message || e.ts || e) || '');
  if (msg.includes('gui.closed')) return 'Окно входа закрыто';
  if (msg.includes('entitlements') || msg.includes('profile')) return 'На этом аккаунте нет купленного Minecraft Java Edition';
  if (msg.includes('xsts')) return 'Проблема с Xbox-профилем (нужен Xbox-аккаунт / возрастные ограничения)';
  return 'Не удалось войти через Microsoft: ' + msg;
}

async function addMicrosoft() {
  const { Auth } = await msmc();
  try {
    const auth = new Auth('select_account');
    const xbox = await auth.launch('electron', { width: 520, height: 700, title: 'Вход в Microsoft ♡' });
    const mc = await xbox.getMinecraft();
    return upsert({
      id: 'ms-' + mc.profile.id,
      type: 'microsoft',
      name: mc.profile.name,
      uuid: mc.profile.id,
      refresh: enc(xbox.save()),
    });
  } catch (e) {
    throw new Error(explainMsError(e));
  }
}

// Вход по логину и паролю Ely.by. Пароль уходит только на их сервер, у нас остаётся токен
async function addElyby({ username, password, code } = {}) {
  const r = await elyby.login(username, password, code);
  const acc = { id: 'ely-' + r.profile.id, type: 'elyby', name: r.profile.name, uuid: r.profile.id, token: enc(r.accessToken), clientToken: r.clientToken };
  const prev = store.get().accounts.find((a) => a.id === acc.id);
  if (prev?.skin) acc.skin = prev.skin; // тот же аккаунт входит заново — аватарка уже есть
  upsert(acc);
  await refreshElySkin(acc.id).catch(() => {}); // аватарка не обязательна: нет связи со skinsystem — вход всё равно удался
  return publicView(acc);
}

// Подтягивает скин аккаунта Ely.by для аватарки (сменил скин на сайте — нажми «Обновить скин»)
async function refreshElySkin(id) {
  const acc = store.get().accounts.find((a) => a.id === id);
  if (!acc || acc.type !== 'elyby') throw new Error('Это не аккаунт Ely.by');
  try {
    const s = await skins.fromEly(acc.name);
    skins.put(acc, s.data, s.model);
  } catch (e) {
    if (e.cancelled || net.isNetworkError(e)) throw e; // нет связи — прежняя аватарка остаётся
    skins.drop(acc); // скина на Ely.by нет — значит, стандартный
    store.save();
  }
  return publicView(acc);
}

function remove(id) {
  const data = store.get();
  const acc = data.accounts.find((a) => a.id === id);
  if (acc) {
    skins.drop(acc);
    if (acc.type === 'elyby') {
      try {
        elyby.invalidate(dec(acc.token), acc.clientToken); // токен отзываем на сервере, не дожидаясь ответа
      } catch {}
    }
  }
  data.accounts = data.accounts.filter((a) => a.id !== id);
  if (data.activeAccount === id) data.activeAccount = data.accounts[0]?.id || null;
  store.save();
}

function select(id) {
  const data = store.get();
  if (!data.accounts.some((a) => a.id === id)) throw new Error('Аккаунт не найден');
  data.activeAccount = id;
  store.save();
}

function getActive() {
  const data = store.get();
  return data.accounts.find((a) => a.id === data.activeAccount) || null;
}

// Вход без проверки: настоящие ник и UUID аккаунта (чтобы миры и вещи были на месте), но токена Microsoft нет
function offlineAuth(acc) {
  const token = crypto.randomUUID().replace(/-/g, '');
  return {
    access_token: token,
    client_token: token,
    uuid: acc.uuid.replace(/-/g, ''),
    name: acc.name,
    user_properties: '{}',
    meta: { type: 'mojang', demo: false },
  };
}

// Объект авторизации в формате minecraft-launcher-core.
// fallback: до Microsoft не достучаться (нет интернета) — вместо ошибки играем без входа: одиночная игра работает,
// на серверы с лицензией зайти нельзя. onOffline() сообщает об этом. Настоящий отказ Microsoft (токен отозван,
// нет покупки) остаётся ошибкой — его не спрячешь
async function getAuth(acc, { fallback = false, onOffline } = {}) {
  if (acc.type === 'offline') return offlineAuth(acc);
  if (acc.type === 'elyby') return elyAuth(acc, { fallback, onOffline });
  const { Auth } = await msmc();
  try {
    const xbox = await withTimeout(new Auth('select_account').refresh(dec(acc.refresh)), MS_TIMEOUT);
    const mc = await withTimeout(xbox.getMinecraft(), MS_TIMEOUT);
    acc.refresh = enc(xbox.save());
    acc.name = mc.profile.name;
    store.save();
    return mc.mclc();
  } catch (e) {
    if (e.cancelled) throw e;
    if (net.isNetworkError(e)) {
      if (fallback) {
        onOffline?.();
        return offlineAuth(acc);
      }
      throw new Error('Нет связи с Microsoft — проверь интернет или прокси (Настройки → «Проверить связь»)');
    }
    throw new Error('Сессия Microsoft устарела — удали аккаунт и войди заново. (' + explainMsError(e) + ')');
  }
}

// Ely.by: токен живёт долго; проверяем перед игрой и обновляем, если истёк. Нет связи — как и с Microsoft, играем без входа
async function elyAuth(acc, { fallback, onOffline }) {
  let token;
  try {
    token = dec(acc.token);
  } catch {
    throw new Error('Не получилось прочитать сохранённый вход Ely.by — войди заново');
  }
  try {
    if (!(await elyby.validate(token))) {
      const r = await elyby.refresh(token, acc.clientToken);
      token = r.accessToken;
      acc.token = enc(token);
      store.save();
    }
  } catch (e) {
    if (e.cancelled) throw e;
    if (e.network || net.isNetworkError(e)) {
      if (fallback) {
        onOffline?.();
        return offlineAuth(acc);
      }
      throw new Error('Нет связи с Ely.by — проверь интернет или прокси (Настройки → «Проверить связь»)');
    }
    throw new Error('Сессия Ely.by устарела — удали аккаунт и войди заново');
  }
  return { access_token: token, client_token: acc.clientToken, uuid: acc.uuid, name: acc.name, user_properties: '{}', meta: { type: 'mojang', demo: false } };
}

module.exports = { list, addOffline, addMicrosoft, addElyby, refreshElySkin, remove, select, getActive, getAuth, offlineUUID };
