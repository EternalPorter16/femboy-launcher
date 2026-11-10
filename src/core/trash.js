// Корзина сборок. «Удалить» не стирает сборку, а убирает её из списка: папка переезжает в <данные>/trash/<номер>, и пока лаунчер
// открыт, сборку можно вернуть целиком (миры, моды, настройки). Когда лаунчер закрывается, корзина очищается. Корзина лежит на том
// же диске, что и сборки, поэтому перенос туда и обратно мгновенный и не занимает места
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const store = require('./store');
const instances = require('./instances');
const fsx = require('./fsx');

const ID = /^[\w-]+$/;
const GONE = /^trash-gone-\d+$/; // корзина, переименованная при закрытии лаунчера и ещё не стёртая до конца
const root = () => path.join(store.baseDir(), 'trash');
const dirOf = (id) => path.join(root(), id);
const markOf = (id) => path.join(root(), `${id}.json`); // { deletedAt }: когда сборку удалили
const valid = (id) => typeof id === 'string' && ID.test(id);
const unlinkShared = (dir) => require('./otherlaunchers').unlinkShared(dir); // ссылки на папки других лаунчеров снимаем до стирания: их данные не наши

function has(id) {
  try {
    return valid(id) && fs.statSync(dirOf(id)).isDirectory();
  } catch {
    return false;
  }
}

// Понятная причина, если папку сборки не удалось переместить
function why(e) {
  return ['EPERM', 'EBUSY', 'EACCES'].includes(e?.code) ? 'её папка занята другой программой (Проводник, антивирус?) — закрой её и попробуй ещё раз' : e?.message || String(e);
}

// Сборка уходит в корзину. Список сборок после этого её не показывает; всё остальное (точки восстановления, облако) остаётся до окончательного удаления
function move(id) {
  const inst = instances.get(id); // нет такой сборки — ошибка
  fs.mkdirSync(root(), { recursive: true });
  if (fs.existsSync(dirOf(id))) throw new Error('Сборка с таким номером уже лежит в корзине');
  try {
    fsx.renameRetry(instances.dirOf(id), dirOf(id));
  } catch (e) {
    throw new Error(`Не получилось убрать сборку в корзину: ${why(e)}`);
  }
  const deletedAt = Date.now();
  try {
    fsx.writeJsonAtomic(markOf(id), { deletedAt });
  } catch {} // время нужно только для порядка в списке: без записи берётся время папки
  return { id, name: inst.name, deletedAt };
}

// Что лежит в корзине: новые сверху
function list() {
  let entries;
  try {
    entries = fs.readdirSync(root(), { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory() || !valid(e.name)) continue;
    const info = fsx.readJson(path.join(dirOf(e.name), 'instance.json')).data;
    if (!info || typeof info !== 'object') continue; // не сборка: не показываем и не трогаем
    let deletedAt = Number(fsx.readJson(markOf(e.name)).data?.deletedAt);
    if (!Number.isFinite(deletedAt) || deletedAt <= 0) {
      try {
        deletedAt = Math.round(fs.statSync(dirOf(e.name)).ctimeMs);
      } catch {
        deletedAt = Date.now();
      }
    }
    out.push({ id: e.name, name: info.name || e.name, version: info.version, loader: info.loader, icon: info.icon, color: info.color, iconUrl: info.iconUrl || null, playtime: info.playtime || 0, deletedAt });
  }
  return out.sort((a, b) => b.deletedAt - a.deletedAt);
}

// Вернуть сборку из корзины на прежнее место
function restore(id) {
  if (!has(id)) throw new Error('Такой сборки нет в корзине');
  if (fs.existsSync(instances.dirOf(id))) throw new Error('Сборка с таким номером уже есть — вернуть эту нельзя');
  try {
    fsx.renameRetry(dirOf(id), instances.dirOf(id));
  } catch (e) {
    throw new Error(`Не получилось вернуть сборку: ${why(e)}`);
  }
  fs.rmSync(markOf(id), { force: true });
  return instances.get(id);
}

// Стереть одну сборку навсегда. false — такой в корзине нет
function purge(id) {
  if (!has(id)) return false;
  unlinkShared(dirOf(id));
  fs.rmSync(dirOf(id), { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  fs.rmSync(markOf(id), { force: true });
  return true;
}

// Стереть всё, что лежит в корзине. Возвращает, сколько сборок стёрто
function purgeAll() {
  let n = 0;
  for (const i of list()) if (purge(i.id)) n++;
  try {
    unlinkShared(root());
    fs.rmSync(root(), { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); // и прочее лишнее
  } catch {}
  return n;
}

// Стирает папку отдельным процессом, который переживёт лаунчер: сборки бывают огромными, а окно не должно зависать при выходе.
// Процесс — системный cmd, а не сама программа: portable-версия после выхода стирает свою временную папку (с работающим «Femboy Launcher.exe»
// внутри она бы осталась), а установщик обновления не должен находить лишний запущенный процесс программы. Префикс \\?\ снимает предел
// в 260 знаков для глубоких папок (миры и ресурспаки бывают такими). Ссылки на чужие папки rd не раскрывает, их содержимое не трогает
function startDeleter(folder) {
  const abs = path.resolve(folder);
  const long = abs.startsWith('\\\\') ? abs : `\\\\?\\${abs}`;
  const child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"rd /s /q "${long}""`], { detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true });
  child.on('error', () => {}); // не запустился — недостёртое подберёт следующий запуск лаунчера (sweep)
  child.unref();
}

// Лаунчер закрывается: корзина очищается. Здесь папка только переименовывается (мгновенно), стирает её deleter. Возвращает новое имя папки;
// null — корзина была пуста
function retire(deleter = startDeleter) {
  let entries;
  try {
    entries = fs.readdirSync(root());
  } catch {
    return null;
  }
  if (!entries.length) return null;
  unlinkShared(root());
  let stamp = Date.now();
  while (fs.existsSync(path.join(store.baseDir(), `trash-gone-${stamp}`))) stamp++;
  const moved = path.join(store.baseDir(), `trash-gone-${stamp}`);
  fs.renameSync(root(), moved);
  deleter(moved);
  return moved;
}

// Запуск лаунчера: стираем то, что в прошлый раз не успели (процесс-удалитель могли прервать выключением компьютера).
// А сама корзина после аварийного закрытия остаётся как есть: сборки в ней можно вернуть
function sweep(deleter = startDeleter) {
  let names;
  try {
    names = fs.readdirSync(store.baseDir());
  } catch {
    return [];
  }
  const left = names.filter((n) => GONE.test(n)).map((n) => path.join(store.baseDir(), n));
  left.forEach((folder) => deleter(folder));
  return left;
}

module.exports = { move, list, has, restore, purge, purgeAll, retire, sweep, startDeleter };
