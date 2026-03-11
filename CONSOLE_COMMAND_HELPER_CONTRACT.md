# Console Command Helper Contract

This document defines the minimum Unreal-side helper contract for `ue_run_console_command_safe`.

The goal is a deny-by-default command launcher, not a generic console execution bridge.

## Why A Helper Is Required

`ue_run_console_command_safe` is not implemented through a raw console-command string pipe.

For M0, safe console execution is treated as one helper-backed capability exposed through a Remote Control Preset, with helper-side revalidation of a fixed command-ID allowlist.

## Required Unreal-Side Surface

- one preset named `UE_AgentBridge_M0`
- one exposed callable function named `RunSafeConsoleCommand`

The helper may be backed by:

- an editor utility object
- a Blueprint-accessible helper object
- a small editor-side class

The bridge does not assume how command execution is implemented internally. It only assumes the exposed contract below.

## Deny-By-Default Command Model

The TypeScript tool surface accepts only a `commandId`.

For M0, the allowlisted IDs are:

- `stat_fps`
- `stat_unit`
- `stat_memory`
- `show_bounds`
- `show_collision`
- `show_navigation`

Helper-side revalidation must map the incoming `commandId` to one exact Unreal console command and reject everything else.

The helper must not accept arbitrary command strings from the bridge.

## Remote Control Route

The TypeScript backend calls:

```http
PUT /remote/preset/UE_AgentBridge_M0/function/RunSafeConsoleCommand
Content-Type: application/json
```

```json
{
  "Parameters": {
    "CommandId": "stat_fps"
  },
  "GenerateTransaction": false
}
```

## Expected Response Shape

The backend expects the standard preset-function wrapper with one returned object:

```json
{
  "ReturnedValues": [
    {
      "Accepted": true,
      "CommandId": "stat_fps",
      "ExecutedCommand": "stat fps",
      "Message": "Command executed."
    }
  ]
}
```

Required fields:

- `Accepted`
- `CommandId`
- `Message`

Required when `Accepted` is `true`:

- `ExecutedCommand`

## Helper-Side Revalidation

The helper must:

1. read `CommandId`
2. compare it against the fixed allowlist
3. map the allowed ID to one exact Unreal console command
4. reject unknown IDs
5. execute only the mapped command

The helper must not trust the client-side allowlist blindly.

## Success Semantics

Success means:

- helper returned `Accepted: true`
- helper reported the same `CommandId` that was requested
- helper returned the mapped `ExecutedCommand`

The backend treats that result as a successful safe-console execution.

## Failure Modes

Expected failure classes:

- Remote Control endpoint unreachable
- preset missing
- `RunSafeConsoleCommand` function not exposed
- command ID not allowlisted on the client side
- command ID rejected by helper-side revalidation
- helper returns malformed wrapper shape
- helper reports execution failure

If helper-side revalidation rejects the command ID, the helper should return a normal function response with:

```json
{
  "ReturnedValues": [
    {
      "Accepted": false,
      "CommandId": "unknown_id",
      "Message": "Command ID is not allowlisted."
    }
  ]
}
```

## Readiness Detection

Readiness is currently detected in a narrow, honest way:

- `GET /remote/preset/UE_AgentBridge_M0`
- backend checks whether the preset payload appears to mention `RunSafeConsoleCommand`

This is only a best-effort readiness signal. It is enough to advertise `ue_run_console_command_safe` in healthcheck capabilities when the helper appears exposed, but it is not treated as proof that the helper implementation is correct.

The actual tool call remains authoritative.
