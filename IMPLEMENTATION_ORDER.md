# Implementation Order

This document defines the safest order for replacing the current `remote-control` backend stubs with real behavior.

The ordering follows the M0 rules:

1. `ue_healthcheck`
2. read-side tools
3. write-side tools last

The intent is to validate transport, shape, and discovery before any mutation path is trusted.

## Step 1: `ue_healthcheck`

### Why this order

This is the lowest-risk proof that the bridge can talk to Unreal at all. It also establishes whether Remote Control is reachable before any other backend method is attempted.

### What should be tested

- `GET /remote/info` succeeds
- timeout behavior is handled cleanly
- loopback-only config enforcement remains active
- optional preset lookup behavior works if added

### What can be validated without full Unreal automation

- request construction
- timeout handling
- response normalization
- readiness-state formatting

### What should block moving to the next step

- healthcheck cannot distinguish reachable versus unreachable backend
- startup or config path is still ambiguous

## Step 2: `ue_asset_search`

### Why this order

This is the safest fully documented read tool after healthcheck. It uses a direct Remote Control route, does not depend on live actor identity, and does not mutate editor state.

### What should be tested

- `remote/search/assets` request mapping
- `query`, `pathPrefix`, and `assetClass` translation into Remote Control filters
- result limiting
- normalization of `Name`, `Class`, and `Path`

### What can be validated without full Unreal automation

- HTTP payload formation
- filter mapping
- result normalization from mocked responses

### What should block moving to the next step

- asset response mapping is still ambiguous
- result-size limits are not enforced

## Step 3: `ue_get_property`

### Why this order

This is the simplest object-targeted read and establishes the exact `objectPath` handling needed later for `ue_set_property`.

### What should be tested

- `READ_ACCESS` request shape
- object path targeting
- property-name targeting
- not-found and not-readable error mapping

### What can be validated without full Unreal automation

- payload generation
- response unwrapping from `{ "<PropertyName>": value }`
- bridge-side target resolution policy

### What should block moving to the next step

- the backend still treats free-form actor names as fully reliable
- read errors are not differentiated from transport failures

## Step 4: `ue_get_level_actors`

### Why this order

This remains read-only, but it is the first multi-call workflow. It proves that the backend can combine direct Remote Control calls and normalize them into the bridge shape.

### What should be tested

- `EditorLevelLibrary.GetAllLevelActors` call
- batched describe follow-up calls
- bridge-side filtering by class and name fragment
- response bounding

### What can be validated without full Unreal automation

- batch request construction
- mapping from object paths and describe payloads into `ActorSummary`
- filtering logic

### What should block moving to the next step

- actor enumeration requires undocumented assumptions not captured in the contract
- response size is not bounded

## Step 5: `ue_get_selected_actors`

### Why this order

This is still read-only, but it is the first helper-backed editor-global action. It should come only after the direct read path is proven so the helper contract can stay narrow.

### What should be tested

- helper function discoverability through the preset
- request and response wrapper handling for preset function calls
- actor summary normalization
- empty-selection handling

### What can be validated without full Unreal automation

- preset endpoint request shape
- helper response unwrapping
- bridge-side normalization and limits

### What should block moving to the next step

- preset naming or helper naming is still unstable
- helper output shape is not fixed

## Step 6: `ue_get_output_log`

### Why this order

This is read-only, but more complex than the other read tools because it likely needs helper-backed log buffering. It should be implemented only after the direct read tools and the first preset helper path are stable.

### What should be tested

- helper readiness detection
- `minLevel` and `limit` parameter mapping
- log slice normalization
- bounded buffer behavior

### What can be validated without full Unreal automation

- preset call request shape
- bridge-side log-level filtering assumptions
- response normalization from helper output

### What should block moving to the next step

- there is still no concrete Unreal-side log buffer plan
- helper output is unbounded or unstable

## Step 7: `ue_set_property`

### Why this order

This is the first write path. It should only land after `ue_get_property` and `ue_get_level_actors` are stable, so writes can target known object paths and verify the result with a read-back.

### What should be tested

- `WRITE_TRANSACTION_ACCESS` request shape
- verification read-back
- writable-property failure handling
- value serialization for allowed M0 property types

### What can be validated without full Unreal automation

- payload generation
- read-after-write sequencing
- error classification

### What should block moving to the next step

- object identity is still ambiguous
- verification read-back is not implemented
- writable-property policy is not explicit

## Step 8: `ue_run_console_command_safe`

### Why this order

This is the riskiest M0 write-like action because it crosses from structured data mutation into command dispatch. It must be last so the safety model is already proven elsewhere.

### What should be tested

- bridge-side allowlist enforcement
- Unreal-side helper allowlist enforcement
- normalized command echoing
- rejection path for non-allowlisted commands

### What can be validated without full Unreal automation

- command normalization
- allowlist checks
- request and response wrapper handling for preset helper calls

### What should block moving to the next step

- Unreal-side helper does not re-check the allowlist
- actual editor command execution path is still unclear

## Recommended Validation Strategy

Use three layers of validation as implementation proceeds.

### Layer 1: bridge-only unit tests

Validate:

- request payload generation
- response normalization
- error mapping
- allowlist behavior

### Layer 2: mocked HTTP adapter tests

Validate:

- exact Remote Control route selection
- exact request bodies
- exact bridge handling of Unreal-like responses

### Layer 3: manual local Unreal checks

Validate:

- route reachability on localhost
- real object paths
- helper preset discoverability
- property read and write behavior
- actual safe command handling

## Blocking Rule Between Stages

Do not move from one stage to the next just because the next tool is more interesting.

Move only when:

- the current tool's request shape is fixed
- the current tool's response shape is fixed
- transport failure and domain failure are distinguished
- bounded-result behavior is enforced

That rule is what keeps M0 from drifting into a vague half-working integration.
