import { createBackend } from "../backend/index.js";
import { loadConfig } from "../config/index.js";
import { createServer, startServer } from "./create-server.js";
import { Logger } from "../utils/logger.js";
import { toErrorMessage } from "../utils/errors.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = new Logger(config.logLevel);
  const backend = createBackend(config);
  const server = createServer(config, backend, logger);

  logger.info("Starting UE_AgentBridge", {
    backend: backend.name,
    remoteControlUrl: config.remoteControl.baseUrl
  });

  await startServer(server);
}

main().catch((error: unknown) => {
  process.stderr.write(`UE_AgentBridge failed to start: ${toErrorMessage(error)}\n`);
  process.exitCode = 1;
});
