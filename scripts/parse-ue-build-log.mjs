import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const logPath = process.argv[2];
const parserPath = new URL("../dist/utils/build-log-parser.js", import.meta.url);

if (!logPath) {
  console.error("Usage: node scripts/parse-ue-build-log.mjs <build-log-path>");
  process.exit(1);
}

if (!fs.existsSync(parserPath)) {
  console.error("Build parser is not compiled yet. Run `npm run build` first.");
  process.exit(1);
}

const { parseUeBuildOutput } = await import(parserPath.href);

const resolvedPath = path.resolve(logPath);
const content = fs.readFileSync(resolvedPath, "utf8");
const result = parseUeBuildOutput(content);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
