import type { RateLimitInfo, SourceAttribution, ToolResponse } from "./types.js";

export function formatResponse(
  data: unknown,
  source: SourceAttribution,
  rateLimit?: RateLimitInfo,
): { content: Array<{ type: "text"; text: string }> } {
  const response: ToolResponse = {
    data,
    source,
    metadata: {},
  };

  if (rateLimit && rateLimit.limit > 0) {
    response.metadata.rateLimit = rateLimit;
  }

  return {
    content: [{ type: "text", text: JSON.stringify(response) }],
  };
}

export function formatError(
  code: string,
  message: string,
  details?: unknown,
): { content: Array<{ type: "text"; text: string }>; isError: true } {
  return {
    content: [{ type: "text", text: JSON.stringify({ error: code, message, details }) }],
    isError: true,
  };
}
