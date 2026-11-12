const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const { build, verify } = require('../build/release-build');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'release-source-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
  git('init', '-b', 'main'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
  fs.writeFileSync(path.join(root, '.gitignore'), 'dist-release/\n*.log\n');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '9.9.9' }));
  fs.mkdirSync(path.join(root, 'src')); fs.writeFileSync(path.join(root, 'src/main.js'), 'original');
  fs.mkdirSync(path.join(root, 'website')); fs.writeFileSync(path.join(root, 'website/site.json'), '{}');
  git('add', '.'); git('commit', '-qm', 'Fixture base');
  const compile = () => {
    fs.mkdirSync(path.join(root, 'dist-release'), { recursive: true });
    for (const kind of ['Setup', 'Portable']) fs.writeFileSync(path.join(root, `dist-release/FemboyLauncher-${kind}-9.9.9.exe`), 'fixture artifact');
  };
  return { root, git, compile };
}
test('release refuses dirty, staged and untracked files without committing or building', t => {
  const f = fixture(t), head = f.git('rev-parse', 'HEAD');
  for (const staged of [false, true]) {
    fs.writeFileSync(path.join(f.root, 'credentials.json'), 'SYNTHETIC');
    if (staged) f.git('add', 'credentials.json');
    assert.throws(() => build(f.root, 'dist-release', () => assert.fail('must not build')), /clean reviewed commit/);
    assert.equal(f.git('rev-parse', 'HEAD'), head);
  }
});
test('clean build binds exact source commit and artifact hashes; website generation is allowed', t => {
  const f = fixture(t), record = build(f.root, 'dist-release', f.compile);
  assert.equal(record.commit, f.git('rev-parse', 'HEAD').trim());
  fs.writeFileSync(path.join(f.root, 'website/site.json'), '{"generated":true}');
  assert.deepEqual(verify(f.root), record);
});
test('source drift during build leaves no publishable manifest', t => {
  const f = fixture(t);
  assert.throws(() => build(f.root, 'dist-release', () => { f.compile(); fs.writeFileSync(path.join(f.root, 'src/main.js'), 'changed'); }), /Source changed/);
  assert.equal(fs.existsSync(path.join(f.root, 'dist-release/source-revision.json')), false);
});
test('same-size artifact tampering and later source edits are refused', t => {
  const f = fixture(t); build(f.root, 'dist-release', f.compile);
  const exe = path.join(f.root, 'dist-release/FemboyLauncher-Setup-9.9.9.exe');
  fs.writeFileSync(exe, 'Fixture artifact');
  assert.throws(() => verify(f.root), /changed/);
  f.compile(); fs.writeFileSync(path.join(f.root, 'src/main.js'), 'changed');
  assert.throws(() => verify(f.root), /changed/);
});
test('failed rebuild removes stale provenance and non-main builds are refused', t => {
  const f = fixture(t); build(f.root, 'dist-release', f.compile);
  assert.throws(() => build(f.root, 'dist-release', () => { throw Error('build failed'); }), /build failed/);
  assert.equal(fs.existsSync(path.join(f.root, 'dist-release/source-revision.json')), false);
  f.git('checkout', '-b', 'other');
  assert.throws(() => build(f.root, 'dist-release', f.compile), /requires main/);
});
