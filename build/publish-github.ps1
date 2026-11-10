# Reserve channel: pushes the project to GitHub and publishes the release (installers + notes) there.
# The main channels (Cloud, own domain, Yandex.Disk) stay the source of updates; this step runs AFTER them
# and a failure here never cancels a release (release.bat only prints a warning).
# The token is stored encrypted for this Windows user (build\setup-github-token.ps1); it is never printed.
# -DryRun checks files and prints the plan without touching git, the token or the network.
param([string]$Out = 'dist-release', [switch]$DryRun)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$root = Split-Path $PSScriptRoot
$pkg = Get-Content "$root\package.json" -Raw -Encoding UTF8 | ConvertFrom-Json
$v = $pkg.version
$tag = "v$v"
$slug = $pkg.updates.github
if (-not $slug -or $slug -notmatch '^[\w.-]+/[\w.-]+$') { throw 'package.json: updates.github must look like owner/repo' }
$files = "FemboyLauncher-Setup-$v.exe", "FemboyLauncher-Portable-$v.exe"
foreach ($f in $files) { if (-not (Test-Path "$root\$Out\$f")) { throw "Missing file $Out\$f - did the build fail?" } }

# Release description: the "What's new" notes of this version (RU + EN) and the main download page
$notesFile = "$root\build\release-notes.md"
$notes = if (Test-Path $notesFile) { (Get-Content $notesFile -Raw -Encoding UTF8).Trim() } else { '' }
$download = $pkg.updates.downloadPage
$body = "## Femboy Launcher $v`n`n"
if ($notes) { $body += "$notes`n`n" }
if ($download) { $body += "**Download:** $download`n" }

if ($DryRun) {
  Write-Host "GitHub dry run: repo $slug, tag $tag"
  foreach ($f in $files) { Write-Host ("  asset {0} ({1} bytes)" -f $f, (Get-Item "$root\$Out\$f").Length) }
  Write-Host "  description: $($body.Length) characters"
  exit 0
}

$tokenFile = Join-Path $env:LOCALAPPDATA 'FemboyLauncherRelease\github-token.xml'
if (-not (Test-Path $tokenFile)) {
  Write-Host 'GitHub reserve step skipped: no token saved. To enable it run: powershell -File build\setup-github-token.ps1'
  exit 0
}
$token = (Import-Clixml -LiteralPath $tokenFile).GetNetworkCredential().Password
$headers = @{ Authorization = "Bearer $token"; 'X-GitHub-Api-Version' = '2022-11-28'; 'User-Agent' = 'femboy-launcher-release'; Accept = 'application/vnd.github+json' }
$api = "https://api.github.com/repos/$slug"

# 1. Source code: commit what changed in this release and push (history stays linear, nothing is force-pushed)
if (Test-Path "$root\.git") {
  Push-Location $root
  try {
    & git add -A
    & git diff --cached --quiet
    if ($LASTEXITCODE -ne 0) {
      & git commit -q -m "Release $tag"
      if ($LASTEXITCODE -ne 0) { throw 'git commit failed' }
      Write-Host "Committed changes as: Release $tag"
    } else { Write-Host 'No source changes to commit.' }
    & git push origin main
    if ($LASTEXITCODE -ne 0) { throw 'git push failed (sign in to GitHub in Git Credential Manager and run again)' }
  } finally { Pop-Location }
} else { Write-Host 'No git repository here: source push skipped.' }

# 2. Release: create it, or refresh the description of an existing one
$release = $null
try { $release = Invoke-RestMethod "$api/releases/tags/$tag" -Headers $headers } catch {
  if ($_.Exception.Response.StatusCode.value__ -ne 404) { throw }
}
if (-not $release) {
  $payload = @{ tag_name = $tag; target_commitish = 'main'; name = "Femboy Launcher $v"; body = $body; draft = $false; prerelease = $false } | ConvertTo-Json
  $release = Invoke-RestMethod "$api/releases" -Method Post -Headers $headers -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($payload))
  Write-Host "Created release $tag"
} else {
  $payload = @{ name = "Femboy Launcher $v"; body = $body } | ConvertTo-Json
  $release = Invoke-RestMethod "$api/releases/$($release.id)" -Method Patch -Headers $headers -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($payload))
  Write-Host "Updated description of release $tag"
}

# 3. Installers. A published file of the same name is never replaced: same size = already there, different = warning
$have = @{}; foreach ($a in $release.assets) { $have[$a.name] = $a.size }
$upload = ($release.upload_url -replace '\{.*$', '')
foreach ($f in $files) {
  $path = "$root\$Out\$f"; $size = (Get-Item $path).Length
  if ($have.ContainsKey($f)) {
    if ($have[$f] -eq $size) { Write-Host "  $f is already on GitHub" } else { Write-Host "  WARNING: $f on GitHub differs in size; not replaced" }
    continue
  }
  Write-Host "  uploading $f ($([math]::Round($size / 1MB)) MB)..."
  Invoke-RestMethod ($upload + '?name=' + [uri]::EscapeDataString($f)) -Method Post -Headers $headers -ContentType 'application/octet-stream' -InFile $path | Out-Null
}
Write-Host "GitHub reserve is ready: $($release.html_url)"
