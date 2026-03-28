# M1 Plugin Implementation Order

This file defines the safest implementation order for the plugin-first M1 direction.

The point is to remove manual preset setup without opening broad new capability scope.

## Step 1: Health Endpoint

Implement:

- `GET /api/v1/health`

Why first:

- proves localhost transport
- proves plugin startup in editor
- gives explicit readiness without guessing
- lets the TypeScript bridge detect the plugin backend cleanly

Must validate before moving on:

- endpoint reachable on loopback
- project name or editor presence reported
- capability map returned
- plugin version and API version returned

## Step 2: Selected Actors

Implement:

- `POST /api/v1/selected-actors`

Why second:

- read-only
- user-visible and high-value
- currently helper-dependent in M0
- does not require mutation policy work

Must validate before moving on:

- empty selection works
- multiple selected actors work
- `objectPath` is canonical
- malformed state returns stable error envelope

## Step 3: Level Actors

Implement:

- `POST /api/v1/level-actors`

Why third:

- read-only
- replaces the unstable M0 dependency on `EditorLevelLibrary.GetAllLevelActors` via Remote Control
- unlocks better object-path discovery for later workflows

Must validate before moving on:

- current level actors enumerate correctly
- `limit` is enforced
- `className` and `nameContains` filters behave predictably
- actor summaries match the bridge contract

## Step 4: Output Log Slice

Implement:

- `POST /api/v1/output-log/slice`

Why fourth:

- bounded read path
- currently helper-dependent in M0
- needs some plugin-owned buffering or access logic but still avoids mutation

Must validate before moving on:

- empty slice works
- hard cap enforced
- `minLevel` filtering works if included
- no streaming or subscription behavior leaks in

## Step 5: Safe Console Command Execution

Implement:

- `POST /api/v1/console/run-safe`

Why fifth:

- still narrow, but it is the riskiest action in the first plugin surface
- should come after health and read paths are already stable

Must validate before moving on:

- unknown `commandId` rejected
- allowlisted `commandId` succeeds
- plugin-side revalidation is real
- no raw command string path exists

## Step 6: TypeScript Plugin Backend Adapter

Implement:

- `plugin` backend mode in the bridge
- endpoint client
- health mapping
- tool mapping for the plugin-owned paths

Why sixth:

- keeps Unreal-side contract stable before bridge integration
- prevents half-designed transport and schema churn

Must validate before moving on:

- backend selection works
- `ue_healthcheck` reports plugin readiness correctly
- external MCP tool names remain unchanged

## Step 7: End-To-End Validation

Validate:

- one direct Remote Control tool still works
- one plugin-owned read tool works
- bounded output log snapshot works
- safe console command execution works with allowlisted ID
- helper preset setup is no longer required for the plugin path

## What Must Not Slip Into M1 By Accident

Do not add:

- arbitrary execution
- generic plugin command router
- build system hooks
- Live Coding orchestration
- Blueprint generation
- destructive broad editor actions

