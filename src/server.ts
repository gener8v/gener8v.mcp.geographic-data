import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { ApiClient } from "./api-client.js";
import { AuthManager } from "./auth.js";
import { getAllTools } from "./tools/index.js";
import { getAllResources, handleResourceRead } from "./resources/index.js";

const SERVER_NAME = "gener8v-geographic-data";
const SERVER_VERSION = "0.1.0";

export interface ServerOptions {
  transport: "stdio" | "sse";
  port: number;
  apiKey?: string;
  apiBaseUrl?: string;
}

export function createMcpServer(options: ServerOptions) {
  const apiKey = options.apiKey ?? process.env.LOC8N_API_KEY ?? "";
  const apiBaseUrl =
    options.apiBaseUrl ??
    process.env.LOC8N_API_BASE_URL ??
    "https://api.loc8n.com";

  const apiClient = new ApiClient(apiKey, apiBaseUrl);
  const authManager = new AuthManager(apiClient);

  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    },
  );

  // --- Tool Handlers ---

  const tools = getAllTools();

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const tool = tools.find((t) => t.name === name);

    if (!tool) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: "NOT_FOUND",
              message: `Unknown tool: ${name}`,
            }),
          },
        ],
        isError: true,
      };
    }

    try {
      await authManager.ensureValidKey();
      authManager.checkPermission(name);
      return await tool.handler(args ?? {}, apiClient, authManager);
    } catch (error) {
      const { code, message, details } =
        error instanceof Error && "code" in error
          ? (error as { code: string; message: string; details?: unknown })
          : {
              code: "INTERNAL_ERROR",
              message:
                error instanceof Error ? error.message : "Unknown error",
              details: undefined,
            };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: code, message, details }),
          },
        ],
        isError: true,
      };
    }
  });

  // --- Resource Handlers ---

  const resources = getAllResources();

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: resources.map((r) => ({
      uri: r.uri,
      name: r.name,
      description: r.description,
      mimeType: r.mimeType,
    })),
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;
    return handleResourceRead(uri, apiClient, authManager);
  });

  return { server, apiClient, authManager };
}

export async function startServer(options: ServerOptions) {
  const { server } = createMcpServer(options);

  if (options.transport === "stdio") {
    const transport = new StdioServerTransport();
    await server.connect(transport);
  } else {
    // SSE transport
    let currentTransport: SSEServerTransport | null = null;

    const httpServer = createServer(
      async (req: IncomingMessage, res: ServerResponse) => {
        const url = new URL(req.url ?? "/", `http://localhost:${options.port}`);

        // CORS headers
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");

        if (req.method === "OPTIONS") {
          res.writeHead(204);
          res.end();
          return;
        }

        if (url.pathname === "/health") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "ok" }));
          return;
        }

        if (url.pathname === "/sse" && req.method === "GET") {
          currentTransport = new SSEServerTransport("/messages", res);
          await server.connect(currentTransport);
          return;
        }

        if (url.pathname === "/messages" && req.method === "POST") {
          if (currentTransport) {
            await currentTransport.handlePostMessage(req, res);
          } else {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({ error: "No active SSE connection" }),
            );
          }
          return;
        }

        res.writeHead(404);
        res.end();
      },
    );

    httpServer.listen(options.port, () => {
      console.error(
        `MCP server (SSE) listening on http://localhost:${options.port}`,
      );
      console.error(`  SSE endpoint: http://localhost:${options.port}/sse`);
      console.error(
        `  Health check: http://localhost:${options.port}/health`,
      );
    });
  }
}
