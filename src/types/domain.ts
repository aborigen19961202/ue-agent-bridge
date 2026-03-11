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

export interface HealthcheckResult {
  backend: "mock" | "remote-control";
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
