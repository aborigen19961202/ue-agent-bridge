import { afterEach, describe, expect, it, vi } from "vitest";
import { PluginBackend } from "../src/backend/plugin-backend.js";

const PLUGIN_BASE_URL = "http://127.0.0.1:30110";
const RC_BASE_URL = "http://127.0.0.1:30010";

describe("PluginBackend", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("merges plugin capability readiness with remote control fallback health", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? (input instanceof Request ? input.method : "GET");

      if (url === `${PLUGIN_BASE_URL}/api/v1/health`) {
        return jsonResponse({
          pluginName: "UEAgentBridge",
          pluginVersion: "0.3.0",
          apiVersion: "v1",
          editor: {
            available: true,
            projectName: "CleanModelFactory"
          },
          capabilities: {
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
            ue_trigger_live_coding_build_safe: false,
            ue_run_console_command_safe: true
          },
          warnings: []
        });
      }

      if (url === `${RC_BASE_URL}/remote/info`) {
        return jsonResponse({
          HttpRoutes: [
            { Path: "/remote/info" },
            { Path: "/remote/object/property" },
            { Path: "/remote/search/assets" }
          ]
        });
      }

      throw new Error(`Unexpected URL: ${url}`);
    }));

    const backend = createBackend();
    const result = await backend.healthcheck();

    expect(result.backend).toBe("plugin");
    expect(result.connected).toBe(true);
    expect(result.capabilities).toEqual([
      "ue_healthcheck",
      "ue_get_selected_actors",
      "ue_get_level_actors",
      "ue_get_output_log",
      "ue_get_editor_diagnostics",
      "ue_get_editor_state",
      "ue_get_viewport_camera",
      "ue_set_viewport_camera",
      "ue_spawn_actor_safe",
      "ue_select_actor_safe",
      "ue_destroy_actor_safe",
      "ue_frame_actor",
      "ue_get_viewport_screenshot",
      "ue_capture_actor_screenshot",
      "ue_get_debug_draw_state",
      "ue_get_live_coding_status",
      "ue_run_console_command_safe",
      "ue_get_property",
      "ue_set_property",
      "ue_asset_search"
    ]);
    expect(result.readiness.backendReachable).toBe(true);
    expect(result.readiness.remoteControlAvailable).toBe(true);
  });

  it("normalizes selected actor responses from the plugin API", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);

      if (url === `${PLUGIN_BASE_URL}/api/v1/selected-actors`) {
        return jsonResponse({
          actors: [
            {
              actorName: "PointLight_01",
              actorLabel: "Point Light 01",
              className: "PointLight",
              objectPath: "/Game/Maps/TestMap.TestMap:PersistentLevel.PointLight_01",
              selected: true
            }
          ]
        });
      }

      throw new Error(`Unexpected URL: ${url}`);
    }));

    const backend = createBackend();
    await expect(backend.getSelectedActors()).resolves.toEqual([
      {
        actorName: "PointLight_01",
        actorLabel: "Point Light 01",
        className: "PointLight",
        objectPath: "/Game/Maps/TestMap.TestMap:PersistentLevel.PointLight_01",
        selected: true
      }
    ]);
  });

  it("fails clearly on malformed level actor responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);

      if (url === `${PLUGIN_BASE_URL}/api/v1/level-actors`) {
        return jsonResponse({
          actors: [
            {
              actorName: "BrokenActor"
            }
          ]
        });
      }

      throw new Error(`Unexpected URL: ${url}`);
    }));

    const backend = createBackend();

    await expect(backend.getLevelActors({})).rejects.toThrow("incomplete actor at index 0");
  });

  it("normalizes diagnostics, editor state, and live coding build responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? (input instanceof Request ? input.method : "GET");

      if (url === `${PLUGIN_BASE_URL}/api/v1/editor-diagnostics`) {
        return jsonResponse({
          diagnostics: [
            {
              source: "LiveCoding",
              severity: "Error",
              category: "LogLiveCoding",
              message: "E:\\UnrealEngine\\Projects\\CleanModelFactory\\Source\\CleanModelFactory\\CleanModelFactory.cpp(5,1): error C1189: #error: UEAgentBridgeLiveCodingFailureProbe",
              filePath: "E:\\UnrealEngine\\Projects\\CleanModelFactory\\Source\\CleanModelFactory\\CleanModelFactory.cpp",
              line: 5,
              column: 1
            }
          ]
        });
      }

      if (url === `${PLUGIN_BASE_URL}/api/v1/editor-state`) {
        return jsonResponse({
          projectName: "CleanModelFactory",
          currentMap: "/Game/Maps/TestMap",
          pieActive: false,
          liveCoding: {
            available: true,
            enabled: true,
            busy: false,
            lastResult: "success",
            message: "Live Coding is ready."
          },
          capabilityReadiness: {
            ue_get_selected_actors: true
          }
        });
      }

      if (url === `${PLUGIN_BASE_URL}/api/v1/viewport/screenshot`) {
        return jsonResponse({
          mimeType: "image/png",
          dataBase64: "ZmFrZS1wbmctZGF0YQ==",
          width: 1280,
          height: 720,
          capturedAt: "2026-03-11T10:15:00Z",
          source: "active_viewport",
          projectName: "CleanModelFactory",
          currentMap: "/Game/Maps/TestMap",
          pieActive: false,
          viewport: {
            type: "perspective",
            viewMode: "lit",
            realtime: true,
            width: 1920,
            height: 1080
          },
          camera: {
            location: { x: 120, y: -50, z: 300 },
            rotation: { pitch: -12, yaw: 35, roll: 0 }
          }
        });
      }

      if (url === `${PLUGIN_BASE_URL}/api/v1/viewport/camera`) {
        if (method === "POST") {
          return jsonResponse({
            capturedAt: "2026-03-11T10:14:30Z",
            source: "active_viewport",
            projectName: "CleanModelFactory",
            currentMap: "/Game/Maps/TestMap",
            pieActive: false,
            viewport: {
              type: "perspective",
              viewMode: "lit",
              realtime: true,
              width: 1920,
              height: 1080
            },
            camera: {
              location: { x: 800, y: 900, z: 1000 },
              rotation: { pitch: -20, yaw: 180, roll: 0 }
            }
          });
        }

        return jsonResponse({
          capturedAt: "2026-03-11T10:14:00Z",
          source: "active_viewport",
          projectName: "CleanModelFactory",
          currentMap: "/Game/Maps/TestMap",
          pieActive: false,
          viewport: {
            type: "perspective",
            viewMode: "lit",
            realtime: true,
            width: 1920,
            height: 1080
          },
          camera: {
            location: { x: 120, y: -50, z: 300 },
            rotation: { pitch: -12, yaw: 35, roll: 0 }
          }
        });
      }

      if (url === `${PLUGIN_BASE_URL}/api/v1/actors/spawn-safe`) {
        return jsonResponse({
          actorName: "PointLight_02",
          actorLabel: "Spawned Point Light",
          className: "PointLight",
          objectPath: "/Game/Maps/TestMap.TestMap:PersistentLevel.PointLight_02",
          selected: true,
          location: { x: 100, y: 200, z: 300 },
          rotation: { pitch: 0, yaw: 45, roll: 0 }
        });
      }

      if (url === `${PLUGIN_BASE_URL}/api/v1/actors/select-safe`) {
        return jsonResponse({
          actorName: "PointLight_02",
          actorLabel: "Spawned Point Light",
          className: "PointLight",
          objectPath: "/Game/Maps/TestMap.TestMap:PersistentLevel.PointLight_02",
          selected: true
        });
      }

      if (url === `${PLUGIN_BASE_URL}/api/v1/actors/destroy-safe`) {
        return jsonResponse({
          actorName: "PointLight_02",
          actorLabel: "Spawned Point Light",
          className: "PointLight",
          objectPath: "/Game/Maps/TestMap.TestMap:PersistentLevel.PointLight_02",
          destroyed: true
        });
      }

      if (url === `${PLUGIN_BASE_URL}/api/v1/viewport/frame-actor`) {
        return jsonResponse({
          capturedAt: "2026-03-11T10:14:45Z",
          source: "active_viewport",
          projectName: "CleanModelFactory",
          currentMap: "/Game/Maps/TestMap",
          pieActive: false,
          activeViewportOnly: true,
          target: {
            actorName: "PointLight_01",
            actorLabel: "Point Light 01",
            className: "PointLight",
            objectPath: "/Game/Maps/TestMap.TestMap:PersistentLevel.PointLight_01"
          },
          viewport: {
            type: "perspective",
            viewMode: "lit",
            realtime: true,
            width: 1920,
            height: 1080
          },
          camera: {
            location: { x: 600, y: -400, z: 500 },
            rotation: { pitch: -18, yaw: 45, roll: 0 }
          }
        });
      }

      if (url === `${PLUGIN_BASE_URL}/api/v1/debug-draw/state`) {
        return jsonResponse({
          capturedAt: "2026-03-11T10:16:00Z",
          projectName: "CleanModelFactory",
          currentMap: "/Game/Maps/TestMap",
          lines: [
            {
              batcher: "world_persistent",
              start: { x: 0, y: 0, z: 0 },
              end: { x: 100, y: 0, z: 0 },
              color: { r: 1, g: 0, b: 0, a: 1 },
              thickness: 2,
              remainingLifeTime: 5,
              depthPriority: 0,
              batchId: 9,
              length: 100
            }
          ],
          points: [],
          summary: {
            totalLines: 1,
            totalPoints: 0,
            sampledLines: 1,
            sampledPoints: 0,
            batchers: {
              world_persistent: {
                lines: 1,
                points: 0
              }
            }
          }
        });
      }

      if (url === `${PLUGIN_BASE_URL}/api/v1/live-coding/status`) {
        return jsonResponse({
          available: true,
          enabled: true,
          busy: false,
          lastResult: "success",
          message: "Live Coding is ready."
        });
      }

      if (url === `${PLUGIN_BASE_URL}/api/v1/live-coding/build`) {
        return jsonResponse({
          accepted: true,
          status: {
            available: true,
            enabled: true,
            busy: false,
            lastResult: "success",
            message: "Live Coding compile succeeded."
          }
        });
      }

      throw new Error(`Unexpected URL: ${url}`);
    }));

    const backend = createBackend();

    await expect(backend.getEditorDiagnostics({ limit: 10 })).resolves.toEqual([
      {
        source: "LiveCoding",
        severity: "Error",
        category: "LogLiveCoding",
        message: "E:\\UnrealEngine\\Projects\\CleanModelFactory\\Source\\CleanModelFactory\\CleanModelFactory.cpp(5,1): error C1189: #error: UEAgentBridgeLiveCodingFailureProbe",
        filePath: "E:\\UnrealEngine\\Projects\\CleanModelFactory\\Source\\CleanModelFactory\\CleanModelFactory.cpp",
        line: 5,
        column: 1
      }
    ]);

    await expect(backend.getEditorState()).resolves.toEqual({
      projectName: "CleanModelFactory",
      currentMap: "/Game/Maps/TestMap",
      pieActive: false,
      liveCoding: {
        available: true,
        enabled: true,
        busy: false,
        lastResult: "success",
        message: "Live Coding is ready."
      },
      capabilityReadiness: {
        ue_get_selected_actors: true
      }
    });

    await expect(backend.getLiveCodingStatus()).resolves.toEqual({
      available: true,
      enabled: true,
      busy: false,
      lastResult: "success",
      message: "Live Coding is ready."
    });

    await expect(backend.getViewportScreenshot({
      maxDimension: 1280
    })).resolves.toEqual({
      capturedAt: "2026-03-11T10:15:00Z",
      source: "active_viewport",
      projectName: "CleanModelFactory",
      currentMap: "/Game/Maps/TestMap",
      pieActive: false,
      viewport: {
        type: "perspective",
        viewMode: "lit",
        realtime: true,
        width: 1920,
        height: 1080
      },
      camera: {
        location: { x: 120, y: -50, z: 300 },
        rotation: { pitch: -12, yaw: 35, roll: 0 }
      },
      mimeType: "image/png",
      dataBase64: "ZmFrZS1wbmctZGF0YQ==",
      width: 1280,
      height: 720
    });

    await expect(backend.getViewportCamera()).resolves.toEqual({
      capturedAt: "2026-03-11T10:14:00Z",
      source: "active_viewport",
      projectName: "CleanModelFactory",
      currentMap: "/Game/Maps/TestMap",
      pieActive: false,
      viewport: {
        type: "perspective",
        viewMode: "lit",
        realtime: true,
        width: 1920,
        height: 1080
      },
      camera: {
        location: { x: 120, y: -50, z: 300 },
        rotation: { pitch: -12, yaw: 35, roll: 0 }
      }
    });

    await expect(backend.setViewportCamera({
      location: { x: 800, y: 900, z: 1000 },
      rotation: { pitch: -20, yaw: 180, roll: 0 }
    })).resolves.toEqual({
      capturedAt: "2026-03-11T10:14:30Z",
      source: "active_viewport",
      projectName: "CleanModelFactory",
      currentMap: "/Game/Maps/TestMap",
      pieActive: false,
      viewport: {
        type: "perspective",
        viewMode: "lit",
        realtime: true,
        width: 1920,
        height: 1080
      },
      camera: {
        location: { x: 800, y: 900, z: 1000 },
        rotation: { pitch: -20, yaw: 180, roll: 0 }
      }
    });

    await expect(backend.spawnActor({
      className: "PointLight",
      location: { x: 100, y: 200, z: 300 },
      rotation: { pitch: 0, yaw: 45, roll: 0 },
      selectAfterSpawn: true,
      label: "Spawned Point Light"
    })).resolves.toEqual({
      actorName: "PointLight_02",
      actorLabel: "Spawned Point Light",
      className: "PointLight",
      objectPath: "/Game/Maps/TestMap.TestMap:PersistentLevel.PointLight_02",
      selected: true,
      location: { x: 100, y: 200, z: 300 },
      rotation: { pitch: 0, yaw: 45, roll: 0 }
    });

    await expect(backend.selectActor({
      target: { actorName: "PointLight_02" }
    })).resolves.toEqual({
      actorName: "PointLight_02",
      actorLabel: "Spawned Point Light",
      className: "PointLight",
      objectPath: "/Game/Maps/TestMap.TestMap:PersistentLevel.PointLight_02",
      selected: true
    });

    await expect(backend.destroyActor({
      target: { actorName: "PointLight_02" }
    })).resolves.toEqual({
      actorName: "PointLight_02",
      actorLabel: "Spawned Point Light",
      className: "PointLight",
      objectPath: "/Game/Maps/TestMap.TestMap:PersistentLevel.PointLight_02",
      destroyed: true
    });

    await expect(backend.frameActor({
      target: { actorName: "PointLight_01" }
    })).resolves.toEqual({
      capturedAt: "2026-03-11T10:14:45Z",
      source: "active_viewport",
      projectName: "CleanModelFactory",
      currentMap: "/Game/Maps/TestMap",
      pieActive: false,
      activeViewportOnly: true,
      target: {
        actorName: "PointLight_01",
        actorLabel: "Point Light 01",
        className: "PointLight",
        objectPath: "/Game/Maps/TestMap.TestMap:PersistentLevel.PointLight_01"
      },
      viewport: {
        type: "perspective",
        viewMode: "lit",
        realtime: true,
        width: 1920,
        height: 1080
      },
      camera: {
        location: { x: 600, y: -400, z: 500 },
        rotation: { pitch: -18, yaw: 45, roll: 0 }
      }
    });

    await expect(backend.getDebugDrawState({
      limit: 20,
      includePoints: false
    })).resolves.toEqual({
      capturedAt: "2026-03-11T10:16:00Z",
      projectName: "CleanModelFactory",
      currentMap: "/Game/Maps/TestMap",
      lines: [
        {
          batcher: "world_persistent",
          start: { x: 0, y: 0, z: 0 },
          end: { x: 100, y: 0, z: 0 },
          color: { r: 1, g: 0, b: 0, a: 1 },
          thickness: 2,
          remainingLifeTime: 5,
          depthPriority: 0,
          batchId: 9,
          length: 100
        }
      ],
      points: [],
      summary: {
        totalLines: 1,
        totalPoints: 0,
        sampledLines: 1,
        sampledPoints: 0,
        batchers: {
          world_persistent: {
            lines: 1,
            points: 0
          }
        }
      }
    });

    await expect(backend.triggerLiveCodingBuild()).resolves.toEqual({
      accepted: true,
      status: {
        available: true,
        enabled: true,
        busy: false,
        lastResult: "success",
        message: "Live Coding compile succeeded."
      }
    });
  });

  it("maps plugin error envelopes into bridge errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      error: {
        code: "UNSAFE_MUTATION",
        message: "Resolved class is outside the allowed project/plugin spawn scope."
      }
    }), {
      status: 403,
      statusText: "Forbidden",
      headers: {
        "Content-Type": "application/json"
      }
    })));

    const backend = createBackend();

    await expect(backend.spawnActor({
      className: "BlueprintGeneratedClass",
      location: { x: 0, y: 0, z: 0 },
      rotation: { pitch: 0, yaw: 0, roll: 0 }
    })).rejects.toMatchObject({
      code: "UNSAFE_MUTATION"
    });
  });

  it("surfaces unreachable plugin backend requests clearly", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("fetch failed");
    }));

    const backend = createBackend();

    await expect(backend.getOutputLog({ limit: 5 })).rejects.toThrow("Could not reach plugin backend");
  });
});

function createBackend(): PluginBackend {
  return new PluginBackend({
    baseUrl: PLUGIN_BASE_URL,
    timeoutMs: 1000,
    remoteControlBaseUrl: RC_BASE_URL
  });
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "Content-Type": "application/json"
    }
  });
}
