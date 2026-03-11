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
});
