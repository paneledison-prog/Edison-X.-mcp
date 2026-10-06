# Final completeness checklist (Guidelines section 16)

Evidence is a test file, a command, or a document. A box is checked only when the evidence proves the item as written. Unchecked boxes are real gaps and are explained.

Run to reproduce: `pnpm verify` (lint, typecheck, format check, 361 tests, build), `pnpm audit:deps`, `pnpm load:test`, `pnpm e2e:transcripts`.

## Product

- [x] All tools in section 6 exist with exact names, inputs, and outputs. `test/contract/read-tools.test.ts` ("exposes exactly the documented tools"), per-tool output-schema checks in `read-tools`, `phase2-tools`, `phase6-tools`; MCP Inspector listed all 12 (Phase 1 and 7 reports).
- [x] Every result has `sourceUrl`, `attribution`, and `attribution_notice`. `read-tools.test.ts` (search), `phase2-tools.test.ts` (similar, brief), `phase6-tools.test.ts` (collections), `pinterest.test.ts` (live-source results).
- [x] Taxonomy contains every required category. `phase2-tools.test.ts` ("list_taxonomy").
- [x] Brief tool cites only real, retrieved designs. `phase2-tools.test.ts` (every evidence id is in `based_on` and resolves in the database; empty brief is honest).

## Sources and legal

- [ ] `docs/SOURCES.md` complete, no blank fields, reviews within 180 days. **Library: yes. Pinterest: no.** Its entry is `PENDING` because the terms could not be read from the build environment and the owner has not approved it; the registry therefore refuses to load it (`test/integration/pinterest.test.ts` "registry gating", `test/unit/repo-hygiene.test.ts`). Completing it is the owner's step (`docs/RUNBOOK.md`).
- [x] Registry fails closed on a bad or missing entry (tested). `test/unit/registry.test.ts`, `test/unit/register.test.ts` (one case per required field, placeholders, stale, future-dated, no approval date).
- [x] No scraping code or dependency anywhere (tested). `test/security/secrets-and-sources.test.ts` (banned packages, import scan, unofficial endpoint scan); `pnpm audit:deps` clean.
- [ ] Pinterest adapter uses only the official API; AI/ML usage rule recorded. Official API only: yes (host allowlist `api.pinterest.com`, scanned endpoints, test asserts every call's allowlist). **AI/ML usage rule: not recorded** (`PENDING`, same reason as above). If Pinterest's rule forbids this use, the source must stay disabled.
- [x] No third-party images stored on disk or served from Edison X unless `canProxyImage` allows. `secrets-and-sources.test.ts` (no file writes in `src`), `images-and-limits.test.ts` (proxy only when granted, from allowed hosts, otherwise a note), `pinterest.test.ts` (conservative grant returns no image URLs and stores nothing).

## Security

- [x] Auth required on HTTP; keys hashed; revocation immediate. `test/security/http-auth.test.ts` (401 cases, revoked key refused on the next request, only a SHA-256 hash and an 11-character prefix stored).
- [x] Scopes enforced on every tool. `http-auth.test.ts` ("enforces a scope on every tool" iterates all 12), scope denials audited.
- [x] Tokens encrypted at rest; never logged or returned. `pinterest.test.ts` (database rows contain no plaintext token; planted tokens, secret and code absent from logs, audit, errors, tool output), `secrets-and-sources.test.ts`, `security-primitives.test.ts` (AES-256-GCM round trip, tamper detection).
- [x] Sanitizer pipeline applied to all adapter output; injection tests pass. `sanitize.test.ts`, `injection-e2e.test.ts` (search, get_design, similar, brief, stored rows, audit).
- [x] SSRF guard tested with every case listed. `ssrf.test.ts`: `http://`, `localhost`, `127.0.0.1`, `169.254.169.254`, private ranges, DNS names resolving privately, redirects to private IPs, plus IPv6, mapped addresses, redirect cap, allowlist, header stripping.
- [x] Rate limits and size/time limits enforced. `http-auth.test.ts` (per-minute and daily, `Retry-After`, 100 KB body, Host/Origin), `images-and-limits.test.ts` (15 s tool limit), `source-resilience.test.ts` (5 s per source), `ranking-cursor.test.ts` (50 KB cap, cursor expiry, token bucket), `pinterest.test.ts` (upstream 429 cooldown, own bucket).
- [x] Audit log records all listed events. Key created/revoked (`http-auth`, `cli`), source connected/disconnected (`pinterest`), library submissions (`phase6-tools`), source disabled by the registry (`registry.test.ts`), sanitizer flags (`injection-e2e`), scope denials (`http-auth`).

## Quality

- [x] Strict TypeScript, lint clean, zero `any` without a justifying comment. `pnpm lint` and `pnpm typecheck` pass; `test/unit/architecture.test.ts` rejects `any`, `@ts-ignore`, TODO/FIXME and upward imports.
- [x] All test categories present and passing. unit 104, contract 61, integration 38, security 158 (361 total, 0 failing); fixtures in `test/fixtures`.
- [x] Ranking deterministic (tested). `ranking-cursor.test.ts` (shuffled input, ties by id), `read-tools.test.ts` (fresh database gives the same order).
- [x] Config validated at startup; `.env.example` complete. `config.test.ts`; `repo-hygiene.test.ts` (example lists exactly the variables the server reads, secrets blank).
- [x] Health and readiness endpoints work. `http-auth.test.ts` ("operational endpoints"); docker `HEALTHCHECK` uses `/healthz`.

## Operations and handoff

- [x] `docs/CONNECTING.md`, `docs/RUNBOOK.md`, `docs/SOURCES.md`, `docs/PLAN.md` complete. (SOURCES.md contains the honest Pinterest `PENDING` entry above.)
- [x] A second agent connected with its own key and no code changes (recorded). `docs/e2e-transcripts.md` (agent A and agent B, separate keys, different scopes) and `http-auth.test.ts`. Note: both are scripted MCP clients, not language models.
- [x] Database backup and restore tested. `test/integration/cli.test.ts` (backup, destroy, restore, bad file refused, live database refused), `test/unit/storage.test.ts` (backup opens and searches).
- [x] A fresh clone reaches a working server by following the README. Fresh `git clone`, `pnpm install --frozen-lockfile`, `.env`, `pnpm test`, `pnpm build` in 23 s; pruned production layout served `/healthz`, an authenticated search and a 401 without a key (Phase 7 report).
- [x] Final report lists every deviation and every open question honestly. `docs/PLAN.md` (12 deviations, 9 questions), `docs/PHASE-REPORTS.md`.

## Not provable in the build environment (do these before relying on it)

1. **Pinterest.** Read the current terms and AI/ML rule, fill the register, get approval, create a developer app, run one real connection. Replace the hand-written fixtures with recorded responses. (`docs/RUNBOOK.md`)
2. **A real agent.** Add the server as a Claude custom connector and run search, get_design and brief for three goals (`docs/CONNECTING.md`).
3. **The container image.** `docker build .` and `docker compose up` (no Docker daemon was available; the same steps were run by hand).
4. **Analysis against the live API.** Set the key and a small cap, run `pnpm analysis:backfill --limit 3` and inspect the results.
5. **Real library content.** Replace or extend the 32 starter patterns with real, credited, licensed designs.
6. **Library approval and license.** Confirm the library approval line and choose a repository license.
