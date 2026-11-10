// Активность в Discord («Играет в Femboy Launcher»). Говорим с программой Discord на этом компьютере
// через её локальный канал — без входа и токенов, нужен только публичный Application ID из package.json
const net = require('net');
const crypto = require('crypto');
const store = require('./store');
const cfg = require('../../package.json').discord || {};

const OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 };
const LOADERS = { vanilla: 'Vanilla', fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge' };
const RETRY_MS = 15000;
const MAX_FRAME = 1024 * 1024;

let sock = null;
let ready = false;
let buf = Buffer.alloc(0);
let retryTimer = null;
let lastSent = undefined;
const sessionStart = Date.now();
const playing = new Map(); // id сборки → { inst, server, start }

const clientId = () => String(process.env.FEMBOY_DISCORD_ID || cfg.clientId || '').trim();
const enabled = () => !!clientId() && store.get().settings.discordRpc !== false;
const pipePath = (i) =>
  process.env.FEMBOY_DISCORD_PIPE // для тестов — свой канал вместо настоящего Discord
    ? `${process.env.FEMBOY_DISCORD_PIPE}-${i}`
    : process.platform === 'win32'
      ? `\\\\?\\pipe\\discord-ipc-${i}`
      : `${process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || '/tmp'}/discord-ipc-${i}`;

function write(op, data) {
  const json = Buffer.from(JSON.stringify(data));
  const head = Buffer.alloc(8);
  head.writeInt32LE(op, 0);
  head.writeInt32LE(json.length, 4);
  sock.write(Buffer.concat([head, json]));
}

function onData(chunk) {
  if (buf.length + chunk.length > MAX_FRAME + 8) { buf = Buffer.alloc(0); sock?.destroy(); return; }
  buf = Buffer.concat([buf, chunk]);
  while (buf.length >= 8) {
    const op = buf.readInt32LE(0);
    const len = buf.readInt32LE(4);
    if (len < 0 || len > MAX_FRAME) { buf = Buffer.alloc(0); sock?.destroy(); return; }
    if (buf.length < 8 + len) return;
    let msg = {};
    try {
      msg = JSON.parse(buf.subarray(8, 8 + len).toString());
    } catch {}
    buf = buf.subarray(8 + len);
    if (op === OP.PING) write(OP.PONG, msg);
    else if (op === OP.CLOSE) sock?.destroy(); // например, неверный Application ID
    else if (op === OP.FRAME && msg.evt === 'READY') {
      ready = true;
      lastSent = undefined;
      update();
    }
  }
}

// Discord держит до 10 каналов: discord-ipc-0…9 (несколько копий Discord, PTB, Canary)
function connect(i = 0) {
  if (sock || !enabled()) return;
  if (i > 9) return scheduleRetry();
  const s = net.createConnection(pipePath(i));
  let opened = false;
  s.on('error', () => {
    s.destroy();
    if (!opened) connect(i + 1); // этого канала нет — пробуем следующий; ошибки после подключения разберёт 'close'
  });
  s.once('connect', () => {
    opened = true;
    sock = s;
    buf = Buffer.alloc(0);
    s.on('data', onData);
    s.on('close', () => {
      if (sock !== s) return;
      sock = null;
      ready = false;
      scheduleRetry(); // Discord закрыли или перезапустили — подключимся, когда он вернётся
    });
    write(OP.HANDSHAKE, { v: 1, client_id: clientId() });
  });
}

function scheduleRetry() {
  if (retryTimer || !enabled()) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    connect();
  }, RETRY_MS);
  retryTimer.unref?.();
}

const clip = (s) => {
  s = String(s || '').trim();
  if (s.length > 128) s = s.slice(0, 127) + '…';
  return s.length < 2 ? s.padEnd(2, ' ') : s; // Discord не принимает строки короче 2 символов
};

function activity() {
  const s = store.get().settings;
  const en = s.lang === 'en';
  const assets = { large_image: 'logo', large_text: 'Femboy Launcher' };
  const buttons = (cfg.buttons || []).filter((b) => b?.label && /^https:\/\//.test(b.url)).slice(0, 2);
  const base = { assets, ...(buttons.length && { buttons: buttons.map((b) => ({ label: clip(b.label).slice(0, 32), url: b.url })) }) };
  // Если запущено несколько сборок — показываем последнюю
  const cur = [...playing.values()].pop();
  if (!cur) return { ...base, details: en ? 'Choosing an instance' : 'Выбирает сборку', timestamps: { start: sessionStart } };
  const { inst, server } = cur;
  const loader = LOADERS[inst.loader] || inst.loader;
  // Иконка модпака с Modrinth/CurseForge — большой картинкой, котик тогда уходит в подсказку
  if (/^https:\/\//.test(inst.iconUrl || '')) assets.large_image = inst.iconUrl;
  assets.large_text = inst.name;
  if (inst.loader && inst.loader !== 'vanilla') Object.assign(assets, { small_image: inst.loader, small_text: loader });
  else Object.assign(assets, { small_image: 'vanilla', small_text: 'Minecraft' });
  let state = `${inst.version} · ${loader}`;
  if (server) state = s.discordHideServer ? (en ? `${inst.version} · multiplayer` : `${inst.version} · по сети`) : `${inst.version} · ${server}`;
  return { ...base, details: clip(inst.name), state: clip(state), timestamps: { start: cur.start } };
}

function update() {
  if (!enabled()) {
    if (sock) {
      sock.destroy();
      sock = null;
      ready = false;
    }
    return;
  }
  if (!sock) return connect();
  if (!ready) return;
  const act = activity();
  const key = JSON.stringify(act);
  if (key === lastSent) return;
  lastSent = key;
  write(OP.FRAME, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity: act }, nonce: crypto.randomUUID() });
}

module.exports = {
  init: update,
  started(inst, server) {
    playing.delete(inst.id);
    playing.set(inst.id, { inst, server: server || null, start: Date.now() });
    update();
  },
  closed(id) {
    playing.delete(id);
    update();
  },
  // Настройки поменялись (включили/выключили, язык, скрытие сервера)
  refresh: update,
  configured: () => !!clientId(),
};
