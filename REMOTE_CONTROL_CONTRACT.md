# Remote Control Contract

This document defines the exact Unreal-side M0 contract for the `remote-control` backend.

The goal is to be explicit about three different cases:

- directly implementable through documented Unreal Remote Control HTTP routes
- implementable only if Unreal exposes a narrow helper function or preset surface
- not honestly covered by pure Remote Control alone and therefore likely to need something beyond it

For M0, the bridge should use documented Remote Control routes where they are sufficient, and only add Unreal-side helper exposure where the native Remote Control surface does not cleanly provide the needed behavior.

## Reference Basis

This contract is based on Unreal Engine 5.7 Remote Control documentation from Epic:

- `GET /remote/info`
- `PUT /remote/object/call`
- `PUT /remote/object/property`
- `PUT /remote/search/assets`
- `PUT /remote/batch`
- Remote Control Preset routes such as:
  - `GET /remote/presets`
  - `GET /remote/preset/<PresetName>`
  - `GET /remote/preset/<PresetName>/property/<PropertyName>`
  - `PUT /remote/preset/<PresetName>/property/<PropertyName>`
  - `PUT /remote/preset/<PresetName>/function/<FunctionName>`

Epic also documents `EditorLevelLibrary.GetAllLevelActors` as callable through `remote/object/call`. That makes level actor enumeration directly plausible. The corresponding direct Remote Control path for selected actors is not documented with the same clarity.

## Summary

| Tool | Direct via Remote Control | Requires helper/preset | Likely needs something outside pure Remote Control |
|------|---------------------------|------------------------|----------------------------------------------------|
| `ue_healthcheck` | Yes | No | No |
| `ue_get_selected_actors` | Uncertain | Yes, safest assumption | No, if helper can be exposed through RC |
| `ue_get_level_actors` | Yes | No for minimum contract | No |
| `ue_get_property` | Yes, for supported properties | Only for edge cases | No for supported M0 property reads |
| `ue_set_property` | Yes, for supported properties | Only for edge cases or policy wrappers | No for supported M0 property writes |
| `ue_asset_search` | Yes | No | No |
| `ue_get_output_log` | No documented direct route | Yes | Yes, likely needs lightweight UE-side log capture/support |
| `ue_run_console_command_safe` | No honest direct safe route | Yes | Possibly, depending on how editor console execution is surfaced |

## Tool Contracts

### `ue_healthcheck`

#### Directly implementable via Remote Control

Yes.

The minimum direct check is:

- `GET /remote/info`

Optional readiness checks:

- `GET /remote/presets`
- `GET /remote/preset/UE_AgentBridge_M0`

#### Requires exposed helper object/preset/callable function

No.

A helper is not required to prove that Remote Control is reachable. A preset lookup is optional if the backend wants to report helper readiness in the same call.

#### Likely requires something outside pure Remote Control

No.

#### Expected request shape

Bridge to Unreal:

```http
GET /remote/info
```

Optional preset readiness:

```http
GET /remote/preset/UE_AgentBridge_M0
```

#### Expected response shape

Remote Control route response:

```json
{
  "HttpRoutes": [
    {
      "Path": "/remote/info",
      "Verb": "Get",
      "Description": "Get information about different routes available on this API."
    }
  ]
}
```

Bridge-level normalized result should include at least:

```json
{
  "backend": "remote-control",
  "connected": true,
  "mode": "remote-control",
  "transport": "http",
  "message": "Remote Control reachable.",
  "capabilities": ["ue_healthcheck"]
}
```

#### Failure modes

- connection refused or timeout
- Remote Control plugin disabled
- route reachable but preset missing
- route reachable but required helper functions not exposed yet

#### Security considerations

- localhost-only host enforcement remains mandatory
- do not treat healthcheck success as proof that all M0 tools are ready

#### Current backend interface needs adjustment

Small adjustment recommended.

`HealthcheckResult` should ideally distinguish:

- Remote Control route reachability
- preset availability
- helper availability
- per-tool readiness

The current `capabilities: string[]` field is too coarse for that.

### `ue_get_selected_actors`

#### Directly implementable via Remote Control

Not reliably enough for M0.

Unreal documents editor-level actor enumeration through `EditorLevelLibrary.GetAllLevelActors`, but the selected-actors path is not documented with the same direct object-path contract. There are editor APIs for selected actors, but relying on an undocumented subsystem object path would be a weak foundation for M0.

#### Requires exposed helper object/preset/callable function

Yes.

Safest contract:

- expose a single helper function through a Remote Control Preset
- helper returns already normalized actor summaries for the current editor selection

Recommended helper function name:

- `GetSelectedActors`

#### Likely requires something outside pure Remote Control

No, not necessarily.

A helper callable surfaced through Remote Control should be enough. This does not require a full plugin-first architecture by default.

#### Expected request shape

Recommended preset function call:

```http
PUT /remote/preset/UE_AgentBridge_M0/function/GetSelectedActors
Content-Type: application/json
```

```json
{
  "Parameters": {
    "Limit": 200
  },
  "GenerateTransaction": false
}
```

#### Expected response shape

Preset function response wrapper:

```json
{
  "ReturnedValues": [
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
  ]
}
```

Bridge-level normalized result should map this to an array of actor summaries.

#### Failure modes

- preset missing
- helper function not exposed
- helper returns no selection
- helper returns actor references that cannot be serialized cleanly

#### Security considerations

- read-only operation
- bound the maximum number of returned actors
- do not return giant per-actor property blobs here

#### Current backend interface needs adjustment

Small adjustment recommended.

`ActorSummary` should include `actorLabel` in addition to `actorName`. In the editor, labels and object names are not the same thing, and external agents will often need the human-visible label.

### `ue_get_level_actors`

#### Directly implementable via Remote Control

Yes.

Documented direct path:

- `PUT /remote/object/call` on `EditorLevelLibrary.GetAllLevelActors`

Practical follow-up:

- `PUT /remote/batch` containing one `/remote/object/describe` request per returned object path

This is enough to build `actorName`, `className`, and `objectPath` without requiring a custom helper.

#### Requires exposed helper object/preset/callable function

No for minimum M0.

A helper is optional if later we want Unreal-side filtering, actor labels, or lower round-trip count.

#### Likely requires something outside pure Remote Control

No.

#### Expected request shape

Step 1:

```http
PUT /remote/object/call
Content-Type: application/json
```

```json
{
  "objectPath": "/Script/EditorScriptingUtilities.Default__EditorLevelLibrary",
  "functionName": "GetAllLevelActors"
}
```

Step 2:

```http
PUT /remote/batch
Content-Type: application/json
```

```json
{
  "Requests": [
    {
      "RequestId": "actor-0",
      "URL": "/remote/object/describe",
      "Verb": "PUT",
      "Body": {
        "objectPath": "/Game/Maps/TestMap.TestMap:PersistentLevel.PointLight_01"
      }
    }
  ]
}
```

Bridge-side filtering:

- apply `className`
- apply `nameContains`
- apply `limit`

#### Expected response shape

Direct function call:

```json
{
  "ReturnValue": [
    "/Game/Maps/TestMap.TestMap:PersistentLevel.PointLight_01"
  ]
}
```

Describe response for each object:

```json
{
  "Name": "PointLight_01",
  "Class": "/Script/Engine.PointLight"
}
```

Bridge-level normalized result:

```json
[
  {
    "actorName": "PointLight_01",
    "className": "PointLight",
    "objectPath": "/Game/Maps/TestMap.TestMap:PersistentLevel.PointLight_01"
  }
]
```

#### Failure modes

- Editor Scripting Utilities plugin unavailable
- actor enumeration returns paths but describe calls fail for unloaded or stale objects
- large levels create response-size or latency problems if not bounded

#### Security considerations

- bound the returned actor count
- avoid pulling full property sets
- do not expose mutation through this read tool

#### Current backend interface needs adjustment

No required change for M0.

Optional improvement:

- add `actorLabel` later if Unreal-side helper support is introduced

### `ue_get_property`

#### Directly implementable via Remote Control

Yes, for properties that Remote Control supports directly.

Documented direct path:

- `PUT /remote/object/property` with `READ_ACCESS`

This only works for properties that Remote Control can access:

- public
- no `BlueprintGetter`/`BlueprintSetter`
- readable in the current editor/runtime context

#### Requires exposed helper object/preset/callable function

Not for the supported M0 path.

However, helper exposure would be required if a property can only be accessed through getter functions rather than direct property access.

M0 should not silently fall back to arbitrary helper calls for arbitrary properties. Unsupported properties should remain unsupported.

#### Likely requires something outside pure Remote Control

No for the supported M0 path.

#### Expected request shape

```http
PUT /remote/object/property
Content-Type: application/json
```

```json
{
  "objectPath": "/Game/Maps/TestMap.TestMap:PersistentLevel.PointLight_01.LightComponent0",
  "propertyName": "Intensity",
  "access": "READ_ACCESS"
}
```

If the bridge only has `actorName`, it must resolve that to `objectPath` first through a prior read path. The real contract should treat `objectPath` as canonical.

#### Expected response shape

```json
{
  "Intensity": 2500
}
```

Bridge-level normalized result:

```json
{
  "target": {
    "objectPath": "/Game/Maps/TestMap.TestMap:PersistentLevel.PointLight_01.LightComponent0"
  },
  "propertyName": "Intensity",
  "value": 2500
}
```

#### Failure modes

- object not found or not loaded
- property not found
- property exists but is not readable through Remote Control
- actor name resolved ambiguously

#### Security considerations

- do not support the "read all properties" mode in M0
- require an explicit property name
- prefer previously discovered object paths over free-form user-supplied names

#### Current backend interface needs adjustment

Small adjustment recommended.

`TargetRef.objectPath` should be treated as the canonical target. `actorName` is best-effort only and may be ambiguous. The interface can keep both, but the contract should prefer `objectPath`.

### `ue_set_property`

#### Directly implementable via Remote Control

Yes, for supported direct-write properties.

Documented direct path:

- `PUT /remote/object/property` with `WRITE_ACCESS` or `WRITE_TRANSACTION_ACCESS`

For editor usage, `WRITE_TRANSACTION_ACCESS` is the more honest default because it behaves like a real editor property edit and participates in undo history.

#### Requires exposed helper object/preset/callable function

Not for the supported M0 path.

If a property requires setter functions rather than direct property access, M0 should reject it rather than introducing generic fallback behavior.

#### Likely requires something outside pure Remote Control

No for the supported M0 path.

#### Expected request shape

Write:

```http
PUT /remote/object/property
Content-Type: application/json
```

```json
{
  "objectPath": "/Game/Maps/TestMap.TestMap:PersistentLevel.PointLight_01.LightComponent0",
  "propertyName": "Intensity",
  "access": "WRITE_TRANSACTION_ACCESS",
  "propertyValue": {
    "Intensity": 3200
  }
}
```

Recommended verification follow-up:

```http
PUT /remote/object/property
```

```json
{
  "objectPath": "/Game/Maps/TestMap.TestMap:PersistentLevel.PointLight_01.LightComponent0",
  "propertyName": "Intensity",
  "access": "READ_ACCESS"
}
```

#### Expected response shape

Write response from Remote Control may be empty:

```json
null
```

Bridge-level normalized result should therefore be based on verification read-back:

```json
{
  "target": {
    "objectPath": "/Game/Maps/TestMap.TestMap:PersistentLevel.PointLight_01.LightComponent0"
  },
  "propertyName": "Intensity",
  "value": 3200,
  "changed": true
}
```

#### Failure modes

- object not found or not loaded
- property not writable
- value shape incompatible with Unreal property type
- write accepted but read-back differs

#### Security considerations

- only allow known safe property names and safe value types in M0
- use read-before-write and read-after-write sequencing
- avoid broad write helpers

#### Current backend interface needs adjustment

Small adjustment recommended.

Current `PropertyWriteResult` is acceptable, but a future small refinement could add:

- `verifiedValue`
- `transactional: true`

That is not required before first implementation.

### `ue_asset_search`

#### Directly implementable via Remote Control

Yes.

Documented direct path:

- `PUT /remote/search/assets`

#### Requires exposed helper object/preset/callable function

No.

#### Likely requires something outside pure Remote Control

No.

#### Expected request shape

```http
PUT /remote/search/assets
Content-Type: application/json
```

```json
{
  "Query": "Door",
  "Filter": {
    "ClassNames": ["Blueprint"],
    "PackagePaths": ["/Game/Blueprints"],
    "RecursivePaths": true,
    "RecursiveClasses": false
  }
}
```

#### Expected response shape

```json
{
  "Assets": [
    {
      "Name": "BP_Door",
      "Class": "Blueprint",
      "Path": "/Game/Blueprints/Interactables/BP_Door.BP_Door"
    }
  ]
}
```

Bridge-level normalized result:

```json
[
  {
    "assetName": "BP_Door",
    "assetPath": "/Game/Blueprints/Interactables/BP_Door.BP_Door",
    "assetClass": "Blueprint"
  }
]
```

#### Failure modes

- endpoint unreachable
- invalid filter combinations
- unexpectedly large result sets if limits are not applied bridge-side

#### Security considerations

- cap result count
- prefer `PackagePaths` filtering over whole-project broad searches where possible
- keep this read-only

#### Current backend interface needs adjustment

Small adjustment recommended.

The Remote Control response field `Path` is an asset object path, not merely a folder path. The current `AssetSummary.assetPath` name is usable, but the docs should clarify that it stores the full Unreal asset path including object suffix.

### `ue_get_output_log`

#### Directly implementable via Remote Control

No documented direct route.

Remote Control documentation does not provide an output log history endpoint. There is no honest pure-Remote-Control implementation contract for log retrieval in M0.

#### Requires exposed helper object/preset/callable function

Yes.

Recommended contract:

- expose `GetOutputLogSlice` through the M0 preset

However, that helper alone is not enough unless something inside Unreal is already capturing log lines into a retrievable buffer.

#### Likely requires something outside pure Remote Control

Yes.

Most likely requirement:

- a lightweight Unreal-side helper that subscribes to or captures output log entries and stores a bounded in-memory ring buffer

That helper can still be surfaced through Remote Control, but the log capture mechanism itself is outside pure Remote Control.

#### Expected request shape

```http
PUT /remote/preset/UE_AgentBridge_M0/function/GetOutputLogSlice
Content-Type: application/json
```

```json
{
  "Parameters": {
    "MinLevel": "Warning",
    "Limit": 50
  },
  "GenerateTransaction": false
}
```

#### Expected response shape

```json
{
  "ReturnedValues": [
    {
      "Entries": [
        {
          "Timestamp": "2026-03-11T10:02:05Z",
          "Level": "Error",
          "Category": "LogBlueprint",
          "Message": "Compile warning promoted to error."
        }
      ]
    }
  ]
}
```

Bridge-level normalized result:

```json
[
  {
    "timestamp": "2026-03-11T10:02:05Z",
    "level": "Error",
    "category": "LogBlueprint",
    "message": "Compile warning promoted to error."
  }
]
```

#### Failure modes

- helper/preset missing
- log buffer not initialized
- log serialization too large
- helper returns unbounded or stale data

#### Security considerations

- cap log line count
- avoid exposing unlimited historical logs
- note that logs may contain local file paths, asset paths, usernames, or project names

#### Current backend interface needs adjustment

No required change for M0.

Optional future refinement:

- add a cursor or `sinceTimestamp` if repeated polling becomes necessary later

### `ue_run_console_command_safe`

#### Directly implementable via Remote Control

Not honestly, no.

Remote Control does provide generic callable function access, but that is not the same thing as a safe M0 console-command tool. A direct generic function-call path would weaken the safety model.

#### Requires exposed helper object/preset/callable function

Yes.

Recommended contract:

- expose `RunSafeConsoleCommand` through the M0 preset
- validate command allowlist in Unreal as well as in the TypeScript bridge

#### Likely requires something outside pure Remote Control

Possibly.

Two separate concerns exist:

- Remote Control exposure of the helper call
- actual editor-context console execution

The helper can likely be surfaced through Remote Control, but whether the command execution itself is best implemented in Blueprint alone or needs a tiny editor-side code helper is still uncertain. M0 should not guess here.

#### Expected request shape

```http
PUT /remote/preset/UE_AgentBridge_M0/function/RunSafeConsoleCommand
Content-Type: application/json
```

```json
{
  "Parameters": {
    "Command": "stat fps"
  },
  "GenerateTransaction": false
}
```

#### Expected response shape

```json
{
  "ReturnedValues": [
    {
      "Accepted": true,
      "NormalizedCommand": "stat fps",
      "Message": "Command executed."
    }
  ]
}
```

Bridge-level normalized result:

```json
{
  "command": "stat fps",
  "accepted": true,
  "message": "Command executed."
}
```

#### Failure modes

- helper/preset missing
- command rejected by Unreal-side allowlist
- command accepted by bridge but not by Unreal helper due to policy drift
- command execution function unavailable in editor context

#### Security considerations

- enforce allowlist in both layers
- do not pass raw commands through `remote/object/call`
- keep M0 command list intentionally tiny

#### Current backend interface needs adjustment

Small adjustment recommended.

`ConsoleCommandResult` should ideally include:

- `normalizedCommand`
- `executedByHelper: true`

This is optional for the first backend implementation.

## Contract Mismatches In The Current TypeScript Surface

These are the small mismatches worth noting before real backend work starts:

### `ActorSummary` needs `actorLabel`

The editor-facing name a user sees is often not the same as the internal object name. M0 can start without this if direct level-actor reads are implemented first, but the contract is stronger if `actorLabel` is added.

### `TargetRef.objectPath` should be treated as canonical

`actorName` is useful during discovery, but direct property get/set through Remote Control fundamentally wants `objectPath`. The interface can keep `actorName`, but the contract should prefer `objectPath`.

### `AssetSummary.assetPath` should be documented as full object path

Remote Control returns `Path` values like `/Game/Foo/Bar.Bar`, not just `/Game/Foo/Bar`.

### `HealthcheckResult` is too coarse for contract readiness

A richer readiness shape would help distinguish:

- Remote Control reachable
- M0 preset present
- helper-backed tools ready

### `ue_get_selected_actors` and `ue_get_output_log` are not symmetrical with current assumptions

The existing backend interface makes them look as straightforward as direct routes, but the Unreal-side reality is different:

- selected actors should be treated as helper-backed unless proven otherwise
- output log should be treated as helper-backed and likely plugin-assisted
