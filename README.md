# UE_AgentBridge

`UE_AgentBridge` lets tools like Codex and Claude work with a live Unreal Editor session without turning Unreal into your IDE or your build system.

In plain terms: your agent can inspect actors, read logs, check editor state, frame the viewport, capture screenshots, and trigger a few safe editor actions, while code edits, builds, git, and project reasoning stay in the normal repo workflow.

The project is plugin-first:

- TypeScript MCP server over stdio
- reusable Unreal project plugin under [`unreal-plugin/UEAgentBridge`](./unreal-plugin/UEAgentBridge)
- `plugin` mode for normal live-editor use
- `remote-control` fallback for asset search and explicit property reads/writes
- `mock` mode for local validation without Unreal

## What It Does

It helps solve the usual "AI can edit code but cannot really see Unreal" problem.

With `UE_AgentBridge`, an external agent can:

- check whether the editor is ready and connected
- inspect selected actors, level actors, and object properties
- make narrow, explicit property changes
- read output log slices and editor diagnostics
- move the viewport camera and capture useful screenshots
- inspect debug draw output for visual debugging
- check Live Coding readiness and trigger a safe reload path
- run only a small allowlisted set of safe console actions

What stays outside Unreal on purpose:

- repo navigation
- file editing
- git
- shell and build command execution
- architecture and code reasoning

That separation is the point: Unreal becomes a reliable source of live editor state, not a giant uncontrolled execution surface.

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
