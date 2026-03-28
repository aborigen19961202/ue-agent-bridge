import { ViewportScreenshotResult } from "../types/domain.js";
import { ToolResponse } from "../types/tool.js";

export function jsonResponse(value: unknown): ToolResponse {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2)
      }
    ]
  };
}

export function errorResponse(message: string): ToolResponse {
  return {
    content: [
      {
        type: "text",
        text: message
      }
    ],
    isError: true
  };
}

export function imageResponse(value: ViewportScreenshotResult): ToolResponse {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          capturedAt: value.capturedAt,
          source: value.source,
          projectName: value.projectName,
          currentMap: value.currentMap,
          pieActive: value.pieActive,
          savedPath: value.savedPath ?? null,
          viewport: value.viewport,
          camera: value.camera
        }, null, 2)
      },
      {
        type: "image",
        data: value.dataBase64,
        mimeType: value.mimeType
      }
    ]
  };
}
