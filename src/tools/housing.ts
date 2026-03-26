import type { ToolDefinition } from "./index.js";
import { formatResponse, formatError } from "../response.js";
import { ApiError, ErrorCode } from "../types.js";

const SOURCE_NAME = "U.S. Dept. of Housing & Urban Development, Fair Market Rents";

/** Maps MCP area_type values to the API path segment. */
const AREA_TYPE_TO_PATH: Record<string, string> = {
  zip: "zip",
  county: "county",
  cbsa: "metro",
  state: "state",
};

const AREA_CODE_PATTERNS: Record<string, { pattern: RegExp; description: string }> = {
  zip: { pattern: /^\d{5}$/, description: "5-digit ZIP code" },
  county: { pattern: /^\d{5}$/, description: "5-digit county FIPS code" },
  cbsa: { pattern: /^[A-Za-z0-9]{3,10}$/, description: "3-10 character CBSA code" },
  state: { pattern: /^\d{2}$/, description: "2-digit state FIPS code" },
};

function validateAreaType(areaType: string, validTypes: string[]): string | null {
  if (!validTypes.includes(areaType)) {
    return `Invalid area_type '${areaType}'. Must be one of: ${validTypes.join(", ")}`;
  }
  return null;
}

function validateAreaCode(areaType: string, areaCode: string): string | null {
  const rule = AREA_CODE_PATTERNS[areaType];
  if (!rule) return null;
  if (!rule.pattern.test(areaCode)) {
    return `Invalid area_code '${areaCode}' for area_type '${areaType}'. Expected ${rule.description}.`;
  }
  return null;
}

export const housingTools: ToolDefinition[] = [
  {
    name: "get_fair_market_rent",
    description:
      "Look up HUD Fair Market Rent (FMR) rates for a geographic area by ZIP code, county FIPS, CBSA/metro code, or state FIPS. " +
      "Returns monthly rent estimates by bedroom count (efficiency through 4-bedroom). " +
      "Note: State-level queries return all ZIP-level FMR records within the state, which can be hundreds of records. " +
      "Use ZIP or county lookups when only a single area is needed. " +
      "Source: U.S. Dept. of Housing & Urban Development, Fair Market Rents.",
    inputSchema: {
      type: "object",
      properties: {
        area_type: {
          type: "string",
          enum: ["zip", "county", "cbsa", "state"],
          description: "Geographic area type: zip (5-digit), county (5-digit FIPS), cbsa (CBSA/metro code), or state (2-digit FIPS)",
        },
        area_code: {
          type: "string",
          description: "Area identifier — format depends on area_type",
        },
        year: {
          type: "integer",
          description: "FMR fiscal year (default: latest available)",
        },
      },
      required: ["area_type", "area_code"],
    },
    handler: async (args, client) => {
      const areaType = args.area_type as string;
      const areaCode = args.area_code as string;
      const year = args.year as number | undefined;

      const validTypes = ["zip", "county", "cbsa", "state"];
      const typeError = validateAreaType(areaType, validTypes);
      if (typeError) return formatError(ErrorCode.VALIDATION_ERROR, typeError);

      const codeError = validateAreaCode(areaType, areaCode);
      if (codeError) return formatError(ErrorCode.VALIDATION_ERROR, codeError);

      const pathSegment = AREA_TYPE_TO_PATH[areaType];
      const path = `/market/fmr/${pathSegment}/${areaCode}`;

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
    name: "get_fmr_trend",
    description:
      "Retrieve Fair Market Rent data across multiple years for a single area. " +
      "Returns an array of yearly FMR records with rent values by bedroom count. " +
      "Supports ZIP, county, and CBSA area types. State-level trends are not supported because " +
      "state queries return aggregated lists of ZIP-level records, not a single time series. " +
      "Source: U.S. Dept. of Housing & Urban Development, Fair Market Rents.",
    inputSchema: {
      type: "object",
      properties: {
        area_type: {
          type: "string",
          enum: ["zip", "county", "cbsa"],
          description: "Geographic area type: zip, county, or cbsa (state is not supported for trends)",
        },
        area_code: {
          type: "string",
          description: "Area identifier — format depends on area_type",
        },
        start_year: {
          type: "integer",
          description: "First year of the range (default: earliest available)",
        },
        end_year: {
          type: "integer",
          description: "Last year of the range (default: latest available)",
        },
      },
      required: ["area_type", "area_code"],
    },
    handler: async (args, client) => {
      const areaType = args.area_type as string;
      const areaCode = args.area_code as string;
      const startYear = args.start_year as number | undefined;
      const endYear = args.end_year as number | undefined;

      const validTypes = ["zip", "county", "cbsa"];
      const typeError = validateAreaType(areaType, validTypes);
      if (typeError) {
        if (areaType === "state") {
          return formatError(
            ErrorCode.VALIDATION_ERROR,
            "Trends are not supported for state-level queries. Use zip, county, or cbsa.",
          );
        }
        return formatError(ErrorCode.VALIDATION_ERROR, typeError);
      }

      const codeError = validateAreaCode(areaType, areaCode);
      if (codeError) return formatError(ErrorCode.VALIDATION_ERROR, codeError);

      const pathSegment = AREA_TYPE_TO_PATH[areaType];
      const path = `/market/fmr/${pathSegment}/${areaCode}/trend`;

      const params: Record<string, string | number | undefined> = {};
      if (startYear !== undefined) params.startYear = startYear;
      if (endYear !== undefined) params.endYear = endYear;

      try {
        const response = await client.get<unknown>(
          path,
          Object.keys(params).length > 0 ? params : undefined,
        );

        const vintage =
          startYear && endYear
            ? `${startYear}-${endYear}`
            : startYear
              ? `${startYear}-present`
              : endYear
                ? `through ${endYear}`
                : null;

        return formatResponse(response.data, {
          name: SOURCE_NAME,
          vintage,
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
];
