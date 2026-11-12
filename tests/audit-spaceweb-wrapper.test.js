const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), os = require('os');
const { spawnSync } = require('child_process');
test('PowerShell forwards complete arguments for every website mode without loading real credentials', { skip: process.platform !== 'win32' }, t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-wrapper-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'local/FemboyLauncherRelease'), { recursive: true });
  fs.writeFileSync(path.join(root, 'local/FemboyLauncherRelease/spaceweb-key.xml'), 'synthetic marker');
  fs.copyFileSync(path.join(__dirname, '../build/publish-spaceweb.ps1'), path.join(root, 'publish-spaceweb.ps1'));
  fs.writeFileSync(path.join(root, 'publish-spaceweb.js'), 'console.log(JSON.stringify(process.argv.slice(2)));');
  fs.writeFileSync(path.join(root, 'run.ps1'), `
param([string]$Mode)
$env:LOCALAPPDATA = Join-Path $PSScriptRoot 'local'
function Import-Clixml { param($LiteralPath); $o=New-Object PSObject; $o|Add-Member NoteProperty UserName 'fixture'; $o|Add-Member ScriptMethod GetNetworkCredential {return @{Password='synthetic'}};return $o }
if($Mode -eq 'Recover'){& "$PSScriptRoot/publish-spaceweb.ps1" -Recover 'fixture-id' -OwnerStopped}
else {$s=@{};$s[$Mode]=$true;& "$PSScriptRoot/publish-spaceweb.ps1" @s}
`);
  for (const mode of ['Check','Preview','Production','Status','Recover']) {
    const r = spawnSync('powershell', ['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'run.ps1'),mode], { cwd: root, encoding:'utf8', windowsHide:true, timeout:15000 });
    assert.equal(r.status, 0, r.stdout+r.stderr);
    assert.deepEqual(JSON.parse(r.stdout.trim()), mode === 'Recover' ? ['--recover','fixture-id','--owner-stopped'] : ['--'+mode.toLowerCase()]);
  }
});
