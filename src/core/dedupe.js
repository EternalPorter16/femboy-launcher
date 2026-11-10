// Одинаковые моды в разных сборках — одним файлом на диске (жёсткие ссылки): имена в сборках те же, места занимают как один.
// Только моды (mods/*.jar и .jar.disabled), только по кнопке и только файлы с одинаковым размером И хэшем. Файлы игры, миры и настройки не трогаются.
// Безопасность: ссылка делается рядом под временным именем и подменяет файл целиком; не вышло (файл занят, другой диск) — всё остаётся как было.
// Записи поверх такого файла в самом лаунчере сначала снимают имя (fsx.breakLink), так что одна сборка не меняет мод у другой
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const instances = require('./instances');
const mods = require('./mods');

const MIN_SIZE = 1024; // совсем мелкие файлы не стоят хлопот
const TMP = '.femboy-link';

function sha1(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha1');
    fs.createReadStream(file).on('data', (c) => h.update(c)).on('error', reject).on('end', () => resolve(h.digest('hex')));
  });
}

const ident = (st) => `${st.dev}:${st.ino}`;

// Все моды всех сборок, у которых есть двойники по размеру; затем по хэшу. → группы { hash, size, files: [{ inst, name, path, id, nlink }] }
async function groups() {
  const bySize = new Map();
  for (const inst of instances.list()) {
    let names = [];
    try {
      names = fs.readdirSync(mods.dir(inst.id));
    } catch {}
    for (const name of names) {
      if (!/\.jar(\.disabled)?$/i.test(name)) continue;
      const p = path.join(mods.dir(inst.id), name);
      let st;
      try {
        st = fs.lstatSync(p, { bigint: true });
      } catch {
        continue;
      }
      if (!st.isFile() || st.size < BigInt(MIN_SIZE)) continue;
      const key = String(st.size);
      if (!bySize.has(key)) bySize.set(key, []);
      bySize.get(key).push({ inst: inst.id, instName: inst.name, name, path: p, id: ident(st), size: Number(st.size), nlink: Number(st.nlink) });
    }
  }
  const out = [];
  for (const list of bySize.values()) {
    if (list.length < 2 || new Set(list.map((f) => f.id)).size < 2) continue; // двойников нет или это уже один и тот же файл
    const byHash = new Map();
    for (const f of list) {
      let h;
      try {
        h = await sha1(f.path);
      } catch {
        continue;
      }
      if (!byHash.has(h)) byHash.set(h, []);
      byHash.get(h).push(f);
    }
    for (const [hash, files] of byHash) if (new Set(files.map((f) => f.id)).size > 1) out.push({ hash, size: files[0].size, files });
  }
  return out;
}

// Сколько места освободится: лишний файл (все его имена) исчезает, только если других имён у него нет (например, в точке восстановления)
function freeable(g, m) {
  const names = new Map();
  for (const f of g.files) if (f.id !== m.id) names.set(f.id, [...(names.get(f.id) || []), f]);
  return [...names.values()].filter((list) => list[0].nlink === list.length).length * g.size;
}

// Главный файл группы — тот, на который уже ссылается больше всего имён
function master(files) {
  const count = new Map();
  for (const f of files) count.set(f.id, (count.get(f.id) || 0) + 1);
  return files.reduce((best, f) => (count.get(f.id) > count.get(best.id) ? f : best));
}

// Для окна: сколько можно освободить. Списки файлов — только названия
async function scan() {
  let saved = 0;
  let files = 0;
  const examples = [];
  for (const g of await groups()) {
    const m = master(g.files);
    const extra = g.files.filter((f) => f.id !== m.id);
    saved += freeable(g, m);
    files += extra.length;
    if (examples.length < 5) examples.push({ name: m.name.replace(/\.disabled$/i, ''), copies: g.files.length, size: g.size });
  }
  return { saved, files, examples };
}

// busy — сборки, у которых сейчас идёт игра: их моды открыты и не трогаются. План строится заново прямо перед объединением
async function apply({ busy = [] } = {}) {
  const skip = new Set(busy);
  let linked = 0;
  let skipped = 0;
  let freed = 0;
  for (const g of await groups()) {
    const m = master(g.files);
    if (skip.has(m.inst)) {
      skipped += g.files.filter((f) => f.id !== m.id).length;
      continue;
    }
    let done = 0;
    let all = 0;
    for (const f of g.files) {
      if (f.id === m.id) continue;
      all++;
      if (skip.has(f.inst)) {
        skipped++;
        continue;
      }
      const tmp = f.path + TMP;
      try {
        // файл мог измениться с момента подсчёта: сверяем ещё раз именно перед подменой
        if ((await sha1(f.path)) !== g.hash || (await sha1(m.path)) !== g.hash) throw new Error('файл изменился');
        fs.rmSync(tmp, { force: true });
        fs.linkSync(m.path, tmp);
        fs.renameSync(tmp, f.path);
        linked++;
        done++;
      } catch {
        fs.rmSync(tmp, { force: true });
        skipped++;
      }
    }
    if (done === all) freed += freeable(g, m);
  }
  return { linked, skipped, freed };
}

module.exports = { scan, apply };
