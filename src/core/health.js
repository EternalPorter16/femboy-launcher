// «Здоровье» сборки до запуска: конфликты модов (по их собственным метаданным), недостающие и неподходящие
// зависимости, дубли. Плюс проверка нового мода при установке
const fs = require('fs');
const path = require('path');
const instances = require('./instances');
const mods = require('./mods');
const modmeta = require('./modmeta');

// Не моды, а сама платформа
const PLATFORM_IDS = new Set(['minecraft', 'java', 'fabricloader', 'fabric-loader', 'quilt_loader', 'quilt_base', 'forge', 'neoforge', 'fml', 'javafml', 'mixinextras']);

// Метаданные читаем из jar один раз, пока файл не изменился
const cache = new Map();
function metaOf(file) {
  try {
    const st = fs.statSync(file);
    const key = `${file}|${st.size}|${st.mtimeMs}`;
    if (!cache.has(key)) cache.set(key, modmeta.readMeta(file));
    return cache.get(key);
  } catch {
    return null;
  }
}

const label = (x) => x.meta?.name || x.title || x.meta?.id || x.file;

function installedMods(instId) {
  return mods
    .list(instId)
    .filter((m) => m.enabled)
    .map((m) => ({ file: m.file, title: m.title, meta: metaOf(mods.filePath(instId, m.file)) }))
    .filter((x) => x.meta?.id);
}

function check(instId) {
  const inst = instances.get(instId);
  const res = { conflicts: [], missing: [], duplicates: [] };
  if (inst.loader === 'vanilla') return res;
  const list = installedMods(instId);

  // Дубли: один и тот же мод двумя файлами
  const byId = new Map();
  for (const x of list) byId.set(x.meta.id, [...(byId.get(x.meta.id) || []), x]);
  for (const [id, xs] of byId) if (xs.length > 1) res.duplicates.push({ id, name: label(xs[0]), files: xs.map((x) => x.file) });

  // Конфликты по breaks/conflicts (Fabric/Quilt) и incompatible/discouraged (Forge/NeoForge)
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const c = modmeta.conflictBetween(list[i].meta, list[j].meta);
      if (!c) continue;
      const [a, b] = c.by === list[i].meta ? [list[i], list[j]] : [list[j], list[i]];
      res.conflicts.push({ hard: c.hard, by: label(a), other: label(b), file: b.file, byFile: a.file });
    }
  }

  // Недостающие и неподходящие по версии зависимости
  const present = new Map();
  for (const x of list) {
    present.set(x.meta.id, x);
    for (const p of x.meta.provides || []) if (!present.has(p)) present.set(p, x);
  }
  const fabricApi = present.has('fabric-api') || present.has('fabric');
  const seen = new Set();
  for (const x of list) {
    for (const [id, pred] of x.meta.depends) {
      if (PLATFORM_IDS.has(id)) continue;
      if (/^fabric(-|$)/.test(id) && id !== 'fabric-api' && fabricApi) continue;
      const have = present.get(id);
      const key = `${id}|${label(x)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const need = [].concat(pred).join(' или ');
      if (!have) {
        const want = /^fabric(-|$)/.test(id) ? 'fabric-api' : id;
        res.missing.push({ id: want, by: label(x), need: want === id ? need : '*', pred: want === id ? pred : '*', kind: x.meta.kind });
      } else if (have.meta.id === id && !modmeta.satisfies(have.meta, x.meta.depends, x.meta.kind)) {
        res.missing.push({ id, by: label(x), need, pred, kind: x.meta.kind, have: have.meta.version, file: have.file, wrongVersion: true });
      }
    }
  }
  // Один и тот же недостающий мод от разных модов показываем одной строкой
  const merged = new Map();
  for (const m of res.missing) {
    const k = `${m.id}|${m.wrongVersion ? 'v' : ''}`;
    if (merged.has(k)) merged.get(k).by += `, ${m.by}`;
    else merged.set(k, { ...m });
  }
  res.missing = [...merged.values()];
  return res;
}

// Условие несовместимости касается только части версий (например, «sodium <0.6»), а не мода целиком —
// значит, конфликт можно убрать другой версией
function versionSpecific(c) {
  const ids = [c.other.id, ...(c.other.provides || [])];
  const preds = ids.map((id) => c.by.breaks?.get(id)).filter((p) => p !== undefined);
  return preds.length > 0 && preds.every((p) => ![].concat(p).some((x) => String(x).trim() === '*' || String(x).trim() === ''));
}

// Новый мод при установке: с какими уже стоящими он несовместим
// (hardMods — подробности по жёстким конфликтам, чтобы установщик мог попробовать заменить версию)
function checkNewMod(instId, file) {
  const meta = metaOf(file);
  const out = { hard: [], soft: [], hardMods: [] };
  if (!meta?.id) return out;
  for (const x of installedMods(instId)) {
    if (x.file === path.basename(file)) continue;
    const c = modmeta.conflictBetween(meta, x.meta);
    if (!c) continue;
    (c.hard ? out.hard : out.soft).push(label(x));
    if (c.hard) out.hardMods.push({ file: x.file, name: label(x), meta: x.meta, versionSpecific: versionSpecific(c) });
  }
  return out;
}

const isClean = (h) => !h.conflicts.length && !h.missing.length && !h.duplicates.length;

module.exports = { check, checkNewMod, isClean, PLATFORM_IDS };
