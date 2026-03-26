import type { ApiClient } from "../api-client.js";
import type { AuthManager } from "../auth.js";
import { formatResponse, formatError } from "../response.js";
import { ApiError, ErrorCode } from "../types.js";
import type { ToolDefinition } from "./index.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AREA_TYPES = [
  "zip",
  "county",
  "state",
  "place",
  "cbsa",
  "tract",
  "block_group",
] as const;

type AreaType = (typeof AREA_TYPES)[number];

const CATEGORIES = [
  "population",
  "income",
  "housing",
  "education",
  "employment",
  "households",
] as const;

type Category = (typeof CATEGORIES)[number];

const SOURCE_NAME = "U.S. Census Bureau, American Community Survey";

// GEOID length requirements for fixed-length area types.
const GEOID_LENGTHS: Partial<Record<AreaType, number>> = {
  state: 2,
  county: 5,
  tract: 11,
  block_group: 12,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validateAreaType(
  value: unknown,
  allowed: readonly string[] = AREA_TYPES,
): AreaType {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new ApiError(
      ErrorCode.VALIDATION_ERROR,
      `Invalid area_type "${String(value)}". Valid options: ${allowed.join(", ")}`,
    );
  }
  return value as AreaType;
}

function validateAreaCode(areaType: AreaType, code: unknown): string {
  if (typeof code !== "string" || code.trim() === "") {
    throw new ApiError(
      ErrorCode.VALIDATION_ERROR,
      "area_code is required and must be a non-empty string.",
    );
  }

  const trimmed = code.trim();

  // Block group: must be exactly 12 digits
  if (areaType === "block_group") {
    if (!/^\d{12}$/.test(trimmed)) {
      throw new ApiError(
        ErrorCode.VALIDATION_ERROR,
        "Invalid block group GEOID: must be exactly 12 digits.",
      );
    }
  }

  // Fixed-length GEOID validation for other area types
  const expectedLength = GEOID_LENGTHS[areaType];
  if (expectedLength && areaType !== "block_group") {
    if (!/^\d+$/.test(trimmed) || trimmed.length !== expectedLength) {
      throw new ApiError(
        ErrorCode.VALIDATION_ERROR,
        `Invalid ${areaType} GEOID: expected exactly ${expectedLength} digits.`,
      );
    }
  }

  return trimmed;
}

function validateCategories(raw: unknown): string[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  // Silently ignore unrecognised categories (matching API behaviour).
  return raw.filter(
    (c) => typeof c === "string" && (CATEGORIES as readonly string[]).includes(c),
  );
}

function buildPath(areaType: AreaType, areaCode: string, suffix?: string): string {
  const base =
    areaType === "zip"
      ? `/demographics/${areaCode}`
      : `/demographics/area/${areaType}/${areaCode}`;
  return suffix ? `${base}/${suffix}` : base;
}

function sourceAttribution(data: Record<string, unknown>) {
  const vintage = typeof data.dataset === "string" ? data.dataset : null;
  return { name: SOURCE_NAME, vintage, api: "geographic-data" };
}

function filterCategories(
  data: Record<string, unknown>,
  categories: string[],
): Record<string, unknown> {
  if (categories.length === 0) return data;
  const filtered: Record<string, unknown> = {};
  for (const key of Object.keys(data)) {
    // Always keep metadata keys; only filter category payload keys.
    if ((CATEGORIES as readonly string[]).includes(key)) {
      if (categories.includes(key)) {
        filtered[key] = data[key];
      }
    } else {
      filtered[key] = data[key];
    }
  }
  return filtered;
}

// ---------------------------------------------------------------------------
// Tool 1: get_demographics
// ---------------------------------------------------------------------------

const getDemographics: ToolDefinition = {
  name: "get_demographics",
  description:
    "Retrieve a full demographic profile (population, income, housing, education, employment, households) for a single geographic area such as a ZIP code, county, state, place, CBSA, census tract, or block group.",
  inputSchema: {
    type: "object",
    properties: {
      area_type: {
        type: "string",
        enum: [...AREA_TYPES],
        description:
          "Geographic area type. Use 'zip' for ZIP codes, or a Census boundary type.",
      },
      area_code: {
        type: "string",
        description:
          "Area identifier: 5-digit ZIP, 2-digit state FIPS, 5-digit county FIPS, 11-digit tract GEOID, 12-digit block group GEOID, place FIPS, or CBSA code.",
      },
      data_year: {
        type: "integer",
        description:
          "Specific ACS data year (e.g. 2023). Omit for the most recent available year.",
      },
    },
    required: ["area_type", "area_code"],
  },
  handler: async (
    args: Record<string, unknown>,
    client: ApiClient,
    _auth: AuthManager,
  ) => {
    const areaType = validateAreaType(args.area_type);
    const areaCode = validateAreaCode(areaType, args.area_code);

    const params: Record<string, string | number | undefined> = {};
    if (args.data_year !== undefined) {
      params.dataYear = args.data_year as number;
    }

    const path = buildPath(areaType, areaCode);
    const { data, rateLimit } = await client.get<Record<string, unknown>>(path, params);

    return formatResponse(data, sourceAttribution(data), rateLimit);
  },
};

// ---------------------------------------------------------------------------
// Tool 2: get_demographics_category
// ---------------------------------------------------------------------------

const getDemographicsCategory: ToolDefinition = {
  name: "get_demographics_category",
  description:
    "Retrieve specific demographic categories (e.g. population, income, housing) for a geographic area. Use this instead of get_demographics when you only need a subset of categories to keep the response concise.",
  inputSchema: {
    type: "object",
    properties: {
      area_type: {
        type: "string",
        enum: [...AREA_TYPES],
        description: "Geographic area type.",
      },
      area_code: {
        type: "string",
        description: "Area identifier (ZIP code, FIPS code, GEOID, or CBSA code).",
      },
      categories: {
        type: "array",
        items: {
          type: "string",
          enum: [...CATEGORIES],
        },
        description:
          "One or more demographic categories to retrieve: population, income, housing, education, employment, households.",
      },
      data_year: {
        type: "integer",
        description: "Specific ACS data year. Omit for the most recent available year.",
      },
    },
    required: ["area_type", "area_code", "categories"],
  },
  handler: async (
    args: Record<string, unknown>,
    client: ApiClient,
    _auth: AuthManager,
  ) => {
    const areaType = validateAreaType(args.area_type);
    const areaCode = validateAreaCode(areaType, args.area_code);
    const categories = validateCategories(args.categories) ?? [];

    const params: Record<string, string | number | undefined> = {};
    if (args.data_year !== undefined) {
      params.dataYear = args.data_year as number;
    }

    // For ZIP codes the API supports a `category` query param (CSV).
    if (areaType === "zip" && categories.length > 0) {
      params.category = categories.join(",");
    }

    const path = buildPath(areaType, areaCode);
    const { data, rateLimit } = await client.get<Record<string, unknown>>(path, params);

    // For non-ZIP area types the API returns all categories, so filter locally.
    const filtered =
      areaType !== "zip" && categories.length > 0
        ? filterCategories(data, categories)
        : data;

    return formatResponse(filtered, sourceAttribution(data), rateLimit);
  },
};

// ---------------------------------------------------------------------------
// Tool 3: get_demographics_trend
// ---------------------------------------------------------------------------

const getDemographicsTrend: ToolDefinition = {
  name: "get_demographics_trend",
  description:
    "Retrieve historical demographic data across multiple years for a single geographic area, useful for analysing population growth, income changes, or housing trends over time.",
  inputSchema: {
    type: "object",
    properties: {
      area_type: {
        type: "string",
        enum: [...AREA_TYPES],
        description: "Geographic area type.",
      },
      area_code: {
        type: "string",
        description: "Area identifier (ZIP code, FIPS code, GEOID, or CBSA code).",
      },
      start_year: {
        type: "integer",
        description: "First year of the range. Omit for the earliest available year.",
      },
      end_year: {
        type: "integer",
        description: "Last year of the range. Omit for the most recent available year.",
      },
    },
    required: ["area_type", "area_code"],
  },
  handler: async (
    args: Record<string, unknown>,
    client: ApiClient,
    _auth: AuthManager,
  ) => {
    const areaType = validateAreaType(args.area_type);
    const areaCode = validateAreaCode(areaType, args.area_code);

    const params: Record<string, string | number | undefined> = {};
    if (args.start_year !== undefined) {
      params.startYear = args.start_year as number;
    }
    if (args.end_year !== undefined) {
      params.endYear = args.end_year as number;
    }

    const path = buildPath(areaType, areaCode, "trend");
    const { data, rateLimit } = await client.get<Record<string, unknown>>(path, params);

    // Source attribution: use the dataset/dataYear from the first year entry
    // if the top-level object doesn't carry them.
    return formatResponse(data, sourceAttribution(data), rateLimit);
  },
};

// ---------------------------------------------------------------------------
// Tool 4: compare_demographics
// ---------------------------------------------------------------------------

const compareDemographics: ToolDefinition = {
  name: "compare_demographics",
  description:
    "Compare demographics side by side for two to ten ZIP codes. Returns each ZIP's demographic profile plus summary comparison ranges (population, income, housing).",
  inputSchema: {
    type: "object",
    properties: {
      zip_codes: {
        type: "array",
        items: { type: "string" },
        minItems: 2,
        maxItems: 10,
        description: "Two to ten 5-digit ZIP codes to compare.",
      },
      categories: {
        type: "array",
        items: {
          type: "string",
          enum: [...CATEGORIES],
        },
        description: "Optional list of categories to include in the comparison.",
      },
      data_year: {
        type: "integer",
        description: "Specific ACS data year. Omit for the most recent available year.",
      },
    },
    required: ["zip_codes"],
  },
  handler: async (
    args: Record<string, unknown>,
    client: ApiClient,
    _auth: AuthManager,
  ) => {
    const zipCodes = args.zip_codes;
    if (!Array.isArray(zipCodes) || zipCodes.length < 2) {
      return formatError(
        ErrorCode.VALIDATION_ERROR,
        "At least 2 ZIP codes required for comparison.",
      );
    }
    if (zipCodes.length > 10) {
      return formatError(
        ErrorCode.VALIDATION_ERROR,
        "Maximum 10 ZIP codes allowed for comparison.",
      );
    }

    const params: Record<string, string | number | undefined> = {
      zipCodes: (zipCodes as string[]).join(","),
    };

    const categories = validateCategories(args.categories);
    if (categories && categories.length > 0) {
      params.categories = categories.join(",");
    }
    if (args.data_year !== undefined) {
      params.dataYear = args.data_year as number;
    }

    const { data, rateLimit } = await client.get<Record<string, unknown>>(
      "/demographics/compare",
      params,
    );

    return formatResponse(data, sourceAttribution(data), rateLimit);
  },
};

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const demographicsTools: ToolDefinition[] = [
  getDemographics,
  getDemographicsCategory,
  getDemographicsTrend,
  compareDemographics,
];
