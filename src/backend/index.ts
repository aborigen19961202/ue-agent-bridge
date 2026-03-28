import { AppConfig } from "../config/index.js";
import { MockUnrealBackend } from "./mock-backend.js";
import { PluginBackend } from "./plugin-backend.js";
import { RemoteControlBackend } from "./remote-control-backend.js";
import { UnrealBackend } from "./unreal-backend.js";

export function createBackend(config: AppConfig): UnrealBackend {
  if (config.backendMode === "plugin") {
    return new PluginBackend({
      baseUrl: config.plugin.baseUrl,
      timeoutMs: config.requestTimeoutMs,
      remoteControlBaseUrl: config.remoteControl.baseUrl
    });
  }

  if (config.backendMode === "remote-control") {
    return new RemoteControlBackend({
      baseUrl: config.remoteControl.baseUrl,
      timeoutMs: config.requestTimeoutMs
    });
  }

  return new MockUnrealBackend();
}
