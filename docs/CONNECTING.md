# Connecting agents to Edison X

Edison X speaks MCP over two transports. Use **stdio** for an agent on the same machine, **Streamable HTTP** for everything else. Nothing about a connection is specific to Claude: any MCP client works, and adding another agent only means issuing it another key.

## 1. Local agent (stdio)

stdio runs as the owner's local principal (`STDIO_PRINCIPAL_NAME`, scopes from `STDIO_SCOPES`, default `owner`). Build first: `pnpm install && pnpm build`.

**Claude Code**

```bash
claude mcp add edison-x \
  --env TOKEN_ENCRYPTION_KEY="$(pnpm -s gen:key)" \
  --env DATABASE_PATH=/absolute/path/to/edison-x.db \
  -- node /absolute/path/to/Edison-X.-mcp/dist/index.js
```

**Claude Desktop** (`claude_desktop_config.json`) or any client that takes a command:

```json
{
  "mcpServers": {
    "edison-x": {
      "command": "node",
      "args": ["/absolute/path/to/Edison-X.-mcp/dist/index.js"],
      "env": {
        "TOKEN_ENCRYPTION_KEY": "<32 random bytes, base64>",
        "DATABASE_PATH": "/absolute/path/to/edison-x.db"
      }
    }
  }
}
```

The same `TOKEN_ENCRYPTION_KEY` must be used every time against the same database. stdout carries the protocol, so all logs go to stderr.

## 2. Remote agents (Streamable HTTP)

1. Run the server with `TRANSPORT=http` (or the Docker image) behind TLS. Set `PUBLIC_BASE_URL` to its public https URL and `ENABLED_SOURCES` as needed. The MCP endpoint is **`https://<your-host>/mcp`**.
2. Issue a key for each agent (it is printed once and only its hash is stored):

   ```bash
   pnpm keys:create --name "claude-desktop" --scopes search-only
   # docker:  docker compose exec edison-x node dist/cli/keys.js create --name "claude-desktop" --scopes search-only
   ```

3. The agent sends `Authorization: Bearer ex_...` on every request. There is no anonymous access (only `/healthz`).

### Claude Code

```bash
claude mcp add --transport http edison-x https://<your-host>/mcp \
  --header "Authorization: Bearer ex_YOUR_KEY"
claude mcp get edison-x      # or /mcp inside Claude Code
```

Project-wide, in `.mcp.json`:

```json
{
  "mcpServers": {
    "edison-x": {
      "type": "http",
      "url": "https://<your-host>/mcp",
      "headers": { "Authorization": "Bearer ex_YOUR_KEY" }
    }
  }
}
```

### Claude (claude.ai and Claude Desktop) as a custom connector

Custom connectors support fixed credentials such as API keys that Claude sends on every request, which is how Edison X authenticates. Current steps, from [Anthropic's guide](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp) (check it for changes):

1. **Customize → Connectors → + Add → Add custom connector** (on Team and Enterprise plans an owner first adds it under **Organization settings → Connectors**, then members connect).
2. Name it `Edison X` and enter the server URL `https://<your-host>/mcp`.
3. For authentication choose the **fixed credentials** option and add the header `Authorization` with value `Bearer ex_YOUR_KEY`. Do not use OAuth.
4. Add it, then enable the connector in a chat. Ask: "Find me dark fitness dashboard inspiration for mobile."

### Any other agent

Give it the same URL and **its own key** with the scopes it needs. No code changes and no restart are needed; revoke it independently with `pnpm keys:revoke <key-id>`. Any client that can send an `Authorization` header over Streamable HTTP works (the TypeScript and Python MCP SDKs, the MCP Inspector, and so on).

```bash
# MCP Inspector, command line
npx @modelcontextprotocol/inspector --cli https://<your-host>/mcp --transport http \
  --header "Authorization: Bearer ex_YOUR_KEY" --method tools/list
```

### Scope presets (least privilege)

| Preset | Scopes | Use for |
|---|---|---|
| `search-only` (default) | `read:search`, `read:design` | agents that only look things up |
| `curator` | search-only + `write:library` | agents or people who add designs to the library |
| `owner` | curator + `write:collections`, `admin` | the owner; `admin` also opens `/metrics` |

Pass a preset or a list: `--scopes read:search,read:design,write:collections`. Per-key limits: `--rate-per-min 30 --rate-per-day 500` (defaults 60 and 1,000).

## 3. Connecting Pinterest (a person's own pins)

Pinterest is available only when its entry in `docs/SOURCES.md` is complete and approved (see the runbook). Then, for each person:

1. Their agent calls `get_connection_status` with `source: "pinterest"` and gets a short-lived `connect_url`.
2. The person opens it in a browser, approves access on Pinterest, and is sent back to Edison X. Tokens are stored encrypted and tied to that person's key.
3. `search_inspiration` now also searches their own pins. `DELETE /connect/pinterest` with their key removes the tokens and every cached pin.

## 4. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| HTTP **401** | Missing, malformed, unknown or revoked key. Check the `Authorization: Bearer ex_...` header (no quotes, no trailing spaces). Repeated 401s from one address are throttled (429). |
| Tool result "**lacks the required scope 'x'**" | The key is missing a scope (this is a tool error, not an HTTP 403). Issue a key with the right preset. |
| HTTP **403** | `Host` or `Origin` not allowed. Set `PUBLIC_BASE_URL` to the host you call, and `ALLOWED_ORIGINS` for browser clients. |
| HTTP **429** / "Rate limit reached" | Per-key limit. Wait for `Retry-After` seconds or raise the key's limits. |
| A source shows in `sources_skipped` as **"not connected"** | That source needs the person's own account: use `get_connection_status`. |
| `sources_skipped`: "rate limited", "timeout", "error" | The source was slow or refused; other sources still answered. Retry later; check `list_sources` health. |
| **Empty results** | Add concrete words (screen type, mood). Filler words are ignored. The library ships 32 starter patterns; add more with `submit_design`. A source that is not approved in `docs/SOURCES.md` is not loaded (see the startup log). |
| A source "refused: not loading" at startup | Its register entry is incomplete or older than 180 days. Fix the entry (`docs/RUNBOOK.md`). |
| stdio client shows garbage or hangs | Something wrote to stdout. Edison X logs to stderr only; check wrappers and shell profiles. |
