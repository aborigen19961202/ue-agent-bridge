import { z } from "zod";
import { UnrealBackend } from "../backend/unreal-backend.js";
import {
  AssetSearchInput,
  GetLevelActorsInput,
  GetOutputLogInput,
  GetPropertyInput,
  JsonValue,
  RunConsoleCommandInput,
  SetPropertyInput,
  TargetRef
} from "../types/domain.js";
import { assertSafeConsoleCommandId, SAFE_CONSOLE_COMMAND_IDS } from "./console-command-policy.js";

export interface ToolDefinition<TArgs> {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
  parseArgs(args: unknown): TArgs;
  run(backend: UnrealBackend, args: TArgs): Promise<unknown>;
}

const targetSchema = z.object({
  actorName: z.string().min(1).optional(),
  objectPath: z.string().min(1).optional()
}).superRefine((value, ctx) => {
  if (!value.actorName && !value.objectPath) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "target.actorName or target.objectPath is required"
    });
  }
});

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(jsonValueSchema)
  ])
);

const emptySchema = z.object({}).strict();
const getLevelActorsSchema = z.object({
  className: z.string().min(1).optional(),
  nameContains: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(200).optional()
}).strict();

const getPropertySchema = z.object({
  target: targetSchema,
  propertyName: z.string().min(1)
}).strict();

const setPropertySchema = z.object({
  target: targetSchema,
  propertyName: z.string().min(1),
  value: jsonValueSchema
}).strict();

const assetSearchSchema = z.object({
  query: z.string().min(1).optional(),
  pathPrefix: z.string().min(1).optional(),
  assetClass: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(100).optional()
}).strict().superRefine((value, ctx) => {
  if (!value.query && !value.pathPrefix && !value.assetClass) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "At least one of query, pathPrefix, or assetClass is required"
    });
  }
});

const getOutputLogSchema = z.object({
  minLevel: z.enum(["Verbose", "Log", "Display", "Warning", "Error"]).optional(),
  limit: z.number().int().min(1).max(200).optional()
}).strict();

const runConsoleCommandSchema = z.object({
  commandId: z.string().min(1)
}).strict();

export const toolDefinitions: ToolDefinition<unknown>[] = [
  define<{}>({
    name: "ue_healthcheck",
    description: "Check whether the configured local Unreal backend is reachable.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    },
    annotations: readOnlyAnnotations(),
    parseArgs: (args) => emptySchema.parse(args ?? {}),
    run: (backend) => backend.healthcheck()
  }),
  define<{}>({
    name: "ue_get_selected_actors",
    description: "Get the currently selected actors from Unreal Editor.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    },
    annotations: readOnlyAnnotations(),
    parseArgs: (args) => emptySchema.parse(args ?? {}),
    run: (backend) => backend.getSelectedActors()
  }),
  define<GetLevelActorsInput>({
    name: "ue_get_level_actors",
    description: "List actors in the current level with optional filtering.",
    inputSchema: {
      type: "object",
      properties: {
        className: { type: "string" },
        nameContains: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 200 }
      },
      additionalProperties: false
    },
    annotations: readOnlyAnnotations(),
    parseArgs: (args) => getLevelActorsSchema.parse(args ?? {}),
    run: (backend, args) => backend.getLevelActors(args)
  }),
  define<GetPropertyInput>({
    name: "ue_get_property",
    description: "Read a specific property from a specific Unreal target.",
    inputSchema: propertyInputSchemaJson(false),
    annotations: readOnlyAnnotations(),
    parseArgs: (args) => getPropertySchema.parse(args ?? {}),
    run: (backend, args) => backend.getProperty(args)
  }),
  define<SetPropertyInput>({
    name: "ue_set_property",
    description: "Write a specific property on a specific Unreal target.",
    inputSchema: propertyInputSchemaJson(true),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    },
    parseArgs: (args) => setPropertySchema.parse(args ?? {}),
    run: (backend, args) => backend.setProperty(args)
  }),
  define<AssetSearchInput>({
    name: "ue_asset_search",
    description: "Search Unreal assets by name, path prefix, or class.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        pathPrefix: { type: "string" },
        assetClass: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 100 }
      },
      additionalProperties: false
    },
    annotations: readOnlyAnnotations(),
    parseArgs: (args) => assetSearchSchema.parse(args ?? {}),
    run: (backend, args) => backend.assetSearch(args)
  }),
  define<GetOutputLogInput>({
    name: "ue_get_output_log",
    description: "Return recent Unreal output log entries.",
    inputSchema: {
      type: "object",
      properties: {
        minLevel: {
          type: "string",
          enum: ["Verbose", "Log", "Display", "Warning", "Error"]
        },
        limit: { type: "integer", minimum: 1, maximum: 200 }
      },
      additionalProperties: false
    },
    annotations: readOnlyAnnotations(),
    parseArgs: (args) => getOutputLogSchema.parse(args ?? {}),
    run: (backend, args) => backend.getOutputLog(args)
  }),
  define<RunConsoleCommandInput>({
    name: "ue_run_console_command_safe",
    description: "Run one explicitly allowlisted Unreal console command by command ID.",
    inputSchema: {
      type: "object",
      properties: {
        commandId: {
          type: "string",
          enum: SAFE_CONSOLE_COMMAND_IDS
        }
      },
      required: ["commandId"],
      additionalProperties: false
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    },
    parseArgs: (args) => {
      const parsed = runConsoleCommandSchema.parse(args ?? {});
      assertSafeConsoleCommandId(parsed.commandId);
      return parsed;
    },
    run: (backend, args) => backend.runConsoleCommand(args)
  })
];

export function getToolDefinition(name: string): ToolDefinition<unknown> | undefined {
  return toolDefinitions.find((tool) => tool.name === name);
}

function define<TArgs>(definition: ToolDefinition<TArgs>): ToolDefinition<TArgs> {
  return definition;
}

function readOnlyAnnotations() {
  return {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false
  };
}

function propertyInputSchemaJson(withValue: boolean): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    target: {
      type: "object",
      properties: {
        objectPath: { type: "string", description: "Canonical Unreal object path." },
        actorName: { type: "string" },
      },
      additionalProperties: false
    },
    propertyName: { type: "string" }
  };

  const required = ["target", "propertyName"];

  if (withValue) {
    properties.value = {
      description: "JSON-compatible property value."
    };
    required.push("value");
  }

  return {
    type: "object",
    properties,
    required,
    additionalProperties: false
  };
}
