// Докачка файлов игры перед запуском: библиотеки и ресурсы (assets) — параллельно, с проверкой хэшей,
// защитой от зависаний и зеркалом. minecraft-launcher-core потом находит всё готовым и ничего не качает сам.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getJson, download, pool } = require('./net');
const diskspace = require('./diskspace');

const OS = { win32: 'windows', darwin: 'osx', linux: 'linux' }[process.platform];

function allowed(lib) {
  if (!lib.rules) return true;
  let ok = false;
  for (const r of lib.rules) {
    const matches = !r.os || r.os.name === OS;
    if (matches) ok = r.action === 'allow';
  }
  return ok;
}

// Путь артефакта из maven-имени group:artifact:version[:classifier]
function mavenPath(name) {
  const [group, artifact, version, classifier] = name.split(':');
  return `${group.replace(/\./g, '/')}/${artifact}/${version}/${artifact}-${version}${classifier ? '-' + classifier : ''}.jar`;
}

function sha1File(file) {
  return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');
}

// То же потоком и не вешая лаунчер: для глубокой проверки тысяч ресурсов, где читать синхронно было бы долго
function sha1FileAsync(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha1');
    fs.createReadStream(file)
      .on('data', (d) => hash.update(d))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });
}

function libraryJobs(root, jsons) {
  const jobs = new Map();
  for (const json of jsons) {
    for (const lib of json?.libraries || []) {
      if (!lib || !allowed(lib)) continue;
      let rel, url, sha1, size;
      if (lib.downloads?.artifact) {
        ({ path: rel, url, sha1, size } = lib.downloads.artifact);
      } else if (lib.url && lib.name) {
        rel = mavenPath(lib.name);
        url = lib.url.replace(/\/?$/, '/') + rel;
        sha1 = lib.sha1;
      }
      if (!rel || !url) continue; // такие библиотеки создаёт установщик Forge сам
      jobs.set(rel, { dest: path.join(root, 'libraries', rel), url, sha1, size: Number(size) || 0 });
    }
  }
  return [...jobs.values()];
}

// Докачивает недостающее и битое. Библиотеки проверяются по хэшу всегда; ресурсы — по наличию и размеру (обрыв загрузки оставляет файл
// короче), а с deep (кнопка «Починить файлы игры») ещё и по хэшу: так находится и файл нужного размера с другим содержимым.
// Отвечает, сколько проверено и сколько пришлось скачать заново: { libraries: { checked, fixed }, assets: { checked, fixed } }
async function prefetch(root, vanilla, custom, progress, { deep = false } = {}) {
  // 1. Библиотеки: проверяем хэш уже скачанных, недостающие и битые качаем заново
  const wanted = libraryJobs(root, [vanilla, custom]);
  const libs = wanted.filter((j) => !fs.existsSync(j.dest) || (j.sha1 && sha1File(j.dest) !== j.sha1));
  await diskspace.ensure(root, libs.reduce((s, j) => s + j.size, 0)); // качать нечего — не проверяется
  let done = 0;
  await pool(libs, 8, async (j) => {
    await download(j.url, j.dest, { sha1: j.sha1 });
    progress(`Скачиваю библиотеки: ${++done} / ${libs.length}`, (done / libs.length) * 100);
  });
  const report = { libraries: { checked: wanted.length, fixed: libs.length }, assets: { checked: 0, fixed: 0 } };

  // 2. Ресурсы игры (звуки, языки, текстуры): индекс + недостающие и оборванные объекты
  const idx = vanilla.assetIndex;
  if (!idx) return report;
  const indexFile = path.join(root, 'assets', 'indexes', `${idx.id}.json`);
  if (!fs.existsSync(indexFile) || sha1File(indexFile) !== idx.sha1) await download(idx.url, indexFile, { sha1: idx.sha1 });
  const { objects } = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
  // Один и тот же файл под разными именами лежит один раз: проверяем и качаем его один раз
  const unique = [...new Map(Object.values(objects).map((o) => [o.hash, o])).values()];
  const fileOf = (o) => path.join(root, 'assets', 'objects', o.hash.slice(0, 2), o.hash);
  const cut = (o) => {
    const st = fs.statSync(fileOf(o), { throwIfNoEntry: false });
    return !st || (typeof o.size === 'number' && st.size !== o.size);
  };
  let missing;
  if (deep) {
    missing = [];
    let checked = 0;
    await pool(unique, 8, async (o) => {
      if (cut(o) || (await sha1FileAsync(fileOf(o)).catch(() => null)) !== o.hash) missing.push(o);
      if (++checked % 100 === 0 || checked === unique.length) progress(`Проверяю ресурсы игры: ${checked} / ${unique.length}`, (checked / unique.length) * 100);
    });
  } else missing = unique.filter(cut);
  report.assets = { checked: unique.length, fixed: missing.length };
  const total = missing.reduce((s, o) => s + o.size, 0);
  await diskspace.ensure(root, total);
  let got = 0;
  done = 0;
  await pool(missing, 16, async (o) => {
    const sub = `${o.hash.slice(0, 2)}/${o.hash}`;
    await download(`https://resources.download.minecraft.net/${sub}`, path.join(root, 'assets', 'objects', sub), { sha1: o.hash });
    got += o.size;
    done++;
    if (done % 20 === 0 || done === missing.length) {
      progress(`Скачиваю ресурсы игры: ${done} / ${missing.length} (${(got / 1048576).toFixed(0)} из ${(total / 1048576).toFixed(0)} МБ)`, (got / total) * 100);
    }
  });
  return report;
}

module.exports = { prefetch, libraryJobsFor: libraryJobs };
