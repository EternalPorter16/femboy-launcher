# Run with Windows PowerShell under the Windows user who will publish releases.
# The password is entered locally and exported with Windows DPAPI encryption.
$ErrorActionPreference = 'Stop'
try {
    Add-Type -AssemblyName System.Windows.Forms
    $credential = Get-Credential -UserName 'bartawesom' -Message 'SpaceWeb: enter the FTP account login and password locally. Do not send the password in chat.'
    if ($null -eq $credential) { exit }
    if ([string]::IsNullOrWhiteSpace($credential.UserName) -or $credential.Password.Length -eq 0) {
        throw 'Login and password are required.'
    }
    $credentialFolder = Join-Path $env:LOCALAPPDATA 'FemboyLauncherRelease'
    $credentialPath = Join-Path $credentialFolder 'spaceweb-key.xml'
    New-Item -ItemType Directory -Path $credentialFolder -Force | Out-Null
    $credential | Export-Clixml -LiteralPath $credentialPath -Encoding UTF8
    $credential = $null
    [System.Windows.Forms.MessageBox]::Show('SpaceWeb access saved locally with Windows encryption. Return to the chat and say that access has been saved. The password has not been sent anywhere.', 'SpaceWeb', 'OK', 'Information') | Out-Null
} catch {
    # Do not print exception details: future credential handlers may include input.
    [System.Windows.Forms.MessageBox]::Show('Could not save SpaceWeb access. No password has been printed. Return to the chat for help.', 'SpaceWeb', 'OK', 'Error') | Out-Null
    exit 1
}
