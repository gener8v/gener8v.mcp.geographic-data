import type { ApiClient } from "../api-client.js";
import type { AuthManager } from "../auth.js";
import { formatResponse, formatError } from "../response.js";
import { ApiError, ErrorCode } from "../types.js";
import type { ToolDefinition } from "./index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ZIP_REGEX = /^[0-9]{5}$/;

const ZIP_SOURCE = { name: "USPS ZIP Code Database", vintage: null, api: "Geographic Data API" };
const TIGER_SOURCE = { name: "US Census TIGER/Line", vintage: null, api: "Geographic Data API" };

function validateZipCode(zip: unknown): string | null {
  if (typeof zip !== "string" || !ZIP_REGEX.test(zip)) {
    return "Invalid ZIP code format -- must be exactly 5 digits";
  }
  return null;
}

function handleApiError(error: unknown): { content: Array<{ type: "text"; text: string }>; isError: true } {
  if (error instanceof ApiError) {
    switch (error.code) {
      case ErrorCode.AUTH_ERROR:
        return formatError(error.code, "Authentication failed -- check your API key");
      case ErrorCode.PERMISSION_DENIED:
        return formatError(error.code, `Permission denied -- this tool requires the appropriate permission`, error.details);
      case ErrorCode.RATE_LIMITED: {
        const details = error.details as { retryAfterSeconds?: number } | undefined;
        const retryAfter = details?.retryAfterSeconds ?? "unknown";
        return formatError(error.code, `Rate limit exceeded -- try again in ${retryAfter} seconds`);
      }
      case ErrorCode.NOT_FOUND:
        return formatError(error.code, error.message);
      case ErrorCode.VALIDATION_ERROR:
        return formatError(error.code, error.message, error.details);
      default:
        return formatError(error.code, "Geographic Data API is unavailable -- please try again later");
    }
  }
  return formatError(ErrorCode.INTERNAL_ERROR, "Geographic Data API is unavailable -- please try again later");
}

// ---------------------------------------------------------------------------
// GL-001: lookup_zip_code
// ---------------------------------------------------------------------------

const lookupZipCode: ToolDefinition = {
  name: "lookup_zip_code",
  description:
    "Look up full details for a single 5-digit US ZIP code, including city, state, county, timezone, coordinates, area codes, land/water area, and elevation.",
  annotations: {
    title: "Look Up ZIP Code",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  inputSchema: {
    type: "object",
    properties: {
      zipCode: {
        type: "string",
        description: "The 5-digit ZIP code to look up (e.g., \"30301\")",
        pattern: "^[0-9]{5}$",
      },
    },
    required: ["zipCode"],
  },
  handler: async (args, client) => {
    const zipCode = args.zipCode as string;
    const validationError = validateZipCode(zipCode);
    if (validationError) {
      return formatError(ErrorCode.VALIDATION_ERROR, validationError);
    }

    try {
      const response = await client.get(`/zip-codes/${zipCode}`);
      return formatResponse(response.data, ZIP_SOURCE, response.rateLimit);
    } catch (error) {
      if (error instanceof ApiError && error.code === ErrorCode.NOT_FOUND) {
        return formatError(ErrorCode.NOT_FOUND, `ZIP code ${zipCode} not found`);
      }
      return handleApiError(error);
    }
  },
};

// ---------------------------------------------------------------------------
// GL-002: search_zip_codes_by_city
// ---------------------------------------------------------------------------

const searchZipCodesByCity: ToolDefinition = {
  name: "search_zip_codes_by_city",
  description:
    "Search for all ZIP codes in a given city and state. Returns the full list of matching ZIP codes with details.",
  annotations: {
    title: "Search ZIP Codes by City",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  inputSchema: {
    type: "object",
    properties: {
      city: {
        type: "string",
        description: "City name (e.g., \"Atlanta\")",
        minLength: 1,
      },
      state: {
        type: "string",
        description: "2-letter state abbreviation (e.g., \"GA\")",
        pattern: "^[A-Za-z]{2}$",
      },
    },
    required: ["city", "state"],
  },
  handler: async (args, client) => {
    const city = args.city as string;
    const state = args.state as string;

    if (!city || city.trim().length === 0) {
      return formatError(ErrorCode.VALIDATION_ERROR, "City name is required");
    }

    if (typeof state !== "string" || !/^[A-Za-z]{2}$/.test(state)) {
      return formatError(ErrorCode.VALIDATION_ERROR, "State must be a 2-letter abbreviation (e.g., \"GA\")");
    }

    try {
      const response = await client.get("/zip-codes/by-city", {
        city: city.trim(),
        state: state.toUpperCase(),
      });
      return formatResponse(response.data, ZIP_SOURCE, response.rateLimit);
    } catch (error) {
      return handleApiError(error);
    }
  },
};

// ---------------------------------------------------------------------------
// GL-003: find_zip_codes_in_radius
// ---------------------------------------------------------------------------

const findZipCodesInRadius: ToolDefinition = {
  name: "find_zip_codes_in_radius",
  description:
    "Find all ZIP codes within a given radius of a center ZIP code. Returns each nearby ZIP with its distance from the center.",
  annotations: {
    title: "Find ZIP Codes in Radius",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  inputSchema: {
    type: "object",
    properties: {
      zipCode: {
        type: "string",
        description: "Center ZIP code (5 digits)",
        pattern: "^[0-9]{5}$",
      },
      radius: {
        type: "number",
        description: "Search radius (0.1 to 500)",
        minimum: 0.1,
        maximum: 500,
      },
      unit: {
        type: "string",
        description: "Distance unit",
        enum: ["miles", "kilometers"],
        default: "miles",
      },
      limit: {
        type: "integer",
        description: "Maximum number of results (1 to 500, default 100)",
        minimum: 1,
        maximum: 500,
        default: 100,
      },
      sort: {
        type: "string",
        description: "Sort order for results",
        enum: ["distance", "zip"],
        default: "distance",
      },
    },
    required: ["zipCode", "radius"],
  },
  handler: async (args, client) => {
    const zipCode = args.zipCode as string;
    const radius = args.radius as number;
    const unit = args.unit as string | undefined;
    const limit = args.limit as number | undefined;
    const sort = args.sort as string | undefined;

    const validationError = validateZipCode(zipCode);
    if (validationError) {
      return formatError(ErrorCode.VALIDATION_ERROR, validationError);
    }

    if (typeof radius !== "number" || radius < 0.1 || radius > 500) {
      return formatError(ErrorCode.VALIDATION_ERROR, "Radius must be between 0.1 and 500");
    }

    if (unit !== undefined && unit !== "miles" && unit !== "kilometers") {
      return formatError(ErrorCode.VALIDATION_ERROR, "Unit must be \"miles\" or \"kilometers\"");
    }

    if (limit !== undefined && (typeof limit !== "number" || limit < 1 || limit > 500)) {
      return formatError(ErrorCode.VALIDATION_ERROR, "Limit must be between 1 and 500");
    }

    if (sort !== undefined && sort !== "distance" && sort !== "zip") {
      return formatError(ErrorCode.VALIDATION_ERROR, "Sort must be \"distance\" or \"zip\"");
    }

    try {
      const response = await client.get(`/zip-codes/${zipCode}/radius`, {
        radius,
        unit,
        limit,
        sort,
      });
      return formatResponse(response.data, ZIP_SOURCE, response.rateLimit);
    } catch (error) {
      if (error instanceof ApiError && error.code === ErrorCode.NOT_FOUND) {
        return formatError(ErrorCode.NOT_FOUND, `ZIP code ${zipCode} not found`);
      }
      return handleApiError(error);
    }
  },
};

// ---------------------------------------------------------------------------
// GL-004: calculate_zip_code_distance
// ---------------------------------------------------------------------------

const calculateZipCodeDistance: ToolDefinition = {
  name: "calculate_zip_code_distance",
  description:
    "Calculate the distance between two ZIP codes using either the Haversine or Vincenty formula. Returns origin/destination details and the computed distance.",
  annotations: {
    title: "Calculate ZIP Code Distance",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  inputSchema: {
    type: "object",
    properties: {
      from: {
        type: "string",
        description: "Origin ZIP code (5 digits)",
        pattern: "^[0-9]{5}$",
      },
      to: {
        type: "string",
        description: "Destination ZIP code (5 digits)",
        pattern: "^[0-9]{5}$",
      },
      unit: {
        type: "string",
        description: "Distance unit",
        enum: ["miles", "kilometers", "meters", "feet", "nautical_miles"],
        default: "miles",
      },
      method: {
        type: "string",
        description: "Calculation method",
        enum: ["haversine", "vincenty"],
        default: "haversine",
      },
    },
    required: ["from", "to"],
  },
  handler: async (args, client) => {
    const from = args.from as string;
    const to = args.to as string;
    const unit = args.unit as string | undefined;
    const method = args.method as string | undefined;

    const fromError = validateZipCode(from);
    if (fromError) {
      return formatError(ErrorCode.VALIDATION_ERROR, fromError);
    }

    const toError = validateZipCode(to);
    if (toError) {
      return formatError(ErrorCode.VALIDATION_ERROR, toError);
    }

    if (unit !== undefined && !["miles", "kilometers", "meters", "feet", "nautical_miles"].includes(unit)) {
      return formatError(
        ErrorCode.VALIDATION_ERROR,
        "Unit must be one of: miles, kilometers, meters, feet, nautical_miles",
      );
    }

    if (method !== undefined && method !== "haversine" && method !== "vincenty") {
      return formatError(ErrorCode.VALIDATION_ERROR, "Method must be \"haversine\" or \"vincenty\"");
    }

    try {
      const response = await client.get("/zip-codes/distance", {
        from,
        to,
        unit,
        method,
      });
      return formatResponse(response.data, ZIP_SOURCE, response.rateLimit);
    } catch (error) {
      if (error instanceof ApiError && error.code === ErrorCode.NOT_FOUND) {
        return formatError(ErrorCode.NOT_FOUND, error.message);
      }
      return handleApiError(error);
    }
  },
};

// ---------------------------------------------------------------------------
// GL-005: search_areas
// ---------------------------------------------------------------------------

const searchAreas: ToolDefinition = {
  name: "search_areas",
  description:
    "Search for geographic areas by name across all boundary types (county, state, CBSA, census tract, ZIP). Uses trigram matching for fuzzy name search.",
  annotations: {
    title: "Search Geographic Areas",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Search term -- name or partial ZIP code (minimum 2 characters)",
        minLength: 2,
      },
      types: {
        type: "array",
        description: "Restrict to specific boundary types",
        items: {
          type: "string",
          enum: ["county", "state", "cbsa", "census_tract", "zip"],
        },
      },
      limit: {
        type: "integer",
        description: "Maximum number of results (1 to 50, default 20)",
        minimum: 1,
        maximum: 50,
        default: 20,
      },
    },
    required: ["query"],
  },
  handler: async (args, client) => {
    const query = args.query as string;
    const types = args.types as string[] | undefined;
    const limit = args.limit as number | undefined;

    if (typeof query !== "string" || query.trim().length < 2) {
      return formatError(ErrorCode.VALIDATION_ERROR, "Search query must be at least 2 characters");
    }

    if (limit !== undefined && (typeof limit !== "number" || limit < 1 || limit > 50)) {
      return formatError(ErrorCode.VALIDATION_ERROR, "Limit must be between 1 and 50");
    }

    const params: Record<string, string | number | boolean | undefined> = {
      q: query.trim(),
      limit,
    };

    if (types && types.length > 0) {
      params.types = types.join(",");
    }

    try {
      const response = await client.get("/search/areas", params);
      return formatResponse(response.data, TIGER_SOURCE, response.rateLimit);
    } catch (error) {
      return handleApiError(error);
    }
  },
};

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const geographicTools: ToolDefinition[] = [
  lookupZipCode,
  searchZipCodesByCity,
  findZipCodesInRadius,
  calculateZipCodeDistance,
  searchAreas,
];
