param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectRoot,
  [switch]$CloseEditor
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$pluginSource = Join-Path $repoRoot "unreal-plugin\UEAgentBridge"
$projectRootResolved = (Resolve-Path $ProjectRoot).Path
$pluginTarget = Join-Path $projectRootResolved "Plugins\UEAgentBridge"
$uproject = Get-ChildItem -Path $projectRootResolved -Filter *.uproject | Select-Object -First 1

if (-not (Test-Path $pluginSource)) {
  throw "Plugin source not found: $pluginSource"
}

if (-not $uproject) {
  throw "Could not find a .uproject file in $projectRootResolved"
}

$runningEditors = Get-Process UnrealEditor -ErrorAction SilentlyContinue
if ($runningEditors) {
  if ($CloseEditor) {
    $runningEditors | ForEach-Object {
      $_.CloseMainWindow() | Out-Null
      Start-Sleep -Seconds 5
      if (-not $_.HasExited) {
        Stop-Process -Id $_.Id -Force
      }
    }
  }
  else {
    throw "UnrealEditor is currently running. Close the editor first or rerun with -CloseEditor."
  }
}

New-Item -ItemType Directory -Force -Path (Join-Path $projectRootResolved "Plugins") | Out-Null
robocopy $pluginSource $pluginTarget /MIR /NFL /NDL /NJH /NJS /NP | Out-Null

$uprojectJson = Get-Content -Raw -Path $uproject.FullName | ConvertFrom-Json

if (-not $uprojectJson.Plugins) {
  $uprojectJson | Add-Member -NotePropertyName Plugins -NotePropertyValue @()
}

$pluginEntry = $uprojectJson.Plugins | Where-Object { $_.Name -eq "UEAgentBridge" } | Select-Object -First 1
if (-not $pluginEntry) {
  $pluginEntry = [pscustomobject]@{
    Name = "UEAgentBridge"
    Enabled = $true
    TargetAllowList = @("Editor")
  }
  $uprojectJson.Plugins += $pluginEntry
}
else {
  $pluginEntry.Enabled = $true
  if (-not $pluginEntry.TargetAllowList) {
    $pluginEntry | Add-Member -NotePropertyName TargetAllowList -NotePropertyValue @("Editor")
  }
}

$uprojectJson | ConvertTo-Json -Depth 20 | Set-Content -Path $uproject.FullName -Encoding UTF8

Write-Host "Synced UEAgentBridge plugin to $pluginTarget"
Write-Host "Ensured UEAgentBridge is enabled in $($uproject.FullName)"
