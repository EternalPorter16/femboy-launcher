// Картинки из окна (например, «Итоги недели»): окно присылает холст как PNG в data-URL. Сюда он попадает через проверку «это целый PNG
// не больше 16 МБ», и только проверенные байты идут в файл или в буфер обмена. Окно выбора места подставляет main.js
const fsx = require('./fsx');

const HEAD = Buffer.from('89504e470d0a1a0a', 'hex'); // подпись PNG
const TAIL = Buffer.from('0000000049454e44ae426082', 'hex'); // последний блок IEND: по нему видно, что файл не обрезан
const MAX_BYTES = 16 * 1024 * 1024;

// Возвращает байты PNG или бросает понятную ошибку. Принимает и data-URL холста, и голый base64
function decodePng(data) {
  const raw = typeof data === 'string' ? data.replace(/^data:image\/png;base64,/i, '') : '';
  if (raw.length > Math.ceil(MAX_BYTES / 3) * 4) throw new Error('Картинка слишком большая');
  if (!raw || raw.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) throw new Error('Картинка не получена');
  const buf = Buffer.from(raw, 'base64');
  if (buf.length > MAX_BYTES) throw new Error('Картинка слишком большая');
  if (buf.length < HEAD.length + TAIL.length || !buf.subarray(0, HEAD.length).equals(HEAD) || !buf.subarray(-TAIL.length).equals(TAIL)) throw new Error('Это не PNG-картинка');
  return buf;
}

// pick(имя) → путь, который выбрал человек, или пустое, если окно закрыли. Возвращает путь файла (с .png) или null
async function save(data, { name, pick }) {
  const png = decodePng(data);
  const chosen = await pick(name);
  if (!chosen) return null;
  const file = /\.png$/i.test(chosen) ? chosen : `${chosen}.png`;
  try {
    fsx.writeFileAtomic(file, png);
  } catch (e) {
    throw new Error(`Не удалось сохранить картинку: ${e.message}`);
  }
  return file;
}

module.exports = { decodePng, save, MAX_BYTES };
