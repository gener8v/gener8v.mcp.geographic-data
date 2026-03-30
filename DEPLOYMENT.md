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

## TODO

- [ ] **npm publish** — Cut a GitHub release to trigger `publish.yml` and get `@gener8v/mcp-geographic-data` on npm
- [ ] **MCP directory listings** — Submit to [modelcontextprotocol.io](https://modelcontextprotocol.io) server directory and Anthropic MCP servers list
- [ ] **Smithery.ai** — Register on the [Smithery](https://smithery.ai) MCP server registry
- [ ] **Dashboard integration** — Add "MCP" tab/section to the dashboard page showing the connection URL with the user's active API key pre-filled
- [ ] **Pricing page** — Mention MCP access as a feature in the tier comparison table
