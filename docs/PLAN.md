# Edison X build plan

Built to `edison-x-builder/` (Rules, Prompt.md, Guidelines.md). Where this plan and the Rules disagree, the Rules win.

## Versions used (recorded per Rules/03-mcp-protocol.md)

| Package                                 | Version                                                      |
| --------------------------------------- | ------------------------------------------------------------ |
| Node.js (LTS)                           | 22.x (`engines: >=22`)                                       |
| `@modelcontextprotocol/sdk`             | 1.32.1 (stdio and Streamable HTTP, `McpServer.registerTool`) |
| `zod`                                   | 4.6.5                                                        |
| `better-sqlite3`                        | 13.0.3 (SQLite 3.53 with FTS5)                               |
| `pino`                                  | 10.4.0                                                       |
| `sharp`                                 | 0.35.5 (image resize for `get_design include_image`)         |
| `@anthropic-ai/sdk`                     | 0.131.0 (analysis layer only)                                |
| TypeScript / Vitest / ESLint / Prettier | 7.0.2 / 5.0.3 / 10.12 / 3.9                                  |

MCP spec and SDK docs were read from the installed package's type definitions (no network docs were reachable for the MCP site).

## Phases

| #   | Scope                                                                                                                 | Proof                                                     |
| --- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 0   | Scaffold, strict TS, lint/format/test, `config.ts`, source register, fail-closed registry                             | `pnpm ci`; registry refuses a source with any blank field |
| 1   | SQLite repository + migrations, `LibraryAdapter`, 30 seed designs, ranking, `search_inspiration`, `get_design`, stdio | MCP client contract tests; determinism test               |
| 2   | `find_similar_designs`, `get_inspiration_brief`, `list_taxonomy`, `list_sources`                                      | Contract tests; brief cites only real ids                 |
| 3   | Streamable HTTP, API keys, scopes, key CLI, rate limits, sanitizer, SSRF guard, redaction, audit, health              | Security suite                                            |
| 4   | Pinterest adapter (official API v5, user OAuth, encrypted tokens)                                                     | Mocked-API integration tests; token-leak grep test        |
| 5   | Analysis layer (async job, schema validation, backfill with cost cap and dry run)                                     | Validation, owner-protection, gating tests                |
| 6   | Collections, `submit_design`, `get_connection_status`                                                                 | Ownership and rejection tests                             |
| 7   | Load test, backup/restore, docs, container, audit, final checklist                                                    | `docs/CHECKLIST.md` with evidence                         |

## Design decisions

- **Stateless HTTP.** One `McpServer` per request, bound to the authenticated principal. No session store, so keys revoke instantly and instances scale horizontally.
- **Auth seam.** `resolvePrincipal(request)` in `src/auth/principal.ts` is the only place that turns a request into a principal. An OAuth 2.1 server can replace API keys by swapping that function.
- **Capabilities are the intersection** of what an adapter implements and what its `docs/SOURCES.md` entry grants. A register edit narrows behaviour with no code change.
- **Retrieval is per adapter; ranking is uniform.** The library adapter retrieves with FTS5; live adapters call their API. The service then scores all candidates together with one FTS5 bm25 pass plus deterministic boosts, tie-broken by id.
- **User-private data stays private.** Designs cached from a user's own Pinterest carry `owner_principal_id`; reads and searches only return them to that principal.
- **Connect links.** `get_connection_status` returns a short-lived signed link so a browser (which cannot send a Bearer header) can start the OAuth flow bound to the right principal. The OAuth `state` is single-use and stored hashed.
- **`/readyz` requires a valid key** (Rules/02 allows only `/healthz` anonymously). `/healthz` is anonymous and reveals nothing. The OAuth callback is anonymous by necessity and is protected by the single-use `state`.

## Questions for the owner (asked now, per Prompt.md step 0)

1. **Pinterest terms review and approval.** The build environment could not reach Pinterest's developer site, so the register entry is `PENDING` and the adapter will not load. Someone with access must read the current terms (especially any AI/ML data rule), fill `docs/SOURCES.md`, and approve. Which access tier (Trial or Standard) is the developer app on?
2. **Library approval.** The `library` entry records approval from your build instruction. Please confirm or edit that line.
3. **Seed content.** The 30 starter designs are original generic patterns. Do you have real, credited, licensed designs to import with `pnpm library:import`?
4. **Image hosts.** Which hosts serve your own library images (`LIBRARY_IMAGE_HOSTS`)? Until set, `include_image` is unavailable.
5. **Analysis.** Which model and daily budget? A key for `ANTHROPIC_API_KEY` is needed only if `ANALYSIS_ENABLED=true`.
6. **Hosting.** What public https URL will serve the remote transport? TLS must terminate in front of the server.
7. **Second source.** Do you want to name another approved source for v1 (optional)?
