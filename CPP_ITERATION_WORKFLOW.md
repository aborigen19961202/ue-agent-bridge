# C++ Iteration Workflow

This is the recommended loop when an external coding agent changes Unreal C++ code.

The boundary stays explicit:

- code editing and project build stay outside Unreal
- Unreal is used afterward for editor state, output log, diagnostics, and optional Live Coding

## Why This Split Exists

For C++ compile failures, the most reliable diagnostics come from the external build toolchain:

- UnrealBuildTool
- MSVC compiler output
- linker output

`ue_get_editor_diagnostics` is still useful, but it should be treated as:

- editor/runtime signal
- PIE/Blueprint/message-log signal
- Live Coding readiness/result signal

It is not the source of truth for every compiler line in every failed build.

## Recommended Loop

1. Edit C++ in the repo.
2. Run a normal project build outside Unreal.
3. Keep the workflow split honest:
   - if you are doing a full `Editor` target build, close Unreal Editor first
   - if Unreal Editor is already open and you only need in-editor iteration, use the Live Coding path after the external build step
4. Parse the build log into structured diagnostics.
5. If the build succeeded and Unreal Editor is open, check:
   - `ue_get_live_coding_status`
   - `ue_trigger_live_coding_build_safe`
   - `ue_get_editor_diagnostics`
   - `ue_get_output_log`
6. If the build failed, trust the parsed external build diagnostics first.

## Build Script

Use the bundled PowerShell helper:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run-ue-build.ps1 `
  -ProjectRoot "E:\UnrealEngine\Projects\CleanModelFactory" `
  -ProjectName "CleanModelFactory" `
  -EditorTarget
```

Outputs:

- raw build log in `<Project>\Saved\UEAgentBridgeBuild\*.log`
- parsed diagnostics in `<Project>\Saved\UEAgentBridgeBuild\*.json`

If Unreal Editor is still running for the same project, the wrapper fails early with a clear explanation instead of letting the build reach a linker failure on a locked editor DLL.

## Standalone Log Parsing

If a raw build log already exists:

```powershell
npm run build
node .\scripts\parse-ue-build-log.mjs "E:\UnrealEngine\Projects\CleanModelFactory\Saved\UEAgentBridgeBuild\CleanModelFactoryEditor-20260311-120000.log"
```

## Parsed Diagnostic Shape

The parser currently normalizes:

- `source`: `msvc` or `ubt`
- `severity`: `info`, `warning`, or `error`
- `message`
- `raw`
- optional `code`
- optional `filePath`
- optional `line`
- optional `column`

This is the intended source of truth for C++ compile failures in the agent loop.
