// Мир, открытый для друзей, живёт от «Открыть для сети» до выхода из мира. Следим за ним по строкам лога игры (они одинаковы
// на любом языке игры) и по сигналу мода e4mc, чтобы убрать за миром белый список: друзья не должны заходить в каждый следующий мир сами

// Мир открыт по сети: «Published LAN server on port N» (новые версии), «Started serving on N» (1.14–1.21), «Started on N» (старые);
// у Forge перед двоеточием стоит ещё и название класса: «[Server thread/INFO] [minecraft/IntegratedServer]: …»
// В скобках порт: он нужен адресам для входа по сети (core/lanaddress.js)
const OPEN = /\]: (?:Published LAN server on port|Started serving on|Started on) (\d+)\s*$/;
const START = /\]: Starting integrated minecraft server version\b/;
// Остановка мира. Слова игроков в чате («<ник> Stopping server») и строка «Stopping singleplayer server…» сюда не подходят
const STOP = /\[Server thread\/INFO\](?: \[[^\]]*\])?: Stopping server\s*$/;

// Разбирает строки лога игры по одной. started() — начался мир (одиночный, с открытием по сети или без), opened() — мир открыли по сети,
// stopped() — закрыли мир, который был открыт. Сбой в обработчике разбор не роняет.
// feed.markOpen() — «мир открыт» по другому признаку (мод e4mc выдал адрес)
function watcher({ opened, stopped, started } = {}) {
  let open = false;
  const tell = (fn) => {
    try {
      fn?.();
    } catch {}
  };
  const markOpen = () => {
    if (open) return;
    open = true;
    tell(opened);
  };
  const feed = (line) => {
    const s = String(line);
    if (START.test(s)) {
      open = false; // новый мир: прежний давно закрыт, даже если его строку остановки не увидели
      tell(started);
    } else if (OPEN.test(s)) markOpen();
    else if (STOP.test(s) && open) {
      open = false;
      tell(stopped);
    }
  };
  feed.markOpen = markOpen;
  Object.defineProperty(feed, 'isOpen', { get: () => open });
  return feed;
}

// Очистка за миром. clear() чистит файл и отвечает { cleared, names }; enabled() — включена ли очистка (настройку читаем каждый раз:
// её могли переключить, пока шла игра); cleared({ why, cleared, names }) — что-то убрано; failed(ошибка, why) — очистить не вышло.
// why: 'world' — закрыт мир, открытый для друзей, 'exit' — закрыта игра (там, где мир не закрылся сам: вылет)
// started() и opened() — для других дел при начале мира и при открытии по сети (копия мира перед друзьями)
function session({ clear, enabled = () => true, cleared = () => {}, failed = () => {}, started, opened }) {
  const wipe = (why) => {
    if (!enabled()) return;
    try {
      const r = clear();
      if (r?.cleared) cleared({ ...r, why });
    } catch (e) {
      failed(e, why);
    }
  };
  const feed = watcher({ started, opened, stopped: () => wipe('world') });
  return {
    line: feed,
    opened: feed.markOpen,
    exited: () => wipe('exit'),
    get isOpen() {
      return feed.isOpen;
    },
  };
}

module.exports = { watcher, session, START, STOP, OPEN };
