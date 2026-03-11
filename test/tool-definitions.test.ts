import { describe, expect, it } from "vitest";
import { getToolDefinition, toolDefinitions } from "../src/tools/definitions.js";
import { MockUnrealBackend } from "../src/backend/mock-backend.js";

describe("tool definitions", () => {
  it("registers exactly the approved M0 tool set", () => {
    expect(toolDefinitions.map((tool) => tool.name)).toEqual([
      "ue_healthcheck",
      "ue_get_selected_actors",
      "ue_get_level_actors",
      "ue_get_property",
      "ue_set_property",
      "ue_asset_search",
      "ue_get_output_log",
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
});
