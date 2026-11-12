// «Код сборки»: короткий текст со списком модов хозяина. Друг вставляет его вместе с адресом мира, лаунчер сверяет моды со сборкой
// гостя, ставит точные версии с Modrinth (с проверкой хэша) и заходит на адрес. В код попадает только то, что нужно для сверки:
// версия игры, загрузчик, id версий Modrinth и, для модов не оттуда, имя файла с началом отпечатка. Ни путей, ни названия сборки, ни аккаунтов.
// Формат: FLM1:<число знаков>:<zlib(JSON) в base64>. Длина в заголовке нужна, чтобы найти конец кода в сообщении и заметить, что его обрезали.
// Целостность: поле h в JSON — начало SHA-256 содержимого. Своей суммы zlib (Adler-32) мало: на коротких данных она слепа к части
// изменений (например, +d/−2d/+d у соседних байтов или обмен кодов двух символов в таблице Хаффмана), и испорченный при копировании
// код мог распаковаться в другие id модов. Коды без h (от лаунчеров до этой правки) принимаются как раньше; старые лаунчеры
// поле h просто не читают, поэтому версия формата та же
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const instances = require('./instances');
const mods = require('./mods');
const { sha1File } = require('./origins');
const { getJson, postJson, download, pool, isNetworkError } = require('./net');

const MR = 'https://api.modrinth.com/v2';
const enc = encodeURIComponent;
const VERSION = 1;
const MAX_BODY = 60000; // знаков в теле кода
const MAX_JSON = 1 << 20; // байт после распаковки: маленький код не должен раздуваться в память
const MAX_MODS = 2000;
const MAX_OTHERS = 500;
const MAX_TEXT = 60000; // сколько вставленного текста разбираем
const LOADERS = ['vanilla', 'fabric', 'quilt', 'forge', 'neoforge'];
const LOADER_LABEL = { vanilla: 'Ванилла', fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge' };
const VERSION_RE = /^[\w.+-]{1,40}$/;
const ID_RE = /^[A-Za-z0-9]{8}$/;
const POINT_REASON = 'Перед установкой модов друга';

const fail = (code, message, extra) => Object.assign(new Error(message), { code, ...extra });
const byName = (a, b) => {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? -1 : x > y ? 1 : a < b ? -1 : a > b ? 1 : 0;
};
const chunks = (list, n) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));

/* ---------- адрес мира ---------- */

// Одно правило на лаунчер и окно: имя или IPv4 (с портом) либо IPv6 в скобках. Порт проверяется отдельно (1–65535)
const ADDRESS_RE = /^(?:[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?|\[[0-9A-Fa-f:.]{2,45}\])(?::\d{1,5})?$/;
const portOk = (s) => {
  const m = /:(\d{1,5})$/.exec(s);
  return !m || (Number(m[1]) >= 1 && Number(m[1]) <= 65535);
};
const isAddress = (s) => typeof s === 'string' && s.length <= 259 && ADDRESS_RE.test(s) && portOk(s);

// Расширения файлов, которые выглядят как «имя.домен» (sodium.jar), но адресом не являются
const FILE_EXT = /\.(jar|zip|json|txt|log|png|jpg|jpeg|gif|exe|toml|cfg|dat|mrpack|md|yml|yaml|disabled|part|bak|html|js)$/i;
const IS_E4MC = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.e4mc\.link(?::\d{1,5})?$/i;
const IS_IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?::\d{1,5})?$/;
const IS_IPV6 = /^\[[0-9A-Fa-f:.]{2,45}\](?::\d{1,5})?$/;
const IS_HOST = /^(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,24}(?::\d{1,5})?$/;

// Адрес в произвольном тексте: сначала e4mc, потом IP, потом IPv6, потом любое имя с доменом. Разбираем по словам, а не одним
// регулярным выражением по всему тексту: длинные слова без пробелов не должны вешать разбор
function findAddress(text) {
  const tokens = [];
  for (const m of String(text).matchAll(/[^\s"'`<>()*,;|!?]+/g)) {
    const t = m[0].replace(/^[_~]+|[_~.:]+$/g, '');
    if (t.length >= 3 && t.length <= 300) tokens.push(t);
  }
  const ipv4 = (t) => {
    const m = IS_IPV4.exec(t);
    return !!m && m.slice(1, 5).every((o) => Number(o) <= 255) && portOk(t);
  };
  const host = (t) => IS_HOST.test(t) && !FILE_EXT.test(t.replace(/:\d+$/, '')) && portOk(t);
  return tokens.find((t) => IS_E4MC.test(t) && portOk(t)) ?? tokens.find(ipv4) ?? tokens.find((t) => IS_IPV6.test(t) && portOk(t)) ?? tokens.find(host) ?? null;
}

/* ---------- формат кода ---------- */

// Разобранное содержимое → проверенное и упорядоченное. Годится и для того, что пришло из чужого текста, и для того, что собрали мы сами
function normalize(d) {
  const bad = (what) => fail('bad', `В коде сборки что-то не так (${what}) — попроси друга скопировать его заново`);
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw bad('формат');
  if (d.v !== VERSION) throw bad('версия кода');
  if (typeof d.mc !== 'string' || !VERSION_RE.test(d.mc)) throw bad('версия игры');
  if (!LOADERS.includes(d.l)) throw bad('загрузчик');
  if (d.lv != null && (typeof d.lv !== 'string' || !VERSION_RE.test(d.lv))) throw bad('версия загрузчика');
  const m = d.m ?? '';
  if (typeof m !== 'string' || m.length % 8 || m.length > 8 * MAX_MODS || !/^[A-Za-z0-9]*$/.test(m)) throw bad('список модов');
  const ids = [];
  for (let i = 0; i < m.length; i += 8) ids.push(m.slice(i, i + 8));
  const o = d.o ?? [];
  if (!Array.isArray(o) || o.length > MAX_OTHERS) throw bad('чужие файлы');
  const others = o.map((x) => {
    const ok = Array.isArray(x) && typeof x[0] === 'string' && typeof x[1] === 'string' && x[0].length >= 1 && x[0].length <= 120 && !/[\u0000-\u001f\u007f/\\]/.test(x[0]) && /^[0-9a-f]{16}$/.test(x[1]);
    if (!ok) throw bad('чужие файлы');
    return { name: x[0], hash: x[1] };
  });
  others.sort((a, b) => byName(a.name, b.name));
  return { mc: d.mc, loader: d.l, loaderVersion: d.lv ?? null, ids: [...new Set(ids)].sort(), others };
}

// Сумма содержимого кода: зависит только от значений полей, а не от порядка ключей в JSON
const HASH_LEN = 12; // 48 бит SHA-256
const digest = (d) => crypto.createHash('sha256').update(JSON.stringify([d.v, d.mc, d.l, d.lv ?? null, d.m ?? '', d.o ?? []])).digest('hex').slice(0, HASH_LEN);

// { mc, loader, loaderVersion, ids, others: [{ name, hash }] } → строка кода. Порядок файлов в папке на результат не влияет
function pack({ mc, loader, loaderVersion, ids, others }) {
  const ordered = [...new Set(ids)].sort();
  if (!ordered.every((i) => ID_RE.test(i))) throw fail('bad', 'Некорректный id версии');
  const sorted = [...others].sort((a, b) => byName(a.name, b.name));
  const data = { v: VERSION, mc, l: loader, ...(loaderVersion ? { lv: loaderVersion } : {}), m: ordered.join(''), ...(sorted.length ? { o: sorted.map((o) => [o.name, o.hash]) } : {}) };
  data.h = digest(data);
  normalize(JSON.parse(JSON.stringify(data))); // то, что не принял бы разбор, не выпускаем
  const body = zlib.deflateSync(Buffer.from(JSON.stringify(data)), { level: 9 }).toString('base64').replace(/=+$/, '');
  return `FLM${VERSION}:${body.length}:${body}`;
}

const TRUNCATED = (n) => `Код обрезан: не хватает ${n} знаков в конце. Скопируй сообщение друга целиком (длинные сообщения чаты иногда режут на части)`;
const CORRUPT = 'Код повреждён: при копировании что-то потерялось или изменилось. Попроси друга скопировать его заново';
const TOO_BIG = 'Код слишком большой — так выглядит не код сборки';

// Строка кода → { mc, loader, loaderVersion, ids, others }. Любая беда — ошибка с понятным текстом и полем code
// (foreign, newer, big, truncated, corrupt, bad)
function unpack(text) {
  const s = String(text ?? '').replace(/\s+/g, '');
  const m = /^FLM(\d+):(\d{1,7}):/.exec(s);
  if (!m || Number(m[1]) < VERSION) throw fail('foreign', 'Это не код сборки: он начинается с «FLM1:». Скопируй сообщение друга целиком');
  if (Number(m[1]) > VERSION) throw fail('newer', 'Этот код сделан более новой версией лаунчера — обнови лаунчер и вставь код снова');
  const n = Number(m[2]);
  if (n > MAX_BODY) throw fail('big', TOO_BIG);
  const rest = s.slice(m[0].length);
  if (rest.length < n) throw fail('truncated', TRUNCATED(n - rest.length), { missing: n - rest.length });
  const body = rest.slice(0, n);
  if (!n || !/^[A-Za-z0-9+/_-]+$/.test(body)) throw fail('corrupt', CORRUPT);
  let raw;
  try {
    raw = zlib.inflateSync(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64'), { maxOutputLength: MAX_JSON });
  } catch (e) {
    throw e.code === 'ERR_BUFFER_TOO_LARGE' ? fail('big', TOO_BIG) : fail('corrupt', CORRUPT);
  }
  let data;
  try {
    data = JSON.parse(raw.toString('utf8'));
  } catch {
    throw fail('bad', 'В коде сборки что-то не так (содержимое) — попроси друга скопировать его заново');
  }
  // Есть сумма — содержимое обязано ей соответствовать: иначе код испорчен, хотя zlib его и распаковал. Нет суммы — код старого лаунчера
  if (data && typeof data === 'object' && !Array.isArray(data) && Object.hasOwn(data, 'h') && (typeof data.h !== 'string' || data.h !== digest(data))) throw fail('corrupt', CORRUPT);
  return normalize(data);
}

// Сообщение друга целиком → { code, codeError, address }. Код ищется по заголовку и длине, поэтому переживает переносы строк,
// пробелы, кавычки и любые слова вокруг; обрезанный код не мешает найти адрес
function parseInvite(raw) {
  const text = String(raw ?? '').slice(0, MAX_TEXT);
  const out = { code: null, codeError: null, address: null };
  let rest = text;
  const m = /FLM(\d+):(\d{1,7}):/.exec(text);
  if (m) {
    const n = Number(m[2]);
    let i = m.index + m[0].length;
    if (n > MAX_BODY) out.codeError = { code: 'big', message: TOO_BIG };
    else {
      let body = '';
      while (i < text.length && body.length < n) {
        const ch = text[i];
        if (/\s/.test(ch)) {
          i++;
          continue;
        }
        if (!/[A-Za-z0-9+/_-]/.test(ch)) break;
        body += ch;
        i++;
      }
      if (body.length < n) out.codeError = { code: 'truncated', message: TRUNCATED(n - body.length), missing: n - body.length };
      else out.code = `FLM${m[1]}:${n}:${body}`;
    }
    rest = `${text.slice(0, m.index)} ${text.slice(i)}`;
  }
  out.address = findAddress(rest);
  return out;
}

/* ---------- Modrinth ---------- */

// Сеть и ответы сервера → понятные ошибки; «Отменить» проходит как есть
async function viaModrinth(fn) {
  try {
    return await fn();
  } catch (e) {
    if (e.cancelled) throw e;
    if (isNetworkError(e)) throw fail('offline', 'Нет связи с Modrinth — без неё моды не опознать и не скачать. Проверь интернет и попробуй ещё раз');
    if (e.status) throw fail('http', `Modrinth ответил ошибкой (HTTP ${e.status}) — попробуй позже`);
    throw e;
  }
}

// { sha1 → версия Modrinth } для файлов, которые там есть
async function versionsByHash(hashes) {
  const out = {};
  for (const part of chunks(hashes, 500)) Object.assign(out, await viaModrinth(() => postJson(`${MR}/version_files`, { hashes: part, algorithm: 'sha1' }, null, { timeoutMs: 25000, attempts: 3 })));
  return out;
}
async function versionsById(ids) {
  const out = new Map();
  for (const part of chunks(ids, 100)) for (const v of await viaModrinth(() => getJson(`${MR}/versions?ids=${enc(JSON.stringify(part))}`, null, { timeoutMs: 25000, attempts: 3 }))) out.set(v.id, v);
  return out;
}
async function projectsById(ids) {
  const out = new Map();
  for (const part of chunks(ids, 100)) for (const p of await viaModrinth(() => getJson(`${MR}/projects?ids=${enc(JSON.stringify(part))}`, null, { timeoutMs: 25000, attempts: 3 }))) out.set(p.id, p);
  return out;
}

// Моды сборки с отпечатками: [{ file, enabled, title, version, sha1 }]
async function hashedMods(instId) {
  const list = mods.list(instId);
  await pool(list, 4, async (m) => {
    m.sha1 = await sha1File(mods.filePath(instId, m.file));
  });
  return list;
}

/* ---------- хозяин ---------- */

// Код своей сборки. Нужна связь с Modrinth: id версий берутся оттуда по хэшам файлов; без связи кода, годного для установки, не получится
async function encode(instId) {
  const inst = instances.get(instId);
  const jars = (await hashedMods(instId)).filter((m) => m.enabled);
  const known = jars.length ? await versionsByHash(jars.map((j) => j.sha1)) : {};
  const ids = new Set();
  const others = [];
  for (const j of jars) {
    const v = known[j.sha1];
    if (v?.id && ID_RE.test(v.id)) ids.add(v.id);
    else others.push({ name: j.file.slice(0, 120), hash: j.sha1.slice(0, 16) });
  }
  const code = pack({ mc: inst.version, loader: inst.loader, loaderVersion: inst.loaderVersion || null, ids: [...ids], others });
  return { code, total: jars.length, modrinth: ids.size, others: others.map((o) => o.name).sort(byName) };
}

/* ---------- гость: сверка ---------- */

const primaryFile = (v) => v.files?.find((f) => f.primary) || v.files?.[0];
const sortBy = (list, key) => list.sort((a, b) => byName(String(a[key]), String(b[key])));

// Что у гостя не так, как у хозяина. instId = null — сборки ещё нет (будет создана «как у друга»): все моды недостающие.
// Результат — обычные данные: окно показывает списки, а установка берёт из них адреса файлов
async function compare(payload, instId) {
  const inst = instId ? instances.get(instId) : null;
  const jars = inst ? await hashedMods(instId) : [];
  const known = jars.length ? await versionsByHash(jars.map((j) => j.sha1)) : {};
  for (const j of jars) j.v = known[j.sha1] || null;
  const hostVersions = payload.ids.length ? await versionsById(payload.ids) : new Map();
  const projectIds = [...new Set([...hostVersions.values(), ...jars.map((j) => j.v).filter(Boolean)].map((v) => v.project_id))];
  const projects = projectIds.length ? await projectsById(projectIds) : new Map();
  const nameOf = (v) => projects.get(v.project_id)?.title || v.name || v.id;

  const used = new Set();
  const plan = { host: { mc: payload.mc, loader: payload.loader, loaderVersion: payload.loaderVersion, count: payload.ids.length + payload.others.length }, mine: null, mismatch: { version: false, loader: false, loaderVersion: false }, same: [], off: [], missing: [], other: [], manual: [], extra: [], todo: 0 };

  for (const id of payload.ids) {
    const v = hostVersions.get(id);
    if (!v) {
      plan.manual.push({ name: id, why: 'gone' }); // версию удалили с Modrinth
      continue;
    }
    const hashes = new Set((v.files || []).map((f) => f.hashes?.sha1).filter(Boolean));
    const same = jars.filter((j) => !used.has(j.file) && (hashes.has(j.sha1) || j.v?.id === id));
    const title = nameOf(v);
    const on = same.find((j) => j.enabled);
    const sibling = on ? null : jars.find((j) => j.enabled && !used.has(j.file) && j.v && j.v.project_id === v.project_id);
    const off = on || sibling ? null : same.find((j) => !j.enabled);
    if (on) {
      used.add(on.file);
      plan.same.push({ title, file: on.file, version: v.version_number });
    } else if (sibling) {
      // Включена другая версия этого мода (а нужная, возможно, лежит выключенной): заменяем включённую, иначе в игре окажется два одинаковых мода
      used.add(sibling.file);
      const f = primaryFile(v);
      plan.other.push({ title, file: sibling.file, mine: sibling.v.version_number, theirs: v.version_number, versionId: id, projectId: v.project_id, icon: projects.get(v.project_id)?.icon_url || null, url: f?.url, filename: f?.filename, sha1: f?.hashes?.sha1 });
    } else if (off) {
      used.add(off.file);
      plan.off.push({ title, file: off.file, version: v.version_number });
    } else {
      const f = primaryFile(v);
      plan.missing.push({ title, version: v.version_number, versionId: id, projectId: v.project_id, icon: projects.get(v.project_id)?.icon_url || null, url: f?.url, filename: f?.filename, sha1: f?.hashes?.sha1 });
    }
  }

  // Моды хозяина не с Modrinth: узнаём по началу отпечатка. Файл с тем же именем, но другим содержимым, — отдельное замечание
  for (const o of payload.others) {
    const hit = jars.filter((j) => !used.has(j.file) && j.sha1.startsWith(o.hash));
    const on = hit.find((j) => j.enabled);
    const off = on ? null : hit.find((j) => !j.enabled);
    if (on) {
      used.add(on.file);
      plan.same.push({ title: o.name, file: on.file, version: null });
    } else if (off) {
      used.add(off.file);
      plan.off.push({ title: o.name, file: off.file, version: null });
    } else plan.manual.push({ name: o.name, why: jars.some((j) => j.file === o.name) ? 'differs' : 'other' });
  }

  for (const j of jars) {
    if (!j.enabled || used.has(j.file)) continue;
    plan.extra.push({ title: j.title || (j.v && projects.get(j.v.project_id)?.title) || j.file, file: j.file, known: !!j.v });
  }
  for (const k of ['same', 'off', 'missing', 'other', 'extra']) sortBy(plan[k], 'title');
  sortBy(plan.manual, 'name');
  plan.todo = plan.missing.length + plan.other.length + plan.off.length;

  if (inst) {
    plan.mine = { mc: inst.version, loader: inst.loader, loaderVersion: inst.loaderVersion || null };
    plan.mismatch = {
      version: inst.version !== payload.mc,
      loader: inst.loader !== payload.loader && !(inst.loader === 'quilt' && payload.loader === 'fabric'), // Quilt запускает моды Fabric, обратное неверно
      loaderVersion: !!payload.loaderVersion && !!inst.loaderVersion && inst.loaderVersion !== payload.loaderVersion,
    };
  }
  return plan;
}

const mismatchMessage = (plan, name) =>
  `У друга Minecraft ${plan.host.mc} · ${LOADER_LABEL[plan.host.loader]}, а в «${name}» ${plan.mine.mc} · ${LOADER_LABEL[plan.mine.loader]}: моды друга под другую версию не подходят. Выбери сборку с такой же версией или создай новую «как у друга»`;

/* ---------- гость: установка ---------- */

// Имя файла из ответа сервера: только имя .jar без пути
function jarName(name) {
  if (typeof name !== 'string' || !name || path.basename(name) !== name || name.startsWith('.') || !name.endsWith('.jar') || /[\u0000-\u001f<>:"|?*]/.test(name) || name.length > 200) throw new Error('Некорректное имя файла');
  return name;
}

async function runJob(instId, dir, kind, it) {
  if (kind === 'off') {
    mods.setEnabled(instId, it.file, true);
    return;
  }
  const name = jarName(it.filename);
  if (typeof it.url !== 'string' || !/^https:\/\//i.test(it.url)) throw new Error('Файл мода отдаётся не по https — не скачиваю');
  const dest = path.join(dir, name);
  const busy = (kind === 'other' && name === it.file ? false : fs.existsSync(dest)) || (kind === 'missing' && fs.existsSync(`${dest}.disabled`));
  if (busy) throw new Error(`Файл «${name}» уже есть и отличается от нужного — убери его из папки mods и повтори`);
  await download(it.url, `${dest}.part`, { sha1: it.sha1 });
  if (kind === 'other') mods.remove(instId, it.file); // прежняя версия уходит вместе с записью о ней
  fs.rmSync(`${dest}.disabled`, { force: true }); // выключенная копия нужной версии не нужна: ставим включённую
  fs.rmSync(dest, { force: true });
  fs.renameSync(`${dest}.part`, dest);
  mods.record(instId, name, { source: 'modrinth', projectId: it.projectId, title: it.title, icon: it.icon || null, version: kind === 'other' ? it.theirs : it.version });
}

// Выполняет сверку: включает, заменяет и ставит. Сбой отдельного мода не останавливает остальные; «Отменить» останавливает всё.
// point(id, причина) вызывается один раз до первой правки (так сохраняется точка восстановления)
// follow: сборка следует за сборкой друга — моды, которых у друга нет, отключаются (не удаляются: вернуть можно включением или точкой восстановления)
async function execute(instId, plan, { progress = () => {}, point, follow = false } = {}) {
  const report = { installed: [], replaced: [], enabled: [], disabled: [], failed: [], manual: plan.manual };
  if (!plan.todo && !(follow && plan.extra.length)) return report;
  point?.(instId, POINT_REASON);
  const dir = mods.dir(instId);
  const jobs = [...plan.off.map((it) => ({ kind: 'off', it })), ...plan.other.map((it) => ({ kind: 'other', it })), ...plan.missing.map((it) => ({ kind: 'missing', it }))];
  const verb = { off: 'Включаю', other: 'Заменяю', missing: 'Ставлю' };
  const outcome = new Array(jobs.length);
  let done = 0;
  await pool(jobs, 3, async (job, i) => {
    progress(`${verb[job.kind]} ${job.it.title} (${i + 1} / ${jobs.length})…`, (done / jobs.length) * 100);
    try {
      await runJob(instId, dir, job.kind, job.it);
      outcome[i] = null;
    } catch (e) {
      if (e.cancelled) throw e;
      outcome[i] = e.message;
    }
    done++;
  });
  if (follow) {
    for (const x of plan.extra) {
      try {
        mods.setEnabled(instId, x.file, false);
        report.disabled.push(x.title);
      } catch (e) {
        report.failed.push({ title: x.title, error: e.message });
      }
    }
  }
  jobs.forEach(({ kind, it }, i) => {
    if (outcome[i]) report.failed.push({ title: it.title, error: outcome[i] });
    else if (kind === 'off') report.enabled.push(it.title);
    else if (kind === 'other') report.replaced.push({ title: it.title, from: it.mine, to: it.theirs });
    else report.installed.push(it.title);
  });
  return report;
}

// Ставит моды друга в существующую сборку: сверка заново (диск мог измениться), отказ при другой версии игры или загрузчике
async function apply(instId, payload, opts = {}) {
  const plan = await compare(payload, instId);
  if (plan.mismatch.version || plan.mismatch.loader) throw fail('mismatch', mismatchMessage(plan, instances.get(instId).name));
  const report = await execute(instId, plan, opts);
  if (opts.follow) markFollow(instId, plan);
  return report;
}

// Сборка запоминает, что следует за сборкой друга: на карточке появляется отметка, окно «Войти к другу» по умолчанию включает слежение
function markFollow(instId, plan) {
  instances.update(instId, { follow: { at: Date.now(), mods: plan.host.count } });
}

/* ---------- от вставленного текста до сборки ---------- */

// Ответ окну на «Сверить»: что нашлось в тексте (адрес, код) и сверка. Любая беда с кодом приходит как problem, а не ошибкой:
// адрес из того же текста всё равно пригодится
async function check(instId, text) {
  const inv = parseInvite(text);
  const out = { address: inv.address, plan: null, problem: null };
  if (inv.codeError) return { ...out, problem: { code: inv.codeError.code, message: inv.codeError.message } };
  if (!inv.code) return inv.address ? out : { ...out, problem: { code: 'empty', message: 'В тексте нет ни адреса, ни кода сборки' } };
  let payload;
  try {
    payload = unpack(inv.code);
  } catch (e) {
    if (!e.code) throw e;
    return { ...out, problem: { code: e.code, message: e.message } };
  }
  return { ...out, plan: await compare(payload, instId || null) };
}

function createInstance(p, base = 'Сборка друга') {
  const taken = new Set(instances.list().map((i) => i.name));
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${base} ${n}`;
  return instances.create({ name, version: p.mc, loader: p.loader, loaderVersion: p.loaderVersion });
}

// «Поставить как у друга»: target — id сборки или 'new' (создать сборку с версией игры и загрузчиком хозяина; opts.name — как её назвать).
// Ответ: итог установки и сборка
async function join(target, text, opts = {}) {
  const inv = parseInvite(text);
  if (inv.codeError) throw fail(inv.codeError.code, inv.codeError.message);
  if (!inv.code) throw fail('empty', 'В тексте нет кода сборки: вставь сообщение друга целиком');
  const payload = unpack(inv.code);
  if (target !== 'new') return { ...(await apply(target, payload, opts)), instance: instances.get(target) };
  const plan = await compare(payload, null); // сначала сверка: нет связи — ничего не создаём
  const inst = createInstance(payload, opts.name);
  try {
    const report = await execute(inst.id, plan, { progress: opts.progress, follow: opts.follow }); // сборка новая: точку восстановления делать не с чего
    if (opts.follow) markFollow(inst.id, plan);
    return { ...report, instance: instances.get(inst.id) };
  } catch (e) {
    instances.remove(inst.id); // сорвалось или отменили — пустая сборка не остаётся
    throw e;
  }
}

module.exports = { pack, unpack, parseInvite, isAddress, ADDRESS_RE, encode, compare, apply, check, join, POINT_REASON };
