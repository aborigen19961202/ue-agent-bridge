# Third-Party Install Guide

This is the install path for someone who receives the `UEAgentBridge` Unreal plugin package and wants to use it with their own project.

## What They Need

- Unreal Engine 5.7 on Windows
- a local Unreal project
- the `UEAgentBridge` plugin folder or packaged zip
- the TypeScript bridge from this repository

## Project Plugin Install

1. Close Unreal Editor.
2. Copy `UEAgentBridge` into:
   - `<YourProject>\Plugins\UEAgentBridge`
3. Build `<YourProject>Editor`.
4. Launch Unreal Editor.
5. Enable Remote Control for fallback tools:
   - `ue_asset_search`
   - `ue_get_property`
   - `ue_set_property`
6. Start the bridge with:
   - `UE_BACKEND_MODE=plugin`

## Engine Plugin Install

Use this when the same engine installation will serve multiple projects.

1. Close Unreal Editor.
2. Copy `UEAgentBridge` into:
   - `<Engine>\Engine\Plugins\Marketplace\UEAgentBridge`
3. Rebuild or reopen the target project.
4. Keep the bridge in `plugin` mode.

## What Works In Plugin Mode

Plugin-owned tools:

- `ue_healthcheck`
- `ue_get_selected_actors`
- `ue_get_level_actors`
- `ue_get_output_log`
- `ue_get_editor_diagnostics`
- `ue_get_editor_state`
- `ue_get_live_coding_status`
- `ue_trigger_live_coding_build_safe`
- `ue_run_console_command_safe`

Remote Control fallback still required for:

- `ue_asset_search`
- `ue_get_property`
- `ue_set_property`

## C++ Workflow Expectation

- edit and build C++ outside Unreal
- use `scripts/run-ue-build.ps1` for repeatable external builds
- if the build succeeds and Unreal is open, use Live Coding tools through the bridge
- if the build fails, trust the parsed external JSON diagnostics first

## What This Package Does Not Do

It does not:

- provide repo awareness inside Unreal
- replace Codex or Claude Code
- expose arbitrary Unreal execution
- expose arbitrary console commands
- eliminate the need for the external bridge process

## Recommended Companion Docs

- [README.md](./README.md)
- [PLUGIN_RUNBOOK.md](./PLUGIN_RUNBOOK.md)
- [CPP_ITERATION_WORKFLOW.md](./CPP_ITERATION_WORKFLOW.md)
- [AGENT_PLAYBOOK.md](./AGENT_PLAYBOOK.md)
