import {
  AssetSearchInput,
  AssetSummary,
  ConsoleCommandResult,
  GetLevelActorsInput,
  GetOutputLogInput,
  GetPropertyInput,
  HealthcheckResult,
  OutputLogEntry,
  PropertyReadResult,
  PropertyWriteResult,
  RunConsoleCommandInput,
  SetPropertyInput,
  ActorSummary
} from "../types/domain.js";

export interface UnrealBackend {
  readonly name: "mock" | "remote-control";
  healthcheck(): Promise<HealthcheckResult>;
  getSelectedActors(): Promise<ActorSummary[]>;
  getLevelActors(input: GetLevelActorsInput): Promise<ActorSummary[]>;
  getProperty(input: GetPropertyInput): Promise<PropertyReadResult>;
  setProperty(input: SetPropertyInput): Promise<PropertyWriteResult>;
  assetSearch(input: AssetSearchInput): Promise<AssetSummary[]>;
  getOutputLog(input: GetOutputLogInput): Promise<OutputLogEntry[]>;
  runConsoleCommand(input: RunConsoleCommandInput): Promise<ConsoleCommandResult>;
}
