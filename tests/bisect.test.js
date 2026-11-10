const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { profile, put, src } = require('./helpers');

const bisect = require(src('core/bisect'));
const { plan, closureOf } = bisect;

// Прогоняет поиск, отвечая за человека: crashed(проба) → повторилась ли проблема. Возвращает итог и все пробы
function simulate(needs, crashed, hints = []) {
  const history = [];
  for (let guard = 0; guard < 200; guard++) {
    const p = plan({ needs, hints }, history);
    if (p.done) return { result: p.result, tests: history.map((h) => h.set), history };
    assert.deepEqual(closureOf(p.test, needs), p.test, 'каждая проба согласована: мод включён вместе с тем, что ему нужно');
    assert.ok(!history.some((h) => h.set.join() === p.test.join()), 'одну и ту же пробу дважды не просят');
    history.push({ set: p.test, crashed: crashed(p.test) });
  }
  throw new Error('поиск не закончился');
}
const flat = (n) => Array.from({ length: n }, () => []);
const log2 = (n) => Math.ceil(Math.log2(n));

test('один виновник среди моделей без зависимостей: находится за 2 + log2 проб, где бы он ни стоял', () => {
  for (const n of [2, 3, 7, 10, 16, 40]) {
    for (let c = 0; c < n; c++) {
      const r = simulate(flat(n), (set) => set.includes(c));
      assert.deepEqual(r.result, { kind: 'culprit', culprits: [c] }, `n=${n}, виновник ${c}`);
      assert.ok(r.tests.length <= 2 + log2(n), `n=${n}: ${r.tests.length} проб`);
      assert.deepEqual(r.tests[0], [], 'первая проба — без модов');
    }
  }
});

test('сначала игра без модов: если проблема есть и без них, винить моды не за что', () => {
  const r = simulate(flat(12), () => true);
  assert.deepEqual(r.result, { kind: 'not-mods' });
  assert.equal(r.tests.length, 1);
});

test('единственный мод: после чистой пробы без модов виноват он, больше проб не нужно', () => {
  const r = simulate(flat(1), (set) => set.includes(0));
  assert.deepEqual(r.result, { kind: 'culprit', culprits: [0] });
  assert.equal(r.tests.length, 1);
});

test('зависимости: мод включается только вместе с нужными ему; виновник-библиотека и виновник-пользователь библиотеки различаются', () => {
  // 0 — библиотека (все её используют), 1 — вторая библиотека, 5 и 6 пользуются ими
  const needs = [[], [], [0], [0], [0, 1], [0], [0, 1], [], [3], []];
  // Виноват лист: 6 (ему нужны 0 и 1)
  const leaf = simulate(needs, (set) => set.includes(6));
  assert.deepEqual(leaf.result, { kind: 'culprit', culprits: [6] });
  for (const t of leaf.tests) if (t.includes(6)) assert.ok(t.includes(0) && t.includes(1), 'у пробы с модом 6 есть его библиотеки');
  // Виновата сама библиотека 0: находится она, а не один из многих, кто ею пользуется
  const lib = simulate(needs, (set) => set.includes(0));
  assert.deepEqual(lib.result, { kind: 'culprit', culprits: [0] });
  assert.ok(lib.tests.length <= 2 + log2(needs.length));
});

test('подсказка из отчёта о вылете: верная — две пробы, неверная — лишняя проба, но виновник всё равно находится', () => {
  const crashed = (c) => (set) => set.includes(c);
  const right = simulate(flat(16), crashed(7), [7]);
  assert.deepEqual(right.result, { kind: 'culprit', culprits: [7] });
  assert.equal(right.tests.length, 2, 'без модов + подозреваемый (подтверждение берётся из уже полученного ответа)');
  const wrong = simulate(flat(16), crashed(3), [7]);
  assert.deepEqual(wrong.result, { kind: 'culprit', culprits: [3] });
  assert.ok(wrong.tests.length <= 3 + log2(16), `${wrong.tests.length} проб`);
});

test('проблема только от сочетания двух модов: находятся оба', () => {
  const r = simulate(flat(10), (set) => set.includes(2) && set.includes(9));
  assert.deepEqual(r.result, { kind: 'combo', culprits: [2, 9] });
  assert.ok(r.tests.length < 30, `${r.tests.length} проб`);
  const withDeps = simulate([[], [0], [0], [1], [], [4], [], [], [6], []], (set) => set.includes(3) && set.includes(8));
  assert.equal(withDeps.result.kind, 'combo');
  assert.deepEqual(withDeps.result.culprits, [3, 8]);
});

test('проблема появляется только при всех модах сразу: так и говорим, никого не обвиняя', () => {
  const r = simulate(flat(6), (set) => set.length === 6);
  assert.deepEqual(r.result, { kind: 'all' });
});

test('любой набор виновников на случайных сборках с зависимостями: итог всегда согласован с тем, что «видел» человек', () => {
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let round = 0; round < 200; round++) {
    const n = 2 + Math.floor(rnd() * 24);
    // Зависимости только «назад» (библиотеки раньше пользователей), как их и выстраивает лаунчер
    const needs = Array.from({ length: n }, (_, i) => [...new Set(Array.from({ length: Math.floor(rnd() * 3) }, () => (i ? Math.floor(rnd() * i) : -1)).filter((j) => j >= 0))]);
    const c = Math.floor(rnd() * n);
    const r = simulate(needs, (set) => set.includes(c));
    assert.equal(r.result.kind, 'culprit', `round ${round}`);
    assert.ok(closureOf(r.result.culprits, needs).includes(c), `виновник ${c} в замыкании найденного (${r.result.culprits})`);
    assert.ok(r.tests.length <= 2 + log2(n), `n=${n}: ${r.tests.length} проб`);
  }
});

test('поиск можно продолжить: следующая проба по неполной истории — ровно та, что была бы при непрерывном поиске', () => {
  const needs = [[], [0], [0], [], [3], [], [1], [], [], [5]];
  const full = simulate(needs, (set) => set.includes(8));
  for (let k = 0; k < full.history.length; k++) {
    assert.deepEqual(plan({ needs }, full.history.slice(0, k)).test, full.history[k].set, `после ${k} ответов`);
  }
  assert.equal(plan({ needs }, full.history).done, true);
});

test('«Suspected Mods» из отчёта о вылете: id и названия; «None» и пустой отчёт — никого', () => {
  assert.deepEqual(bisect.parseSuspects('...\n\tSuspected Mods: Sodium (sodium), Iris Shaders (iris)\n\tFabric Mods:'), [{ name: 'Sodium', id: 'sodium' }, { name: 'Iris Shaders', id: 'iris' }]);
  assert.deepEqual(bisect.parseSuspects('Suspected Mods: None'), []);
  assert.deepEqual(bisect.parseSuspects('Suspected Mods: none'), []);
  assert.deepEqual(bisect.parseSuspects('ничего похожего'), []);
  assert.deepEqual(bisect.parseSuspects(''), []);
});

// ---------- на диске ----------

const jar = (id, { name, depends = {} } = {}) => {
  const z = new AdmZip();
  z.addFile('fabric.mod.json', Buffer.from(JSON.stringify({ schemaVersion: 1, id, name: name || id, version: '1.0', depends })));
  return z.toBuffer();
};

function setup(t, { reports = {} } = {}) {
  const p = profile();
  t.after(() => p.done());
  const instances = p.load('core/instances');
  const mods = p.load('core/mods');
  const inst = instances.create({ name: 'Тест', version: '1.21.1', loader: 'fabric' });
  const g = instances.gameDir(inst.id);
  put(g, {
    'mods/fabric-api.jar': jar('fabric-api', { name: 'Fabric API' }),
    'mods/lib.jar': jar('cloth-config', { name: 'Cloth Config', depends: { 'fabric-api': '*', minecraft: '1.21.x' } }),
    'mods/alpha.jar': jar('alpha', { name: 'Alpha', depends: { 'fabric-api': '*' } }),
    'mods/beta.jar': jar('beta', { name: 'Beta', depends: { 'cloth-config': '*', fabricloader: '*' } }),
    'mods/culprit.jar': jar('culprit', { name: 'Culprit', depends: { 'cloth-config': '*', 'fabric-resource-loader-v0': '*' } }),
    'mods/gamma.jar': jar('gamma', { name: 'Gamma' }),
    'mods/old.jar.disabled': jar('old', { name: 'Old' }),
  });
  for (const [name, text] of Object.entries(reports)) put(g, { [`crash-reports/${name}`]: text });
  const state = () => Object.fromEntries(fs.readdirSync(mods_dir()).map((f) => [f.replace(/\.disabled$/, ''), !f.endsWith('.disabled')]));
  const mods_dir = () => path.join(g, 'mods');
  const enabled = () => Object.entries(state()).filter(([, on]) => on).map(([f]) => f).sort();
  return { p, inst, g, mods, instances, state, enabled, bisect: p.load('core/bisect'), file: path.join(instances.dirOf(inst.id), 'bisect.json') };
}

// «Игра»: проблема повторяется, пока включён culprit.jar
const crashes = (s) => s.enabled().includes('culprit.jar');

test('поиск на настоящих файлах: моды выключаются и включаются, виновник находится, всё возвращается как было', (t) => {
  const s = setup(t);
  const before = s.enabled();
  assert.deepEqual(before, ['alpha.jar', 'beta.jar', 'culprit.jar', 'fabric-api.jar', 'gamma.jar', 'lib.jar']);

  let v = s.bisect.start(s.inst.id);
  assert.deepEqual([v.phase, v.step, v.total, v.test.kind, v.test.count], ['test', 1, 6, 'vanilla', 0]);
  assert.deepEqual(s.enabled(), [], 'первая проба — без модов');
  assert.equal(s.state()['old.jar'], false, 'выключенный до поиска мод остаётся выключенным');
  assert.ok(fs.existsSync(s.file));
  assert.throws(() => s.bisect.start(s.inst.id), /Поиск уже идёт/);
  assert.deepEqual(s.bisect.pending(), [{ id: s.inst.id, name: 'Тест' }]);

  const seen = [];
  for (let guard = 0; guard < 20 && v.phase === 'test'; guard++) {
    const on = s.enabled();
    seen.push(on);
    assert.equal(on.length, v.test.count, 'включено ровно столько, сколько обещано человеку');
    if (on.includes('beta.jar') || on.includes('culprit.jar')) assert.ok(on.includes('lib.jar') && on.includes('fabric-api.jar'), 'нужные библиотеки включены');
    if (on.includes('culprit.jar')) assert.ok(on.includes('fabric-api.jar'), 'модули Fabric API считаются самим Fabric API');
    v = s.bisect.answer(s.inst.id, crashes(s));
  }
  assert.equal(v.phase, 'done');
  assert.equal(v.result.kind, 'culprit');
  assert.deepEqual(v.result.culprits.map((c) => c.title), ['Culprit']);
  assert.deepEqual(v.result.libs.sort(), ['Cloth Config', 'Fabric API']);
  assert.ok(v.done <= 2 + log2(6), `проб: ${v.done}`);
  assert.deepEqual(s.enabled(), before, 'итог известен — моды пока как были, решает человек');

  // Человек выключает виновника и заканчивает
  const r = s.bisect.finish(s.inst.id, ['culprit.jar', 'старый-чужой.jar']);
  assert.deepEqual(r.disabled, ['Culprit'], 'выключается только мод из этого поиска');
  assert.deepEqual(s.enabled(), before.filter((f) => f !== 'culprit.jar'));
  assert.equal(fs.existsSync(s.file), false);
  assert.deepEqual(s.bisect.pending(), []);
  assert.equal(s.bisect.view(s.inst.id), null);
});

test('«Вернуть как было» на любом шаге: все моды на месте, ничего не выключено, поиск стёрт', (t) => {
  const s = setup(t);
  const before = s.enabled();
  s.bisect.start(s.inst.id);
  s.bisect.answer(s.inst.id, false); // вторая проба: часть модов
  assert.notDeepEqual(s.enabled(), before);
  assert.deepEqual(s.bisect.finish(s.inst.id), { disabled: [] });
  assert.deepEqual(s.enabled(), before);
  assert.equal(s.state()['old.jar'], false);
  assert.equal(fs.existsSync(s.file), false);
  assert.deepEqual(s.bisect.finish(s.inst.id), { disabled: [] }, 'повторное завершение ничего не ломает');
});

test('поиск переживает перезапуск лаунчера: состояние читается с диска, ответы продолжают ту же историю', (t) => {
  const s = setup(t);
  s.bisect.start(s.inst.id);
  s.bisect.answer(s.inst.id, false);
  const mid = s.bisect.view(s.inst.id);
  const again = s.p.load('core/bisect').view(s.inst.id); // как будто лаунчер запущен заново
  assert.deepEqual(again, mid);
  assert.equal(mid.step, 2);
  assert.deepEqual(mid.history, [{ count: 0, crashed: false }]);
});

test('проблема не от модов: итог после одной пробы, моды возвращены', (t) => {
  const s = setup(t);
  const before = s.enabled();
  s.bisect.start(s.inst.id);
  const v = s.bisect.answer(s.inst.id, true);
  assert.deepEqual([v.phase, v.result.kind, v.done], ['done', 'not-mods', 1]);
  assert.deepEqual(s.enabled(), before);
});

test('подсказка из отчёта о вылете сокращает поиск: подозреваемый проверяется сразу после игры без модов', (t) => {
  const report = 'Description: x\n\n-- System Details --\nDetails:\n\tSuspected Mods: Culprit (culprit)\n';
  const s = setup(t, { reports: { 'crash-2025.txt': report } });
  s.bisect.start(s.inst.id);
  let v = s.bisect.answer(s.inst.id, false);
  assert.equal(v.phase, 'test');
  assert.deepEqual(v.test.mods.sort(), ['Cloth Config', 'Culprit', 'Fabric API'], 'подозреваемый и то, что ему нужно');
  v = s.bisect.answer(s.inst.id, true);
  assert.deepEqual([v.phase, v.done, v.result.culprits.map((c) => c.title)], ['done', 2, ['Culprit']], 'всего две пробы');
});

test('путь к отчёту снаружи папки crash-reports не читается', (t) => {
  const s = setup(t);
  const outside = path.join(s.p.dir, 'secret.txt');
  fs.writeFileSync(outside, 'Suspected Mods: Culprit (culprit)');
  s.bisect.start(s.inst.id, { report: outside });
  const v = s.bisect.answer(s.inst.id, false);
  assert.ok(v.test.count > 0 && v.test.count < 6 && !(v.test.mods.length === 3 && v.test.mods.includes('Culprit')), 'подсказки нет: делим пополам');
});

test('нечего искать: ванильная сборка и сборка с одним модом', (t) => {
  const s = setup(t);
  const v = s.instances.create({ name: 'Ванилла', version: '1.21.1', loader: 'vanilla' });
  assert.throws(() => s.bisect.start(v.id), /нет модов/);
  const one = s.instances.create({ name: 'Один', version: '1.21.1', loader: 'fabric' });
  put(s.instances.gameDir(one.id), { 'mods/a.jar': jar('a') });
  assert.throws(() => s.bisect.start(one.id), /хотя бы два/);
  assert.throws(() => s.bisect.answer(one.id, true), /не начат/);
});
