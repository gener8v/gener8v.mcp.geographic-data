import type { ApiClient } from "../api-client.js";
import type { AuthManager } from "../auth.js";
import { formatResponse, formatError } from "../response.js";
import { ApiError, ErrorCode } from "../types.js";
import type { ToolDefinition } from "./index.js";

const SOURCE_NAME = "Geocoding (multi-provider)";

export const geocodingTools: ToolDefinition[] = [
  // ── geocode_address ─────────────────────────────────────────────────
  {
    name: "geocode_address",
    description:
      "Convert a street address or place name into geographic coordinates. " +
      "Returns up to 'limit' candidate results with coordinates, formatted " +
      "address, address components, confidence score, and provider name. " +
      "The optional 'country' parameter biases (but does not strictly filter) " +
      "results toward the given country.",
    annotations: {
      title: "Geocode Address",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: "object",
      properties: {
        address: {
          type: "string",
          description: "The address or place name to geocode (minimum 3 characters).",
        },
        limit: {
          type: "integer",
          description: "Maximum number of results to return (1-10, default 5).",
        },
        country: {
          type: "string",
          description:
            "2-letter uppercase ISO 3166-1 country code to bias results (e.g., 'US'). " +
            "Biases but does not strictly filter — results from other countries may appear.",
        },
      },
      required: ["address"],
    },
    handler: async (args, client, _auth) => {
      const address = args.address as string;
      let limit = args.limit as number | undefined;
      const country = args.country as string | undefined;

      // Validate address length
      if (!address || address.length < 3) {
        return formatError(
          ErrorCode.VALIDATION_ERROR,
          "Address must be at least 3 characters.",
        );
      }

      // Validate country code format
      if (country !== undefined) {
        if (!/^[A-Z]{2}$/.test(country)) {
          return formatError(
            ErrorCode.VALIDATION_ERROR,
            "Country must be a 2-letter uppercase ISO code (e.g., 'US').",
          );
        }
      }

      // Clamp limit to 1-10
      if (limit !== undefined) {
        limit = Math.max(1, Math.min(10, limit));
      }

      try {
        const { data, rateLimit } = await client.get("/geocode", {
          address,
          limit,
          country,
        });
        return formatResponse(data, { name: SOURCE_NAME, vintage: null, api: "geocoding" }, rateLimit);
      } catch (error) {
        if (error instanceof ApiError) {
          if (error.code === ErrorCode.AUTH_ERROR) {
            return formatError(error.code, "Authentication failed — check your API key.");
          }
          if (error.code === ErrorCode.PERMISSION_DENIED) {
            return formatError(error.code, "Permission denied — geocoding requires a Starter tier or higher subscription.");
          }
          if (error.code === ErrorCode.RATE_LIMITED) {
            const retryAfter = (error.details as { retryAfterSeconds?: number })?.retryAfterSeconds;
            const msg = retryAfter
              ? `Rate limit exceeded — try again in ${retryAfter} seconds.`
              : "Rate limit exceeded — try again later.";
            return formatError(error.code, msg);
          }
          if (error.code === ErrorCode.UPSTREAM_ERROR) {
            return formatError(error.code, "Geographic Data API is unavailable — please try again later.");
          }
          return formatError(error.code, error.message, error.details);
        }
        return formatError(ErrorCode.INTERNAL_ERROR, "An unexpected error occurred.");
      }
    },
  },

  // ── reverse_geocode ─────────────────────────────────────────────────
  {
    name: "reverse_geocode",
    description:
      "Convert a latitude/longitude coordinate pair into a street address. " +
      "Returns the best-match formatted address, address components, and coordinates.",
    annotations: {
      title: "Reverse Geocode",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: "object",
      properties: {
        latitude: {
          type: "number",
          description: "Latitude in decimal degrees (-90 to 90).",
        },
        longitude: {
          type: "number",
          description: "Longitude in decimal degrees (-180 to 180).",
        },
      },
      required: ["latitude", "longitude"],
    },
    handler: async (args, client, _auth) => {
      const latitude = args.latitude as number;
      const longitude = args.longitude as number;

      // Validate latitude range
      if (latitude < -90 || latitude > 90) {
        return formatError(
          ErrorCode.VALIDATION_ERROR,
          "Latitude must be between -90 and 90.",
        );
      }

      // Validate longitude range
      if (longitude < -180 || longitude > 180) {
        return formatError(
          ErrorCode.VALIDATION_ERROR,
          "Longitude must be between -180 and 180.",
        );
      }

      try {
        const { data, rateLimit } = await client.get("/geocode/reverse", {
          latitude,
          longitude,
        });
        return formatResponse(data, { name: SOURCE_NAME, vintage: null, api: "geocoding" }, rateLimit);
      } catch (error) {
        if (error instanceof ApiError) {
          if (error.code === ErrorCode.AUTH_ERROR) {
            return formatError(error.code, "Authentication failed — check your API key.");
          }
          if (error.code === ErrorCode.PERMISSION_DENIED) {
            return formatError(error.code, "Permission denied — geocoding requires a Starter tier or higher subscription.");
          }
          if (error.code === ErrorCode.RATE_LIMITED) {
            const retryAfter = (error.details as { retryAfterSeconds?: number })?.retryAfterSeconds;
            const msg = retryAfter
              ? `Rate limit exceeded — try again in ${retryAfter} seconds.`
              : "Rate limit exceeded — try again later.";
            return formatError(error.code, msg);
          }
          if (error.code === ErrorCode.UPSTREAM_ERROR) {
            return formatError(error.code, "Geographic Data API is unavailable — please try again later.");
          }
          return formatError(error.code, error.message, error.details);
        }
        return formatError(ErrorCode.INTERNAL_ERROR, "An unexpected error occurred.");
      }
    },
  },
];
