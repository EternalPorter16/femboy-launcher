const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { profile, put } = require('./helpers');

function setup(t) {
  const p = profile();
  t.after(() => p.done());
  return { gameDir: path.join(p.dir, 'game'), gamelog: p.load('core/gamelog') };
}

test('лог игры: есть latest.log — открывается он, нет папки или файла — понятное сообщение', (t) => {
  const { gameDir, gamelog } = setup(t);
  assert.throws(() => gamelog.target(gameDir, 'latest'), /Лога этой сборки ещё нет/);
  fs.mkdirSync(path.join(gameDir, 'logs'), { recursive: true });
  assert.throws(() => gamelog.target(gameDir, 'latest'), /Лога этой сборки ещё нет/);
  put(gameDir, { 'logs/latest.log': '[10:00:00] [main/INFO]: hi\n' });
  assert.equal(gamelog.target(gameDir, 'latest'), path.join(gameDir, 'logs', 'latest.log'));
});

test('папка логов: есть папка — открывается она, нет — понятное сообщение', (t) => {
  const { gameDir, gamelog } = setup(t);
  assert.throws(() => gamelog.target(gameDir, 'folder'), /Папки логов этой сборки ещё нет/);
  put(gameDir, { 'logs/2026-10-29-1.log.gz': 'x' });
  assert.equal(gamelog.target(gameDir, 'folder'), path.join(gameDir, 'logs'));
});

test('папка логов есть, а latest.log в ней нет (остались только старые): открыть можно папку, а не файл', (t) => {
  const { gameDir, gamelog } = setup(t);
  put(gameDir, { 'logs/2026-10-29-1.log.gz': 'x' });
  assert.throws(() => gamelog.target(gameDir, 'latest'), /Лога этой сборки ещё нет/);
  assert.equal(gamelog.target(gameDir, 'folder'), path.join(gameDir, 'logs'));
});

test('вместо файла или папки лежит не то (папка вместо latest.log, файл вместо logs) — не открываем', (t) => {
  const { gameDir, gamelog } = setup(t);
  fs.mkdirSync(path.join(gameDir, 'logs', 'latest.log'), { recursive: true });
  assert.throws(() => gamelog.target(gameDir, 'latest'), /Лога этой сборки ещё нет/);
  fs.rmSync(path.join(gameDir, 'logs'), { recursive: true });
  put(gameDir, { logs: 'я не папка' });
  assert.throws(() => gamelog.target(gameDir, 'folder'), /Папки логов этой сборки ещё нет/);
});

test('что открыть, задаёт только «latest» или «folder»: всё остальное отвергается и ничего не открывает', (t) => {
  const { gameDir, gamelog } = setup(t);
  put(gameDir, { 'logs/latest.log': 'x' });
  for (const bad of [undefined, null, '', '../..', 'C:\\Windows\\notepad.exe', 'LATEST', {}]) assert.throws(() => gamelog.target(gameDir, bad), /Неизвестно, что открыть/, String(bad));
});
