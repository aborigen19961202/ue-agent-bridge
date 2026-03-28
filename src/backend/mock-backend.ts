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
  ViewportCameraState,
  ViewportScreenshotInput,
  ViewportScreenshotResult
} from "../types/domain.js";
import { BridgeError } from "../utils/errors.js";
import { resolveSafeConsoleCommand } from "../tools/console-command-policy.js";
import { UnrealBackend } from "./unreal-backend.js";

interface MockActorRecord extends ActorSummary {
  classPath: string;
  properties: Record<string, unknown>;
}

interface MockSpawnClassRecord {
  className: string;
  classPath: string;
  allowSpawn: boolean;
  rejectReason?: string | undefined;
}

const MOCK_ACTORS: MockActorRecord[] = [
  {
    actorLabel: "SM_Chair_01",
    actorName: "SM_Chair_01",
    className: "StaticMeshActor",
    classPath: "/Script/Engine.StaticMeshActor",
    objectPath: "/Game/Maps/TestMap.TestMap:PersistentLevel.SM_Chair_01",
    selected: true,
    properties: {
      RelativeLocation: { x: 120, y: 20, z: 0 },
      Mobility: "Static",
      HiddenInGame: false
    }
  },
  {
    actorLabel: "PointLight_01",
    actorName: "PointLight_01",
    className: "PointLight",
    classPath: "/Script/Engine.PointLight",
    objectPath: "/Game/Maps/TestMap.TestMap:PersistentLevel.PointLight_01",
    selected: true,
    properties: {
      Intensity: 2500,
      LightColor: { r: 255, g: 244, b: 214, a: 255 },
      HiddenInGame: false
    }
  },
  {
    actorLabel: "BP_Door_01",
    actorName: "BP_Door_01",
    className: "BP_Door_C",
    classPath: "/Game/Blueprints/Interactables/BP_Door.BP_Door_C",
    objectPath: "/Game/Maps/TestMap.TestMap:PersistentLevel.BP_Door_01",
    selected: false,
    properties: {
      OpenAngle: 90,
      Locked: false
    }
  }
];

const MOCK_ASSETS: AssetSummary[] = [
  {
    assetName: "SM_Chair",
    assetPath: "/Game/Props/Furniture/SM_Chair.SM_Chair",
    assetClass: "StaticMesh"
  },
  {
    assetName: "MI_Wood_Oak",
    assetPath: "/Game/Materials/Wood/MI_Wood_Oak.MI_Wood_Oak",
    assetClass: "MaterialInstanceConstant"
  },
  {
    assetName: "BP_Door",
    assetPath: "/Game/Blueprints/Interactables/BP_Door.BP_Door",
    assetClass: "Blueprint"
  }
];

const MOCK_LOGS: OutputLogEntry[] = [
  {
    timestamp: "2026-03-11T10:00:00Z",
    level: "Display",
    category: "LogInit",
    message: "Editor session ready."
  },
  {
    timestamp: "2026-03-11T10:01:12Z",
    level: "Warning",
    category: "LogLighting",
    message: "PointLight_01 exceeds recommended stationary overlap count."
  },
  {
    timestamp: "2026-03-11T10:02:05Z",
    level: "Error",
    category: "LogBlueprint",
    message: "BP_Door compile warning promoted to error in mock environment."
  }
];

const MOCK_DIAGNOSTICS: EditorDiagnostic[] = [
  {
    source: "OutputLog",
    severity: "Warning",
    category: "LogLighting",
    message: "PointLight_01 exceeds recommended stationary overlap count."
  },
  {
    source: "LiveCoding",
    severity: "Error",
    category: "LogLiveCoding",
    message: "Compile warning promoted to error in mock environment.",
    filePath: "Source/CleanModelFactory/CleanModelFactory.cpp",
    line: 12,
    column: 3
  }
];

const MOCK_VIEWPORT_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jk6cAAAAASUVORK5CYII=";

const MOCK_DEBUG_DRAW_STATE: DebugDrawStateResult = {
  capturedAt: "2026-03-11T10:05:03Z",
  projectName: "MockProject",
  currentMap: "/Game/Maps/TestMap",
  lines: [
    {
      batcher: "world_persistent",
      start: { x: 0, y: 0, z: 0 },
      end: { x: 100, y: 0, z: 50 },
      color: { r: 1, g: 0, b: 0, a: 1 },
      thickness: 2,
      remainingLifeTime: 5,
      depthPriority: 0,
      batchId: 42,
      length: 111.80339887498948
    }
  ],
  points: [
    {
      batcher: "foreground",
      position: { x: 100, y: 0, z: 50 },
      color: { r: 0, g: 1, b: 0, a: 1 },
      pointSize: 8,
      remainingLifeTime: 3,
      depthPriority: 1,
      batchId: 77
    }
  ],
  summary: {
    totalLines: 1,
    totalPoints: 1,
    sampledLines: 1,
    sampledPoints: 1,
    batchers: {
      world_persistent: { lines: 1, points: 0 },
      foreground: { lines: 0, points: 1 }
    }
  }
};

const MOCK_NATIVE_SPAWN_FAST_PATHS = new Map<string, string>([
  ["StaticMeshActor", "/Script/Engine.StaticMeshActor"],
  ["PointLight", "/Script/Engine.PointLight"],
  ["SpotLight", "/Script/Engine.SpotLight"],
  ["DirectionalLight", "/Script/Engine.DirectionalLight"],
  ["SkyLight", "/Script/Engine.SkyLight"],
  ["CameraActor", "/Script/Engine.CameraActor"],
  ["PlayerStart", "/Script/Engine.PlayerStart"],
  ["TargetPoint", "/Script/Engine.TargetPoint"],
  ["TriggerBox", "/Script/Engine.TriggerBox"]
] as const);

const MOCK_ALLOWED_PROJECT_SPAWN_SCOPES = [
  "MockProject",
  "CleanModelFactory",
  "ModelFactory",
  "ModelFactoryGrape"
] as const;

const MOCK_SPAWN_CLASS_REGISTRY: MockSpawnClassRecord[] = [
  {
    className: "GrapeRachisActor",
    classPath: "/Script/ModelFactoryGrape.GrapeRachisActor",
    allowSpawn: true
  },
  {
    className: "CleanFactoryActor",
    classPath: "/Script/CleanModelFactory.CleanFactoryActor",
    allowSpawn: true
  },
  {
    className: "BP_GrapeRachis_C",
    classPath: "/Game/Blueprints/Grape/BP_GrapeRachis.BP_GrapeRachis_C",
    allowSpawn: true
  },
  {
    className: "AbstractVineActor",
    classPath: "/Script/ModelFactory.AbstractVineActor",
    allowSpawn: false,
    rejectReason: "class is abstract"
  },
  {
    className: "DataAsset",
    classPath: "/Script/Engine.DataAsset",
    allowSpawn: false,
    rejectReason: "class is not an AActor subclass"
  }
];

const LOG_LEVEL_ORDER = {
  Verbose: 10,
  Log: 20,
  Display: 30,
  Warning: 40,
  Error: 50
} as const;

export class MockUnrealBackend implements UnrealBackend {
  public readonly name = "mock";
  private readonly actors: MockActorRecord[];
  private readonly assets: AssetSummary[];
  private readonly logs: OutputLogEntry[];
  private viewportCamera: ViewportCameraState["camera"];

  public constructor() {
    this.actors = structuredClone(MOCK_ACTORS);
    this.assets = structuredClone(MOCK_ASSETS);
    this.logs = structuredClone(MOCK_LOGS);
    this.viewportCamera = {
      location: { x: 0, y: 0, z: 150 },
      rotation: { pitch: -15, yaw: 45, roll: 0 }
    };
  }

  public async healthcheck(): Promise<HealthcheckResult> {
    return {
      backend: "mock",
      connected: true,
      mode: "mock",
      transport: "in-memory",
      message: "Mock backend is active. Unreal Editor is not required.",
      capabilities: [
        "ue_healthcheck",
        "ue_get_selected_actors",
        "ue_get_level_actors",
        "ue_get_property",
        "ue_set_property",
        "ue_asset_search",
        "ue_get_output_log",
        "ue_get_editor_diagnostics",
        "ue_get_editor_state",
        "ue_get_viewport_camera",
        "ue_set_viewport_camera",
        "ue_spawn_actor_safe",
        "ue_select_actor_safe",
        "ue_destroy_actor_safe",
        "ue_frame_actor",
        "ue_get_viewport_screenshot",
        "ue_capture_actor_screenshot",
        "ue_get_debug_draw_state",
        "ue_get_live_coding_status",
        "ue_trigger_live_coding_build_safe",
        "ue_run_console_command_safe"
      ],
      readiness: {
        backendReachable: true,
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

  public async getSelectedActors(): Promise<ActorSummary[]> {
    return this.actors.filter((actor) => actor.selected).map(stripActorProperties);
  }

  public async getLevelActors(input: GetLevelActorsInput): Promise<ActorSummary[]> {
    return this.actors
      .filter((actor) => matchesActorFilter(actor, input))
      .slice(0, input.limit ?? 100)
      .map(stripActorProperties);
  }

  public async getProperty(input: GetPropertyInput): Promise<PropertyReadResult> {
    const actor = this.findActor(input);
    const value = actor.properties[input.propertyName];

    if (value === undefined) {
      throw new BridgeError("NOT_FOUND", `Property not found: ${input.propertyName}`);
    }

    return {
      target: input.target,
      propertyName: input.propertyName,
      value: structuredClone(value) as PropertyReadResult["value"]
    };
  }

  public async setProperty(input: SetPropertyInput): Promise<PropertyWriteResult> {
    const actor = this.findActor(input);
    actor.properties[input.propertyName] = structuredClone(input.value);
    this.logs.push({
      timestamp: new Date().toISOString(),
      level: "Log",
      category: "LogUEAgentBridge",
      message: `Property ${input.propertyName} updated on ${actor.actorName}.`
    });

    return {
      target: input.target,
      propertyName: input.propertyName,
      value: structuredClone(input.value),
      changed: true
    };
  }

  public async assetSearch(input: AssetSearchInput): Promise<AssetSummary[]> {
    const query = input.query?.toLowerCase();
    const pathPrefix = input.pathPrefix?.toLowerCase();
    const assetClass = input.assetClass?.toLowerCase();

    return this.assets
      .filter((asset) => {
        if (query && !`${asset.assetName} ${asset.assetPath}`.toLowerCase().includes(query)) {
          return false;
        }

        if (pathPrefix && !asset.assetPath.toLowerCase().startsWith(pathPrefix)) {
          return false;
        }

        if (assetClass && asset.assetClass.toLowerCase() !== assetClass) {
          return false;
        }

        return true;
      })
      .slice(0, input.limit ?? 50);
  }

  public async getOutputLog(input: GetOutputLogInput): Promise<OutputLogEntry[]> {
    const threshold = LOG_LEVEL_ORDER[input.minLevel ?? "Log"];

    return this.logs
      .filter((entry) => LOG_LEVEL_ORDER[entry.level] >= threshold)
      .slice(-(input.limit ?? 50));
  }

  public async getEditorDiagnostics(input: GetEditorDiagnosticsInput): Promise<EditorDiagnostic[]> {
    const threshold = diagnosticSeverityRank(input.minSeverity ?? "Info");

    return MOCK_DIAGNOSTICS
      .filter((entry) => diagnosticSeverityRank(entry.severity) >= threshold)
      .slice(-(input.limit ?? 50))
      .map((entry) => structuredClone(entry));
  }

  public async getEditorState(): Promise<EditorState> {
    return {
      projectName: "MockProject",
      currentMap: "/Game/Maps/TestMap",
      pieActive: false,
      liveCoding: await this.getLiveCodingStatus(),
      capabilityReadiness: {
        ue_get_selected_actors: true,
        ue_get_level_actors: true,
        ue_get_output_log: true,
        ue_get_editor_diagnostics: true,
        ue_get_editor_state: true,
        ue_get_viewport_camera: true,
        ue_set_viewport_camera: true,
        ue_spawn_actor_safe: true,
        ue_select_actor_safe: true,
        ue_destroy_actor_safe: true,
        ue_frame_actor: true,
        ue_get_viewport_screenshot: true,
        ue_capture_actor_screenshot: true,
        ue_get_debug_draw_state: true,
        ue_get_live_coding_status: true,
        ue_trigger_live_coding_build_safe: true,
        ue_run_console_command_safe: true
      }
    };
  }

  public async getViewportScreenshot(_input: ViewportScreenshotInput): Promise<ViewportScreenshotResult> {
    return {
      ...this.buildViewportCameraState(),
      mimeType: "image/png",
      dataBase64: MOCK_VIEWPORT_PNG_BASE64,
      width: 1,
      height: 1,
      viewport: {
        ...this.buildViewportCameraState().viewport,
        width: 1,
        height: 1
      }
    };
  }

  public async getViewportCamera(): Promise<ViewportCameraState> {
    return this.buildViewportCameraState();
  }

  public async setViewportCamera(input: SetViewportCameraInput): Promise<ViewportCameraState> {
    this.viewportCamera = structuredClone({
      location: input.location,
      rotation: input.rotation
    });

    return this.buildViewportCameraState();
  }

  public async spawnActor(input: SpawnActorInput): Promise<SpawnActorResult> {
    const resolvedClass = normalizeMockSpawnClass(input);
    const actorLabel = input.label?.trim() || `${resolvedClass.className}_${String(this.actors.length + 1).padStart(2, "0")}`;
    const actorName = makeUniqueActorName(actorLabel, this.actors);
    const actor: MockActorRecord = {
      actorLabel,
      actorName,
      className: resolvedClass.className,
      classPath: resolvedClass.classPath,
      objectPath: `/Game/Maps/TestMap.TestMap:PersistentLevel.${actorName}`,
      selected: input.selectAfterSpawn ?? false,
      properties: {
        RelativeLocation: structuredClone(input.location),
        RelativeRotation: structuredClone(input.rotation),
        HiddenInGame: false
      }
    };

    if (input.selectAfterSpawn) {
      clearSelected(this.actors);
    }

    this.actors.push(actor);

    return {
      ...stripActorProperties(actor),
      location: structuredClone(input.location),
      rotation: structuredClone(input.rotation)
    };
  }

  public async selectActor(input: SelectActorInput): Promise<SelectActorResult> {
    const actor = this.findActor({
      target: input.target,
      propertyName: "RelativeLocation"
    });

    clearSelected(this.actors);
    actor.selected = true;

    return {
      ...stripActorProperties(actor),
      selected: true
    };
  }

  public async destroyActor(input: DestroyActorInput): Promise<DestroyActorResult> {
    const actor = this.findActor({
      target: input.target,
      propertyName: "RelativeLocation"
    });

    const destroyPolicy = classifyMockSpawnClass({
      className: actor.className,
      classPath: actor.classPath
    });
    if (!destroyPolicy.allowSpawn) {
      throw new BridgeError("UNSAFE_MUTATION", `Destroy-safe only supports actors inside the allowed project/plugin spawn scope: ${destroyPolicy.rejectReason ?? "class is outside the allowed project/plugin spawn scope"}.`);
    }

    const actorIndex = this.actors.findIndex((candidate) => candidate.objectPath === actor.objectPath);

    if (actorIndex < 0) {
      throw new BridgeError("NOT_FOUND", "Target actor not found.");
    }

    const snapshot = stripActorProperties(actor);
    this.actors.splice(actorIndex, 1);

    return {
      ...snapshot,
      destroyed: true
    };
  }

  public async frameActor(input: FrameActorInput): Promise<FrameActorResult> {
    const actor = this.findActor({
      target: input.target,
      propertyName: "RelativeLocation"
    });
    const relativeLocation = actor.properties.RelativeLocation;
    const actorLocation = isVector3(relativeLocation)
      ? relativeLocation
      : { x: 0, y: 0, z: 0 };

    this.viewportCamera = {
      location: {
        x: actorLocation.x + 600,
        y: actorLocation.y - 600,
        z: actorLocation.z + 400
      },
      rotation: {
        pitch: -20,
        yaw: 135,
        roll: 0
      }
    };

    return {
      ...this.buildViewportCameraState(),
      target: stripActorProperties(actor),
      activeViewportOnly: input.activeViewportOnly ?? true
    };
  }

  public async getDebugDrawState(input: GetDebugDrawStateInput): Promise<DebugDrawStateResult> {
    const points = input.includePoints === false ? [] : structuredClone(MOCK_DEBUG_DRAW_STATE.points);

    return {
      ...structuredClone(MOCK_DEBUG_DRAW_STATE),
      lines: structuredClone(MOCK_DEBUG_DRAW_STATE.lines).slice(0, input.limit ?? 50),
      points,
      summary: {
        ...structuredClone(MOCK_DEBUG_DRAW_STATE.summary),
        sampledLines: Math.min(MOCK_DEBUG_DRAW_STATE.lines.length, input.limit ?? 50),
        sampledPoints: points.length
      }
    };
  }

  public async getLiveCodingStatus(): Promise<LiveCodingStatus> {
    return {
      available: true,
      enabled: true,
      busy: false,
      lastResult: "success",
      message: "Mock Live Coding is ready."
    };
  }

  public async triggerLiveCodingBuild() {
    this.logs.push({
      timestamp: new Date().toISOString(),
      level: "Display",
      category: "LogLiveCoding",
      message: "Mock Live Coding compile triggered."
    });

    return {
      accepted: true,
      status: await this.getLiveCodingStatus()
    };
  }

  public async runConsoleCommand(input: RunConsoleCommandInput): Promise<ConsoleCommandResult> {
    const command = resolveSafeConsoleCommand(input.commandId);

    this.logs.push({
      timestamp: new Date().toISOString(),
      level: "Display",
      category: "LogConsoleResponse",
      message: `Executed safe mock console command: ${command.unrealCommand}`
    });

    return {
      commandId: command.commandId,
      accepted: true,
      executedCommand: command.unrealCommand,
      message: "Command executed in mock backend."
    };
  }

  private findActor(input: GetPropertyInput): MockActorRecord {
    const actor = this.actors.find((candidate) => {
      if (input.target.objectPath && candidate.objectPath === input.target.objectPath) {
        return true;
      }

      if (input.target.actorName && candidate.actorName === input.target.actorName) {
        return true;
      }

      return false;
    });

    if (!actor) {
      throw new BridgeError("NOT_FOUND", "Target actor not found.");
    }

    return actor;
  }

  private buildViewportCameraState(): ViewportCameraState {
    return {
      capturedAt: "2026-03-11T10:05:00Z",
      source: "active_viewport",
      projectName: "MockProject",
      currentMap: "/Game/Maps/TestMap",
      pieActive: false,
      viewport: {
        type: "perspective",
        viewMode: "lit",
        realtime: true,
        width: 1,
        height: 1
      },
      camera: structuredClone(this.viewportCamera)
    };
  }
}

function stripActorProperties(actor: MockActorRecord): ActorSummary {
  return {
    actorLabel: actor.actorLabel,
    actorName: actor.actorName,
    className: actor.className,
    objectPath: actor.objectPath,
    selected: actor.selected
  };
}

function matchesActorFilter(actor: ActorSummary, input: GetLevelActorsInput): boolean {
  if (input.className && actor.className !== input.className) {
    return false;
  }

  if (input.nameContains && !actor.actorName.toLowerCase().includes(input.nameContains.toLowerCase())) {
    return false;
  }

  return true;
}

function diagnosticSeverityRank(severity: EditorDiagnostic["severity"]): number {
  switch (severity) {
    case "Info":
      return 10;
    case "Warning":
      return 20;
    case "Error":
      return 30;
  }
}

function isVector3(value: unknown): value is { x: number; y: number; z: number } {
  return typeof value === "object"
    && value !== null
    && typeof (value as { x?: unknown }).x === "number"
    && typeof (value as { y?: unknown }).y === "number"
    && typeof (value as { z?: unknown }).z === "number";
}

function clearSelected(actors: MockActorRecord[]): void {
  for (const actor of actors) {
    actor.selected = false;
  }
}

function normalizeMockSpawnClass(input: SpawnActorInput): { className: string; classPath: string } {
  if (input.classPath) {
    const resolved = classifyMockSpawnClass({
      className: input.className,
      classPath: input.classPath
    });

    if (!resolved.allowSpawn) {
      throw new BridgeError("UNSAFE_MUTATION", `Resolved class ${input.classPath} is not allowed for spawn-safe: ${resolved.rejectReason ?? "class is outside the allowed project/plugin spawn scope"}.`);
    }

    return {
      className: resolved.className,
      classPath: resolved.classPath
    };
  }

  if (!input.className) {
    throw new BridgeError("VALIDATION_ERROR", "Spawn-safe requires className or classPath.");
  }

  const preferredClassPath = MOCK_NATIVE_SPAWN_FAST_PATHS.get(input.className);
  if (preferredClassPath) {
    return {
      className: input.className,
      classPath: preferredClassPath
    };
  }

  const matches = MOCK_SPAWN_CLASS_REGISTRY.filter((entry) => entry.className === input.className);
  if (matches.length === 1) {
    const match = matches[0]!;
    if (!match.allowSpawn) {
      throw new BridgeError("UNSAFE_MUTATION", `Resolved class ${match.classPath} is not allowed for spawn-safe: ${match.rejectReason ?? "class is outside the allowed project/plugin spawn scope"}.`);
    }

    return {
      className: match.className,
      classPath: match.classPath
    };
  }

  if (matches.length > 1) {
    throw new BridgeError("VALIDATION_ERROR", `className resolves to multiple allowed mock classes. Provide classPath instead: ${input.className}`);
  }

  throw new BridgeError(
    "UNSAFE_MUTATION",
    `className could not be resolved inside the allowed project/plugin spawn scope in the mock backend: ${input.className}. Provide classPath for project Blueprint actor classes.`
  );
}

function classifyMockSpawnClass(input: { className?: string | undefined; classPath: string }): MockSpawnClassRecord {
  const nativeEntry = Array.from(MOCK_NATIVE_SPAWN_FAST_PATHS.entries()).find(([, classPath]) => classPath === input.classPath);
  if (nativeEntry) {
    return {
      className: nativeEntry[0],
      classPath: nativeEntry[1],
      allowSpawn: true
    };
  }

  const registryEntry = MOCK_SPAWN_CLASS_REGISTRY.find((entry) => entry.classPath === input.classPath);
  if (registryEntry) {
    return registryEntry;
  }

  if (input.classPath.startsWith("/Game/")) {
    return {
      className: input.className ?? classNameFromPath(input.classPath),
      classPath: input.classPath,
      allowSpawn: true
    };
  }

  const allowedPrefix = MOCK_ALLOWED_PROJECT_SPAWN_SCOPES.find((scope) => input.classPath.startsWith(`/Script/${scope}.`));
  if (allowedPrefix) {
    return {
      className: input.className ?? classNameFromPath(input.classPath),
      classPath: input.classPath,
      allowSpawn: true
    };
  }

  return {
    className: input.className ?? classNameFromPath(input.classPath),
    classPath: input.classPath,
    allowSpawn: false,
    rejectReason: `class is outside the allowed project/plugin spawn scope (${MOCK_ALLOWED_PROJECT_SPAWN_SCOPES.join(", ")}, /Game/*)`
  };
}

function classNameFromPath(classPath: string): string {
  const dotIndex = classPath.lastIndexOf(".");
  if (dotIndex >= 0 && dotIndex + 1 < classPath.length) {
    return classPath.slice(dotIndex + 1);
  }

  const slashIndex = classPath.lastIndexOf("/");
  if (slashIndex >= 0 && slashIndex + 1 < classPath.length) {
    return classPath.slice(slashIndex + 1);
  }

  return classPath;
}

function makeUniqueActorName(label: string, actors: MockActorRecord[]): string {
  const sanitized = label.replace(/[^A-Za-z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "") || "Actor";
  let candidate = sanitized;
  let suffix = 1;

  while (actors.some((actor) => actor.actorName === candidate)) {
    suffix += 1;
    candidate = `${sanitized}_${suffix}`;
  }

  return candidate;
}
