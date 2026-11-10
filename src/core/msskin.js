// Скин и плащ лицензионного (Microsoft) аккаунта через официальный API Minecraft
const accounts = require('./accounts');
const store = require('./store');
const { netFetch } = require('./net');

const API = 'https://api.minecraftservices.com/minecraft/profile';

async function token(accountId) {
  const acc = store.get().accounts.find((a) => a.id === accountId);
  if (!acc || acc.type !== 'microsoft') throw new Error('Это не Microsoft-аккаунт');
  return (await accounts.getAuth(acc)).access_token;
}

async function call(accountId, url, opts = {}) {
  const res = await netFetch(url, { ...opts, headers: { Authorization: `Bearer ${await token(accountId)}`, ...opts.headers } });
  if (res.status === 429) throw new Error('Mojang просит подождать — слишком много смен скина подряд, попробуй через минуту');
  if (!res.ok) throw new Error(`Mojang ответил ошибкой ${res.status}`);
  return res.status === 204 ? null : res.json();
}

const view = (p) => ({
  skin: p.skins?.find((s) => s.state === 'ACTIVE') || null,
  capes: (p.capes || []).map((c) => ({ id: c.id, alias: c.alias, url: c.url, active: c.state === 'ACTIVE' })),
});

async function profile(accountId) {
  return view(await call(accountId, API));
}

async function uploadSkin(accountId, dataUrl, model) {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl));
  if (!m) throw new Error('Ожидалась PNG-картинка');
  const form = new FormData();
  form.append('variant', model === 'slim' ? 'slim' : 'classic');
  form.append('file', new Blob([Buffer.from(m[1], 'base64')], { type: 'image/png' }), 'skin.png');
  return view(await call(accountId, `${API}/skins`, { method: 'POST', body: form }));
}

async function setCape(accountId, capeId) {
  if (!capeId) return view(await call(accountId, `${API}/capes/active`, { method: 'DELETE' }));
  return view(await call(accountId, `${API}/capes/active`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ capeId }) }));
}

module.exports = { profile, uploadSkin, setCape };
