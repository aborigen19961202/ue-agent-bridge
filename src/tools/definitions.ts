import { z } from "zod";
import { UnrealBackend } from "../backend/unreal-backend.js";
import {
  AssetSearchInput,
  DestroyActorInput,
  FrameActorInput,
  GetDebugDrawStateInput,
  GetEditorDiagnosticsInput,
  GetLevelActorsInput,
  GetOutputLogInput,
  GetPropertyInput,
  JsonValue,
  RunConsoleCommandInput,
  SelectActorInput,
  SetViewportCameraInput,
  SetPropertyInput,
  SpawnActorInput,
  TargetRef,
  ViewportScreenshotInput,
  ViewportScreenshotResult
} from "../types/domain.js";
import { assertSafeConsoleCommandId, SAFE_CONSOLE_COMMAND_IDS } from "./console-command-policy.js";
import { ToolResponse } from "../types/tool.js";
import { imageResponse } from "../utils/format.js";
import { compareViewportToReference, saveViewportImage, validateCropRect } from "../utils/vision.js";

interface CaptureViewportToolArgs extends ViewportScreenshotInput {
  saveToFile?: string | undefined;
}

interface CompareViewportToolArgs extends ViewportScreenshotInput {
  referenceImagePath: string;
  saveCurrentToFile?: string | undefined;
  saveDiffToFile?: string | undefined;
  mismatchTolerance?: number | undefined;
  pixelThreshold?: number | undefined;
}

interface CaptureActorScreenshotToolArgs extends ViewportScreenshotInput {
  target: TargetRef;
  activeViewportOnly?: boolean | undefined;
  saveToFile?: string | undefined;
}

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
  formatResult?(result: unknown, args: TArgs): ToolResponse;
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

const getEditorDiagnosticsSchema = z.object({
  minSeverity: z.enum(["Info", "Warning", "Error"]).optional(),
  limit: z.number().int().min(1).max(200).optional()
}).strict();

const getViewportScreenshotSchema = z.object({
  maxDimension: z.number().int().min(256).max(4096).optional(),
  viewMode: z.enum([
    "current",
    "lit",
    "unlit",
    "wireframe",
    "detail_lighting",
    "lighting_only",
    "collision_pawn",
    "collision_visibility"
  ]).optional(),
  crop: z.object({
    x: z.number().int().min(0),
    y: z.number().int().min(0),
    width: z.number().int().min(1),
    height: z.number().int().min(1)
  }).optional(),
  saveToFile: z.string().min(1).optional()
}).strict().superRefine((value, ctx) => {
  if (value.crop) {
    try {
      validateCropRect(value.crop);
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: error instanceof Error ? error.message : "Invalid crop."
      });
    }
  }
});

const getViewportCameraSchema = z.object({}).strict();

const setViewportCameraSchema = z.object({
  location: z.object({
    x: z.number(),
    y: z.number(),
    z: z.number()
  }),
  rotation: z.object({
    pitch: z.number(),
    yaw: z.number(),
    roll: z.number()
  })
}).strict();

const spawnActorSchema = z.object({
  className: z.string().min(1).optional(),
  classPath: z.string().min(1).optional(),
  location: z.object({
    x: z.number(),
    y: z.number(),
    z: z.number()
  }),
  rotation: z.object({
    pitch: z.number(),
    yaw: z.number(),
    roll: z.number()
  }),
  selectAfterSpawn: z.boolean().optional(),
  label: z.string().min(1).max(128).optional()
}).strict().superRefine((value, ctx) => {
  const identifierCount = Number(Boolean(value.className)) + Number(Boolean(value.classPath));
  if (identifierCount !== 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Exactly one of className or classPath is required"
    });
  }
});

const selectActorSchema = z.object({
  target: targetSchema
}).strict();

const destroyActorSchema = z.object({
  target: targetSchema
}).strict();

const frameActorSchema = z.object({
  target: targetSchema,
  activeViewportOnly: z.boolean().optional()
}).strict();

const captureActorScreenshotSchema = z.object({
  target: targetSchema,
  activeViewportOnly: z.boolean().optional(),
  maxDimension: z.number().int().min(256).max(4096).optional(),
  viewMode: z.enum([
    "current",
    "lit",
    "unlit",
    "wireframe",
    "detail_lighting",
    "lighting_only",
    "collision_pawn",
    "collision_visibility"
  ]).optional(),
  crop: z.object({
    x: z.number().int().min(0),
    y: z.number().int().min(0),
    width: z.number().int().min(1),
    height: z.number().int().min(1)
  }).optional(),
  saveToFile: z.string().min(1).optional()
}).strict().superRefine((value, ctx) => {
  if (value.crop) {
    try {
      validateCropRect(value.crop);
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: error instanceof Error ? error.message : "Invalid crop."
      });
    }
  }
});

const compareViewportScreenshotSchema = z.object({
  referenceImagePath: z.string().min(1),
  maxDimension: z.number().int().min(256).max(4096).optional(),
  viewMode: z.enum([
    "current",
    "lit",
    "unlit",
    "wireframe",
    "detail_lighting",
    "lighting_only",
    "collision_pawn",
    "collision_visibility"
  ]).optional(),
  crop: z.object({
    x: z.number().int().min(0),
    y: z.number().int().min(0),
    width: z.number().int().min(1),
    height: z.number().int().min(1)
  }).optional(),
  saveCurrentToFile: z.string().min(1).optional(),
  saveDiffToFile: z.string().min(1).optional(),
  mismatchTolerance: z.number().min(0).max(1).optional(),
  pixelThreshold: z.number().min(0).max(1).optional()
}).strict();

const getDebugDrawStateSchema = z.object({
  limit: z.number().int().min(1).max(200).optional(),
  includePoints: z.boolean().optional()
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
  define<GetEditorDiagnosticsInput>({
    name: "ue_get_editor_diagnostics",
    description: "Return bounded Unreal editor diagnostics normalized for external agents.",
    inputSchema: {
      type: "object",
      properties: {
        minSeverity: {
          type: "string",
          enum: ["Info", "Warning", "Error"]
        },
        limit: { type: "integer", minimum: 1, maximum: 200 }
      },
      additionalProperties: false
    },
    annotations: readOnlyAnnotations(),
    parseArgs: (args) => getEditorDiagnosticsSchema.parse(args ?? {}),
    run: (backend, args) => backend.getEditorDiagnostics(args)
  }),
  define<{}>({
    name: "ue_get_editor_state",
    description: "Return a bounded Unreal editor readiness snapshot for the current session.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    },
    annotations: readOnlyAnnotations(),
    parseArgs: (args) => emptySchema.parse(args ?? {}),
    run: (backend) => backend.getEditorState()
  }),
  define<{}>({
    name: "ue_get_viewport_camera",
    description: "Read the active Unreal editor viewport camera state. Use this before visual navigation decisions when you need to know where the active viewport is currently looking from.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    },
    annotations: readOnlyAnnotations(),
    parseArgs: (args) => getViewportCameraSchema.parse(args ?? {}),
    run: (backend) => backend.getViewportCamera()
  }),
  define<SetViewportCameraInput>({
    name: "ue_set_viewport_camera",
    description: "Set the active Unreal editor viewport camera location and rotation. Use this only for bounded navigation when visual verification requires a known camera pose.",
    inputSchema: {
      type: "object",
      properties: {
        location: {
          type: "object",
          properties: {
            x: { type: "number" },
            y: { type: "number" },
            z: { type: "number" }
          },
          required: ["x", "y", "z"],
          additionalProperties: false
        },
        rotation: {
          type: "object",
          properties: {
            pitch: { type: "number" },
            yaw: { type: "number" },
            roll: { type: "number" }
          },
          required: ["pitch", "yaw", "roll"],
          additionalProperties: false
        }
      },
      required: ["location", "rotation"],
      additionalProperties: false
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    },
    parseArgs: (args) => setViewportCameraSchema.parse(args ?? {}),
    run: (backend, args) => backend.setViewportCamera(args)
  }),
  define<SpawnActorInput>({
    name: "ue_spawn_actor_safe",
    description: "Spawn one actor into the editor world at an explicit transform. This bounded mutation supports safe project and project-plugin actor classes, plus a small native fast-path, and rejects out-of-scope, abstract, or non-actor classes.",
    inputSchema: {
      type: "object",
      properties: {
        className: { type: "string" },
        classPath: { type: "string" },
        location: {
          type: "object",
          properties: {
            x: { type: "number" },
            y: { type: "number" },
            z: { type: "number" }
          },
          required: ["x", "y", "z"],
          additionalProperties: false
        },
        rotation: {
          type: "object",
          properties: {
            pitch: { type: "number" },
            yaw: { type: "number" },
            roll: { type: "number" }
          },
          required: ["pitch", "yaw", "roll"],
          additionalProperties: false
        },
        selectAfterSpawn: { type: "boolean" },
        label: { type: "string", maxLength: 128 }
      },
      required: ["location", "rotation"],
      additionalProperties: false
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    },
    parseArgs: (args) => spawnActorSchema.parse(args ?? {}),
    run: (backend, args) => backend.spawnActor(args)
  }),
  define<SelectActorInput>({
    name: "ue_select_actor_safe",
    description: "Select a single target actor in the editor by actorName or objectPath. This is a bounded editor mutation for editor focus and follow-up tooling.",
    inputSchema: {
      type: "object",
      properties: {
        target: {
          type: "object",
          properties: {
            objectPath: { type: "string", description: "Canonical Unreal object path." },
            actorName: { type: "string" }
          },
          additionalProperties: false
        }
      },
      required: ["target"],
      additionalProperties: false
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    },
    parseArgs: (args) => selectActorSchema.parse(args ?? {}),
    run: (backend, args) => backend.selectActor(args)
  }),
  define<DestroyActorInput>({
    name: "ue_destroy_actor_safe",
    description: "Destroy one targeted actor in the editor world. This stays intentionally narrow and only permits actors whose classes remain inside the safe spawn/mutation policy.",
    inputSchema: {
      type: "object",
      properties: {
        target: {
          type: "object",
          properties: {
            objectPath: { type: "string", description: "Canonical Unreal object path." },
            actorName: { type: "string" }
          },
          additionalProperties: false
        }
      },
      required: ["target"],
      additionalProperties: false
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false
    },
    parseArgs: (args) => destroyActorSchema.parse(args ?? {}),
    run: (backend, args) => backend.destroyActor(args)
  }),
  define<FrameActorInput>({
    name: "ue_frame_actor",
    description: "Move the active Unreal editor viewport camera to frame a target actor. Use this before screenshot capture when the object may be too small, too far away, or outside the current view.",
    inputSchema: {
      type: "object",
      properties: {
        target: {
          type: "object",
          properties: {
            objectPath: { type: "string", description: "Canonical Unreal object path." },
            actorName: { type: "string" }
          },
          additionalProperties: false
        },
        activeViewportOnly: { type: "boolean" }
      },
      required: ["target"],
      additionalProperties: false
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    },
    parseArgs: (args) => frameActorSchema.parse(args ?? {}),
    run: (backend, args) => backend.frameActor(args)
  }),
  define<CaptureViewportToolArgs>({
    name: "ue_get_viewport_screenshot",
    description: "Capture the active Unreal editor viewport as an image for visual verification. Use this when the task depends on what is actually visible in the viewport, especially for DrawDebugLine, debug shapes, layout/material regressions, or any viewport-only rendering question. Prefer this over guessing from code when the answer is visual.",
    inputSchema: {
      type: "object",
      properties: {
        maxDimension: { type: "integer", minimum: 256, maximum: 4096 },
        viewMode: {
          type: "string",
          enum: ["current", "lit", "unlit", "wireframe", "detail_lighting", "lighting_only", "collision_pawn", "collision_visibility"]
        },
        crop: {
          type: "object",
          properties: {
            x: { type: "integer", minimum: 0 },
            y: { type: "integer", minimum: 0 },
            width: { type: "integer", minimum: 1 },
            height: { type: "integer", minimum: 1 }
          },
          required: ["x", "y", "width", "height"],
          additionalProperties: false
        },
        saveToFile: { type: "string" }
      },
      additionalProperties: false
    },
    annotations: readOnlyAnnotations(),
    parseArgs: (args) => getViewportScreenshotSchema.parse(args ?? {}),
    run: async (backend, args) => {
      const screenshot = await backend.getViewportScreenshot({
        maxDimension: args.maxDimension,
        viewMode: args.viewMode,
        crop: args.crop
      });

      return saveViewportImage(screenshot, {
        saveToFile: args.saveToFile
      });
    },
    formatResult: (result) => imageResponse(result as ViewportScreenshotResult)
  }),
  define<CaptureActorScreenshotToolArgs>({
    name: "ue_capture_actor_screenshot",
    description: "Frame a target actor in the active Unreal editor viewport and then capture a screenshot. Use this for small, distant, or newly generated objects when a raw viewport screenshot might miss the subject.",
    inputSchema: {
      type: "object",
      properties: {
        target: {
          type: "object",
          properties: {
            objectPath: { type: "string", description: "Canonical Unreal object path." },
            actorName: { type: "string" }
          },
          additionalProperties: false
        },
        activeViewportOnly: { type: "boolean" },
        maxDimension: { type: "integer", minimum: 256, maximum: 4096 },
        viewMode: {
          type: "string",
          enum: ["current", "lit", "unlit", "wireframe", "detail_lighting", "lighting_only", "collision_pawn", "collision_visibility"]
        },
        crop: {
          type: "object",
          properties: {
            x: { type: "integer", minimum: 0 },
            y: { type: "integer", minimum: 0 },
            width: { type: "integer", minimum: 1 },
            height: { type: "integer", minimum: 1 }
          },
          required: ["x", "y", "width", "height"],
          additionalProperties: false
        },
        saveToFile: { type: "string" }
      },
      required: ["target"],
      additionalProperties: false
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    },
    parseArgs: (args) => captureActorScreenshotSchema.parse(args ?? {}),
    run: async (backend, args) => {
      await backend.frameActor({
        target: args.target,
        activeViewportOnly: args.activeViewportOnly
      });
      const screenshot = await backend.getViewportScreenshot({
        maxDimension: args.maxDimension,
        viewMode: args.viewMode,
        crop: args.crop
      });

      return saveViewportImage(screenshot, {
        saveToFile: args.saveToFile
      });
    },
    formatResult: (result) => imageResponse(result as ViewportScreenshotResult)
  }),
  define<CompareViewportToolArgs>({
    name: "ue_compare_viewport_screenshot",
    description: "Capture the active Unreal viewport and compare it to a reference image on disk. Use this for visual regression checks after a meaningful state change instead of manually eyeballing two images.",
    inputSchema: {
      type: "object",
      properties: {
        referenceImagePath: { type: "string" },
        maxDimension: { type: "integer", minimum: 256, maximum: 4096 },
        viewMode: {
          type: "string",
          enum: ["current", "lit", "unlit", "wireframe", "detail_lighting", "lighting_only", "collision_pawn", "collision_visibility"]
        },
        crop: {
          type: "object",
          properties: {
            x: { type: "integer", minimum: 0 },
            y: { type: "integer", minimum: 0 },
            width: { type: "integer", minimum: 1 },
            height: { type: "integer", minimum: 1 }
          },
          required: ["x", "y", "width", "height"],
          additionalProperties: false
        },
        saveCurrentToFile: { type: "string" },
        saveDiffToFile: { type: "string" },
        mismatchTolerance: { type: "number", minimum: 0, maximum: 1 },
        pixelThreshold: { type: "number", minimum: 0, maximum: 1 }
      },
      required: ["referenceImagePath"],
      additionalProperties: false
    },
    annotations: readOnlyAnnotations(),
    parseArgs: (args) => compareViewportScreenshotSchema.parse(args ?? {}),
    run: async (backend, args) => {
      const screenshot = await backend.getViewportScreenshot({
        maxDimension: args.maxDimension,
        viewMode: args.viewMode,
        crop: args.crop
      });
      const savedScreenshot = await saveViewportImage(screenshot, {
        saveToFile: args.saveCurrentToFile
      });

      return compareViewportToReference(savedScreenshot, {
        referenceImagePath: args.referenceImagePath,
        saveDiffToFile: args.saveDiffToFile,
        mismatchTolerance: args.mismatchTolerance,
        pixelThreshold: args.pixelThreshold
      });
    }
  }),
  define<GetDebugDrawStateInput>({
    name: "ue_get_debug_draw_state",
    description: "Inspect current debug draw primitives from Unreal line batchers. Use this together with viewport screenshots when verifying DrawDebugLine or other debug geometry so the agent can reason from structured geometry instead of pixels alone.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 200 },
        includePoints: { type: "boolean" }
      },
      additionalProperties: false
    },
    annotations: readOnlyAnnotations(),
    parseArgs: (args) => getDebugDrawStateSchema.parse(args ?? {}),
    run: (backend, args) => backend.getDebugDrawState(args)
  }),
  define<{}>({
    name: "ue_get_live_coding_status",
    description: "Return Unreal Live Coding availability and current session status.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    },
    annotations: readOnlyAnnotations(),
    parseArgs: (args) => emptySchema.parse(args ?? {}),
    run: (backend) => backend.getLiveCodingStatus()
  }),
  define<{}>({
    name: "ue_trigger_live_coding_build_safe",
    description: "Trigger a safe Live Coding compile/reload for the current editor session when available.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    },
    parseArgs: (args) => emptySchema.parse(args ?? {}),
    run: (backend) => backend.triggerLiveCodingBuild()
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
