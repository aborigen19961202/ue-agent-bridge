import { BridgeError } from "../utils/errors.js";
import { LogLevelName } from "../utils/logger.js";

export interface AppConfig {
  backendMode: "mock" | "remote-control" | "plugin";
  logLevel: LogLevelName;
  requestTimeoutMs: number;
  remoteControl: {
    host: string;
    port: number;
    baseUrl: string;
  };
  plugin: {
    host: string;
    port: number;
    baseUrl: string;
  };
}

function parseLogLevel(value: string | undefined): LogLevelName {
  const normalized = (value ?? "info").toLowerCase();

  switch (normalized) {
    case "debug":
    case "info":
    case "warn":
    case "error":
      return normalized as LogLevelName;
    default:
      throw new BridgeError("CONFIG_ERROR", `Invalid UE_LOG_LEVEL: ${value}`);
  }
}

function parsePort(value: string | undefined, fallback: number): number {
  const port = Number.parseInt(value ?? `${fallback}`, 10);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new BridgeError("CONFIG_ERROR", `Invalid UE_RC_PORT: ${value}`);
  }

  return port;
}

function parseTimeout(value: string | undefined, fallback: number): number {
  const timeout = Number.parseInt(value ?? `${fallback}`, 10);

  if (!Number.isInteger(timeout) || timeout < 100 || timeout > 120000) {
    throw new BridgeError("CONFIG_ERROR", `Invalid UE_REQUEST_TIMEOUT_MS: ${value}`);
  }

  return timeout;
}

function parseBackendMode(value: string | undefined): "mock" | "remote-control" | "plugin" {
  const normalized = (value ?? "mock").toLowerCase();

  if (normalized === "mock" || normalized === "remote-control" || normalized === "plugin") {
    return normalized;
  }

  throw new BridgeError("CONFIG_ERROR", `Invalid UE_BACKEND_MODE: ${value}`);
}

function ensureLocalHost(value: string | undefined): string {
  const host = (value ?? "127.0.0.1").trim();
  const allowed = new Set(["127.0.0.1", "localhost", "::1"]);

  if (!allowed.has(host)) {
    throw new BridgeError("CONFIG_ERROR", `UE_RC_HOST must be loopback-only for M0. Received: ${host}`);
  }

  return host === "localhost" ? "127.0.0.1" : host;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const remoteControlHost = ensureLocalHost(env.UE_RC_HOST);
  const remoteControlPort = parsePort(env.UE_RC_PORT, 30010);
  const pluginHost = ensureLocalHost(env.UE_PLUGIN_HOST);
  const pluginPort = parsePort(env.UE_PLUGIN_PORT, 30110);

  return {
    backendMode: parseBackendMode(env.UE_BACKEND_MODE),
    logLevel: parseLogLevel(env.UE_LOG_LEVEL),
    requestTimeoutMs: parseTimeout(env.UE_REQUEST_TIMEOUT_MS, 5000),
    remoteControl: {
      host: remoteControlHost,
      port: remoteControlPort,
      baseUrl: `http://${remoteControlHost}:${remoteControlPort}`
    },
    plugin: {
      host: pluginHost,
      port: pluginPort,
      baseUrl: `http://${pluginHost}:${pluginPort}`
    }
  };
}
