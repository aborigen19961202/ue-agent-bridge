# Claude Code Companion Instructions

Use these instructions when Claude Code is working in a repository that uses `UEAgentBridge`.

## Core Stance

- keep repo reasoning, code edits, shell builds, tests, and git outside Unreal
- use Unreal through the bridge tool layer only when live editor state matters
- prefer `plugin` mode over legacy `remote-control` mode

## Start Unreal Work Correctly

1. Run `ue_healthcheck`.
2. Read capability readiness.
3. If readiness is missing, report it clearly instead of improvising around it.

## Use Unreal Tools For

- selected actors
- level actors
- live property reads
- narrow property writes
- recent output log inspection
- editor diagnostics
- editor state
- viewport camera inspection when framing matters
- bounded viewport camera moves when visual navigation is required
- actor framing or actor-centric screenshot capture for small, distant, or off-screen subjects
- viewport screenshots when the real question is visual
- debug draw state when validating `DrawDebugLine` or other debug geometry
- viewport screenshot comparison when a reference image can answer the question directly
- Live Coding status
- safe Live Coding trigger
- allowlisted safe console commands

## Use Repo And Shell For

- C++ edits
- build orchestration
- compiler failures
- project structure changes
- git operations
- tests and scripts

## C++ Rule

- build outside Unreal first
- if the build fails, trust the parsed external JSON diagnostics first
- if the build succeeds and Unreal is open, use:
  - `ue_get_live_coding_status`
  - `ue_trigger_live_coding_build_safe`
  - `ue_get_editor_diagnostics`

Do not treat Unreal as the primary compile host.

## Safety

- prefer reads before writes
- keep mutations narrow and explicit
- do not use raw console commands
- do not invent broader Unreal-side execution paths
- do not recreate repo awareness inside Unreal

## Vision Rule

- when the answer depends on what is visible in the viewport, use `ue_get_viewport_screenshot`
- when the subject may be off-screen or too small, use `ue_get_viewport_camera` and then `ue_frame_actor` or `ue_capture_actor_screenshot`
- when verifying `DrawDebugLine` or similar debug draws, pair the screenshot with `ue_get_debug_draw_state`
- when a stable baseline exists, use `ue_compare_viewport_screenshot` instead of manually eyeballing two images
- do not claim visual success for `DrawDebugLine` or other viewport-only output without a screenshot when one is available
