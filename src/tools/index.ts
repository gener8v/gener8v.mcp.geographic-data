import type { ApiClient } from "../api-client.js";
import type { AuthManager } from "../auth.js";
import { geographicTools } from "./geographic.js";
import { demographicsTools } from "./demographics.js";
import { housingTools } from "./housing.js";
import { mortgageTools } from "./mortgage.js";
import { migrationTools } from "./migration.js";
import { employmentTools } from "./employment.js";
import { geocodingTools } from "./geocoding.js";

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  handler: (
    args: Record<string, unknown>,
    client: ApiClient,
    auth: AuthManager,
  ) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;
}

export function getAllTools(): ToolDefinition[] {
  return [
    ...geographicTools,
    ...demographicsTools,
    ...housingTools,
    ...mortgageTools,
    ...migrationTools,
    ...employmentTools,
    ...geocodingTools,
  ];
}
