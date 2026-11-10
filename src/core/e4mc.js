// Мод e4mc открывает мир в интернет и пишет об этом в лог игры. Хостов e4mc в логе несколько: сначала служебный
// broker.e4mc.link («broker req: …»), потом ретранслятор вроде eu.e4mc.link и только потом адрес самого мира
// (unequal-cofounder.eu.e4mc.link). Другу нужен последний, к первым двум подключиться нельзя.

// Строка самого мода, от языка игры не зависит: «Domain assigned: unequal-cofounder.eu.e4mc.link»
const ASSIGNED = /\bDomain assigned: ((?:[a-z0-9-]+\.)+e4mc\.link)\b/i;
// То же в чате («Local game hosted on domain [unequal-cofounder.eu.e4mc.link]»): для версий мода без строки выше
const HOST = /\b((?:[a-z0-9-]+\.)+e4mc\.link)\b/gi;
// Служебные хосты и ретрансляторы по регионам (eu, de, usw): это не адрес мира
const SERVICE = /^(?:broker|natives|test|api|www|[a-z]{2,3})\.e4mc\.link$/i;
const ATTEMPT = /\/INFO\]: broker req: /; // мод идёт к брокеру: началась новая попытка открыть мир
const FAILED = /\/ERROR\]: error in e4mc\b/; // в чате то же самое, но на языке игры, а строка лога от языка не зависит

function chatHost(line) {
  if (!line.includes('[CHAT]')) return null;
  for (const m of line.matchAll(HOST)) if (!SERVICE.test(m[1])) return m[1];
  return null;
}

// Разбирает строки лога игры по одной. address(адрес) — мир открыт, failed() — мод не достучался до своего сервера
function watcher({ address, failed }) {
  let shared = null; // последний выданный адрес
  let assigned = false; // мод сам назвал домен: чату больше не верим, там может быть чужое сообщение
  let noted = false; // об ошибке в этой попытке уже сказали
  return (line) => {
    if (ATTEMPT.test(line)) {
      shared = null;
      noted = false;
    }
    const m = ASSIGNED.exec(line);
    if (m) assigned = true;
    const host = m ? m[1] : assigned ? null : chatHost(line);
    if (host && host !== shared) {
      shared = host;
      address(host);
    }
    if (!noted && FAILED.test(line)) {
      noted = true;
      failed();
    }
  };
}

module.exports = { watcher };
