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

| #   | Scope                                                                                                                 | Proof                                                         |
| --- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 0   | Scaffold, strict TS, lint/format/test, `config.ts`, source register, fail-closed registry                             | `pnpm verify`; registry refuses a source with any blank field |
| 1   | SQLite repository + migrations, `LibraryAdapter`, 30 seed designs, ranking, `search_inspiration`, `get_design`, stdio | MCP client contract tests; determinism test                   |
| 2   | `find_similar_designs`, `get_inspiration_brief`, `list_taxonomy`, `list_sources`                                      | Contract tests; brief cites only real ids                     |
| 3   | Streamable HTTP, API keys, scopes, key CLI, rate limits, sanitizer, SSRF guard, redaction, audit, health              | Security suite                                                |
| 4   | Pinterest adapter (official API v5, user OAuth, encrypted tokens)                                                     | Mocked-API integration tests; token-leak grep test            |
| 5   | Analysis layer (async job, schema validation, backfill with cost cap and dry run)                                     | Validation, owner-protection, gating tests                    |
| 6   | Collections, `submit_design`, `get_connection_status`                                                                 | Ownership and rejection tests                                 |
| 7   | Load test, backup/restore, docs, container, audit, final checklist                                                    | `docs/CHECKLIST.md` with evidence                             |

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
8. **Repository license.** No `LICENSE` file was added; which license (if any) should the code carry?
9. **Real-agent run.** Someone with a Claude plan must add the server as a custom connector (steps in `docs/CONNECTING.md`) and run search, get_design and brief for three goals; the scripted transcripts in `docs/e2e-transcripts.md` are not a substitute.

## Dependency justification (Rules/02: justify every dependency)

| Package                                                                                                                                   | Why it is needed                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `@modelcontextprotocol/sdk`                                                                                                               | The official MCP server and transports (mandated).                                                            |
| `zod`                                                                                                                                     | Validation of every tool input, output, upstream response and env var (mandated; the MCP SDK's peer).         |
| `better-sqlite3`                                                                                                                          | SQLite with FTS5 behind the `Repository` interface. Synchronous, fast, prebuilt binaries.                     |
| `pino`                                                                                                                                    | Structured JSON logging with a redaction hook.                                                                |
| `sharp`                                                                                                                                   | Resize proxied images to at most 1280 px and 1 MB for `get_design include_image`. Prebuilt binaries from npm. |
| `@anthropic-ai/sdk`                                                                                                                       | The official SDK, used only by the optional analysis layer.                                                   |
| Dev: `typescript` (6.0), `vitest`, `eslint`, `typescript-eslint`, `@eslint/js`, `prettier`, `tsx`, `@types/node`, `@types/better-sqlite3` | Build, test, lint, format, run TypeScript CLIs.                                                               |

`pnpm audit --audit-level=high` reports no known vulnerabilities (run in CI). No scraping or unofficial-client package is present; a test fails the build if one appears.

## Deviations from the guidelines, and why

| #   | Deviation                                                                                                                                      | Reason                                                                                                                                                                              |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `/readyz` requires a valid key (Guidelines 11 implies it is open)                                                                              | `Rules/02-security.md` allows only `/healthz` anonymously; Rules win. `/healthz` is open and reveals nothing.                                                                       |
| 2   | A source's capabilities are the **intersection** of the adapter and its register entry, instead of refusing an adapter that claims more        | Stricter at runtime and lets the owner narrow behaviour by editing the register, with no code change.                                                                               |
| 3   | Pinterest search is list-and-filter over the user's own pins (`GET /v5/pins`), not a search endpoint                                           | I could not read Pinterest's current docs (network blocked), so I used only the one endpoint I am confident exists. The owner can swap in a search endpoint after the terms review. |
| 4   | Token and cursor keys are derived from `TOKEN_ENCRYPTION_KEY` with HKDF (separate keys per purpose)                                            | One secret to manage; no key reuse across purposes.                                                                                                                                 |
| 5   | Extra operational surface: `/metrics` (admin), `db:backup`/`db:restore`, `source:purge`, `src/app.ts`, `src/errors.ts`, `src/cli/`, `scripts/` | Needed for the metrics, backup and takedown requirements. No tool was added beyond the 12 in Guidelines 6.                                                                          |
| 6   | The 32 starter library designs are **original generic patterns**, not 30 real third-party or open-licensed designs                             | I cannot verify third-party licenses offline, and inventing credited records would be fabrication. Replace them with real, credited designs.                                        |
| 7   | The library's owner approval line is derived from the owner's build instruction                                                                | The owner should confirm or edit it.                                                                                                                                                |
| 8   | `origin` on `submit_design` is optional                                                                                                        | Guidelines 6.8 requires only `sourceUrl`, `attribution`, `license`.                                                                                                                 |
| 9   | TypeScript is pinned to 6.0                                                                                                                    | `typescript-eslint` does not yet support 7.x.                                                                                                                                       |
| 10  | Similarity uses category, tags, platform, palette and components only; embeddings are not implemented                                          | Embeddings are optional and flag-gated in the guidelines.                                                                                                                           |
| 11  | Analysis calls go straight to the Anthropic SDK rather than through the SSRF fetcher                                                           | First-party API on a fixed host; the SDK sets its own timeout. Image bytes sent to it are fetched through the SSRF fetcher.                                                         |
| 12  | The failed-auth throttle is in memory (per process)                                                                                            | Good enough to blunt guessing; the per-key limits are persisted in the database.                                                                                                    |

## Outcome

Phase-by-phase reports are in `docs/PHASE-REPORTS.md` and the final checklist with evidence is in `docs/CHECKLIST.md`.
