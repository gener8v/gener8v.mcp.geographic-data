import { randomUUID } from "crypto";
import express, { type Request, type Response } from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { ApiClient } from "./api-client.js";
import { AuthManager } from "./auth.js";
import { getAllTools } from "./tools/index.js";
import { getAllResources, handleResourceRead } from "./resources/index.js";
import { allPrompts } from "./prompts.js";
import { Loc8nOAuthProvider } from "./oauth/provider.js";
import { InMemoryClientsStore, AuthorizationCodeStore, TokenStore } from "./oauth/stores.js";
import { ManageClient } from "./oauth/manage-client.js";

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
        prompts: {},
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
      annotations: t.annotations,
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

  // --- Prompt Handlers ---

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: allPrompts.map((p) => ({
      name: p.name,
      description: p.description,
      arguments: p.arguments,
    })),
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const prompt = allPrompts.find((p) => p.name === name);

    if (!prompt) {
      throw new Error(`Unknown prompt: ${name}`);
    }

    return {
      description: prompt.description,
      messages: prompt.getMessages(args ?? {}),
    };
  });

  return { server, apiClient, authManager };
}

function extractBearerToken(req: Request): string | null {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith("Bearer ")) {
    return auth.slice(7);
  }
  return null;
}

export async function startServer(options: ServerOptions) {
  if (options.transport === "stdio") {
    const { server } = createMcpServer(options);
    const transport = new StdioServerTransport();
    await server.connect(transport);
    return;
  }

  // --- HTTP transport mode (SSE + Streamable HTTP) ---

  const app = express();

  // Multi-tenant session tracking
  const sseSessions = new Map<
    string,
    { server: Server; transport: SSEServerTransport }
  >();
  const httpSessions = new Map<
    string,
    { server: Server; transport: StreamableHTTPServerTransport }
  >();

  // --- OAuth setup (when env vars are configured) ---

  const serviceSecret = process.env.LOC8N_SERVICE_SECRET;
  const auth0Domain = process.env.AUTH0_DOMAIN;
  const auth0ClientId = process.env.AUTH0_CLIENT_ID;
  const auth0ClientSecret = process.env.AUTH0_CLIENT_SECRET;
  const mcpServerUrl = process.env.MCP_SERVER_URL ?? `http://localhost:${options.port}`;
  const apiBaseUrl = options.apiBaseUrl ?? process.env.LOC8N_API_BASE_URL ?? "https://api.loc8n.com";

  const oauthEnabled = !!(serviceSecret && auth0Domain && auth0ClientId && auth0ClientSecret);

  let oauthProvider: Loc8nOAuthProvider | undefined;

  if (oauthEnabled) {
    const manageClient = new ManageClient(apiBaseUrl, serviceSecret);
    const clientsStore = new InMemoryClientsStore();
    const codeStore = new AuthorizationCodeStore();
    const tokenStore = new TokenStore();

    oauthProvider = new Loc8nOAuthProvider({
      clientsStore,
      codeStore,
      tokenStore,
      manageClient,
      auth0: {
        domain: auth0Domain,
        clientId: auth0ClientId,
        clientSecret: auth0ClientSecret,
      },
      mcpServerUrl,
    });

    // Mount the SDK's auth router (handles /.well-known/*, /authorize, /token, /register, /revoke)
    app.use(
      mcpAuthRouter({
        provider: oauthProvider,
        issuerUrl: new URL(mcpServerUrl),
        resourceServerUrl: new URL(`${mcpServerUrl}/mcp`),
        resourceName: "loc8n Geographic Data MCP Server",
        serviceDocumentationUrl: new URL("https://loc8n.com/docs/mcp"),
      }),
    );

    // Mount the Auth0 callback handler (bridge between Auth0 and MCP OAuth flow)
    app.get("/oauth/callback", (req, res) => oauthProvider!.handleCallback(req, res));

    console.error("OAuth enabled — Auth0 proxy at", mcpServerUrl);
  }

  // --- CORS middleware for non-OAuth routes ---

  app.use((req, res, next) => {
    // The mcpAuthRouter and requireBearerAuth handle their own CORS.
    // This covers the remaining routes (health, server-card, SSE, etc.)
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, Mcp-Session-Id",
    );
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }

    next();
  });

  // --- Server card (static metadata, no auth) ---

  app.get("/.well-known/mcp/server-card.json", (_req, res) => {
    const tools = getAllTools();
    const resources = getAllResources();
    const card = {
      name: SERVER_NAME,
      version: SERVER_VERSION,
      displayName: "loc8n Geographic Data",
      description:
        "U.S. demographics, housing, mortgage, migration, and employment data from the Census Bureau, HUD, HMDA, and LEHD. 23 tools across 7 categories.",
      homepage: "https://loc8n.com",
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
    res.json(card);
  });

  // --- Health check ---

  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      sessions: sseSessions.size + httpSessions.size,
      oauth: oauthEnabled,
    });
  });

  // --- Streamable HTTP transport at /mcp ---

  // When OAuth is enabled, protect /mcp with bearer auth middleware.
  // Unauthenticated clients get a proper 401 with WWW-Authenticate header
  // pointing to the OAuth metadata endpoint.
  // When OAuth is not enabled, fall back to API key auth.

  const mcpHandler = async (req: Request, res: Response) => {
    // Determine API key: from OAuth token, bearer header, query param, or env
    let apiKey: string;
    if (req.auth?.extra?.apiKey) {
      // OAuth-authenticated request — API key resolved during token exchange
      apiKey = req.auth.extra.apiKey as string;
    } else {
      apiKey =
        (req.query.apiKey as string) ??
        extractBearerToken(req) ??
        options.apiKey ??
        process.env.LOC8N_API_KEY ??
        "";
    }

    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    const existing = sessionId ? httpSessions.get(sessionId) : undefined;

    if (existing) {
      await existing.transport.handleRequest(req, res);
    } else if (req.method === "POST") {
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
      res.status(200).end();
    } else {
      res.status(400).json({
        error: "INVALID_SESSION",
        message: "Unknown or expired session. Send an initialize request first.",
      });
    }
  };

  if (oauthEnabled && oauthProvider) {
    // Protected /mcp endpoint — requires valid OAuth token
    // The middleware returns 401 with WWW-Authenticate header on failure,
    // which tells MCP clients how to authenticate via OAuth.
    const bearerAuth = requireBearerAuth({
      verifier: oauthProvider,
      resourceMetadataUrl: `${mcpServerUrl}/.well-known/oauth-protected-resource/mcp`,
    });
    app.all("/mcp", bearerAuth, mcpHandler);
  } else {
    // No OAuth — allow API key auth (backward compatible)
    app.all("/mcp", mcpHandler);
  }

  // --- SSE transport at /sse (legacy, always uses API key auth) ---

  app.get("/sse", async (req, res) => {
    const apiKey =
      (req.query.apiKey as string) ??
      extractBearerToken(req) ??
      options.apiKey ??
      process.env.LOC8N_API_KEY ??
      "";

    if (!apiKey) {
      res.status(401).json({
        error: "AUTH_ERROR",
        message:
          "API key required. Pass ?apiKey= query parameter or Authorization: Bearer header.",
      });
      return;
    }

    const { server } = createMcpServer({ ...options, apiKey });
    const transport = new SSEServerTransport("/messages", res);
    const sessionId = transport.sessionId;

    sseSessions.set(sessionId, { server, transport });

    res.on("close", () => {
      sseSessions.delete(sessionId);
      server.close().catch(() => {});
    });

    await server.connect(transport);
  });

  app.post("/messages", async (req, res) => {
    const sessionId = req.query.sessionId as string | null;
    const session = sessionId ? sseSessions.get(sessionId) : undefined;

    if (session) {
      await session.transport.handlePostMessage(req, res);
    } else {
      res.status(400).json({
        error: "INVALID_SESSION",
        message: "Unknown or expired session. Reconnect to /sse.",
      });
    }
  });

  // --- Start listening ---

  app.listen(options.port, () => {
    console.error(
      `MCP server listening on http://localhost:${options.port}`,
    );
    console.error(`  Streamable HTTP: http://localhost:${options.port}/mcp`);
    console.error(`  SSE endpoint: http://localhost:${options.port}/sse`);
    console.error(
      `  Health check: http://localhost:${options.port}/health`,
    );
    if (oauthEnabled) {
      console.error(`  OAuth metadata: ${mcpServerUrl}/.well-known/oauth-authorization-server`);
      console.error(`  Resource metadata: ${mcpServerUrl}/.well-known/oauth-protected-resource/mcp`);
    }
  });
}
