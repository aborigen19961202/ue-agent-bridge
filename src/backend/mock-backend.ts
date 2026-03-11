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
import { resolveSafeConsoleCommand } from "../tools/console-command-policy.js";
import { UnrealBackend } from "./unreal-backend.js";

interface MockActorRecord extends ActorSummary {
  properties: Record<string, unknown>;
}

const MOCK_ACTORS: MockActorRecord[] = [
  {
    actorLabel: "SM_Chair_01",
    actorName: "SM_Chair_01",
    className: "StaticMeshActor",
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

  public constructor() {
    this.actors = structuredClone(MOCK_ACTORS);
    this.assets = structuredClone(MOCK_ASSETS);
    this.logs = structuredClone(MOCK_LOGS);
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
