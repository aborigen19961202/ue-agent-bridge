export type BuildDiagnosticSeverity = "info" | "warning" | "error";

export interface BuildDiagnostic {
  source: "msvc" | "ubt";
  severity: BuildDiagnosticSeverity;
  message: string;
  raw: string;
  code?: string | undefined;
  filePath?: string | undefined;
  line?: number | undefined;
  column?: number | undefined;
}

export interface BuildParseResult {
  ok: boolean;
  diagnostics: BuildDiagnostic[];
  summary: {
    errorCount: number;
    warningCount: number;
    infoCount: number;
  };
}

const MSVC_WITH_COLUMN = /^(?<file>[A-Za-z]:\\.+?)\((?<line>\d+),(?<column>\d+)\):\s*(?<severity>fatal error|error|warning|note)\s+(?<code>[A-Z]+\d+):\s*(?<message>.+)$/i;
const MSVC_NO_COLUMN = /^(?<file>[A-Za-z]:\\.+?)\((?<line>\d+)\):\s*(?<severity>fatal error|error|warning|note)\s+(?<code>[A-Z]+\d+):\s*(?<message>.+)$/i;
const LINKER_FATAL = /^(?<tool>LINK|LNK\d+)\s*:\s*fatal error\s+(?<code>LNK\d+):\s*(?<message>.+)$/i;
const UBA_FILE_LOCK = /^UbaSessionServer\s+-\s+ERROR opening file\s+(?<file>[A-Za-z]:\\.+?)\s+for write after retrying.+$/i;
const UBT_ERROR = /^(?<prefix>(?:UHT|Log|Error|Result).*)$/i;

export function parseUeBuildOutput(text: string): BuildParseResult {
  const diagnostics: BuildDiagnostic[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const msvcWithColumn = line.match(MSVC_WITH_COLUMN);
    if (msvcWithColumn?.groups) {
      const filePath = msvcWithColumn.groups.file;
      const message = msvcWithColumn.groups.message;
      const severity = msvcWithColumn.groups.severity;
      const code = msvcWithColumn.groups.code;
      const lineNumber = msvcWithColumn.groups.line;
      const columnNumber = msvcWithColumn.groups.column;

      if (!filePath || !message || !severity || !code || !lineNumber || !columnNumber) {
        continue;
      }

      diagnostics.push({
        source: "msvc",
        severity: normalizeSeverity(severity),
        message: message.trim(),
        raw: rawLine,
        code,
        filePath,
        line: Number(lineNumber),
        column: Number(columnNumber)
      });
      continue;
    }

    const msvcNoColumn = line.match(MSVC_NO_COLUMN);
    if (msvcNoColumn?.groups) {
      const filePath = msvcNoColumn.groups.file;
      const message = msvcNoColumn.groups.message;
      const severity = msvcNoColumn.groups.severity;
      const code = msvcNoColumn.groups.code;
      const lineNumber = msvcNoColumn.groups.line;

      if (!filePath || !message || !severity || !code || !lineNumber) {
        continue;
      }

      diagnostics.push({
        source: "msvc",
        severity: normalizeSeverity(severity),
        message: message.trim(),
        raw: rawLine,
        code,
        filePath,
        line: Number(lineNumber)
      });
      continue;
    }

    const linkerFatal = line.match(LINKER_FATAL);
    if (linkerFatal?.groups) {
      const message = linkerFatal.groups.message;
      const code = linkerFatal.groups.code;

      if (!message || !code) {
        continue;
      }

      diagnostics.push({
        source: "msvc",
        severity: "error",
        message: message.trim(),
        raw: rawLine,
        code
      });
      continue;
    }

    const ubaFileLock = line.match(UBA_FILE_LOCK);
    if (ubaFileLock?.groups) {
      const filePath = ubaFileLock.groups.file;
      if (!filePath) {
        continue;
      }

      diagnostics.push({
        source: "ubt",
        severity: "error",
        message: `Build output file is locked by a running Unreal Editor process: ${filePath}`,
        raw: rawLine,
        filePath
      });
      continue;
    }

    if (line.startsWith("Result: Failed")) {
      diagnostics.push({
        source: "ubt",
        severity: "error",
        message: line,
        raw: rawLine
      });
      continue;
    }

    if (line.startsWith("Result: Succeeded")) {
      diagnostics.push({
        source: "ubt",
        severity: "info",
        message: line,
        raw: rawLine
      });
      continue;
    }

    if (line.startsWith("error ") || line.startsWith("fatal error ")) {
      diagnostics.push({
        source: "ubt",
        severity: "error",
        message: line,
        raw: rawLine
      });
      continue;
    }

    if (line.startsWith("warning ")) {
      diagnostics.push({
        source: "ubt",
        severity: "warning",
        message: line,
        raw: rawLine
      });
      continue;
    }

    if (UBT_ERROR.test(line) && /\b(error|warning)\b/i.test(line)) {
      diagnostics.push({
        source: "ubt",
        severity: /\berror\b/i.test(line) ? "error" : "warning",
        message: line,
        raw: rawLine
      });
    }
  }

  const summary = {
    errorCount: diagnostics.filter((entry) => entry.severity === "error").length,
    warningCount: diagnostics.filter((entry) => entry.severity === "warning").length,
    infoCount: diagnostics.filter((entry) => entry.severity === "info").length
  };

  return {
    ok: summary.errorCount === 0,
    diagnostics,
    summary
  };
}

function normalizeSeverity(input: string): BuildDiagnosticSeverity {
  const value = input.toLowerCase();
  if (value.includes("error")) {
    return "error";
  }
  if (value.includes("warning")) {
    return "warning";
  }
  return "info";
}
