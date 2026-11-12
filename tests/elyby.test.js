const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { profile, server, makePng, blockInternet } = require('./helpers');

// Поддельный сервер Ely.by: тот же протокол (Yggdrasil), что описан в их документации
function fakeEly() {
  const PROFILE = { id: '0123456789abcdef0123456789abcdef', name: 'ElyFox' };
  const state = { valid: new Set(), expired: new Set(), n: 0, invalidated: [], skinHits: 0 };
  const err = (status, errorMessage) => ({ status, json: { error: 'ForbiddenOperationException', errorMessage } });
  const issue = (clientToken) => {
    const t = `AT-${++state.n}`;
    state.valid.add(t);
    return { accessToken: t, clientToken, availableProfiles: [PROFILE], selectedProfile: PROFILE, user: { id: 1, username: 'fox', properties: [] } };
  };
  const handler = (req, body) => {
    if (req.url === '/auth/authenticate') {
      const { username, password } = body;
      if (username === 'banned') return err(403, 'This account has been suspended.');
      if (username === 'many') return { status: 429, json: { error: 'TooManyRequests', errorMessage: 'Too many requests' } };
      if (username !== 'fox@example.com') return err(401, 'Invalid credentials. Invalid email or password.');
      const [pass, code] = String(password).split(':');
      if (pass !== 'secret') return err(401, 'Invalid credentials. Invalid email or password.');
      if (state.twofactor) {
        if (code === undefined) return err(401, 'Account protected with two factor auth.');
        if (code !== '123456') return err(401, 'Invalid credentials. Invalid email or password.');
      }
      return { json: issue(body.clientToken) };
    }
    if (req.url === '/auth/validate') {
      if (state.valid.has(body.accessToken)) return { status: 200, body: '' };
      return err(403, 'Token expired.');
    }
    if (req.url === '/auth/refresh') {
      const known = state.valid.has(body.accessToken) || state.expired.has(body.accessToken);
      if (!known || state.revoked) return err(401, 'Invalid token.');
      state.valid.delete(body.accessToken);
      state.expired.delete(body.accessToken);
      return { json: issue(body.clientToken) };
    }
    if (req.url === '/auth/invalidate') {
      state.invalidated.push(body.accessToken);
      state.valid.delete(body.accessToken);
      return { status: 200, body: '' };
    }
    if (req.url === '/api/authlib-injector') return { json: { meta: { serverName: 'Ely.by' }, skinDomains: ['ely.by', '.ely.by'], signaturePublickey: '-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----\n' } };
    return { status: 404 };
  };
  return { state, handler, PROFILE };
}

async function setup(t) {
  const fake = fakeEly();
  const srv = await server(fake.handler);
  const unblock = blockInternet(); // skinsystem.ely.by и прочее настоящее в тестах недоступно
  const p = profile();
  const ely = p.load('core/elyby');
  ely.configure({ auth: srv.url, root: `${srv.url}/api/authlib-injector` });
  t.after(async () => {
    unblock();
    await srv.close().catch(() => {});
    p.done();
  });
  return { fake, srv, p, ely, accounts: p.load('core/accounts'), net: p.load('core/net') };
}

test('вход: профиль и токен; пароль уходит на сервер как есть, а запрос просит данные пользователя', async (t) => {
  const { srv, ely } = await setup(t);
  const r = await ely.login('fox@example.com', 'secret');
  assert.equal(r.profile.name, 'ElyFox');
  assert.equal(r.profile.id, '0123456789abcdef0123456789abcdef');
  assert.match(r.accessToken, /^AT-/);
  const sent = srv.hits[0];
  assert.equal(sent.method, 'POST');
  assert.equal(sent.body.password, 'secret');
  assert.equal(sent.body.requestUser, true);
  assert.ok(sent.body.clientToken.length >= 16);
  assert.match(sent.headers['user-agent'], /^FemboyLauncher\//);
});

test('понятные русские ошибки: пароль, блокировка, слишком много попыток, пустые поля', async (t) => {
  const { ely } = await setup(t);
  await assert.rejects(ely.login('fox@example.com', 'wrong'), /Неверный логин или пароль/);
  await assert.rejects(ely.login('nobody', 'x'), /Неверный логин или пароль/);
  await assert.rejects(ely.login('banned', 'x'), /заблокирован/);
  await assert.rejects(ely.login('many', 'x'), /Слишком много попыток/);
  await assert.rejects(ely.login('', ''), /Впиши логин/);
});

test('двухфакторная защита: сначала просит код, потом код уходит в конце пароля через двоеточие', async (t) => {
  const { fake, srv, ely } = await setup(t);
  fake.state.twofactor = true;
  const e = await ely.login('fox@example.com', 'secret').catch((x) => x);
  assert.equal(e.needs2fa, true);
  assert.match(e.message, /двухфакторная/);
  await assert.rejects(ely.login('fox@example.com', 'secret', '000000'), /Неверный логин, пароль или код/);
  const ok = await ely.login('fox@example.com', 'secret', ' 123456 ');
  assert.equal(ok.profile.name, 'ElyFox');
  assert.equal(srv.hits.at(-1).body.password, 'secret:123456');
});

test('токен: проверка, обновление, отзыв', async (t) => {
  const { fake, ely } = await setup(t);
  const a = await ely.login('fox@example.com', 'secret');
  assert.equal(await ely.validate(a.accessToken), true);
  fake.state.valid.delete(a.accessToken);
  fake.state.expired.add(a.accessToken);
  assert.equal(await ely.validate(a.accessToken), false, 'истёкший токен: не годится, но это не ошибка связи');
  const b = await ely.refresh(a.accessToken, a.clientToken);
  assert.notEqual(b.accessToken, a.accessToken);
  assert.equal(await ely.validate(b.accessToken), true);
  await ely.invalidate(b.accessToken, a.clientToken);
  assert.deepEqual(fake.state.invalidated, [b.accessToken]);
  await assert.rejects(ely.refresh('AT-unknown', 'x'), /Ely\.by ответил/);
});

test('нет связи: ошибка помечена, узнаётся как «нет связи» и не выглядит как неверный пароль', async (t) => {
  const { srv, ely, net } = await setup(t);
  await srv.close();
  const e = await ely.login('fox@example.com', 'secret').catch((x) => x);
  assert.equal(e.network, true);
  assert.match(e.message, /^Нет связи с Ely\.by/);
  assert.equal(net.isNetworkError(e), true);
  await assert.rejects(ely.validate('AT-1'), /Нет связи/);
});

test('аккаунт: пароль не сохраняется, наружу токен не отдаётся, вход перед игрой обновляет истёкший токен', async (t) => {
  const { fake, p, accounts } = await setup(t);
  const view = await accounts.addElyby({ username: 'fox@example.com', password: 'secret' });
  assert.deepEqual(Object.keys(view).sort(), ['id', 'name', 'skin', 'type', 'uuid']);
  assert.equal(view.type, 'elyby');
  assert.equal(view.id, 'ely-0123456789abcdef0123456789abcdef');
  const saved = JSON.stringify(p.store.get().accounts);
  assert.ok(!saved.includes('secret'), 'пароля в файле нет');
  assert.ok(JSON.stringify(accounts.list()).indexOf('AT-') === -1, 'токена в списке для интерфейса нет');

  const acc = accounts.getActive();
  assert.equal(acc.type, 'elyby');
  const first = await accounts.getAuth(acc);
  assert.equal(first.name, 'ElyFox');
  assert.equal(first.uuid, '0123456789abcdef0123456789abcdef');
  assert.match(first.access_token, /^AT-/);
  assert.equal(first.meta.type, 'mojang');

  // токен истёк: лаунчер сам обновляет его и запоминает новый
  fake.state.valid.delete(first.access_token);
  fake.state.expired.add(first.access_token);
  const second = await accounts.getAuth(acc);
  assert.notEqual(second.access_token, first.access_token);
  assert.equal(acc.token, second.access_token, 'новый токен сохранён в аккаунте');

  // сессию отозвали совсем: честная ошибка, а не тихий оффлайн
  fake.state.valid.delete(second.access_token);
  fake.state.revoked = true;
  await assert.rejects(accounts.getAuth(acc, { fallback: true }), /Сессия Ely\.by устарела/);
});

test('без интернета: игра запускается без входа (с настоящим ником и UUID), а при строгой проверке — понятная ошибка', async (t) => {
  const { srv, accounts } = await setup(t);
  await accounts.addElyby({ username: 'fox@example.com', password: 'secret' });
  const acc = accounts.getActive();
  await srv.close();
  let notified = 0;
  const auth = await accounts.getAuth(acc, { fallback: true, onOffline: () => notified++ });
  assert.equal(notified, 1);
  assert.equal(auth.name, 'ElyFox');
  assert.equal(auth.uuid, '0123456789abcdef0123456789abcdef');
  assert.notEqual(auth.access_token, acc.token, 'токен Ely.by в игру без проверки не уходит');
  await assert.rejects(accounts.getAuth(acc), /^Error: Нет связи с Ely\.by/);
});

test('выход из аккаунта отзывает токен на сервере и убирает аватарку', async (t) => {
  const { fake, p, accounts } = await setup(t);
  await accounts.addElyby({ username: 'fox@example.com', password: 'secret' });
  const acc = accounts.getActive();
  const token = acc.token;
  accounts.remove(acc.id);
  await new Promise((r) => setTimeout(r, 200)); // отзыв уходит, не дожидаясь ответа
  assert.deepEqual(fake.state.invalidated, [token]);
  assert.equal(p.store.get().accounts.length, 0);
  assert.equal(p.store.get().activeAccount, null);
});

test('аватарка из скина Ely.by сохраняется, а если скина нет — остаётся стандартная', async (t) => {
  const fake = fakeEly();
  const srv = await server(fake.handler);
  const skinPng = makePng(64, 64);
  const realFetch = globalThis.fetch;
  let hasSkin = true;
  // skinsystem.ely.by подменяем, свой поддельный сервер пропускаем как есть
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (/skinsystem\.ely\.by\/textures\//.test(u)) return hasSkin ? new Response(JSON.stringify({ SKIN: { url: 'https://ely.by/storage/skins/x.png', metadata: { model: 'slim' } } }), { status: 200 }) : new Response('{}', { status: 404 });
    if (/ely\.by\/storage\/skins\/x\.png/.test(u)) return new Response(skinPng, { status: 200 });
    return realFetch(url, opts);
  };
  const p = profile();
  t.after(async () => {
    globalThis.fetch = realFetch;
    await srv.close();
    p.done();
  });
  p.load('core/elyby').configure({ auth: srv.url, root: `${srv.url}/api/authlib-injector` });
  const accounts = p.load('core/accounts');
  const view = await accounts.addElyby({ username: 'fox@example.com', password: 'secret' });
  assert.ok(view.skin?.data.startsWith('data:image/png;base64,'), 'скин подтянут для аватарки');
  assert.equal(view.skin.model, 'slim');
  assert.ok(fs.existsSync(path.join(p.dir, 'skins', `${view.id}.png`)));
  hasSkin = false;
  const after = await accounts.refreshElySkin(view.id);
  assert.equal(after.skin, null, 'скин убрали на сайте — в лаунчере снова стандартный');
  assert.equal(fs.existsSync(path.join(p.dir, 'skins', `${view.id}.png`)), false);
  await assert.rejects(accounts.refreshElySkin('off-bun'), /Это не аккаунт Ely\.by/);
});

test('JVM-аргументы: агент с адресом API и настройками внутри; настройки лежат на диске и переживают отсутствие связи', async (t) => {
  const { srv, p, ely } = await setup(t);
  fs.writeFileSync(path.join(p.dir, 'authlib-injector.jar'), 'fake jar'); // скачивать агент в тесте незачем
  // This test checks JVM arguments, not injector trust; do not make production
  // verification accept a fake cache just to avoid a network download here.
  p.load('core/yggdrasil').ensureInjector = async () => path.join(p.dir, 'authlib-injector.jar');
  const args = await ely.jvmArgs();
  const jar = path.join(p.dir, 'authlib-injector.jar');
  assert.equal(args[0], `-javaagent:${jar}=${srv.url}/api/authlib-injector`);
  const prefetched = args.find((a) => a.startsWith('-Dauthlibinjector.yggdrasil.prefetched='));
  assert.equal(JSON.parse(Buffer.from(prefetched.split('=')[1], 'base64').toString()).meta.serverName, 'Ely.by');
  assert.ok(args.includes('-Dauthlibinjector.side=client'));
  const hitsBefore = srv.hits.length;
  await ely.jvmArgs();
  assert.equal(srv.hits.length, hitsBefore, 'свежая копия настроек на диске: за ними в сеть не ходим');

  // связи нет совсем, а копия есть: агент всё равно получает настройки
  await srv.close();
  const old = new Date(Date.now() - 30 * 24 * 3600e3);
  fs.utimesSync(path.join(p.dir, 'ely-authlib-meta.json'), old, old);
  const offline = await ely.jvmArgs();
  assert.ok(offline.some((a) => a.startsWith('-Dauthlibinjector.yggdrasil.prefetched=')), 'устаревшая копия лучше, чем ничего');
  // и копии нет, и связи нет: остаётся короткая форма адреса, агент найдёт настройки сам
  fs.rmSync(path.join(p.dir, 'ely-authlib-meta.json'));
  const bare = await ely.jvmArgs();
  assert.equal(bare[0], `-javaagent:${jar}=ely.by`);
  assert.ok(!bare.some((a) => a.includes('prefetched')));
});
