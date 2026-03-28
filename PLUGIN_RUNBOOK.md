# Plugin Runbook

This is the shortest repeatable daily workflow for the plugin-first bridge.

## Install or Update The Unreal Plugin

Run with Unreal Editor closed:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\sync-ue-plugin.ps1 -ProjectRoot "<ProjectRoot>"
```

The sync script:

- mirrors [`unreal-plugin/UEAgentBridge`](./unreal-plugin/UEAgentBridge) into `<Project>/Plugins/UEAgentBridge`
- ensures the plugin is enabled in the `.uproject`
- refuses to run against a live Unreal Editor session unless you explicitly pass `-CloseEditor`

## Build The Target Project

```powershell
& '<EngineRoot>\Engine\Build\BatchFiles\Build.bat' <ProjectName>Editor Win64 Development -Project='<ProjectRoot>\<ProjectName>.uproject' -WaitMutex -NoHotReloadFromIDE
```

For repeatable agent use, prefer the wrapper:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run-ue-build.ps1 -ProjectRoot "<ProjectRoot>" -ProjectName "<ProjectName>" -EditorTarget
```

Important:

- this `Editor` target wrapper is for closed-editor builds
- if Unreal Editor is already open for the same project, the wrapper now stops early with a clear message instead of waiting for a linker failure on a locked DLL
- for in-editor iteration after a successful external build, prefer `ue_get_live_coding_status` and `ue_trigger_live_coding_build_safe`

That wrapper stores:

- raw build output
- parsed JSON diagnostics

The C++ iteration model is documented in [CPP_ITERATION_WORKFLOW.md](./CPP_ITERATION_WORKFLOW.md).

## Launch Unreal Editor

```powershell
Start-Process -FilePath '<EngineRoot>\Engine\Binaries\Win64\UnrealEditor.exe' -ArgumentList '"<ProjectRoot>\<ProjectName>.uproject"'
```

## Start The Bridge

```powershell
$env:UE_BACKEND_MODE='plugin'
npm run dev
```

## Run A Repeatable Smoke Test

```powershell
npm run build
npm run smoke:plugin
```

The smoke script validates:

- plugin health
- selected actors
- level actors
- output log slice
- editor diagnostics
- editor state
- live coding status
- safe live coding build trigger
- allowlisted safe console execution
- Remote Control fallback for asset search and property read/write

## Optional Unreal Config

Default plugin port is `30110`.

To override it without command-line flags, add this to Unreal config:

```ini
[UEAgentBridge]
Port=30110
```

Then point the bridge at the same port with:

```powershell
$env:UE_PLUGIN_PORT='30110'
```
