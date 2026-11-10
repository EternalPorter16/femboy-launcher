// Чтение метаданных мода из jar (Fabric, Quilt, Forge, NeoForge) и проверка условий на версии зависимостей.
// Нужно, чтобы ставить зависимости совместимых версий: Modrinth часто пишет просто «нужен Sodium»,
// а сам мод внутри требует, например, "sodium": "0.6.x"
const AdmZip = require('adm-zip');

function parseVersion(v) {
  const clean = String(v).trim().replace(/^v/i, '').split('+')[0];
  const [core, ...pre] = clean.split('-');
  return { nums: core.split('.').map((n) => parseInt(n, 10)).map((n) => (Number.isNaN(n) ? 0 : n)), pre: pre.join('-') };
}

function compare(a, b) {
  const A = parseVersion(a);
  const B = parseVersion(b);
  for (let i = 0; i < Math.max(A.nums.length, B.nums.length); i++) {
    const d = (A.nums[i] || 0) - (B.nums[i] || 0);
    if (d) return d;
  }
  if (A.pre && !B.pre) return -1; // 1.0-beta < 1.0
  if (!A.pre && B.pre) return 1;
  return A.pre.localeCompare(B.pre, undefined, { numeric: true });
}

// Условие Fabric: "0.6.x", ">=0.6 <0.7", "~0.6.0", "^1.2", "*", "=1.0" или массив вариантов (любой подходит)
function fabricSatisfies(version, pred) {
  if (Array.isArray(pred)) return pred.some((p) => fabricSatisfies(version, p));
  return String(pred)
    .trim()
    .split(/\s+/)
    .every((part) => {
      if (part === '*' || part === '') return true;
      const m = /^(>=|<=|>|<|=|~|\^)?(.+)$/.exec(part);
      const [, op = '', raw] = m;
      if (/[xX*]/.test(raw)) {
        // x-диапазон: 0.6.x — совпадают все числа до x
        const want = raw.split('.').filter((p) => !/^[xX*]$/.test(p)).map(Number);
        const have = parseVersion(version).nums;
        return want.every((n, i) => have[i] === n);
      }
      const c = compare(version, raw);
      const base = parseVersion(raw).nums;
      const next = (idx) => [...base.slice(0, idx), (base[idx] || 0) + 1].join('.');
      switch (op) {
        case '>=':
          return c >= 0;
        case '<=':
          return c <= 0;
        case '>':
          return c > 0;
        case '<':
          return c < 0;
        case '~':
          return c >= 0 && compare(version, next(1)) < 0;
        case '^':
          return c >= 0 && compare(version, next(0)) < 0;
        default:
          return c === 0 || compare(parseVersion(version).nums.join('.'), parseVersion(raw).nums.join('.')) === 0;
      }
    });
}

// Диапазон Maven (Forge/NeoForge): "[0.6,0.7)", "[47,)", "1.0" (= не ниже), несколько через запятую
function mavenSatisfies(version, range) {
  const r = String(range).trim();
  if (!r || r === '*') return true;
  const sets = r.match(/[[(][^\])]*[\])]/g);
  if (!sets) return compare(version, r) >= 0;
  return sets.some((set) => {
    const [lo, hi] = set.slice(1, -1).split(',').map((s) => s?.trim());
    const loOk = !lo || (set[0] === '[' ? compare(version, lo) >= 0 : compare(version, lo) > 0);
    if (hi === undefined) return compare(version, lo) === 0; // [1.0] — ровно эта версия
    const hiOk = !hi || (set.endsWith(']') ? compare(version, hi) <= 0 : compare(version, hi) < 0);
    return loOk && hiOk;
  });
}

// Что мод «везёт с собой»: поле provides и вложенные jar (jar-in-jar) — такие зависимости ставить не нужно
function providedIds(zip, json) {
  const ids = new Set(json.provides || []);
  for (const { file } of json.jars || []) {
    try {
      const inner = new AdmZip(zip.readFile(file));
      const j = JSON.parse((inner.readAsText('fabric.mod.json') || 'null').replace(/^﻿/, ''));
      if (j?.id) ids.add(j.id);
      for (const p of j?.provides || []) ids.add(p);
      for (const x of providedIds(inner, j || {})) ids.add(x);
    } catch {}
  }
  return ids;
}

function manifestVersion(zip) {
  const mf = zip.readAsText('META-INF/MANIFEST.MF') || '';
  return /^Implementation-Version:\s*(.+)$/m.exec(mf)?.[1]?.trim() || null;
}

// { id, version, depends: Map<id, условие>, kind: 'fabric' | 'maven' }
function readMeta(file) {
  let zip;
  try {
    zip = new AdmZip(file);
  } catch {
    return null;
  }
  const fabric = zip.readAsText('fabric.mod.json');
  if (fabric) {
    try {
      const j = JSON.parse(fabric.replace(/^﻿/, ''));
      return {
        id: j.id,
        name: j.name,
        version: String(j.version),
        depends: new Map(Object.entries(j.depends || {})),
        breaks: new Map(Object.entries(j.breaks || {})), // точно не работают вместе
        conflicts: new Map(Object.entries(j.conflicts || {})), // работают, но с проблемами
        provides: providedIds(zip, j),
        kind: 'fabric',
      };
    } catch {}
  }
  const quilt = zip.readAsText('quilt.mod.json');
  if (quilt) {
    try {
      const q = JSON.parse(quilt).quilt_loader;
      const deps = new Map(
        (q.depends || []).filter((d) => typeof d === 'object' && !d.optional).map((d) => [d.id, d.versions || '*'])
      );
      const breaks = new Map((q.breaks || []).map((d) => (typeof d === 'string' ? [d, '*'] : [d.id, d.versions || '*'])));
      return { id: q.id, name: q.metadata?.name, version: String(q.version), depends: deps, breaks, conflicts: new Map(), provides: new Set((q.provides || []).map((p) => p.id || p)), kind: 'fabric' };
    } catch {}
  }
  const toml = zip.readAsText('META-INF/neoforge.mods.toml') || zip.readAsText('META-INF/mods.toml');
  if (toml) {
    const id = /\[\[mods\]\][\s\S]*?modId\s*=\s*"([^"]+)"/.exec(toml)?.[1];
    let version = /\[\[mods\]\][\s\S]*?version\s*=\s*"([^"]+)"/.exec(toml)?.[1];
    if (!version || version.includes('${')) version = manifestVersion(zip) || '0';
    const deps = new Map();
    const breaks = new Map();
    const conflicts = new Map();
    for (const block of toml.split(/\[\[dependencies\.[^\]]+\]\]/).slice(1)) {
      const dep = /modId\s*=\s*"([^"]+)"/.exec(block)?.[1];
      const range = /versionRange\s*=\s*"([^"]*)"/.exec(block)?.[1] || '*';
      const type = /type\s*=\s*"(\w+)"/i.exec(block)?.[1]?.toLowerCase();
      if (!dep || ['minecraft', 'forge', 'neoforge', 'java'].includes(dep)) continue;
      if (type === 'incompatible') breaks.set(dep, range);
      else if (type === 'discouraged') conflicts.set(dep, range);
      else if (/mandatory\s*=\s*true/.test(block) || type === 'required') deps.set(dep, range);
    }
    const name = /\[\[mods\]\][\s\S]*?displayName\s*=\s*"([^"]+)"/.exec(toml)?.[1];
    return { id, name, version, depends: deps, breaks, conflicts, provides: new Set(), kind: 'maven' };
  }
  return null;
}

// Подходит ли мод (его метаданные) под условия родителя
function satisfies(meta, parentDepends, kind) {
  if (!meta || !parentDepends?.has(meta.id)) return true;
  const pred = parentDepends.get(meta.id);
  try {
    return kind === 'maven' ? mavenSatisfies(meta.version, pred) : fabricSatisfies(meta.version, pred);
  } catch {
    return true; // непонятное условие — не блокируем установку
  }
}

function matches(version, pred, kind) {
  try {
    return kind === 'maven' ? mavenSatisfies(version, pred) : fabricSatisfies(version, pred);
  } catch {
    return false;
  }
}

// Конфликтуют ли два мода по их собственным метаданным (в любую сторону).
// hard — «breaks/incompatible»: вместе не запустятся; иначе — «conflicts/discouraged»: будут проблемы
function conflictBetween(a, b) {
  if (!a?.id || !b?.id || a.id === b.id) return null;
  for (const [x, y] of [
    [a, b],
    [b, a],
  ]) {
    const ids = [y.id, ...(y.provides || [])];
    for (const id of ids) {
      if (x.breaks?.has(id) && matches(y.version, x.breaks.get(id), x.kind)) return { hard: true, by: x, other: y };
      if (x.conflicts?.has(id) && matches(y.version, x.conflicts.get(id), x.kind)) return { hard: false, by: x, other: y };
    }
  }
  return null;
}

module.exports = { readMeta, satisfies, matches, conflictBetween, fabricSatisfies, mavenSatisfies, compare };
