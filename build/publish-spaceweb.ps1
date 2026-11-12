param([switch]$Check, [switch]$Preview, [switch]$Production, [switch]$Status, [string]$Recover, [switch]$OwnerStopped)
$ErrorActionPreference = 'Stop'
if (([int]$Check.IsPresent + [int]$Preview.IsPresent + [int]$Production.IsPresent + [int]$Status.IsPresent + [int](-not [string]::IsNullOrEmpty($Recover))) -ne 1) {
    Write-Error 'Select exactly one mode: -Check, -Preview, -Production, -Status or -Recover ID.'
    exit 1
}
if (($Recover -and !$OwnerStopped) -or ($OwnerStopped -and !$Recover)) { throw 'Recovery requires -Recover ID -OwnerStopped after confirming all previous publication/recovery processes have stopped.' }
$credentialFile = Join-Path $env:LOCALAPPDATA 'FemboyLauncherRelease\spaceweb-key.xml'
if (!(Test-Path -LiteralPath $credentialFile)) { throw 'Run build/setup-spaceweb-key.ps1 first.' }
$credential = Import-Clixml -LiteralPath $credentialFile
$env:SW_FTP_USER = $credential.UserName
$env:SW_FTP_PASSWORD = $credential.GetNetworkCredential().Password
try {
    [string[]]$cliArgs = @(if ($Recover) { '--recover'; $Recover; '--owner-stopped' } elseif ($Status) { '--status' } elseif ($Check) { '--check' } elseif ($Preview) { '--preview' } else { '--production' })
    & node "$PSScriptRoot\publish-spaceweb.js" @cliArgs
    $result = $LASTEXITCODE
} finally {
    Remove-Item Env:SW_FTP_USER -ErrorAction SilentlyContinue
    Remove-Item Env:SW_FTP_PASSWORD -ErrorAction SilentlyContinue
    $credential = $null
}
exit $result
