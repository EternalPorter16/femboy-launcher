// Локальный «сервер скинов» для оффлайн-аккаунтов. Игра получает скин через authlib-injector
// (java-агент), который перенаправляет запросы к сессионным серверам Mojang сюда — так же делает HMCL.
// Сервер слушает только 127.0.0.1 и отдаёт лишь профили и скины оффлайн-аккаунтов этого лаунчера.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('./store');
const { getJson, download } = require('./net');

const INJECTOR_META = [
  'https://authlib-injector.yushi.moe/artifact/latest.json',
  'https://bmclapi2.bangbang93.com/mirrors/authlib-injector/artifact/latest.json',
];

let server = null;
let baseUrl = null;
let keys = null;
let requestLog = () => {};

function loadKeys() {
  if (keys) return keys;
  const file = path.join(store.baseDir(), 'skin-server-key.pem');
  let privateKey;
  try {
    privateKey = crypto.createPrivateKey(fs.readFileSync(file, 'utf8'));
  } catch {
    privateKey = crypto.generateKeyPairSync('rsa', { modulusLength: 4096 }).privateKey;
    fs.writeFileSync(file, privateKey.export({ type: 'pkcs8', format: 'pem' }));
  }
  const publicKey = crypto.createPublicKey(privateKey);
  keys = {
    privateKey,
    publicPem: publicKey.export({ type: 'spki', format: 'pem' }),
    publicDer: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
  };
  return keys;
}

const undash = (u) => String(u).replace(/-/g, '').toLowerCase();

function offlineAccounts() {
  return store.get().accounts.filter((a) => a.type === 'offline');
}

function skinFile(acc) {
  return acc.skin ? path.join(store.paths().skins, acc.skin.file) : null;
}

function profileOf(acc, signed) {
  const textures = {};
  if (acc.skin && fs.existsSync(skinFile(acc))) {
    textures.SKIN = { url: `${baseUrl}/textures/${acc.skin.hash}` };
    if (acc.skin.model === 'slim') textures.SKIN.metadata = { model: 'slim' };
  }
  const value = Buffer.from(
    JSON.stringify({ timestamp: Date.now(), profileId: undash(acc.uuid), profileName: acc.name, textures })
  ).toString('base64');
  const prop = { name: 'textures', value };
  if (signed) prop.signature = crypto.sign('sha1', Buffer.from(value), loadKeys().privateKey).toString('base64');
  return { id: undash(acc.uuid), name: acc.name, properties: [prop] };
}

function metadata() {
  return {
    meta: {
      serverName: 'Femboy Launcher',
      implementationName: 'femboy-launcher-skins',
      implementationVersion: '1',
      'feature.non_email_login': true,
    },
    skinDomains: ['127.0.0.1', 'localhost'],
    signaturePublickey: loadKeys().publicPem,
  };
}

function send(res, status, body, type = 'application/json') {
  if (body === undefined) {
    res.writeHead(status).end();
    return;
  }
  const data = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
  res.writeHead(status, { 'Content-Type': type, 'Content-Length': data.length }).end(data);
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => (raw += c.length + raw.length < 65536 ? c : ''));
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw || 'null'));
      } catch {
        resolve(null);
      }
    });
  });
}

async function handle(req, res) {
  const url = new URL(req.url, baseUrl);
  const p = url.pathname.replace(/\/+$/, '') || '/';
  let m;
  if (p !== '/') requestLog(`Сервер скинов: ${req.method} ${p}`);

  if (p === '/') return send(res, 200, metadata());

  if ((m = /^\/sessionserver\/session\/minecraft\/profile\/([0-9a-f-]{32,36})$/i.exec(p))) {
    const acc = offlineAccounts().find((a) => undash(a.uuid) === undash(m[1]));
    return acc ? send(res, 200, profileOf(acc, url.searchParams.get('unsigned') === 'false')) : send(res, 204);
  }

  if ((m = /^\/textures\/([0-9a-f]{64})$/.exec(p))) {
    const acc = offlineAccounts().find((a) => a.skin?.hash === m[1]);
    const file = acc && skinFile(acc);
    return file && fs.existsSync(file) ? send(res, 200, fs.readFileSync(file), 'image/png') : send(res, 404, { error: 'Not Found' });
  }

  if (p === '/api/profiles/minecraft' && req.method === 'POST') {
    const names = ((await readBody(req)) || []).map((n) => String(n).toLowerCase());
    return send(res, 200, offlineAccounts().filter((a) => names.includes(a.name.toLowerCase())).map((a) => ({ id: undash(a.uuid), name: a.name })));
  }

  if ((m = /^\/api\/users\/profiles\/minecraft\/(\w{1,16})$/.exec(p))) {
    const acc = offlineAccounts().find((a) => a.name.toLowerCase() === m[1].toLowerCase());
    return acc ? send(res, 200, { id: undash(acc.uuid), name: acc.name }) : send(res, 204);
  }

  // Заглушки сервисов Mojang, которые игра дёргает при старте (чат, блок-лист, ключи)
  if (p === '/sessionserver/session/minecraft/join') return send(res, 204);
  if (p === '/minecraftservices/player/attributes') {
    return send(res, 200, {
      privileges: { onlineChat: { enabled: true }, multiplayerServer: { enabled: true }, multiplayerRealms: { enabled: false }, telemetry: { enabled: false } },
      profanityFilterPreferences: { profanityFilterOn: false },
    });
  }
  if (p === '/minecraftservices/privacy/blocklist') return send(res, 200, { blockedProfiles: [] });
  if (p === '/minecraftservices/publickeys') {
    const key = { publicKey: loadKeys().publicDer };
    return send(res, 200, { profilePropertyKeys: [key], playerCertificateKeys: [key] });
  }
  send(res, 404, { error: 'Not Found', errorMessage: 'Not supported by Femboy Launcher' });
}

async function start() {
  if (server) return baseUrl;
  loadKeys();
  server = http.createServer((req, res) => handle(req, res).catch(() => send(res, 500, { error: 'Internal' })));
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  return baseUrl;
}

async function ensureInjector(log = () => {}) {
  const jar = path.join(store.baseDir(), 'authlib-injector.jar');
  if (fs.existsSync(jar)) return jar;
  let lastError;
  for (const metaUrl of INJECTOR_META) {
    try {
      const meta = await getJson(metaUrl);
      await download(meta.download_url, jar + '.part');
      const sha = crypto.createHash('sha256').update(fs.readFileSync(jar + '.part')).digest('hex');
      if (meta.checksums?.sha256 && sha !== meta.checksums.sha256) throw new Error('не совпал хэш');
      fs.renameSync(jar + '.part', jar);
      log(`authlib-injector ${meta.version} скачан`);
      return jar;
    } catch (e) {
      lastError = e;
      fs.rmSync(jar + '.part', { force: true });
    }
  }
  throw new Error('Не удалось скачать authlib-injector для скинов: ' + lastError?.message);
}

// JVM-аргументы, подключающие скины оффлайн-аккаунта
async function jvmArgs(log, debug) {
  const [jar, url] = await Promise.all([ensureInjector(log), start()]);
  if (debug) requestLog = debug;
  const prefetched = Buffer.from(JSON.stringify(metadata())).toString('base64');
  return [
    `-javaagent:${jar}=${url}`,
    `-Dauthlibinjector.yggdrasil.prefetched=${prefetched}`,
    '-Dauthlibinjector.side=client',
    '-Dauthlibinjector.noShowServerName',
  ];
}

module.exports = { jvmArgs, start, ensureInjector };
