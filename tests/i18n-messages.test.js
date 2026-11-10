// Сообщения, которые лаунчер собирает из кусков во время работы (уведомления из main.js, подписи в окнах): по-английски в них не должно
// оставаться русских слов. Строки берутся из самих файлов, а не переписываются в тесте: изменишь текст в коде — проверка увидит его новым
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');
const { src } = require('./helpers');

// Переводчик из i18n.js на заглушках окна: язык английский, DOM не нужен
function english() {
  const body = { nodeType: 1, tagName: 'BODY', childNodes: [], getAttribute: () => null };
  const sandbox = { localStorage: { getItem: () => 'en', setItem() {} }, document: { readyState: 'complete', documentElement: {}, body, addEventListener() {} }, MutationObserver: class { observe() {} }, confirm: () => true };
  sandbox.window = sandbox;
  vm.runInNewContext(fs.readFileSync(src('renderer/i18n.js'), 'utf8'), sandbox);
  return sandbox.I18N;
}
const CYR = /[А-Яа-яЁё]/;
const read = (rel) => fs.readFileSync(src(rel), 'utf8');
// Шаблонная строка из файла: находит `…` по началу текста и подставляет значения вместо ${…}
function template(file, start, fill = {}) {
  const m = new RegExp('`(' + start + '[^`]*)`').exec(read(file));
  assert.ok(m, `в ${file} не нашлась строка «${start}…»`);
  return m[1].replace(/\$\{(\w+)\}/g, (_, name) => fill[name] ?? `<${name}>`);
}
const quoted = (file, start) => {
  const m = new RegExp("'(" + start + "[^']*)'").exec(read(file));
  assert.ok(m, `в ${file} не нашлась строка «${start}…»`);
  return m[1];
};

test('уведомление «Белый список очищен» из main.js переводится целиком, со списком ников внутри', () => {
  const en = english();
  const ru = template('main.js', 'Белый список очищен', { who: 'Bart_Awesome, PinkDick' });
  const out = en.tr(ru);
  assert.ok(!CYR.test(out), out);
  assert.match(out, /^Whitelist cleared: Bart_Awesome, PinkDick\./);
});

test('подсказка после «Подготовить», пока игра запущена, переводится целиком', () => {
  const en = english();
  const out = en.tr(quoted('renderer/app/friends.js', 'Игра уже запущена: '));
  assert.ok(!CYR.test(out), out);
});

test('сообщения про друзей (окно, главный процесс, список друзей) переводятся целиком, без русских слов', () => {
  const en = english();
  const fill = { nick: 'PinkCat_', n: 'PinkCat_', who: 'PinkCat_, Alex_', MAX: '50' };
  const msgs = [
    template('renderer/app/friends.js', 'Лицензионного аккаунта «', fill),
    template('renderer/app/friends.js', 'Не смогла проверить, есть ли лицензия у «', fill),
    template('renderer/app/friends.js', 'Лицензионного аккаунта нет у ', { 'r.noLicense.join\\(\', \'\\)': 'x' }).replace(/\$\{[^}]*\}/g, 'PinkCat_, Alex_'),
    template('renderer/app/friends.js', 'Не смогла узнать UUID у \\$\\{r.unchecked', {}).replace(/\$\{[^}]*\}/g, 'PinkCat_'),
    template('core/friends.js', '«\\$\\{n\\}» уже есть в списке друзей', fill),
    template('core/friends.js', 'В списке друзей не больше ', fill),
    template('core/friends.js', 'Ник «\\$\\{n\\}»: 3–16 символов', fill),
    quoted('core/friends.js', 'Такого друга нет в списке'),
    template('main.js', 'У \\$\\{n.nick\\} нет лицензионного аккаунта', {}).replace(/\$\{[^}]*\}/g, 'PinkCat_'),
    template('main.js', 'Не смогла узнать UUID у \\$\\{n.nick\\}', {}).replace(/\$\{[^}]*\}/g, 'PinkCat_'),
  ];
  for (const m of msgs) {
    const out = en.tr(m);
    assert.ok(!CYR.test(out), `не переведено: ${m} → ${out}`);
  }
});

test('уведомления о том, что друг зашёл в мир или вышел, и строка «кто в мире» переводятся целиком', () => {
  const en = english();
  const who = { joined: 'PinkCat_', left: 'PinkCat_' };
  assert.equal(en.tr(template('main.js', '\\$\\{joined\\} заходит в мир', who)), 'PinkCat_ joins the world ♡');
  assert.equal(en.tr(template('main.js', '\\$\\{left\\} выходит из мира', who)), 'PinkCat_ leaves the world');
  assert.equal(en.tr('Сейчас в мире: '), 'In the world now: ');
  assert.equal(en.tr(quoted('renderer/app/friends.js', 'Пока никто не зашёл')), 'Nobody has joined yet');
});

test('сообщения про копию мира перед друзьями (главный процесс) переводятся целиком, с названием мира внутри', () => {
  const en = english();
  const fill = { r: 'Мой мир' };
  const msgs = [
    template('main.js', 'Сохранила копию мира «', { 'r.world': 'Мой мир' }).replace(/\$\{[^}]*\}/g, 'Мой мир'),
    template('main.js', 'Копия мира «', { 'r.world': 'Мой мир' }).replace(/\$\{[^}]*\}/g, 'Мой мир'),
    template('main.js', 'Копия мира перед друзьями не сохранилась', fill).replace(/\$\{[^}]*\}/g, 'ENOSPC'),
  ];
  for (const m of msgs) {
    const out = en.tr(m);
    assert.ok(!CYR.test(out.replace('Мой мир', '')), `не переведено: ${m} → ${out}`);
  }
  assert.match(en.tr(msgs[0]), /^Saved a copy of the world “Мой мир” before it is opened to friends ♡$/);
});

test('строка консоли про отключённый прокси для игры и строка про порт открытого мира переводятся целиком', () => {
  const en = english();
  const off = en.tr(quoted('core/game.js', 'Прокси лаунчера для игры отключён'));
  assert.equal(off, 'The launcher’s proxy for the game is turned off in the settings');
  const port = template('main.js', 'Мир открыт по сети на порту', { port: '61223' }).replace(/\$\{[^}]*\}/g, '192.168.1.5:61223 (Wi-Fi)');
  assert.ok(!CYR.test(en.tr(port)), `не переведено: ${port} → ${en.tr(port)}`);
  assert.match(en.tr('Мир открыт по сети на порту 61223'), /^The world is open on the network on port 61223$/);
  assert.match(en.tr('Мир открыт по сети на порту 61223. Другу в той же сети или VPN: 192.168.1.5:61223 (Wi-Fi)'), /^The world is open on the network on port 61223\. For a friend on the same network or VPN: 192\.168\.1\.5:61223 \(Wi-Fi\)$/);
});

test('строка консоли про сбой «последнего удачного запуска» и хвост «и ещё N» из окна вылета переводятся целиком', () => {
  const en = english();
  const ru = template('core/game.js', 'Точка восстановления «последний удачный запуск» не сохранилась').replace(/\$\{[^}]*\}/g, 'disk full');
  assert.equal(en.tr(ru), 'The “last successful launch” restore point wasn’t saved: disk full');
  assert.equal(en.tr('и ещё 3'), 'and 3 more');
  // название точки, которое попадает в уведомление «Вернула «…» ✧», тоже переводится
  assert.equal(en.tr('Вернула «Последний удачный запуск» ✧'), 'Restored “Last successful launch” ✧');
});

test('«Войти к другу»: сообщения кода сборки, сверки и установки (главный процесс и окно) переводятся целиком, без русских слов', () => {
  const en = english();
  const fillAll = (s, values) => s.replace(/\$\{[^}]*\}/g, () => values.shift());
  const msgs = [
    template('core/modcode.js', 'Код обрезан', { n: '12' }),
    quoted('core/modcode.js', 'Это не код сборки'),
    quoted('core/modcode.js', 'Этот код сделан более новой версией'),
    quoted('core/modcode.js', 'Код слишком большой'),
    quoted('core/modcode.js', 'Код повреждён'),
    ...['формат', 'версия кода', 'версия игры', 'загрузчик', 'версия загрузчика', 'список модов', 'чужие файлы', 'содержимое'].map((what) => template('core/modcode.js', 'В коде сборки что-то не так', { what })),
    quoted('core/modcode.js', 'Нет связи с Modrinth'),
    fillAll(template('core/modcode.js', 'Modrinth ответил ошибкой'), ['503']),
    fillAll(template('core/modcode.js', 'У друга Minecraft', { name: 'MyPack' }), ['1.20.1', 'Ванилла', '1.21.1', 'Fabric']),
    fillAll(template('core/modcode.js', 'Файл «'), ['a.jar']),
    quoted('core/modcode.js', 'Файл мода отдаётся не по https'),
    quoted('core/modcode.js', 'В тексте нет ни адреса'),
    quoted('core/modcode.js', 'В тексте нет кода сборки'),
    quoted('core/modcode.js', 'Перед установкой модов друга'),
    quoted('main.js', 'Выбери сборку'),
    quoted('main.js', 'Собираю код сборки'),
    quoted('main.js', 'Сверяю моды с Modrinth'),
    ...['Ставлю', 'Заменяю', 'Включаю'].map((verb) => `${quoted('core/modcode.js', verb)} Delta (2 / 5)…`),
    quoted('renderer/app/join.js', 'Адрес и код сборки скопированы'),
    quoted('renderer/app/join.js', 'Код сборки скопирован'),
    quoted('renderer/app/join.js', 'Эта сборка уже запущена'),
    fillAll(template('renderer/app/join.js', 'Не с Modrinth'), ['2']),
    fillAll(template('renderer/app/join.js', 'Моды не с Modrinth'), ['a.jar, b.jar']),
    'Готово: поставлено 3, заменено 1, включено 2',
    'Готово: поставлено 3, заменено 1, включено 2, не вышло 1',
    '➕ Новая сборка как у друга · 1.20.1 · Ванилла',
  ];
  for (const m of msgs) {
    const out = en.tr(m);
    assert.ok(!CYR.test(out.replace('MyPack', '')), `не переведено: ${m} → ${out}`);
  }
  assert.equal(en.tr('Готово: поставлено 3, заменено 1, включено 2, не вышло 1'), 'Done: installed 3, replaced 1, switched on 2, failed 1');
  assert.equal(en.tr('➕ Новая сборка как у друга · 1.20.1 · Ванилла'), '➕ New instance like your friend’s · 1.20.1 · Vanilla');
  assert.match(en.tr(fillAll(template('core/modcode.js', 'У друга Minecraft', { name: 'MyPack' }), ['1.20.1', 'Ванилла', '1.21.1', 'Fabric'])), /^The friend has Minecraft 1\.20\.1 · Vanilla, but “MyPack” is 1\.21\.1 · Fabric: /);
  // сводка в окне собирается из таких кусков: они должны остаться в исходнике, иначе перевод выше проверяет уже не то
  const join = read('renderer/app/join.js');
  for (const piece of ['`поставлено ${r.installed.length}`', '`заменено ${r.replaced.length}`', '`включено ${r.enabled.length}`', ', не вышло ${r.failed.length}']) assert.ok(join.includes(piece), piece);
});

test('значок «пора на новую версию?»: подпись с числами, подсказка и пояснение у выключателя переводятся целиком', () => {
  const en = english();
  assert.equal(en.tr('готовы 38 из 40 модов'), '38 of 40 mods ready');
  assert.equal(en.tr('готовы 1 из 41 мода'), '1 of 41 mods ready');
  const pieces = [
    read('renderer/app/home.js').match(/title="(Столько модов[^"]*)"/)?.[1],
    read('renderer/index.html').match(/>(Подсказывать, когда моды готовы[^<]*)<\/label>/)?.[1],
    read('renderer/index.html').match(/<p class="hint">(Раз в сутки лаунчер[^<]*)<\/p>/)?.[1],
  ];
  for (const p of pieces) {
    assert.ok(p, 'в исходнике не нашёлся текст значка или выключателя');
    assert.ok(!CYR.test(en.tr(p)), `не переведено: ${p} → ${en.tr(p)}`);
  }
  // подпись в карточке собирается из таких кусков: они должны остаться в исходнике, иначе перевод выше проверяет уже не то
  const home = read('renderer/app/home.js');
  assert.ok(home.includes('готовы ${r.ready} из ${r.total} ${plural(r.total,'), 'число и слово «модов» в одном тексте: так работает правило перевода');
});

test('сообщение «не хватает места для загрузки» переводится целиком, с цифрами внутри', () => {
  const en = english();
  const ru = template('core/diskspace.js', 'На диске не хватает места для загрузки').replace(/\$\{[^}]*\}/g, '300 МБ');
  const out = en.tr(ru);
  assert.ok(!CYR.test(out), out);
  assert.match(out, /^Not enough disk space for the download: about 300 MB needed, 300 MB free\./);
  assert.match(out, /“Free up space”/);
});

test('переводчик понимает сам себя: известная строка из словаря переводится, а русский текст без перевода остаётся как есть', () => {
  const en = english();
  assert.equal(en.tr('Играть'), 'Play');
  assert.equal(en.tr('такой строки в словаре нет'), 'такой строки в словаре нет');
});

test('сообщения про картинку итогов (проверка PNG, копирование, сохранение) переводятся целиком, причина ошибки остаётся как есть', () => {
  const en = english();
  const msgs = [
    quoted('core/imagesave.js', 'Картинка не получена'),
    quoted('core/imagesave.js', 'Картинка слишком большая'),
    quoted('core/imagesave.js', 'Это не PNG-картинка'),
    quoted('main.js', 'Не удалось скопировать картинку'),
  ];
  for (const m of msgs) assert.ok(!CYR.test(en.tr(m)), `не переведено: ${m} → ${en.tr(m)}`);
  const save = template('core/imagesave.js', 'Не удалось сохранить картинку: ').replace(/\$\{[^}]*\}/g, 'EACCES: permission denied');
  assert.equal(en.tr(save), 'Couldn’t save the picture: EACCES: permission denied');
});

test('значок «вышли обновления модов»: подпись с числом (по-русски три формы, по-английски две), подсказка с названиями и «и ещё N», «Что нового» и выключатель переводятся целиком', () => {
  const en = english();
  assert.equal(en.tr('1 обновление модов'), '1 mod update');
  assert.equal(en.tr('3 обновления модов'), '3 mod updates');
  assert.equal(en.tr('7 обновлений модов'), '7 mod updates');
  const title = template('renderer/app/home.js', 'Вышли обновления модов: ', { names: 'Sodium, Iris и ещё 3' });
  assert.equal(en.tr(title), 'Mod updates are out: Sodium, Iris and 3 more. Click to see what’s new and update');
  assert.equal(en.tr(template('renderer/app/home.js', 'Вышли обновления модов: ', { names: 'Sodium' })), 'Mod updates are out: Sodium. Click to see what’s new and update');
  assert.equal(en.tr('Что нового'), 'What’s new');
  const hint = fs.readFileSync(src('renderer/index.html'), 'utf8').match(/<p class="hint">(Раз в сутки лаунчер в фоне спрашивает у Modrinth, вышли ли новые версии модов[^<]*)<\/p>/);
  assert.ok(hint, 'пояснение к выключателю не нашлось в index.html');
  assert.ok(!CYR.test(en.tr(hint[1])), en.tr(hint[1]));
  assert.ok(!CYR.test(en.tr('Подсказывать, когда вышли обновления модов')));
});

test('«Одинаковые моды» в настройках: подсчёт, вопрос и итог (с пропущенными и без) переводятся целиком', () => {
  const en = english();
  assert.equal(en.tr('Одинаковых файлов: 3, освободится 12.5 МБ'), 'Identical files: 3, will free 12.5 MB');
  assert.equal(en.tr('Объединено файлов: 3, освобождено 12.5 МБ ♡'), 'Merged files: 3, freed 12.5 MB ♡');
  assert.equal(en.tr('Объединено файлов: 3, освобождено 12.5 МБ ♡ · пропущено: 2'), 'Merged files: 3, freed 12.5 MB ♡ · skipped: 2');
  const ask = en.tr('Объединить одинаковые моды (освободится 12.5 МБ)? Названия и содержимое файлов останутся прежними; у сборок, где идёт игра, моды не трогаются.');
  assert.ok(!CYR.test(ask), ask);
  for (const s of ['Сверяю моды…', 'Одинаковых модов нет ♡', 'Найти одинаковые моды', 'Объединить', 'Одинаковые моды']) assert.ok(!CYR.test(en.tr(s)), s);
  const html = read('renderer/index.html').match(/<p class="hint">(Один и тот же мод часто лежит[^<]*)<\/p>/)?.[1];
  assert.ok(html && !CYR.test(en.tr(html)), 'пояснение в настройках');
  const ui = read('renderer/app/settings.js');
  for (const piece of ['Одинаковых файлов: ${r.files}, освободится', 'Объединено файлов: ${r.linked}, освобождено', ' · пропущено: ${r.skipped}']) assert.ok(ui.includes(piece), piece);
});

test('«Следовать за сборкой друга»: галочка, подписи в окне, отметка на карточке и итог с «отключено» переводятся целиком', () => {
  const en = english();
  const box = read('renderer/app/join.js').match(/<span>(Следовать за сборкой друга[^<]*)<\/span>/)?.[1];
  assert.ok(box && !CYR.test(en.tr(box)), 'пояснение у галочки');
  for (const s of ['Отключу лишних', 'Есть у тебя, но нет у друга: отключу', 'Сделать как у друга', '👥 как у друга']) assert.ok(!CYR.test(en.tr(s)) || s.startsWith('👥') && en.tr(s).startsWith('👥 like'), s);
  assert.equal(en.tr('Готово: поставлено 3, заменено 1, включено 2, отключено 4'), 'Done: installed 3, replaced 1, switched on 2, switched off 4');
  assert.equal(en.tr('Готово: поставлено 0, заменено 0, включено 0, отключено 2, не вышло 1'), 'Done: installed 0, replaced 0, switched on 0, switched off 2, failed 1');
  const home = read('renderer/app/home.js').match(/title="\$\{esc\(`(Сборка следует за сборкой друга[^`]*)`\)\}"/)?.[1];
  assert.ok(home, 'подсказка карточки не нашлась');
  assert.ok(!CYR.test(en.tr(home.replace('${fmtDate(inst.follow.at)}', 'Oct 31'))), 'подсказка карточки (дата подставляется на языке окна)');
});

test('вопрос про .mrpack, открытый двойным щелчком, переводится целиком, с названием файла внутри', () => {
  const en = english();
  assert.equal(en.tr('Поставить модпак «Мой модпак.mrpack» как новую сборку?'), 'Install the modpack “Мой модпак.mrpack” as a new instance?');
});

test('импорт коллекции Modrinth: сообщения ядра, ход установки, название точки восстановления, пометки строк и подписи с числами переводятся целиком, названия проектов остаются как есть', () => {
  const en = english();
  const fillAll = (s, values) => s.replace(/\$\{[^}]*\}/g, () => values.shift());
  const ui = read('renderer/app/collection.js');
  const msgs = [
    quoted('core/collection.js', 'Коллекция не найдена'),
    quoted('core/collection.js', 'Не вижу ссылки на коллекцию Modrinth'),
    quoted('core/collection.js', 'Modrinth ответил не так, как ожидалось'),
    quoted('core/collection.js', 'Некорректный код коллекции'),
    quoted('core/collection.js', 'Не выбрана версия Minecraft для новой сборки'),
    quoted('core/collection.js', 'Из выбранного ничего поставить нельзя'),
    quoted('core/collection.js', 'Ничего не выбрано'),
    quoted('core/collection.js', 'такого проекта нет в этой коллекции'),
    quoted('core/collection.js', 'модпак в сборку так не ставится'),
    fillAll(template('core/collection.js', '\\$\\{p\\.type\\} в сборку так не ставится'), ['shader']),
    fillAll(template('core/collection.js', 'Ставлю «'), ['Sodium', '1', '3']),
    quoted('main.js', 'Перед импортом коллекции'),
  ];
  // подписи «мод / ресурспак…» и пометки «нет под эту версию…» лежат в двух словарях окна: берём их из исходника
  for (const name of ['CL_TYPE', 'CL_WHY']) {
    const found = [...new RegExp(`const ${name} = \\{([^}]*)\\}`).exec(ui)[1].matchAll(/'([^']*)'/g)].map((m) => m[1]);
    assert.ok(found.length >= 3, name);
    msgs.push(...found);
  }
  for (const m of msgs) {
    const out = en.tr(m);
    assert.ok(!CYR.test(out), `не переведено: ${m} → ${out}`);
  }
  assert.match(en.tr('Ставлю «Sodium» (1 / 3)…'), /^Installing .*Sodium.* \(1 \/ 3\)…$/);
  assert.equal(en.tr('Перед импортом коллекции'), 'Before importing a collection');
  assert.equal(en.tr('Не получилось поставить ничего: «Sodium» — такого проекта нет в этой коллекции; «Iris» — shader в сборку так не ставится'), 'Couldn’t install anything: “Sodium” — there’s no such project in this collection; “Iris” — shader can’t be put into an instance this way');
  // подписи с числами и названиями собираются в окне из таких кусков: они должны остаться в исходнике, иначе перевод ниже проверяет уже не то
  for (const piece of ['`Выбрано: ${ids.length}', ' · не подойдут: ${bad}', '`Поставить: ${ids.length}`', "plural(d.projects.length, 'проект', 'проекта', 'проектов')", 'удалено автором: ${d.missing}', 'показаны первые ${d.projects.length}, ещё ${d.truncated} не загружены', '`Создана сборка «${esc(r.instance.name)}»`', '`Готово: «${esc(r.instance.name)}»`', 'поставлено: ${r.installed.length}', 'Не вышло: ${r.failed.length}', '`Поставлено: ${r.installed.length} ♡`']) assert.ok(ui.includes(piece), piece);
  assert.ok(read('core/collection.js').includes('`Не получилось поставить ничего: ${failed.slice(0, 3)'));
  assert.equal(en.tr('Выбрано: 3 · не подойдут: 1'), 'Selected: 3 · won’t fit: 1');
  assert.equal(en.tr('Выбрано: 3'), 'Selected: 3');
  assert.equal(en.tr('Поставить: 2'), 'Install: 2');
  assert.equal(en.tr('1 проект'), '1 project');
  assert.equal(en.tr('3 проекта'), '3 projects');
  assert.equal(en.tr('5 проектов'), '5 projects');
  assert.equal(en.tr('удалено автором: 2'), 'removed by the author: 2');
  assert.equal(en.tr('показаны первые 300, ещё 41 не загружены'), 'showing the first 300, 41 more not loaded');
  assert.equal(en.tr('Создана сборка «Моя»'), 'Created instance “Моя”');
  assert.equal(en.tr('Готово: «Моя»'), 'Done: “Моя”');
  assert.equal(en.tr('поставлено: 4'), 'installed: 4');
  assert.equal(en.tr('Не вышло: 2'), 'Failed: 2');
  assert.equal(en.tr('Поставлено: 4 ♡'), 'Installed: 4 ♡');
  const tip = ui.match(/>(Для новой сборки подойдёт Minecraft [^<]*)<\/p>/)?.[1];
  assert.ok(tip, 'совет для новой сборки не нашёлся в исходнике');
  assert.equal(en.tr(fillAll(tip, ['1.21.1', 'Fabric', '7', '9'])), 'A new instance would fit Minecraft 1.21.1 · Fabric: 7 of 9 have a version for it');
  assert.equal(en.tr(fillAll(tip, ['1.21.1', 'Ванилла', '4', '4'])), 'A new instance would fit Minecraft 1.21.1 · Vanilla: 4 of 4 have a version for it');
});