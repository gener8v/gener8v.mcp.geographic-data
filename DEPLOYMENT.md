# MCP Server Deployment

Deployed **2026-03-27** at `https://mcp.loc8n.com`.

## Architecture

- **Transports**: stdio (local install via npm) and SSE (hosted)
- **Multi-tenant SSE**: Each client connection passes their own API key. The server creates an isolated session per connection and forwards the key to the base API at `api.loc8n.com`. No server-level API key is needed.
- **Infrastructure**: Defined in `gener8v.api.geographic-data/infrastructure/`
  - **Compute**: ECS Fargate (512 CPU / 1024 MB), autoscaling 1–4 tasks at 70% CPU
  - **Networking**: ALB host-based routing (`mcp.loc8n.com` → port 3100), ECS security group ingress on port 3100
  - **DNS**: Route 53 A record pointing to ALB, ACM certificate SAN for `mcp.loc8n.com`
  - **Container**: ECR repository `gener8v-geographic-data-mcp`, lifecycle policy keeps last 10 images
  - **Logging**: CloudWatch log group `/ecs/gener8v-geodata-prod-mcp` (14-day retention)

## CI/CD

All workflows live in this repo under `.github/workflows/`:

| Workflow | Trigger | Action |
|----------|---------|--------|
| `deploy.yml` | Push to `main` | Lint, build, push Docker image to ECR, deploy to ECS |
| `pr.yml` | Pull request to `main` | Lint, build |
| `publish.yml` | GitHub release published | Lint, build, `npm publish --provenance --access public` |

**Required GitHub Actions secrets**: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `NPM_TOKEN`

## E2E Validation (2026-03-27)

| Check | Result |
|-------|--------|
| `GET /health` | `{"status":"ok","sessions":0}` |
| `GET /sse` (no key) | 401 — `"API key required..."` |
| `GET /sse` (with key) | SSE connection opens, returns session endpoint |
| `tools/list` | 23 tools returned across 7 domains |
| `tools/call` (`lookup_zip_code`, `30301`) | Atlanta, GA, Fulton County |
| Rate limit passthrough | `5000 limit, 4999 remaining` — tracked against client key |
| Unknown route | 404 |

## Website Integration

- **Homepage**: Feature card "MCP Server" links to `/docs/mcp`
- **Docs page**: `/docs/mcp` with hosted endpoint URL, setup guides (Claude Desktop, Claude Code, Cursor, Windsurf), tool reference, resources, CLI docs

## CI/CD Secrets

IAM user `gener8v.geodata.ci` with inline policy `geodata-ci-deploy` (ECR push, ECS deploy, IAM PassRole, S3 backups).

| Repo | Account | Key |
|------|---------|-----|
| `gener8v/gener8v.mcp.geographic-data` | `gener8v` org | `AKIAZAI4GSUSSHLKLVA7` (created 2026-03-30) |
| `gener8v-thomas/gener8v.ui.geographic-data` | `gener8v-thomas` personal | `AKIAZAI4GSUSSHLKLVA7` (rotated 2026-03-30) |
| `gener8v-thomas/gener8v.api.geographic-data` | `gener8v-thomas` personal | `AKIAZAI4GSUS2GG44UUT` (original, still active) |

MCP and UI repos share the new key. API repo still uses the original key. Both keys belong to `gener8v.geodata.ci`.

## TODO

### npm Publish

Cut a GitHub release to trigger `publish.yml` and get `@gener8v/mcp-geographic-data` on npm. Requires `NPM_TOKEN` secret in the repo.

```bash
gh release create v0.1.0 --repo gener8v/gener8v.mcp.geographic-data \
  --title "v0.1.0" --notes "Initial release — 23 tools, stdio + SSE transports"
```

### MCP Directory Listings

Submit to external registries for discoverability:

- **modelcontextprotocol.io** — PR to [github.com/modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers) adding an entry under Community Servers
- **Anthropic MCP servers list** — Same repo, or via Anthropic's submission process
- **Smithery.ai** — Register at [smithery.ai](https://smithery.ai), the MCP server registry. Requires a `smithery.yaml` config in the repo root.

### Website Changes (gener8v.ui.geographic-data)

- **Dashboard integration** — Add "MCP" tab or section to the `/dashboard` page showing the SSE connection URL with the user's active API key pre-filled (e.g. `https://mcp.loc8n.com/sse?apiKey=gdk_...`). Copy-to-clipboard button + config snippets for each client.
- **Pricing page** — Add MCP access as a row in the tier comparison table. MCP is available on all tiers (same permissions as the REST API).
