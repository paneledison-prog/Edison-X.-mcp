# Edison X runbook

All commands run from the repository root (or `docker compose exec edison-x node dist/cli/<tool>.js ...` in the container). Configuration is read from the environment and `.env`.

## Start, stop, health

- Start: `pnpm build && TRANSPORT=http pnpm start` or `docker compose up -d`. Stop with SIGTERM (it closes connections, then the database).
- `GET /healthz` (anonymous): process is up. `GET /readyz` (needs any valid key): database and every loaded source reachable. `GET /metrics` (needs `admin`): Prometheus counters for tool calls, latency, source errors, rate-limit hits, cache hit rate, audit events.
- Startup log lines to read: `source refused: not loading` (with reasons), `seeded the library`, `edison-x ready on ...`.

## API keys

| Task   | Command                                                                 |
| ------ | ----------------------------------------------------------------------- |
| Issue  | `pnpm keys:create --name "<who>" --scopes search-only` (key shown once) |
| List   | `pnpm keys:list` (shows prefix, scopes, last used, never the key)       |
| Revoke | `pnpm keys:revoke <key-id>` (effective on the very next request)        |
| Rotate | issue a new key, update the agent, revoke the old one                   |

A leaked key: revoke it, then read the audit log for what the principal did (below).

## Sources and the register

`docs/SOURCES.md` decides what may load. A source needs every field filled (no `PENDING`), a terms review dated within 180 days, and an owner approval with a date.

- **Approve a source:** read its current developer terms, fill the entry (especially the AI/ML usage rule and the capability line), set `Terms reviewed on: YYYY-MM-DD   by: <name>` and the owner approval, add the id to `ENABLED_SOURCES`, restart. The log must not say `source refused`.
- **Re-review (every 180 days):** re-read the terms, update the date. The server refuses a stale entry, so put a reminder in your calendar for day 150.
- **Disable a source immediately:** remove it from `ENABLED_SOURCES` and restart (or set its register `Status: BLOCKED`). It stops being queried and its OAuth routes disappear.
- **Pinterest specifically:** the shipped entry is `PENDING`. Before approving: read Pinterest's developer terms and guidelines, record the access tier (Trial or Standard) and rate limits, quote the rule on AI/ML use of API data (if it forbids this use, leave the source disabled), set the capability line to what the terms allow, and verify the endpoint paths in `src/sources/pinterest/client.ts` against the current API docs (search is implemented as list-and-filter over the user's own pins via `GET /v5/pins`). Then create a Pinterest developer app, set `PINTEREST_CLIENT_ID`, `PINTEREST_CLIENT_SECRET`, `PINTEREST_REDIRECT_URI=<PUBLIC_BASE_URL>/connect/pinterest/callback`, and run one real connection end to end.

## Takedown: remove a design or a whole source

```bash
pnpm design:remove library:some-design        # the design, its analysis, collection entries, cached copies
pnpm source:purge pinterest                    # EVERY design, cache entry and analysis from one source
```

Both are audited (`design_removed`, `source_purged`). Removal reaches the search index, collections and the response cache. To stop a source returning, also remove it from `ENABLED_SOURCES`. A person's own Pinterest data: they call `DELETE /connect/pinterest` with their key, or run `pnpm source:purge pinterest` for everyone.

## Library content

`pnpm library:import designs.json` (same shape as `library/seed-designs.json`; every item needs a `license`; items that trip the safety filter are rejected, not stored). Agents with `write:library` can use `submit_design`. Pinterest-origin content is refused by design.

## Backups and restore

- Back up while running: `pnpm db:backup /backups/edison-$(date +%F).db` (consistent online backup). Keep `TOKEN_ENCRYPTION_KEY` safe **separately**: a backup is useless for connected accounts without it.
- Restore: stop the server, then `pnpm db:restore /backups/edison-2026-10-06.db`. It verifies the file (integrity check, expected tables) and refuses if another process still has the database open.
- Test the restore on a copy at least once per quarter.

## Migrations

Forward-only and numbered (`src/storage/migrations/`). They run at startup, each in a transaction. Never edit an applied migration; add a new one. Take a backup before upgrading.

## Secrets

- `TOKEN_ENCRYPTION_KEY` encrypts connected-account tokens and signs cursors and connect links. If it changes, stored tokens become unreadable: affected people are treated as disconnected and must reconnect. To rotate on purpose: back up, set the new key, restart, tell people to reconnect.
- Pinterest client secret: rotate in the Pinterest developer console, update the environment, restart.
- Logs never contain keys or tokens (they are redacted). If one appears anyway, treat it as leaked and rotate it.

## Analysis (optional)

Off by default. To enable: `ANALYSIS_ENABLED=true`, `ANALYSIS_DAILY_COST_CAP=<USD>`, `ANTHROPIC_API_KEY=...`, optionally `ANALYSIS_MODEL`. A background job analyses designs lacking analysis for sources whose register entry grants `canAnalyze`; it never runs inside a tool call and never spends past the daily cap (checked before every call against a worst-case cost). Preview with `pnpm analysis:backfill --dry-run`; run a batch with `pnpm analysis:backfill --limit 25`. Owner-written analysis is never overwritten. Invalid or unsafe model output is discarded and logged.

## Audit log and common queries

```bash
sqlite3 data/edison-x.db "select ts, event, principal_id, details from audit_log order by id desc limit 50"
sqlite3 data/edison-x.db "select ts, details from audit_log where event='scope_denied' order by id desc limit 20"
sqlite3 data/edison-x.db "select ts, details from audit_log where event in ('source_disabled','sanitizer_flag') order by id desc limit 20"
```

Events: `key_created`, `key_revoked`, `auth_denied`, `scope_denied`, `rate_limited`, `source_connected`, `source_disconnected`, `source_disabled`, `library_submission`, `sanitizer_flag`, `design_removed`, `source_purged`, `collection_created`. Details are redacted and never contain source text.

## Limits (defaults)

60 requests/minute and 1,000/day per key (per-key override at creation), 100 KB request body, 15 s per tool call, 5 s per source, 50 KB per response, 3 redirects on outbound fetches. Repeated failed authentication from one address is throttled.

## Incident quick reference

| Situation                             | Action                                                                                                                     |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Key leaked                            | `keys:revoke`, review `audit_log`                                                                                          |
| Hostile content got through           | `design:remove <id>`, add the phrase to the rules in `src/security/sanitize.ts` with a test, check `sanitizer_flag` events |
| Source complains or changes its terms | remove from `ENABLED_SOURCES`, `source:purge <id>`, update the register                                                    |
| Disk or DB corruption                 | stop, `db:restore` the latest backup, start                                                                                |
| Server will not start                 | read the first error: it names the missing or invalid variable, never its value                                            |
