param([switch]$Check, [switch]$Preview, [switch]$Production)
$ErrorActionPreference = 'Stop'
if (([int]$Check.IsPresent + [int]$Preview.IsPresent + [int]$Production.IsPresent) -ne 1) {
    Write-Error 'Select exactly one mode: -Check, -Preview or -Production.'
    exit 1
}
$credentialFile = Join-Path $env:LOCALAPPDATA 'FemboyLauncherRelease\spaceweb-key.xml'
if (!(Test-Path -LiteralPath $credentialFile)) { throw 'Run build/setup-spaceweb-key.ps1 first.' }
$credential = Import-Clixml -LiteralPath $credentialFile
$env:SW_FTP_USER = $credential.UserName
$env:SW_FTP_PASSWORD = $credential.GetNetworkCredential().Password
try {
    $mode = if ($Check) { '--check' } elseif ($Preview) { '--preview' } else { '--production' }
    & node "$PSScriptRoot\publish-spaceweb.js" $mode
    $result = $LASTEXITCODE
} finally {
    Remove-Item Env:SW_FTP_USER -ErrorAction SilentlyContinue
    Remove-Item Env:SW_FTP_PASSWORD -ErrorAction SilentlyContinue
    $credential = $null
}
exit $result
