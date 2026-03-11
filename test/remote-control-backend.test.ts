import { afterEach, describe, expect, it, vi } from "vitest";
import { RemoteControlBackend } from "../src/backend/remote-control-backend.js";

const BASE_URL = "http://127.0.0.1:30010";

describe("RemoteControlBackend", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reports real reachability and helper readiness honestly", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);

      if (url.endsWith("/remote/info")) {
        return jsonResponse({
          HttpRoutes: [
            { Path: "/remote/info" },
            { Path: "/remote/object/call" },
            { Path: "/remote/object/describe" },
            { Path: "/remote/object/property" },
            { Path: "/remote/search/assets" },
            { Path: "/remote/preset/{preset}" }
          ]
        });
      }

      if (url.endsWith("/remote/preset/UE_AgentBridge_M0")) {
        return jsonResponse({
          ExposedFunctions: [
            { DisplayName: "GetSelectedActors" },
            { DisplayName: "GetOutputLogSlice" },
            { DisplayName: "RunSafeConsoleCommand" }
          ]
        });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const backend = createBackend();
    const result = await backend.healthcheck();

    expect(result.connected).toBe(true);
    expect(result.capabilities).toEqual([
      "ue_healthcheck",
      "ue_get_selected_actors",
      "ue_get_output_log",
      "ue_run_console_command_safe",
      "ue_get_level_actors",
      "ue_get_property",
      "ue_set_property",
      "ue_asset_search"
    ]);
    expect(result.readiness.backendReachable).toBe(true);
    expect(result.readiness.remoteControlAvailable).toBe(true);
    expect(result.readiness.preset).toEqual({
      name: "UE_AgentBridge_M0",
      checked: true,
      available: true
    });
    expect(result.readiness.helpers.checked).toBe(true);
    expect(result.readiness.helpers.ready).toBe(true);
    expect(result.readiness.helpers.missing).toEqual([]);
  });

  it("treats transport failures as unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("fetch failed");
    }));

    const backend = createBackend();
    const result = await backend.healthcheck();

    expect(result.connected).toBe(false);
    expect(result.readiness.backendReachable).toBe(false);
    expect(result.readiness.remoteControlAvailable).toBe(false);
    expect(result.message).toContain("Could not reach Remote Control endpoint");
  });

  it("treats malformed remote info as a reachable but invalid backend response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      Routes: []
    })));

    const backend = createBackend();
    const result = await backend.healthcheck();

    expect(result.connected).toBe(false);
    expect(result.readiness.backendReachable).toBe(true);
    expect(result.readiness.remoteControlAvailable).toBe(false);
    expect(result.readiness.preset.checked).toBe(false);
    expect(result.readiness.helpers.ready).toBeNull();
    expect(result.message).toContain("/remote/info");
  });

  it("gets selected actors through the narrow preset helper contract", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      expect(url.endsWith("/remote/preset/UE_AgentBridge_M0/function/GetSelectedActors")).toBe(true);
      expect(init?.method).toBe("PUT");
      expect(JSON.parse(String(init?.body))).toEqual({
        Parameters: {
          Limit: 200
        },
        GenerateTransaction: false
      });

      return jsonResponse({
        ReturnedValues: [
          {
            Actors: [
              {
                ActorName: "PointLight_01",
                ClassName: "PointLight",
                ObjectPath: "/Game/Maps/TestMap.TestMap:PersistentLevel.PointLight_01",
                ActorLabel: "PointLight_01",
                Selected: true
              },
              {
                ActorName: "SM_Chair_01",
                ClassName: "StaticMeshActor",
                ObjectPath: "/Game/Maps/TestMap.TestMap:PersistentLevel.SM_Chair_01"
              }
            ]
          }
        ]
      });
    });

    vi.stubGlobal("fetch", fetchMock);

    const backend = createBackend();
    const result = await backend.getSelectedActors();

    expect(result).toEqual([
      {
        actorName: "PointLight_01",
        className: "PointLight",
        objectPath: "/Game/Maps/TestMap.TestMap:PersistentLevel.PointLight_01",
        actorLabel: "PointLight_01",
        selected: true
      },
      {
        actorName: "SM_Chair_01",
        className: "StaticMeshActor",
        objectPath: "/Game/Maps/TestMap.TestMap:PersistentLevel.SM_Chair_01",
        selected: true
      }
    ]);
  });

  it("treats an empty selection as a successful empty result", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      ReturnedValues: [
        {
          Actors: []
        }
      ]
    })));

    const backend = createBackend();
    const result = await backend.getSelectedActors();

    expect(result).toEqual([]);
  });

  it("surfaces helper-unavailable selected actor retrieval clearly", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      errorMessage: "Preset function not found"
    }), {
      status: 404,
      statusText: "Not Found",
      headers: {
        "Content-Type": "application/json"
      }
    })));

    const backend = createBackend();

    await expect(backend.getSelectedActors()).rejects.toMatchObject({
      code: "HELPER_UNAVAILABLE"
    });
  });

  it("surfaces malformed selected actor helper responses clearly", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      ReturnedValues: [
        {
          Actors: [
            {
              ActorName: "PointLight_01",
              ObjectPath: "/Game/Maps/TestMap.TestMap:PersistentLevel.PointLight_01"
            }
          ]
        }
      ]
    })));

    const backend = createBackend();

    await expect(backend.getSelectedActors()).rejects.toThrow("incomplete actor at index 0");
  });

  it("surfaces unreachable selected actor helper calls clearly", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("fetch failed");
    }));

    const backend = createBackend();

    await expect(backend.getSelectedActors()).rejects.toThrow("Could not reach Remote Control endpoint");
  });

  it("gets a bounded output log slice through the narrow preset helper contract", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      expect(url.endsWith("/remote/preset/UE_AgentBridge_M0/function/GetOutputLogSlice")).toBe(true);
      expect(init?.method).toBe("PUT");
      expect(JSON.parse(String(init?.body))).toEqual({
        Parameters: {
          Limit: 2,
          MinLevel: "Warning"
        },
        GenerateTransaction: false
      });

      return jsonResponse({
        ReturnedValues: [
          {
            Entries: [
              {
                Timestamp: "2026-03-11T10:01:12Z",
                Level: "Warning",
                Category: "LogLighting",
                Message: "PointLight_01 exceeds recommended stationary overlap count."
              },
              {
                Timestamp: "2026-03-11T10:02:05Z",
                Level: "Error",
                Category: "LogBlueprint",
                Message: "Compile warning promoted to error."
              }
            ]
          }
        ]
      });
    });

    vi.stubGlobal("fetch", fetchMock);

    const backend = createBackend();
    const result = await backend.getOutputLog({
      minLevel: "Warning",
      limit: 2
    });

    expect(result).toEqual([
      {
        timestamp: "2026-03-11T10:01:12Z",
        level: "Warning",
        category: "LogLighting",
        message: "PointLight_01 exceeds recommended stationary overlap count."
      },
      {
        timestamp: "2026-03-11T10:02:05Z",
        level: "Error",
        category: "LogBlueprint",
        message: "Compile warning promoted to error."
      }
    ]);
  });

  it("treats an empty output log slice as a successful empty result", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      ReturnedValues: [
        {
          Entries: []
        }
      ]
    })));

    const backend = createBackend();
    const result = await backend.getOutputLog({
      limit: 5
    });

    expect(result).toEqual([]);
  });

  it("surfaces helper-unavailable output log retrieval clearly", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      errorMessage: "Preset function not found"
    }), {
      status: 404,
      statusText: "Not Found",
      headers: {
        "Content-Type": "application/json"
      }
    })));

    const backend = createBackend();

    await expect(backend.getOutputLog({
      limit: 5
    })).rejects.toMatchObject({
      code: "HELPER_UNAVAILABLE"
    });
  });

  it("surfaces malformed output log helper responses clearly", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      ReturnedValues: [
        {
          Entries: [
            {
              Timestamp: "2026-03-11T10:02:05Z",
              Level: "Error",
              Message: "Compile warning promoted to error."
            }
          ]
        }
      ]
    })));

    const backend = createBackend();

    await expect(backend.getOutputLog({
      limit: 5
    })).rejects.toThrow("incomplete entry at index 0");
  });

  it("rejects oversized output log helper responses instead of truncating them silently", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      ReturnedValues: [
        {
          Entries: [
            {
              Timestamp: "2026-03-11T10:00:00Z",
              Level: "Log",
              Category: "LogInit",
              Message: "Entry 1"
            },
            {
              Timestamp: "2026-03-11T10:00:01Z",
              Level: "Log",
              Category: "LogInit",
              Message: "Entry 2"
            },
            {
              Timestamp: "2026-03-11T10:00:02Z",
              Level: "Log",
              Category: "LogInit",
              Message: "Entry 3"
            }
          ]
        }
      ]
    })));

    const backend = createBackend();

    await expect(backend.getOutputLog({
      limit: 2
    })).rejects.toThrow("exceeding the requested limit of 2");
  });

  it("surfaces unreachable output log helper calls clearly", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("fetch failed");
    }));

    const backend = createBackend();

    await expect(backend.getOutputLog({
      limit: 5
    })).rejects.toThrow("Could not reach Remote Control endpoint");
  });

  it("runs an allowlisted console command through the narrow preset helper contract", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      expect(url.endsWith("/remote/preset/UE_AgentBridge_M0/function/RunSafeConsoleCommand")).toBe(true);
      expect(init?.method).toBe("PUT");
      expect(JSON.parse(String(init?.body))).toEqual({
        Parameters: {
          CommandId: "stat_fps"
        },
        GenerateTransaction: false
      });

      return jsonResponse({
        ReturnedValues: [
          {
            Accepted: true,
            CommandId: "stat_fps",
            ExecutedCommand: "stat fps",
            Message: "Command executed."
          }
        ]
      });
    });

    vi.stubGlobal("fetch", fetchMock);

    const backend = createBackend();
    const result = await backend.runConsoleCommand({
      commandId: "stat_fps"
    });

    expect(result).toEqual({
      commandId: "stat_fps",
      accepted: true,
      executedCommand: "stat fps",
      message: "Command executed."
    });
  });

  it("rejects non-allowlisted console command IDs before helper dispatch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const backend = createBackend();

    await expect(backend.runConsoleCommand({
      commandId: "quit_now"
    })).rejects.toMatchObject({
      code: "UNSAFE_COMMAND"
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces helper-unavailable safe console execution clearly", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      errorMessage: "Preset function not found"
    }), {
      status: 404,
      statusText: "Not Found",
      headers: {
        "Content-Type": "application/json"
      }
    })));

    const backend = createBackend();

    await expect(backend.runConsoleCommand({
      commandId: "stat_fps"
    })).rejects.toMatchObject({
      code: "HELPER_UNAVAILABLE"
    });
  });

  it("surfaces malformed console command helper responses clearly", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      ReturnedValues: [
        {
          Accepted: true,
          CommandId: "stat_fps",
          Message: "Command executed."
        }
      ]
    })));

    const backend = createBackend();

    await expect(backend.runConsoleCommand({
      commandId: "stat_fps"
    })).rejects.toThrow("did not return ExecutedCommand");
  });

  it("surfaces helper-side command execution failures clearly", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      ReturnedValues: [
        {
          Accepted: false,
          CommandId: "stat_fps",
          Message: "Console command execution failed."
        }
      ]
    })));

    const backend = createBackend();

    await expect(backend.runConsoleCommand({
      commandId: "stat_fps"
    })).rejects.toThrow("Console command helper reported execution failure");
  });

  it("surfaces unreachable safe console helper calls clearly", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("fetch failed");
    }));

    const backend = createBackend();

    await expect(backend.runConsoleCommand({
      commandId: "stat_fps"
    })).rejects.toThrow("Could not reach Remote Control endpoint");
  });

  it("normalizes asset search results to canonical object paths", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe("PUT");
      expect(init?.body).toBeDefined();
      expect(JSON.parse(String(init?.body))).toEqual({
        Query: "chair",
        Filter: {
          RecursiveClasses: false,
          ClassNames: ["StaticMesh"],
          PackagePaths: ["/Game/Props"],
          RecursivePaths: true
        }
      });

      return jsonResponse({
        Assets: [
          {
            Name: "SM_Chair",
            Class: "StaticMesh",
            Path: "/Game/Props/Furniture/SM_Chair.SM_Chair"
          }
        ]
      });
    });

    vi.stubGlobal("fetch", fetchMock);

    const backend = createBackend();
    const result = await backend.assetSearch({
      query: "chair",
      pathPrefix: "/Game/Props",
      assetClass: "StaticMesh",
      limit: 5
    });

    expect(result).toEqual([
      {
        assetName: "SM_Chair",
        assetClass: "StaticMesh",
        assetPath: "/Game/Props/Furniture/SM_Chair.SM_Chair"
      }
    ]);
  });

  it("returns empty asset search results cleanly", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      Assets: []
    })));

    const backend = createBackend();
    const result = await backend.assetSearch({
      query: "missing",
      limit: 5
    });

    expect(result).toEqual([]);
  });

  it("surfaces clear errors for unreachable asset search requests", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("fetch failed");
    }));

    const backend = createBackend();

    await expect(backend.assetSearch({
      query: "chair"
    })).rejects.toThrow("Could not reach Remote Control endpoint");
  });

  it("surfaces clear errors for malformed asset search responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      Assets: [
        {
          Name: "SM_Chair"
        }
      ]
    })));

    const backend = createBackend();

    await expect(backend.assetSearch({
      query: "chair"
    })).rejects.toThrow("incomplete asset at index 0");
  });

  it("lists level actors through EditorLevelLibrary and normalizes describe results", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith("/remote/object/call")) {
        expect(init?.method).toBe("PUT");
        expect(JSON.parse(String(init?.body))).toEqual({
          objectPath: "/Script/EditorScriptingUtilities.Default__EditorLevelLibrary",
          functionName: "GetAllLevelActors"
        });

        return jsonResponse({
          ReturnValue: [
            "/Game/Maps/TestMap.TestMap:PersistentLevel.SM_Chair_01",
            "/Game/Maps/TestMap.TestMap:PersistentLevel.PointLight_01"
          ]
        });
      }

      if (url.endsWith("/remote/object/describe")) {
        const body = JSON.parse(String(init?.body)) as { objectPath: string };

        if (body.objectPath.endsWith("SM_Chair_01")) {
          return jsonResponse({
            Name: "SM_Chair_01",
            Class: "/Script/Engine.StaticMeshActor"
          });
        }

        if (body.objectPath.endsWith("PointLight_01")) {
          return jsonResponse({
            Name: "PointLight_01",
            Class: "/Script/Engine.PointLight"
          });
        }
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const backend = createBackend();
    const result = await backend.getLevelActors({
      className: "PointLight",
      limit: 10
    });

    expect(result).toEqual([
      {
        actorName: "PointLight_01",
        className: "PointLight",
        objectPath: "/Game/Maps/TestMap.TestMap:PersistentLevel.PointLight_01"
      }
    ]);
  });

  it("returns an empty actor list cleanly", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);

      if (url.endsWith("/remote/object/call")) {
        return jsonResponse({
          ReturnValue: []
        });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const backend = createBackend();
    const result = await backend.getLevelActors({
      limit: 5
    });

    expect(result).toEqual([]);
  });

  it("surfaces malformed level actor responses clearly", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith("/remote/object/call")) {
        return jsonResponse({
          ReturnValue: [
            "/Game/Maps/TestMap.TestMap:PersistentLevel.SM_Chair_01"
          ]
        });
      }

      if (url.endsWith("/remote/object/describe")) {
        expect(init?.method).toBe("PUT");
        return jsonResponse({
          Name: "SM_Chair_01"
        });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const backend = createBackend();

    await expect(backend.getLevelActors({
      limit: 5
    })).rejects.toThrow("incomplete actor payload");
  });

  it("surfaces unreachable level actor enumeration clearly", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("fetch failed");
    }));

    const backend = createBackend();

    await expect(backend.getLevelActors({
      limit: 5
    })).rejects.toThrow("Could not reach Remote Control endpoint");
  });

  it("reads a property by canonical object path", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      expect(url.endsWith("/remote/object/property")).toBe(true);
      expect(init?.method).toBe("PUT");
      expect(JSON.parse(String(init?.body))).toEqual({
        objectPath: "/Game/Maps/TestMap.TestMap:PersistentLevel.PointLight_01.LightComponent0",
        propertyName: "Intensity",
        access: "READ_ACCESS"
      });

      return jsonResponse({
        Intensity: 2500
      });
    });

    vi.stubGlobal("fetch", fetchMock);

    const backend = createBackend();
    const result = await backend.getProperty({
      target: {
        objectPath: "/Game/Maps/TestMap.TestMap:PersistentLevel.PointLight_01.LightComponent0"
      },
      propertyName: "Intensity"
    });

    expect(result).toEqual({
      target: {
        objectPath: "/Game/Maps/TestMap.TestMap:PersistentLevel.PointLight_01.LightComponent0"
      },
      propertyName: "Intensity",
      value: 2500
    });
  });

  it("maps missing target objects to NOT_FOUND", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      errorMessage: "Object not found"
    }), {
      status: 404,
      statusText: "Not Found",
      headers: {
        "Content-Type": "application/json"
      }
    })));

    const backend = createBackend();

    await expect(backend.getProperty({
      target: {
        objectPath: "/Game/Missing.Actor"
      },
      propertyName: "Intensity"
    })).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Target object not found: /Game/Missing.Actor"
    });
  });

  it("maps missing properties to NOT_FOUND", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      errorMessage: "Property not found"
    }), {
      status: 404,
      statusText: "Not Found",
      headers: {
        "Content-Type": "application/json"
      }
    })));

    const backend = createBackend();

    await expect(backend.getProperty({
      target: {
        objectPath: "/Game/Maps/TestMap.TestMap:PersistentLevel.PointLight_01.LightComponent0"
      },
      propertyName: "MissingProp"
    })).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Property not found: MissingProp"
    });
  });

  it("surfaces unreachable property reads clearly", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("fetch failed");
    }));

    const backend = createBackend();

    await expect(backend.getProperty({
      target: {
        objectPath: "/Game/Maps/TestMap.TestMap:PersistentLevel.PointLight_01.LightComponent0"
      },
      propertyName: "Intensity"
    })).rejects.toThrow("Could not reach Remote Control endpoint");
  });

  it("rejects actorName-only property reads in remote-control mode", async () => {
    const backend = createBackend();

    await expect(backend.getProperty({
      target: {
        actorName: "PointLight_01"
      },
      propertyName: "Intensity"
    })).rejects.toMatchObject({
      code: "VALIDATION_ERROR"
    });
  });

  it("writes a property through transactional write plus verification read", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      expect(url.endsWith("/remote/object/property")).toBe(true);
      const body = JSON.parse(String(init?.body)) as {
        objectPath: string;
        propertyName: string;
        access: string;
        propertyValue?: Record<string, unknown>;
      };

      if (body.access === "READ_ACCESS" && fetchMock.mock.calls.length === 1) {
        return jsonResponse({
          Intensity: 2500
        });
      }

      if (body.access === "WRITE_TRANSACTION_ACCESS") {
        expect(body).toEqual({
          objectPath: "/Game/Maps/TestMap.TestMap:PersistentLevel.PointLight_01.LightComponent0",
          propertyName: "Intensity",
          access: "WRITE_TRANSACTION_ACCESS",
          propertyValue: {
            Intensity: 3200
          }
        });

        return jsonResponse(null);
      }

      if (body.access === "READ_ACCESS" && fetchMock.mock.calls.length === 3) {
        return jsonResponse({
          Intensity: 3200
        });
      }

      throw new Error(`Unexpected request body: ${JSON.stringify(body)}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const backend = createBackend();
    const result = await backend.setProperty({
      target: {
        objectPath: "/Game/Maps/TestMap.TestMap:PersistentLevel.PointLight_01.LightComponent0"
      },
      propertyName: "Intensity",
      value: 3200
    });

    expect(result).toEqual({
      target: {
        objectPath: "/Game/Maps/TestMap.TestMap:PersistentLevel.PointLight_01.LightComponent0"
      },
      propertyName: "Intensity",
      value: 3200,
      changed: true
    });
  });

  it("maps missing target objects on property writes to NOT_FOUND", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      errorMessage: "Object not found"
    }), {
      status: 404,
      statusText: "Not Found",
      headers: {
        "Content-Type": "application/json"
      }
    })));

    const backend = createBackend();

    await expect(backend.setProperty({
      target: {
        objectPath: "/Game/Missing.Actor"
      },
      propertyName: "Intensity",
      value: 3200
    })).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Target object not found: /Game/Missing.Actor"
    });
  });

  it("maps missing properties on property writes to NOT_FOUND", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      errorMessage: "Property not found"
    }), {
      status: 404,
      statusText: "Not Found",
      headers: {
        "Content-Type": "application/json"
      }
    })));

    const backend = createBackend();

    await expect(backend.setProperty({
      target: {
        objectPath: "/Game/Maps/TestMap.TestMap:PersistentLevel.PointLight_01.LightComponent0"
      },
      propertyName: "MissingProp",
      value: 3200
    })).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Property not found: MissingProp"
    });
  });

  it("maps non-writable properties on property writes to NOT_WRITABLE", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { access: string };

      if (body.access === "READ_ACCESS" && fetchMock.mock.calls.length === 1) {
        return jsonResponse({
          Mobility: "Static"
        });
      }

      return new Response(JSON.stringify({
        errorMessage: "Property is read only"
      }), {
        status: 400,
        statusText: "Bad Request",
        headers: {
          "Content-Type": "application/json"
        }
      });
    });

    vi.stubGlobal("fetch", fetchMock);

    const backend = createBackend();

    await expect(backend.setProperty({
      target: {
        objectPath: "/Game/Maps/TestMap.TestMap:PersistentLevel.SM_Chair_01"
      },
      propertyName: "Mobility",
      value: "Movable"
    })).rejects.toMatchObject({
      code: "NOT_WRITABLE",
      message: "Property is not writable: Mobility"
    });
  });

  it("maps invalid property values to INVALID_VALUE when the backend makes that clear", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { access: string };

      if (body.access === "READ_ACCESS" && fetchMock.mock.calls.length === 1) {
        return jsonResponse({
          Intensity: 2500
        });
      }

      return new Response(JSON.stringify({
        errorMessage: "Type mismatch while importing property value"
      }), {
        status: 400,
        statusText: "Bad Request",
        headers: {
          "Content-Type": "application/json"
        }
      });
    });

    vi.stubGlobal("fetch", fetchMock);

    const backend = createBackend();

    await expect(backend.setProperty({
      target: {
        objectPath: "/Game/Maps/TestMap.TestMap:PersistentLevel.PointLight_01.LightComponent0"
      },
      propertyName: "Intensity",
      value: "too-bright"
    })).rejects.toMatchObject({
      code: "INVALID_VALUE"
    });
  });

  it("surfaces unreachable property writes clearly", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { access: string };

      if (body.access === "READ_ACCESS" && fetchMock.mock.calls.length === 1) {
        return jsonResponse({
          Intensity: 2500
        });
      }

      throw new TypeError("fetch failed");
    });

    vi.stubGlobal("fetch", fetchMock);

    const backend = createBackend();

    await expect(backend.setProperty({
      target: {
        objectPath: "/Game/Maps/TestMap.TestMap:PersistentLevel.PointLight_01.LightComponent0"
      },
      propertyName: "Intensity",
      value: 3200
    })).rejects.toThrow("Could not reach Remote Control endpoint");
  });

  it("rejects actorName-only property writes in remote-control mode", async () => {
    const backend = createBackend();

    await expect(backend.setProperty({
      target: {
        actorName: "PointLight_01"
      },
      propertyName: "Intensity",
      value: 3200
    })).rejects.toMatchObject({
      code: "VALIDATION_ERROR"
    });
  });
});

function createBackend(): RemoteControlBackend {
  return new RemoteControlBackend({
    baseUrl: BASE_URL,
    timeoutMs: 1000
  });
}

function jsonResponse(payload: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(payload), {
    status: init.status ?? 200,
    statusText: init.statusText ?? "OK",
    headers: {
      "Content-Type": "application/json"
    }
  });
}
