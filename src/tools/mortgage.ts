import type { ToolDefinition } from "./index.js";
import { formatResponse, formatError } from "../response.js";
import { ApiError, ErrorCode } from "../types.js";

const SOURCE_NAME = "CFPB/FFIEC HMDA";

const VALID_AREA_TYPES = ["tract", "county", "state"];

/** Expected FIPS digit lengths by area type. */
const GEOID_LENGTHS: Record<string, { digits: number; label: string }> = {
  tract: { digits: 11, label: "census tract" },
  county: { digits: 5, label: "county" },
  state: { digits: 2, label: "state" },
};

function normalizeAreaType(areaType: string): string {
  if (areaType === "census_tract") return "tract";
  return areaType;
}

function validateAreaType(areaType: string): string | null {
  if (!VALID_AREA_TYPES.includes(areaType)) {
    return "Invalid area type. Must be one of: tract, county, state";
  }
  return null;
}

function validateGeoid(areaType: string, geoid: string): string | null {
  const rule = GEOID_LENGTHS[areaType];
  if (!rule) return null;
  const pattern = new RegExp(`^\\d{${rule.digits}}$`);
  if (!pattern.test(geoid)) {
    return `FIPS code '${geoid}' is not valid for area type '${areaType}'. Expected ${rule.digits} digits.`;
  }
  return null;
}

export const mortgageTools: ToolDefinition[] = [
  {
    name: "get_mortgage_summary",
    description:
      "Retrieve the mortgage lending summary for a single geographic area (census tract, county, or state) from HMDA data. " +
      "Returns origination count, denial rate, median loan amount, median interest rate, loan purpose mix, " +
      "and loan type mix (conventional, FHA, VA, USDA). " +
      "Source: CFPB/FFIEC HMDA.",
    inputSchema: {
      type: "object",
      properties: {
        area_type: {
          type: "string",
          enum: ["tract", "census_tract", "county", "state"],
          description: "Geographic level: tract (or census_tract), county, or state",
        },
        geoid: {
          type: "string",
          description: "FIPS code — 11 digits for tract, 5 for county, 2 for state",
        },
        year: {
          type: "integer",
          description: "HMDA data year (default: most recent available)",
        },
      },
      required: ["area_type", "geoid"],
    },
    handler: async (args, client) => {
      const rawAreaType = args.area_type as string;
      const areaType = normalizeAreaType(rawAreaType);
      const geoid = args.geoid as string;
      const year = args.year as number | undefined;

      const typeError = validateAreaType(areaType);
      if (typeError) return formatError(ErrorCode.VALIDATION_ERROR, typeError);

      const geoidError = validateGeoid(areaType, geoid);
      if (geoidError) return formatError(ErrorCode.VALIDATION_ERROR, geoidError);

      const path = `/mortgage/area/${areaType}/${geoid}`;

      try {
        const response = await client.get<unknown>(path, year !== undefined ? { year } : undefined);

        return formatResponse(response.data, {
          name: SOURCE_NAME,
          vintage: year ? String(year) : null,
          api: path,
        }, response.rateLimit);
      } catch (error) {
        if (error instanceof ApiError) {
          return formatError(error.code, error.message, error.details);
        }
        throw error;
      }
    },
  },
  {
    name: "get_mortgage_trends",
    description:
      "Retrieve multi-year mortgage lending data for a single area across all available HMDA years. " +
      "Returns an array of yearly summaries including origination count, denial rate, median loan amount, " +
      "median interest rate, and loan purpose/type breakdowns. " +
      "Source: CFPB/FFIEC HMDA.",
    inputSchema: {
      type: "object",
      properties: {
        area_type: {
          type: "string",
          enum: ["tract", "census_tract", "county", "state"],
          description: "Geographic level: tract (or census_tract), county, or state",
        },
        geoid: {
          type: "string",
          description: "FIPS code — 11 digits for tract, 5 for county, 2 for state",
        },
      },
      required: ["area_type", "geoid"],
    },
    handler: async (args, client) => {
      const rawAreaType = args.area_type as string;
      const areaType = normalizeAreaType(rawAreaType);
      const geoid = args.geoid as string;

      const typeError = validateAreaType(areaType);
      if (typeError) return formatError(ErrorCode.VALIDATION_ERROR, typeError);

      const geoidError = validateGeoid(areaType, geoid);
      if (geoidError) return formatError(ErrorCode.VALIDATION_ERROR, geoidError);

      const path = `/mortgage/area/${areaType}/${geoid}/trend`;

      try {
        const response = await client.get<unknown>(path);

        return formatResponse(response.data, {
          name: SOURCE_NAME,
          vintage: null,
          api: path,
        }, response.rateLimit);
      } catch (error) {
        if (error instanceof ApiError) {
          return formatError(error.code, error.message, error.details);
        }
        throw error;
      }
    },
  },
  {
    name: "compare_mortgage",
    description:
      "Compare mortgage lending metrics across 2-5 geographic areas for a single HMDA data year. " +
      "All areas must be the same geographic level (tract, county, or state). " +
      "Returns side-by-side summaries including origination count, denial rate, median loan amount, " +
      "and loan type/purpose breakdowns for each area. " +
      "Source: CFPB/FFIEC HMDA.",
    inputSchema: {
      type: "object",
      properties: {
        area_type: {
          type: "string",
          enum: ["tract", "census_tract", "county", "state"],
          description: "Geographic level (must be same for all areas): tract (or census_tract), county, or state",
        },
        geoids: {
          type: "array",
          items: { type: "string" },
          minItems: 2,
          maxItems: 5,
          description: "Array of 2-5 FIPS codes to compare",
        },
        year: {
          type: "integer",
          description: "HMDA data year (default: most recent available)",
        },
      },
      required: ["area_type", "geoids"],
    },
    handler: async (args, client) => {
      const rawAreaType = args.area_type as string;
      const areaType = normalizeAreaType(rawAreaType);
      const geoids = args.geoids as string[];
      const year = args.year as number | undefined;

      const typeError = validateAreaType(areaType);
      if (typeError) return formatError(ErrorCode.VALIDATION_ERROR, typeError);

      if (!Array.isArray(geoids) || geoids.length < 2) {
        return formatError(
          ErrorCode.VALIDATION_ERROR,
          "At least 2 geoids are required for comparison",
        );
      }

      if (geoids.length > 5) {
        return formatError(
          ErrorCode.VALIDATION_ERROR,
          "Maximum 5 geoids allowed for comparison",
        );
      }

      for (const geoid of geoids) {
        const geoidError = validateGeoid(areaType, geoid);
        if (geoidError) return formatError(ErrorCode.VALIDATION_ERROR, geoidError);
      }

      const params: Record<string, string | number | undefined> = {
        geoids: geoids.join(","),
        areaType,
      };
      if (year !== undefined) params.year = year;

      try {
        const response = await client.get<unknown>("/mortgage/compare", params);

        return formatResponse(response.data, {
          name: SOURCE_NAME,
          vintage: year ? String(year) : null,
          api: "/mortgage/compare",
        }, response.rateLimit);
      } catch (error) {
        if (error instanceof ApiError) {
          return formatError(error.code, error.message, error.details);
        }
        throw error;
      }
    },
  },
];
