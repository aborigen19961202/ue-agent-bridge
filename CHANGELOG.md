# Changelog

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
