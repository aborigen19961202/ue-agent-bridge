# Tool Surface

## Preferred Backend

Use `plugin` mode as the normal path.

Plugin-owned tools:

- `ue_healthcheck`
- `ue_get_selected_actors`
- `ue_get_level_actors`
- `ue_get_output_log`
- `ue_get_editor_diagnostics`
- `ue_get_editor_state`
- `ue_get_viewport_camera`
- `ue_set_viewport_camera`
- `ue_spawn_actor_safe`
- `ue_select_actor_safe`
- `ue_destroy_actor_safe`
- `ue_frame_actor`
- `ue_get_viewport_screenshot`
- `ue_capture_actor_screenshot`
- `ue_compare_viewport_screenshot`
- `ue_get_debug_draw_state`
- `ue_get_live_coding_status`
- `ue_trigger_live_coding_build_safe`
- `ue_run_console_command_safe`

Remote Control fallback still matters for:

- `ue_asset_search`
- `ue_get_property`
- `ue_set_property`

## Source Of Truth Rules

For C++ compile failures:

- source of truth is the external build log and parsed JSON diagnostics

For live editor state:

- source of truth is the Unreal plugin backend

For visual viewport verification:

- source of truth is `ue_get_viewport_screenshot`
- for debug geometry, combine `ue_get_viewport_screenshot` with `ue_get_debug_draw_state`
- for small, distant, or off-screen subjects, use `ue_get_viewport_camera`, `ue_frame_actor`, or `ue_capture_actor_screenshot`

For asset search and explicit property read/write:

- source of truth may still come through the Remote Control fallback path

## Important Limits

Still intentionally unsupported:

- arbitrary Unreal execution
- raw console command strings
- generic Blueprint authoring
- Blueprint or asset-driven actor spawning through unrestricted classes or factories
- broad destructive mutation
- generic project-wide save actions
- log streaming or subscriptions

Important:

- `ue_get_viewport_screenshot` is on-demand vision, not a streaming transport
- `ue_get_viewport_camera` and `ue_set_viewport_camera` are bounded navigation tools for the active viewport
- `ue_spawn_actor_safe` is a bounded editor-world mutation that requires one class identifier plus an explicit transform, and only allows project/project-plugin actor classes plus a small native fast-path
- `ue_select_actor_safe` is the supported way to prepare follow-up selection-dependent checks without UI scripting
- `ue_destroy_actor_safe` is limited targeted cleanup, not a generic scene-editing API
- `ue_frame_actor` is the preferred way to recover when the subject is outside the current view
- `ue_capture_actor_screenshot` is the preferred high-level path for actor-centric visual checks
- `ue_compare_viewport_screenshot` is the preferred path for stable reference-image checks
- `ue_get_debug_draw_state` is the preferred semantic companion for `DrawDebugLine` and other line-batcher debug primitives
- prefer taking a screenshot after a meaningful state change instead of repeatedly flooding context

## Safe Mutation Policy

`ue_spawn_actor_safe`, `ue_select_actor_safe`, and `ue_destroy_actor_safe` are explicit bounded mutations:

- they run only against the editor world
- they do not expose script execution or raw console input
- spawn uses a deny-by-default project/plugin scope policy instead of a hardcoded exact-class allowlist
- safe spawn accepts:
  - native fast-path actor classes such as lights, `TargetPoint`, and `PlayerStart`
  - project-native actor classes under `/Script/<ProjectModule>.*`
  - project-plugin actor classes under `/Script/<ProjectPluginModule>.*`
  - project Blueprint actor classes under `/Game/..._C` when they still resolve to actor classes
- spawn still rejects:
  - non-actor classes
  - abstract or deprecated classes
  - transient-only / not-placeable exotic classes
  - classes outside the allowed project/plugin scope
- destroy follows the same class-scope policy for targeted cleanup
- select stays broader because it is a bounded focus operation, not object creation or destruction

## Allowlisted Console Commands

Supported `commandId` values:

- `stat_fps`
- `stat_unit`
- `stat_memory`
- `show_bounds`
- `show_collision`
- `show_navigation`

## Live Coding Rule

`ue_trigger_live_coding_build_safe` is narrow:

- use it only after the external build loop
- do not treat it as a replacement for normal repo-side build orchestration
