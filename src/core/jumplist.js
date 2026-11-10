// Список переходов на значке лаунчера в панели задач (правый щелчок): последние сборки, запуск одним щелчком. Это ссылки на «Femboy Launcher.exe
// --launch=<id>», то же, что делает ярлык сборки на рабочем столе. Строится из списка сборок чистой функцией; обновляется не чаще, чем нужно
const cli = require('./cli');

const MAX = 6;
const DELAY = 2000; // изменения идут пачками (создали, переименовали, запустили): обновляем один раз после затишья
const T = {
  ru: { category: 'Недавние сборки', fallback: 'Сборка', loaders: { vanilla: 'Ванилла', fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge' } },
  en: { category: 'Recent instances', fallback: 'Instance', loaders: { vanilla: 'Vanilla', fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge' } },
};

// Название для меню Windows: без знаков управления и лишних пробелов, не длиннее n
const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim().slice(0, n);

// Только в установленной или portable-версии на Windows. При запуске из исходников (npm start, проверки интерфейса) список переходов у
// настоящей программы не трогаем: он общий для всех запусков с её идентификатором
const enabled = ({ platform, packaged, portable } = {}) => platform === 'win32' && !!(packaged || portable);

// Категории для app.setJumpList или null (список сбросить): нет сборок, нет пути к программе. Сначала недавно игравшие (по времени запуска),
// потом остальные по названию (по тому, что видно в меню); не больше max
function build(list, { exe, lang = 'ru', max = MAX } = {}) {
  if (!exe || !Array.isArray(list)) return null;
  const t = T[lang] || T.ru;
  const items = list
    .filter((i) => i && cli.parse([`--launch=${i.id}`]))
    .map((i) => ({ played: i.lastPlayed || 0, item: { type: 'task', program: exe, args: cli.args(i.id), iconPath: exe, iconIndex: 0, title: clean(i.name, 60) || t.fallback, description: clean(`${i.version} · ${t.loaders[i.loader] || i.loader}`, 120) } }))
    .sort((a, b) => b.played - a.played || a.item.title.localeCompare(b.item.title, 'ru'))
    .slice(0, max)
    .map((x) => x.item);
  return items.length ? [{ type: 'custom', name: t.category, items }] : null;
}

// Те же ссылки обычными «Задачами» (внизу списка): их Windows разрешает всегда, а свою категорию с названием не разрешает там, где выключены «недавние
// элементы» (настройка приватности или политика): ответ customCategoryAccessDeniedError. Тогда main.js показывает ссылки так
const asTasks = (cats) => (Array.isArray(cats) && cats.length ? [{ type: 'tasks', items: cats.flatMap((c) => c.items) }] : null);

// get() → категории (build), apply(категории) → ответ Windows ('ok' или название ошибки). Неудачный список не запоминается: в следующий раз пробуем снова.
// Любой сбой молчит: список переходов — удобство, а не повод ронять лаунчер
function scheduler({ get, apply, onResult, delay = DELAY }) {
  let timer = null;
  let last;
  const run = () => {
    timer = null;
    try {
      const cats = get();
      const key = JSON.stringify(cats);
      if (key === last) return;
      const result = apply(cats);
      onResult?.(result);
      if (result === 'ok') last = key;
    } catch {}
  };
  return {
    schedule() {
      clearTimeout(timer);
      timer = setTimeout(run, delay);
    },
    stop() {
      clearTimeout(timer);
      timer = null;
    },
  };
}

module.exports = { build, asTasks, enabled, scheduler, MAX };
