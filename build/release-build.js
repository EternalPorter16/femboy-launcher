// Build from a reviewed clean commit; never stage, commit or push source files.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function git(root, ...args) { return execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim(); }
function output(root, out) {
  if (!/^[a-zA-Z0-9_-]+$/.test(out)) throw new Error('Output must be a direct project folder');
  return path.join(root, out);
}
function sources(root) {
  // Website data is generated after the application build by website-release.
  return Object.fromEntries(git(root, 'ls-files', '-z').split('\0').filter(Boolean)
    .filter((name) => !name.startsWith('website/')).map((name) => {
      const file = path.join(root, name);
      if (!fs.lstatSync(file).isFile()) throw new Error('Release sources must be regular files');
      return [name, hash(file)];
    }));
}
function artifactFiles(root, out, version) {
  return Object.fromEntries(['Setup', 'Portable'].map((kind) => {
    const name = `FemboyLauncher-${kind}-${version}.exe`, file = path.join(output(root, out), name);
    if (!fs.lstatSync(file).isFile() || fs.statSync(file).size === 0) throw new Error('Missing or empty release artifact');
    return [name, hash(file)];
  }));
}
function build(root, out = 'dist-release', runBuild) {
  const dir = output(root, out), manifest = path.join(dir, 'source-revision.json');
  fs.rmSync(manifest, { force: true });
  if (git(root, 'status', '--porcelain', '--untracked-files=all')) throw new Error('Release requires a clean reviewed commit. Commit explicitly before building; nothing is committed automatically.');
  if (git(root, 'branch', '--show-current') !== 'main') throw new Error('Release requires main');
  const commit = git(root, 'rev-parse', 'HEAD'), before = sources(root);
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  (runBuild || (() => execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `npx electron-builder --win --publish never --config.directories.output=${out}`], { cwd: root, stdio: 'inherit', windowsHide: true })))();
  if (git(root, 'rev-parse', 'HEAD') !== commit || git(root, 'status', '--porcelain', '--untracked-files=all') || JSON.stringify(sources(root)) !== JSON.stringify(before)) throw new Error('Source changed during build; release rejected');
  const record = { schema: 1, commit, version, sources: before, files: artifactFiles(root, out, version) };
  fs.writeFileSync(manifest, JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
  return record;
}
function verify(root, out = 'dist-release') {
  const record = JSON.parse(fs.readFileSync(path.join(output(root, out), 'source-revision.json'), 'utf8'));
  if (record.schema !== 1 || !/^[a-f0-9]{40}$/.test(record.commit) || record.commit !== git(root, 'rev-parse', 'HEAD')) throw new Error('Build source commit mismatch');
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  if (record.version !== version || JSON.stringify(record.sources) !== JSON.stringify(sources(root)) || JSON.stringify(record.files) !== JSON.stringify(artifactFiles(root, out, version))) throw new Error('Build inputs or artifacts changed; rebuild from the reviewed commit');
  return record;
}
module.exports = { build, verify };
if (require.main === module) {
  try {
    const root = path.join(__dirname, '..');
    if (process.argv[2] === '--verify') console.log(JSON.stringify(verify(root, process.argv[3] || 'dist-release')));
    else build(root, process.argv[2] || 'dist-release');
  } catch (err) { console.error(err.message); process.exitCode = 1; }
}
