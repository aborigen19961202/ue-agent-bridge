import { createBackend } from "../backend/index.js";
import { loadConfig } from "../config/index.js";
import { createServer, startServer } from "./create-server.js";
import { Logger } from "../utils/logger.js";
import { toErrorMessage } from "../utils/errors.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = new Logger(config.logLevel);
  installProcessHygiene(logger);
  const backend = createBackend(config);
  const server = createServer(config, backend, logger);

  logger.info("Starting UE_AgentBridge", {
    backend: backend.name,
    remoteControlUrl: config.remoteControl.baseUrl,
    pluginUrl: config.plugin.baseUrl
  });

  await startServer(server);
}

function installProcessHygiene(logger: Logger): void {
  let shuttingDown = false;

  const shutdown = (reason: string) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    logger.info("Shutting down UE_AgentBridge", { reason });
    setImmediate(() => {
      process.exit(0);
    });
  };

  process.stdin.on("end", () => shutdown("stdin_end"));
  process.stdin.on("close", () => shutdown("stdin_close"));
  process.on("disconnect", () => shutdown("ipc_disconnect"));
  process.on("SIGTERM", () => shutdown("sigterm"));
  process.on("SIGINT", () => shutdown("sigint"));
  process.on("SIGHUP", () => shutdown("sighup"));
}

main().catch((error: unknown) => {
  process.stderr.write(`UE_AgentBridge failed to start: ${toErrorMessage(error)}\n`);
  process.exitCode = 1;
});
