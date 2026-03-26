import type { ApiClient } from "../api-client.js";
import type { AuthManager } from "../auth.js";
import { ApiError } from "../types.js";

export interface ResourceDefinition {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

const PRICING_FIELDS = [
  "priceCents",
  "priceLabel",
  "stripePriceId",
  "billingPeriod",
];

function stripPricingFields(tiers: unknown[]): unknown[] {
  return tiers.map((tier) => {
    if (tier && typeof tier === "object") {
      const cleaned = { ...tier } as Record<string, unknown>;
      for (const field of PRICING_FIELDS) {
        delete cleaned[field];
      }
      return cleaned;
    }
    return tier;
  });
}

function resourceContents(uri: string, data: unknown) {
  return {
    contents: [
      {
        uri,
        mimeType: "application/json",
        text: JSON.stringify(data),
      },
    ],
  };
}

function resourceError(uri: string, message: string) {
  return {
    contents: [
      {
        uri,
        mimeType: "application/json",
        text: JSON.stringify({ error: "RESOURCE_ERROR", message }),
      },
    ],
  };
}

export function getAllResources(): ResourceDefinition[] {
  return [
    {
      uri: "data://demographics/available-years",
      name: "Demographics Available Years",
      description:
        "Available data years for demographics data (American Community Survey 5-Year Estimates). " +
        "Use this to validate year parameters before calling demographics tools.",
      mimeType: "application/json",
    },
    {
      uri: "data://fmr/available-years",
      name: "Fair Market Rent Available Years",
      description:
        "Available data years for HUD Fair Market Rent data. " +
        "Use this to validate year parameters before calling FMR tools.",
      mimeType: "application/json",
    },
    {
      uri: "data://mortgage/available-years",
      name: "Mortgage Available Years",
      description:
        "Available data years for HMDA mortgage data. " +
        "Use this to validate year parameters before calling mortgage tools.",
      mimeType: "application/json",
    },
    {
      uri: "data://migration/available-years",
      name: "Migration Available Years",
      description:
        "Available year pairs for IRS SOI migration data. Migration data uses year pairs " +
        "(e.g., 2021-2022) representing moves between consecutive tax filing years.",
      mimeType: "application/json",
    },
    {
      uri: "data://employment/available-years",
      name: "Employment Available Years",
      description:
        "Available data years for LODES employment data. " +
        "Requires Business tier or above (employment:read permission).",
      mimeType: "application/json",
    },
    {
      uri: "data://tiers",
      name: "Tier & Permission Model",
      description:
        "Platform tier definitions including permissions, rate limits, and features. " +
        "Use this to understand what data each subscription tier can access.",
      mimeType: "application/json",
    },
    {
      uri: "data://auth/context",
      name: "Current API Key Context",
      description:
        "Information about the current API key's tier, permissions, and rate limits. " +
        "Use this to check what the current key can access before invoking tools.",
      mimeType: "application/json",
    },
  ];
}

export async function handleResourceRead(
  uri: string,
  client: ApiClient,
  authManager: AuthManager,
): Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }> {
  try {
    switch (uri) {
      case "data://demographics/available-years": {
        const { data } = await client.get<unknown>(
          "/demographics/available-years",
          { areaType: "county" },
        );
        return resourceContents(uri, data);
      }

      case "data://fmr/available-years": {
        const { data } = await client.get<unknown>(
          "/demographics/available-years",
          { areaType: "county", source: "fmr" },
        );
        return resourceContents(uri, data);
      }

      case "data://mortgage/available-years": {
        const { data } = await client.get<unknown>("/mortgage/years");
        return resourceContents(uri, data);
      }

      case "data://migration/available-years": {
        const { data } = await client.get<unknown>("/migration/years");
        return resourceContents(uri, data);
      }

      case "data://employment/available-years": {
        const { data } = await client.get<unknown>("/employment/years");
        return resourceContents(uri, data);
      }

      case "data://tiers": {
        const { data } = await client.get<unknown[]>("/tiers");
        const cleaned = Array.isArray(data) ? stripPricingFields(data) : data;
        return resourceContents(uri, cleaned);
      }

      case "data://auth/context": {
        const context = authManager.getAuthContext();
        return resourceContents(uri, context);
      }

      default:
        return resourceError(uri, `Unknown resource: ${uri}`);
    }
  } catch (error) {
    if (error instanceof ApiError) {
      return resourceError(uri, error.message);
    }
    return resourceError(
      uri,
      error instanceof Error ? error.message : "An unexpected error occurred.",
    );
  }
}
