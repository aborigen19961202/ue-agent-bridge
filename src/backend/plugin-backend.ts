import {
  ActorSummary,
  AssetSearchInput,
  AssetSummary,
  ConsoleCommandResult,
  DebugDrawStateResult,
  DestroyActorInput,
  DestroyActorResult,
  EditorDiagnostic,
  EditorState,
  FrameActorInput,
  FrameActorResult,
  GetDebugDrawStateInput,
  GetEditorDiagnosticsInput,
  GetLevelActorsInput,
  GetOutputLogInput,
  GetPropertyInput,
  HealthcheckResult,
  LiveCodingStatus,
  OutputLogEntry,
  PropertyReadResult,
  PropertyWriteResult,
  RunConsoleCommandInput,
  SelectActorInput,
  SelectActorResult,
  SetViewportCameraInput,
  SetPropertyInput,
  SpawnActorInput,
  SpawnActorResult,
  TriggerLiveCodingBuildResult,
  ViewportCameraState,
  ViewportScreenshotInput,
  ViewportScreenshotResult
} from "../types/domain.js";
import { BridgeError } from "../utils/errors.js";
import { assertWritablePropertyInput } from "./property-write-policy.js";
import { resolveSafeConsoleCommand } from "../tools/console-command-policy.js";
import { RemoteControlBackend } from "./remote-control-backend.js";
import { UnrealBackend } from "./unreal-backend.js";

export interface PluginBackendOptions {
  baseUrl: string;
  timeoutMs: number;
  remoteControlBaseUrl: string;
}

interface PluginHealthResponse {
  pluginName?: unknown;
  pluginVersion?: unknown;
  apiVersion?: unknown;
  editor?: unknown;
  capabilities?: unknown;
  warnings?: unknown;
}

interface JsonResponse {
  status: number;
  data: unknown;
}

interface HttpResponse {
  ok: boolean;
  status: number;
  statusText: string;
  rawBody: string;
  data: unknown;
}

export class PluginBackend implements UnrealBackend {
  public readonly name = "plugin";
  private readonly remoteControlFallback: RemoteControlBackend;

  public constructor(private readonly options: PluginBackendOptions) {
    this.remoteControlFallback = new RemoteControlBackend({
      baseUrl: options.remoteControlBaseUrl,
      timeoutMs: options.timeoutMs
    });
  }

  public async healthcheck(): Promise<HealthcheckResult> {
    let response: JsonResponse;

    try {
      response = await this.fetchJson("/api/v1/health", { method: "GET" });
    } catch (error) {
      return pluginHealthcheckFromError(this.options.baseUrl, error);
    }

    const payload = response.data;

    if (!isRecord(payload) || typeof payload.pluginName !== "string" || !isRecord(payload.editor) || !isRecord(payload.capabilities)) {
      return {
        backend: "plugin",
        connected: false,
        mode: "plugin",
        transport: "http",
        message: "Plugin endpoint responded, but /api/v1/health returned an unexpected response shape.",
        capabilities: [],
        readiness: {
          backendReachable: true,
          remoteControlAvailable: false,
          preset: {
            name: null,
            checked: false,
            available: null
          },
          helpers: {
            checked: true,
            ready: false,
            required: [],
            missing: []
          }
        }
      };
    }

    const capabilityMap = payload.capabilities as Record<string, unknown>;
    const availableTools = Object.entries(capabilityMap)
      .filter(([, enabled]) => enabled === true)
      .map(([toolName]) => toolName);

    const remoteControlHealth = await this.remoteControlFallback.healthcheck();
    const fallbackCapabilities = remoteControlHealth.capabilities.filter((toolName) =>
      toolName === "ue_asset_search" || toolName === "ue_get_property" || toolName === "ue_set_property"
    );

    return {
      backend: "plugin",
      connected: true,
      mode: "plugin",
      transport: "http",
      message: buildPluginHealthMessage(payload),
      capabilities: [
        "ue_healthcheck",
        ...availableTools,
        ...fallbackCapabilities
      ].filter(onlyUnique),
      readiness: {
        backendReachable: true,
        remoteControlAvailable: remoteControlHealth.readiness.remoteControlAvailable,
        preset: {
          name: null,
          checked: false,
          available: null
        },
        helpers: {
          checked: true,
          ready: true,
          required: [],
          missing: []
        }
      }
    };
  }

  public async getSelectedActors(): Promise<ActorSummary[]> {
    const response = await this.fetchJson("/api/v1/selected-actors", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        limit: 200
      })
    });

    return normalizeActorListEnvelope(response.data, "selected actors");
  }

  public async getLevelActors(input: GetLevelActorsInput): Promise<ActorSummary[]> {
    const response = await this.fetchJson("/api/v1/level-actors", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        limit: input.limit ?? 100,
        ...(input.className ? { className: input.className } : {}),
        ...(input.nameContains ? { nameContains: input.nameContains } : {})
      })
    });

    return normalizeActorListEnvelope(response.data, "level actors");
  }

  public async getProperty(input: GetPropertyInput): Promise<PropertyReadResult> {
    return this.remoteControlFallback.getProperty(input);
  }

  public async setProperty(input: SetPropertyInput): Promise<PropertyWriteResult> {
    assertWritablePropertyInput(input);
    return this.remoteControlFallback.setProperty(input);
  }

  public async assetSearch(input: AssetSearchInput): Promise<AssetSummary[]> {
    return this.remoteControlFallback.assetSearch(input);
  }

  public async getOutputLog(input: GetOutputLogInput): Promise<OutputLogEntry[]> {
    const response = await this.fetchJson("/api/v1/output-log/slice", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        limit: input.limit ?? 50,
        ...(input.minLevel ? { minLevel: input.minLevel } : {})
      })
    });

    return normalizeOutputLogEnvelope(response.data);
  }

  public async getEditorDiagnostics(input: GetEditorDiagnosticsInput): Promise<EditorDiagnostic[]> {
    const response = await this.fetchJson("/api/v1/editor-diagnostics", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        limit: input.limit ?? 50,
        ...(input.minSeverity ? { minSeverity: input.minSeverity } : {})
      })
    });

    return normalizeEditorDiagnosticsEnvelope(response.data);
  }

  public async getEditorState(): Promise<EditorState> {
    const response = await this.fetchJson("/api/v1/editor-state", {
      method: "GET"
    });

    return normalizeEditorState(response.data);
  }

  public async getViewportScreenshot(input: ViewportScreenshotInput): Promise<ViewportScreenshotResult> {
    const response = await this.fetchJson("/api/v1/viewport/screenshot", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        maxDimension: input.maxDimension ?? 1280,
        ...(input.viewMode ? { viewMode: input.viewMode } : {}),
        ...(input.crop ? { crop: input.crop } : {})
      })
    }, Math.max(this.options.timeoutMs, 15000));

    return normalizeViewportScreenshot(response.data);
  }

  public async getViewportCamera(): Promise<ViewportCameraState> {
    const response = await this.fetchJson("/api/v1/viewport/camera", {
      method: "GET"
    });

    return normalizeViewportCameraState(response.data);
  }

  public async setViewportCamera(input: SetViewportCameraInput): Promise<ViewportCameraState> {
    const response = await this.fetchJson("/api/v1/viewport/camera", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        location: input.location,
        rotation: input.rotation
      })
    });

    return normalizeViewportCameraState(response.data);
  }

  public async spawnActor(input: SpawnActorInput): Promise<SpawnActorResult> {
    const response = await this.fetchJson("/api/v1/actors/spawn-safe", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        ...(input.className ? { className: input.className } : {}),
        ...(input.classPath ? { classPath: input.classPath } : {}),
        location: input.location,
        rotation: input.rotation,
        selectAfterSpawn: input.selectAfterSpawn ?? false,
        ...(input.label ? { label: input.label } : {})
      })
    });

    return normalizeActorTransformResult(response.data, "spawn actor");
  }

  public async selectActor(input: SelectActorInput): Promise<SelectActorResult> {
    const response = await this.fetchJson("/api/v1/actors/select-safe", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        target: input.target
      })
    });

    return normalizeSelectedActorResult(response.data, "select actor");
  }

  public async destroyActor(input: DestroyActorInput): Promise<DestroyActorResult> {
    const response = await this.fetchJson("/api/v1/actors/destroy-safe", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        target: input.target
      })
    });

    return normalizeDestroyedActorResult(response.data, "destroy actor");
  }

  public async frameActor(input: FrameActorInput): Promise<FrameActorResult> {
    const response = await this.fetchJson("/api/v1/viewport/frame-actor", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        target: input.target,
        activeViewportOnly: input.activeViewportOnly ?? true
      })
    });

    return normalizeFrameActorResult(response.data);
  }

  public async getDebugDrawState(input: GetDebugDrawStateInput): Promise<DebugDrawStateResult> {
    const response = await this.fetchJson("/api/v1/debug-draw/state", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        limit: input.limit ?? 50,
        includePoints: input.includePoints ?? true
      })
    });

    return normalizeDebugDrawState(response.data);
  }

  public async getLiveCodingStatus(): Promise<LiveCodingStatus> {
    const response = await this.fetchJson("/api/v1/live-coding/status", {
      method: "GET"
    });

    return normalizeLiveCodingStatus(response.data);
  }

  public async triggerLiveCodingBuild(): Promise<TriggerLiveCodingBuildResult> {
    const response = await this.fetchJson(
      "/api/v1/live-coding/build",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({})
      },
      Math.max(this.options.timeoutMs, 30000)
    );

    if (!isRecord(response.data) || typeof response.data.accepted !== "boolean" || !isRecord(response.data.status)) {
      throw new BridgeError("BACKEND_ERROR", "Plugin live coding build returned an unexpected response shape.");
    }

    return {
      accepted: response.data.accepted,
      status: normalizeLiveCodingStatus(response.data.status)
    };
  }

  public async runConsoleCommand(input: RunConsoleCommandInput): Promise<ConsoleCommandResult> {
    const command = resolveSafeConsoleCommand(input.commandId);
    const response = await this.fetchJson("/api/v1/console/run-safe", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        commandId: command.commandId
      })
    });

    return normalizeConsoleCommandResult(response.data, command.commandId);
  }

  private async fetchJson(path: string, init: RequestInit, timeoutMs = this.options.timeoutMs): Promise<JsonResponse> {
    const response = await this.fetchResponse(path, init, timeoutMs);

    if (!response.ok) {
      throw classifyPluginError(path, response);
    }

    if (typeof response.data === "string") {
      throw new BridgeError("BACKEND_ERROR", `Plugin backend returned a non-JSON response for ${path}.`);
    }

    return {
      status: response.status,
      data: response.data
    };
  }

  private async fetchResponse(path: string, init: RequestInit, timeoutMs: number): Promise<HttpResponse> {
    const response = await fetchWithTimeout(`${this.options.baseUrl}${path}`, init, timeoutMs);
    const rawBody = await response.text();

    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      rawBody,
      data: parseResponseBody(rawBody)
    };
  }
}

function pluginHealthcheckFromError(baseUrl: string, error: unknown): HealthcheckResult {
  const message = error instanceof Error ? error.message : `Could not reach plugin backend at ${baseUrl}`;

  return {
    backend: "plugin",
    connected: false,
    mode: "plugin",
    transport: "http",
    message,
    capabilities: [],
    readiness: {
      backendReachable: false,
      remoteControlAvailable: false,
      preset: {
        name: null,
        checked: false,
        available: null
      },
      helpers: {
        checked: false,
        ready: null,
        required: [],
        missing: []
      }
    }
  };
}

function buildPluginHealthMessage(payload: Record<string, unknown>): string {
  const pluginName = typeof payload.pluginName === "string" ? payload.pluginName : "UEAgentBridge";
  const pluginVersion = typeof payload.pluginVersion === "string" ? payload.pluginVersion : "unknown";
  const editor = isRecord(payload.editor) ? payload.editor : {};
  const projectName = typeof editor.projectName === "string" ? editor.projectName : "unknown project";
  return `${pluginName} plugin backend is reachable for ${projectName} (version ${pluginVersion}).`;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new BridgeError("BACKEND_ERROR", `Plugin backend request timed out for ${url}`);
    }

    throw new BridgeError("BACKEND_ERROR", `Could not reach plugin backend at ${url}`);
  } finally {
    clearTimeout(timeout);
  }
}

function parseResponseBody(raw: string): unknown {
  if (raw.trim().length === 0) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function classifyPluginError(path: string, response: HttpResponse): BridgeError {
  const payload = response.data;

  if (isRecord(payload) && isRecord(payload.error)) {
    const errorCode = typeof payload.error.code === "string" ? payload.error.code : "BACKEND_ERROR";
    const message = typeof payload.error.message === "string"
      ? payload.error.message
      : `Plugin backend request failed for ${path}.`;

    switch (errorCode) {
      case "EDITOR_UNAVAILABLE":
        return new BridgeError("EDITOR_UNAVAILABLE", message);
      case "NOT_SUPPORTED":
        return new BridgeError("NOT_SUPPORTED", message);
      case "UNSAFE_COMMAND":
        return new BridgeError("UNSAFE_COMMAND", message);
      case "UNSAFE_MUTATION":
        return new BridgeError("UNSAFE_MUTATION", message);
      case "NOT_FOUND":
        return new BridgeError("NOT_FOUND", message);
      case "VALIDATION_ERROR":
        return new BridgeError("VALIDATION_ERROR", message);
      case "LIMIT_EXCEEDED":
        return new BridgeError("LIMIT_EXCEEDED", message);
      case "INTERNAL_ERROR":
        return new BridgeError("INTERNAL_ERROR", message);
      default:
        return new BridgeError("BACKEND_ERROR", message);
    }
  }

  const body = typeof response.data === "string" && response.data.trim().length > 0
    ? response.data
    : response.rawBody.trim().length > 0
      ? response.rawBody
      : `${response.status} ${response.statusText}`;

  return new BridgeError("BACKEND_ERROR", `Plugin backend request failed for ${path}: ${body}`);
}

function normalizeActorListEnvelope(payload: unknown, context: string): ActorSummary[] {
  if (!isRecord(payload) || !Array.isArray(payload.actors)) {
    throw new BridgeError("BACKEND_ERROR", `Plugin ${context} response did not return an actors array.`);
  }

  return payload.actors.map((entry, index) => normalizeActorSummary(entry, index));
}

function normalizeActorSummary(entry: unknown, index: number): ActorSummary {
  if (!isRecord(entry)) {
    throw new BridgeError("BACKEND_ERROR", `Plugin actor response returned a malformed actor at index ${index}.`);
  }

  const actorName = typeof entry.actorName === "string" ? entry.actorName : null;
  const className = typeof entry.className === "string" ? entry.className : null;
  const objectPath = typeof entry.objectPath === "string" ? entry.objectPath : null;
  const actorLabel = typeof entry.actorLabel === "string" && entry.actorLabel.length > 0 ? entry.actorLabel : undefined;
  const selected = typeof entry.selected === "boolean" ? entry.selected : undefined;

  if (!actorName || !className || !objectPath) {
    throw new BridgeError("BACKEND_ERROR", `Plugin actor response returned an incomplete actor at index ${index}.`);
  }

  return {
    ...(actorLabel ? { actorLabel } : {}),
    ...(selected !== undefined ? { selected } : {}),
    actorName,
    className,
    objectPath
  };
}

function normalizeActorTransformResult(payload: unknown, context: string): SpawnActorResult {
  if (!isRecord(payload) || !isRecord(payload.location) || !isRecord(payload.rotation)) {
    throw new BridgeError("BACKEND_ERROR", `Plugin ${context} response returned an unexpected response shape.`);
  }

  return {
    ...normalizeActorSummary(payload, 0),
    location: normalizeVector3(payload.location, "location"),
    rotation: {
      pitch: requireNumber(payload.rotation.pitch, "rotation.pitch"),
      yaw: requireNumber(payload.rotation.yaw, "rotation.yaw"),
      roll: requireNumber(payload.rotation.roll, "rotation.roll")
    }
  };
}

function normalizeSelectedActorResult(payload: unknown, context: string): SelectActorResult {
  const actor = normalizeActorSummary(payload, 0);

  if (actor.selected !== true) {
    throw new BridgeError("BACKEND_ERROR", `Plugin ${context} response did not mark the actor as selected.`);
  }

  return {
    ...actor,
    selected: true
  };
}

function normalizeDestroyedActorResult(payload: unknown, context: string): DestroyActorResult {
  if (!isRecord(payload) || payload.destroyed !== true) {
    throw new BridgeError("BACKEND_ERROR", `Plugin ${context} response did not confirm destruction.`);
  }

  return {
    ...normalizeActorSummary(payload, 0),
    destroyed: true
  };
}

function normalizeOutputLogEnvelope(payload: unknown): OutputLogEntry[] {
  if (!isRecord(payload) || !Array.isArray(payload.entries)) {
    throw new BridgeError("BACKEND_ERROR", "Plugin output log response did not return an entries array.");
  }

  return payload.entries.map((entry, index) => {
    if (!isRecord(entry)
      || typeof entry.timestamp !== "string"
      || !isLogLevel(entry.level)
      || typeof entry.category !== "string"
      || typeof entry.message !== "string") {
      throw new BridgeError("BACKEND_ERROR", `Plugin output log response returned an invalid entry at index ${index}.`);
    }

    return {
      timestamp: entry.timestamp,
      level: entry.level,
      category: entry.category,
      message: entry.message
    };
  });
}

function normalizeEditorDiagnosticsEnvelope(payload: unknown): EditorDiagnostic[] {
  if (!isRecord(payload) || !Array.isArray(payload.diagnostics)) {
    throw new BridgeError("BACKEND_ERROR", "Plugin diagnostics response did not return a diagnostics array.");
  }

  return payload.diagnostics.map((entry, index) => {
    if (!isRecord(entry)
      || typeof entry.source !== "string"
      || !isDiagnosticSeverity(entry.severity)
      || typeof entry.category !== "string"
      || typeof entry.message !== "string") {
      throw new BridgeError("BACKEND_ERROR", `Plugin diagnostics response returned an invalid diagnostic at index ${index}.`);
    }

    return {
      source: entry.source,
      severity: entry.severity,
      category: entry.category,
      message: entry.message,
      ...(typeof entry.filePath === "string" ? { filePath: entry.filePath } : {}),
      ...(typeof entry.line === "number" ? { line: entry.line } : {}),
      ...(typeof entry.column === "number" ? { column: entry.column } : {})
    };
  });
}

function normalizeEditorState(payload: unknown): EditorState {
  if (!isRecord(payload)
    || !isRecord(payload.liveCoding)
    || !isRecord(payload.capabilityReadiness)
    || (payload.projectName !== null && typeof payload.projectName !== "string")
    || (payload.currentMap !== null && typeof payload.currentMap !== "string")
    || typeof payload.pieActive !== "boolean") {
    throw new BridgeError("BACKEND_ERROR", "Plugin editor state response returned an unexpected response shape.");
  }

  return {
    projectName: payload.projectName as string | null,
    currentMap: payload.currentMap as string | null,
    pieActive: payload.pieActive,
    liveCoding: normalizeLiveCodingStatus(payload.liveCoding),
    capabilityReadiness: Object.fromEntries(
      Object.entries(payload.capabilityReadiness).map(([key, value]) => [key, value === true])
    )
  };
}

function normalizeLiveCodingStatus(payload: unknown): LiveCodingStatus {
  if (!isRecord(payload)
    || typeof payload.available !== "boolean"
    || typeof payload.enabled !== "boolean"
    || typeof payload.busy !== "boolean"
    || typeof payload.lastResult !== "string"
    || typeof payload.message !== "string") {
    throw new BridgeError("BACKEND_ERROR", "Plugin live coding status returned an unexpected response shape.");
  }

  return {
    available: payload.available,
    enabled: payload.enabled,
    busy: payload.busy,
    lastResult: normalizeLiveCodingResult(payload.lastResult),
    message: payload.message
  };
}

function normalizeViewportScreenshot(payload: unknown): ViewportScreenshotResult {
  if (!isRecord(payload)
    || typeof payload.mimeType !== "string"
    || typeof payload.dataBase64 !== "string"
    || typeof payload.width !== "number"
    || typeof payload.height !== "number") {
    throw new BridgeError("BACKEND_ERROR", "Plugin viewport screenshot response returned an unexpected response shape.");
  }

  return {
    ...normalizeViewportCameraState(payload),
    mimeType: payload.mimeType,
    dataBase64: payload.dataBase64,
    width: payload.width,
    height: payload.height,
    ...(typeof payload.savedPath === "string" ? { savedPath: payload.savedPath } : {})
  };
}

function normalizeViewportCameraState(payload: unknown): ViewportCameraState {
  if (!isRecord(payload)
    || typeof payload.capturedAt !== "string"
    || payload.source !== "active_viewport"
    || (payload.projectName !== null && typeof payload.projectName !== "string")
    || (payload.currentMap !== null && typeof payload.currentMap !== "string")
    || typeof payload.pieActive !== "boolean"
    || !isRecord(payload.viewport)
    || !isRecord(payload.camera)
    || !isRecord(payload.camera.location)
    || !isRecord(payload.camera.rotation)) {
    throw new BridgeError("BACKEND_ERROR", "Plugin viewport camera response returned an unexpected response shape.");
  }

  return {
    capturedAt: payload.capturedAt,
    source: "active_viewport",
    projectName: payload.projectName as string | null,
    currentMap: payload.currentMap as string | null,
    pieActive: payload.pieActive,
    viewport: {
      type: requireString(payload.viewport.type, "viewport.type"),
      viewMode: requireString(payload.viewport.viewMode, "viewport.viewMode"),
      realtime: requireBoolean(payload.viewport.realtime, "viewport.realtime"),
      width: requireNumber(payload.viewport.width, "viewport.width"),
      height: requireNumber(payload.viewport.height, "viewport.height"),
      ...(isRecord(payload.viewport.crop)
        ? {
            crop: {
              x: requireNumber(payload.viewport.crop.x, "viewport.crop.x"),
              y: requireNumber(payload.viewport.crop.y, "viewport.crop.y"),
              width: requireNumber(payload.viewport.crop.width, "viewport.crop.width"),
              height: requireNumber(payload.viewport.crop.height, "viewport.crop.height")
            }
          }
        : {})
    },
    camera: {
      location: {
        x: requireNumber(payload.camera.location.x, "camera.location.x"),
        y: requireNumber(payload.camera.location.y, "camera.location.y"),
        z: requireNumber(payload.camera.location.z, "camera.location.z")
      },
      rotation: {
        pitch: requireNumber(payload.camera.rotation.pitch, "camera.rotation.pitch"),
        yaw: requireNumber(payload.camera.rotation.yaw, "camera.rotation.yaw"),
        roll: requireNumber(payload.camera.rotation.roll, "camera.rotation.roll")
      }
    }
  };
}

function normalizeFrameActorResult(payload: unknown): FrameActorResult {
  if (!isRecord(payload)
    || typeof payload.activeViewportOnly !== "boolean"
    || !isRecord(payload.target)) {
    throw new BridgeError("BACKEND_ERROR", "Plugin frame actor response returned an unexpected response shape.");
  }

  return {
    ...normalizeViewportCameraState(payload),
    activeViewportOnly: payload.activeViewportOnly,
    target: normalizeActorSummary(payload.target, 0)
  };
}

function normalizeDebugDrawState(payload: unknown): DebugDrawStateResult {
  if (!isRecord(payload)
    || typeof payload.capturedAt !== "string"
    || (payload.projectName !== null && typeof payload.projectName !== "string")
    || (payload.currentMap !== null && typeof payload.currentMap !== "string")
    || !Array.isArray(payload.lines)
    || !Array.isArray(payload.points)
    || !isRecord(payload.summary)
    || !isRecord(payload.summary.batchers)) {
    throw new BridgeError("BACKEND_ERROR", "Plugin debug draw state returned an unexpected response shape.");
  }

  return {
    capturedAt: payload.capturedAt,
    projectName: payload.projectName as string | null,
    currentMap: payload.currentMap as string | null,
    lines: payload.lines.map((entry, index) => normalizeDebugDrawLine(entry, index)),
    points: payload.points.map((entry, index) => normalizeDebugDrawPoint(entry, index)),
    summary: {
      totalLines: requireNumber(payload.summary.totalLines, "summary.totalLines"),
      totalPoints: requireNumber(payload.summary.totalPoints, "summary.totalPoints"),
      sampledLines: requireNumber(payload.summary.sampledLines, "summary.sampledLines"),
      sampledPoints: requireNumber(payload.summary.sampledPoints, "summary.sampledPoints"),
      batchers: Object.fromEntries(
        Object.entries(payload.summary.batchers).map(([key, value]) => {
          if (!isRecord(value)) {
            throw new BridgeError("BACKEND_ERROR", `Plugin debug draw summary returned an invalid batcher entry for ${key}.`);
          }

          return [key, {
            lines: requireNumber(value.lines, `${key}.lines`),
            points: requireNumber(value.points, `${key}.points`)
          }];
        })
      )
    }
  };
}

function normalizeDebugDrawLine(entry: unknown, index: number): DebugDrawStateResult["lines"][number] {
  if (!isRecord(entry)
    || typeof entry.batcher !== "string"
    || !isRecord(entry.start)
    || !isRecord(entry.end)
    || !isRecord(entry.color)) {
    throw new BridgeError("BACKEND_ERROR", `Plugin debug draw state returned an invalid line at index ${index}.`);
  }

  return {
    batcher: entry.batcher,
    start: normalizeVector3(entry.start, `lines[${index}].start`),
    end: normalizeVector3(entry.end, `lines[${index}].end`),
    color: normalizeColor4(entry.color, `lines[${index}].color`),
    thickness: requireNumber(entry.thickness, `lines[${index}].thickness`),
    remainingLifeTime: requireNumber(entry.remainingLifeTime, `lines[${index}].remainingLifeTime`),
    depthPriority: requireNumber(entry.depthPriority, `lines[${index}].depthPriority`),
    batchId: requireNumber(entry.batchId, `lines[${index}].batchId`),
    length: requireNumber(entry.length, `lines[${index}].length`)
  };
}

function normalizeDebugDrawPoint(entry: unknown, index: number): DebugDrawStateResult["points"][number] {
  if (!isRecord(entry)
    || typeof entry.batcher !== "string"
    || !isRecord(entry.position)
    || !isRecord(entry.color)) {
    throw new BridgeError("BACKEND_ERROR", `Plugin debug draw state returned an invalid point at index ${index}.`);
  }

  return {
    batcher: entry.batcher,
    position: normalizeVector3(entry.position, `points[${index}].position`),
    color: normalizeColor4(entry.color, `points[${index}].color`),
    pointSize: requireNumber(entry.pointSize, `points[${index}].pointSize`),
    remainingLifeTime: requireNumber(entry.remainingLifeTime, `points[${index}].remainingLifeTime`),
    depthPriority: requireNumber(entry.depthPriority, `points[${index}].depthPriority`),
    batchId: requireNumber(entry.batchId, `points[${index}].batchId`)
  };
}

function normalizeConsoleCommandResult(payload: unknown, requestedCommandId: string): ConsoleCommandResult {
  if (!isRecord(payload)
    || payload.accepted !== true
    || typeof payload.commandId !== "string"
    || typeof payload.executedCommand !== "string"
    || typeof payload.message !== "string") {
    throw new BridgeError("BACKEND_ERROR", "Plugin console command response returned an unexpected response shape.");
  }

  if (payload.commandId !== requestedCommandId) {
    throw new BridgeError("BACKEND_ERROR", `Plugin console command returned a mismatched commandId: ${payload.commandId}.`);
  }

  return {
    commandId: payload.commandId,
    accepted: true,
    executedCommand: payload.executedCommand,
    message: payload.message
  };
}

function normalizeLiveCodingResult(value: string): LiveCodingStatus["lastResult"] {
  switch (value) {
    case "success":
    case "no_changes":
    case "in_progress":
    case "busy":
    case "not_started":
    case "failure":
    case "cancelled":
    case "unknown":
      return value;
    default:
      return "unknown";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== "string") {
    throw new BridgeError("BACKEND_ERROR", `Plugin viewport screenshot response returned an invalid ${fieldName}.`);
  }

  return value;
}

function requireNumber(value: unknown, fieldName: string): number {
  if (typeof value !== "number") {
    throw new BridgeError("BACKEND_ERROR", `Plugin viewport screenshot response returned an invalid ${fieldName}.`);
  }

  return value;
}

function requireBoolean(value: unknown, fieldName: string): boolean {
  if (typeof value !== "boolean") {
    throw new BridgeError("BACKEND_ERROR", `Plugin viewport screenshot response returned an invalid ${fieldName}.`);
  }

  return value;
}

function normalizeVector3(value: Record<string, unknown>, fieldName: string) {
  return {
    x: requireNumber(value.x, `${fieldName}.x`),
    y: requireNumber(value.y, `${fieldName}.y`),
    z: requireNumber(value.z, `${fieldName}.z`)
  };
}

function normalizeColor4(value: Record<string, unknown>, fieldName: string) {
  return {
    r: requireNumber(value.r, `${fieldName}.r`),
    g: requireNumber(value.g, `${fieldName}.g`),
    b: requireNumber(value.b, `${fieldName}.b`),
    a: requireNumber(value.a, `${fieldName}.a`)
  };
}

function isLogLevel(value: unknown): value is OutputLogEntry["level"] {
  return value === "Verbose"
    || value === "Log"
    || value === "Display"
    || value === "Warning"
    || value === "Error";
}

function isDiagnosticSeverity(value: unknown): value is EditorDiagnostic["severity"] {
  return value === "Info" || value === "Warning" || value === "Error";
}

function onlyUnique(value: string, index: number, array: string[]): boolean {
  return array.indexOf(value) === index;
}
