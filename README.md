# @gener8v/mcp-geographic-data

MCP server for the [loc8n Geographic Data API](https://loc8n.com). Exposes U.S. demographics, housing, mortgage, migration, employment, and geographic data as tools for any MCP-compatible client (Claude Desktop, Claude Code, Cursor, etc.).

## Quick Start

```bash
npm install -g @gener8v/mcp-geographic-data
```

Set your API key:

```bash
export LOC8N_API_KEY="your-api-key"
```

Get a key at [loc8n.com](https://loc8n.com).

## Usage

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "geographic-data": {
      "command": "mcp-geographic-data",
      "env": {
        "LOC8N_API_KEY": "your-api-key"
      }
    }
  }
}
```

### Claude Code

Add to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "geographic-data": {
      "command": "mcp-geographic-data",
      "env": {
        "LOC8N_API_KEY": "your-api-key"
      }
    }
  }
}
```

### SSE Transport

For HTTP-based clients:

```bash
mcp-geographic-data --transport sse --port 3100
```

Endpoints:
- SSE: `http://localhost:3100/sse`
- Messages: `http://localhost:3100/messages`
- Health: `http://localhost:3100/health`

## Tools (23)

### Geographic Lookup

| Tool | Description |
|------|-------------|
| `lookup_zip_code` | Get details for a ZIP code (city, county, state, coordinates) |
| `search_zip_codes_by_city` | Find ZIP codes for a city/state |
| `find_zip_codes_in_radius` | Find ZIP codes within a radius of a point |
| `calculate_zip_code_distance` | Calculate distance between two ZIP codes |
| `search_areas` | Search counties, states, or metro areas by name |

### Demographics

| Tool | Description |
|------|-------------|
| `get_demographics` | Full demographic profile (population, income, education, etc.) |
| `get_demographics_category` | Single demographic category in detail |
| `get_demographics_trend` | Year-over-year demographic trends |
| `compare_demographics` | Side-by-side comparison of two areas |

### Housing & Market Data

| Tool | Description |
|------|-------------|
| `get_fair_market_rent` | HUD Fair Market Rent by bedroom count |
| `get_fmr_trend` | Fair Market Rent trends over time |

### Mortgage & Lending

| Tool | Description |
|------|-------------|
| `get_mortgage_summary` | HMDA mortgage origination summary |
| `get_mortgage_trends` | Mortgage lending trends over time |
| `compare_mortgage` | Side-by-side mortgage comparison of two areas |

### Migration

| Tool | Description |
|------|-------------|
| `get_migration_summary` | IRS SOI migration inflows/outflows |
| `get_migration_flows` | Top origin/destination flows for an area |
| `get_migration_trends` | Migration trends across year pairs |

### Employment

| Tool | Description |
|------|-------------|
| `get_employment` | LODES employment profile (jobs, sectors, wages) |
| `get_employment_trend` | Employment trends over time |
| `compare_employment` | Side-by-side employment comparison |
| `get_commute_flows` | Top commute origins/destinations |

### Geocoding

| Tool | Description |
|------|-------------|
| `geocode_address` | Convert address to coordinates and FIPS codes |
| `reverse_geocode` | Convert coordinates to address and area identifiers |

## Resources (7)

| URI | Description |
|-----|-------------|
| `data://demographics/available-years` | Available years for ACS demographics data |
| `data://fmr/available-years` | Available years for HUD Fair Market Rent data |
| `data://mortgage/available-years` | Available years for HMDA mortgage data |
| `data://migration/available-years` | Available year pairs for IRS migration data |
| `data://employment/available-years` | Available years for LODES employment data |
| `data://tiers` | Subscription tier definitions and permissions |
| `data://auth/context` | Current API key tier, permissions, and rate limits |

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `LOC8N_API_KEY` | Yes | — | API key for the loc8n Geographic Data API |
| `LOC8N_API_BASE_URL` | No | `https://api.loc8n.com` | API base URL |

## CLI Options

```
mcp-geographic-data [options]

  --transport <stdio|sse>  Transport protocol (default: stdio)
  --port <number>          Port for SSE transport (default: 3100)
  --help, -h               Show help
```

## Development

```bash
git clone https://github.com/gener8v/gener8v.mcp.geographic-data.git
cd gener8v.mcp.geographic-data
npm install
npm run build
```

## License

MIT
