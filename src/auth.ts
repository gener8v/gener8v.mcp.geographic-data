import { ApiClient } from "./api-client.js";
import { ApiError, ErrorCode } from "./types.js";

interface CachedAuth {
  tier: string;
  permissions: string[];
  rateLimits: {
    requestsPerMinute: number;
    requestsPerMonth: number;
  };
}

const PERMISSION_MAP: Record<string, string> = {
  lookup_zip_code: "zip:read",
  search_zip_codes_by_city: "zip:read",
  find_zip_codes_in_radius: "zip:read",
  calculate_zip_code_distance: "zip:read",
  search_areas: "zip:read",
  get_demographics: "demographics:read",
  get_demographics_category: "demographics:read",
  get_demographics_trend: "demographics:read",
  compare_demographics: "demographics:read",
  get_fair_market_rent: "market-data:read",
  get_fmr_trend: "market-data:read",
  get_mortgage_summary: "mortgage:read",
  get_mortgage_trends: "mortgage:read",
  compare_mortgage: "mortgage:read",
  get_migration_summary: "migration:read",
  get_migration_flows: "migration:read",
  get_migration_trends: "migration:read",
  get_employment: "employment:read",
  get_employment_trend: "employment:read",
  compare_employment: "employment:read",
  get_commute_flows: "employment:read",
  geocode_address: "geocoding:read",
  reverse_geocode: "geocoding:read",
};

export class AuthManager {
  private cached: CachedAuth | null = null;
  private validated = false;
  private invalid = false;

  constructor(private readonly client: ApiClient) {}

  async ensureValidKey(): Promise<void> {
    if (this.invalid) {
      throw new ApiError(
        ErrorCode.AUTH_ERROR,
        "API key is invalid. Set a valid LOC8N_API_KEY environment variable.",
      );
    }

    if (this.validated) return;

    try {
      // Use GET /tiers as a lightweight validation proxy
      const response = await this.client.get<
        Array<{
          name: string;
          permissions: string[];
          requestsPerMinute: number;
          requestsPerMonth: number;
        }>
      >("/tiers");

      // Key is valid if we got a response. Determine tier from permissions.
      // The actual key's tier/permissions come from rate limit headers and
      // the key metadata. For now, cache what we can from the tiers list.
      // A more precise approach: check a real endpoint and observe the
      // permissions from a subsequent call. For v1, we delegate permission
      // checks to the upstream API and cache lazily.
      this.validated = true;

      // We don't know the key's tier from /tiers alone — that endpoint
      // returns all tiers. We'll populate the cache on first tool call
      // by observing what succeeds vs. gets 403.
      // For now, mark as validated (key is active) with empty permissions.
      if (!this.cached) {
        this.cached = {
          tier: "unknown",
          permissions: [],
          rateLimits: {
            requestsPerMinute: response.rateLimit.limit,
            requestsPerMonth: 0,
          },
        };
      }
    } catch (error) {
      if (error instanceof ApiError && error.code === ErrorCode.AUTH_ERROR) {
        this.invalid = true;
      }
      throw error;
    }
  }

  checkPermission(toolName: string): void {
    // Permission is enforced by the upstream API. The local check is
    // a fast path for known-invalid keys. If we don't have cached
    // permissions yet, we let the request through and the API will
    // return 403 if the key lacks access.
    const _requiredPermission = PERMISSION_MAP[toolName];
    // Intentionally a no-op for v1 — upstream enforces permissions.
    // Future: use cached permissions for pre-flight checks.
  }

  getAuthContext(): {
    tier: string;
    permissions: string[];
    rateLimits: { requestsPerMinute: number; requestsPerMonth: number };
    status: string;
  } {
    if (this.invalid) {
      return {
        tier: "unknown",
        permissions: [],
        rateLimits: { requestsPerMinute: 0, requestsPerMonth: 0 },
        status: "invalid",
      };
    }

    if (!this.cached) {
      return {
        tier: "unknown",
        permissions: [],
        rateLimits: { requestsPerMinute: 0, requestsPerMonth: 0 },
        status: "not_validated",
      };
    }

    return { ...this.cached, status: "active" };
  }

  /** Returns the required permission for a tool, or undefined if not mapped. */
  getRequiredPermission(toolName: string): string | undefined {
    return PERMISSION_MAP[toolName];
  }
}
