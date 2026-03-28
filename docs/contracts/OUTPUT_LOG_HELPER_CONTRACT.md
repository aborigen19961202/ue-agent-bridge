# Output Log Helper Contract

This document defines the minimum Unreal-side helper contract for `ue_get_output_log`.

The goal is a bounded snapshot, not a general logging system.

## Why A Helper Is Required

`ue_get_output_log` is not being implemented through pure Remote Control routes because Unreal Remote Control does not document a direct output-log history endpoint.

For M0, log retrieval is treated as one helper-backed capability exposed through a Remote Control Preset.

## Required Unreal-Side Surface

- one preset named `UE_AgentBridge_M0`
- one exposed callable function named `GetOutputLogSlice`

This function may be backed by:

- a helper object with access to a bounded in-memory log buffer
- a Blueprint-accessible wrapper over a bounded log snapshot source
- a small editor-side class that exposes a bounded log slice

The bridge does not assume how the buffer is maintained internally. It only assumes the exposed contract below.

## Bounded Snapshot Model

M0 output-log retrieval means:

- last `N` matching entries only
- no streaming
- no subscriptions
- no cursoring
- no unbounded history

For M0, bounded means:

- helper request limit must never exceed `200`
- helper response must never exceed the requested limit
- the Unreal-side helper should maintain only a bounded in-memory buffer sized for local debugging snapshots, not full-session archival history

## Remote Control Route

The TypeScript backend calls:

```http
PUT /remote/preset/UE_AgentBridge_M0/function/GetOutputLogSlice
Content-Type: application/json
```

```json
{
  "Parameters": {
    "Limit": 50,
    "MinLevel": "Warning"
  },
  "GenerateTransaction": false
}
```

`Limit` is optional at the tool surface, but the backend will always send an explicit bounded value.

`MinLevel` is optional. When omitted, the helper should return entries at or above its default baseline for M0.

## Expected Response Shape

The backend expects the standard preset-function wrapper with one returned object containing `Entries`:

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

Required fields per entry:

- `Timestamp`
- `Level`
- `Category`
- `Message`

Allowed `Level` values for M0:

- `Verbose`
- `Log`
- `Display`
- `Warning`
- `Error`

## Mapping To `OutputLogEntry`

Each helper entry maps to:

```json
{
  "timestamp": "2026-03-11T10:02:05Z",
  "level": "Error",
  "category": "LogBlueprint",
  "message": "Compile warning promoted to error."
}
```

The backend does not infer or repair missing fields.

## Limit Enforcement

The TypeScript backend uses these bounds:

- default requested limit: `50`
- hard cap: `200`

The helper should honor the requested limit and must not return more entries than requested.

If the helper returns more entries than requested, the backend treats that as a malformed bounded-snapshot response rather than truncating it silently.

## Failure Modes

Expected failure classes:

- Remote Control endpoint unreachable
- preset missing
- `GetOutputLogSlice` function not exposed
- helper buffer not initialized
- helper returns malformed wrapper shape
- helper returns malformed log entries
- helper returns more entries than requested

Empty `Entries` is a successful empty result.

## Readiness Detection

Readiness is currently detected in a narrow, honest way:

- `GET /remote/preset/UE_AgentBridge_M0`
- backend checks whether the preset payload appears to mention `GetOutputLogSlice`

This is only a best-effort readiness signal. It is enough to advertise `ue_get_output_log` in healthcheck capabilities when the helper appears exposed, but it is not treated as proof that the helper implementation is correct.

The actual `ue_get_output_log` call remains authoritative.
