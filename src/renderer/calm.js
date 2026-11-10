// Спящий режим анимаций. Бесконечные анимации (фон, котик, пейзаж в карточке) держат 60 кадров в секунду и в простое
// съедают 35–60% ядра. Пока лаунчер не нужен — окно не в фокусе или ничего не трогали — ставим их на паузу, любое
// движение мыши или клавиша будит. Полосы загрузки и «скелетоны» не трогаем: по ним видно, что лаунчер не завис.
const Calm = (() => {
  const IDLE = 45000; // в фокусе, но ничего не нажимали и не двигали мышью
  const IDLE_ECO = 12000; // экономный режим засыпает быстрее
  const UNFOCUSED = 3000; // окно потеряло фокус: ушли в игру или другую программу
  const root = document.documentElement;
  let asleep = false;
  let eco = false;
  let last = Date.now(); // когда человек в последний раз что-то делал
  let held = []; // что мы остановили (и должны запустить обратно)
  const watchers = new Set(); // те, у кого свой цикл отрисовки (3D-скин): им тоже пора отдохнуть
  const tell = () => watchers.forEach((fn) => fn(asleep));

  const keep = (a) => !!a.effect?.target?.closest?.('.bar, .skeleton');
  const running = () => document.getAnimations().filter((a) => a.playState === 'running' && a.effect?.getComputedTiming().iterations === Infinity && !keep(a));

  function sleep() {
    if (asleep) return;
    asleep = true;
    root.dataset.calm = '';
    held = running();
    held.forEach((a) => a.pause());
    tell();
  }
  function wake() {
    last = Date.now();
    if (!asleep) return;
    asleep = false;
    delete root.dataset.calm;
    // Отменённые за время сна анимации (элемент перерисовали) не трогаем: они «воскреснут» уже без стиля
    held.forEach((a) => a.playState === 'paused' && a.play());
    held = [];
    tell();
  }

  // Раз в пару секунд решаем, пора ли спать; во сне заодно останавливаем то, что успело начать крутиться (новые элементы)
  setInterval(() => {
    if (document.hidden) return; // свёрнутое окно Chromium усыпляет сам
    const limit = document.hasFocus() ? (eco ? IDLE_ECO : IDLE) : UNFOCUSED;
    if (Date.now() - last < limit) return;
    if (!asleep) return sleep();
    for (const a of running()) (a.pause(), held.push(a));
  }, 2000);

  // Мышь шлёт события часто — на бодрствующем лаунчере просто помечаем время, будить нужно только спящий
  const touch = () => (asleep ? wake() : (last = Date.now()));
  // Во время перетаскивания файла из проводника мышь событий не шлёт — тогда будят dragenter/dragover
  for (const e of ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart', 'dragenter', 'dragover']) document.addEventListener(e, touch, { passive: true, capture: true });
  window.addEventListener('focus', wake);
  document.addEventListener('visibilitychange', () => !document.hidden && wake());

  return {
    setEco: (on) => (eco = !!on),
    // fn(asleep) вызывается при каждой смене состояния и сразу, чтобы подхватить текущее; возвращает «отписаться»
    watch: (fn) => (watchers.add(fn), fn(asleep), () => watchers.delete(fn)),
    wake,
    sleep,
    get asleep() {
      return asleep;
    },
  };
})();
