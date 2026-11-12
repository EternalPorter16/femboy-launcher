// Execute the actual PowerShell script against a fully local API/credential model.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { spawnSync } = require('child_process');
function model(t, mode) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'github-upload-model-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'build')); fs.mkdirSync(path.join(root, 'dist-release'));
  fs.copyFileSync(path.join(__dirname, '../build/publish-github.ps1'), path.join(root, 'build/publish-github.ps1'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '9.9.9', updates: { github: 'fixture/repo' } }));
  for (const kind of ['Setup', 'Portable']) fs.writeFileSync(path.join(root, `dist-release/FemboyLauncher-${kind}-9.9.9.exe`), 'fixture');
  fs.mkdirSync(path.join(root, 'local/FemboyLauncherRelease'), { recursive: true });
  fs.writeFileSync(path.join(root, 'local/FemboyLauncherRelease/github-token.xml'), 'dummy marker only');
  const digest = 'sha256:' + crypto.createHash('sha256').update('fixture').digest('hex');
  fs.writeFileSync(path.join(root, 'model.ps1'), `
$ErrorActionPreference = 'Stop'
function node { if ($env:MODEL_MODE -eq 'bad-provenance') { $global:LASTEXITCODE=1; return }; $global:LASTEXITCODE=0; return '{"commit":"${'a'.repeat(40)}"}' }
function Import-Clixml { param($LiteralPath); $o=New-Object PSObject; $o | Add-Member ScriptMethod GetNetworkCredential { return @{Password='synthetic-token'} }; return $o }
function Get-FileHash { param($LiteralPath,$Algorithm); $h=[Security.Cryptography.SHA256]::Create(); try { return @{Hash=([BitConverter]::ToString($h.ComputeHash([IO.File]::ReadAllBytes($LiteralPath)))).Replace('-','')} } finally {$h.Dispose()} }
function Invoke-RestMethod {
 param($Uri, $Headers, $TimeoutSec, $Method='Get', $ContentType, $Body, $InFile)
 Add-Content -LiteralPath "$PSScriptRoot/calls.log" -Value "$Method $Uri"
 if ($Body) { Add-Content -LiteralPath "$PSScriptRoot/calls.log" -Value ([Text.Encoding]::UTF8.GetString($Body)) }
 if ($Uri -match '/commits/') { return @{sha=('a'*40)} }
 if ($env:MODEL_MODE -match '^new' -and ($Uri -match '/git/ref/tags/' -or $Uri -match '/releases/tags/')) { return $null }
 if ($Uri -match '^https://uploads.github.com/') { return @{size=7;state='uploaded';digest=$(if($env:MODEL_MODE -eq 'new-bad-upload'){'sha256:bad'}else{'${digest}'})} }
 if ($Uri -match '/git/ref/tags/') { return @{object=@{type='commit';sha=$(if($env:MODEL_MODE -eq 'wrong-tag'){'b'*40}else{'a'*40})}} }
 $a=@{name='FemboyLauncher-Setup-9.9.9.exe';size=7;state='uploaded';digest='${digest}'}
 if ($env:MODEL_MODE -eq 'incomplete') {$a.size=0;$a.state='starter'}
 if ($env:MODEL_MODE -eq 'same-size-wrong-hash') {$a.digest='sha256:wrong'}
 $b=@{name='FemboyLauncher-Portable-9.9.9.exe';size=7;state='uploaded';digest='${digest}'}
 return @{id=1;assets=$(if($env:MODEL_MODE -match '^new'){@()}else{@($a,$b)});upload_url='https://uploads.github.com/repos/fixture/repo/releases/1/assets{?name}';html_url='https://example.invalid'}
}
& "$PSScriptRoot/build/publish-github.ps1"
`);
  const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'model.ps1')], {
    cwd: root, windowsHide: true, encoding: 'utf8', timeout: 30000,
    env: { ...process.env, MODEL_MODE: mode, LOCALAPPDATA: path.join(root, 'local') },
  });
  return { ...r, calls: fs.existsSync(path.join(root, 'calls.log')) ? fs.readFileSync(path.join(root, 'calls.log'), 'utf8') : '' };
}
for (const mode of ['incomplete', 'same-size-wrong-hash', 'wrong-tag', 'bad-provenance']) {
  test(`GitHub local model rejects ${mode}`, { skip: process.platform !== 'win32' }, t => {
    const r = model(t, mode); assert.notEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout+r.stderr, mode === 'bad-provenance' ? /provenance verification failed/ : mode === 'wrong-tag' ? /tag points to different sources/ : /incomplete or cannot be verified/);
    if (mode === 'wrong-tag') assert.doesNotMatch(r.calls, /Post |Patch /);
    if (mode === 'bad-provenance') assert.equal(r.calls, '');
  });
}
test('GitHub repeat verifies digest and never uploads a same-content asset', { skip: process.platform !== 'win32' }, t => {
  const r = model(t, 'valid'); assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /SHA256 verified/); assert.doesNotMatch(r.calls, /Post /);
});
test('GitHub creation binds the recorded commit and verifies both uploaded assets', { skip: process.platform !== 'win32' }, t => {
  const r = model(t, 'new'); assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.calls, new RegExp('"target_commitish":\\s*"' + 'a'.repeat(40) + '"'));
  assert.equal((r.calls.match(/Post https:\/\/uploads.github.com/g) || []).length, 2);
});
test('GitHub rejects an upload response with a wrong digest', { skip: process.platform !== 'win32' }, t => {
  const r = model(t, 'new-bad-upload'); assert.notEqual(r.status, 0);
  assert.match(r.stdout+r.stderr, /failed integrity verification/);
});
