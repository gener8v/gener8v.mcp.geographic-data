import { ApiError, ErrorCode, type ApiResponse, type RateLimitInfo } from "./types.js";

export class ApiClient {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
  ) {}

  async get<T>(
    path: string,
    params?: Record<string, string | number | boolean | undefined>,
  ): Promise<ApiResponse<T>> {
    const url = new URL(path, this.baseUrl);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    let response: Response;
    try {
      response = await fetch(url.toString(), {
        method: "GET",
        headers: {
          "X-API-Key": this.apiKey,
          Accept: "application/json",
        },
      });
    } catch (error) {
      throw new ApiError(
        ErrorCode.UPSTREAM_ERROR,
        `Failed to reach API: ${error instanceof Error ? error.message : "Network error"}`,
      );
    }

    const rateLimit = this.extractRateLimit(response.headers);

    if (!response.ok) {
      await this.handleErrorResponse(response);
    }

    const body = (await response.json()) as Record<string, unknown>;
    const data = body.data !== undefined ? body.data : body;

    return { data: data as T, rateLimit };
  }

  private extractRateLimit(headers: Headers): RateLimitInfo {
    return {
      limit: parseInt(headers.get("x-ratelimit-limit") ?? "0", 10),
      remaining: parseInt(headers.get("x-ratelimit-remaining") ?? "0", 10),
      resetAt: headers.get("x-ratelimit-reset") ?? "",
    };
  }

  private async handleErrorResponse(response: Response): Promise<never> {
    let errorBody: { error?: { code?: string; message?: string; details?: unknown } } = {};
    try {
      errorBody = (await response.json()) as typeof errorBody;
    } catch {
      // Non-JSON error response
    }

    const upstreamMessage =
      errorBody.error?.message ?? response.statusText ?? "Unknown error";
    const upstreamDetails = errorBody.error?.details;

    switch (response.status) {
      case 400:
        throw new ApiError(
          ErrorCode.VALIDATION_ERROR,
          upstreamMessage,
          upstreamDetails,
        );
      case 401:
        throw new ApiError(
          ErrorCode.AUTH_ERROR,
          "Invalid or missing API key. Set LOC8N_API_KEY environment variable.",
        );
      case 403:
        throw new ApiError(
          ErrorCode.PERMISSION_DENIED,
          upstreamMessage,
          upstreamDetails,
        );
      case 404:
        throw new ApiError(ErrorCode.NOT_FOUND, upstreamMessage);
      case 429: {
        const retryAfter = response.headers.get("retry-after");
        throw new ApiError(ErrorCode.RATE_LIMITED, "Rate limit exceeded.", {
          retryAfterSeconds: retryAfter ? parseInt(retryAfter, 10) : undefined,
        });
      }
      default:
        throw new ApiError(
          ErrorCode.UPSTREAM_ERROR,
          `API returned ${response.status}: ${upstreamMessage}`,
        );
    }
  }
}
