import {
  ActorSummary,
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
  SetPropertyInput
} from "../types/domain.js";
import { BridgeError } from "../utils/errors.js";
import { assertWritablePropertyInput } from "./property-write-policy.js";
import { resolveSafeConsoleCommand } from "../tools/console-command-policy.js";
import { UnrealBackend } from "./unreal-backend.js";

export interface RemoteControlBackendOptions {
  baseUrl: string;
  timeoutMs: number;
}

const M0_PRESET_NAME = "UE_AgentBridge_M0";
const SELECTED_ACTORS_HELPER_NAME = "GetSelectedActors";
const SELECTED_ACTORS_LIMIT = 200;
const OUTPUT_LOG_HELPER_NAME = "GetOutputLogSlice";
const OUTPUT_LOG_DEFAULT_LIMIT = 50;
const OUTPUT_LOG_HARD_CAP = 200;
const CONSOLE_COMMAND_HELPER_NAME = "RunSafeConsoleCommand";
const EDITOR_LEVEL_LIBRARY_PATH = "/Script/EditorScriptingUtilities.Default__EditorLevelLibrary";
const REQUIRED_HELPERS = [
  SELECTED_ACTORS_HELPER_NAME,
  OUTPUT_LOG_HELPER_NAME,
  CONSOLE_COMMAND_HELPER_NAME
] as const;

interface RemoteInfoRoute {
  Path?: unknown;
  Verb?: unknown;
  Description?: unknown;
}

interface RemoteInfoPayload {
  HttpRoutes?: unknown;
}

interface AssetSearchResponse {
  Assets?: unknown;
}

interface LevelActorPathsResponse {
  ReturnValue?: unknown;
}

interface ObjectDescribeResponse {
  Name?: unknown;
  Class?: unknown;
  ActorLabel?: unknown;
  DisplayName?: unknown;
}

interface SelectedActorsHelperPayload {
  ReturnedValues?: unknown;
}

export class RemoteControlBackend implements UnrealBackend {
  public readonly name = "remote-control";

  public constructor(private readonly options: RemoteControlBackendOptions) {}

  public async healthcheck(): Promise<HealthcheckResult> {
    let infoResponse: JsonResponse;

    try {
      infoResponse = await this.fetchJson("/remote/info", {
        method: "GET"
      });
    } catch (error) {
      return healthcheckFromRemoteInfoError(this.options.baseUrl, error);
    }

    const infoPayload = infoResponse.data;
    const routes = readHttpRoutes(infoPayload);

    if (!routes) {
      return {
        backend: "remote-control",
        connected: false,
        mode: "remote-control",
        transport: "http",
        message: "Endpoint responded, but /remote/info did not return the expected Remote Control route shape.",
        capabilities: [],
        readiness: {
          backendReachable: true,
          remoteControlAvailable: false,
          preset: {
            name: M0_PRESET_NAME,
            checked: false,
            available: null
          },
          helpers: {
            checked: false,
            ready: null,
            required: [...REQUIRED_HELPERS],
            missing: []
          }
        }
      };
    }

    const routePaths = routes
      .map((route) => typeof route.Path === "string" ? route.Path : null)
      .filter((path): path is string => path !== null);

    const remoteControlAvailable = routePaths.includes("/remote/info");
    const assetSearchReady = routePaths.includes("/remote/search/assets");
    const objectCallReady = routePaths.includes("/remote/object/call");
    const objectDescribeReady = routePaths.includes("/remote/object/describe");
    const objectPropertyReady = routePaths.includes("/remote/object/property");
    const levelActorsReady = objectCallReady && objectDescribeReady;
    const presetRoutesAvailable = routePaths.some((path) => path.startsWith("/remote/preset"));
    const presetReadiness = await this.checkPresetReadiness(presetRoutesAvailable);
    const selectedActorsReady = presetReadiness.available === true
      && !presetReadiness.missing.includes(SELECTED_ACTORS_HELPER_NAME);
    const outputLogReady = presetReadiness.available === true
      && !presetReadiness.missing.includes(OUTPUT_LOG_HELPER_NAME);
    const consoleCommandReady = presetReadiness.available === true
      && !presetReadiness.missing.includes(CONSOLE_COMMAND_HELPER_NAME);

    return {
      backend: "remote-control",
      connected: remoteControlAvailable,
      mode: "remote-control",
      transport: "http",
      message: buildHealthcheckMessage({
        remoteControlAvailable,
        assetSearchReady,
        presetChecked: presetReadiness.checked,
        presetAvailable: presetReadiness.available,
        missingHelpers: presetReadiness.missing
      }),
      capabilities: [
        "ue_healthcheck",
        ...(selectedActorsReady ? ["ue_get_selected_actors"] : []),
        ...(outputLogReady ? ["ue_get_output_log"] : []),
        ...(consoleCommandReady ? ["ue_run_console_command_safe"] : []),
        ...(levelActorsReady ? ["ue_get_level_actors"] : []),
        ...(objectPropertyReady ? ["ue_get_property"] : []),
        ...(objectPropertyReady ? ["ue_set_property"] : []),
        ...(assetSearchReady ? ["ue_asset_search"] : [])
      ],
      readiness: {
        backendReachable: true,
        remoteControlAvailable,
        preset: {
          name: M0_PRESET_NAME,
          checked: presetReadiness.checked,
          available: presetReadiness.available
        },
        helpers: {
          checked: presetReadiness.checked,
          ready: presetReadiness.ready,
          required: [...REQUIRED_HELPERS],
          missing: presetReadiness.missing
        }
      }
    };
  }

  public async getSelectedActors(): Promise<ActorSummary[]> {
    const response = await this.fetchResponse(`/remote/preset/${M0_PRESET_NAME}/function/${SELECTED_ACTORS_HELPER_NAME}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        Parameters: {
          Limit: SELECTED_ACTORS_LIMIT
        },
        GenerateTransaction: false
      })
    });

    if (!response.ok) {
      throw classifySelectedActorsHelperError(response);
    }

    return normalizeSelectedActorsHelperResponse(response.data);
  }

  public async getLevelActors(input: GetLevelActorsInput): Promise<ActorSummary[]> {
    const response = await this.fetchJson("/remote/object/call", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        objectPath: EDITOR_LEVEL_LIBRARY_PATH,
        functionName: "GetAllLevelActors"
      })
    });

    const objectPaths = normalizeLevelActorPaths(response.data);
    const limit = input.limit ?? 100;
    const actors: ActorSummary[] = [];

    // Use explicit describe calls instead of /remote/batch here because the single-object
    // describe response is documented more clearly for M0 than the aggregated batch shape.
    for (const objectPath of objectPaths) {
      if (actors.length >= limit) {
        break;
      }

      const actor = await this.describeActor(objectPath);
      if (matchesActorFilter(actor, input)) {
        actors.push(actor);
      }
    }

    return actors;
  }

  public async getProperty(input: GetPropertyInput): Promise<PropertyReadResult> {
    if (!input.target.objectPath) {
      throw new BridgeError(
        "VALIDATION_ERROR",
        "Remote Control property reads require target.objectPath. actorName-only targeting is not supported in remote-control mode."
      );
    }

    const response = await this.fetchResponse("/remote/object/property", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        objectPath: input.target.objectPath,
        propertyName: input.propertyName,
        access: "READ_ACCESS"
      })
    });

    if (!response.ok) {
      throw classifyPropertyAccessError({
        response,
        objectPath: input.target.objectPath,
        propertyName: input.propertyName,
        operation: "read"
      });
    }

    if (!isRecord(response.data)) {
      throw new BridgeError("BACKEND_ERROR", "Remote Control property read returned an unexpected response shape.");
    }

    if (!Object.prototype.hasOwnProperty.call(response.data, input.propertyName)) {
      throw new BridgeError("NOT_FOUND", `Property not found or not readable: ${input.propertyName}`);
    }

    return {
      target: {
        objectPath: input.target.objectPath
      },
      propertyName: input.propertyName,
      value: response.data[input.propertyName] as PropertyReadResult["value"]
    };
  }

  public async setProperty(input: SetPropertyInput): Promise<PropertyWriteResult> {
    assertWritablePropertyInput(input);
    const objectPath = input.target.objectPath;

    if (!objectPath) {
      throw new BridgeError(
        "VALIDATION_ERROR",
        "Remote Control property writes require target.objectPath. actorName-only targeting is not supported in remote-control mode."
      );
    }

    const before = await this.getProperty({
      target: {
        objectPath
      },
      propertyName: input.propertyName
    });

    const writeResponse = await this.fetchResponse("/remote/object/property", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        objectPath,
        propertyName: input.propertyName,
        access: "WRITE_TRANSACTION_ACCESS",
        propertyValue: {
          [input.propertyName]: input.value
        }
      })
    });

    if (!writeResponse.ok) {
      throw classifyPropertyAccessError({
        response: writeResponse,
        objectPath,
        propertyName: input.propertyName,
        operation: "write"
      });
    }

    // Remote Control does not guarantee a stable write response payload, so M0 treats the
    // follow-up read as the authoritative result instead of trusting the write response body.
    const after = await this.getProperty({
      target: {
        objectPath
      },
      propertyName: input.propertyName
    });

    if (!jsonValuesEqual(after.value, input.value)) {
      throw new BridgeError(
        "BACKEND_ERROR",
        `Remote Control property write verification failed for ${objectPath}.${input.propertyName}.`
      );
    }

    return {
      target: {
        objectPath
      },
      propertyName: input.propertyName,
      value: after.value,
      changed: !jsonValuesEqual(before.value, after.value)
    };
  }

  public async assetSearch(input: AssetSearchInput): Promise<AssetSummary[]> {
    const response = await this.fetchJson("/remote/search/assets", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(toAssetSearchRequest(input))
    });

    const assets = normalizeAssetSearchResponse(response.data);
    return assets.slice(0, input.limit ?? 50);
  }

  public async getOutputLog(input: GetOutputLogInput): Promise<OutputLogEntry[]> {
    const requestedLimit = Math.min(input.limit ?? OUTPUT_LOG_DEFAULT_LIMIT, OUTPUT_LOG_HARD_CAP);
    const parameters: Record<string, unknown> = {
      Limit: requestedLimit
    };

    if (input.minLevel) {
      parameters.MinLevel = input.minLevel;
    }

    const response = await this.fetchResponse(`/remote/preset/${M0_PRESET_NAME}/function/${OUTPUT_LOG_HELPER_NAME}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        Parameters: parameters,
        GenerateTransaction: false
      })
    });

    if (!response.ok) {
      throw classifyOutputLogHelperError(response);
    }

    return normalizeOutputLogHelperResponse(response.data, requestedLimit);
  }

  public async runConsoleCommand(input: RunConsoleCommandInput): Promise<ConsoleCommandResult> {
    const command = resolveSafeConsoleCommand(input.commandId);
    const response = await this.fetchResponse(`/remote/preset/${M0_PRESET_NAME}/function/${CONSOLE_COMMAND_HELPER_NAME}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        Parameters: {
          CommandId: command.commandId
        },
        GenerateTransaction: false
      })
    });

    if (!response.ok) {
      throw classifyConsoleCommandHelperError(response);
    }

    return normalizeConsoleCommandHelperResponse(response.data, command.commandId);
  }

  private async checkPresetReadiness(presetRoutesAvailable: boolean): Promise<PresetReadiness> {
    if (!presetRoutesAvailable) {
      return {
        checked: false,
        available: null,
        ready: null,
        missing: []
      };
    }

    let presetResponse: JsonResponse;

    try {
      presetResponse = await this.fetchJson(`/remote/preset/${M0_PRESET_NAME}`, {
        method: "GET"
      }, {
        allowNotFound: true
      });
    } catch {
      return {
        checked: true,
        available: false,
        ready: false,
        missing: [...REQUIRED_HELPERS]
      };
    }

    if (presetResponse.status === 404) {
      return {
        checked: true,
        available: false,
        ready: false,
        missing: [...REQUIRED_HELPERS]
      };
    }

    const serializedPreset = JSON.stringify(presetResponse.data);
    const missing = REQUIRED_HELPERS.filter((helper) => !serializedPreset.includes(helper));

    return {
      checked: true,
      available: true,
      ready: missing.length === 0,
      missing
    };
  }

  private async fetchJson(
    path: string,
    init: RequestInit,
    options: { allowNotFound?: boolean } = {}
  ): Promise<JsonResponse> {
    const response = await this.fetchResponse(path, init);

    if (!response.ok && !(options.allowNotFound && response.status === 404)) {
      throw new BridgeError(
        "BACKEND_ERROR",
        `Remote Control request failed for ${path}: ${response.status} ${response.statusText}`
      );
    }

    const data = requireJsonPayload(response, path);

    return {
      status: response.status,
      data
    };
  }

  private async fetchResponse(path: string, init: RequestInit): Promise<HttpResponse> {
    const response = await fetchWithTimeout(`${this.options.baseUrl}${path}`, init, this.options.timeoutMs);
    const rawBody = await response.text();

    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      rawBody,
      data: parseResponseBody(rawBody, path)
    };
  }

  private async describeActor(objectPath: string): Promise<ActorSummary> {
    const response = await this.fetchResponse("/remote/object/describe", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        objectPath
      })
    });

    if (!response.ok) {
      const message = extractRemoteErrorMessage(response);
      throw new BridgeError(
        "BACKEND_ERROR",
        `Remote Control could not describe actor ${objectPath}: ${message}`
      );
    }

    return normalizeActorDescribeResponse(response.data, objectPath);
  }
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

interface PresetReadiness {
  checked: boolean;
  available: boolean | null;
  ready: boolean | null;
  missing: string[];
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
      throw new BridgeError("BACKEND_ERROR", `Remote Control request timed out for ${url}`);
    }

    throw new BridgeError("BACKEND_ERROR", `Could not reach Remote Control endpoint at ${url}`);
  } finally {
    clearTimeout(timeout);
  }
}

function parseResponseBody(raw: string, path: string): unknown {
  if (raw.trim().length === 0) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function requireJsonPayload(response: HttpResponse, path: string): unknown {
  if (typeof response.data === "string") {
    throw new BridgeError("BACKEND_ERROR", `Remote Control returned a non-JSON response for ${path}`);
  }

  return response.data;
}

function readHttpRoutes(payload: unknown): RemoteInfoRoute[] | null {
  if (!isRecord(payload) || !Array.isArray(payload.HttpRoutes)) {
    return null;
  }

  return payload.HttpRoutes as RemoteInfoRoute[];
}

function buildHealthcheckMessage(input: {
  remoteControlAvailable: boolean;
  assetSearchReady: boolean;
  presetChecked: boolean;
  presetAvailable: boolean | null;
  missingHelpers: string[];
}): string {
  if (!input.remoteControlAvailable) {
    return "Endpoint responded, but Remote Control did not report the expected route inventory.";
  }

  if (!input.assetSearchReady) {
    return "Remote Control is reachable, but /remote/search/assets was not advertised. Asset search is not ready.";
  }

  if (input.presetAvailable === false) {
    return "Remote Control and asset search are ready. Helper-backed M0 tools are not ready because the UE_AgentBridge_M0 preset is missing.";
  }

  if (!input.presetChecked) {
    return "Remote Control and asset search are ready. Preset and helper readiness could not be verified from the advertised Remote Control routes.";
  }

  if (input.missingHelpers.length > 0) {
    return `Remote Control and asset search are ready. Helper-backed M0 tools are not ready yet. Missing helpers: ${input.missingHelpers.join(", ")}.`;
  }

  return "Remote Control is reachable. Direct M0 routes are ready. Helper-backed M0 tools exposed through the preset appear available.";
}

function toAssetSearchRequest(input: AssetSearchInput): Record<string, unknown> {
  const request: Record<string, unknown> = {};
  const filter: Record<string, unknown> = {
    RecursiveClasses: false
  };

  if (input.query) {
    request.Query = input.query;
  }

  if (input.assetClass) {
    filter.ClassNames = [input.assetClass];
  }

  if (input.pathPrefix) {
    filter.PackagePaths = [input.pathPrefix];
    filter.RecursivePaths = true;
  }

  if (Object.keys(filter).length > 1) {
    request.Filter = filter;
  }

  return request;
}

function normalizeAssetSearchResponse(payload: unknown): AssetSummary[] {
  if (!isRecord(payload) || !Array.isArray(payload.Assets)) {
    throw new BridgeError("BACKEND_ERROR", "Remote Control asset search returned an unexpected response shape.");
  }

  return payload.Assets.map((entry, index) => normalizeAssetEntry(entry, index));
}

function normalizeAssetEntry(entry: unknown, index: number): AssetSummary {
  if (!isRecord(entry)) {
    throw new BridgeError("BACKEND_ERROR", `Remote Control asset search returned a malformed asset at index ${index}.`);
  }

  const assetName = typeof entry.Name === "string" ? entry.Name : null;
  const assetClass = typeof entry.Class === "string" ? entry.Class : null;
  const assetPath = typeof entry.Path === "string" ? entry.Path : null;

  if (!assetName || !assetClass || !assetPath) {
    throw new BridgeError("BACKEND_ERROR", `Remote Control asset search returned an incomplete asset at index ${index}.`);
  }

  // Keep Path as the canonical Unreal object path returned by Remote Control.
  return {
    assetName,
    assetClass,
    assetPath
  };
}

function normalizeLevelActorPaths(payload: unknown): string[] {
  if (!isRecord(payload) || !Array.isArray(payload.ReturnValue)) {
    throw new BridgeError(
      "BACKEND_ERROR",
      "Remote Control level actor enumeration returned an unexpected response shape."
    );
  }

  return payload.ReturnValue.map((entry, index) => {
    if (typeof entry !== "string" || entry.length === 0) {
      throw new BridgeError(
        "BACKEND_ERROR",
        `Remote Control level actor enumeration returned an invalid object path at index ${index}.`
      );
    }

    return entry;
  });
}

function normalizeSelectedActorsHelperResponse(payload: unknown): ActorSummary[] {
  if (!isRecord(payload) || !Array.isArray(payload.ReturnedValues)) {
    throw new BridgeError(
      "BACKEND_ERROR",
      "Selected actors helper returned an unexpected response shape."
    );
  }

  const firstReturnedValue = payload.ReturnedValues[0];

  if (!isRecord(firstReturnedValue) || !Array.isArray(firstReturnedValue.Actors)) {
    throw new BridgeError(
      "BACKEND_ERROR",
      "Selected actors helper did not return an Actors array."
    );
  }

  return firstReturnedValue.Actors.map((entry, index) => normalizeSelectedActorEntry(entry, index));
}

function normalizeSelectedActorEntry(entry: unknown, index: number): ActorSummary {
  if (!isRecord(entry)) {
    throw new BridgeError(
      "BACKEND_ERROR",
      `Selected actors helper returned a malformed actor at index ${index}.`
    );
  }

  const actorName = typeof entry.ActorName === "string" ? entry.ActorName : null;
  const className = typeof entry.ClassName === "string" ? entry.ClassName : null;
  const objectPath = typeof entry.ObjectPath === "string" ? entry.ObjectPath : null;
  const actorLabel = typeof entry.ActorLabel === "string" && entry.ActorLabel.length > 0
    ? entry.ActorLabel
    : undefined;

  if (!actorName || !className || !objectPath) {
    throw new BridgeError(
      "BACKEND_ERROR",
      `Selected actors helper returned an incomplete actor at index ${index}.`
    );
  }

  return {
    ...(actorLabel ? { actorLabel } : {}),
    actorName,
    className,
    objectPath,
    selected: true
  };
}

function normalizeOutputLogHelperResponse(payload: unknown, requestedLimit: number): OutputLogEntry[] {
  if (!isRecord(payload) || !Array.isArray(payload.ReturnedValues)) {
    throw new BridgeError(
      "BACKEND_ERROR",
      "Output log helper returned an unexpected response shape."
    );
  }

  const firstReturnedValue = payload.ReturnedValues[0];

  if (!isRecord(firstReturnedValue) || !Array.isArray(firstReturnedValue.Entries)) {
    throw new BridgeError(
      "BACKEND_ERROR",
      "Output log helper did not return an Entries array."
    );
  }

  if (firstReturnedValue.Entries.length > requestedLimit) {
    throw new BridgeError(
      "BACKEND_ERROR",
      `Output log helper returned ${firstReturnedValue.Entries.length} entries, exceeding the requested limit of ${requestedLimit}.`
    );
  }

  return firstReturnedValue.Entries.map((entry, index) => normalizeOutputLogEntry(entry, index));
}

function normalizeOutputLogEntry(entry: unknown, index: number): OutputLogEntry {
  if (!isRecord(entry)) {
    throw new BridgeError(
      "BACKEND_ERROR",
      `Output log helper returned a malformed entry at index ${index}.`
    );
  }

  const timestamp = typeof entry.Timestamp === "string" ? entry.Timestamp : null;
  const level = normalizeLogLevel(entry.Level);
  const category = typeof entry.Category === "string" ? entry.Category : null;
  const message = typeof entry.Message === "string" ? entry.Message : null;

  if (!timestamp || !level || !category || !message) {
    throw new BridgeError(
      "BACKEND_ERROR",
      `Output log helper returned an incomplete entry at index ${index}.`
    );
  }

  return {
    timestamp,
    level,
    category,
    message
  };
}

function normalizeConsoleCommandHelperResponse(payload: unknown, requestedCommandId: string): ConsoleCommandResult {
  if (!isRecord(payload) || !Array.isArray(payload.ReturnedValues)) {
    throw new BridgeError(
      "BACKEND_ERROR",
      "Console command helper returned an unexpected response shape."
    );
  }

  const firstReturnedValue = payload.ReturnedValues[0];

  if (!isRecord(firstReturnedValue)) {
    throw new BridgeError(
      "BACKEND_ERROR",
      "Console command helper did not return an object payload."
    );
  }

  const accepted = firstReturnedValue.Accepted;
  const commandId = firstReturnedValue.CommandId;
  const executedCommand = firstReturnedValue.ExecutedCommand;
  const message = firstReturnedValue.Message;

  if (typeof accepted !== "boolean" || typeof commandId !== "string" || typeof message !== "string") {
    throw new BridgeError(
      "BACKEND_ERROR",
      "Console command helper returned an incomplete response."
    );
  }

  if (commandId !== requestedCommandId) {
    throw new BridgeError(
      "BACKEND_ERROR",
      `Console command helper returned a mismatched command ID: ${commandId}.`
    );
  }

  if (!accepted) {
    const normalized = message.toLowerCase();

    if (normalized.includes("allowlist") || normalized.includes("allowlisted") || normalized.includes("not allowed")) {
      throw new BridgeError("UNSAFE_COMMAND", message);
    }

    throw new BridgeError(
      "BACKEND_ERROR",
      `Console command helper reported execution failure: ${message}`
    );
  }

  if (typeof executedCommand !== "string" || executedCommand.length === 0) {
    throw new BridgeError(
      "BACKEND_ERROR",
      "Console command helper accepted the command but did not return ExecutedCommand."
    );
  }

  return {
    commandId,
    accepted: true,
    executedCommand,
    message
  };
}

function normalizeActorDescribeResponse(payload: unknown, objectPath: string): ActorSummary {
  if (!isRecord(payload)) {
    throw new BridgeError(
      "BACKEND_ERROR",
      `Remote Control describe returned an unexpected actor payload for ${objectPath}.`
    );
  }

  const actorName = typeof payload.Name === "string" ? payload.Name : null;
  const className = normalizeClassName(payload.Class);
  const actorLabel = readOptionalActorLabel(payload);

  if (!actorName || !className) {
    throw new BridgeError(
      "BACKEND_ERROR",
      `Remote Control describe returned an incomplete actor payload for ${objectPath}.`
    );
  }

  return {
    ...(actorLabel ? { actorLabel } : {}),
    actorName,
    className,
    objectPath
  };
}

function normalizeClassName(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }

  const lastDotIndex = value.lastIndexOf(".");
  return lastDotIndex >= 0 ? value.slice(lastDotIndex + 1) : value;
}

function normalizeLogLevel(value: unknown): OutputLogEntry["level"] | null {
  switch (value) {
    case "Verbose":
    case "Log":
    case "Display":
    case "Warning":
    case "Error":
      return value;
    default:
      return null;
  }
}

function readOptionalActorLabel(payload: Record<string, unknown>): string | undefined {
  if (typeof payload.ActorLabel === "string" && payload.ActorLabel.length > 0) {
    return payload.ActorLabel;
  }

  if (typeof payload.DisplayName === "string" && payload.DisplayName.length > 0) {
    return payload.DisplayName;
  }

  return undefined;
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

function classifyPropertyAccessError(input: {
  response: HttpResponse;
  objectPath: string;
  propertyName: string;
  operation: "read" | "write";
}): BridgeError {
  const remoteMessage = extractRemoteErrorMessage(input.response);
  const normalized = remoteMessage.toLowerCase();

  // Remote Control does not document a stable machine-readable error envelope for these
  // failures, so only obvious not-found strings are classified more narrowly.
  if (normalized.includes("property") && normalized.includes("not found")) {
    return new BridgeError("NOT_FOUND", `Property not found: ${input.propertyName}`);
  }

  if (
    normalized.includes("read only")
    || normalized.includes("readonly")
    || normalized.includes("not writable")
    || normalized.includes("write access")
    || normalized.includes("read-only")
  ) {
    return new BridgeError("NOT_WRITABLE", `Property is not writable: ${input.propertyName}`);
  }

  if (
    normalized.includes("type mismatch")
    || normalized.includes("invalid value")
    || normalized.includes("cannot deserialize")
    || normalized.includes("can't deserialize")
    || normalized.includes("failed to import")
    || normalized.includes("cannot import")
  ) {
    return new BridgeError("INVALID_VALUE", `Invalid value for property ${input.propertyName}: ${remoteMessage}`);
  }

  if (
    input.response.status === 404
    || normalized.includes("object")
    || normalized.includes("uobject")
    || normalized.includes("can't find")
    || normalized.includes("cannot find")
    || normalized.includes("not found")
  ) {
    return new BridgeError("NOT_FOUND", `Target object not found: ${input.objectPath}`);
  }

  return new BridgeError(
    "BACKEND_ERROR",
    `Remote Control property ${input.operation} failed for ${input.objectPath}.${input.propertyName}: ${remoteMessage}`
  );
}

function classifySelectedActorsHelperError(response: HttpResponse): BridgeError {
  const remoteMessage = extractRemoteErrorMessage(response);
  const normalized = remoteMessage.toLowerCase();

  if (
    response.status === 404
    || normalized.includes("preset")
    || normalized.includes("function")
    || normalized.includes("not found")
    || normalized.includes("no route")
  ) {
    return new BridgeError(
      "HELPER_UNAVAILABLE",
      `Selected actors helper is unavailable. Expected ${M0_PRESET_NAME}.${SELECTED_ACTORS_HELPER_NAME} through Remote Control.`
    );
  }

  return new BridgeError(
    "BACKEND_ERROR",
    `Selected actors helper call failed: ${remoteMessage}`
  );
}

function classifyOutputLogHelperError(response: HttpResponse): BridgeError {
  const remoteMessage = extractRemoteErrorMessage(response);
  const normalized = remoteMessage.toLowerCase();

  if (
    response.status === 404
    || normalized.includes("preset")
    || normalized.includes("function")
    || normalized.includes("not found")
    || normalized.includes("no route")
  ) {
    return new BridgeError(
      "HELPER_UNAVAILABLE",
      `Output log helper is unavailable. Expected ${M0_PRESET_NAME}.${OUTPUT_LOG_HELPER_NAME} through Remote Control.`
    );
  }

  return new BridgeError(
    "BACKEND_ERROR",
    `Output log helper call failed: ${remoteMessage}`
  );
}

function classifyConsoleCommandHelperError(response: HttpResponse): BridgeError {
  const remoteMessage = extractRemoteErrorMessage(response);
  const normalized = remoteMessage.toLowerCase();

  if (
    response.status === 404
    || normalized.includes("preset")
    || normalized.includes("function")
    || normalized.includes("not found")
    || normalized.includes("no route")
  ) {
    return new BridgeError(
      "HELPER_UNAVAILABLE",
      `Console command helper is unavailable. Expected ${M0_PRESET_NAME}.${CONSOLE_COMMAND_HELPER_NAME} through Remote Control.`
    );
  }

  return new BridgeError(
    "BACKEND_ERROR",
    `Console command helper call failed: ${remoteMessage}`
  );
}

function jsonValuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function extractRemoteErrorMessage(response: HttpResponse): string {
  if (typeof response.data === "string" && response.data.trim().length > 0) {
    return response.data;
  }

  if (isRecord(response.data)) {
    for (const key of ["errorMessage", "ErrorMessage", "message", "Message"]) {
      const value = response.data[key];
      if (typeof value === "string" && value.trim().length > 0) {
        return value;
      }
    }
  }

  if (response.rawBody.trim().length > 0) {
    return response.rawBody;
  }

  return `${response.status} ${response.statusText}`;
}

function healthcheckFromRemoteInfoError(baseUrl: string, error: unknown): HealthcheckResult {
  if (error instanceof BridgeError && isTransportLevelError(error.message, baseUrl)) {
    return unreachableHealthcheck(baseUrl, error);
  }

  const message = error instanceof Error ? error.message : `Remote Control healthcheck failed for ${baseUrl}`;

  return {
    backend: "remote-control",
    connected: false,
    mode: "remote-control",
    transport: "http",
    message,
    capabilities: [],
    readiness: {
      backendReachable: true,
      remoteControlAvailable: false,
      preset: {
        name: M0_PRESET_NAME,
        checked: false,
        available: null
      },
      helpers: {
        checked: false,
        ready: null,
        required: [...REQUIRED_HELPERS],
        missing: []
      }
    }
  };
}

function unreachableHealthcheck(baseUrl: string, error: unknown): HealthcheckResult {
  const message = error instanceof Error ? error.message : `Could not reach Remote Control endpoint at ${baseUrl}`;

  return {
    backend: "remote-control",
    connected: false,
    mode: "remote-control",
    transport: "http",
    message,
    capabilities: [],
    readiness: {
      backendReachable: false,
      remoteControlAvailable: false,
      preset: {
        name: M0_PRESET_NAME,
        checked: false,
        available: null
      },
      helpers: {
        checked: false,
        ready: null,
        required: [...REQUIRED_HELPERS],
        missing: []
      }
    }
  };
}

function isTransportLevelError(message: string, baseUrl: string): boolean {
  return message.includes(`Could not reach Remote Control endpoint at ${baseUrl}`)
    || message.includes(`Remote Control request timed out for ${baseUrl}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stubbedCallError(toolName: string): BridgeError {
  return new BridgeError(
    "NOT_IMPLEMENTED",
    `${toolName} is not wired to Unreal Remote Control yet. The M0 scaffold keeps the backend boundary in place, but exact Unreal-side exposure still needs to be connected.`
  );
}
