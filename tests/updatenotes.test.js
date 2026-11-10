const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');
const { src } = require('./helpers');
const UpdateNotes = require(src('renderer/updatenotes'));

const clean = (s) => String(s).replace(/[\r\n]+/g, ' ').replace(/\*\*/g, '').trim();
// Записи «Что нового» берём настоящие, из whatsnew.js: заметки об обновлении строятся из них, значит, обязаны пережить любой их текст
const CHANGELOG = (() => {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(src('renderer/whatsnew.js'), 'utf8'), sandbox);
  return sandbox.window.CHANGELOG;
})();

test('заметки собираются из записи «Что нового» и читаются обратно: по-русски и по-английски, без потерь', () => {
  const entry = {
    ru: [['🧹', 'Белый список живёт один мир', 'когда мир закрывается — список очищается; «Играть ♡» — единственный путь']],
    en: [['🧹', 'The whitelist lives one world', 'when the world closes the list is cleared; “Play ♡” is the only path']],
  };
  const md = UpdateNotes.render(entry);
  assert.deepEqual(UpdateNotes.parse(md, 'ru'), entry.ru);
  assert.deepEqual(UpdateNotes.parse(md, 'en'), entry.en);
  assert.match(md, /^- 🧹 \*\*Белый список живёт один мир\*\* — /m, 'это обычный markdown: на GitHub читается без лаунчера');
});

test('все записи «Что нового» из whatsnew.js переживают круг «собрать — прочитать»', () => {
  assert.ok(CHANGELOG.length >= 8);
  for (const entry of CHANGELOG) {
    const md = UpdateNotes.render(entry);
    for (const lang of ['ru', 'en']) {
      const want = Array.from(entry[lang], ([i, t, x]) => [clean(i), clean(t), clean(x)]); // Array.from: запись пришла из другого контекста vm, а сравнение строгое
      assert.deepEqual(UpdateNotes.parse(md, lang), want, `${entry.version} ${lang}`);
    }
  }
});

test('странный текст в записи не ломает разбор: переводы строк, звёздочки и тире внутри', () => {
  const entry = {
    ru: [['✨', 'Про **жирное**', 'первая строка\nвторая — с тире — и ещё\r\nтретья **выделена**']],
    en: [['✨', 'About bold', 'a – b - c']],
  };
  const md = UpdateNotes.render(entry);
  assert.deepEqual(UpdateNotes.parse(md, 'ru'), [['✨', 'Про жирное', 'первая строка вторая — с тире — и ещё третья выделена']]);
  assert.deepEqual(UpdateNotes.parse(md, 'en'), [['✨', 'About bold', 'a – b - c']]);
});

test('нет английского блока — по-английски показываются русские пункты; нет русского — английские', () => {
  const ruOnly = UpdateNotes.render({ ru: [['🐾', 'Лапка', 'новый курсор']], en: [] });
  assert.equal(UpdateNotes.parse(ruOnly, 'en')[0][1], 'Лапка');
  const enOnly = UpdateNotes.render({ ru: [], en: [['🐾', 'Paw', 'a new cursor']] });
  assert.equal(UpdateNotes.parse(enOnly, 'ru')[0][1], 'Paw');
});

test('мусор вместо заметок — пустой список, а не ошибка (старые версии и другие источники обновлений заметок не присылают)', () => {
  for (const junk of [undefined, null, '', 5, {}, [], 'просто текст без пунктов', '- нет жирного\n- ещё', '---', '**x** — y', [null, 5], [{ note: '' }]]) {
    assert.deepEqual(UpdateNotes.parse(junk, 'ru'), [], String(JSON.stringify(junk)));
  }
});

test('заметки как список записей (так их отдаёт GitHub): читаются пункты из всех, строка-разделитель не нужна', () => {
  const notes = [{ version: '1.0.0', note: '- 🧹 **Первое** — раз' }, { version: '1.0.1', note: '- 🗑️ **Второе** — два' }];
  assert.deepEqual(UpdateNotes.parse(notes, 'ru').map((i) => i[1]), ['Первое', 'Второе']);
});

test('пунктов не больше разумного и текст не бесконечный: огромная заметка не раздувает окно', () => {
  const many = Array.from({ length: 80 }, (_, i) => `- 🔹 **Пункт ${i}** — ${'очень длинный текст '.repeat(100)}`).join('\n');
  const items = UpdateNotes.parse(many, 'ru');
  assert.equal(items.length, 30);
  assert.ok(items.every((i) => i[2].length <= 1500));
  assert.ok(items[0][2].endsWith('…'));
});

test('без обработчика модулей скрипт подключается как обычный: кладёт себя в window.UpdateNotes', () => {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(src('renderer/updatenotes.js'), 'utf8'), sandbox);
  assert.equal(typeof sandbox.window.UpdateNotes.parse, 'function');
  assert.equal(typeof sandbox.window.UpdateNotes.render, 'function');
});
