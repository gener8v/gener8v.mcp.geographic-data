import type { ToolDefinition } from "./index.js";
import { formatResponse, formatError } from "../response.js";
import { ApiError, ErrorCode } from "../types.js";

const SOURCE_NAME = "IRS Statistics of Income";

const VALID_LEVELS = ["county", "state"];

const FIPS_RULES: Record<string, { digits: number; label: string }> = {
  county: { digits: 5, label: "county" },
  state: { digits: 2, label: "state" },
};

const YEAR_PAIR_PATTERN = /^\d{4}-\d{4}$/;

function validateLevel(level: string): string | null {
  if (!VALID_LEVELS.includes(level)) {
    return "Invalid level. Migration data is available for county and state only.";
  }
  return null;
}

function validateFips(level: string, fips: string): string | null {
  const rule = FIPS_RULES[level];
  if (!rule) return null;
  const pattern = new RegExp(`^\\d{${rule.digits}}$`);
  if (!pattern.test(fips)) {
    return level === "county"
      ? "County FIPS must be exactly 5 digits."
      : "State FIPS must be exactly 2 digits.";
  }
  return null;
}

function validateYearPair(year: string): string | null {
  if (!YEAR_PAIR_PATTERN.test(year)) {
    return "Year must be a year pair in format YYYY-YYYY (e.g., 2021-2022).";
  }
  const [y1, y2] = year.split("-").map(Number);
  if (y2 !== y1 + 1) {
    return "Year must be a year pair in format YYYY-YYYY (e.g., 2021-2022).";
  }
  return null;
}

export const migrationTools: ToolDefinition[] = [
  {
    name: "get_migration_summary",
    description:
      "Retrieve migration summary for a county or state showing aggregate inflows, outflows, and net migration. " +
      "Returns net returns (positive = net in-migration, negative = net out-migration), net exemptions (proxy for people), " +
      "and net AGI (adjusted gross income in thousands of dollars). " +
      "Year is specified as a year pair (e.g., '2021-2022') representing tax filing year transitions. " +
      "Source: IRS Statistics of Income.",
    annotations: {
      title: "Get Migration Summary",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: "object",
      properties: {
        level: {
          type: "string",
          enum: ["county", "state"],
          description: "Geographic level: county or state",
        },
        fips: {
          type: "string",
          description: "FIPS code — 5 digits for county, 2 for state",
        },
        year: {
          type: "string",
          description: "Year pair (e.g., '2021-2022'). Defaults to most recent available.",
        },
      },
      required: ["level", "fips"],
    },
    handler: async (args, client) => {
      const level = args.level as string;
      const fips = args.fips as string;
      const year = args.year as string | undefined;

      const levelError = validateLevel(level);
      if (levelError) return formatError(ErrorCode.VALIDATION_ERROR, levelError);

      const fipsError = validateFips(level, fips);
      if (fipsError) return formatError(ErrorCode.VALIDATION_ERROR, fipsError);

      if (year !== undefined) {
        const yearError = validateYearPair(year);
        if (yearError) return formatError(ErrorCode.VALIDATION_ERROR, yearError);
      }

      const path = `/migration/${level}/${fips}/summary`;

      try {
        const response = await client.get<unknown>(path, year !== undefined ? { year } : undefined);

        return formatResponse(response.data, {
          name: SOURCE_NAME,
          vintage: year ?? null,
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
    name: "get_migration_flows",
    description:
      "Retrieve top inflow or outflow areas for a county or state, ranked by number of tax returns or AGI. " +
      "Inflows show where people moved from (into this area); outflows show where people moved to (out of this area). " +
      "Returns an array of flow records with FIPS, area name, returns, exemptions, and AGI (in thousands of dollars). " +
      "Some flow entries may be suppressed by the IRS for privacy when returns fall below the disclosure threshold. " +
      "Source: IRS Statistics of Income.",
    annotations: {
      title: "Get Migration Flows",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: "object",
      properties: {
        level: {
          type: "string",
          enum: ["county", "state"],
          description: "Geographic level: county or state",
        },
        fips: {
          type: "string",
          description: "FIPS code — 5 digits for county, 2 for state",
        },
        direction: {
          type: "string",
          enum: ["inflow", "outflow"],
          description: "Flow direction: inflow (moved into area) or outflow (moved out of area)",
        },
        year: {
          type: "string",
          description: "Year pair (e.g., '2021-2022'). Defaults to most recent available.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 50,
          description: "Number of top flow areas to return (1-50, default: 10)",
        },
        sort: {
          type: "string",
          enum: ["returns", "agi"],
          description: "Ranking metric: 'returns' (household count) or 'agi' (income). Default: 'returns'.",
        },
      },
      required: ["level", "fips", "direction"],
    },
    handler: async (args, client) => {
      const level = args.level as string;
      const fips = args.fips as string;
      const direction = args.direction as string;
      const year = args.year as string | undefined;
      const limit = args.limit as number | undefined;
      const sort = args.sort as string | undefined;

      const levelError = validateLevel(level);
      if (levelError) return formatError(ErrorCode.VALIDATION_ERROR, levelError);

      const fipsError = validateFips(level, fips);
      if (fipsError) return formatError(ErrorCode.VALIDATION_ERROR, fipsError);

      if (direction !== "inflow" && direction !== "outflow") {
        return formatError(
          ErrorCode.VALIDATION_ERROR,
          "Direction must be 'inflow' or 'outflow'.",
        );
      }

      if (year !== undefined) {
        const yearError = validateYearPair(year);
        if (yearError) return formatError(ErrorCode.VALIDATION_ERROR, yearError);
      }

      if (limit !== undefined && (limit < 1 || limit > 50)) {
        return formatError(
          ErrorCode.VALIDATION_ERROR,
          "Limit must be between 1 and 50.",
        );
      }

      if (sort !== undefined && sort !== "returns" && sort !== "agi") {
        return formatError(
          ErrorCode.VALIDATION_ERROR,
          "Sort must be 'returns' or 'agi'.",
        );
      }

      const apiDirection = direction === "inflow" ? "inflows" : "outflows";
      const path = `/migration/${level}/${fips}/${apiDirection}`;

      const params: Record<string, string | number | undefined> = {};
      if (year !== undefined) params.year = year;
      if (limit !== undefined) params.limit = limit;
      if (sort !== undefined) params.sort = sort;

      try {
        const response = await client.get<unknown>(
          path,
          Object.keys(params).length > 0 ? params : undefined,
        );

        return formatResponse(response.data, {
          name: SOURCE_NAME,
          vintage: year ?? null,
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
    name: "get_migration_trends",
    description:
      "Retrieve migration summary data across all available year pairs for a county or state. " +
      "Returns an array of yearly migration summaries sorted by year pair, each including net returns, " +
      "net exemptions, net AGI, and inflow/outflow breakdowns. AGI values are in thousands of dollars. " +
      "Source: IRS Statistics of Income.",
    annotations: {
      title: "Get Migration Trends",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: "object",
      properties: {
        level: {
          type: "string",
          enum: ["county", "state"],
          description: "Geographic level: county or state",
        },
        fips: {
          type: "string",
          description: "FIPS code — 5 digits for county, 2 for state",
        },
      },
      required: ["level", "fips"],
    },
    handler: async (args, client) => {
      const level = args.level as string;
      const fips = args.fips as string;

      const levelError = validateLevel(level);
      if (levelError) return formatError(ErrorCode.VALIDATION_ERROR, levelError);

      const fipsError = validateFips(level, fips);
      if (fipsError) return formatError(ErrorCode.VALIDATION_ERROR, fipsError);

      const path = `/migration/${level}/${fips}/trends`;

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
];
