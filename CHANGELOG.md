# Changelog

## 0.2.0 - Plugin-First Bridge

Plugin-first release of `UE_AgentBridge`.

### Added

- Unreal project plugin package under [`unreal-plugin/UEAgentBridge`](./unreal-plugin/UEAgentBridge)
- `plugin` backend mode in the TypeScript bridge
- distributable plugin packaging script at [`scripts/package-ue-plugin.ps1`](./scripts/package-ue-plugin.ps1)
- third-party install and Fab readiness docs:
  - [`THIRD_PARTY_INSTALL.md`](./THIRD_PARTY_INSTALL.md)
  - [`FAB_RELEASE_READINESS.md`](./FAB_RELEASE_READINESS.md)
- plugin-owned endpoints for:
  - `ue_healthcheck`
  - `ue_get_selected_actors`
  - `ue_get_level_actors`
  - `ue_get_output_log`
  - `ue_get_editor_diagnostics`
  - `ue_get_editor_state`
  - `ue_get_live_coding_status`
  - `ue_trigger_live_coding_build_safe`
  - `ue_run_console_command_safe`
- live coding status and safe build trigger support
- bounded editor diagnostics snapshot
- plugin backend tests

### Architectural Decisions

- plugin mode is now the preferred integration path
- manual Remote Control preset setup is no longer the normal workflow
- Remote Control remains as a bounded fallback for:
  - `ue_asset_search`
  - `ue_get_property`
  - `ue_set_property`
- build orchestration stays outside Unreal
- Live Coding is exposed only through a narrow readiness/status/build surface

### Validation Surface

- typecheck, tests, and build pass for the TypeScript bridge
- a local `<ProjectName>Editor` build succeeded with the installed `UEAgentBridge` plugin
- live Unreal validation passed for plugin mode on a local editor session
- packaged plugin zip install was validated by reinstalling into a local Unreal project, rebuilding, restarting the editor, and rerunning plugin smoke validation

## 0.1.0 - M0

Initial M0 release of `UE_AgentBridge`.

### Added

- TypeScript MCP server over stdio
- localhost-only Unreal backend boundary
- full eight-tool M0 surface
- mock backend for local validation without Unreal
- Remote Control-backed implementation for:
  - `ue_healthcheck`
  - `ue_asset_search`
  - `ue_get_level_actors`
  - `ue_get_property`
  - `ue_set_property`
  - `ue_get_selected_actors`
  - `ue_get_output_log`
  - `ue_run_console_command_safe`

### Architectural Decisions

- external repo-aware agent remains outside Unreal Editor
- Unreal is treated as a first-class structured tool layer
- MCP transport uses stdio
- Unreal transport uses localhost Remote Control HTTP
- direct documented Remote Control routes are used where honest
- helper-backed tools are exposed only through named preset functions
- object identity is centered on canonical Unreal `objectPath`
- M0 stays deny-by-default and bounded

### Safety Boundaries

- no arbitrary execution
- no generic helper dispatch
- no actor spawning or deletion
- no Blueprint authoring
- no save-all behavior
- no output-log streaming or subscriptions
- no arbitrary console command execution
- safe console execution uses fixed allowlisted `commandId` values only

### Helper Contracts

- [SELECTED_ACTORS_HELPER_CONTRACT.md](/E:/Projects/AgentSkills/UE_AgentBridge/SELECTED_ACTORS_HELPER_CONTRACT.md)
- [OUTPUT_LOG_HELPER_CONTRACT.md](/E:/Projects/AgentSkills/UE_AgentBridge/OUTPUT_LOG_HELPER_CONTRACT.md)
- [CONSOLE_COMMAND_HELPER_CONTRACT.md](/E:/Projects/AgentSkills/UE_AgentBridge/CONSOLE_COMMAND_HELPER_CONTRACT.md)

### Validation Surface

- unit tests cover mock mode and remote-control mode request/response normalization
- typecheck, tests, and build pass for the frozen M0 surface
