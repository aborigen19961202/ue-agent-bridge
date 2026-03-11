# UE_AgentBridge

UE_AgentBridge is a standalone Unreal Engine bridge for external coding agents such as Codex app and Claude Code.

This repository now contains the frozen M0 release surface:

- a TypeScript MCP server over stdio
- a strict eight-tool M0 surface
- a backend adapter boundary
- a working mock backend for local testing
- a localhost Remote Control backend for the full narrow M0 tool surface

The external agent remains outside Unreal. Repository reasoning, file editing, git, shell usage, and architecture analysis stay outside the bridge.

## M0 Tool Surface

Only these tools are implemented:

- `ue_healthcheck`
- `ue_get_selected_actors`
- `ue_get_level_actors`
- `ue_get_property`
- `ue_set_property`
- `ue_asset_search`
- `ue_get_output_log`
- `ue_run_console_command_safe`

No arbitrary execution, Blueprint authoring, actor spawning, actor deletion, async orchestration, GraphQL, or C++/Live Coding workflow support is included in M0.

M0 is intentionally narrow and controlled.

## Architecture

The code is split into two layers:

- MCP layer: tool registration, argument validation, result formatting, and error handling
- Unreal backend layer: the adapter boundary that can talk to Unreal through a concrete implementation

Current backends:

- `mock`: fully usable without Unreal, intended for local testing and scaffold verification
- `remote-control`: localhost-only Unreal Remote Control backend for the direct M0 routes plus the narrow helper contracts for `ue_get_selected_actors`, `ue_get_output_log`, and `ue_run_console_command_safe`

That split keeps M0 small while making later Unreal-side expansion possible without breaking the MCP surface.

## Repository Layout

```text
src/
  backend/
  config/
  server/
  tools/
  types/
  utils/
test/
```

## Setup

Requirements:

- Node.js 20+

Install dependencies:

```bash
npm install
```

## Run

Default mock mode:

```bash
npm run dev
```

Build and run:

```bash
npm run build
npm start
```

Typecheck:

```bash
npm run typecheck
```

Tests:

```bash
npm test
```

## Quick Start Validation

Mock mode:

1. `npm install`
2. `npm test`
3. `npm run dev`
4. connect an MCP client to the stdio server and run `ue_healthcheck`

Remote Control mode:

1. enable Unreal Remote Control locally
2. configure `UE_BACKEND_MODE=remote-control`
3. make sure the `UE_AgentBridge_M0` preset and helper functions are exposed
4. run `npm run dev`
5. run `ue_healthcheck`
6. validate one direct tool such as `ue_asset_search`
7. validate one helper-backed tool such as `ue_get_selected_actors`

## Configuration

Environment variables:

- `UE_BACKEND_MODE=mock|remote-control`
- `UE_LOG_LEVEL=debug|info|warn|error`
- `UE_RC_HOST=127.0.0.1`
- `UE_RC_PORT=30010`
- `UE_REQUEST_TIMEOUT_MS=5000`

M0 enforces loopback-only Remote Control host configuration. Non-local hosts are rejected at startup.

## Current State

### Implemented M0 Surface

- MCP server scaffold
- tool registration and validation
- error handling and minimal logging
- mock backend behavior for all eight M0 tools
- safe console command allowlist enforcement
- config loading
- unit tests for the safety boundary, mock behavior, and the full M0 surface
- real Remote Control-backed `ue_healthcheck`
- real Remote Control-backed `ue_get_selected_actors`
- real Remote Control-backed `ue_get_output_log`
- real Remote Control-backed `ue_run_console_command_safe`
- real Remote Control-backed `ue_asset_search`
- real Remote Control-backed `ue_get_level_actors`
- real Remote Control-backed `ue_get_property`
- real Remote Control-backed `ue_set_property`

### Direct Remote Control-Backed Tools

- `ue_healthcheck`
- `ue_asset_search`
- `ue_get_level_actors`
- `ue_get_property`
- `ue_set_property`

### Helper-Backed Tools

- `ue_get_selected_actors`
- `ue_get_output_log`
- `ue_run_console_command_safe`

These helper-backed tools are still part of M0, but only through fixed preset-function contracts. M0 does not expose a broad helper framework.

### M0 Freeze Boundary

M0 is complete when:

- all eight approved M0 tools are implemented
- direct Remote Control-backed tools use documented routes only
- helper-backed tools use named preset functions with fixed response contracts
- build, typecheck, and tests pass
- mock mode and remote-control mode can both be validated locally
- arbitrary execution remains unsupported

### Intentionally Unsupported In M0

- arbitrary Unreal console execution
- output-log streaming or subscriptions
- actor spawning and deletion
- Blueprint authoring
- save-all or project-wide mutation
- C++ build, compile, Live Coding, or automation workflows
- broad helper registries or generic helper dispatch

The bridge keeps helper-backed operations narrow and explicit instead of exposing a broad Unreal helper surface.

## Safe Console Commands

`ue_run_console_command_safe` is deny-by-default.

The tool accepts only one allowlisted `commandId`, not a raw console command string.

The current M0 command IDs are:

- `stat_fps`
- `stat_unit`
- `stat_memory`
- `show_bounds`
- `show_collision`
- `show_navigation`

Each ID maps to exactly one Unreal console command on both the TypeScript side and the Unreal helper side. Arbitrary console execution remains intentionally unsupported.

## Unreal-side Setup Still Needed

For real Unreal integration beyond mock mode, the following still needs to be provided by the target Unreal project:

1. Unreal Editor running locally
2. Remote Control enabled and reachable on localhost
3. The standard Remote Control routes needed in this step:
   - `GET /remote/info`
   - `PUT /remote/object/call`
   - `PUT /remote/object/describe`
   - `PUT /remote/object/property`
   - `PUT /remote/search/assets`
4. Editor Scripting Utilities available so `EditorLevelLibrary.GetAllLevelActors` can be called
5. The M0 preset and helper functions:
   - preset: `UE_AgentBridge_M0`
- `GetSelectedActors`
- `GetOutputLogSlice`
- `RunSafeConsoleCommand`
6. If helper-backed tools are evolved later, an agreed exposure contract for:
   - current selected actors
   - output log access
   - safe console command dispatch

For `ue_get_selected_actors`, the current contract is intentionally narrow:

- preset name: `UE_AgentBridge_M0`
- function name: `GetSelectedActors`
- route: `PUT /remote/preset/UE_AgentBridge_M0/function/GetSelectedActors`
- expected wrapper: `ReturnedValues[0].Actors`

The full helper contract is documented in [SELECTED_ACTORS_HELPER_CONTRACT.md](./SELECTED_ACTORS_HELPER_CONTRACT.md).

For `ue_get_output_log`, the current contract is also intentionally narrow:

- preset name: `UE_AgentBridge_M0`
- function name: `GetOutputLogSlice`
- route: `PUT /remote/preset/UE_AgentBridge_M0/function/GetOutputLogSlice`
- expected wrapper: `ReturnedValues[0].Entries`
- bounded snapshot only, with a hard cap of `200`

The full helper contract is documented in [OUTPUT_LOG_HELPER_CONTRACT.md](./OUTPUT_LOG_HELPER_CONTRACT.md).

For `ue_run_console_command_safe`, the current contract is also intentionally narrow:

- preset name: `UE_AgentBridge_M0`
- function name: `RunSafeConsoleCommand`
- route: `PUT /remote/preset/UE_AgentBridge_M0/function/RunSafeConsoleCommand`
- expected wrapper: `ReturnedValues[0]`
- request contains only `CommandId`
- helper must re-check the allowlist before execution

The full helper contract is documented in [CONSOLE_COMMAND_HELPER_CONTRACT.md](./CONSOLE_COMMAND_HELPER_CONTRACT.md).

### What `ue_healthcheck` verifies in Remote Control mode

`ue_healthcheck` now performs a real localhost check against Unreal Remote Control and reports:

- whether the configured endpoint is reachable
- whether `/remote/info` returned a valid Remote Control route inventory
- whether `/remote/search/assets` appears advertised and therefore usable for M0
- whether the optional `UE_AgentBridge_M0` preset appears present
- whether helper names required for future helper-backed tools appear detectable

It does not fake readiness for helper-backed tools. If preset routes are missing or helper exposure is not visible, the readiness report stays explicit about that.

### What `ue_asset_search` requires

`ue_asset_search` now uses the documented Remote Control asset-search route and normalizes results into canonical Unreal object paths such as `/Game/Props/Furniture/SM_Chair.SM_Chair`.

This step assumes Unreal Remote Control returns asset entries in the documented `Name` / `Class` / `Path` shape. Malformed or incomplete responses are surfaced as backend errors instead of being guessed around.

### What `ue_get_selected_actors` requires

`ue_get_selected_actors` is now implemented through one helper-backed preset function, not through guessed editor subsystem object paths.

The backend calls:

- `PUT /remote/preset/UE_AgentBridge_M0/function/GetSelectedActors`

with:

```json
{
  "Parameters": {
    "Limit": 200
  },
  "GenerateTransaction": false
}
```

The backend expects one returned object containing `Actors`, where each actor entry includes:

- `ActorName`
- `ClassName`
- `ObjectPath`

Optional helper fields:

- `ActorLabel`
- `Selected`

`objectPath` remains canonical. `actorLabel` is included only if the helper returned it. Empty selection is a successful empty result. Missing preset or missing function is treated as helper-unavailable, not as empty selection.

### What `ue_get_output_log` requires

`ue_get_output_log` is now implemented through one helper-backed preset function, not through a guessed or undocumented Remote Control log route.

The backend calls:

- `PUT /remote/preset/UE_AgentBridge_M0/function/GetOutputLogSlice`

with a bounded request such as:

```json
{
  "Parameters": {
    "Limit": 50,
    "MinLevel": "Warning"
  },
  "GenerateTransaction": false
}
```

The backend expects one returned object containing `Entries`, where each entry includes:

- `Timestamp`
- `Level`
- `Category`
- `Message`

Allowed log levels are limited to the M0 set:

- `Verbose`
- `Log`
- `Display`
- `Warning`
- `Error`

This is intentionally a bounded snapshot capability, not a logging subsystem:

- no streaming
- no subscriptions
- no cursoring
- no unbounded history
- hard cap of `200` entries

If the helper returns more entries than requested, the backend rejects the response instead of truncating it silently. Missing preset or missing function is treated as helper-unavailable, not as an empty log.

### What `ue_run_console_command_safe` requires

`ue_run_console_command_safe` is now implemented through one helper-backed preset function with a deny-by-default command-ID contract.

The backend calls:

- `PUT /remote/preset/UE_AgentBridge_M0/function/RunSafeConsoleCommand`

with:

```json
{
  "Parameters": {
    "CommandId": "stat_fps"
  },
  "GenerateTransaction": false
}
```

The backend never sends arbitrary console strings through Remote Control for this tool.

The current M0 allowlisted IDs are:

- `stat_fps`
- `stat_unit`
- `stat_memory`
- `show_bounds`
- `show_collision`
- `show_navigation`

The Unreal-side helper must revalidate the `CommandId` and map it to one exact Unreal console command before execution. Unknown IDs are rejected. Helper-reported failure is surfaced clearly. Arbitrary console execution is still intentionally unsupported.

### What `ue_get_level_actors` requires

`ue_get_level_actors` now uses the documented `EditorLevelLibrary.GetAllLevelActors` call through `PUT /remote/object/call`, then follows each returned object path with `PUT /remote/object/describe`.

The implementation intentionally uses per-object describe calls instead of `remote/batch` because the single-object describe shape is clearer and easier to validate conservatively for M0. Actor summaries always return canonical `objectPath`, normalized `className`, and `actorName`. `actorLabel` is included only when the describe payload exposes something label-like; this step does not invent labels when Remote Control does not provide them.

This step assumes `GetAllLevelActors` returns an array of actor object paths and that describe responses expose at least `Name` and `Class`. Empty actor lists and malformed actor payloads are treated differently and surfaced clearly.

### What `ue_get_property` requires

`ue_get_property` now uses `PUT /remote/object/property` with `READ_ACCESS`.

In Remote Control mode, property reads require `target.objectPath`. The bridge does not silently resolve free-form actor names on this path because that would weaken the object identity contract. Successful reads return the canonical object path in the normalized target.

Remote Control does not document a strong machine-readable error schema for all property failures, so the bridge classifies only obvious not-found cases narrowly:

- target object missing
- property missing or unreadable

Everything else remains a backend error.

### What `ue_set_property` requires

`ue_set_property` now uses the same documented `PUT /remote/object/property` route, but with `WRITE_TRANSACTION_ACCESS`.

The write flow is intentionally conservative:

1. read the current property value first
2. perform one explicit transactional write to one explicit property
3. read the property again and treat the verification read as authoritative

The bridge does not trust the write response body as proof of success because Remote Control does not document a strong stable write-response payload for this case.

### Writable-property policy

M0 does not expose broad object patching. The current write policy is explicit and narrow:

- `target.objectPath` is required in Remote Control mode
- `propertyName` must be a single explicit property token
- nested property paths are rejected
- the value must be JSON-compatible
- serialized write payloads are bounded to 8 KB

This is intentionally conservative. It keeps the direct write path usable without pretending M0 already has a project-specific safe-property allowlist. The policy lives in one place so it can be tightened later without refactoring the whole backend.

For write errors, the bridge only classifies what Remote Control makes reasonably clear:

- target object missing
- property missing
- property appears non-writable
- value appears incompatible with the property type

Everything else remains a backend error rather than a guessed classification.

The current scaffold does not pretend the helper-dependent exposure details already exist.

## M0 Release Docs

- [CHANGELOG.md](./CHANGELOG.md)
- [RELEASE_CHECKLIST.md](./RELEASE_CHECKLIST.md)
- [M1_BACKLOG.md](./M1_BACKLOG.md)
- [GITHUB_PUBLISH_CHECKLIST.md](./GITHUB_PUBLISH_CHECKLIST.md)

## Planning Documents

- [PROJECT_FRAMING.md](./PROJECT_FRAMING.md)
- [M0_SCOPE.md](./M0_SCOPE.md)
- [DECISIONS.md](./DECISIONS.md)
- [AGENT_USAGE_MODEL.md](./AGENT_USAGE_MODEL.md)
- [CONSOLE_COMMAND_HELPER_CONTRACT.md](./CONSOLE_COMMAND_HELPER_CONTRACT.md)
- [OUTPUT_LOG_HELPER_CONTRACT.md](./OUTPUT_LOG_HELPER_CONTRACT.md)
- [SELECTED_ACTORS_HELPER_CONTRACT.md](./SELECTED_ACTORS_HELPER_CONTRACT.md)
- [REFERENCE_REPOS.md](./REFERENCE_REPOS.md)
- [AGENTS.md](./AGENTS.md)
- [CLAUDE.md](./CLAUDE.md)
