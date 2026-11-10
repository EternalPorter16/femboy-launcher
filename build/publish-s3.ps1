param([string]$Out = 'dist-release', [switch]$Check)
$ErrorActionPreference = 'Stop'
$file = Join-Path $env:LOCALAPPDATA 'FemboyLauncherRelease\s3-key.xml'
if (-not (Test-Path -LiteralPath $file)) { throw 'Run build/setup-s3-key.ps1 in your PowerShell first.' }
$credential = Import-Clixml -LiteralPath $file
$env:FL_S3_ACCESS_KEY_ID = $credential.UserName.Trim()
$env:FL_S3_SECRET_ACCESS_KEY = $credential.GetNetworkCredential().Password.Trim()
try {
  if ($Check) { & node "$PSScriptRoot\publish-s3.js" --check }
  else { & node "$PSScriptRoot\publish-s3.js" $Out }
  $result = $LASTEXITCODE
} finally {
  Remove-Item Env:FL_S3_ACCESS_KEY_ID -ErrorAction SilentlyContinue
  Remove-Item Env:FL_S3_SECRET_ACCESS_KEY -ErrorAction SilentlyContinue
}
exit $result

