# UE_AgentBridge

`UE_AgentBridge` is a standalone Unreal Engine bridge for external coding agents such as Codex app and Claude Code.

The agent stays outside Unreal. Repo reasoning, file edits, git, shell, and build orchestration stay outside Unreal. Unreal Editor is exposed as a bounded localhost tool layer.

The current product shape is plugin-first:

- TypeScript MCP server over stdio
- reusable Unreal project plugin under [`unreal-plugin/UEAgentBridge`](./unreal-plugin/UEAgentBridge)
- `plugin` backend mode for editor-global capabilities
- `remote-control` fallback for asset search and explicit property read/write
- `mock` backend for local tests without Unreal

No manual Remote Control preset setup is required for the normal path anymore.

## Tool Surface

Implemented tools:

- `ue_healthcheck`
- `ue_get_selected_actors`
- `ue_get_level_actors`
- `ue_get_property`
- `ue_set_property`
- `ue_asset_search`
- `ue_get_output_log`
- `ue_get_editor_diagnostics`
- `ue_get_editor_state`
- `ue_get_viewport_camera`
- `ue_set_viewport_camera`
- `ue_frame_actor`
- `ue_get_viewport_screenshot`
- `ue_capture_actor_screenshot`
- `ue_compare_viewport_screenshot`
- `ue_get_debug_draw_state`
- `ue_get_live_coding_status`
- `ue_trigger_live_coding_build_safe`
- `ue_run_console_command_safe`

What stays outside Unreal on purpose:

- repo navigation
- file editing
- git
- shell and build command execution
- project architecture reasoning

For C++ iteration, the recommended build-and-diagnostics loop is documented in [CPP_ITERATION_WORKFLOW.md](./docs/guides/CPP_ITERATION_WORKFLOW.md).
The practical rule is simple: full external `Editor` target builds should run with Unreal Editor closed, while in-editor iteration should use the bridge's Live Coding path after a successful external build.

For agent behavior, the practical operating guide is [AGENT_PLAYBOOK.md](./docs/guides/AGENT_PLAYBOOK.md). Repo-local agent instruction files [AGENTS.md](./AGENTS.md) and [CLAUDE.md](./CLAUDE.md) now point at that playbook instead of carrying separate workflow rules.

Companion agent packages now live in this repo too:

- [AGENT_PACKAGE_STRATEGY.md](./docs/integrations/AGENT_PACKAGE_STRATEGY.md)
- [AGENT_PACKAGE_INSTALL.md](./docs/integrations/AGENT_PACKAGE_INSTALL.md)
- [CLIENT_INTEGRATION.md](./docs/guides/CLIENT_INTEGRATION.md)
- Codex skill source: [`agent-packages/codex-skills/ue-agent-bridge`](./agent-packages/codex-skills/ue-agent-bridge)
- Claude companion instructions: [`agent-packages/claude-code/CLAUDE.md`](./agent-packages/claude-code/CLAUDE.md)

## Backend Modes

### `plugin`

Preferred mode for real use.

Owned by the Unreal plugin:

- `ue_healthcheck`
- `ue_get_selected_actors`
- `ue_get_level_actors`
- `ue_get_output_log`
- `ue_get_editor_diagnostics`
- `ue_get_editor_state`
- `ue_get_viewport_camera`
- `ue_set_viewport_camera`
- `ue_frame_actor`
- `ue_get_viewport_screenshot`
- `ue_capture_actor_screenshot`
- `ue_get_debug_draw_state`
- `ue_get_live_coding_status`
- `ue_trigger_live_coding_build_safe`
- `ue_run_console_command_safe`

Still delegated through Remote Control fallback in this mode:

- `ue_asset_search`
- `ue_get_property`
- `ue_set_property`

### `remote-control`

Legacy M0 path. Still useful as fallback, but no longer the preferred UX.

### `mock`

In-memory backend for local validation without Unreal.

## Unreal Plugin

Plugin source is packaged in this repo at [`unreal-plugin/UEAgentBridge`](./unreal-plugin/UEAgentBridge).

For third-party installation and packaging:

- [THIRD_PARTY_INSTALL.md](./docs/guides/THIRD_PARTY_INSTALL.md)
- [FAB_RELEASE_READINESS.md](./docs/release/FAB_RELEASE_READINESS.md)

Current plugin API:

- `GET /api/v1/health`
- `POST /api/v1/selected-actors`
- `POST /api/v1/level-actors`
- `POST /api/v1/output-log/slice`
- `POST /api/v1/editor-diagnostics`
- `GET /api/v1/editor-state`
- `GET /api/v1/viewport/camera`
- `POST /api/v1/viewport/camera`
- `POST /api/v1/viewport/frame-actor`
- `POST /api/v1/viewport/screenshot`
- `POST /api/v1/debug-draw/state`
- `GET /api/v1/live-coding/status`
- `POST /api/v1/live-coding/build`
- `POST /api/v1/console/run-safe`

The plugin is localhost-only and bounded. It is not a general execution host.

`ue_get_viewport_screenshot` returns a real image block plus bounded metadata so Codex or Claude can verify what is visible in the active editor viewport without guessing from code alone.

`ue_compare_viewport_screenshot` adds an on-demand visual regression path against a reference image on disk, with optional saved current and diff artifacts.

`ue_get_debug_draw_state` returns current line-batcher debug primitives as structured geometry so agents can verify `DrawDebugLine` and similar debug draws from both pixels and semantics.

`ue_get_viewport_camera`, `ue_set_viewport_camera`, and `ue_frame_actor` add bounded camera control for the active viewport so agents can recover from bad framing instead of assuming the subject is already on screen.

`ue_capture_actor_screenshot` is the high-level path for small, distant, or newly generated objects: frame the actor first, then capture the viewport image.

Practical rule:

- use `ue_get_viewport_screenshot` only when the question is visual
- use `ue_get_viewport_camera` before navigation-sensitive visual work when camera state matters
- use `ue_frame_actor` or `ue_capture_actor_screenshot` when the subject may be off-screen, tiny, or far away
- pair `ue_get_debug_draw_state` with `ue_get_viewport_screenshot` for `DrawDebugLine` and debug-geometry checks
- use `ue_compare_viewport_screenshot` for stable regression/evidence checks against a saved reference
- prefer it for `DrawDebugLine`, debug geometry, material/layout regressions, and viewport-only rendering checks
- do not stream screenshots continuously into context; capture on demand after a meaningful state change
- save screenshots or diff artifacts only when they materially improve debugging or reporting

`ue_get_editor_diagnostics` now does more than echo raw log rows:

- aggregates bounded diagnostics from both the plugin output-log buffer and stable Unreal `MessageLog` listings
- deduplicates repeated entries
- prioritizes compiler, PIE, Blueprint, and Live Coding failures over generic warnings
- extracts `filePath`, `line`, and `column` when Unreal output includes compiler-style locations

Current limitation:

- Unreal 5.7 Live Coding still often reports C++ compile failures only as a generic `LogLiveCoding` error in plugin-visible channels, so file and line extraction is best-effort rather than guaranteed for every live compile failure

## Safe Boundaries

Still intentionally unsupported:

- arbitrary Unreal command execution
- raw free-form console command execution
- Blueprint authoring
- actor spawning and deletion as generic agent tools
- save-all or project-wide destructive mutation
- output-log streaming or subscriptions
- generic helper registries
- generic command dispatch
- moving repo awareness into Unreal

`ue_run_console_command_safe` is deny-by-default and allowlist-based. Supported command IDs:

- `stat_fps`
- `stat_unit`
- `stat_memory`
- `show_bounds`
- `show_collision`
- `show_navigation`

`ue_trigger_live_coding_build_safe` is also narrow:

- it only asks Unreal to do a safe Live Coding compile/reload when the editor reports readiness
- it does not replace the external repo/shell build loop

## Install

Requirements:

- Node.js 20+
- Unreal Engine 5.7 tested on Windows

Install JS dependencies:

```bash
npm install
```

Install the Unreal plugin into a target project:

1. run `powershell -ExecutionPolicy Bypass -File .\scripts\sync-ue-plugin.ps1 -ProjectRoot "<YourProjectRoot>"`
2. build `<YourProject>Editor`
3. launch Unreal Editor

Build a distributable plugin zip:

```bash
npm run package:plugin
```

That stages a clean plugin package under `artifacts/plugin-package` and creates a zip that can be tested as a third-party install candidate.

For a live-tested integration target, the plugin was installed as:

- `<ProjectRoot>\Plugins\UEAgentBridge`

Important:

- run the sync script with Unreal Editor closed
- the script now refuses to mirror plugin files into a live editor session unless you explicitly add `-CloseEditor`
- daily operator flow is captured in [PLUGIN_RUNBOOK.md](./docs/guides/PLUGIN_RUNBOOK.md)

## Configuration

Environment variables:

- `UE_BACKEND_MODE=mock|remote-control|plugin`
- `UE_LOG_LEVEL=debug|info|warn|error`
- `UE_REQUEST_TIMEOUT_MS=5000`
- `UE_RC_HOST=127.0.0.1`
- `UE_RC_PORT=30010`
- `UE_PLUGIN_HOST=127.0.0.1`
- `UE_PLUGIN_PORT=30110`

All Unreal host settings are loopback-only by design.

Optional Unreal-side config for the plugin port:

```ini
[UEAgentBridge]
Port=30110
```

## Run

Mock mode:

```bash
npm run dev
```

Plugin mode:

```bash
UE_BACKEND_MODE=plugin npm run dev
```

Plugin smoke validation:

```bash
npm run build
npm run smoke:plugin
```

Bridge process cleanup if stale stdio servers accumulate:

```bash
powershell -ExecutionPolicy Bypass -File .\scripts\stop-ue-agent-bridge.ps1
```

Build and run:

```bash
npm run build
npm start
```

Checks:

```bash
npm run typecheck
npm test
```

Build-log parsing helper:

```bash
npm run build
node scripts/parse-ue-build-log.mjs <path-to-build-log>
```

External `Editor` target build guard:

- `scripts/run-ue-build.ps1 -EditorTarget` now fails early with a clear message if Unreal Editor is already running for the same project
- this avoids the less useful late linker failure caused by a locked `UnrealEditor-<Project>.dll`

## Quick Start

### Local mock validation

1. `npm install`
2. `npm test`
3. `npm run dev`
4. run `ue_healthcheck`

### Real Unreal validation

1. install the `UEAgentBridge` plugin into the target Unreal project
2. make sure Unreal Editor is running locally
3. keep Remote Control enabled locally for:
   - `ue_asset_search`
   - `ue_get_property`
   - `ue_set_property`
4. start the bridge with `UE_BACKEND_MODE=plugin`
5. run:
   - `ue_healthcheck`
   - `ue_get_level_actors`
   - `ue_get_output_log`
   - `ue_get_editor_state`
   - `ue_get_viewport_camera`
   - `ue_frame_actor`
   - `ue_get_debug_draw_state`
   - `ue_capture_actor_screenshot`
   - `ue_get_live_coding_status`
6. optional repeatable smoke:
   - `npm run build`
   - `npm run smoke:plugin`

## Current Validation Status

Automated checks passing:

- `npm run typecheck`
- `npm test`
- `npm run build`

Live-tested against a local Unreal project:

- plugin health endpoint reachable on `127.0.0.1:30110`
- `ue_get_selected_actors` with non-empty selection
- `ue_healthcheck`
- `ue_get_level_actors`
- `ue_get_output_log`
- `ue_get_editor_diagnostics`
- `ue_get_editor_state`
- `ue_get_viewport_camera`
- `ue_set_viewport_camera`
- `ue_frame_actor`
- `ue_get_debug_draw_state`
- `ue_get_viewport_screenshot`
- `ue_capture_actor_screenshot`
- `ue_get_live_coding_status`
- `ue_trigger_live_coding_build_safe`
- `ue_run_console_command_safe`
- `ue_asset_search`
- `ue_get_property`
- `ue_set_property`
- external editor-target build through `Build.bat`
- external build-log parsing into structured JSON diagnostics
- packaged plugin zip install into `<ProjectRoot>\Plugins\UEAgentBridge`
- restart and smoke validation after packaged zip install

## Architecture

The code is split into:

- MCP layer: tool registration, validation, formatting, and error handling
- backend layer: Unreal transport adapters
- Unreal plugin package: bounded editor-side backend

Repo layout:

```text
docs/
  archive/
  contracts/
  guides/
  integrations/
  planning/
  release/
src/
  backend/
  config/
  server/
  tools/
  types/
  utils/
test/
unreal-plugin/
  UEAgentBridge/
```

## Contributing

Contributions are welcome.

Start with [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a pull request.
For workflow-sensitive changes, keep the repo/Unreal boundary aligned with [AGENT_PLAYBOOK.md](./docs/guides/AGENT_PLAYBOOK.md).

## License

This project is released under the [MIT License](./LICENSE).

## Documentation

Documentation is grouped under [`docs/`](./docs/README.md):

- guides: [AGENT_PLAYBOOK.md](./docs/guides/AGENT_PLAYBOOK.md), [CPP_ITERATION_WORKFLOW.md](./docs/guides/CPP_ITERATION_WORKFLOW.md), [PLUGIN_RUNBOOK.md](./docs/guides/PLUGIN_RUNBOOK.md), [THIRD_PARTY_INSTALL.md](./docs/guides/THIRD_PARTY_INSTALL.md), [CLIENT_INTEGRATION.md](./docs/guides/CLIENT_INTEGRATION.md)
- integrations: [AGENT_PACKAGE_STRATEGY.md](./docs/integrations/AGENT_PACKAGE_STRATEGY.md), [AGENT_PACKAGE_INSTALL.md](./docs/integrations/AGENT_PACKAGE_INSTALL.md)
- release: [RELEASE_CHECKLIST.md](./docs/release/RELEASE_CHECKLIST.md), [GITHUB_PUBLISH_CHECKLIST.md](./docs/release/GITHUB_PUBLISH_CHECKLIST.md), [FAB_RELEASE_READINESS.md](./docs/release/FAB_RELEASE_READINESS.md), [SAFE_MUTATION_VERIFICATION.md](./docs/release/SAFE_MUTATION_VERIFICATION.md)
- contracts: [M1_PLUGIN_CONTRACT.md](./docs/contracts/M1_PLUGIN_CONTRACT.md), [REMOTE_CONTROL_CONTRACT.md](./docs/contracts/REMOTE_CONTROL_CONTRACT.md), [SELECTED_ACTORS_HELPER_CONTRACT.md](./docs/contracts/SELECTED_ACTORS_HELPER_CONTRACT.md), [OUTPUT_LOG_HELPER_CONTRACT.md](./docs/contracts/OUTPUT_LOG_HELPER_CONTRACT.md), [CONSOLE_COMMAND_HELPER_CONTRACT.md](./docs/contracts/CONSOLE_COMMAND_HELPER_CONTRACT.md)
- planning: [M1_BACKLOG.md](./docs/planning/M1_BACKLOG.md), [M1_PLUGIN_FIRST_PLAN.md](./docs/planning/M1_PLUGIN_FIRST_PLAN.md), [M1_PLUGIN_IMPLEMENTATION_ORDER.md](./docs/planning/M1_PLUGIN_IMPLEMENTATION_ORDER.md)
- archive: [PROJECT_FRAMING.md](./docs/archive/PROJECT_FRAMING.md), [M0_SCOPE.md](./docs/archive/M0_SCOPE.md), [DECISIONS.md](./docs/archive/DECISIONS.md), [AGENT_USAGE_MODEL.md](./docs/archive/AGENT_USAGE_MODEL.md), [UNREAL_EXPOSURE_PLAN.md](./docs/archive/UNREAL_EXPOSURE_PLAN.md), [IMPLEMENTATION_ORDER.md](./docs/archive/IMPLEMENTATION_ORDER.md), [REFERENCE_REPOS.md](./docs/archive/REFERENCE_REPOS.md)
