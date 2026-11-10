const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { profile } = require('./helpers');

function setup(t) {
  const p = profile();
  t.after(() => p.done());
  return { p, friends: p.load('core/friends') };
}
// Mojang: ник → ответ; не названный — «нет такого аккаунта» (404), Error — сбой сети. calls — о ком спрашивали
function mojang(answers = {}) {
  const calls = [];
  return {
    calls,
    getJson: async (url) => {
      const nick = decodeURIComponent(url.split('/').pop());
      calls.push(nick);
      const a = answers[nick];
      if (a instanceof Error) throw a;
      if (a === undefined) throw Object.assign(new Error('HTTP 404'), { status: 404 });
      return a;
    },
  };
}
const BART = { id: '37F80E2359B74E9FB250ADE4921E5F03', name: 'Bart_Awesome' };
const BART_UUID = '37f80e23-59b7-4e9f-b250-ade4921e5f03';
const saved = (p) => JSON.parse(fs.readFileSync(path.join(p.dir, 'launcher.json'), 'utf8')).friends;
const down = () => new Error('Нет связи с api.mojang.com (ETIMEDOUT)');

test('список друзей на новом профиле пуст и лежит в настройках лаунчера', (t) => {
  const { p, friends } = setup(t);
  assert.deepEqual(friends.list(), []);
  assert.deepEqual(p.store.get().friends, []);
  assert.deepEqual(friends.selected(), []);
});

test('друг без лицензии: записывается сразу, в Mojang не ходим, галочка стоит', async (t) => {
  const { p, friends } = setup(t);
  const m = mojang();
  const r = await friends.add({ nick: 'PinkDick', offline: true }, { getJson: m.getJson });
  assert.deepEqual(r, { friends: [{ nick: 'PinkDick', offline: true, uuid: null, on: true }], note: '' });
  assert.deepEqual(m.calls, []);
  assert.deepEqual(saved(p), r.friends, 'в launcher.json записано сразу');
});

test('друг с лицензией: настоящий UUID берётся у Mojang один раз и остаётся в списке', async (t) => {
  const { friends } = setup(t);
  const m = mojang({ Bart_Awesome: BART });
  const r = await friends.add({ nick: 'Bart_Awesome' }, { getJson: m.getJson });
  assert.deepEqual(r.friends, [{ nick: 'Bart_Awesome', offline: false, uuid: BART_UUID, on: true }], 'UUID с дефисами и строчными');
  assert.equal(r.note, '');
  assert.deepEqual(m.calls, ['Bart_Awesome']);
  assert.deepEqual(friends.list(), r.friends);
});

test('друг «с лицензией», а такого аккаунта у Mojang нет: записывается как друг без лицензии, и об этом говорят', async (t) => {
  const { friends } = setup(t);
  const r = await friends.add({ nick: 'PinkCat_' }, { getJson: mojang().getJson });
  assert.deepEqual([r.friends[0].offline, r.friends[0].uuid, r.note], [true, null, 'no-license']);
});

test('нет связи с Mojang: друг остаётся «с лицензией» без UUID, об этом сказано, добавление не срывается', async (t) => {
  const { friends } = setup(t);
  const r = await friends.add({ nick: 'Bart_Awesome' }, { getJson: mojang({ Bart_Awesome: down() }).getJson });
  assert.deepEqual([r.friends[0].offline, r.friends[0].uuid, r.note], [false, null, 'unchecked']);
});

test('плохой ник, повтор (в любом регистре) и слишком длинный список — понятные ошибки, список не меняется', async (t) => {
  const { friends } = setup(t);
  const dry = { getJson: mojang().getJson };
  await friends.add({ nick: 'PinkDick', offline: true }, dry);
  await assert.rejects(friends.add({ nick: 'ab', offline: true }, dry), { message: 'Ник «ab»: 3–16 символов, латиница, цифры и _' });
  await assert.rejects(friends.add({ nick: 'плохой ник', offline: true }, dry), /3–16 символов/);
  await assert.rejects(friends.add({ nick: '  ', offline: true }, dry), /3–16 символов/);
  await assert.rejects(friends.add({ nick: 'pinkdick', offline: true }, dry), /«pinkdick» уже есть в списке друзей/);
  for (let i = 1; i < 50; i++) await friends.add({ nick: `Friend_${i}`, offline: true }, dry);
  assert.equal(friends.list().length, 50);
  await assert.rejects(friends.add({ nick: 'One_More', offline: true }, dry), /не больше 50/);
  assert.equal(friends.list().length, 50);
});

test('ник обрезается по краям, а лишние поля из запроса не попадают в список', async (t) => {
  const { friends } = setup(t);
  const r = await friends.add({ nick: '  PinkDick  ', offline: true, uuid: 'подмена', on: false, admin: true }, { getJson: mojang().getJson });
  assert.deepEqual(r.friends, [{ nick: 'PinkDick', offline: true, uuid: null, on: true }]);
});

test('галочка «пустить в этот мир»: ставится и снимается, запоминается', async (t) => {
  const { p, friends } = setup(t);
  const dry = { getJson: mojang().getJson };
  await friends.add({ nick: 'PinkDick', offline: true }, dry);
  await friends.add({ nick: 'Sleepy_Cat', offline: true }, dry);
  const r = await friends.update('PinkDick', { on: false }, dry);
  assert.deepEqual(r.friends.map((f) => [f.nick, f.on]), [['PinkDick', false], ['Sleepy_Cat', true]]);
  assert.deepEqual(saved(p).map((f) => f.on), [false, true]);
  assert.deepEqual(friends.selected().map((f) => f.nick), ['Sleepy_Cat']);
  await friends.update('pinkdick', { on: true }, dry); // ник находится без учёта регистра
  assert.deepEqual(friends.selected().map((f) => f.nick), ['PinkDick', 'Sleepy_Cat'], 'порядок как в списке');
  await assert.rejects(friends.update('Nobody_', { on: true }, dry), /нет в списке/);
});

test('«без лицензии» включают — UUID забывается и в Mojang не ходят; выключают — лицензию проверяют заново', async (t) => {
  const { friends } = setup(t);
  const m = mojang({ Bart_Awesome: BART });
  await friends.add({ nick: 'Bart_Awesome' }, { getJson: m.getJson });
  const off = await friends.update('Bart_Awesome', { offline: true }, { getJson: m.getJson });
  assert.deepEqual([off.friends[0].offline, off.friends[0].uuid, off.note], [true, null, '']);
  assert.equal(m.calls.length, 1, 'при включении «без лицензии» новых запросов нет');
  const on = await friends.update('Bart_Awesome', { offline: false }, { getJson: m.getJson });
  assert.deepEqual([on.friends[0].offline, on.friends[0].uuid, on.note], [false, BART_UUID, '']);
  assert.equal(m.calls.length, 2);
});

test('«с лицензией» выбрали для ника, у которого лицензии нет или нет связи', async (t) => {
  const { friends } = setup(t);
  await friends.add({ nick: 'PinkDick', offline: true }, { getJson: mojang().getJson });
  const none = await friends.update('PinkDick', { offline: false }, { getJson: mojang().getJson });
  assert.deepEqual([none.friends[0].offline, none.note], [true, 'no-license'], 'аккаунта нет — остаётся без лицензии');
  const lost = await friends.update('PinkDick', { offline: false }, { getJson: mojang({ PinkDick: down() }).getJson });
  assert.deepEqual([lost.friends[0].offline, lost.friends[0].uuid, lost.note], [false, null, 'unchecked'], 'нет связи — помечен «с лицензией», проверить не вышло');
});

test('убрать друга: пропадает из списка и из файла; убрать несуществующего — не ошибка', async (t) => {
  const { p, friends } = setup(t);
  const dry = { getJson: mojang().getJson };
  await friends.add({ nick: 'PinkDick', offline: true }, dry);
  await friends.add({ nick: 'Sleepy_Cat', offline: true }, dry);
  assert.deepEqual(friends.remove('pinkdick').friends.map((f) => f.nick), ['Sleepy_Cat']);
  assert.deepEqual(saved(p).map((f) => f.nick), ['Sleepy_Cat']);
  assert.deepEqual(friends.remove('Nobody_').friends.map((f) => f.nick), ['Sleepy_Cat']);
});

test('selected: отмеченные друзья в том виде, в каком их пишет белый список (ник, лицензия, UUID)', async (t) => {
  const { friends } = setup(t);
  const m = mojang({ Bart_Awesome: BART });
  await friends.add({ nick: 'Bart_Awesome' }, { getJson: m.getJson });
  await friends.add({ nick: 'PinkDick', offline: true }, { getJson: m.getJson });
  await friends.add({ nick: 'Sleepy_Cat', offline: true }, { getJson: m.getJson });
  await friends.update('Sleepy_Cat', { on: false }, { getJson: m.getJson });
  assert.deepEqual(friends.selected(), [
    { nick: 'Bart_Awesome', offline: false, uuid: BART_UUID },
    { nick: 'PinkDick', offline: true, uuid: null },
  ]);
});

test('«Подготовить»: у отмеченных друзей с лицензией без UUID он запрашивается; чужие не трогаются; сбои не мешают', async (t) => {
  const { p, friends } = setup(t);
  const off = { getJson: mojang({ Bart_Awesome: down(), Alex_Prem: down(), Ghost_One: down(), Unticked_: down() }).getJson };
  await friends.add({ nick: 'Bart_Awesome' }, off); // нет связи: без UUID
  await friends.add({ nick: 'Alex_Prem' }, off);
  await friends.add({ nick: 'Ghost_One' }, off);
  await friends.add({ nick: 'PinkDick', offline: true }, off);
  await friends.add({ nick: 'Unticked_', offline: false }, off);
  await friends.update('Unticked_', { on: false }, off);
  const m = mojang({ Bart_Awesome: BART, Alex_Prem: down() }); // Ghost_One — нет аккаунта (404)
  const r = await friends.resolveMissing({ getJson: m.getJson });
  assert.deepEqual(m.calls.sort(), ['Alex_Prem', 'Bart_Awesome', 'Ghost_One'], 'только отмеченные друзья с лицензией без UUID');
  const by = Object.fromEntries(friends.list().map((f) => [f.nick, f]));
  assert.equal(by.Bart_Awesome.uuid, BART_UUID);
  assert.equal(by.Alex_Prem.uuid, null, 'нет связи — остался без UUID, остаётся «с лицензией»');
  assert.equal(by.Alex_Prem.offline, false);
  assert.equal(by.Ghost_One.offline, true, 'аккаунта нет — стал «без лицензии»');
  assert.deepEqual(r.notes.sort((a, b) => a.nick.localeCompare(b.nick)), [{ nick: 'Alex_Prem', note: 'unchecked' }, { nick: 'Ghost_One', note: 'no-license' }]);
  assert.deepEqual(saved(p), friends.list(), 'всё записано в файл');
  const again = mojang();
  await friends.resolveMissing({ getJson: again.getJson });
  assert.deepEqual(again.calls, ['Alex_Prem'], 'второй раз спрашиваем только про того, кого не удалось проверить');
});

test('перенос старых ников из окон сборок: объединяются, повторы и плохие ники отбрасываются, отметка — у ников открытой сборки', async (t) => {
  const { friends } = setup(t);
  const r = friends.importLegacy([
    { nick: 'PinkDick', offline: true, on: true },
    { nick: 'pinkdick', offline: false, on: false }, // тот же друг из другой сборки
    { nick: 'Sleepy_Cat', offline: false, on: false },
    { nick: 'x', offline: true, on: true },
    { nick: 'плохой', on: true },
    null,
    { nick: 'Sleepy_Cat', on: true }, // повтор с отметкой: отметка включается, ничего не удваивается
  ]);
  assert.deepEqual(r.friends, [
    { nick: 'PinkDick', offline: true, uuid: null, on: true },
    { nick: 'Sleepy_Cat', offline: false, uuid: null, on: true },
  ]);
  const again = friends.importLegacy([{ nick: 'PinkDick', offline: false, on: false }, { nick: 'New_One', on: false }]);
  assert.deepEqual(again.friends.map((f) => [f.nick, f.offline, f.on]), [['PinkDick', true, true], ['Sleepy_Cat', false, true], ['New_One', false, false]], 'уже записанных не трогает, отметки не снимает');
});

test('перенос не превышает предел списка, и в файл лишнее не попадает', (t) => {
  const { p, friends } = setup(t);
  const many = Array.from({ length: 70 }, (_, i) => ({ nick: `Friend_${i}`, offline: true, on: true }));
  assert.equal(friends.importLegacy(many).friends.length, 50);
  assert.equal(saved(p).length, 50);
});

test('слишком длинный список в настройках (файл правили руками) обрезается до предела', (t) => {
  const { p, friends } = setup(t);
  p.store.get().friends = Array.from({ length: 70 }, (_, i) => ({ nick: `Friend_${i}`, offline: true, on: true }));
  assert.equal(friends.list().length, 50);
  assert.equal(friends.selected().length, 50);
});

test('испорченные данные в настройках не ломают список: берутся только годные записи', (t) => {
  const { p, friends } = setup(t);
  p.store.get().friends = [null, 5, 'строка', { nick: 'ok_nick', uuid: 'не-uuid' }, { nick: 'bad nick!' }, { nick: 'OK_NICK' }, { nick: 'Другой' }, { nick: 'Good_One', offline: 1, on: 'да', uuid: BART_UUID.toUpperCase() }];
  assert.deepEqual(friends.list(), [
    { nick: 'ok_nick', offline: false, uuid: null, on: false },
    { nick: 'Good_One', offline: true, uuid: null, on: true },
  ], 'UUID испорченной формы отброшен; у друга «без лицензии» UUID быть не может');
  p.store.get().friends = 'не список';
  assert.deepEqual(friends.list(), []);
  delete p.store.get().friends;
  assert.deepEqual(friends.list(), []);
});

test('список переживает перезапуск лаунчера', async (t) => {
  const { p, friends } = setup(t);
  await friends.add({ nick: 'PinkDick', offline: true }, { getJson: mojang().getJson });
  await friends.add({ nick: 'Bart_Awesome' }, { getJson: mojang({ Bart_Awesome: BART }).getJson });
  p.store.init(p.dir); // заново читаем launcher.json
  assert.deepEqual(friends.list().map((f) => [f.nick, f.offline, f.uuid, f.on]), [['PinkDick', true, null, true], ['Bart_Awesome', false, BART_UUID, true]]);
});

test('list возвращает копию: изменить список снаружи, минуя модуль, нельзя', async (t) => {
  const { friends } = setup(t);
  await friends.add({ nick: 'PinkDick', offline: true }, { getJson: mojang().getJson });
  const got = friends.list();
  got[0].on = false;
  got.push({ nick: 'Intruder', on: true });
  assert.deepEqual(friends.list(), [{ nick: 'PinkDick', offline: true, uuid: null, on: true }]);
});
