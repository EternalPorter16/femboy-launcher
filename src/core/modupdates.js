// Проверка и установка обновлений модов. Modrinth ищем по хэшу файла (работает и для модов,
// поставленных вручную), CurseForge — по сохранённому id проекта.
const fs = require('fs');
const os = require('os');
const path = require('path');
const modmeta = require('./modmeta');
const crypto = require('crypto');
const instances = require('./instances');
const mods = require('./mods');
const store = require('./store');
const curseforge = require('./curseforge');
const origins = require('./origins');
const packupdate = require('./packupdate');
const fsx = require('./fsx');
const { postJson, getJson, download, throwIfCancelled } = require('./net');

const MR = 'https://api.modrinth.com/v2';
const loadersFor = (loader) => (loader === 'quilt' ? ['quilt', 'fabric'] : [loader]);
// Имя файла приходит из ответа сайта: в путь его пускаем только если это просто имя файла (FL-SEC-06)
function validFilename(name) {
  return typeof name === 'string' && !!name && name !== '.' && name !== '..' && path.basename(name) === name && !/[\\/:*?"<>|\x00-\x1f]/.test(name);
}
const sha1 = (file) => crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');

const lastCheck = new Map(); // id сборки → найденные обновления (ставим только то, что нашли сами)

// «Что нового» из описания версии на Modrinth (markdown и немного HTML) — простым текстом для окна: без разметки, картинок и ссылок
// (ссылки остаются подписью), списки с точками, не больше 14 строк и max знаков. Окно показывает его как текст, а не как разметку
const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };
function plainChangelog(md, max = 700) {
  if (typeof md !== 'string' || !md.trim()) return '';
  let t = md
    .replace(/\r\n?/g, '\n')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/<(?:br|\/p|\/li|\/div|\/h[1-6])\b[^>]*>/gi, '\n')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`\n]*)`/g, '$1')
    .replace(/^\s{0,3}#{1,6}[ \t]*(.*?)[ \t]*#*[ \t]*$/gm, '$1')
    .replace(/^[ \t]*([-*_][ \t]*){3,}$/gm, '')
    .replace(/^[ \t]*[-*+][ \t]+/gm, '• ')
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '$2')
    .replace(/(^|[^\w*])\*(?=\S)([^*\n]*?\S)\*(?![\w*])/g, '$1$2')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/&(?:amp|lt|gt|quot|nbsp|#39);/g, (m) => ENTITIES[m]);
  // Голая ссылка в окне бесполезна (по ней не щёлкнуть): убираем, а строку-подпись, у которой она была единственным содержимым, — целиком
  t = t
    .split('\n')
    .map((line) => {
      if (!/https?:\/\/\S+/.test(line)) return line;
      const rest = line.replace(/https?:\/\/\S+/g, '').trim();
      return !rest || rest.endsWith(':') ? null : rest;
    })
    .filter((line) => line !== null)
    .join('\n');
  t = t.replace(/[ \t]+$/gm, '').replace(/ {2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const lines = t.split('\n');
  let cut = lines.length > 14;
  let out = [...lines.slice(0, 14).join('\n')];
  if (out.length > max) {
    out = out.slice(0, max);
    const space = out.join('').search(/\s\S*$/);
    if (space > max * 0.3) out = [...out.join('').slice(0, space)]; // режем по слову; если до пробела меньше трети допустимого, слова слишком длинные — режем как есть
    cut = true;
  }
  return out.join('').trimEnd() + (cut ? '…' : '');
}

// Обновления с Modrinth по хэшам файлов (работает и для модов, поставленных вручную). Найденные убираются из byHash:
// остаток — моды, про которые Modrinth не знает (они могут быть с CurseForge)
async function modrinthUpdates(inst, byHash) {
  const updates = [];
  if (!byHash.size) return updates;
  const res = await postJson(`${MR}/version_files/update`, {
    hashes: [...byHash.keys()],
    algorithm: 'sha1',
    loaders: loadersFor(inst.loader),
    game_versions: [inst.version],
  });
  for (const [hash, ver] of Object.entries(res)) {
    const m = byHash.get(hash);
    const f = ver.files.find((x) => x.primary) || ver.files[0];
    if (!m || !f || f.hashes.sha1 === hash || !validFilename(f.filename)) continue;
    updates.push({ file: m.file, title: m.title || ver.name, from: m.version || m.file, to: ver.version_number, source: 'modrinth', projectId: ver.project_id, url: f.url, filename: f.filename, sha1: f.hashes.sha1, enabled: m.enabled, icon: m.icon, changelog: plainChangelog(ver.changelog) });
    byHash.delete(hash);
  }
  return updates;
}

// Лёгкая проверка для фона (core/modwatch.js): один запрос по хэшам незакреплённых модов, ничего не скачивается и не сверяется с остальными
// модами — это делает check при открытии окна. CurseForge в фоне не опрашиваем: там по запросу на мод и нужен ключ
async function lookup(instId) {
  const inst = instances.get(instId);
  if (inst.loader === 'vanilla') return [];
  const byHash = new Map();
  for (const m of mods.list(instId)) if (!m.pinned) byHash.set(await origins.sha1File(mods.filePath(instId, m.file)), m);
  return modrinthUpdates(inst, byHash);
}

async function check(instId) {
  const inst = instances.get(instId);
  if (inst.loader === 'vanilla') return [];
  const list = mods.list(instId);
  // Закреплённые моды не проверяем (но в проверке совместимости ниже они участвуют как стоящие в сборке)
  const byHash = new Map(list.filter((m) => !m.pinned).map((m) => [sha1(mods.filePath(instId, m.file)), m]));
  const updates = await modrinthUpdates(inst, byHash);

  // Моды с CurseForge (если есть ключ): сравниваем имя файла с самым свежим подходящим
  if (store.get().settings.cfApiKey) {
    for (const m of byHash.values()) {
      if (m.source !== 'curseforge') continue;
      try {
        const f = await curseforge.bestFile(m.projectId, inst.version, inst.loader);
        if (!f || !f.downloadUrl || path.basename(f.fileName) === m.file) continue;
        updates.push({ file: m.file, title: m.title, from: m.version || m.file, to: f.displayName, source: 'curseforge', projectId: m.projectId, url: f.downloadUrl, filename: path.basename(f.fileName), sha1: curseforge.sha1Of(f), enabled: m.enabled, icon: m.icon });
      } catch {}
    }
  }
  // Проверяем совместимость в обе стороны: новая версия не должна нарушать требования других модов
  // (Iris требует Sodium 0.6.x), и её собственные требования должны выполняться уже стоящими модами.
  // Файлы качаем в кэш — потом при установке обновления они берутся оттуда
  const metas = new Map(list.map((m) => [m.file, modmeta.readMeta(mods.filePath(instId, m.file))]));
  const cacheDir = path.join(os.tmpdir(), `femboy-upd-${instId}`);
  fs.rmSync(cacheDir, { recursive: true, force: true });
  fs.mkdirSync(cacheDir, { recursive: true });
  const safe = [];
  for (const u of updates) {
    if (!validFilename(u.filename)) continue;
    const cached = path.join(cacheDir, u.filename);
    try {
      await download(u.url, cached, { sha1: u.sha1 });
      const next = modmeta.readMeta(cached);
      const cur = metas.get(u.file);
      const others = [...metas].filter(([file]) => file !== u.file).map(([, m]) => m).filter(Boolean);
      const keepsOthersHappy = others.every((o) => !cur?.id || !o.depends.has(cur.id) || modmeta.satisfies(next, o.depends, o.kind));
      const ownDepsMet = others.every((o) => modmeta.satisfies(o, next?.depends, next?.kind));
      if (keepsOthersHappy && ownDepsMet) safe.push({ ...u, cached });
      else fs.rmSync(cached, { force: true });
    } catch {
      fs.rmSync(cached, { force: true });
    }
  }
  lastCheck.set(instId, safe);
  return safe.map(({ cached, ...u }) => u);
}

async function apply(instId, files, progress = () => {}) {
  const found = (lastCheck.get(instId) || []).filter((u) => !files || files.includes(u.file));
  if (!found.length) throw new Error('Сначала проверь обновления');
  const dir = mods.dir(instId);
  const done = [];
  const failed = [];
  try {
  for (const [i, u] of found.entries()) {
    progress(`Обновляю ${u.title} (${i + 1} / ${found.length})…`, (i / found.length) * 100);
    let update;
    try {
      if (!validFilename(u.filename)) throw new Error('Некорректное имя файла мода');
      update = packupdate.begin(instId);
      const target = path.join(dir, u.filename + (u.enabled ? '' : '.disabled'));
      const staged = update.path(path.relative(instances.gameDir(instId), target));
      fs.mkdirSync(path.dirname(staged), { recursive: true });
      if (u.cached && fs.existsSync(u.cached)) fs.copyFileSync(u.cached, staged);
      else await download(u.url, staged, { sha1: u.sha1 });
      if (u.sha1 && crypto.createHash('sha1').update(fs.readFileSync(staged)).digest('hex') !== u.sha1.toLowerCase()) throw new Error('Файл обновления мода повреждён');
      throwIfCancelled();
      update.commit([`mods/${u.file}`, `mods/${u.file}.disabled`]);
      const old = mods.readMeta(instId)[u.file] || {};
      if (u.file !== u.filename) {
        const meta = mods.readMeta(instId);
        delete meta[u.file];
        fsx.writeJsonAtomic(path.join(instances.dirOf(instId), 'mods-meta.json'), meta);
      }
      let title = old.title || u.title;
      let icon = old.icon || u.icon || null;
      if (!old.title && u.source === 'modrinth') {
        try {
          const p = await getJson(`${MR}/project/${u.projectId}`);
          [title, icon] = [p.title, p.icon_url || null];
        } catch {}
      }
      mods.record(instId, u.filename, { ...old, source: u.source, projectId: u.projectId, title, icon, version: u.to });
      update.finish();
      done.push(title);
    } catch (e) {
      try { update?.abort(); }
      catch (rollback) { throw new Error(`${e.message}; не удалось восстановить обновление: ${rollback.message}`); }
      if (e.cancelled) throw e;
      failed.push(`${u.title}: ${e.message}`);
    }
  }
  return { done, failed };
  } finally {
    lastCheck.delete(instId);
    fs.rmSync(path.join(os.tmpdir(), `femboy-upd-${instId}`), { recursive: true, force: true });
  }
}

module.exports = { check, apply, lookup, plainChangelog };
