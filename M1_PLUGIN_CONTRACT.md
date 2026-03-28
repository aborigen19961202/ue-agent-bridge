# M1 Plugin Contract

This document defines the first exact Unreal plugin contract for M1.

The goal is not to redesign the external tool surface. The goal is to replace manual preset setup with a plugin-owned Unreal-side backend while keeping the current MCP tool model stable.

## Scope

M1 plugin scope is intentionally narrow.

The plugin should own only the Unreal-side capabilities that are either:

- helper-dependent in M0
- unreliable across engine versions as pure Remote Control calls

That means the first plugin contract should cover:

- health and readiness
- selected actors
- level actors
- bounded output log snapshot
- safe console command execution

The plugin does not need to replace all M0 direct Remote Control calls on day one.

## Core Product Rule

The external coding agent remains outside Unreal.

The plugin is not a chat assistant, not a repo-aware agent, and not a general execution host. It is a narrow Unreal-side backend that exposes a controlled tool layer to the existing bridge.

## Transport

Use localhost HTTP for the first plugin backend.

Reasons:

- matches the current bridge model
- practical on local Windows setups
- easy to probe and test without MCP
- avoids forcing plugin calls through Remote Control preset semantics

M1 transport assumptions:

- listen on loopback only
- default port should be explicit and configurable
- no remote network exposure
- no authentication layer in M1 beyond loopback-only local use

Suggested default:

- host: `127.0.0.1`
- port: `30110`

The final port can be changed later, but the plugin must report it clearly through health.

## Backend Identity

The bridge should gain one new backend mode:

- `plugin`

This backend should sit beside:

- `mock`
- `remote-control`

The external MCP tool names should not change.

## Versioning

Every plugin response should make it possible to identify the backend contract version.

Minimum version fields:

- `pluginName`
- `pluginVersion`
- `apiVersion`

M1 should start with:

- `pluginName: "UEAgentBridge"`
- `apiVersion: "v1"`

## Readiness Model

The plugin should make readiness explicit instead of forcing the bridge to infer it from route inventories or preset strings.

Minimum readiness fields:

- backend reachable
- editor available
- current project path or project name
- capability availability by tool name
- plugin version
- warnings for degraded states

That means `ue_healthcheck` in plugin mode should be able to answer:

- is the plugin endpoint reachable
- is Unreal Editor alive
- which tools are actually ready
- which tools are unavailable and why

## Endpoint Surface

The first M1 plugin API should be small.

### `GET /api/v1/health`

Purpose:

- backend reachability
- plugin version reporting
- capability readiness

Expected response:

```json
{
  "pluginName": "UEAgentBridge",
  "pluginVersion": "0.1.0",
  "apiVersion": "v1",
  "editor": {
    "available": true,
    "projectName": "<ProjectName>"
  },
  "capabilities": {
    "ue_get_selected_actors": true,
    "ue_get_level_actors": true,
    "ue_get_output_log": true,
    "ue_run_console_command_safe": true
  },
  "warnings": []
}
```

### `POST /api/v1/selected-actors`

Purpose:

- return the current editor selection as normalized actor summaries

Request:

```json
{
  "limit": 200
}
```

Response:

```json
{
  "actors": [
    {
      "actorName": "SM_Chair_01",
      "actorLabel": "SM_Chair_01",
      "className": "StaticMeshActor",
      "objectPath": "/Game/Maps/TestMap.TestMap:PersistentLevel.SM_Chair_01",
      "selected": true
    }
  ]
}
```

### `POST /api/v1/level-actors`

Purpose:

- enumerate actors in the current editor world without depending on `EditorLevelLibrary.GetAllLevelActors` being remotely callable

Request:

```json
{
  "limit": 100,
  "className": "StaticMeshActor",
  "nameContains": "Chair"
}
```

Response:

```json
{
  "actors": [
    {
      "actorName": "SM_Chair_01",
      "actorLabel": "SM_Chair_01",
      "className": "StaticMeshActor",
      "objectPath": "/Game/Maps/TestMap.TestMap:PersistentLevel.SM_Chair_01"
    }
  ]
}
```

### `POST /api/v1/output-log/slice`

Purpose:

- bounded output log snapshot only

Request:

```json
{
  "limit": 50,
  "minLevel": "Warning"
}
```

Response:

```json
{
  "entries": [
    {
      "timestamp": "2026-03-11T12:34:56Z",
      "level": "Warning",
      "category": "LogTemp",
      "message": "Example warning"
    }
  ],
  "limitApplied": 50
}
```

### `POST /api/v1/console/run-safe`

Purpose:

- run one allowlisted Unreal console command by command ID only

Request:

```json
{
  "commandId": "stat_fps"
}
```

Response:

```json
{
  "commandId": "stat_fps",
  "accepted": true,
  "executedCommand": "stat fps",
  "message": "Command executed."
}
```

## Canonical Data Rules

The plugin should preserve the existing normalized bridge model.

### Actor identity

- `objectPath` is canonical
- `actorName` is required
- `actorLabel` is optional
- `selected` is returned only when semantically relevant

### Log entries

- `timestamp`, `level`, `category`, and `message` are required
- no raw unstructured log dump endpoint in M1

### Safe console execution

- request contains `commandId` only
- no raw command string execution path
- helper side revalidation remains mandatory

## Error Model

The plugin should return stable machine-readable errors so the bridge does not have to parse vague text where avoidable.

Suggested error envelope:

```json
{
  "error": {
    "code": "HELPER_UNAVAILABLE",
    "message": "Selected actor subsystem is not ready."
  }
}
```

Minimum error codes:

- `BACKEND_UNAVAILABLE`
- `EDITOR_UNAVAILABLE`
- `NOT_FOUND`
- `NOT_SUPPORTED`
- `VALIDATION_ERROR`
- `UNSAFE_COMMAND`
- `LIMIT_EXCEEDED`
- `INTERNAL_ERROR`

The bridge can still map these into its own error layer, but the plugin should not force text scraping for ordinary cases.

## Mapping To Existing MCP Tools

The plugin contract should preserve the current external tool names.

Mapping:

- `ue_healthcheck` -> `GET /api/v1/health`
- `ue_get_selected_actors` -> `POST /api/v1/selected-actors`
- `ue_get_level_actors` -> `POST /api/v1/level-actors`
- `ue_get_output_log` -> `POST /api/v1/output-log/slice`
- `ue_run_console_command_safe` -> `POST /api/v1/console/run-safe`

M0 direct Remote Control tools can remain on the existing backend initially:

- `ue_asset_search`
- `ue_get_property`
- `ue_set_property`

This keeps M1 smaller while still solving the setup and UX problem.

## Safety Rules

The plugin must stay deny-by-default.

### Selected actors

- read-only
- bounded response size

### Level actors

- read-only
- bounded response size
- optional filter inputs only

### Output log

- bounded snapshot only
- hard cap enforced in plugin
- no streaming or subscriptions in M1

### Safe console commands

- allowlisted command IDs only
- no raw command strings
- revalidation on the plugin side

## Initial Safe Console Command Allowlist

The M1 plugin should keep the same M0 command IDs unless there is a specific reason to tighten them further:

- `stat_fps`
- `stat_unit`
- `stat_memory`
- `show_bounds`
- `show_collision`
- `show_navigation`

The bridge and plugin should share the same command-ID vocabulary.

## Unreal-Side Ownership

The plugin should own:

- current editor selection access
- current editor world actor enumeration
- bounded log buffering or snapshot access
- allowlisted console dispatch
- explicit health and readiness reporting

The plugin should not own:

- repo operations
- git
- file editing
- shell
- source tree reasoning

## What The Bridge Still Owns

The TypeScript bridge should still own:

- MCP transport
- tool schemas
- validation of user-facing arguments
- normalization into the stable tool surface
- backend selection
- error formatting for agents

This keeps the product architecture intact.

## Minimal M1 Implementation Order

1. `GET /api/v1/health`
2. `POST /api/v1/selected-actors`
3. `POST /api/v1/level-actors`
4. `POST /api/v1/output-log/slice`
5. `POST /api/v1/console/run-safe`
6. TypeScript `plugin` backend adapter
7. end-to-end bridge validation

## Explicit Non-Goals For This Contract

This contract does not introduce:

- arbitrary Unreal command execution
- Blueprint generation
- actor spawning and deletion
- save-all support
- build or Live Coding orchestration
- event subscriptions
- generic function dispatch

## Definition Of Done For The Plugin Contract

The contract is good enough to start implementation when:

- the endpoint list is fixed
- request and response shapes are fixed
- readiness semantics are fixed
- the error envelope is fixed
- the bridge can add a `plugin` backend without changing external tool names
