# Release Checklist

## Build And Test

- run `npm run typecheck`
- run `npm test`
- run `npm run build`
- confirm no failing tests or TypeScript errors remain

## Mock Mode Validation

- run `npm run dev` with default mock mode
- verify `ue_healthcheck` reports mock mode clearly
- verify at least one read tool such as `ue_get_level_actors`
- verify at least one write path such as `ue_set_property`
- verify `ue_run_console_command_safe` using an allowlisted `commandId`

## Remote-Control Mode Validation

- enable Unreal Remote Control locally
- set `UE_BACKEND_MODE=remote-control`
- confirm loopback host configuration is accepted
- run `ue_healthcheck`
- verify direct tools:
  - `ue_asset_search`
  - `ue_get_level_actors`
  - `ue_get_property`
  - `ue_set_property`

## Helper Readiness Validation

- confirm `ue_healthcheck` reports preset availability honestly
- confirm `ue_healthcheck` reports helper readiness honestly
- verify the preset payload appears to expose:
  - `GetSelectedActors`
  - `GetOutputLogSlice`
  - `RunSafeConsoleCommand`

## Unreal Preset And Helper Setup

- confirm preset name is exactly `UE_AgentBridge_M0`
- confirm selected-actors helper route works:
  - `PUT /remote/preset/UE_AgentBridge_M0/function/GetSelectedActors`
- confirm output-log helper route works:
  - `PUT /remote/preset/UE_AgentBridge_M0/function/GetOutputLogSlice`
- confirm safe-console helper route works:
  - `PUT /remote/preset/UE_AgentBridge_M0/function/RunSafeConsoleCommand`
- confirm helper responses match the documented wrapper shapes

## Bounded Behavior Checks

- confirm selected-actor helper can return an empty selection successfully
- confirm output-log helper respects requested limits and bounded snapshot behavior
- confirm safe-console helper rejects unknown command IDs
- confirm no helper accepts arbitrary command strings or generic execution requests

## Documentation Review

- confirm [README.md](../../README.md) matches the real implemented M0 surface
- confirm helper contract docs match the backend request and response shapes
- confirm unsupported scope is stated clearly
- confirm quick-start validation steps are accurate

## Example Usage Sanity Check

- run one direct tool end to end from an MCP client
- run one helper-backed read tool end to end from an MCP client
- run `ue_run_console_command_safe` with one allowlisted `commandId`
- confirm error messages are understandable for:
  - helper unavailable
  - malformed helper response
  - backend unavailable

## Version And Tagging Readiness

- confirm `package.json` version is correct for the release
- confirm changelog entry exists for the release
- confirm no M1 work was mixed into M0 freeze
- prepare release tag after final manual validation
