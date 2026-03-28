# Workflows

## Start Of Session

If the task will depend on Unreal:

1. Confirm the bridge is intended to run in `plugin` mode.
2. Run `ue_healthcheck`.
3. Read capability readiness.
4. If readiness is missing, fix that first or continue with repo-only work.

## C++ Change And Validation Loop

1. Edit C++ in the repo.
2. Run the external build wrapper:
   - `powershell -ExecutionPolicy Bypass -File .\scripts\run-ue-build.ps1 -ProjectRoot "<ProjectRoot>" -ProjectName "<ProjectName>" -EditorTarget`
3. If the build fails:
   - trust the parsed JSON diagnostics in `<Project>\Saved\UEAgentBridgeBuild`
   - do not expect Unreal-side diagnostics to replace compiler output
4. If the build succeeds and Unreal is open:
   - run `ue_get_live_coding_status`
   - run `ue_trigger_live_coding_build_safe`
   - run `ue_get_editor_diagnostics`
   - run `ue_get_output_log`

Important:

- full external `Editor` target builds should run with Unreal Editor closed
- the wrapper fails early if the same project is already open in Unreal

## Live Editor Investigation

1. Run `ue_healthcheck`.
2. Run `ue_get_editor_state`.
3. Run `ue_get_output_log`.
4. Run `ue_get_editor_diagnostics`.
5. If the issue is visual, run `ue_get_viewport_screenshot`.
6. If the subject may be off-screen, tiny, or distant, run `ue_get_viewport_camera` and `ue_frame_actor`.
7. If the issue involves debug geometry, also run `ue_get_debug_draw_state`.
8. If actor state matters, run `ue_get_selected_actors` or `ue_get_level_actors`.
9. Return to repo reasoning for the actual fix.

## Viewport Verification

1. Run `ue_healthcheck`.
2. Run `ue_get_editor_state`.
3. Run `ue_get_viewport_camera` if the current framing may be wrong.
4. If the subject may be small, distant, or off-screen, run `ue_frame_actor` or `ue_capture_actor_screenshot`.
5. Run `ue_get_viewport_screenshot`.
6. If the question is about `DrawDebugLine` or debug geometry, also run `ue_get_debug_draw_state`.
7. If a stable baseline exists, use `ue_compare_viewport_screenshot`.
8. If needed, combine the screenshot with `ue_get_output_log`, `ue_get_editor_diagnostics`, or actor/property reads.
9. Do not guess visual success from code when the viewport image is the authoritative signal.

## Narrow Property Change

1. Identify the target with `ue_get_selected_actors` or `ue_get_level_actors`.
2. Read the current value with `ue_get_property`.
3. Write the narrow change with `ue_set_property`.
4. Verify with another `ue_get_property`.
5. Check `ue_get_output_log` if needed.

## Safe Actor Mutation

Use this only when a bounded editor mutation is required and property writes are not enough.

1. Run `ue_healthcheck`.
2. Confirm readiness exposes `ue_spawn_actor_safe`, `ue_select_actor_safe`, or `ue_destroy_actor_safe`.
3. Prefer `ue_get_level_actors` first if you need to avoid duplicate actors or confirm the cleanup target.
4. Run `ue_spawn_actor_safe` with exactly one allowlisted class identifier plus explicit `location` and `rotation`.
5. If follow-up tools depend on selection, run `ue_select_actor_safe` or set `selectAfterSpawn`.
6. Verify with `ue_get_level_actors`, `ue_get_selected_actors`, and `ue_frame_actor` or `ue_capture_actor_screenshot`.
7. Use `ue_destroy_actor_safe` only for targeted cleanup, not for broad scene editing.

Important:

- spawn-safe is bounded mutation, not generic object creation
- Blueprint-generated classes stay unsupported
- if readiness does not advertise the capability, do not improvise with Python, UI scripting, or raw console execution

## Safe Console Diagnostic

1. Use only supported `commandId` values.
2. Run `ue_run_console_command_safe`.
3. Inspect `ue_get_output_log` if the result matters.

Do not invent raw Unreal console strings.
