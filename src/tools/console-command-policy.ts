import { BridgeError } from "../utils/errors.js";

const SAFE_CONSOLE_COMMAND_SPECS = [
  {
    commandId: "stat_fps",
    unrealCommand: "stat fps"
  },
  {
    commandId: "stat_unit",
    unrealCommand: "stat unit"
  },
  {
    commandId: "stat_memory",
    unrealCommand: "stat memory"
  },
  {
    commandId: "show_bounds",
    unrealCommand: "show bounds"
  },
  {
    commandId: "show_collision",
    unrealCommand: "show collision"
  },
  {
    commandId: "show_navigation",
    unrealCommand: "show navigation"
  }
] as const;

export type SafeConsoleCommandId = typeof SAFE_CONSOLE_COMMAND_SPECS[number]["commandId"];

export interface SafeConsoleCommandSpec {
  commandId: SafeConsoleCommandId;
  unrealCommand: string;
}

export const SAFE_CONSOLE_COMMAND_IDS = SAFE_CONSOLE_COMMAND_SPECS.map((spec) => spec.commandId);

export function assertSafeConsoleCommandId(commandId: string): asserts commandId is SafeConsoleCommandId {
  if (!SAFE_CONSOLE_COMMAND_IDS.includes(commandId as SafeConsoleCommandId)) {
    throw new BridgeError(
      "UNSAFE_COMMAND",
      `Console command ID is not allowlisted for M0: ${commandId}`
    );
  }
}

export function resolveSafeConsoleCommand(commandId: string): SafeConsoleCommandSpec {
  assertSafeConsoleCommandId(commandId);

  const spec = SAFE_CONSOLE_COMMAND_SPECS.find((candidate) => candidate.commandId === commandId);

  if (!spec) {
    throw new BridgeError(
      "UNSAFE_COMMAND",
      `Console command ID is not allowlisted for M0: ${commandId}`
    );
  }

  return spec;
}
