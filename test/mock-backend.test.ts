import { describe, expect, it } from "vitest";
import { MockUnrealBackend } from "../src/backend/mock-backend.js";

describe("MockUnrealBackend", () => {
  it("reports mock-mode healthcheck readiness explicitly", async () => {
    const backend = new MockUnrealBackend();
    const result = await backend.healthcheck();

    expect(result.backend).toBe("mock");
    expect(result.connected).toBe(true);
    expect(result.readiness.backendReachable).toBe(true);
    expect(result.readiness.remoteControlAvailable).toBe(false);
    expect(result.readiness.helpers.ready).toBeNull();
  });

  it("returns selected actors", async () => {
    const backend = new MockUnrealBackend();
    const selected = await backend.getSelectedActors();

    expect(selected.length).toBe(2);
    expect(selected.every((actor) => actor.selected)).toBe(true);
    expect(selected[0]?.actorLabel).toBe("SM_Chair_01");
  });

  it("reads and writes properties", async () => {
    const backend = new MockUnrealBackend();
    const before = await backend.getProperty({
      target: { actorName: "PointLight_01" },
      propertyName: "Intensity"
    });

    expect(before.value).toBe(2500);

    const after = await backend.setProperty({
      target: { actorName: "PointLight_01" },
      propertyName: "Intensity",
      value: 3200
    });

    expect(after.changed).toBe(true);
    expect(after.value).toBe(3200);
  });

  it("filters assets", async () => {
    const backend = new MockUnrealBackend();
    const assets = await backend.assetSearch({
      pathPrefix: "/Game/Blueprints",
      limit: 10
    });

    expect(assets).toHaveLength(1);
    expect(assets[0]?.assetName).toBe("BP_Door");
    expect(assets[0]?.assetPath).toBe("/Game/Blueprints/Interactables/BP_Door.BP_Door");
  });

  it("returns a bounded mock output log slice", async () => {
    const backend = new MockUnrealBackend();
    const entries = await backend.getOutputLog({
      minLevel: "Warning",
      limit: 1
    });

    expect(entries).toEqual([
      {
        timestamp: "2026-03-11T10:02:05Z",
        level: "Error",
        category: "LogBlueprint",
        message: "BP_Door compile warning promoted to error in mock environment."
      }
    ]);
  });

  it("runs an allowlisted mock console command by command ID", async () => {
    const backend = new MockUnrealBackend();
    const result = await backend.runConsoleCommand({
      commandId: "stat_fps"
    });

    expect(result).toEqual({
      commandId: "stat_fps",
      accepted: true,
      executedCommand: "stat fps",
      message: "Command executed in mock backend."
    });
  });

  it("returns bounded mock diagnostics and editor state", async () => {
    const backend = new MockUnrealBackend();

    await expect(backend.getEditorDiagnostics({
      minSeverity: "Error",
      limit: 5
    })).resolves.toEqual([
      {
        source: "LiveCoding",
        severity: "Error",
        category: "LogLiveCoding",
        message: "Compile warning promoted to error in mock environment.",
        filePath: "Source/CleanModelFactory/CleanModelFactory.cpp",
        line: 12,
        column: 3
      }
    ]);

    await expect(backend.getEditorState()).resolves.toEqual({
      projectName: "MockProject",
      currentMap: "/Game/Maps/TestMap",
      pieActive: false,
      liveCoding: {
        available: true,
        enabled: true,
        busy: false,
        lastResult: "success",
        message: "Mock Live Coding is ready."
      },
      capabilityReadiness: {
        ue_get_selected_actors: true,
        ue_get_level_actors: true,
        ue_get_output_log: true,
        ue_get_editor_diagnostics: true,
        ue_get_editor_state: true,
        ue_get_viewport_camera: true,
        ue_set_viewport_camera: true,
        ue_spawn_actor_safe: true,
        ue_select_actor_safe: true,
        ue_destroy_actor_safe: true,
        ue_frame_actor: true,
        ue_get_viewport_screenshot: true,
        ue_capture_actor_screenshot: true,
        ue_get_debug_draw_state: true,
        ue_get_live_coding_status: true,
        ue_trigger_live_coding_build_safe: true,
        ue_run_console_command_safe: true
      }
    });
  });

  it("returns viewport screenshot metadata and image data", async () => {
    const backend = new MockUnrealBackend();
    const result = await backend.getViewportScreenshot({
      maxDimension: 1024
    });

    expect(result.mimeType).toBe("image/png");
    expect(result.source).toBe("active_viewport");
    expect(result.viewport.viewMode).toBe("lit");
    expect(result.camera.location.z).toBe(150);
    expect(result.dataBase64.length).toBeGreaterThan(10);
  });

  it("reads and updates the mock viewport camera, then frames an actor", async () => {
    const backend = new MockUnrealBackend();

    await expect(backend.getViewportCamera()).resolves.toMatchObject({
      source: "active_viewport",
      camera: {
        location: { x: 0, y: 0, z: 150 }
      }
    });

    await expect(backend.setViewportCamera({
      location: { x: 500, y: 600, z: 700 },
      rotation: { pitch: -10, yaw: 120, roll: 0 }
    })).resolves.toMatchObject({
      camera: {
        location: { x: 500, y: 600, z: 700 },
        rotation: { pitch: -10, yaw: 120, roll: 0 }
      }
    });

    await expect(backend.frameActor({
      target: { actorName: "PointLight_01" }
    })).resolves.toMatchObject({
      target: {
        actorName: "PointLight_01"
      },
      activeViewportOnly: true
    });
  });

  it("supports safe spawn, select, and destroy mutations", async () => {
    const backend = new MockUnrealBackend();
    const spawned = await backend.spawnActor({
      className: "TargetPoint",
      location: { x: 10, y: 20, z: 30 },
      rotation: { pitch: 0, yaw: 45, roll: 0 },
      selectAfterSpawn: true,
      label: "BridgeSpawn"
    });

    expect(spawned).toMatchObject({
      actorLabel: "BridgeSpawn",
      className: "TargetPoint",
      selected: true,
      location: { x: 10, y: 20, z: 30 }
    });

    await expect(backend.selectActor({
      target: { actorName: spawned.actorName }
    })).resolves.toMatchObject({
      actorName: spawned.actorName,
      selected: true
    });

    await expect(backend.destroyActor({
      target: { actorName: spawned.actorName }
    })).resolves.toMatchObject({
      actorName: spawned.actorName,
      destroyed: true
    });
  });

  it("returns structured debug draw state", async () => {
    const backend = new MockUnrealBackend();
    const result = await backend.getDebugDrawState({
      limit: 10,
      includePoints: true
    });

    expect(result.summary.totalLines).toBe(1);
    expect(result.lines[0]?.batcher).toBe("world_persistent");
    expect(result.points[0]?.batcher).toBe("foreground");
  });

  it("triggers a mock live coding build", async () => {
    const backend = new MockUnrealBackend();

    await expect(backend.triggerLiveCodingBuild()).resolves.toEqual({
      accepted: true,
      status: {
        available: true,
        enabled: true,
        busy: false,
        lastResult: "success",
        message: "Mock Live Coding is ready."
      }
    });
  });
});
