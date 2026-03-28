# AGENTS.md

This repository provides a bounded Unreal Engine bridge for external coding agents.

Read [AGENT_PLAYBOOK.md](./AGENT_PLAYBOOK.md) first and follow it as the default operating model.

## Short Rules

- keep repo reasoning, code edits, shell, builds, and git outside Unreal
- use Unreal through the bridge tool layer, not as the primary work environment
- default to `UE_BACKEND_MODE=plugin` for real sessions
- run `ue_healthcheck` before relying on Unreal
- prefer read operations before write operations
- for C++ compile failures, trust the external build log and parsed JSON diagnostics first
- for editor/runtime state, trust the Unreal plugin backend

## Required Workflow Choices

When the task is about C++:

- edit code in the repo
- build outside Unreal with `scripts/run-ue-build.ps1`
- if Unreal is open after a successful build, use `ue_get_live_coding_status` and `ue_trigger_live_coding_build_safe`

When the task is about live editor state:

- use `ue_get_selected_actors`
- use `ue_get_level_actors`
- use `ue_get_property`
- use `ue_get_output_log`
- use `ue_get_editor_diagnostics`
- use `ue_get_editor_state`
- use `ue_get_viewport_camera` when camera state matters
- use `ue_set_viewport_camera` only for bounded viewport navigation
- use `ue_frame_actor` or `ue_capture_actor_screenshot` when the subject may be off-screen or tiny
- use `ue_get_viewport_screenshot` when the question is visual
- use `ue_get_debug_draw_state` with viewport screenshots for `DrawDebugLine` and other debug geometry
- use `ue_compare_viewport_screenshot` for stable visual regression checks against a reference image

## Do Not

- do not invent raw Unreal-side execution paths
- do not use arbitrary console strings
- do not recreate repo awareness inside Unreal
- do not broaden mutations beyond the named tool surface
- do not keep pushing if `ue_healthcheck` says the backend is not ready
