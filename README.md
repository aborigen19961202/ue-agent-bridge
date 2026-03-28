# UE_AgentBridge

`UE_AgentBridge` is a standalone Unreal Engine bridge for external coding agents such as Codex app and Claude Code.

The agent stays outside Unreal. Repo reasoning, file edits, git, shell, and build orchestration stay outside Unreal. Unreal Editor is exposed as a bounded localhost tool layer.

`UE_AgentBridge` is plugin-first:

- TypeScript MCP server over stdio
- reusable Unreal project plugin under [`unreal-plugin/UEAgentBridge`](./unreal-plugin/UEAgentBridge)
- `plugin` mode for normal live-editor use
- `remote-control` fallback for asset search and explicit property reads/writes
- `mock` mode for local validation without Unreal

## What It Does

The bridge gives external agents a bounded Unreal tool surface for:

- editor readiness and health checks
- selected actors, level actors, and property reads
- bounded property writes
- output log and editor diagnostics
- viewport camera control and framed screenshots
- debug draw inspection and visual verification
- safe Live Coding status/build actions
- a deny-by-default safe console command surface

What stays outside Unreal on purpose:

- repo navigation
- file editing
- git
- shell and build command execution
- architecture and code reasoning

The Unreal plugin is localhost-only and intentionally narrow. It is not a generic execution host.

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

That stages a clean plugin package under `artifacts/plugin-package` and creates a zip for third-party installation testing.

## Quick Start

### Local mock validation

1. `npm install`
2. `npm test`
3. `npm run dev`
4. run `ue_healthcheck`

### Real Unreal validation

1. install the `UEAgentBridge` plugin into the target Unreal project
2. make sure Unreal Editor is running locally
3. keep Remote Control enabled for `ue_asset_search`, `ue_get_property`, and `ue_set_property`
4. start the bridge with `UE_BACKEND_MODE=plugin`
5. run `ue_healthcheck`
6. exercise a few live tools such as `ue_get_level_actors`, `ue_get_output_log`, `ue_get_editor_state`, `ue_frame_actor`, and `ue_get_live_coding_status`

### Build, run, and checks

```bash
npm run typecheck
npm test
npm run build
npm run dev
```

For repeatable plugin smoke validation:

```bash
npm run build
npm run smoke:plugin
```

For C++ iteration, use the external build loop in [CPP_ITERATION_WORKFLOW.md](./docs/guides/CPP_ITERATION_WORKFLOW.md). Full external `Editor` target builds should run with Unreal Editor closed, while in-editor iteration should use the bridge's Live Coding path after a successful external build.

## Architecture

The repository is split into:

- MCP layer: tool registration, validation, formatting, and error handling
- backend layer: Unreal transport adapters
- Unreal plugin package: bounded editor-side backend
- docs: operator guides, release notes, contracts, and archive material

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

Most users only need the core guides:

- [AGENT_PLAYBOOK.md](./docs/guides/AGENT_PLAYBOOK.md)
- [CPP_ITERATION_WORKFLOW.md](./docs/guides/CPP_ITERATION_WORKFLOW.md)
- [PLUGIN_RUNBOOK.md](./docs/guides/PLUGIN_RUNBOOK.md)
- [THIRD_PARTY_INSTALL.md](./docs/guides/THIRD_PARTY_INSTALL.md)
- [CLIENT_INTEGRATION.md](./docs/guides/CLIENT_INTEGRATION.md)

Full documentation index:

- [docs/README.md](./docs/README.md)

Useful starting points:

- [AGENT_PLAYBOOK.md](./docs/guides/AGENT_PLAYBOOK.md) for the intended repo/Unreal operating model
- [PLUGIN_RUNBOOK.md](./docs/guides/PLUGIN_RUNBOOK.md) for day-to-day plugin workflow
- [THIRD_PARTY_INSTALL.md](./docs/guides/THIRD_PARTY_INSTALL.md) for installation outside this repo
- [FAB_RELEASE_READINESS.md](./docs/release/FAB_RELEASE_READINESS.md) for marketplace preparation

Internal planning, contracts, release checklists, and historical notes remain available from the full docs index.
