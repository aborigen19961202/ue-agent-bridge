# Safe Mutation Verification

## Goal

Verify the bounded editor mutation surface after syncing this plugin build into a UE project:

- `ue_spawn_actor_safe`
- `ue_select_actor_safe`
- `ue_destroy_actor_safe`

## Manual Steps

1. Open the Unreal Editor with the plugin-enabled project.
2. Build and deploy this plugin change into that project.
3. Run `ue_healthcheck` and confirm these capabilities are advertised:
   - `ue_spawn_actor_safe`
   - `ue_select_actor_safe`
   - `ue_destroy_actor_safe`
4. Call `ue_spawn_actor_safe` with an allowlisted class such as `TargetPoint` or `PointLight`.
5. Verify the new actor via `ue_get_level_actors`.
6. If `selectAfterSpawn` was true, verify it via `ue_get_selected_actors`.
7. Call `ue_frame_actor` or `ue_capture_actor_screenshot` against the spawned actor.
8. Call `ue_select_actor_safe` for the same actor and verify selection again.
9. Call `ue_destroy_actor_safe` for the same actor.
10. Verify removal via `ue_get_level_actors`.

## Suggested Spawn Payload

```json
{
  "className": "TargetPoint",
  "location": { "x": 0, "y": 0, "z": 120 },
  "rotation": { "pitch": 0, "yaw": 0, "roll": 0 },
  "selectAfterSpawn": true,
  "label": "UEAB_SpawnSmoke"
}
```

## Result For This Change Set

- TypeScript contract and mock/plugin-backend tests were updated to cover the new safe mutation surface.
- Runtime verification was executed on March 28, 2026 against a local Unreal test project.
- `ue_healthcheck` reported the new capabilities: `ue_spawn_actor_safe`, `ue_select_actor_safe`, `ue_destroy_actor_safe`.
- `spawn-safe` succeeded for allowlisted class `TargetPoint` with label `UEAB_SpawnSmoke`.
- Verification succeeded through existing endpoints:
  - `ue_get_level_actors`
  - `ue_get_selected_actors`
  - `ue_frame_actor`
  - `ue_capture_actor_screenshot`
- `destroy-safe` removed the spawned actor and follow-up `ue_get_level_actors` / `ue_get_selected_actors` returned no matching actor.
- Negative-path verification also succeeded: non-allowlisted `className = BP_Door_C` was rejected with `UNSAFE_MUTATION`.
