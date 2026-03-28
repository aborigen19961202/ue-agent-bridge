import { describe, expect, it } from "vitest";
import { getToolDefinition, toolDefinitions } from "../src/tools/definitions.js";
import { MockUnrealBackend } from "../src/backend/mock-backend.js";

describe("tool definitions", () => {
  it("registers the current bridge tool set", () => {
    expect(toolDefinitions.map((tool) => tool.name)).toEqual([
      "ue_healthcheck",
      "ue_get_selected_actors",
      "ue_get_level_actors",
      "ue_get_property",
      "ue_set_property",
      "ue_asset_search",
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
      "ue_compare_viewport_screenshot",
      "ue_get_debug_draw_state",
      "ue_get_live_coding_status",
      "ue_trigger_live_coding_build_safe",
      "ue_run_console_command_safe"
    ]);
  });

  it("rejects invalid asset search arguments", () => {
    const tool = getToolDefinition("ue_asset_search");
    expect(tool).toBeDefined();
    expect(() => tool?.parseArgs({})).toThrow();
  });

  it("rejects non-allowlisted console command IDs", () => {
    const tool = getToolDefinition("ue_run_console_command_safe");
    expect(tool).toBeDefined();
    expect(() => tool?.parseArgs({
      commandId: "quit_now"
    })).toThrow();
  });

  it("requires exactly one spawn class identifier", () => {
    const tool = getToolDefinition("ue_spawn_actor_safe");
    expect(tool).toBeDefined();
    expect(() => tool?.parseArgs({
      location: { x: 0, y: 0, z: 0 },
      rotation: { pitch: 0, yaw: 0, roll: 0 }
    })).toThrow();
    expect(() => tool?.parseArgs({
      className: "PointLight",
      classPath: "/Script/Engine.PointLight",
      location: { x: 0, y: 0, z: 0 },
      rotation: { pitch: 0, yaw: 0, roll: 0 }
    })).toThrow();
  });

  it("runs a read tool against the mock backend", async () => {
    const tool = getToolDefinition("ue_get_level_actors");
    const backend = new MockUnrealBackend();
    const args = tool?.parseArgs({
      className: "PointLight"
    });

    const result = await tool?.run(backend, args);
    expect(Array.isArray(result)).toBe(true);
    expect((result as Array<{ actorName: string }>)[0]?.actorName).toBe("PointLight_01");
  });

  it("formats viewport screenshots as image tool responses", async () => {
    const tool = getToolDefinition("ue_get_viewport_screenshot");
    const backend = new MockUnrealBackend();
    const args = tool?.parseArgs({
      maxDimension: 1024
    });

    const result = await tool?.run(backend, args);
    const response = tool?.formatResult?.(result);

    expect(response?.content[0]).toMatchObject({
      type: "text"
    });
    expect(response?.content[1]).toMatchObject({
      type: "image",
      mimeType: "image/png"
    });
  });

  it("frames an actor and captures a screenshot through the composite tool", async () => {
    const tool = getToolDefinition("ue_capture_actor_screenshot");
    const backend = new MockUnrealBackend();
    const args = tool?.parseArgs({
      target: {
        actorName: "PointLight_01"
      },
      maxDimension: 1024
    });

    const result = await tool?.run(backend, args);
    expect((result as { source: string }).source).toBe("active_viewport");
  });

  it("spawns, selects, and destroys actors through safe mutation tools", async () => {
    const backend = new MockUnrealBackend();
    const spawnTool = getToolDefinition("ue_spawn_actor_safe");
    const selectTool = getToolDefinition("ue_select_actor_safe");
    const destroyTool = getToolDefinition("ue_destroy_actor_safe");

    const spawnArgs = spawnTool?.parseArgs({
      className: "GrapeRachisActor",
      location: { x: 100, y: 200, z: 300 },
      rotation: { pitch: 0, yaw: 90, roll: 0 },
      selectAfterSpawn: true,
      label: "Spawned Grape"
    });
    const spawned = await spawnTool?.run(backend, spawnArgs);
    expect(spawned).toMatchObject({
      actorLabel: "Spawned Grape",
      className: "GrapeRachisActor",
      selected: true
    });

    const selectArgs = selectTool?.parseArgs({
      target: {
        actorName: (spawned as { actorName: string }).actorName
      }
    });
    const selected = await selectTool?.run(backend, selectArgs);
    expect(selected).toMatchObject({
      actorName: (spawned as { actorName: string }).actorName,
      selected: true
    });

    const destroyArgs = destroyTool?.parseArgs({
      target: {
        actorName: (spawned as { actorName: string }).actorName
      }
    });
    const destroyed = await destroyTool?.run(backend, destroyArgs);
    expect(destroyed).toMatchObject({
      actorName: (spawned as { actorName: string }).actorName,
      destroyed: true
    });
  });

  it("runs debug draw inspection against the mock backend", async () => {
    const tool = getToolDefinition("ue_get_debug_draw_state");
    const backend = new MockUnrealBackend();
    const args = tool?.parseArgs({
      limit: 10,
      includePoints: true
    });

    const result = await tool?.run(backend, args);
    expect((result as { summary: { totalLines: number } }).summary.totalLines).toBeGreaterThan(0);
  });
});
