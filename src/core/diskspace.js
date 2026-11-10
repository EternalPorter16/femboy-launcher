// Хватит ли места на диске перед большой загрузкой. Без проверки игра упала бы на середине скачивания с непонятной ошибкой записи,
// оставив недокачанные файлы; так человек сразу узнаёт, сколько нужно и что с этим делать
const fs = require('fs');
const path = require('path');

const SPARE = 200 * 1048576; // запас: часть файлов потом распаковывается, да и самой системе место нужно
const fmtSize = (b) => (b >= 1073741824 ? (b / 1073741824).toFixed(1) + ' ГБ' : Math.max(1, Math.round(b / 1048576)) + ' МБ');

// Сколько байт свободно на диске, где лежит (или будет лежать) dir; null — система не ответила
async function free(dir) {
  let d = path.resolve(dir);
  while (!fs.existsSync(d)) {
    const up = path.dirname(d);
    if (up === d) break;
    d = up; // папки ещё нет — смотрим диск по ближайшей существующей выше
  }
  try {
    const st = await fs.promises.statfs(d);
    return Number(st.bavail) * Number(st.bsize);
  } catch {
    return null;
  }
}

// Бросает понятную ошибку, если для need байт (и запаса) не хватает места. Нечего качать или узнать место не вышло — не мешаем
async function ensure(dir, need) {
  if (!(need > 0)) return;
  const have = await free(dir);
  if (have === null) return;
  const want = need + SPARE;
  if (have < want) {
    throw new Error(`На диске не хватает места для загрузки: нужно около ${fmtSize(want)}, свободно ${fmtSize(have)}. Освободи место (Настройки → «Место и переезд» → «Освободить место») и запусти снова`);
  }
}

module.exports = { free, ensure, fmtSize };
