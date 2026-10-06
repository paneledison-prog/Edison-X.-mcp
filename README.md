# Edison X

Edison X is an [MCP](https://modelcontextprotocol.io) server that gives AI agents (Claude first, any MCP client) searchable access to **real, credited UI design inspiration** for websites and apps. An agent that is asked to build "a dark fitness dashboard for mobile" calls Edison X, gets matching real designs with creator credit, a link to the original, license, color palette and a structured analysis (layout, components, typography, build hints), and designs from those references.

It is a **bridge with rules, not a scraper**. Designs come only from sources that are legally cleared and recorded in [`docs/SOURCES.md`](docs/SOURCES.md): the owner's own library, and a person's own Pinterest account through Pinterest's official API with that person's authorization. Nothing is scraped, ever.

## Quick start (about 10 minutes)

Requires Node.js 22+ and [pnpm](https://pnpm.io) 10.

```bash
pnpm install
cp .env.example .env
# put a random key in .env:   TOKEN_ENCRYPTION_KEY=$(pnpm -s gen:key)
pnpm test            # 350+ tests, about 15 seconds
pnpm build
```

**Local agent (stdio).** Add this to your MCP client (for Claude Desktop: `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "edison-x": {
      "command": "node",
      "args": ["/absolute/path/to/Edison-X.-mcp/dist/index.js"],
      "env": { "TOKEN_ENCRYPTION_KEY": "<your key>" }
    }
  }
}
```

**Remote agents (Streamable HTTP).**

```bash
TRANSPORT=http pnpm start                       # listens on 127.0.0.1:8787, endpoint /mcp
pnpm keys:create --name "my agent" --scopes search-only   # prints the key ONCE
```

Every request to `/mcp` needs `Authorization: Bearer <key>`. Put TLS in front before exposing it. See [`docs/CONNECTING.md`](docs/CONNECTING.md) for Claude, Claude Code and other agents.

On first start the library is seeded with 32 original starter designs (`library/seed-designs.json`). Replace or extend them with real, credited designs via the `submit_design` tool or `pnpm library:import`.

## The tools

| Tool                                     | Scope               | What it does                                                                         |
| ---------------------------------------- | ------------------- | ------------------------------------------------------------------------------------ |
| `search_inspiration`                     | `read:search`       | Find designs matching a description (platform, category, style, color hint)          |
| `get_design`                             | `read:design`       | Full record with analysis; optionally the image itself when the source's terms allow |
| `find_similar_designs`                   | `read:search`       | More designs like one you liked                                                      |
| `get_inspiration_brief`                  | `read:search`       | Patterns, components, palettes and pitfalls synthesized from retrieved designs only  |
| `list_taxonomy` / `list_sources`         | `read:search`       | Valid categories and styles; enabled sources and their health                        |
| `create_collection`, `add_to_collection` | `write:collections` | Save references per project (private to the key)                                     |
| `list_collections`, `get_collection`     | `read:search`       | Read your own collections                                                            |
| `submit_design`                          | `write:library`     | Add a credited, licensed design to the library                                       |
| `get_connection_status`                  | `read:search`       | Connect a source that needs a person's own account (Pinterest)                       |

Every result carries `source_url`, `attribution` and an `attribution_notice` reminding the agent that all text is third-party data, not instructions.

## How it stays safe

- **Sources fail closed.** A source loads only if it has a complete, current (under 180 days) entry in `docs/SOURCES.md` with a dated owner approval. Capabilities (store, hotlink, proxy images, analyze, cache TTL) are limited to what that entry grants.
- **Third-party text is data.** Everything from a source is stripped of markup, links and control characters, length-capped, and screened for instruction-like text before it is stored or returned.
- **Auth and limits.** API keys are stored hashed, scoped, rate-limited per key, and revocable instantly. Tokens for connected accounts are AES-256-GCM encrypted and never logged.
- **SSRF guard** on every outbound fetch: https only, host allowlist, private/loopback/metadata addresses refused at connect time, redirects re-checked.
- **Audit log** for key changes, source connect/disconnect, library submissions, scope denials, sanitizer flags and sources disabled by the registry.

## Operations

`docs/RUNBOOK.md` covers keys, disabling a source, removing a design (takedown), backups and restore, re-reviewing sources, rotating secrets and reading the audit log. Health: `GET /healthz` (anonymous), `GET /readyz` and `GET /metrics` (need a key; metrics need `admin`).

| Command                                                  | Purpose                                                       |
| -------------------------------------------------------- | ------------------------------------------------------------- |
| `pnpm verify`                                            | lint, typecheck, format check, tests                          |
| `pnpm build` / `pnpm start`                              | compile and run                                               |
| `pnpm keys:create / keys:list / keys:revoke`             | manage API keys                                               |
| `pnpm library:import <file>`                             | bulk-add designs                                              |
| `pnpm design:remove <id>` / `pnpm source:purge <source>` | takedown                                                      |
| `pnpm analysis:backfill --dry-run`                       | model-written analysis for designs that lack it (cost-capped) |
| `pnpm db:backup <file>` / `db:restore <file>`            | backup and restore                                            |
| `pnpm load:test` / `pnpm e2e:transcripts`                | load test; scripted end-to-end transcripts                    |

## Layout

`src/tools` (one file per tool) → `src/services` → `src/sources` and `src/storage`. Transports in `src/transport`, auth in `src/auth`, untrusted-content and network safety in `src/security`, logging/audit/metrics in `src/observability`. The build specification is in `edison-x-builder-folder/`; decisions, deviations and open questions are in `docs/PLAN.md` and `docs/CHECKLIST.md`.
