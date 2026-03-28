import {
  AssetSearchInput,
  AssetSummary,
  ConsoleCommandResult,
  EditorDiagnostic,
  EditorState,
  DestroyActorInput,
  DestroyActorResult,
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
  SetPropertyInput,
  TriggerLiveCodingBuildResult,
  DebugDrawStateResult,
  ActorSummary,
  FrameActorInput,
  FrameActorResult,
  SpawnActorInput,
  SpawnActorResult,
  SetViewportCameraInput,
  ViewportCameraState,
  ViewportScreenshotInput,
  ViewportScreenshotResult
} from "../types/domain.js";

export interface UnrealBackend {
  readonly name: "mock" | "remote-control" | "plugin";
  healthcheck(): Promise<HealthcheckResult>;
  getSelectedActors(): Promise<ActorSummary[]>;
  getLevelActors(input: GetLevelActorsInput): Promise<ActorSummary[]>;
  getProperty(input: GetPropertyInput): Promise<PropertyReadResult>;
  setProperty(input: SetPropertyInput): Promise<PropertyWriteResult>;
  assetSearch(input: AssetSearchInput): Promise<AssetSummary[]>;
  getOutputLog(input: GetOutputLogInput): Promise<OutputLogEntry[]>;
  getEditorDiagnostics(input: GetEditorDiagnosticsInput): Promise<EditorDiagnostic[]>;
  getEditorState(): Promise<EditorState>;
  getViewportCamera(): Promise<ViewportCameraState>;
  setViewportCamera(input: SetViewportCameraInput): Promise<ViewportCameraState>;
  spawnActor(input: SpawnActorInput): Promise<SpawnActorResult>;
  selectActor(input: SelectActorInput): Promise<SelectActorResult>;
  destroyActor(input: DestroyActorInput): Promise<DestroyActorResult>;
  frameActor(input: FrameActorInput): Promise<FrameActorResult>;
  getViewportScreenshot(input: ViewportScreenshotInput): Promise<ViewportScreenshotResult>;
  getDebugDrawState(input: GetDebugDrawStateInput): Promise<DebugDrawStateResult>;
  getLiveCodingStatus(): Promise<LiveCodingStatus>;
  triggerLiveCodingBuild(): Promise<TriggerLiveCodingBuildResult>;
  runConsoleCommand(input: RunConsoleCommandInput): Promise<ConsoleCommandResult>;
}
