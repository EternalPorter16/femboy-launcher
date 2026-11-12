# Drives the privacy page of an NSIS installer through its real Back/Next navigation with Win32 messages
# (no mouse, no keyboard focus needed) and prints one JSON result. ASCII only: Windows PowerShell 5.1 reads it as ANSI.
#   -Scenario harness-nav : test harness; checks, Back/Next, changes, Back/Next, then Next = writes the choice record
#   -Scenario fresh       : any installer; reaches the privacy page, records the initial state, then Cancel
#   -Scenario real-nav    : the real Setup; same checks as harness-nav but NEVER presses Next on the privacy page
#                            (that would start installing); ends with Cancel
param(
  [Parameter(Mandatory)] [string]$Exe,
  [Parameter(Mandatory)] [ValidateSet('harness-nav', 'fresh', 'real-nav')] [string]$Scenario,
  [string]$InstDir = '',
  [string]$LangId = '',
  [string]$Out = ''
)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System; using System.Text; using System.Runtime.InteropServices; using System.Collections.Generic;
public static class FLW {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr p, EnumProc f, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern IntPtr GetDlgItem(IntPtr h, int id);
  [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, int m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, int m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr h);
  // the current NSIS page: the visible child dialog (#32770) of the installer window
  public static IntPtr Page(IntPtr main) {
    IntPtr found = IntPtr.Zero;
    EnumChildWindows(main, (h, l) => { if (found == IntPtr.Zero && GetParent(h) == main && IsWindowVisible(h) && Cls(h) == "#32770") found = h; return true; }, IntPtr.Zero);
    return found;
  }
  public static string Cls(IntPtr h) { var s = new StringBuilder(256); GetClassName(h, s, 256); return s.ToString(); }
  public static string Txt(IntPtr h) { var s = new StringBuilder(1024); GetWindowText(h, s, 1024); return s.ToString(); }
  public static List<IntPtr> Tops(uint pid) {
    var r = new List<IntPtr>();
    EnumWindows((h, l) => { uint p; GetWindowThreadProcessId(h, out p); if (p == pid && IsWindowVisible(h) && Cls(h) == "#32770") r.Add(h); return true; }, IntPtr.Zero);
    return r;
  }
  public static List<IntPtr> Kids(IntPtr parent) {
    var r = new List<IntPtr>();
    EnumChildWindows(parent, (h, l) => { r.Add(h); return true; }, IntPtr.Zero);
    return r;
  }
}
'@
$BM_GETCHECK = 0x00F0; $BM_CLICK = 0x00F5; $WM_COMMAND = 0x0111
$log = New-Object System.Collections.Generic.List[object]
function Note($step, $data) { $log.Add([ordered]@{ step = $step; data = $data }) }

function MainWindow($proc) {
  for ($i = 0; $i -lt 150; $i++) {
    $proc.Refresh()
    if ($proc.HasExited) { throw "installer exited early (code $($proc.ExitCode))" }
    $tops = [FLW]::Tops([uint32]$proc.Id)
    foreach ($t in $tops) {
      $next = [FLW]::GetDlgItem($t, 1)
      # ready: buttons exist, a page is shown and Next is enabled; then let the window finish initialising
      if ($next -ne [IntPtr]::Zero -and [FLW]::GetDlgItem($t, 2) -ne [IntPtr]::Zero -and [FLW]::Page($t) -ne [IntPtr]::Zero -and [FLW]::IsWindowEnabled($next)) { Start-Sleep -Milliseconds 1200; return $t }
    }
    Start-Sleep -Milliseconds 200
  }
  throw 'installer window not found'
}
function Inner($main) { [FLW]::Page($main) }
function Page($main) {
  $inner = Inner $main
  $boxes = @(); $radios = @(); $edit = $false; $progress = $false
  if ($inner -ne [IntPtr]::Zero) {
    foreach ($k in [FLW]::Kids($inner)) {
      if (-not [FLW]::IsWindowVisible($k)) { continue }
      $cls = [FLW]::Cls($k)
      if ($cls -eq 'Button') {
        $type = [FLW]::GetWindowLong($k, -16) -band 0xF
        if ($type -eq 3 -or $type -eq 2) { $boxes += $k }
        elseif ($type -eq 9 -or $type -eq 4) { $radios += $k }
      } elseif ($cls -eq 'Edit') { $edit = $true }
      elseif ($cls -eq 'msctls_progress32') { $progress = $true }
    }
  }
  $next = [FLW]::GetDlgItem($main, 1)
  [pscustomobject]@{ inner = $inner; boxes = $boxes; radios = $radios; edit = $edit; progress = $progress; privacy = ($boxes.Count -eq 4); nextText = [FLW]::Txt($next); nextEnabled = [FLW]::IsWindowEnabled($next) }
}
function States($p) { @($p.boxes | ForEach-Object { [int][FLW]::SendMessage($_, $BM_GETCHECK, [IntPtr]::Zero, [IntPtr]::Zero) }) }
function Toggle($p, [int[]]$which) { foreach ($i in $which) { [FLW]::SendMessage($p.boxes[$i], $BM_CLICK, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null; Start-Sleep -Milliseconds 120 } }
function Press($main, [int]$id, $guard) {
  $before = Inner $main
  if ($guard -and $id -eq 1 -and (Page $main).privacy) { throw 'refusing to press Next on the privacy page of the real Setup' }
  [FLW]::PostMessage($main, $WM_COMMAND, [IntPtr]$id, [FLW]::GetDlgItem($main, $id)) | Out-Null
  # one press only (a second one could skip a page); wait up to 30 s for the page to change
  for ($i = 0; $i -lt 200; $i++) {
    Start-Sleep -Milliseconds 150
    $now = Inner $main
    if ($now -ne $before -and $now -ne [IntPtr]::Zero) { Start-Sleep -Milliseconds 350; return (Page $main) }
  }
  throw "page did not change after button $id"
}
function ToPrivacy($main, $guard) {
  for ($i = 0; $i -lt 6; $i++) {
    $p = Page $main
    if ($p.privacy) { return $p }
    if ($p.progress) { throw 'reached the install page before the privacy page' }
    if ($p.radios.Count -gt 0) {
      # install-mode page of the real Setup: make sure "only for me" (the last option) is selected, never "all users"
      $me = $p.radios[$p.radios.Count - 1]
      if ([int][FLW]::SendMessage($me, $BM_GETCHECK, [IntPtr]::Zero, [IntPtr]::Zero) -ne 1) { [FLW]::SendMessage($me, $BM_CLICK, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null }
      Note 'install-mode' ([FLW]::Txt($me))
    }
    Press $main 1 $guard | Out-Null
  }
  throw 'privacy page not reached'
}
function CancelAll($proc, $main) {
  [FLW]::PostMessage($main, $WM_COMMAND, [IntPtr]2, [FLW]::GetDlgItem($main, 2)) | Out-Null
  for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Milliseconds 200
    $proc.Refresh()
    if ($proc.HasExited) { return $proc.ExitCode }
    foreach ($t in [FLW]::Tops([uint32]$proc.Id)) {
      if ($t -ne $main) { $yes = [FLW]::GetDlgItem($t, 6); if ($yes -ne [IntPtr]::Zero) { [FLW]::PostMessage($t, $WM_COMMAND, [IntPtr]6, $yes) | Out-Null } }
    }
  }
  throw 'installer did not close after Cancel'
}

$argsList = @()
if ($LangId) { $argsList += "/LANGID=$LangId" }
if ($InstDir) { $argsList += "/D=$InstDir" }
$proc = if ($argsList.Count) { Start-Process -FilePath $Exe -ArgumentList $argsList -PassThru } else { Start-Process -FilePath $Exe -PassThru }
$result = [ordered]@{ scenario = $Scenario; exe = (Split-Path $Exe -Leaf); pid = $proc.Id }
try {
  $guard = $Scenario -eq 'real-nav'
  $main = MainWindow $proc
  $p = ToPrivacy $main $guard
  $result.initial = States $p
  Note 'privacy page first open' $result.initial
  $result.labels = @($p.boxes | ForEach-Object { [FLW]::Txt($_) })
  if ($Scenario -eq 'fresh') {
    $result.exitCode = CancelAll $proc $main
  } else {
    Toggle $p @(0, 2)                                # updates + mod updates
    $result.afterFirstChoice = States $p
    $p = Press $main 3 $guard                         # Back
    $result.backPage = [ordered]@{ privacy = $p.privacy; edit = $p.edit }
    $p = Press $main 1 $guard                         # Next (from the directory page) -> privacy page again
    $result.afterBackNext1 = States $p
    Toggle $p @(2, 1)                                 # mods off, Discord on
    $result.afterSecondChoice = States $p
    $p = Press $main 3 $guard
    $p = Press $main 1 $guard
    $result.afterBackNext2 = States $p
    if ($Scenario -eq 'harness-nav') {
      $p = Press $main 1 $false                       # Next on the privacy page of the HARNESS: writes the record into /D
      for ($i = 0; $i -lt 100 -and -not (Test-Path (Join-Path $InstDir 'resources\privacy-install.json')); $i++) { Start-Sleep -Milliseconds 150 }
      Start-Sleep -Milliseconds 500
      $file = Join-Path $InstDir 'resources\privacy-install.json'
      $result.record = if (Test-Path $file) { (Get-Content -Raw $file | ConvertFrom-Json).settings } else { $null }
      # install page finished: Next now closes the harness
      for ($i = 0; $i -lt 100 -and -not [FLW]::IsWindowEnabled([FLW]::GetDlgItem($main, 1)); $i++) { Start-Sleep -Milliseconds 150 }
      [FLW]::PostMessage($main, $WM_COMMAND, [IntPtr]1, [FLW]::GetDlgItem($main, 1)) | Out-Null
      if (-not $proc.WaitForExit(15000)) { throw 'harness did not close after install' }
      $result.exitCode = $proc.ExitCode
    } else {
      $result.exitCode = CancelAll $proc $main
    }
  }
  $result.ok = $true
} catch {
  $result.ok = $false
  $result.error = $_.Exception.Message
  try { if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force } } catch {}
}
$result.log = $log
$json = $result | ConvertTo-Json -Depth 6 -Compress
if ($Out) { $json | Out-File -Encoding utf8 $Out }
$json
