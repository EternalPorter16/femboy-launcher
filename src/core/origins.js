// Откуда взялись моды сборки. Если файл поставлен лаунчером или есть на Modrinth (ищем по хэшу, как при проверке обновлений),
// источник известен; иначе пишем «неизвестный источник». Моды с чужих сайтов бывают безобидными, но бывают и вредоносными,
// так что человеку полезно знать, что именно у него лежит
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const instances = require('./instances');
const mods = require('./mods');
const fsx = require('./fsx');
const { postJson, pool } = require('./net');

const MR = 'https://api.modrinth.com/v2';
const UNKNOWN_TTL = 7 * 24 * 3600 * 1000; // неизвестные перепроверяем раз в неделю: мод мог появиться на Modrinth

const cacheFile = (instId) => path.join(instances.dirOf(instId), 'origins.json');

function sha1File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha1');
    fs.createReadStream(file)
      .on('data', (d) => hash.update(d))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });
}

// { 'мод.jar': 'modrinth' | 'curseforge' | 'unknown' | 'unchecked' } для всех модов сборки.
// unchecked: проверить не вышло (нет связи), ничего не запоминаем и через минуту спросим снова
async function check(instId) {
  const list = mods.list(instId);
  const cache = fsx.readJson(cacheFile(instId)).data || {};
  const result = {};
  const pending = [];
  for (const m of list) {
    if (m.source) {
      result[m.file] = m.source; // лаунчер сам ставил этот мод
      continue;
    }
    const p = mods.filePath(instId, m.file);
    const st = fs.statSync(p);
    const c = cache[m.file];
    const fresh = c && c.size === st.size && Math.round(c.mtime) === Math.round(st.mtimeMs) && (c.status !== 'unknown' || Date.now() - c.at < UNKNOWN_TTL);
    if (fresh) result[m.file] = c.status;
    else pending.push({ file: m.file, p, st });
  }
  if (!pending.length) return result;

  await pool(pending, 4, async (x) => {
    x.sha1 = await sha1File(x.p);
  });
  let known;
  try {
    // Это подсказка «по возможности»: без связи долго не ждём
    known = await postJson(`${MR}/version_files`, { hashes: pending.map((x) => x.sha1), algorithm: 'sha1' }, null, { timeoutMs: 15000, attempts: 2 });
  } catch (e) {
    if (e.cancelled) throw e;
    for (const x of pending) result[x.file] = 'unchecked';
    return result;
  }
  for (const x of pending) {
    const status = known && known[x.sha1] ? 'modrinth' : 'unknown';
    result[x.file] = status;
    cache[x.file] = { size: x.st.size, mtime: x.st.mtimeMs, status, at: Date.now() };
  }
  for (const k of Object.keys(cache)) if (!list.some((m) => m.file === k)) delete cache[k]; // файла уже нет
  fsx.writeJsonAtomic(cacheFile(instId), cache, false);
  return result;
}

module.exports = { check, sha1File };
