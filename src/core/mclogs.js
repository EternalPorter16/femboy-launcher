// Поделиться логом через mclo.gs: сайт хранит лог по ссылке, его удобно показать тому, кто помогает разобраться.
// Перед отправкой текст проходит очистку (токены, пути с именем пользователя, почта, адреса серверов). Сам по себе
// ничего не отправляется: вызывается только по кнопке и после подтверждения
const net = require('./net');
const scrub = require('./scrub');

let API = 'https://api.mclo.gs';
const configure = ({ api } = {}) => {
  if (api) API = api;
};
// Для разработки: свой сервер вместо mclo.gs. В собранном приложении переменная игнорируется
try {
  if (process.env.FEMBOY_MCLOGS_TEST_SERVER && !require('electron').app?.isPackaged) configure({ api: process.env.FEMBOY_MCLOGS_TEST_SERVER });
} catch {}

const MAX_LINES = 25000; // пределы mclo.gs: сайт сам обрезает лишнее, но лучше резать самим и оставить начало и конец
const MAX_BYTES = 10 * 1024 * 1024;
const HEAD = 1000;

function prepare(text) {
  let lines = scrub.text(text).split(/\r?\n/);
  if (lines.length > MAX_LINES) {
    const head = lines.slice(0, HEAD);
    const tail = lines.slice(-(MAX_LINES - HEAD - 1));
    lines = [...head, `… срезано строк: ${lines.length - head.length - tail.length} …`, ...tail];
  }
  let out = lines.join('\n');
  // Огромные строки: оставляем конец, он важнее
  if (Buffer.byteLength(out) > MAX_BYTES) out = out.slice(-Math.floor(MAX_BYTES / 4));
  return out;
}

// → { url, id }
async function upload(text, source = 'Femboy Launcher') {
  const content = prepare(String(text || ''));
  if (!content.trim()) throw new Error('Лог пустой — отправлять нечего');
  const cancel = net.cancelSignal();
  let res;
  try {
    res = await net.netFetch(`${API}/1/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ content, source }),
      signal: AbortSignal.any([AbortSignal.timeout(30000), cancel].filter(Boolean)),
    });
  } catch (e) {
    if (cancel?.aborted) throw new net.Cancelled();
    throw new Error(`Нет связи с mclo.gs (${e.cause?.code || e.message})`);
  }
  let json = null;
  try {
    json = await res.json();
  } catch {}
  if (!res.ok || !json?.success || !json.url) throw new Error(`mclo.gs не принял лог: ${json?.error || 'HTTP ' + res.status}`);
  return { url: json.url, id: json.id };
}

module.exports = { upload, prepare, configure };
