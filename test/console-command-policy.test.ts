import { describe, expect, it } from "vitest";
import {
  assertSafeConsoleCommandId,
  resolveSafeConsoleCommand,
  SAFE_CONSOLE_COMMAND_IDS
} from "../src/tools/console-command-policy.js";
import { BridgeError } from "../src/utils/errors.js";

describe("console command policy", () => {
  it("exposes the fixed M0 command ID allowlist", () => {
    expect(SAFE_CONSOLE_COMMAND_IDS).toEqual([
      "stat_fps",
      "stat_unit",
      "stat_memory",
      "show_bounds",
      "show_collision",
      "show_navigation"
    ]);
  });

  it("accepts allowlisted command IDs", () => {
    expect(() => assertSafeConsoleCommandId("stat_fps")).not.toThrow();
    expect(() => assertSafeConsoleCommandId("show_navigation")).not.toThrow();
  });

  it("maps command IDs to exact Unreal console commands", () => {
    expect(resolveSafeConsoleCommand("stat_fps")).toEqual({
      commandId: "stat_fps",
      unrealCommand: "stat fps"
    });
  });

  it("rejects non-allowlisted command IDs", () => {
    expect(() => assertSafeConsoleCommandId("quit")).toThrowError(BridgeError);
    expect(() => resolveSafeConsoleCommand("exec_python")).toThrow(/allowlisted/i);
  });
});
