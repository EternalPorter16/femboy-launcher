// Список друзей для игры по сети. Он общий для всех сборок и лежит в настройках лаунчера (launcher.json). У друга: ник, «без лицензии»
// (офлайн-аккаунт) и UUID настоящего аккаунта (его один раз спрашивают у Mojang), а отметка on значит «пустить в этот мир»: в белый
// список лаунчер пишет только отмеченных. Сам список (кто мои друзья) остаётся, а доступ в мир даётся каждый раз заново
const store = require('./store');
const friendlist = require('./friendlist');

const MAX = 50;
const NAME_RE = friendlist.NAME_RE;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

// Годные записи из того, что лежит в настройках: файл могли править руками, а старые версии лаунчера списка не знали
function normalize(raw) {
  const out = [];
  for (const e of Array.isArray(raw) ? raw : []) {
    const nick = typeof e?.nick === 'string' ? e.nick.trim() : '';
    if (!NAME_RE.test(nick) || out.some((f) => same(f.nick, nick))) continue;
    const offline = !!e.offline;
    out.push({ nick, offline, uuid: !offline && typeof e.uuid === 'string' && UUID_RE.test(e.uuid) ? e.uuid.toLowerCase() : null, on: !!e.on });
  }
  return out.slice(0, MAX);
}
const load = () => normalize(store.get().friends);
function save(list) {
  store.get().friends = normalize(list); // в launcher.json попадают только годные записи, не больше предела
  store.save();
  return load(); // копия: хранимый список снаружи не изменить
}

// Список: каждый раз новые объекты, поэтому изменить его снаружи, минуя этот модуль, нельзя
const list = () => load();

// Отмеченные друзья в том виде, в каком их пишет белый список (friendlist.sync)
const selected = () => load().filter((f) => f.on).map(({ nick, offline, uuid }) => ({ nick, offline, uuid }));

// Спрашивает у Mojang UUID друга с лицензией. Возвращает: '' — узнали; 'no-license' — такого аккаунта нет (друг становится «без лицензии»,
// иначе в мир с проверкой лицензии он не зайдёт и мы бы об этом не сказали); 'unchecked' — нет связи, лицензия не проверена
async function resolve(friend, getJson) {
  try {
    const p = await friendlist.premiumProfile(friend.nick, getJson);
    if (p) {
      friend.offline = false;
      friend.uuid = p.uuid;
      return '';
    }
    friend.offline = true;
    friend.uuid = null;
    return 'no-license';
  } catch {
    friend.uuid = null;
    return 'unchecked';
  }
}

// Новый друг: отмечен сразу. note — что сказать человеку: '' / 'no-license' / 'unchecked' (см. resolve)
async function add({ nick, offline = false } = {}, { getJson } = {}) {
  const n = String(nick ?? '').trim();
  if (!NAME_RE.test(n)) throw new Error(`Ник «${n}»: 3–16 символов, латиница, цифры и _`);
  const check = (all) => {
    if (all.some((f) => same(f.nick, n))) throw new Error(`«${n}» уже есть в списке друзей`);
    if (all.length >= MAX) throw new Error(`В списке друзей не больше ${MAX}`);
  };
  check(load()); // повтор и предел видны до запроса в Mojang
  const friend = { nick: n, offline: !!offline, uuid: null, on: true };
  const note = friend.offline ? '' : await resolve(friend, getJson);
  const all = load();
  check(all); // за время запроса список могли изменить
  return { friends: save([...all, friend]), note };
}

// patch: { on } — отметка «пустить в этот мир»; { offline } — «без лицензии» (включили: UUID забывается; выключили: лицензия проверяется заново)
async function update(nick, patch = {}, { getJson } = {}) {
  const find = (all) => all.find((f) => same(f.nick, nick ?? ''));
  const before = find(load());
  if (!before) throw new Error('Такого друга нет в списке');
  let probe = null;
  let note = '';
  if (patch.offline === false && before.offline) {
    probe = { nick: before.nick, offline: false, uuid: null };
    note = await resolve(probe, getJson);
  }
  const all = load();
  const f = find(all);
  if (!f) throw new Error('Такого друга нет в списке'); // убрали, пока шла проверка
  if (typeof patch.on === 'boolean') f.on = patch.on;
  if (patch.offline === true) {
    f.offline = true;
    f.uuid = null;
  } else if (probe) {
    f.offline = probe.offline;
    f.uuid = probe.uuid;
  }
  return { friends: save(all), note };
}

function remove(nick) {
  return { friends: save(load().filter((f) => !same(f.nick, nick ?? ''))) };
}

// Перед записью белого списка: у отмеченных друзей с лицензией, чей UUID ещё не известен, спрашиваем его у Mojang. Что не удалось —
// в notes ({ nick, note }); друг, которого у Mojang нет, становится «без лицензии»
async function resolveMissing({ getJson } = {}) {
  const todo = load().filter((f) => f.on && !f.offline && !f.uuid);
  const results = await Promise.all(
    todo.map(async (f) => {
      const probe = { nick: f.nick, offline: false, uuid: null };
      return { probe, note: await resolve(probe, getJson) };
    })
  );
  const all = load();
  const notes = [];
  for (const { probe, note } of results) {
    const f = all.find((x) => same(x.nick, probe.nick));
    if (!f) continue;
    if (!note) f.uuid = probe.uuid;
    else {
      if (note === 'no-license') Object.assign(f, { offline: true, uuid: null });
      notes.push({ nick: f.nick, note });
    }
  }
  return { friends: save(all), notes };
}

// Перенос ников, которые раньше лежали у каждой сборки отдельно (окно «Играть с другом» помнило их в самом интерфейсе).
// entries: [{ nick, offline, on }]. Уже записанных не трогает и отметок не снимает
function importLegacy(entries) {
  const all = load();
  for (const e of Array.isArray(entries) ? entries : []) {
    const nick = typeof e?.nick === 'string' ? e.nick.trim() : '';
    if (!NAME_RE.test(nick)) continue;
    const have = all.find((f) => same(f.nick, nick));
    if (have) {
      if (e.on) have.on = true;
      continue;
    }
    if (all.length < MAX) all.push({ nick, offline: !!e.offline, uuid: null, on: !!e.on });
  }
  return { friends: save(all) };
}

// Запросы идут строго по очереди: два одновременных не должны затереть изменения друг друга
let chain = Promise.resolve();
const serial = (fn) => (...args) => (chain = chain.catch(() => {}).then(() => fn(...args)));

module.exports = { list, selected, remove, importLegacy, add: serial(add), update: serial(update), resolveMissing: serial(resolveMissing), MAX };
