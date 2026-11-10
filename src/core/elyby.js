// Вход через Ely.by: их сервер авторизации понимает тот же протокол (Yggdrasil), что когда-то был у Mojang.
// Пароль нигде не хранится: после входа остаётся только токен, а в игру Ely.by подключается java-агентом authlib-injector
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const store = require('./store');
const fsx = require('./fsx');
const net = require('./net');
const yggdrasil = require('./yggdrasil');

const UA = `FemboyLauncher/${require('../../package.json').version}`;
const TIMEOUT = 20000;
const META_TTL = 7 * 24 * 3600 * 1000;
let AUTH = 'https://authserver.ely.by';
let ROOT = 'https://authserver.ely.by/api/authlib-injector'; // корень API, по которому authlib-injector берёт настройки
let SKINS = 'https://skinsystem.ely.by';

// Для тестов с поддельным сервером
const configure = ({ auth, root, skins } = {}) => {
  if (auth) AUTH = auth;
  if (root) ROOT = root;
  if (skins) SKINS = skins;
};
const skinsBase = () => SKINS;

// Для разработки: поддельный сервер вместо Ely.by (FEMBOY_ELYBY_TEST_SERVER=http://127.0.0.1:порт). В собранном приложении игнорируется
try {
  const dev = process.env.FEMBOY_ELYBY_TEST_SERVER;
  if (dev && !require('electron').app?.isPackaged) configure({ auth: dev, root: `${dev}/api/authlib-injector`, skins: dev });
} catch {}

async function call(endpoint, body) {
  const cancel = net.cancelSignal();
  if (cancel?.aborted) throw new net.Cancelled();
  let res;
  try {
    res = await net.netFetch(AUTH + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': UA },
      body: JSON.stringify(body),
      signal: AbortSignal.any([AbortSignal.timeout(TIMEOUT), cancel].filter(Boolean)),
    });
  } catch (e) {
    if (cancel?.aborted) throw new net.Cancelled();
    throw Object.assign(new Error(`Нет связи с Ely.by (${e.cause?.code || e.message})`), { network: true });
  }
  const text = await res.text().catch(() => '');
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {}
  if (!res.ok) throw Object.assign(new Error(json?.errorMessage || json?.error || `HTTP ${res.status}`), { status: res.status });
  return json;
}

// Ответы сервера по-русски. withCode: человек уже вводил код двухфакторной защиты
function explain(e, withCode = false) {
  if (e.network || e.cancelled) return e;
  const m = String(e.message);
  if (e.status === 401 && /two factor/i.test(m)) return Object.assign(new Error('У аккаунта включена двухфакторная защита — введи код из приложения'), { needs2fa: true });
  if ((e.status === 401 || e.status === 403) && /invalid credentials/i.test(m)) return new Error(withCode ? 'Неверный логин, пароль или код из приложения' : 'Неверный логин или пароль');
  if (e.status === 403 && /suspend|ban|block/i.test(m)) return new Error('Аккаунт Ely.by заблокирован');
  if (e.status === 429) return new Error('Слишком много попыток входа: подожди минуту и попробуй ещё раз');
  return new Error(`Ely.by ответил: ${m}`);
}

// Вход по логину (ник или почта) и паролю. Код двухфакторной защиты сервер принимает в конце пароля через двоеточие
async function login(username, password, code) {
  username = String(username || '').trim();
  password = String(password || '');
  const otp = String(code || '').trim();
  if (!username || !password) throw new Error('Впиши логин (ник или почту) и пароль Ely.by');
  const clientToken = crypto.randomUUID().replace(/-/g, '');
  let r;
  try {
    r = await call('/auth/authenticate', { username, password: otp ? `${password}:${otp}` : password, clientToken, requestUser: true });
  } catch (e) {
    throw explain(e, !!otp);
  }
  const profile = r?.selectedProfile || r?.availableProfiles?.[0];
  if (!r?.accessToken || !profile?.id) throw new Error('На этом аккаунте Ely.by нет профиля игрока');
  return { accessToken: r.accessToken, clientToken: r.clientToken || clientToken, profile: { id: String(profile.id).replace(/-/g, '').toLowerCase(), name: profile.name } };
}

// Токен ещё годится? false — истёк или отозван; ошибка связи пробрасывается
async function validate(accessToken) {
  try {
    await call('/auth/validate', { accessToken });
    return true;
  } catch (e) {
    if (e.status === 400 || e.status === 401 || e.status === 403) return false;
    throw e;
  }
}

async function refresh(accessToken, clientToken) {
  try {
    const r = await call('/auth/refresh', { accessToken, clientToken, requestUser: false });
    if (!r?.accessToken) throw new Error('сервер не выдал новый токен');
    return { accessToken: r.accessToken, clientToken: r.clientToken || clientToken };
  } catch (e) {
    throw explain(e);
  }
}

// При выходе из аккаунта отзываем токен (не получилось — не страшно, он всё равно протухнет)
async function invalidate(accessToken, clientToken) {
  try {
    await call('/auth/invalidate', { accessToken, clientToken });
  } catch {}
}

// Настройки Ely.by для authlib-injector держим на диске: тогда игре не нужно ходить за ними при старте, и она запускается без интернета
async function metadata(log) {
  const file = path.join(store.baseDir(), 'ely-authlib-meta.json');
  const cached = fsx.readJson(file);
  if (cached.ok && Date.now() - fs.statSync(file).mtimeMs < META_TTL) return cached.data;
  try {
    const res = await net.netFetch(ROOT, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data?.meta || !data.signaturePublickey) throw new Error('неожиданный ответ сервера');
    fsx.writeJsonAtomic(file, data, false);
    return data;
  } catch (e) {
    if (cached.ok) return cached.data; // нет связи — берём прошлую копию
    log?.(`Настройки Ely.by не получены (${e.message}) — агент возьмёт их сам`);
    return null;
  }
}

// JVM-аргументы, подключающие Ely.by (скины и проверка входа на серверах Ely)
async function jvmArgs(log) {
  const jar = await yggdrasil.ensureInjector(log);
  const meta = await metadata(log);
  // Адрес API целиком (без поиска по домену) и настройки в руках — агент вообще не ходит в сеть на старте
  const args = [`-javaagent:${jar}=${meta ? ROOT : 'ely.by'}`];
  if (meta) args.push(`-Dauthlibinjector.yggdrasil.prefetched=${Buffer.from(JSON.stringify(meta)).toString('base64')}`);
  args.push('-Dauthlibinjector.side=client', '-Dauthlibinjector.noShowServerName');
  return args;
}

module.exports = { login, validate, refresh, invalidate, jvmArgs, metadata, configure, skinsBase };
