// История сайта: только выпуски не новее проверенной опубликованной версии.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const semver = require('semver');
const notes = require('../src/renderer/updatenotes.js');

function items(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    if (!Array.isArray(row) || row.length !== 3 || row.some((part) => typeof part !== 'string')) throw new Error('Invalid changelog item');
    const [icon, title, text] = row;
    return { icon, title, text };
  });
}

function buildHistory(root, { version, date, releaseNotes }) {
  if (!semver.valid(version)) throw new Error('Invalid published version');
  const historyFile = path.join(root, 'website/src/data/releases.json');
  const previous = fs.existsSync(historyFile) ? JSON.parse(fs.readFileSync(historyFile, 'utf8')) : [];
  if (!Array.isArray(previous)) throw new Error('Invalid saved website history');
  const releases = new Map();
  for (const entry of previous) {
    if (!semver.valid(entry.version) || !Array.isArray(entry.items) || releases.has(entry.version)) throw new Error('Invalid saved release');
    if (semver.lte(entry.version, version)) releases.set(entry.version, entry);
  }
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'src/renderer/whatsnew.js'), 'utf8'), sandbox, { timeout: 1000 });
  if (!Array.isArray(sandbox.window.CHANGELOG)) throw new Error('Launcher changelog was not found');
  const seen = new Set();
  for (const entry of sandbox.window.CHANGELOG) {
    if (!semver.valid(entry.version) || seen.has(entry.version)) throw new Error('Invalid or duplicate changelog version');
    seen.add(entry.version);
    if (semver.gt(entry.version, version)) continue;
    const old = releases.get(entry.version);
    releases.set(entry.version, { version: entry.version, date: old?.date || null, items: items(entry.ru), itemsEn: items(entry.en || []) });
  }
  const currentItems = notes.parse(releaseNotes, 'ru');
  const currentItemsEn = notes.parse(releaseNotes, 'en');
  const current = releases.get(version);
  releases.set(version, {
    version, date,
    items: currentItems.length ? items(currentItems) : (current?.items || []),
    itemsEn: currentItemsEn.length ? items(currentItemsEn) : (current?.itemsEn || []),
  });
  return [...releases.values()].sort((a, b) => semver.rcompare(a.version, b.version));
}

module.exports = { buildHistory };
