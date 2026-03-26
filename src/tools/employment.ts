import type { ApiClient } from "../api-client.js";
import type { AuthManager } from "../auth.js";
import { formatResponse, formatError } from "../response.js";
import { ApiError, ErrorCode } from "../types.js";
import type { ToolDefinition } from "./index.js";

const SOURCE_NAME = "LODES 8 (LEHD Origin-Destination Employment Statistics)";

const AREA_TYPES = ["tract", "county", "state"] as const;
const GEOID_LENGTHS: Record<string, number> = { tract: 11, county: 5, state: 2 };
const PERSPECTIVES = ["workplace", "residence"] as const;
const DIRECTIONS = ["inbound", "outbound"] as const;

function validateAreaType(areaType: string): string | null {
  if (!AREA_TYPES.includes(areaType as (typeof AREA_TYPES)[number])) {
    return `Invalid area type: ${areaType}. Must be one of: tract, county, state.`;
  }
  return null;
}

function validateGeoid(geoid: string, areaType: string): string | null {
  const expected = GEOID_LENGTHS[areaType];
  if (!expected) return null;
  if (geoid.length !== expected || !/^\d+$/.test(geoid)) {
    return `Invalid geoid '${geoid}' for area type '${areaType}'. Expected ${expected} digits.`;
  }
  return null;
}

function validatePerspective(perspective: string): string | null {
  if (!PERSPECTIVES.includes(perspective as (typeof PERSPECTIVES)[number])) {
    return "Invalid perspective. Must be 'workplace' or 'residence'.";
  }
  return null;
}

export const employmentTools: ToolDefinition[] = [
  // ── get_employment ──────────────────────────────────────────────────
  {
    name: "get_employment",
    description:
      "Retrieve employment data for a single geographic area. Returns total jobs, " +
      "industry mix by NAICS sector, earnings distribution, and age breakdown. " +
      "The 'perspective' parameter controls whether data reflects jobs physically " +
      "located in the area (workplace, WAC data — default) or jobs held by the " +
      "area's residents regardless of where they work (residence, RAC data).",
    inputSchema: {
      type: "object",
      properties: {
        area_type: {
          type: "string",
          enum: ["tract", "county", "state"],
          description: "Geographic level: tract, county, or state.",
        },
        geoid: {
          type: "string",
          description:
            "FIPS code for the area — 11 digits for tract, 5 for county, 2 for state.",
        },
        perspective: {
          type: "string",
          enum: ["workplace", "residence"],
          description:
            "workplace (jobs located in the area, default) or residence (jobs held by area residents).",
        },
        year: {
          type: "integer",
          description: "Data year. Omit to use the most recent available year.",
        },
      },
      required: ["area_type", "geoid"],
    },
    handler: async (args, client, _auth) => {
      const areaType = args.area_type as string;
      const geoid = args.geoid as string;
      const perspective = (args.perspective as string) ?? "workplace";
      const year = args.year as number | undefined;

      let err = validateAreaType(areaType);
      if (err) return formatError(ErrorCode.VALIDATION_ERROR, err);
      err = validateGeoid(geoid, areaType);
      if (err) return formatError(ErrorCode.VALIDATION_ERROR, err);
      err = validatePerspective(perspective);
      if (err) return formatError(ErrorCode.VALIDATION_ERROR, err);

      try {
        const { data, rateLimit } = await client.get(
          `/employment/area/${areaType}/${geoid}`,
          { perspective, year },
        );
        return formatResponse(data, { name: SOURCE_NAME, vintage: String(year ?? "latest"), api: "employment" }, rateLimit);
      } catch (error) {
        if (error instanceof ApiError) {
          if (error.code === ErrorCode.PERMISSION_DENIED) {
            return formatError(error.code, "Permission denied: employment data requires Business tier or above.");
          }
          if (error.code === ErrorCode.UPSTREAM_ERROR) {
            return formatError(error.code, "Employment data is temporarily unavailable. Please try again.");
          }
          return formatError(error.code, error.message, error.details);
        }
        return formatError(ErrorCode.INTERNAL_ERROR, "An unexpected error occurred.");
      }
    },
  },

  // ── get_employment_trend ────────────────────────────────────────────
  {
    name: "get_employment_trend",
    description:
      "Retrieve employment data across all available years for a single area. " +
      "Returns an array of yearly metrics (total jobs, industry mix, earnings, " +
      "age breakdown) ordered ascending by year. Use 'perspective' to choose " +
      "workplace (default) or residence.",
    inputSchema: {
      type: "object",
      properties: {
        area_type: {
          type: "string",
          enum: ["tract", "county", "state"],
          description: "Geographic level: tract, county, or state.",
        },
        geoid: {
          type: "string",
          description:
            "FIPS code for the area — 11 digits for tract, 5 for county, 2 for state.",
        },
        perspective: {
          type: "string",
          enum: ["workplace", "residence"],
          description:
            "workplace (jobs located in the area, default) or residence (jobs held by area residents).",
        },
      },
      required: ["area_type", "geoid"],
    },
    handler: async (args, client, _auth) => {
      const areaType = args.area_type as string;
      const geoid = args.geoid as string;
      const perspective = (args.perspective as string) ?? "workplace";

      let err = validateAreaType(areaType);
      if (err) return formatError(ErrorCode.VALIDATION_ERROR, err);
      err = validateGeoid(geoid, areaType);
      if (err) return formatError(ErrorCode.VALIDATION_ERROR, err);
      err = validatePerspective(perspective);
      if (err) return formatError(ErrorCode.VALIDATION_ERROR, err);

      try {
        const { data, rateLimit } = await client.get(
          `/employment/area/${areaType}/${geoid}/trend`,
          { perspective },
        );
        return formatResponse(data, { name: SOURCE_NAME, vintage: null, api: "employment" }, rateLimit);
      } catch (error) {
        if (error instanceof ApiError) {
          if (error.code === ErrorCode.PERMISSION_DENIED) {
            return formatError(error.code, "Permission denied: employment data requires Business tier or above.");
          }
          if (error.code === ErrorCode.UPSTREAM_ERROR) {
            return formatError(error.code, "Employment data is temporarily unavailable. Please try again.");
          }
          return formatError(error.code, error.message, error.details);
        }
        return formatError(ErrorCode.INTERNAL_ERROR, "An unexpected error occurred.");
      }
    },
  },

  // ── compare_employment ──────────────────────────────────────────────
  {
    name: "compare_employment",
    description:
      "Compare employment data for multiple areas side by side (2-10 areas). " +
      "All geoids must share the same area type. Returns per-area metrics " +
      "including total jobs, industry mix, earnings, and age breakdown.",
    inputSchema: {
      type: "object",
      properties: {
        geoids: {
          type: "string",
          description:
            "Comma-separated FIPS codes to compare (2-10). All must match the specified area type.",
        },
        area_type: {
          type: "string",
          enum: ["tract", "county", "state"],
          description: "Geographic level shared by all geoids.",
        },
        perspective: {
          type: "string",
          enum: ["workplace", "residence"],
          description:
            "workplace (default) or residence.",
        },
        year: {
          type: "integer",
          description: "Data year. Omit to use the most recent available year.",
        },
      },
      required: ["geoids", "area_type"],
    },
    handler: async (args, client, _auth) => {
      const geoids = args.geoids as string;
      const areaType = args.area_type as string;
      const perspective = (args.perspective as string) ?? "workplace";
      const year = args.year as number | undefined;

      let err = validateAreaType(areaType);
      if (err) return formatError(ErrorCode.VALIDATION_ERROR, err);
      err = validatePerspective(perspective);
      if (err) return formatError(ErrorCode.VALIDATION_ERROR, err);

      const geoidList = geoids.split(",").map((g) => g.trim()).filter(Boolean);
      if (geoidList.length === 0) {
        return formatError(ErrorCode.VALIDATION_ERROR, "At least one geoid is required.");
      }
      if (geoidList.length > 10) {
        return formatError(ErrorCode.VALIDATION_ERROR, "Maximum 10 areas allowed for comparison.");
      }

      for (const g of geoidList) {
        err = validateGeoid(g, areaType);
        if (err) return formatError(ErrorCode.VALIDATION_ERROR, err);
      }

      try {
        const { data, rateLimit } = await client.get(
          "/employment/compare",
          { geoids, areaType, perspective, year },
        );
        return formatResponse(data, { name: SOURCE_NAME, vintage: String(year ?? "latest"), api: "employment" }, rateLimit);
      } catch (error) {
        if (error instanceof ApiError) {
          if (error.code === ErrorCode.PERMISSION_DENIED) {
            return formatError(error.code, "Permission denied: employment data requires Business tier or above.");
          }
          if (error.code === ErrorCode.UPSTREAM_ERROR) {
            return formatError(error.code, "Employment data is temporarily unavailable. Please try again.");
          }
          return formatError(error.code, error.message, error.details);
        }
        return formatError(ErrorCode.INTERNAL_ERROR, "An unexpected error occurred.");
      }
    },
  },

  // ── get_commute_flows ───────────────────────────────────────────────
  {
    name: "get_commute_flows",
    description:
      "Retrieve commute flow (origin-destination) data for a county or state. " +
      "Shows where workers come from (inbound) or where residents commute to " +
      "(outbound). Returns top flow pairs with job counts and a 3-supersector " +
      "industry breakdown (Goods Producing, Trade/Transport/Utilities, All Other " +
      "Services). Note: this uses OD data with a coarser industry breakdown than " +
      "the 20-sector NAICS detail available in single-area employment summaries. " +
      "Not available at the tract level.",
    inputSchema: {
      type: "object",
      properties: {
        area_type: {
          type: "string",
          enum: ["county", "state"],
          description: "Geographic level: county or state (tract is not supported for flows).",
        },
        geoid: {
          type: "string",
          description: "FIPS code — 5 digits for county, 2 for state.",
        },
        direction: {
          type: "string",
          enum: ["inbound", "outbound"],
          description:
            "inbound = where workers come from; outbound = where residents commute to.",
        },
        year: {
          type: "integer",
          description: "Data year. Omit to use the most recent available year.",
        },
        limit: {
          type: "integer",
          description: "Number of top flow pairs to return (1-100, default 25).",
        },
        min_jobs: {
          type: "integer",
          description: "Minimum job count threshold to include a flow pair (default 0).",
        },
      },
      required: ["area_type", "geoid", "direction"],
    },
    handler: async (args, client, _auth) => {
      const areaType = args.area_type as string;
      const geoid = args.geoid as string;
      const direction = args.direction as string;
      const year = args.year as number | undefined;
      const minJobs = args.min_jobs as number | undefined;
      let limit = args.limit as number | undefined;

      // Validate area type — flows not available for tract
      if (areaType === "tract") {
        return formatError(
          ErrorCode.VALIDATION_ERROR,
          "Commute flow data is only available at county and state levels.",
        );
      }
      let err = validateAreaType(areaType);
      if (err) return formatError(ErrorCode.VALIDATION_ERROR, err);
      err = validateGeoid(geoid, areaType);
      if (err) return formatError(ErrorCode.VALIDATION_ERROR, err);

      if (!DIRECTIONS.includes(direction as (typeof DIRECTIONS)[number])) {
        return formatError(
          ErrorCode.VALIDATION_ERROR,
          "Invalid direction. Must be 'inbound' or 'outbound'.",
        );
      }

      // Clamp limit to 1-100
      if (limit !== undefined) {
        limit = Math.max(1, Math.min(100, limit));
      }

      try {
        const { data, rateLimit } = await client.get(
          `/employment/area/${areaType}/${geoid}/flows/${direction}`,
          { year, limit, minJobs },
        );
        return formatResponse(data, { name: SOURCE_NAME, vintage: String(year ?? "latest"), api: "employment" }, rateLimit);
      } catch (error) {
        if (error instanceof ApiError) {
          if (error.code === ErrorCode.PERMISSION_DENIED) {
            return formatError(error.code, "Permission denied: employment data requires Business tier or above.");
          }
          if (error.code === ErrorCode.UPSTREAM_ERROR) {
            return formatError(error.code, "Employment data is temporarily unavailable. Please try again.");
          }
          return formatError(error.code, error.message, error.details);
        }
        return formatError(ErrorCode.INTERNAL_ERROR, "An unexpected error occurred.");
      }
    },
  },
];
