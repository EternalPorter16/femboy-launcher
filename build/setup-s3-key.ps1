# Run interactively in your own PowerShell. Never paste keys in chat.
$ErrorActionPreference = 'Stop'
$dir = Join-Path $env:LOCALAPPDATA 'FemboyLauncherRelease'
$file = Join-Path $dir 's3-key.xml'
$access = (Read-Host 'S3 access key ID').Trim()
Write-Host 'Paste the secret using RIGHT-CLICK (Ctrl+V may insert a control character in Windows PowerShell).'
$secret = Read-Host 'S3 secret access key' -AsSecureString
if (-not $access -or $secret.Length -eq 0) { throw 'Both key fields are required' }
New-Item -ItemType Directory -Path $dir -Force | Out-Null
$credential = New-Object System.Management.Automation.PSCredential($access, $secret)
$plainSecret = $credential.GetNetworkCredential().Password
try {
  if ($plainSecret.Length -lt 20 -or $plainSecret -cnotmatch '^[\x21-\x7e]+$') {
    throw 'Secret was not pasted correctly. Nothing saved. Run again and paste using RIGHT-CLICK, not Ctrl+V.'
  }
} finally {
  Remove-Variable plainSecret -ErrorAction SilentlyContinue
}
$credential | Export-Clixml -LiteralPath $file
Write-Host 'Key saved with Windows user encryption. Do not copy it into the project.'


