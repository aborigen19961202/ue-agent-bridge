---
name: ue-agent-bridge
description: Operate Unreal Engine projects through the UE Agent Bridge plugin while keeping code edits, git, shell builds, and repo reasoning outside Unreal. Use when Codex needs live Unreal editor state, selected actors, level actors, Unreal diagnostics, viewport screenshots for visual verification, Live Coding status, safe console commands, or guidance on when to trust external build diagnostics versus Unreal-side tools in a UE Agent Bridge-enabled project.
---

# UE Agent Bridge

Use this skill when a repository already has `UEAgentBridge` installed or when the user wants Codex to work with Unreal Editor through the bridge's bounded tool surface.

## Quick Start

1. Assume repo reasoning, code edits, git, and shell builds stay outside Unreal.
2. Prefer `UE_BACKEND_MODE=plugin`.
3. Start Unreal-dependent work with `ue_healthcheck`.
4. Read capability readiness before using Unreal tools.
5. Use Unreal only for live editor state and bounded editor actions.

## Core Rules

- Keep C++ edits and builds outside Unreal.
- Treat external build diagnostics as the source of truth for C++ compile failures.
- Treat the Unreal plugin backend as the source of truth for live editor state.
- Prefer reads before writes.
- Verify narrow writes after mutation when practical.
- Do not invent raw console strings or arbitrary Unreal execution paths.
- Treat editor mutations as allowlist-only tools, not as a fallback to generic editor control.

## Choose The Right Surface

Stay in repo and shell when the task is about:

- source code
- build failures
- project structure
- git history
- tests
- docs

Use Unreal tools when the task depends on:

- current selected actors
- actors in the current level
- live property values
- what is visible in the active viewport
- recent output log entries
- editor diagnostics
- editor readiness
- Live Coding readiness or safe reload
- bounded actor mutations such as spawn, select, or destroy in the editor world

## Default Workflow

For the practical workflow details, read:

- [references/workflows.md](./references/workflows.md)

For the implemented tool surface and the correct source-of-truth rules, read:

- [references/tool-surface.md](./references/tool-surface.md)

## Safety Boundaries

- Do not treat Unreal as a hidden shell.
- Do not use generic command execution.
- Do not broaden named bridge tools into ad hoc editor control.
- Use `ue_spawn_actor_safe` only for allowlisted native actor classes at an explicit transform.
- Use `ue_select_actor_safe` when follow-up tools need a concrete selected actor instead of a UI hack.
- Use `ue_destroy_actor_safe` only for targeted cleanup of actors that stay inside the safe mutation policy.
- Do not use spawn-safe as a backdoor for Blueprint construction scripts or arbitrary object creation.
- Do not trust Unreal-side diagnostics over external compiler output for failed C++ builds.
- If `ue_healthcheck` reports missing readiness, stop improvising around the missing capability.

## Vision Rule

- When the answer depends on what is actually visible in the viewport, call `ue_get_viewport_screenshot`.
- When the subject may be off-screen, tiny, or far away, call `ue_get_viewport_camera` and then `ue_frame_actor` or `ue_capture_actor_screenshot`.
- Prefer `ue_get_viewport_screenshot` for `DrawDebugLine`, debug shapes, material/layout regressions, and any viewport-only question.
- Pair `ue_get_viewport_screenshot` with `ue_get_debug_draw_state` when validating `DrawDebugLine` or other debug geometry.
- Use `ue_compare_viewport_screenshot` when a saved reference image can answer a regression question more reliably than manual visual comparison.
- Do not infer visual success from code alone when a screenshot can answer the question directly.
- Do not flood context with repeated screenshots; capture again only after a meaningful state change.
