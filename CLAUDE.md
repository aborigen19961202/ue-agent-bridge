# CLAUDE.md

Use [AGENT_PLAYBOOK.md](./docs/guides/AGENT_PLAYBOOK.md) as the main operating guide for this repository.

This bridge exists so Claude Code can stay repo-aware outside Unreal while using Unreal Editor as a bounded tool layer.

## Working Stance

- keep code edits, shell, builds, git, and architecture reasoning outside Unreal
- use the Unreal bridge only when live editor state matters
- prefer `plugin` mode over legacy `remote-control` mode
- start Unreal-dependent work with `ue_healthcheck`

## Practical Defaults

- for C++ work, build outside Unreal with `scripts/run-ue-build.ps1`
- if that build fails, trust the parsed JSON build diagnostics first
- if that build succeeds and Unreal is open, use Live Coding through:
  - `ue_get_live_coding_status`
  - `ue_trigger_live_coding_build_safe`
- for live editor inspection, use:
  - `ue_get_selected_actors`
  - `ue_get_level_actors`
  - `ue_get_property`
  - `ue_get_output_log`
  - `ue_get_editor_diagnostics`
  - `ue_get_editor_state`
  - `ue_get_viewport_camera` when framing matters
  - `ue_set_viewport_camera` only for bounded viewport navigation
  - `ue_frame_actor` or `ue_capture_actor_screenshot` for small, distant, or off-screen subjects
  - `ue_get_viewport_screenshot` when viewport visibility is the actual question
  - `ue_get_debug_draw_state` when validating `DrawDebugLine` or other debug geometry
  - `ue_compare_viewport_screenshot` when a reference image provides a clearer visual verdict

## Safety

- prefer reads before writes
- keep mutations narrow and explicit
- do not use raw console commands
- do not invent broader Unreal-side execution paths
- do not treat Unreal as a repo mirror

If Unreal readiness is missing, report that clearly and fall back to repo-only work when possible.
