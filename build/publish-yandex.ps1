# Выкладывает собранную версию в публичную папку Яндекс.Диска (через программу Яндекс.Диск).
# Порядок важен: сначала exe, и только когда Диск их загрузил — latest.yml. Иначе лаунчеры увидят
# новую версию раньше, чем файл можно будет скачать. В самом конце прошлая версия уезжает в подпапку
# archive (хранится только она). Откат: верни её файлы из archive в корень папки, latest.yml тоже.
param([string]$Out = 'dist-release')
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot
$pkg = Get-Content "$root\package.json" -Raw -Encoding UTF8 | ConvertFrom-Json
$v = $pkg.version
$public = $pkg.updates.yandex
if (-not $public) { throw 'В package.json не указана папка Яндекс.Диска (updates.yandex)' }

$api = 'https://cloud-api.yandex.net/v1/disk/public/resources?limit=200&public_key=' + [uri]::EscapeDataString($public)
$sync = (Get-ItemProperty 'HKCU:\Software\Yandex\Yandex.Disk.4' -ErrorAction SilentlyContinue).CurrentUserSyncPath
if (-not $sync) { throw 'Не найдена программа Яндекс.Диск. Установи её и войди в свой аккаунт.' }
# Папку ищем по имени публичной папки — она должна лежать в корне Диска
$name = (Invoke-RestMethod $api).name
$dir = Join-Path $sync $name
if (-not (Test-Path $dir)) { throw "Папки «$name» нет в $sync. Публичная папка должна лежать в корне Диска." }

$files = "FemboyLauncher-Setup-$v.exe", "FemboyLauncher-Portable-$v.exe"
foreach ($f in $files + 'latest.yml') { if (-not (Test-Path "$root\$Out\$f")) { throw "Нет файла $Out\$f — сборка не удалась?" } }

function Wait-Uploaded($names) {
  $want = @{}; foreach ($n in $names) { $want[$n] = (Get-Item "$dir\$n").Length }
  $deadline = (Get-Date).AddMinutes(30)
  while ((Get-Date) -lt $deadline) {
    try {
      $have = @{}; foreach ($i in (Invoke-RestMethod $api)._embedded.items) { $have[$i.name] = $i.size }
      $left = @($names | Where-Object { $have[$_] -ne $want[$_] })
      if (-not $left.Count) { return }
      Write-Host "  Диск ещё загружает: $($left -join ', ')"
    } catch { Write-Host "  Не удалось спросить Диск: $($_.Exception.Message)" }
    Start-Sleep 15
  }
  throw 'Диск не загрузил файлы за 30 минут. Проверь, что программа Яндекс.Диск запущена, и запусти release.bat снова.'
}

# Прошлая версия не стирается, а уезжает в подпапку archive (хранится только она) — на случай отката.
# $prevYml — байты прежнего latest.yml; в архив он уходит вместе с прошлой версией, без него откат неполный.
function Move-ToArchive($dir, $keep, $prevYml, $version) {
  $old = @(Get-ChildItem $dir -Filter 'FemboyLauncher-*' -File | Where-Object { $keep -notcontains $_.Name })
  if (-not $old.Count) { return }
  $arch = Join-Path $dir 'archive'
  New-Item $arch -ItemType Directory -Force | Out-Null
  $stale = @(Get-ChildItem $arch -File | Where-Object { $_.Name -like 'FemboyLauncher-*' -or $_.Name -eq 'latest.yml' })
  foreach ($f in $old) { Move-Item $f.FullName $arch -Force }
  $stale | Where-Object { $old.Name -notcontains $_.Name } | Remove-Item -Force
  # После сбоя и повторного запуска прежний latest.yml уже может быть новым — такой в архив не кладём
  $ymlIsNew = $prevYml -and ([Text.Encoding]::UTF8.GetString($prevYml) -match ('(?m)^version:\s*{0}\s*$' -f [regex]::Escape($version)))
  if ($prevYml -and -not $ymlIsNew) { [IO.File]::WriteAllBytes((Join-Path $arch 'latest.yml'), $prevYml) }
  Write-Host "  В archive ушло: $($old.Name -join ', ')"
}

Write-Host "Копирую $v в $dir"
foreach ($f in $files) { Copy-Item "$root\$Out\$f" $dir -Force }
Wait-Uploaded $files
$prevYml = $null
if (Test-Path "$dir\latest.yml") { $prevYml = [IO.File]::ReadAllBytes("$dir\latest.yml") }
Copy-Item "$root\$Out\latest.yml" $dir -Force
Wait-Uploaded @('latest.yml')
# Новая версия уже доступна; если прошлую убрать не вышло, выкладка от этого не проваливается
try { Move-ToArchive $dir $files $prevYml $v }
catch {
  Write-Host "  Прошлую версию убрать в archive не удалось: $($_.Exception.Message)"
  Write-Host '  Новая версия уже выложена, старые файлы можно убрать с Диска вручную.'
}
Write-Host "Готово: версия $v доступна на $public"
