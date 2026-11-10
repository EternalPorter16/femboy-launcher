const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { profile } = require('./helpers');

function setup(t) {
  const p = profile();
  t.after(() => p.done());
  const dir = path.join(p.dir, 'сборка', '.minecraft');
  fs.mkdirSync(dir, { recursive: true });
  return { dir, file: path.join(dir, 'whitelist.json'), friendlist: p.load('core/friendlist'), accounts: p.load('core/accounts') };
}
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const write = (f, data) => fs.writeFileSync(f, typeof data === 'string' ? data : JSON.stringify(data, null, 2));

// Записи из настоящего whitelist.json после «/whitelist add Bart_Awesome» и «/whitelist add PinkDick»: игра записала друга строчными
const HOST = { uuid: '37f80e23-59b7-4e9f-b250-ade4921e5f03', name: 'Bart_Awesome' };
const LOWER = { uuid: 'e37533fc-6ee0-3e8d-a3b3-13dc5bc4fe40', name: 'pinkdick' };
// А так друг заходит в игру: его ник пишется с заглавными
const EXACT = { uuid: '27aedc0d-672d-329a-a124-cc2cf9aea38b', name: 'PinkDick' };

test('UUID игрока без лицензии зависит от регистра букв: настоящие значения из игры', (t) => {
  const { accounts } = setup(t);
  assert.equal(accounts.offlineUUID('pinkdick'), LOWER.uuid, 'это UUID из whitelist.json после «/whitelist add PinkDick»');
  assert.equal(accounts.offlineUUID('PinkDick'), EXACT.uuid, 'а с таким UUID друг приходит в игру, и его там нет');
});

test('белый список с нуля: друг записан с UUID от ника как есть', async (t) => {
  const { dir, file, friendlist } = setup(t);
  const r = await friendlist.sync(dir, ['PinkDick']);
  assert.deepEqual(r, { added: ['PinkDick'], removed: [], premium: [], unchecked: [] });
  assert.deepEqual(read(file), [EXACT]);
});

test('запись, которую оставила команда игры (ник строчными), заменяется верной; чужие записи на месте', async (t) => {
  const { dir, file, friendlist } = setup(t);
  write(file, [HOST, LOWER]);
  const r = await friendlist.sync(dir, ['PinkDick']);
  assert.deepEqual(r.removed, ['pinkdick']);
  assert.deepEqual(r.added, ['PinkDick']);
  assert.deepEqual(read(file), [HOST, EXACT]);
});

test('верная запись уже есть, а устаревшая осталась: лишняя убирается, файл переписывается', async (t) => {
  const { dir, file, friendlist } = setup(t);
  write(file, [HOST, LOWER, EXACT]);
  const r = await friendlist.sync(dir, ['PinkDick']);
  assert.deepEqual(r, { added: [], removed: ['pinkdick'], premium: [], unchecked: [] });
  assert.deepEqual(read(file), [HOST, EXACT]);
});

test('чужие поля и записи не трогаются', async (t) => {
  const { dir, file, friendlist } = setup(t);
  write(file, [{ ...HOST, expiresOn: 'never' }, { uuid: '00000000-0000-3000-8000-000000000001', name: 'Sleepy_Cat' }]);
  await friendlist.sync(dir, ['PinkDick']);
  const list = read(file);
  assert.equal(list.length, 3);
  assert.equal(list[0].expiresOn, 'never');
  assert.equal(list[1].name, 'Sleepy_Cat');
});

test('повторная запись ничего не меняет, файл не переписывается', async (t) => {
  const { dir, file, friendlist } = setup(t);
  await friendlist.sync(dir, ['PinkDick']);
  fs.utimesSync(file, 1000, 1000);
  const r = await friendlist.sync(dir, ['PinkDick']);
  assert.deepEqual(r, { added: [], removed: [], premium: [], unchecked: [] });
  assert.equal(Math.round(fs.statSync(file).mtimeMs / 1000), 1000);
});

test('ники, которые различаются только регистром, остаются оба', async (t) => {
  const { dir, file, friendlist } = setup(t);
  write(file, [LOWER]);
  const r = await friendlist.sync(dir, ['PinkDick', 'pinkdick']);
  assert.deepEqual(r.removed, [], 'строчная запись нужна второму другу');
  assert.deepEqual(read(file).map((e) => e.uuid).sort(), [EXACT.uuid, LOWER.uuid].sort());
});

test('ник без заглавных букв: лишнего не удаляется', async (t) => {
  const { dir, file, friendlist } = setup(t);
  write(file, [HOST]);
  const r = await friendlist.sync(dir, ['pinkdick']);
  assert.deepEqual(r.removed, []);
  assert.deepEqual(read(file), [HOST, LOWER]);
});

test('неподходящие ники пропускаются, а без ников файл не создаётся', async (t) => {
  const { dir, file, friendlist } = setup(t);
  assert.deepEqual(await friendlist.sync(dir, []), { added: [], removed: [], premium: [], unchecked: [] });
  assert.deepEqual((await friendlist.sync(dir, ['x', 'плохой ник', 'a b', ''])).added, []);
  assert.equal(fs.existsSync(file), false);
  assert.deepEqual((await friendlist.sync(dir, ['x', 'PinkDick'])).added, ['PinkDick']);
});

test('испорченный файл откладывается рядом, а список пишется заново', async (t) => {
  const { dir, file, friendlist } = setup(t);
  write(file, '[{ "uuid": "обрыв');
  const r = await friendlist.sync(dir, ['PinkDick']);
  assert.deepEqual(r.added, ['PinkDick']);
  assert.equal(fs.readFileSync(`${file}.broken`, 'utf8'), '[{ "uuid": "обрыв');
  assert.deepEqual(read(file), [EXACT]);
});

test('друг с лицензией: настоящий UUID записывается вместе с обычным; нет аккаунта или нет связи — не мешает', async (t) => {
  const { dir, file, friendlist, accounts } = setup(t);
  const asked = [];
  const getJson = async (url) => {
    asked.push(url);
    if (url.endsWith('/Bart_Awesome')) return { id: '37F80E2359B74E9FB250ADE4921E5F03', name: 'Bart_Awesome' };
    if (url.endsWith('/PinkDick')) throw Object.assign(new Error('HTTP 404'), { status: 404 });
    throw new Error('Нет связи с api.mojang.com (ETIMEDOUT)');
  };
  const r = await friendlist.sync(dir, ['Bart_Awesome', 'PinkDick', 'Sleepy_Cat'], { lookup: true, getJson });
  assert.deepEqual(r.premium, ['Bart_Awesome']);
  assert.deepEqual(r.unchecked, ['Sleepy_Cat']);
  const have = read(file).map((e) => `${e.name} ${e.uuid}`);
  assert.ok(have.includes(`Bart_Awesome ${HOST.uuid}`), 'настоящий UUID — строчными и с дефисами');
  assert.ok(have.includes(`Bart_Awesome ${accounts.offlineUUID('Bart_Awesome')}`), 'и обычный: вдруг проверка лицензии в игре не сработает');
  assert.ok(have.includes(`PinkDick ${EXACT.uuid}`));
  assert.ok(have.includes(`Sleepy_Cat ${accounts.offlineUUID('Sleepy_Cat')}`), 'нет связи — хотя бы обычный UUID');
  assert.equal(asked.length, 3);
  assert.ok(asked.every((u) => u.startsWith('https://api.mojang.com/users/profiles/minecraft/')));
});

test('без проверки лицензий в сеть не ходим', async (t) => {
  const { dir, friendlist } = setup(t);
  let calls = 0;
  await friendlist.sync(dir, ['PinkDick'], { getJson: async () => (calls++, null) });
  assert.equal(calls, 0);
});

test('ответ Mojang «нет такого ника»: 404 и пустой ответ — это не ошибка, а любая другая беда — ошибка', async (t) => {
  const { friendlist } = setup(t);
  assert.equal(await friendlist.premiumProfile('PinkDick', async () => Promise.reject(Object.assign(new Error('HTTP 404'), { status: 404 }))), null);
  assert.equal(await friendlist.premiumProfile('PinkDick', async () => Promise.reject(new SyntaxError('Unexpected end of JSON input'))), null);
  assert.equal(await friendlist.premiumProfile('PinkDick', async () => ({})), null);
  await assert.rejects(friendlist.premiumProfile('PinkDick', async () => Promise.reject(Object.assign(new Error('HTTP 500'), { status: 500 }))), /HTTP 500/);
});

// ---- записи из списка друзей: ник, «без лицензии», сохранённый UUID ----

const BART = { uuid: '37f80e23-59b7-4e9f-b250-ade4921e5f03', name: 'Bart_Awesome' };

test('друг без лицензии из списка: только обычный UUID, и даже по просьбе проверить лицензии в Mojang не ходим', async (t) => {
  const { dir, file, friendlist } = setup(t);
  let calls = 0;
  const getJson = async () => (calls++, { id: 'a'.repeat(32), name: 'PinkDick' });
  const r = await friendlist.sync(dir, [{ nick: 'PinkDick', offline: true }], { lookup: true, getJson });
  assert.equal(calls, 0, 'у ника без лицензии чужой настоящий UUID записывать нельзя: зашёл бы посторонний с таким ником');
  assert.deepEqual(read(file), [EXACT]);
  assert.deepEqual(r, { added: ['PinkDick'], removed: [], premium: [], unchecked: [] });
});

test('друг с лицензией и сохранённым UUID: пишутся настоящий и обычный, в сеть не ходим', async (t) => {
  const { dir, file, friendlist, accounts } = setup(t);
  let calls = 0;
  const r = await friendlist.sync(dir, [{ nick: 'Bart_Awesome', offline: false, uuid: BART.uuid }], { lookup: true, getJson: async () => (calls++, null) });
  assert.equal(calls, 0, 'UUID уже известен');
  assert.deepEqual(read(file), [{ uuid: accounts.offlineUUID('Bart_Awesome'), name: 'Bart_Awesome' }, BART]);
  assert.deepEqual([r.added, r.premium], [['Bart_Awesome', 'Bart_Awesome'], ['Bart_Awesome']]);
});

test('сохранённый UUID в другой записи (заглавные, без дефисов) пишется в нормальном виде', async (t) => {
  const { dir, file, friendlist } = setup(t);
  await friendlist.sync(dir, [{ nick: 'Bart_Awesome', offline: false, uuid: '37F80E2359B74E9FB250ADE4921E5F03' }]);
  assert.ok(read(file).some((e) => e.uuid === BART.uuid && e.name === 'Bart_Awesome'));
});

test('друг с лицензией без сохранённого UUID: без проверки — только обычный, с проверкой — и настоящий', async (t) => {
  const { dir, file, friendlist, accounts } = setup(t);
  const entry = [{ nick: 'Bart_Awesome', offline: false }];
  const getJson = async () => ({ id: '37F80E2359B74E9FB250ADE4921E5F03', name: 'Bart_Awesome' });
  await friendlist.sync(dir, entry, { getJson });
  assert.deepEqual(read(file), [{ uuid: accounts.offlineUUID('Bart_Awesome'), name: 'Bart_Awesome' }]);
  const r = await friendlist.sync(dir, entry, { lookup: true, getJson });
  assert.deepEqual(r.premium, ['Bart_Awesome']);
  assert.deepEqual(read(file).map((e) => e.uuid).sort(), [accounts.offlineUUID('Bart_Awesome'), BART.uuid].sort());
});

test('записи и просто ники вперемешку; плохие ники, лишние поля и испорченный UUID отбрасываются', async (t) => {
  const { dir, file, friendlist, accounts } = setup(t);
  const r = await friendlist.sync(dir, [
    'PinkDick',
    { nick: 'Sleepy_Cat', offline: true, uuid: 'x', admin: true },
    { nick: 'Bart_Awesome', offline: false, uuid: 'не-uuid' },
    { nick: 'плохой ник', offline: true },
    { nick: 'ab' },
    null,
    42,
    { nick: 'PinkDick', offline: true }, // повтор
  ]);
  assert.deepEqual(r.added.sort(), ['Bart_Awesome', 'PinkDick', 'Sleepy_Cat']);
  assert.deepEqual(read(file).map((e) => e.name).sort(), ['Bart_Awesome', 'PinkDick', 'Sleepy_Cat']);
  assert.ok(read(file).every((e) => e.uuid === accounts.offlineUUID(e.name)), 'у всех обычный UUID: у Bart_Awesome UUID испорчен и не записан');
});

test('запись из списка тоже убирает устаревшую строчную запись от команды игры', async (t) => {
  const { dir, file, friendlist } = setup(t);
  write(file, [HOST, LOWER]);
  const r = await friendlist.sync(dir, [{ nick: 'PinkDick', offline: true }]);
  assert.deepEqual([r.removed, r.added], [['pinkdick'], ['PinkDick']]);
  assert.deepEqual(read(file), [HOST, EXACT]);
});

// ---- очистка: белый список живёт один мир ----

test('names: ники из whitelist.json по порядку; нет файла, мусор и записи без ника не мешают', (t) => {
  const { dir, file, friendlist } = setup(t);
  assert.deepEqual(friendlist.names(dir), [], 'файла нет');
  write(file, [HOST, null, 7, { uuid: '00000000-0000-3000-8000-000000000001' }, { name: 'Только_ник' }, EXACT]);
  assert.deepEqual(friendlist.names(dir), ['Bart_Awesome', '00000000-0000-3000-8000-000000000001', 'Только_ник', 'PinkDick'], 'без ника показывается UUID');
  write(file, '[{ "uuid": "обрыв');
  assert.deepEqual(friendlist.names(dir), [], 'испорченный файл: пусто, а не ошибка');
  assert.deepEqual(friendlist.names(path.join(dir, 'нет', 'такой', 'папки')), []);
});

test('clear: файла нет — ничего не создаётся и не падает', (t) => {
  const { dir, file, friendlist } = setup(t);
  assert.deepEqual(friendlist.clear(dir), { cleared: 0, names: [] });
  assert.deepEqual(friendlist.clear(path.join(dir, 'нет', 'такой', 'папки')), { cleared: 0, names: [] });
  assert.equal(fs.existsSync(file), false);
  assert.equal(fs.existsSync(`${file}.bak`), false);
});

test('clear: список записан — после очистки файл пуст, а прежний список лежит рядом в whitelist.json.bak', (t) => {
  const { dir, file, friendlist } = setup(t);
  write(file, [HOST, EXACT]);
  const before = fs.readFileSync(file, 'utf8');
  assert.deepEqual(friendlist.clear(dir), { cleared: 2, names: ['Bart_Awesome', 'PinkDick'] });
  assert.deepEqual(read(file), []);
  assert.equal(fs.readFileSync(`${file}.bak`, 'utf8'), before, 'копия точь-в-точь такая, какой файл был');
  assert.deepEqual(friendlist.names(dir), []);
});

test('clear: у друга с лицензией две записи под одним ником — в ответе ник один раз, а убрано записей две', (t) => {
  const { dir, file, friendlist } = setup(t);
  write(file, [HOST, { uuid: '00000000-0000-3000-8000-000000000001', name: 'Bart_Awesome' }, EXACT]);
  assert.deepEqual(friendlist.clear(dir), { cleared: 3, names: ['Bart_Awesome', 'PinkDick'] });
});

test('clear: пустой список не трогается, а копия последнего непустого списка не затирается пустым', (t) => {
  const { dir, file, friendlist } = setup(t);
  write(file, [EXACT]);
  friendlist.clear(dir);
  fs.utimesSync(file, 1000, 1000);
  assert.deepEqual(friendlist.clear(dir), { cleared: 0, names: [] });
  assert.equal(Math.round(fs.statSync(file).mtimeMs / 1000), 1000, 'пустой файл не переписывается');
  assert.deepEqual(read(`${file}.bak`), [EXACT], 'в копии по-прежнему друг, а не пустой список');
});

test('clear: испорченный файл откладывается рядом и заменяется пустым списком', (t) => {
  const { dir, file, friendlist } = setup(t);
  write(file, '[{ "uuid": "обрыв');
  assert.deepEqual(friendlist.clear(dir), { cleared: 0, names: [] });
  assert.equal(fs.readFileSync(`${file}.broken`, 'utf8'), '[{ "uuid": "обрыв');
  assert.deepEqual(read(file), []);
});

test('clear: после очистки друг записывается заново обычным способом', async (t) => {
  const { dir, file, friendlist } = setup(t);
  await friendlist.sync(dir, ['PinkDick']);
  friendlist.clear(dir);
  assert.deepEqual(read(file), []);
  const r = await friendlist.sync(dir, ['PinkDick']);
  assert.deepEqual(r.added, ['PinkDick']);
  assert.deepEqual(read(file), [EXACT]);
});
