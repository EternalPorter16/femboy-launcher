# Run interactively in your own PowerShell. Never paste the token in chat.
# Create a fine-grained token at https://github.com/settings/personal-access-tokens/new :
#   Repository access: only femboy-launcher; Permissions: Contents = Read and write. Nothing else.
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$root = Split-Path $PSScriptRoot
$slug = (Get-Content "$root\package.json" -Raw -Encoding UTF8 | ConvertFrom-Json).updates.github
$dir = Join-Path $env:LOCALAPPDATA 'FemboyLauncherRelease'
$file = Join-Path $dir 'github-token.xml'
Write-Host 'Paste the token using RIGHT-CLICK (Ctrl+V may insert a control character in Windows PowerShell).'
$secret = Read-Host 'GitHub token' -AsSecureString
if ($secret.Length -eq 0) { throw 'Empty token. Nothing saved.' }
$credential = New-Object System.Management.Automation.PSCredential('github', $secret)
$plain = $credential.GetNetworkCredential().Password
try {
  if ($plain -cnotmatch '^[\x21-\x7e]{20,}$') { throw 'Token was not pasted correctly. Nothing saved. Run again and paste using RIGHT-CLICK.' }
  $headers = @{ Authorization = "Bearer $plain"; 'User-Agent' = 'femboy-launcher-release'; Accept = 'application/vnd.github+json' }
  $repo = Invoke-RestMethod "https://api.github.com/repos/$slug" -Headers $headers
  if (-not $repo.permissions.push) { throw "The token cannot push to $slug. Give it Contents: Read and write. Nothing saved." }
} finally { Remove-Variable plain -ErrorAction SilentlyContinue }
New-Item -ItemType Directory -Path $dir -Force | Out-Null
$credential | Export-Clixml -LiteralPath $file
Write-Host "Token checked for $slug and saved with Windows user encryption. Do not copy it into the project."
