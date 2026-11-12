# Reserve channel: uploads verified installers only. Never stage, commit or push source files.
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
if ($v -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$') { throw 'Invalid release version' }
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
  Write-Host '  Plan only: source provenance and remote checks are required for a real upload.'
  exit 0
}

$tokenFile = Join-Path $env:LOCALAPPDATA 'FemboyLauncherRelease\github-token.xml'
if (-not (Test-Path $tokenFile)) {
  Write-Host 'GitHub reserve step skipped: no token saved. To enable it run: powershell -File build\setup-github-token.ps1'
  exit 0
}
$recordText = & node "$PSScriptRoot\release-build.js" --verify $Out
if ($LASTEXITCODE -ne 0) { throw 'Release provenance verification failed; rebuild from a reviewed clean commit' }
$record = $recordText | ConvertFrom-Json
$commit = $record.commit
$token = (Import-Clixml -LiteralPath $tokenFile).GetNetworkCredential().Password
$headers = @{ Authorization = "Bearer $token"; 'X-GitHub-Api-Version' = '2022-11-28'; 'User-Agent' = 'femboy-launcher-release'; Accept = 'application/vnd.github+json' }
$api = "https://api.github.com/repos/$slug"

# 1. The reviewed source must already be public. All calls before release creation are read-only.
$remoteCommit = Invoke-RestMethod "$api/commits/$commit" -Headers $headers -TimeoutSec 60
if ($remoteCommit.sha -ne $commit) { throw 'Source commit is not available in the public repository' }
$ref = $null
try { $ref = Invoke-RestMethod "$api/git/ref/tags/$tag" -Headers $headers -TimeoutSec 60 } catch {
  if ($_.Exception.Response.StatusCode.value__ -ne 404) { throw }
}
if ($ref) {
  $object = $ref.object
  for ($depth = 0; $object.type -eq 'tag' -and $depth -lt 8; $depth++) {
    $object = (Invoke-RestMethod "$api/git/tags/$($object.sha)" -Headers $headers -TimeoutSec 60).object
  }
  if ($object.type -ne 'commit' -or $object.sha -ne $commit) { throw 'Existing release tag points to different sources; use a new version' }
}

# 2. Release: create it, or refresh the description of an existing one
$release = $null
try { $release = Invoke-RestMethod "$api/releases/tags/$tag" -Headers $headers -TimeoutSec 60 } catch {
  if ($_.Exception.Response.StatusCode.value__ -ne 404) { throw }
}
if (-not $release) {
  $payload = @{ tag_name = $tag; target_commitish = $commit; name = "Femboy Launcher $v"; body = $body; draft = $false; prerelease = $false } | ConvertTo-Json
  $release = Invoke-RestMethod "$api/releases" -Method Post -Headers $headers -TimeoutSec 60 -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($payload))
  Write-Host "Created release $tag"
} else {
  $payload = @{ name = "Femboy Launcher $v"; body = $body } | ConvertTo-Json
  if (-not $ref) { throw 'Existing release has no verified source tag' }
  $release = Invoke-RestMethod "$api/releases/$($release.id)" -Method Patch -Headers $headers -TimeoutSec 60 -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($payload))
  Write-Host "Updated description of release $tag"
}

# 3. Same size alone is not proof of identical content. Never replace a published asset automatically.
$have = @{}; foreach ($a in $release.assets) { $have[$a.name] = $a }
$upload = ($release.upload_url -replace '\{.*$', '')
foreach ($f in $files) {
  $path = "$root\$Out\$f"; $size = (Get-Item $path).Length
  if ($have.ContainsKey($f)) {
    $expected = 'sha256:' + (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($have[$f].size -ne $size -or $have[$f].state -ne 'uploaded' -or $have[$f].digest -ne $expected) { throw "Existing asset $f is incomplete or cannot be verified; inspect it before retrying" }
    Write-Host "  $f is already on GitHub (SHA256 verified)"
    continue
  }
  Write-Host "  uploading $f ($([math]::Round($size / 1MB)) MB)..."
  $uploaded = Invoke-RestMethod ($upload + '?name=' + [uri]::EscapeDataString($f)) -Method Post -Headers $headers -TimeoutSec 300 -ContentType 'application/octet-stream' -InFile $path
  $expected = 'sha256:' + (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($uploaded.size -ne $size -or $uploaded.state -ne 'uploaded' -or $uploaded.digest -ne $expected) { throw "Uploaded asset $f failed integrity verification" }
}
Write-Host "GitHub reserve is ready: $($release.html_url)"
