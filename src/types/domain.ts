export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue;
}

export interface TargetRef {
  // Canonical identifier for real Remote Control operations.
  objectPath?: string | undefined;
  actorName?: string | undefined;
}

export interface ActorSummary {
  actorLabel?: string | undefined;
  actorName: string;
  className: string;
  objectPath: string;
  selected?: boolean | undefined;
}

export interface AssetSummary {
  assetName: string;
  // Full Unreal asset object path, for example /Game/Foo/Bar.Bar.
  assetPath: string;
  assetClass: string;
}

export type LogLevel = "Verbose" | "Log" | "Display" | "Warning" | "Error";

export interface OutputLogEntry {
  timestamp: string;
  level: LogLevel;
  category: string;
  message: string;
}

export type DiagnosticSeverity = "Info" | "Warning" | "Error";

export interface EditorDiagnostic {
  source: string;
  severity: DiagnosticSeverity;
  category: string;
  message: string;
  filePath?: string | undefined;
  line?: number | undefined;
  column?: number | undefined;
}

export type LiveCodingResult =
  | "unknown"
  | "success"
  | "no_changes"
  | "in_progress"
  | "busy"
  | "not_started"
  | "failure"
  | "cancelled";

export interface LiveCodingStatus {
  available: boolean;
  enabled: boolean;
  busy: boolean;
  lastResult: LiveCodingResult;
  message: string;
}

export interface EditorState {
  projectName: string | null;
  currentMap: string | null;
  pieActive: boolean;
  liveCoding: LiveCodingStatus;
  capabilityReadiness: Record<string, boolean>;
}

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface Rotator3 {
  pitch: number;
  yaw: number;
  roll: number;
}

export interface Color4 {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface ViewportCropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ViewModeOption =
  | "current"
  | "lit"
  | "unlit"
  | "wireframe"
  | "detail_lighting"
  | "lighting_only"
  | "collision_pawn"
  | "collision_visibility";

export interface ViewportScreenshotInput {
  maxDimension?: number | undefined;
  viewMode?: ViewModeOption | undefined;
  crop?: ViewportCropRect | undefined;
}

export interface ViewportCameraState {
  capturedAt: string;
  source: "active_viewport";
  projectName: string | null;
  currentMap: string | null;
  pieActive: boolean;
  viewport: {
    type: string;
    viewMode: string;
    realtime: boolean;
    width: number;
    height: number;
  };
  camera: {
    location: Vector3;
    rotation: Rotator3;
  };
}

export interface SetViewportCameraInput {
  location: Vector3;
  rotation: Rotator3;
}

export interface FrameActorInput {
  target: TargetRef;
  activeViewportOnly?: boolean | undefined;
}

export interface SpawnActorInput {
  className?: string | undefined;
  classPath?: string | undefined;
  location: Vector3;
  rotation: Rotator3;
  selectAfterSpawn?: boolean | undefined;
  label?: string | undefined;
}

export interface SpawnActorResult extends ActorSummary {
  location: Vector3;
  rotation: Rotator3;
}

export interface SelectActorInput {
  target: TargetRef;
}

export interface SelectActorResult extends ActorSummary {
  selected: true;
}

export interface DestroyActorInput {
  target: TargetRef;
}

export interface DestroyActorResult extends ActorSummary {
  destroyed: true;
}

export interface FrameActorResult extends ViewportCameraState {
  target: ActorSummary;
  activeViewportOnly: boolean;
}

export interface ViewportScreenshotResult extends ViewportCameraState {
  mimeType: string;
  dataBase64: string;
  width: number;
  height: number;
  savedPath?: string | undefined;
}

export interface GetDebugDrawStateInput {
  limit?: number | undefined;
  includePoints?: boolean | undefined;
}

export interface DebugDrawLine {
  batcher: string;
  start: Vector3;
  end: Vector3;
  color: Color4;
  thickness: number;
  remainingLifeTime: number;
  depthPriority: number;
  batchId: number;
  length: number;
}

export interface DebugDrawPoint {
  batcher: string;
  position: Vector3;
  color: Color4;
  pointSize: number;
  remainingLifeTime: number;
  depthPriority: number;
  batchId: number;
}

export interface DebugDrawStateResult {
  capturedAt: string;
  projectName: string | null;
  currentMap: string | null;
  lines: DebugDrawLine[];
  points: DebugDrawPoint[];
  summary: {
    totalLines: number;
    totalPoints: number;
    sampledLines: number;
    sampledPoints: number;
    batchers: Record<string, { lines: number; points: number }>;
  };
}

export interface HealthcheckResult {
  backend: "mock" | "remote-control" | "plugin";
  connected: boolean;
  mode: string;
  transport: string;
  message: string;
  capabilities: string[];
  readiness: {
    backendReachable: boolean;
    remoteControlAvailable: boolean;
    preset: {
      name: string | null;
      checked: boolean;
      available: boolean | null;
    };
    helpers: {
      checked: boolean;
      ready: boolean | null;
      required: string[];
      missing: string[];
    };
  };
}

export interface GetLevelActorsInput {
  className?: string | undefined;
  nameContains?: string | undefined;
  limit?: number | undefined;
}

export interface GetPropertyInput {
  target: TargetRef;
  propertyName: string;
}

export interface SetPropertyInput extends GetPropertyInput {
  value: JsonValue;
}

export interface AssetSearchInput {
  query?: string | undefined;
  pathPrefix?: string | undefined;
  assetClass?: string | undefined;
  limit?: number | undefined;
}

export interface GetOutputLogInput {
  minLevel?: LogLevel | undefined;
  limit?: number | undefined;
}

export interface GetEditorDiagnosticsInput {
  minSeverity?: DiagnosticSeverity | undefined;
  limit?: number | undefined;
}

export interface RunConsoleCommandInput {
  commandId: string;
}

export interface PropertyReadResult {
  target: TargetRef;
  propertyName: string;
  value: JsonValue;
}

export interface PropertyWriteResult extends PropertyReadResult {
  changed: boolean;
}

export interface ConsoleCommandResult {
  commandId: string;
  accepted: true;
  executedCommand: string;
  message: string;
}

export interface TriggerLiveCodingBuildResult {
  accepted: boolean;
  status: LiveCodingStatus;
}
