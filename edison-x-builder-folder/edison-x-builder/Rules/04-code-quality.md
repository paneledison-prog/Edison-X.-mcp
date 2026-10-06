# 04 - Code Quality

- TypeScript `strict: true`. No `any` without a comment explaining why. No `@ts-ignore` without an issue reference.
- zod schemas are the source of truth; infer types from them. Validate all external data (tool inputs, upstream API responses, env, database rows from migrations you did not write).
- Small modules, one responsibility each. Follow the layout in `Guidelines.md` section 3. Dependencies point inward: tools -> services -> sources/storage. Never the reverse.
- No global mutable state except explicit, documented caches and rate-limit state behind interfaces.
- Handle every promise. No floating promises. Use timeouts and abort signals on outbound calls.
- Errors: typed error classes (`AuthError`, `ScopeError`, `RateLimitError`, `SourceError`, `ValidationError`). Map each to a safe client message in one place.
- Migrations: forward-only, numbered, tested on an empty database and on a populated one.
- Comments explain why, not what. Public functions have a one-line doc comment.
- Formatting and lint run in CI; a failing lint blocks the phase.
- Commits are small and named for what they change. Never commit secrets, `.env`, database files, or downloaded third-party images.
- README must let a stranger install, configure, run, and test the server in under 15 minutes.
