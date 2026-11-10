const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { src, profile } = require('./helpers');

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'femboy-store-')));
const fresh = (mod) => {
  for (const k of Object.keys(require.cache)) if (k.startsWith(path.join(__dirname, '..', 'src'))) delete require.cache[k];
  return require(src(mod));
};

test('запись «целиком или никак»: папки создаются, временных файлов не остаётся, BOM и обрезанный JSON понятны', () => {
  const dir = tmp();
  try {
    const fsx = require(src('core/fsx'));
    fsx.writeJsonAtomic(path.join(dir, 'a', 'x.json'), { a: 1 });
    fsx.writeJsonAtomic(path.join(dir, 'a', 'x.json'), { a: 2 });
    assert.equal(fsx.readJson(path.join(dir, 'a', 'x.json')).data.a, 2);
    assert.equal(fs.readdirSync(path.join(dir, 'a')).length, 1, 'временный файл заменил настоящий и исчез');
    fs.writeFileSync(path.join(dir, 'bad.json'), '{"a": 1, "b": [1,2');
    assert.deepEqual({ ...fsx.readJson(path.join(dir, 'bad.json')), error: undefined }, { ok: false, exists: true, error: undefined });
    assert.equal(fsx.readJson(path.join(dir, 'nothing.json')).exists, false);
    fs.writeFileSync(path.join(dir, 'bom.json'), '﻿{"b":1}');
    assert.equal(fsx.readJson(path.join(dir, 'bom.json')).data.b, 1);
    fs.writeFileSync(path.join(dir, 'bad.json.bak'), '{"a":"из копии"}');
    assert.equal(fsx.readJsonOrBackup(path.join(dir, 'bad.json')).source, 'backup');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('файл на миг занят другим процессом (антивирус): запись дожидается и проходит', async () => {
  const dir = tmp();
  try {
    const fsx = require(src('core/fsx'));
    const target = path.join(dir, 'locked.json');
    fsx.writeJsonAtomic(target, { v: 1 });
    // Другой процесс держит файл открытым 400 мс: подмена поверх него на Windows даёт EPERM, пока он не отпустит
    const holder = spawn(process.execPath, ['-e', `const fs=require('fs');const fd=fs.openSync(${JSON.stringify(target)},'r');console.log('held');setTimeout(()=>fs.closeSync(fd),400)`], { stdio: ['ignore', 'pipe', 'ignore'] });
    await new Promise((r) => holder.stdout.once('data', r));
    fsx.writeJsonAtomic(target, { v: 2 });
    assert.equal(fsx.readJson(target).data.v, 2);
    await new Promise((r) => holder.once('close', r));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('launcher.json: испорченный файл не затирается молча, аккаунты возвращаются из копии', () => {
  const ud = tmp();
  try {
    let store = fresh('core/store');
    store.init(ud);
    assert.equal(store.takeNote(), null, 'чистый запуск без предупреждений');
    store.get().accounts.push({ id: 'off-bun', type: 'offline', name: 'Bun', uuid: 'u' });
    store.get().settings.maxRam = 3072;
    store.save();
    store = fresh('core/store');
    store.init(ud);
    assert.equal(store.get().accounts.length, 1);
    assert.equal(store.get().settings.maxRam, 3072);
    assert.ok(fs.existsSync(path.join(ud, 'launcher.json.bak')), 'при запуске сделана копия исправного файла');

    // обрыв записи посреди файла
    const good = fs.readFileSync(path.join(ud, 'launcher.json'), 'utf8');
    const cut = good.slice(0, Math.floor(good.length / 2));
    fs.writeFileSync(path.join(ud, 'launcher.json'), cut);
    store = fresh('core/store');
    store.init(ud);
    assert.equal(store.get().accounts[0].name, 'Bun', 'аккаунты вернулись из копии');
    assert.equal(store.takeNote(), 'restored');
    assert.equal(store.takeNote(), null, 'сообщение приходит один раз');
    const damaged = fs.readdirSync(ud).filter((n) => n.startsWith('launcher.json.damaged-'));
    assert.equal(damaged.length, 1);
    assert.equal(fs.readFileSync(path.join(ud, damaged[0]), 'utf8'), cut, 'испорченный файл не затёрт, а отложен рядом');
    assert.equal(JSON.parse(fs.readFileSync(path.join(ud, 'launcher.json'), 'utf8')).accounts.length, 1);

    // копии тоже нет: начинаем заново, но честно говорим об этом
    fs.rmSync(path.join(ud, 'launcher.json.bak'));
    fs.writeFileSync(path.join(ud, 'launcher.json'), '{"accounts": [');
    store = fresh('core/store');
    store.init(ud);
    assert.equal(store.get().accounts.length, 0);
    assert.equal(store.takeNote(), 'reset');
    assert.equal(fs.readdirSync(ud).filter((n) => n.startsWith('launcher.json.damaged-')).length, 2);
  } finally {
    fs.rmSync(ud, { recursive: true, force: true });
  }
});

test('копия обновляется не чаще раза в 15 минут, но первая появляется сразу', () => {
  const p = profile();
  try {
    const { store } = p;
    const bak = () => (fs.existsSync(path.join(p.dir, 'launcher.json.bak')) ? JSON.parse(fs.readFileSync(path.join(p.dir, 'launcher.json.bak'), 'utf8')).accounts.length : -1);
    store.get().accounts.push({ id: 'a', type: 'offline', name: 'Aaa', uuid: '1' });
    store.save();
    assert.equal(bak(), 1, 'первое же сохранение дало копию');
    store.get().accounts.push({ id: 'b', type: 'offline', name: 'Bbb', uuid: '2' });
    store.save();
    store.save();
    assert.equal(bak(), 1, 'частые сохранения копию не перезаписывают');
    assert.equal(JSON.parse(fs.readFileSync(path.join(p.dir, 'launcher.json'), 'utf8')).accounts.length, 2);
  } finally {
    p.done();
  }
});
