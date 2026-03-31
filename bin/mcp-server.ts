#!/usr/bin/env node

import { startServer } from "../src/server.js";

function parseArgs(argv: string[]): { transport: "stdio" | "sse"; port: number } {
  let transport: "stdio" | "sse" = "stdio";
  let port = 3100;

  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--transport" && argv[i + 1]) {
      const value = argv[i + 1];
      if (value === "stdio" || value === "sse") {
        transport = value;
      } else {
        console.error(`Invalid transport: ${value}. Use "stdio" or "sse".`);
        process.exit(1);
      }
      i++;
    } else if (argv[i] === "--port" && argv[i + 1]) {
      port = parseInt(argv[i + 1], 10);
      if (isNaN(port) || port < 1 || port > 65535) {
        console.error(`Invalid port: ${argv[i + 1]}`);
        process.exit(1);
      }
      i++;
    } else if (argv[i] === "--help" || argv[i] === "-h") {
      console.log(`Usage: mcp-geographic-data [options]

Options:
  --transport <stdio|sse>  Transport protocol (default: stdio)
  --port <number>          Port for SSE transport (default: 3100)
  --help, -h               Show this help message

Environment:
  LOC8N_API_KEY            API key for the loc8n Geographic Data API (required for stdio)
  LOC8N_API_BASE_URL       API base URL (default: https://api.loc8n.com)

OAuth (optional, enables OAuth discovery on HTTP transport):
  MCP_SERVER_URL           Public URL of this MCP server (e.g. https://mcp.loc8n.com)
  AUTH0_DOMAIN             Auth0 domain (e.g. auth.loc8n.com)
  AUTH0_CLIENT_ID          Auth0 application client ID
  AUTH0_CLIENT_SECRET      Auth0 application client secret
  LOC8N_SERVICE_SECRET     Service secret for /manage/* API endpoints`);
      process.exit(0);
    }
  }

  return { transport, port };
}

const options = parseArgs(process.argv);
startServer(options).catch((error) => {
  console.error("Failed to start MCP server:", error);
  process.exit(1);
});
