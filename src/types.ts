export interface RateLimitInfo {
  limit: number;
  remaining: number;
  resetAt: string;
}

export interface SourceAttribution {
  name: string;
  vintage: string | null;
  api: string;
}

export interface ToolResponse {
  data: unknown;
  source: SourceAttribution;
  metadata: {
    rateLimit?: RateLimitInfo;
    totalResults?: number;
  };
}

export interface ApiResponse<T> {
  data: T;
  rateLimit: RateLimitInfo;
}

export const ErrorCode = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  NOT_FOUND: "NOT_FOUND",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  RATE_LIMITED: "RATE_LIMITED",
  AUTH_ERROR: "AUTH_ERROR",
  UPSTREAM_ERROR: "UPSTREAM_ERROR",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export class ApiError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
