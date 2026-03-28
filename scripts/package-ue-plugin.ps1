param(
  [string]$OutputDir,
  [switch]$Clean
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$pluginSource = Join-Path $repoRoot "unreal-plugin\UEAgentBridge"
$upluginPath = Join-Path $pluginSource "UEAgentBridge.uplugin"

if (-not (Test-Path $pluginSource)) {
  throw "Plugin source not found: $pluginSource"
}

if (-not (Test-Path $upluginPath)) {
  throw "Plugin descriptor not found: $upluginPath"
}

if (-not $OutputDir) {
  $OutputDir = Join-Path $repoRoot "artifacts\plugin-package"
}

if ($Clean -and (Test-Path $OutputDir)) {
  Remove-Item -Recurse -Force $OutputDir
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

$uplugin = Get-Content -Raw -Path $upluginPath | ConvertFrom-Json
$versionName = if ($uplugin.VersionName) { [string]$uplugin.VersionName } else { "0.0.0" }

$stageRoot = Join-Path $OutputDir "UEAgentBridge-$versionName"
$stagePluginRoot = Join-Path $stageRoot "UEAgentBridge"
$zipPath = Join-Path $OutputDir "UEAgentBridge-$versionName.zip"

if (Test-Path $stageRoot) {
  Remove-Item -Recurse -Force $stageRoot
}

robocopy $pluginSource $stagePluginRoot /MIR /NFL /NDL /NJH /NJS /NP /XD Binaries Intermediate .git | Out-Null

New-Item -ItemType Directory -Force -Path (Join-Path $stagePluginRoot "Config") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $stagePluginRoot "Content") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $stagePluginRoot "Resources") | Out-Null

$stagedUpluginPath = Join-Path $stagePluginRoot "UEAgentBridge.uplugin"
$stagedUplugin = Get-Content -Raw -Path $stagedUpluginPath | ConvertFrom-Json
$stagedUplugin.Installed = $true
$stagedUplugin | ConvertTo-Json -Depth 20 | Set-Content -Path $stagedUpluginPath -Encoding UTF8

$installReadme = @"
UE Agent Bridge plugin package

Install as a project plugin:
1. Close Unreal Editor.
2. Copy the UEAgentBridge folder into <YourProject>\Plugins\UEAgentBridge
3. Build <YourProject>Editor
4. Launch Unreal Editor

Install as an engine plugin:
1. Close Unreal Editor.
2. Copy the UEAgentBridge folder into <Engine>\Engine\Plugins\Marketplace\UEAgentBridge
3. Build or reopen the target project

Bridge runtime notes:
- use UE_BACKEND_MODE=plugin for the preferred path
- keep Remote Control enabled for ue_asset_search, ue_get_property, and ue_set_property fallback
"@

$installReadme | Set-Content -Path (Join-Path $stageRoot "INSTALL.txt") -Encoding UTF8

if (Test-Path $zipPath) {
  Remove-Item -Force $zipPath
}

Compress-Archive -Path (Join-Path $stageRoot "*") -DestinationPath $zipPath -CompressionLevel Optimal

Write-Host "Staged plugin package: $stageRoot"
Write-Host "Created zip package: $zipPath"
