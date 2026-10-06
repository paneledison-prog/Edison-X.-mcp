# Phase reports

Format from `Prompt.md` section 7. Statuses are what the evidence supports: PARTIAL means some acceptance criteria could not be proven in the build environment (no Pinterest access, no Docker daemon, no real agent), and says exactly which.

Latest full run: `pnpm verify` (lint, typecheck, format check, 361 tests in 22 files, build) passes. Test count by category: unit 104, contract 61, integration 38, security 158. `pnpm audit --audit-level=high`: no known vulnerabilities.

## Phase 0 report - Foundation and legal register

Status: PASSED
Built: strict TS scaffold (`tsconfig.json`), ESLint (type-aware, `no-floating-promises`, no `any`), Prettier, Vitest, `config.ts`, GitHub Actions workflow, `docs/PLAN.md`, `docs/SOURCES.md`, source-register parser and fail-closed registry (`src/sources/register.ts`, `registry.ts`).
Proof: `pnpm verify` passes. `test/unit/registry.test.ts` proves a source with any missing register field refuses to load (one test per required field in `test/unit/register.test.ts`), plus BLOCKED, stale review, missing entry, status mismatch and capability narrowing. `test/unit/config.test.ts` covers startup validation without echoing values.
Rules check: 00-3 (no source without a register entry), 00-9 (fail closed), 04 (strict TS, typed errors).
Deviations: TypeScript pinned to 6.0 (typescript-eslint does not support 7.x yet).
Open questions for owner: see `docs/PLAN.md`.
Next: Phase 1.

## Phase 1 report - Core server, library source, first two tools (stdio)

Status: PASSED
Built: `McpServer` over stdio (`src/server.ts`, `src/transport/stdio.ts`), SQLite repository with forward-only migrations (`src/storage/`), `LibraryAdapter` and importer, 32 seed designs (`library/`), `search_inspiration`, `get_design`, ranking, cursors, image proxy.
Proof: `test/contract/read-tools.test.ts` (tool list, input validation for 10 invalid cases, output schema, credit and link on every result, determinism, pagination); `test/integration/stdio.test.ts` drives a real `node` child process over stdio; `test/unit/ranking-cursor.test.ts` (deterministic under shuffled input, boosts, penalties, dedupe). MCP Inspector CLI 2.9.0 against the built server over stdio: `tools/list` returned 12 tools, `search_inspiration` returned `library:fitness-dashboard-dark` first for "dark fitness dashboard", `get_design` returned the record with `generatedBy: owner`.
Rules check: 00-4 (credit and link), 00-7 (contract), 03 (descriptions, annotations, structuredContent, 50 KB cap).
Deviations: seed content is original generic patterns (see PLAN deviation 6).
Open questions for owner: real designs to import; image hosts.
Next: Phase 2.

## Phase 2 report - Remaining read tools

Status: PASSED
Built: `find_similar_designs`, `get_inspiration_brief`, `list_taxonomy`, `list_sources`.
Proof: `test/contract/phase2-tools.test.ts`: taxonomy contains all 24 required categories; every brief pattern cites at least two design ids, all in `based_on`, all resolvable in the database; empty and low-confidence briefs are honest; pure `buildBrief` tests; similarity is deterministic.
Rules check: 00-5 (third-party text stays in defined fields; brief labels are `key: value`), brief assembled from retrieved data only.
Deviations: embeddings not implemented (optional).
Open questions for owner: none new.
Next: Phase 3.

## Phase 3 report - Security, auth, remote transport

Status: PASSED
Built: Streamable HTTP (stateless, one server per request bound to the key's principal), API keys (hashed, scoped, `ex_` prefix), key CLI, per-key and per-source rate limits, sanitizer, SSRF guard, redaction, audit log, `/healthz`, `/readyz`, `/metrics`.
Proof: `test/security/` (158 tests): 18 injection fixtures plus benign-text false-positive checks, markup/link/zero-width stripping, huge-string caps, 15 URL rejections, 30+ private-address cases, every SSRF case in Guidelines 14 (http, localhost, 127.0.0.1, 169.254.169.254, private ranges, DNS resolving privately, redirects to private IPs), auth (missing, malformed, unknown, revoked, wrong scope), `Retry-After`, 413/400/405, Host and Origin checks, secrets never in logs or audit, hostile source content never reaching output or storage, no scraping dependency or unofficial endpoint. Mutation check: removing the sanitizer rules, the SSRF check, the scope check, the revocation check, log redaction, the collection owner check, owner-analysis protection, or the registry fail-closed check each made tests fail.
Rules check: 00-5, 00-6, 00-9; 02 (all sections).
Deviations: `/readyz` requires a key (PLAN deviation 1).
Open questions for owner: public URL and TLS termination.
Next: Phase 4.

## Phase 4 report - Pinterest adapter (official API, user OAuth)

Status: PARTIAL
Built: `src/sources/pinterest/` (client, adapter), `src/auth/oauth.ts` and `oauth-pinterest.ts` (state, token store, refresh, disconnect), routes `/connect/pinterest`, `/connect/pinterest/callback`, `DELETE /connect/pinterest`.
Proof: `test/integration/pinterest.test.ts` against a scripted Pinterest API (hand-written fixtures, `test/fixtures/pinterest/README.md`): authorize URL and scopes, Basic client auth, single-use state, replay/forged/expired/cross-source rejection, tokens encrypted at rest and bound to the starting principal, refresh before expiry, 401 then refresh then disconnect, `Retry-After` honoured (no calls during cooldown), own token bucket, "not connected" is a clean `sources_skipped` entry, disconnect deletes tokens and cached pins for that person only, one person's cached pins invisible to another, planted tokens and the client secret absent from logs, audit, errors and tool output, register narrows what Pinterest data may do.
Not done, and why: (1) the Pinterest terms and AI/ML-usage review (Pinterest's developer site was blocked from the build environment, and rules forbid relying on memory), so the register entry is `PENDING` and the registry refuses to load the source (tested against the shipped `docs/SOURCES.md`); (2) the real end-to-end run with the owner's developer app (no credentials); (3) the recorded fixtures are hand-written, not recordings.
Rules check: 00-1 (only the official API host, enforced by allowlist and a test), 00-3 (not loadable until approved), 00-6, 01 (nothing stored, hotlinked or analysed beyond the register's grant).
Deviations: search is list-and-filter over the user's own pins (PLAN deviation 3).
Open questions for owner: terms review, approval, tier, developer app (see PLAN 1).
Next: Phase 5.

## Phase 5 report - Analysis layer

Status: PASSED
Built: `src/analysis/` (schema, Claude provider using structured outputs, runner, background job), `pnpm analysis:backfill [--dry-run] [--limit N]`.
Proof: `test/unit/analysis.test.ts` (28 tests): 10 invalid-output shapes rejected and never stored, refusal/truncation discarded but charged, instruction-like output dropped and audited, owner analysis never overwritten even when it arrives mid-call, never runs for sources without `canAnalyze`, flag-gated, dry run makes no calls and writes nothing, the daily cap is never exceeded across runs, transient provider errors stop the run without marking designs failed, request shape (structured output, static system prompt, design text only as delimited data, no tools, effort only where supported). CLI dry-run and disabled-refusal in `test/integration/cli.test.ts`.
Not done: no call was made to the live Anthropic API (no key in the environment); the provider is tested against a fake client matching the SDK's `messages.parse` shape.
Rules check: 00-5 (model output sanitised), 01 (AI/ML use only where the register allows).
Deviations: PLAN deviation 11.
Open questions for owner: model, daily budget, API key.
Next: Phase 6.

## Phase 6 report - Collections and library submission

Status: PASSED
Built: `create_collection`, `add_to_collection`, `list_collections`, `get_collection`, `submit_design`, `get_connection_status` and their services.
Proof: `test/contract/phase6-tools.test.ts`: a principal can never read, list or change another's collection (and gets the same answer as for a missing id); `submit_design` rejects a missing or blank license, Pinterest hosts and origin declarations, http and private URLs, injection in title or attribution; re-submitting the same URL updates rather than duplicates; removed designs disappear from collections; scope required for each write.
Rules check: 00-4, 00-8 (no third-party images in the library), 00-12 (no tools beyond Guidelines 6).
Deviations: `origin` optional.
Open questions for owner: none new.
Next: Phase 7.

## Phase 7 report - Hardening, docs, release

Status: PARTIAL
Built: load test (`pnpm load:test`), database backup and restore (`pnpm db:backup`, `db:restore`, refuses a live database), `docs/CONNECTING.md`, `docs/RUNBOOK.md`, `README.md`, `Dockerfile` and `docker-compose.yml`, CI workflow, scripted end-to-end transcripts (`docs/e2e-transcripts.md`), `docs/CHECKLIST.md`.
Proof: load test with the real HTTP server in-process: 1 client, 1,778 requests, 0 failures, p50 4.7 ms, p95 7.5 ms; 32 concurrent clients, 2,190 requests in 10 s, 0 failures, 218 req/s, p50 138 ms (queueing on one Node thread), p95 172 ms. `pnpm audit --audit-level=high`: no known vulnerabilities. Fresh `git clone`, `pnpm install --frozen-lockfile`, `.env` from `.env.example`, `pnpm test` (all pass) and `pnpm build` took 23 s; the production layout (`pnpm prune --prod`, `node dist/index.js`) served `/healthz`, an authenticated `search_inspiration` and a 401 without a key. MCP Inspector CLI over Streamable HTTP with a Bearer key: 12 tools, search and brief calls succeeded. `test/integration/cli.test.ts` proves backup, restore, refusal on a bad file and refusal while another process holds the database.
Not done, and why: (1) the container image was not built (no Docker daemon in the build environment); the Dockerfile's steps were validated by running the same commands by hand; (2) the end-to-end run with a real agent (Claude as a custom connector) was not possible here; `docs/e2e-transcripts.md` is a scripted client; (3) Pinterest items from Phase 4.
Rules check: all of 05-definition-of-done that can be proven here; the rest is listed above.
Deviations: see `docs/PLAN.md`.
Open questions for owner: see `docs/PLAN.md`.
Next: owner review.
