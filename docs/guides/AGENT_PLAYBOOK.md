# Agent Playbook

This is the practical operating guide for external coding agents using `UE_AgentBridge`.

Use this document as the default workflow reference. `AGENTS.md` and `CLAUDE.md` should stay aligned with it.

## Core Model

Keep the boundary explicit:

- repository reasoning, file edits, git, shell, and builds stay outside Unreal
- Unreal Editor is a bounded tool layer for live editor state and narrow editor actions

Do not move repo awareness into Unreal.

## Preferred Backend

Default to `plugin` mode for real work:

- `UE_BACKEND_MODE=plugin`

`remote-control` is a fallback path, not the preferred daily workflow.

## Start Of Session

If the task will touch Unreal, do this first:

1. Confirm the bridge is running in `plugin` mode.
2. Run `ue_healthcheck`.
3. Read the reported capability readiness.
4. If health is red, do not guess. Fix environment readiness first.

## Tool Selection Rules

Stay in repo and shell when the task is about:

- C++ code changes
- build system changes
- project structure
- git history or diffs
- tests
- docs

Use Unreal tools when the task depends on:

- current editor selection
- actors in the loaded level
- live editor property state
- what is actually visible in the viewport
- where the active viewport camera is or needs to move
- Unreal asset registry view
- bounded output log state
- editor diagnostics
- live coding readiness

## Default Sequences

### Investigate A Live Editor Problem

1. Run `ue_healthcheck`.
2. Run `ue_get_editor_state`.
3. Run `ue_get_output_log`.
4. Run `ue_get_editor_diagnostics`.
5. If the issue is visual, run `ue_get_viewport_screenshot`.
6. If the subject may be off-screen, tiny, or distant, run `ue_get_viewport_camera` and `ue_frame_actor`.
7. If the issue involves debug geometry, also run `ue_get_debug_draw_state`.
8. If actor state matters, run `ue_get_selected_actors` or `ue_get_level_actors`.
9. Return to repo reasoning for the actual fix.

### Verify A Visual Viewport Result

1. Run `ue_healthcheck`.
2. Run `ue_get_editor_state`.
3. Run `ue_get_viewport_camera` if framing may be wrong.
4. If the subject may be small, distant, or off-screen, run `ue_frame_actor` or `ue_capture_actor_screenshot`.
5. If the question is visual, run `ue_get_viewport_screenshot`.
6. If the question is about `DrawDebugLine` or debug geometry, also run `ue_get_debug_draw_state`.
7. For stable regression checks, prefer `ue_compare_viewport_screenshot` against a saved reference image.
8. Use screenshot metadata together with other bounded tools.
9. Do not guess visual success from code alone when the viewport image is the real source of truth.

### Change C++ And Validate It

1. Edit C++ in the repo.
2. Build outside Unreal with:
   - `powershell -ExecutionPolicy Bypass -File .\scripts\run-ue-build.ps1 -ProjectRoot "<ProjectRoot>" -ProjectName "<ProjectName>" -EditorTarget`
3. If that build fails, trust the parsed JSON diagnostics in `<Project>\Saved\UEAgentBridgeBuild`.
4. If the build succeeds and Unreal Editor is open, run:
   - `ue_get_live_coding_status`
   - `ue_trigger_live_coding_build_safe`
   - `ue_get_editor_diagnostics`
5. If Unreal Editor is closed, reopen it only when live validation is needed.

### Change A Narrow Live Editor Property

1. Run `ue_healthcheck`.
2. Identify the target with `ue_get_selected_actors` or `ue_get_level_actors`.
3. Read the current value with `ue_get_property`.
4. If the target and property are correct, run `ue_set_property`.
5. Verify with a follow-up `ue_get_property`.
6. Check `ue_get_output_log` if the property could trigger warnings.

### Run A Safe Unreal Diagnostic Command

1. Confirm the command maps to a supported `commandId`.
2. Run `ue_run_console_command_safe`.
3. Inspect `ue_get_output_log` if needed.

Do not invent raw console strings.

## C++ Build Rules

For full external `Editor` target builds:

- Unreal Editor should be closed for the same project
- the build wrapper now blocks early if the editor is still open

For in-editor iteration:

- use the external build loop first
- then use Live Coding through the Unreal tool layer

Do not treat Unreal as the primary compile host.

## Safety Rules

- prefer read operations before writes
- narrow the target before mutation
- verify after mutation when practical
- do not use Unreal as a hidden shell
- do not assume arbitrary execution is acceptable
- do not expand from named tools into generic editor control

## What Not To Do

Do not:

- recreate repo awareness inside Unreal
- run arbitrary console commands
- attempt generic Blueprint authoring through ad hoc calls
- make broad scene mutations without an explicit narrow target
- trust Unreal-side diagnostics over external compiler output for C++ build failures

## Source Of Truth Rules

For C++ compile failures:

- source of truth is the external build log and parsed JSON diagnostics

For editor runtime state:

- source of truth is the Unreal plugin backend

For visual viewport verification:

- source of truth is `ue_get_viewport_screenshot` from the plugin backend
- for debug geometry, combine `ue_get_viewport_screenshot` with `ue_get_debug_draw_state`
- for navigation-sensitive capture, use `ue_get_viewport_camera`, `ue_frame_actor`, or `ue_capture_actor_screenshot` first

For asset/property fallback:

- source of truth may still come through Remote Control-backed calls

## If A Capability Is Missing

If `ue_healthcheck` reports a missing capability:

1. stop trying to improvise around it
2. report the missing readiness clearly
3. continue with repo-only work if possible

Do not silently switch to a broader or unsafe mechanism.

## Context Hygiene For Vision

- capture screenshots on demand after a meaningful state change
- do not flood context with repeated screenshots
- use `ue_compare_viewport_screenshot` when a reference image can answer the question more efficiently than manual visual comparison
- save image artifacts only when they improve reproducibility, regression checks, or reporting
