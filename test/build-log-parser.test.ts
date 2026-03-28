import { describe, expect, it } from "vitest";
import { parseUeBuildOutput } from "../src/utils/build-log-parser.js";

describe("parseUeBuildOutput", () => {
  it("extracts MSVC diagnostics with file, line, column, and code", () => {
    const result = parseUeBuildOutput(`
E:\\UnrealEngine\\Projects\\CleanModelFactory\\Source\\CleanModelFactory\\CleanModelFactory.cpp(6,1): fatal error C1189: #error: UEAgentBridgeDiagnosticsProbe
Result: Failed (OtherCompilationError)
`);

    expect(result.ok).toBe(false);
    expect(result.summary.errorCount).toBe(2);
    expect(result.diagnostics[0]).toEqual({
      source: "msvc",
      severity: "error",
      message: "#error: UEAgentBridgeDiagnosticsProbe",
      raw: "E:\\UnrealEngine\\Projects\\CleanModelFactory\\Source\\CleanModelFactory\\CleanModelFactory.cpp(6,1): fatal error C1189: #error: UEAgentBridgeDiagnosticsProbe",
      code: "C1189",
      filePath: "E:\\UnrealEngine\\Projects\\CleanModelFactory\\Source\\CleanModelFactory\\CleanModelFactory.cpp",
      line: 6,
      column: 1
    });
  });

  it("extracts warnings without a column and preserves succeeded builds as info", () => {
    const result = parseUeBuildOutput(`
E:\\Repo\\Foo.cpp(17): warning C4100: 'Value': unreferenced formal parameter
Result: Succeeded
`);

    expect(result.ok).toBe(true);
    expect(result.summary.warningCount).toBe(1);
    expect(result.summary.infoCount).toBe(1);
    expect(result.diagnostics[0]).toMatchObject({
      source: "msvc",
      severity: "warning",
      code: "C4100",
      filePath: "E:\\Repo\\Foo.cpp",
      line: 17
    });
  });

  it("detects generic UBT error lines when no compiler location is present", () => {
    const result = parseUeBuildOutput(`
error : Unable to start live coding session. Missing executable 'LiveCodingConsole.exe'.
`);

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual([
      {
        source: "ubt",
        severity: "error",
        message: "error : Unable to start live coding session. Missing executable 'LiveCodingConsole.exe'.",
        raw: "error : Unable to start live coding session. Missing executable 'LiveCodingConsole.exe'."
      }
    ]);
  });

  it("captures linker failures and editor-locked output files", () => {
    const result = parseUeBuildOutput(`
UbaSessionServer - ERROR opening file E:\\UnrealEngine\\Projects\\CleanModelFactory\\Binaries\\Win64\\UnrealEditor-CleanModelFactory.dll for write after retrying for 20 seconds (The process cannot access the file because it is being used by another process. - E:\\UnrealEngine\\UE_5.7\\Engine\\Binaries\\Win64\\UnrealEditor.exe)
LINK : fatal error LNK1104: cannot open file 'E:\\UnrealEngine\\Projects\\CleanModelFactory\\Binaries\\Win64\\UnrealEditor-CleanModelFactory.dll'
Result: Failed (OtherCompilationError)
`);

    expect(result.ok).toBe(false);
    expect(result.summary.errorCount).toBe(3);
    expect(result.diagnostics[0]).toEqual({
      source: "ubt",
      severity: "error",
      message: "Build output file is locked by a running Unreal Editor process: E:\\UnrealEngine\\Projects\\CleanModelFactory\\Binaries\\Win64\\UnrealEditor-CleanModelFactory.dll",
      raw: "UbaSessionServer - ERROR opening file E:\\UnrealEngine\\Projects\\CleanModelFactory\\Binaries\\Win64\\UnrealEditor-CleanModelFactory.dll for write after retrying for 20 seconds (The process cannot access the file because it is being used by another process. - E:\\UnrealEngine\\UE_5.7\\Engine\\Binaries\\Win64\\UnrealEditor.exe)",
      filePath: "E:\\UnrealEngine\\Projects\\CleanModelFactory\\Binaries\\Win64\\UnrealEditor-CleanModelFactory.dll"
    });
    expect(result.diagnostics[1]).toEqual({
      source: "msvc",
      severity: "error",
      message: "cannot open file 'E:\\UnrealEngine\\Projects\\CleanModelFactory\\Binaries\\Win64\\UnrealEditor-CleanModelFactory.dll'",
      raw: "LINK : fatal error LNK1104: cannot open file 'E:\\UnrealEngine\\Projects\\CleanModelFactory\\Binaries\\Win64\\UnrealEditor-CleanModelFactory.dll'",
      code: "LNK1104"
    });
  });
});
