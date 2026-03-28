# Agent Usage Model

## Core Principle

Unreal is a first-class tool layer, not a fallback and not the agent's primary working environment.

The external agent should treat the repository and the Unreal Editor as two different but cooperating surfaces:

- repo mode for source, config, git, shell, and architecture work
- Unreal tool mode for editor state, asset state, selection state, log state, and narrow editor actions

## Stay In Repo/File/Git/Terminal Mode When

- reading or editing source files
- reasoning about module structure, APIs, or build configuration
- running tests, linters, generators, or local scripts
- using git history, diffs, branches, or commits
- updating docs, configs, CI, or repository layout
- making decisions that depend on the real file tree rather than editor state

## Use Unreal Tools When

- the question depends on current editor selection
- the question depends on actors currently in the loaded level
- an asset needs to be searched from Unreal's point of view
- a property should be read from a live editor object
- a narrow editor property change is required
- the recent Unreal output log matters
- a safe console command can reveal runtime or editor state faster than file inspection

## Sequencing Expectations

- prefer repo reasoning first when the task is fundamentally about code or architecture
- use `ue_healthcheck` early when a task will depend on Unreal
- prefer read operations before write operations
- narrow the target before mutation
- verify after mutation when practical
- return to repo mode after Unreal has supplied the needed editor state

## Mixed Workflow Examples

### Example 1: Fixing A Gameplay Property Bug

1. Inspect source code and config in the repo.
2. Use `ue_healthcheck`.
3. Use `ue_get_level_actors` or `ue_get_selected_actors` to locate the live editor target.
4. Use `ue_get_property` to confirm actual editor state.
5. If the fix is an editor-side property tweak, use `ue_set_property`.
6. Use `ue_get_output_log` to check for warnings or errors.
7. Return to repo mode for any code changes or commit preparation.

### Example 2: Verifying An Asset Reference

1. Search the repository for the code or config that expects an asset.
2. Use `ue_asset_search` to confirm the asset exists and matches the expected path or class.
3. If needed, inspect a live actor property with `ue_get_property`.
4. Edit repo files outside Unreal if the issue is actually a code-side reference problem.

### Example 3: Local Debugging Session

1. Read code and recent changes in the repo.
2. Use `ue_get_output_log` to inspect the latest Unreal-side errors.
3. Use `ue_run_console_command_safe` only for a bounded diagnostic command.
4. Use repo tools to implement the actual fix.

## Safety Expectations

- do not assume Unreal tools are safe just because they are local
- read operations should usually come before writes
- broad or destructive actions require extra caution
- console command execution must stay within the bridge's safe command surface
- do not treat Unreal as a hidden shell or arbitrary execution environment

## Unreal Is Not A Repo Mirror

The bridge should not try to recreate repository awareness inside Unreal. The agent should already know how to reason about files, git, and architecture from the real workspace. Unreal tools exist to provide editor-only state and operations, not to duplicate the repository layer badly.

## Relationship To `AGENTS.md` And `CLAUDE.md`

This document defines the operating model. Future `AGENTS.md` and `CLAUDE.md` files should operationalize it for specific clients:

- when to use Unreal tools
- when to stay outside Unreal
- what order to follow
- what kinds of actions require caution

Those files should stay aligned with this document rather than inventing different models per agent.
