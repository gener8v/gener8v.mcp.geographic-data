import { randomUUID } from "crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
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
  if (options.transport === "stdio") {
    const { server } = createMcpServer(options);
    const transport = new StdioServerTransport();
    await server.connect(transport);
  } else {
    // Multi-tenant: each connection gets its own MCP server instance
    // keyed by the client's API key.
    const sseSessions = new Map<
      string,
      { server: Server; transport: SSEServerTransport }
    >();
    const httpSessions = new Map<
      string,
      { server: Server; transport: StreamableHTTPServerTransport }
    >();

    const httpServer = createServer(
      async (req: IncomingMessage, res: ServerResponse) => {
        const url = new URL(req.url ?? "/", `http://localhost:${options.port}`);

        // CORS headers
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
        res.setHeader(
          "Access-Control-Allow-Headers",
          "Content-Type, Authorization, Mcp-Session-Id",
        );
        res.setHeader(
          "Access-Control-Expose-Headers",
          "Mcp-Session-Id",
        );

        if (req.method === "OPTIONS") {
          res.writeHead(204);
          res.end();
          return;
        }

        if (url.pathname === "/.well-known/mcp/server-card.json") {
          const tools = getAllTools();
          const resources = getAllResources();
          const card = {
            name: SERVER_NAME,
            version: SERVER_VERSION,
            displayName: "loc8n Geographic Data",
            description:
              "U.S. demographics, housing, mortgage, migration, and employment data from the Census Bureau, HUD, HMDA, and LEHD. 23 tools across 7 categories.",
            iconUrl:
              "https://gener8v-brand-assets.s3.us-east-2.amazonaws.com/logo/loc8n.png",
            repository:
              "https://github.com/gener8v/gener8v.mcp.geographic-data",
            tools: tools.map((t) => ({
              name: t.name,
              description: t.description,
              inputSchema: t.inputSchema,
            })),
            resources: resources.map((r) => ({
              uri: r.uri,
              name: r.name,
              description: r.description,
            })),
          };
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(card));
          return;
        }

        if (url.pathname === "/health") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              status: "ok",
              sessions: sseSessions.size + httpSessions.size,
            }),
          );
          return;
        }

        // --- Streamable HTTP transport at /mcp ---
        if (url.pathname === "/mcp") {
          const apiKey =
            url.searchParams.get("apiKey") ??
            extractBearerToken(req) ??
            options.apiKey ??
            process.env.LOC8N_API_KEY ??
            "";

          const sessionId = req.headers["mcp-session-id"] as string | undefined;
          let transport = sessionId ? httpSessions.get(sessionId) : undefined;

          if (transport) {
            await transport.transport.handleRequest(req, res);
          } else if (req.method === "POST") {
            // New session — if no API key, create a discovery-only server
            // that responds to initialize/tools/list but rejects tool calls.
            const { server } = createMcpServer({ ...options, apiKey: apiKey || "discovery" });
            const newTransport = new StreamableHTTPServerTransport({
              sessionIdGenerator: () => randomUUID(),
              onsessioninitialized: (id) => {
                httpSessions.set(id, { server, transport: newTransport });
              },
            });

            newTransport.onclose = () => {
              const sid = newTransport.sessionId;
              if (sid) httpSessions.delete(sid);
            };

            await server.connect(newTransport);
            await newTransport.handleRequest(req, res);
          } else if (req.method === "DELETE") {
            // Session teardown — allow without auth
            res.writeHead(200);
            res.end();
          } else {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                error: "INVALID_SESSION",
                message: "Unknown or expired session. Send an initialize request first.",
              }),
            );
          }
          return;
        }

        // --- SSE transport at /sse (legacy) ---
        if (url.pathname === "/sse" && req.method === "GET") {
          // API key from query param, Authorization header, or env fallback
          const apiKey =
            url.searchParams.get("apiKey") ??
            extractBearerToken(req) ??
            options.apiKey ??
            process.env.LOC8N_API_KEY ??
            "";

          if (!apiKey) {
            res.writeHead(401, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                error: "AUTH_ERROR",
                message:
                  "API key required. Pass ?apiKey= query parameter or Authorization: Bearer header.",
              }),
            );
            return;
          }

          const { server } = createMcpServer({ ...options, apiKey });
          const transport = new SSEServerTransport("/messages", res);
          const sessionId = transport.sessionId;

          sseSessions.set(sessionId, { server, transport });

          // Clean up on disconnect
          res.on("close", () => {
            sseSessions.delete(sessionId);
            server.close().catch(() => {});
          });

          await server.connect(transport);
          return;
        }

        if (url.pathname === "/messages" && req.method === "POST") {
          const sessionId = url.searchParams.get("sessionId");
          const session = sessionId ? sseSessions.get(sessionId) : undefined;

          if (session) {
            await session.transport.handlePostMessage(req, res);
          } else {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                error: "INVALID_SESSION",
                message: "Unknown or expired session. Reconnect to /sse.",
              }),
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
      console.error(`  Streamable HTTP: http://localhost:${options.port}/mcp`);
      console.error(`  SSE endpoint: http://localhost:${options.port}/sse`);
      console.error(
        `  Health check: http://localhost:${options.port}/health`,
      );
    });
  }
}

function extractBearerToken(req: IncomingMessage): string | null {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith("Bearer ")) {
    return auth.slice(7);
  }
  return null;
}
