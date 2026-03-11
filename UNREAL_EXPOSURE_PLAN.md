# Unreal Exposure Plan

This document defines the minimum Unreal-side exposure model required to make M0 real without overbuilding.

The plan is intentionally narrow:

- use documented raw Remote Control routes where they are already enough
- add one small explicit helper surface for the editor-global behaviors that raw Remote Control does not expose cleanly
- do not introduce a broad plugin-first backend just to make M0 look complete

## Exposure Strategy

Split M0 into two Unreal-side surfaces.

### Surface A: Raw Remote Control routes

Use these directly from the TypeScript backend:

- `GET /remote/info`
- `PUT /remote/object/call`
- `PUT /remote/object/property`
- `PUT /remote/search/assets`
- `PUT /remote/batch`

These cover:

- `ue_healthcheck`
- `ue_get_level_actors`
- `ue_get_property`
- `ue_set_property`
- `ue_asset_search`

### Surface B: One narrow Remote Control Preset for helper-backed editor-global actions

Create one preset:

- `UE_AgentBridge_M0`

Use it only for helper-backed M0 actions that are not cleanly provided by raw Remote Control:

- `ue_get_selected_actors`
- `ue_get_output_log`
- `ue_run_console_command_safe`

Optional helper-backed resolution if needed later:

- actor name or label to object path resolution

## Minimum Helper Model

### Recommended helper object

Expose one helper object through the preset rather than many unrelated helpers.

Suggested conceptual name:

- `UEAgentBridgeM0Helper`

This is a contract name, not an implementation requirement. It could eventually be backed by:

- a Blueprint-accessible helper object
- an editor utility object
- a small C++ editor-side class

M0 should not decide that prematurely. The important part is the narrow callable surface.

### Helper-backed functions

Expose only these functions in the preset:

- `GetSelectedActors`
- `GetOutputLogSlice`
- `RunSafeConsoleCommand`

Optional only if needed:

- `ResolveActorTarget`

Do not expose generic execution, generic object lookup, generic function dispatch, or catch-all editor helpers.

## Naming Conventions

Keep names explicit and M0-scoped.

### Preset name

- `UE_AgentBridge_M0`

### Exposed function names

- `GetSelectedActors`
- `GetOutputLogSlice`
- `RunSafeConsoleCommand`

Optional:

- `ResolveActorTarget`

### Returned field names

Prefer stable API-style names with explicit meaning:

- `ActorLabel`
- `ActorName`
- `ClassName`
- `ObjectPath`
- `Selected`
- `Entries`
- `Timestamp`
- `Level`
- `Category`
- `Message`
- `Accepted`
- `NormalizedCommand`

## How Selected Actors Should Be Surfaced

Selected actors should be surfaced through the helper preset, not through a guessed subsystem object path.

Expected helper output:

```json
{
  "Actors": [
    {
      "ActorLabel": "PointLight_01",
      "ActorName": "PointLight_01",
      "ClassName": "PointLight",
      "ObjectPath": "/Game/Maps/TestMap.TestMap:PersistentLevel.PointLight_01",
      "Selected": true
    }
  ]
}
```

Why this route:

- it avoids depending on undocumented Remote Control object paths for editor subsystems
- it returns exactly the shape the bridge needs
- it keeps the selected-actors surface explicitly allowlisted

## How Level Actors Should Be Surfaced

For M0, level actors should be surfaced without a custom helper.

Implementation path:

1. `EditorLevelLibrary.GetAllLevelActors` through `remote/object/call`
2. `remote/object/describe` through `remote/batch` for the returned object paths
3. bridge-side filtering and normalization

This is enough for M0 if the result shape is limited to:

- `actorName`
- `className`
- `objectPath`

If actor labels become necessary, a helper can be added later, but that is not required to start.

## How Property Reads And Writes Should Be Surfaced

Use raw `remote/object/property`.

### Read

- `READ_ACCESS`
- explicit `propertyName`
- explicit `objectPath`

### Write

- `WRITE_TRANSACTION_ACCESS`
- explicit `propertyName`
- explicit `objectPath`
- explicit `propertyValue`
- follow with verification read-back

Do not wrap generic property access in a custom helper just to make it feel more abstract. Remote Control already provides the needed contract for supported properties.

## How Asset Search Should Be Surfaced

Use raw `remote/search/assets`.

Bridge rules:

- translate M0 query inputs into `Query` and `Filter`
- enforce result limits in the bridge
- default toward narrow path filters where possible

No helper is needed for M0 asset search.

## How Output Log Access Should Be Surfaced

Output log access should be surfaced through a helper function exposed in the preset:

- `GetOutputLogSlice`

However, the helper function alone is not enough. Something inside Unreal must maintain a bounded retrievable log buffer.

Minimum acceptable model:

- bounded in-memory ring buffer
- helper function returns only the newest matching slice
- no unbounded historical retrieval

This is the one M0 area where a lightweight Unreal-side backend element is most likely to become necessary quickly.

## How Safe Console Command Dispatch Should Be Surfaced

Safe console command dispatch should be surfaced through a helper function exposed in the preset:

- `RunSafeConsoleCommand`

This helper must:

- normalize the command
- validate it against the same M0 allowlist policy
- reject everything else
- execute only if allowed

Do not expose a generic "run command" function.

Do not rely on bridge-only validation.

The Unreal-side helper must re-check the allowlist to preserve the safety boundary.

## What Should Remain Out Of Scope

The Unreal exposure model for M0 must not include:

- Blueprint graph editing
- actor spawning
- actor deletion
- save-all behavior
- arbitrary Python
- arbitrary C++
- generic function execution
- generic editor command routing
- async job control
- GraphQL
- subscriptions and event streaming

## Minimum Unreal-Side Setup Checklist

Required:

1. Remote Control API enabled
2. Editor Scripting Utilities available for level actor enumeration
3. One preset named `UE_AgentBridge_M0`
4. Helper-backed preset functions for:
   - `GetSelectedActors`
   - `GetOutputLogSlice`
   - `RunSafeConsoleCommand`

Direct raw route usage:

1. `remote/info`
2. `remote/object/call`
3. `remote/object/property`
4. `remote/search/assets`
5. `remote/batch`

## Minimality Rule

If a capability can be implemented cleanly with documented raw Remote Control routes, do that.

If a capability cannot be implemented honestly that way, add one named helper function and expose only that.

If even the helper cannot exist without additional Unreal-side support, say so directly and keep the extra support narrowly scoped to that one capability.
