param(
  [switch]$WhatIf
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$escapedRepoRoot = [regex]::Escape($repoRoot)

$processes = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
  Where-Object { $_.CommandLine -match "${escapedRepoRoot}\\dist\\server\\index\.js" }

if (-not $processes) {
  Write-Host "No UE_AgentBridge node processes found."
  exit 0
}

foreach ($process in $processes) {
  if ($WhatIf) {
    Write-Host "Would stop PID $($process.ProcessId): $($process.CommandLine)"
    continue
  }

  Stop-Process -Id $process.ProcessId -Force
  Write-Host "Stopped PID $($process.ProcessId)"
}
