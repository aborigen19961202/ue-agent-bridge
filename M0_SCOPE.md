# M0 Scope

## Smallest Useful Vertical Slice

M0 is the smallest bridge that lets an external repo-aware agent inspect the current Unreal Editor state and make tightly bounded edits without broad execution.

M0 is useful if an agent can:

- verify that Unreal Editor is reachable
- inspect the current level and current selection
- inspect and change a known property on a known target
- search project assets
- read recent editor log output
- run a small set of safe console commands

That is enough to make Unreal a real tool layer instead of a vague future dependency.

## M0 Assumptions

- Localhost-only operation
- Single local developer machine, likely Windows
- External agent remains the repo-aware coordinator
- Unreal Editor is already running locally
- Unreal Remote Control API is the primary UE interaction path
- All bridge tools are explicitly allowlisted
- No arbitrary code execution
- No broad batch mutation

## Explicit M0 Tools

### `ue_healthcheck`

Confirms that the bridge can reach the local Unreal Editor and that the expected Unreal-side surfaces are available.

### `ue_get_selected_actors`

Returns the current editor selection with stable identifiers and basic metadata.

### `ue_get_level_actors`

Returns actors in the current level with bounded metadata and optional filtering.

### `ue_get_property`

Reads a specific property from a specific actor or object path.

### `ue_set_property`

Writes a specific allowlisted property on a specific target with validation and clear result reporting.

### `ue_asset_search`

Searches assets by path, class, or name fragment with predictable filtering.

### `ue_get_output_log`

Returns recent Unreal log output with severity filtering and bounded line count.

### `ue_run_console_command_safe`

Runs only audited, non-destructive console commands from an allowlist or strict pattern set.

Not allowed in M0:
- commands that trigger arbitrary execution
- commands that build, cook, package, delete, or broadly mutate project state

## Safety Model For M0

- loopback-only transport
- explicit tool allowlist
- explicit argument validation
- read operations should usually happen before writes
- write operations must target known objects and known properties
- safe console commands must be allowlisted, not merely filtered by best effort
- bounded result sizes for logs, actor lists, and searches
- no hidden fallback into arbitrary Python, arbitrary C++, or shell execution inside Unreal

## Out Of Scope For M0

- arbitrary Python execution
- arbitrary C++ execution
- Live Coding control
- compiling C++ from inside Unreal
- broad asset import pipelines
- Blueprint graph authoring
- level save-all or project-wide save operations
- actor spawning and deletion
- async job orchestration
- remote multi-machine access
- subscriptions, event streaming, or continuous editor observation
- replacing repo/file/git/terminal workflows

## Why Remote Control Is Enough For M0

M0 only needs bounded editor reads and narrowly scoped writes. Those operations map well to a Remote Control based approach because the bridge does not need full project automation yet. For this stage, the goal is not "complete Unreal control"; it is "reliable access to a small set of useful editor facts and safe edits."

Remote Control is sufficient for that kind of surface area, especially if M0 standardizes a small reusable exposure pattern for the required reads and writes. That keeps the first version thin and avoids building a resident Unreal backend before there is proof that the bridge is genuinely useful.

## What M0 Does Not Solve Yet

- robust support for workflows that require engine-side orchestration beyond exposed editor operations
- C++ iteration loops, including build, compile, hot reload, and Live Coding state management
- deep Blueprint or graph editing workflows
- rich event subscriptions from Unreal back to the agent
- durable long-running task management inside Unreal
- cases where target projects cannot expose the needed data cleanly through Remote Control alone

M0 should be honest about that. It proves the interaction model first.

## Success Criteria

M0 is successful if a local external agent can do the following without unsafe escape hatches:

1. confirm the editor connection
2. inspect the current selection or current level actors
3. read a known property
4. set a known property and verify it
5. search assets
6. inspect recent log output
7. run a safe diagnostic console command
