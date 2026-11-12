// FL-SEC-06 (остаток): имя файла из ответа Modrinth не должно выводить запись за пределы кэша обновлений
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const AdmZip = require('adm-zip');
const { profile } = require('./helpers');

const BS = String.fromCharCode(92);
for (const bad of [`..${BS}..${BS}ESCAPED.jar`,'../../ESCAPED.jar', '..', 'a/b.jar', 'C:evil.jar']) {
  test(`modupdates.check отклоняет имя файла «${bad}» и ничего не пишет вне кэша`, async (t) => {
    const payload = Buffer.from('ATTACKER-BYTES'), psha = crypto.createHash('sha1').update(payload).digest('hex');
    const downloaded = [];
    const real = globalThis.fetch;
    globalThis.fetch = async (url, opt) => {
      url = String(url);
      if (/version_files\/update/.test(url)) {
        const h = JSON.parse(opt.body).hashes[0];
        return new Response(JSON.stringify({ [h]: { id: 'v2', project_id: 'abc', name: 'x', version_number: '2', changelog: '', files: [{ primary: true, url: 'https://cdn.modrinth.com/data/abc/evil.jar', filename: bad, hashes: { sha1: psha } }] } }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (/cdn\.modrinth\.com/.test(url)) { downloaded.push(url); return new Response(payload, { status: 200 }); }
      return new Response('{}', { status: 404 });
    };
    const p = profile(); t.after(() => { globalThis.fetch = real; p.done(); });
    const instances = p.load('core/instances'), mods = p.load('core/mods'), mu = p.load('core/modupdates');
    const inst = instances.create({ name: 't', version: '1.20.1', loader: 'fabric', loaderVersion: '0.15.0' });
    const z = new AdmZip(); z.addFile('fabric.mod.json', Buffer.from(JSON.stringify({ schemaVersion: 1, id: 'victim', version: '1', name: 'V' })));
    fs.mkdirSync(mods.dir(inst.id), { recursive: true }); z.writeZip(path.join(mods.dir(inst.id), 'victim.jar'));
    const before = new Set(fs.readdirSync(os.tmpdir()));
    const r = await mu.check(inst.id);
    assert.deepEqual(r, []);
    assert.deepEqual(downloaded, []);
    assert.ok(!fs.existsSync(path.join(os.tmpdir(), 'ESCAPED.jar')));
    for (const n of fs.readdirSync(os.tmpdir())) if (!before.has(n)) assert.ok(!/ESCAPED/.test(n), n);
  });
}
