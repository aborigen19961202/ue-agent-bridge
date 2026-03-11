import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { AppConfig } from "../config/index.js";
import { UnrealBackend } from "../backend/unreal-backend.js";
import { errorResponse, jsonResponse } from "../utils/format.js";
import { toErrorMessage } from "../utils/errors.js";
import { Logger } from "../utils/logger.js";
import { getToolDefinition, toolDefinitions } from "../tools/definitions.js";

export function createServer(config: AppConfig, backend: UnrealBackend, logger: Logger): Server {
  const server = new Server(
    {
      name: "ue-agentbridge",
      version: "0.1.0"
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: toolDefinitions.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations
      }))
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const definition = getToolDefinition(request.params.name);

    if (!definition) {
      return errorResponse(`Unknown tool: ${request.params.name}`);
    }

    try {
      const args = definition.parseArgs(request.params.arguments ?? {});
      logger.info("Tool called", {
        tool: definition.name,
        backend: backend.name
      });

      const result = await definition.run(backend, args);
      return jsonResponse(result);
    } catch (error) {
      logger.error("Tool failed", {
        tool: definition.name,
        error: toErrorMessage(error)
      });
      return errorResponse(toErrorMessage(error));
    }
  });

  logger.debug("Server created", {
    backend: backend.name,
    mode: config.backendMode
  });

  return server;
}

export async function startServer(server: Server): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
