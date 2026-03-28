param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectRoot,
  [Parameter(Mandatory = $true)]
  [string]$ProjectName,
  [string]$EngineRoot = "E:\UnrealEngine\UE_5.7",
  [string]$TargetName,
  [string]$Platform = "Win64",
  [string]$Configuration = "Development",
  [switch]$EditorTarget,
  [string]$OutputDir
)

$ErrorActionPreference = "Stop"

$projectRootResolved = (Resolve-Path $ProjectRoot).Path
$uproject = Join-Path $projectRootResolved "$ProjectName.uproject"
if (-not (Test-Path $uproject)) {
  throw "Could not find project file: $uproject"
}

if (-not $TargetName) {
  $TargetName = if ($EditorTarget) { "${ProjectName}Editor" } else { $ProjectName }
}

if ($EditorTarget) {
  $projectArgFragment = [regex]::Escape($uproject)
  $runningEditor = Get-CimInstance Win32_Process -Filter "Name = 'UnrealEditor.exe'" |
    Where-Object { $_.CommandLine -match $projectArgFragment } |
    Select-Object -First 1

  if ($runningEditor) {
    throw "Editor target build is blocked because UnrealEditor is currently running for this project (PID $($runningEditor.ProcessId)). Close the editor first, or use the Unreal-side Live Coding path for in-editor iteration."
  }
}

$buildBat = Join-Path $EngineRoot "Engine\Build\BatchFiles\Build.bat"
if (-not (Test-Path $buildBat)) {
  throw "Could not find Build.bat: $buildBat"
}

if (-not $OutputDir) {
  $OutputDir = Join-Path $projectRootResolved "Saved\UEAgentBridgeBuild"
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$rawLogPath = Join-Path $OutputDir "$($TargetName)-$timestamp.log"
$jsonLogPath = Join-Path $OutputDir "$($TargetName)-$timestamp.json"

$arguments = @(
  $TargetName,
  $Platform,
  $Configuration,
  "-Project=$uproject",
  "-WaitMutex",
  "-NoHotReloadFromIDE"
)

$quotedCommand = @(
  "&",
  "'$buildBat'"
) + ($arguments | ForEach-Object { "'$_'" })

$commandText = $quotedCommand -join " "
$rawOutput = Invoke-Expression $commandText 2>&1 | ForEach-Object { $_.ToString() }
$buildExitCode = $LASTEXITCODE
$joinedOutput = ($rawOutput -join [Environment]::NewLine)
$joinedOutput | Set-Content -Path $rawLogPath -Encoding UTF8

$parserScript = Join-Path (Split-Path -Parent $PSScriptRoot) "scripts\parse-ue-build-log.mjs"
$parsed = & node $parserScript $rawLogPath
$parsed | Set-Content -Path $jsonLogPath -Encoding UTF8

Write-Host "Raw build log: $rawLogPath"
Write-Host "Parsed diagnostics: $jsonLogPath"
Write-Output $joinedOutput

exit $buildExitCode
