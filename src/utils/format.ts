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
