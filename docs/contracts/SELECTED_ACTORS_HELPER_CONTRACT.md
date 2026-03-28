# Selected Actors Helper Contract

This document defines the minimum Unreal-side helper contract for `ue_get_selected_actors`.

The goal is narrowness, not a general helper framework.

## Why A Helper Is Required

`ue_get_selected_actors` is not being implemented through guessed editor subsystem object paths.

For M0, selected-actor retrieval is treated as a helper-backed capability exposed through Remote Control Presets.

## Required Unreal-Side Surface

- one preset named `UE_AgentBridge_M0`
- one exposed callable function named `GetSelectedActors`

This function may be backed by:

- an editor utility object
- a Blueprint-accessible helper object
- a small editor-side class

The bridge does not assume which implementation is used internally. It only assumes the exposed Remote Control contract below.

## Remote Control Route

The TypeScript backend calls:

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

`Limit` is advisory and should bound the returned actor count. The helper should return the first `Limit` selected actors in editor selection order if that order is available. If not, any stable helper-side order is acceptable for M0.

## Expected Response Shape

The backend expects the standard preset-function wrapper with one returned object containing `Actors`:

```json
{
  "ReturnedValues": [
    {
      "Actors": [
        {
          "ActorName": "PointLight_01",
          "ClassName": "PointLight",
          "ObjectPath": "/Game/Maps/TestMap.TestMap:PersistentLevel.PointLight_01",
          "Selected": true,
          "ActorLabel": "PointLight_01"
        }
      ]
    }
  ]
}
```

Required fields per actor:

- `ActorName`
- `ClassName`
- `ObjectPath`

Optional fields per actor:

- `ActorLabel`
- `Selected`

`ObjectPath` is the canonical identifier.

`ActorLabel` is optional because some helper implementations may not expose it cleanly in the first cut.

`Selected` is optional because this tool already implies selected actors; the backend will normalize returned actors as selected.

## Mapping To `ActorSummary`

Each helper actor entry maps to:

```json
{
  "actorName": "PointLight_01",
  "className": "PointLight",
  "objectPath": "/Game/Maps/TestMap.TestMap:PersistentLevel.PointLight_01",
  "selected": true,
  "actorLabel": "PointLight_01"
}
```

Rules:

- `objectPath` is always returned as the canonical target
- `actorLabel` is only included if the helper provided it
- the backend does not invent labels
- the backend normalizes `selected` to `true`

## Failure Modes

Expected failure classes:

- Remote Control endpoint unreachable
- preset missing
- `GetSelectedActors` function not exposed
- helper returns malformed wrapper shape
- helper returns malformed actor entries

The helper should prefer a normal success response with an empty `Actors` array when no actors are selected.

Empty selection is not an error.

## Readiness Detection

Readiness is currently detected in a narrow, honest way:

- `GET /remote/preset/UE_AgentBridge_M0`
- backend checks whether the preset payload appears to mention `GetSelectedActors`

This is only a best-effort readiness signal. It is enough to advertise selected-actor support in healthcheck capabilities when the helper appears exposed, but it is not treated as proof that the helper implementation is correct.

The actual `ue_get_selected_actors` call remains authoritative.
