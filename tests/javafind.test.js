const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { profile, put } = require('./helpers');

const EXE = process.platform === 'win32' ? 'javaw.exe' : 'java';

// Выдуманная установка Java: bin/javaw.exe (пустой файл) и release с версией
function fakeJava(root, name, { version, vendor = 'Eclipse Adoptium', arch = 'x86_64', type = 'JDK' }) {
  const home = path.join(root, name);
  put(home, { [`bin/${EXE}`]: '', release: `IMPLEMENTOR="${vendor}"\nIMAGE_TYPE="${type}"\nJAVA_VERSION="${version}"\nOS_ARCH="${arch}"\n` });
  return path.join(home, 'bin', EXE);
}

test('версия Java из строки и из файла release', () => {
  const p = profile();
  try {
    const j = p.load('core/javafind');
    assert.equal(j.majorOf('1.8.0_391'), 8);
    assert.equal(j.majorOf('17.0.9'), 17);
    assert.equal(j.majorOf('21'), 21);
    assert.equal(j.majorOf('25-ea'), 25);
    assert.equal(j.majorOf('мусор'), null);
    const r = j.parseRelease('IMPLEMENTOR="Eclipse Adoptium"\nIMAGE_TYPE="JRE"\nJAVA_VERSION="21.0.4"\nOS_ARCH="x86_64"\n');
    assert.deepEqual({ major: r.major, vendor: r.vendor, bits: r.bits, type: r.type }, { major: 21, vendor: 'Eclipse Adoptium', bits: 64, type: 'JRE' });
    assert.equal(j.parseRelease('JAVA_VERSION="1.8.0_391"\nOS_ARCH="x86"\n').bits, 32);
    assert.equal(j.parseRelease('ничего полезного'), null);
    const out = j.parseVersionOutput('openjdk version "17.0.9" 2023-10-17\nOpenJDK Runtime Environment Temurin-17.0.9+9 (build 17.0.9+9)\nOpenJDK 64-Bit Server VM Temurin-17.0.9+9 (build 17.0.9+9, mixed mode)');
    assert.deepEqual({ major: out.major, bits: out.bits, vendor: out.vendor }, { major: 17, bits: 64, vendor: 'Temurin' });
    assert.equal(j.parseVersionOutput('java: command not found'), null);
  } finally {
    p.done();
  }
});

test('поиск находит все установленные Java, новые первыми, без повторов', async () => {
  const p = profile();
  try {
    const j = p.load('core/javafind');
    const root = path.join(p.dir, 'jvm');
    fakeJava(root, 'temurin-8', { version: '1.8.0_391' });
    fakeJava(root, 'temurin-17', { version: '17.0.9' });
    fakeJava(path.join(root, 'вложено'), 'zulu-21', { version: '21.0.4', vendor: 'Azul Systems, Inc.' });
    fs.mkdirSync(path.join(root, 'пустая-папка'), { recursive: true });
    const found = await j.find({ roots: [root, path.join(root, 'temurin-17')] }); // вторая папка — та же Java, дубль
    assert.deepEqual(found.map((x) => x.major), [21, 17, 8]);
    assert.equal(found[0].vendor, 'Azul Systems, Inc.');
    assert.ok(found.every((x) => x.path.endsWith(EXE)));
  } finally {
    p.done();
  }
});

test('своя Java лаунчера находится по папке java/<версия>', async () => {
  const p = profile();
  try {
    const j = p.load('core/javafind');
    fakeJava(path.join(p.dir, 'java'), '21', { version: '21.0.4' });
    const found = await j.find({ env: {} });
    assert.equal(found.length, 1);
    assert.equal(found[0].source, 'launcher');
    assert.equal(found[0].major, 21);
  } finally {
    p.done();
  }
});

test('проверка: подходит, слишком старая, слишком новая, 32 бита, не Java, нет файла', async () => {
  const p = profile();
  try {
    const j = p.load('core/javafind');
    const root = path.join(p.dir, 'jvm');
    const j8 = fakeJava(root, 'j8', { version: '1.8.0_391' });
    const j17 = fakeJava(root, 'j17', { version: '17.0.9' });
    const j21 = fakeJava(root, 'j21', { version: '21.0.4' });
    const j17x86 = fakeJava(root, 'j17x86', { version: '17.0.9', arch: 'x86' });

    const ok = await j.check(j21, 21);
    assert.equal(ok.level, 'ok');
    assert.match(ok.message, /Java 21.*подходит игре/);
    const old = await j.check(j8, 21);
    assert.equal(old.level, 'bad');
    assert.match(old.message, /Игре нужна Java 21 или новее, а здесь Java 8/);
    const newer = await j.check(j21, 17);
    assert.equal(newer.level, 'warn');
    assert.match(newer.message, /рассчитана на Java 17/);
    assert.equal((await j.check(j17, 17)).level, 'ok');
    const x86 = await j.check(j17x86, 17);
    assert.equal(x86.level, 'warn');
    assert.match(x86.message, /32-битная/);
    assert.equal((await j.check(j17)).level, 'ok', 'без требований к версии игры просто описываем Java');

    // файл есть, но это не Java
    const fake = path.join(root, 'notjava', 'bin', EXE);
    put(root, { [`notjava/bin/${EXE}`]: '' });
    const notJava = await j.check(fake, 17);
    assert.equal(notJava.level, 'bad');
    assert.match(notJava.message, /не Java|не удалось|Не получилось/i);
    const missing = await j.check(path.join(root, 'нет', 'bin', EXE), 17);
    assert.equal(missing.level, 'bad');
    assert.match(missing.message, /не найдена/);
  } finally {
    p.done();
  }
});

test('путь можно вписать папкой, папкой bin или в кавычках', async () => {
  const p = profile();
  try {
    const j = p.load('core/javafind');
    const exe = fakeJava(path.join(p.dir, 'jvm'), 'j17', { version: '17.0.9' });
    const home = path.dirname(path.dirname(exe));
    assert.equal(j.normalize(home), exe);
    assert.equal(j.normalize(path.dirname(exe)), exe);
    assert.equal(j.normalize(`"${exe}"`), exe);
    assert.equal((await j.check(home, 17)).level, 'ok');
  } finally {
    p.done();
  }
});
