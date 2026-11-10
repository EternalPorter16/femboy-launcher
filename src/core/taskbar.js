// Полоска прогресса на значке лаунчера в панели задач: загрузки и подготовка к запуску видны, даже когда окно свёрнуто или закрыто в трей.
// Сам вывод — apply(значение 0…1 или -1, режим), его даёт главный процесс (window.setProgressBar); здесь только решение, что показывать:
// последнее, что обновилось, а когда оно закончилось — предыдущее; проценты округляются до целых, и то же состояние второй раз не отправляется
const CLEAR = { value: -1, mode: 'none' };
const INDETERMINATE = { value: 1, mode: 'indeterminate' }; // у статуса («Проверяю файлы…») процента нет: бегущая полоска

// Состояние полоски по проценту из события загрузки
function stateOf(percent) {
  if (typeof percent !== 'number' || !Number.isFinite(percent)) return INDETERMINATE;
  return { value: Math.round(Math.min(100, Math.max(0, percent))) / 100, mode: 'normal' };
}

function create({ apply }) {
  const active = new Map(); // дело → его состояние; порядок вставки = от давнего обновления к свежему
  let shown = CLEAR;
  const show = (next) => {
    if (next.value === shown.value && next.mode === shown.mode) return;
    try {
      apply(next.value, next.mode);
      shown = next;
    } catch {} // окно уже закрыто или недоступно: загрузке это не мешает, а следующее событие попробует снова
  };
  const refresh = () => show([...active.values()].at(-1) || CLEAR);
  const update = (key, percent) => {
    active.delete(key); // обновившееся уходит в конец: показывается оно
    active.set(key, stateOf(percent));
    refresh();
  };
  const end = (key) => {
    if (active.delete(key)) refresh();
  };
  return {
    task: (percent) => update('task', percent),
    taskEnd: () => end('task'),
    launch: (id, percent) => update(`launch:${id}`, percent),
    launchEnd: (id) => end(`launch:${id}`),
    clear() {
      active.clear();
      refresh();
    },
  };
}

module.exports = { create, stateOf };
