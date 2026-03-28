# M1 Plugin-First Plan

M0 proved the bridge shape, but it did not solve the actual product UX.

If the goal is "let external agents control Unreal Editor without making the user hand-build presets and helper assets in every project", then M1 should move to a plugin-first Unreal-side integration model.

## Chosen M1 Direction

M1 should introduce a lightweight Unreal plugin that provides a stable, bounded Unreal-side backend for the bridge.

The plugin should remove the need for manual `UE_AgentBridge_M0` preset creation as the main integration path.

The bridge should keep:

- the external MCP server
- the external repo-aware agent model
- the backend adapter boundary
- the localhost-only safety stance

The bridge should stop depending on manual preset authoring as the primary user workflow.

## Why Change Direction After M0

M0 established three useful facts:

- external agent plus Unreal tool layer is the right product model
- the TypeScript MCP server boundary is correct
- Unreal Remote Control is useful, but not a sufficient product UX on its own

M0 also exposed two real limitations:

- helper-backed capabilities require project-local Unreal setup that is too manual
- some editor-global calls are not reliable enough across engine versions as pure Remote Control calls

The live UE 5.7 validation already showed this directly:

- `ue_healthcheck`, `ue_asset_search`, `ue_get_property`, and `ue_set_property` worked against real Remote Control
- `ue_get_level_actors` did not work on the current project because `GetAllLevelActors` was reported as deprecated or unavailable remotely
- helper-backed tools were blocked until a preset and helper functions existed

That is acceptable for M0. It is not acceptable as the long-term product UX.

## M1 Product Goal

Install one Unreal plugin, point the external bridge at the local editor, and use the same tool surface without hand-authoring presets.

For the user, the ideal M1 experience is:

1. enable or install the UE plugin once
2. start Unreal Editor
3. start the MCP bridge
4. let the external agent use Unreal tools directly

No manual preset authoring should be required for the normal path.

## M1 Architecture Stance

M1 should add a new Unreal-side backend path, not replace the existing bridge architecture.

Recommended shape:

- keep the current TypeScript MCP layer
- keep the Unreal backend interface
- add a new backend adapter for a plugin-owned localhost endpoint
- keep the current Remote Control backend for M0 compatibility and fallback

This preserves the product model while removing manual preset dependency.

## What The Unreal Plugin Should Own

The plugin should own the capabilities that are either helper-dependent or too unstable through raw Remote Control.

Priority M1 plugin-owned capabilities:

- selected actor retrieval
- level actor enumeration
- bounded output log snapshot
- safe console command execution through an internal allowlist

Likely keep on Remote Control initially:

- asset search
- simple property reads
- simple property writes

This keeps M1 smaller. The plugin only needs to take over the parts where Remote Control is the wrong UX or not reliable enough.

## Plugin Responsibilities

The plugin should:

- expose a narrow localhost-only backend for bridge calls
- provide stable request and response contracts for the bounded tool set
- own editor-global and helper-like operations internally
- re-check safety rules on the Unreal side
- report readiness clearly so `ue_healthcheck` can stop guessing

The plugin should not:

- become an in-editor chat assistant
- become a repo-aware agent
- expose arbitrary execution
- expose broad Blueprint authoring
- expose unrestricted console command execution
- expose project-wide destructive mutation

## Suggested M1 Backend Surface

The first plugin backend does not need to cover everything.

Minimum useful plugin surface:

- `bridge_health`
- `get_selected_actors`
- `get_level_actors`
- `get_output_log_slice`
- `run_console_command_safe`

Optional next step after that:

- `get_property`
- `set_property`

That means M1 can improve user experience materially without rewriting the whole bridge.

## Transport Recommendation

Use a plugin-owned localhost HTTP backend first.

Reasoning:

- it matches the current bridge assumptions well
- it stays practical on local Windows setups
- it is easy to test independently from MCP
- it avoids forcing everything through Remote Control semantics

WebSocket or push/event work can wait.

## Installation Model

The plugin should be distributable in one of two supported ways:

- as a project plugin under `Plugins/UEAgentBridge`
- as an engine plugin for teams that want reuse across multiple projects

The product should prefer "drop in the plugin" over "author a preset asset by hand".

## Safety Model For M1

M1 should preserve M0's safety stance:

- localhost only
- deny by default
- named tool contracts only
- bounded payload sizes
- bounded log reads
- allowlisted console command IDs only
- explicit target identifiers for reads and writes

The plugin may make setup easier, but it must not weaken the control boundary.

## Practical Implementation Order

### Step 1: Plugin Skeleton

- create a minimal Unreal plugin
- start only in editor
- expose a localhost health endpoint
- report plugin version and capability readiness

### Step 2: Selected Actors

- move `ue_get_selected_actors` from preset-helper dependence to plugin backend
- return the same normalized `ActorSummary` shape

### Step 3: Level Actors

- move `ue_get_level_actors` to the plugin backend
- stop relying on `EditorLevelLibrary.GetAllLevelActors` being remotely callable everywhere

### Step 4: Output Log

- provide a bounded in-memory log slice endpoint
- keep the same hard-cap model as M0

### Step 5: Safe Console Commands

- keep command-ID based allowlisting
- revalidate IDs inside the plugin before execution

### Step 6: Bridge Integration

- add a new backend adapter in the TypeScript bridge
- keep Remote Control backend available as M0 fallback
- do not change the external tool names

## What M1 Should Explicitly Not Do

M1 should not turn into a large Unreal automation platform.

Still out of scope:

- arbitrary console execution
- Blueprint generation
- actor spawning and deletion as generic agent tools
- save-all operations
- C++ build or Live Coding orchestration
- generic command dispatch
- broad event bus design

## Definition Of M1 Success

M1 is successful when:

- a user can install one plugin instead of hand-building a preset
- the external bridge works against the plugin backend locally
- selected actors, level actors, bounded log reads, and safe console commands work without manual preset setup
- the external tool surface remains stable for Codex or Claude Code

## Relationship To The Current Repository

This direction does not invalidate M0.

M0 remains useful as:

- the first release
- a working MCP bridge
- a proof that the external-agent model is correct
- a fallback Remote Control path

M1 simply moves the Unreal-side integration toward the product shape users actually want.
