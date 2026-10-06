# 02 - Security

Read before writing auth, storage, network, or logging code.

## Access
- HTTP requires a bearer key on every request. No anonymous paths except `/healthz`.
- Keys: random, 32 bytes, prefix `ex_`, shown once, stored hashed. Compare in constant time.
- Scopes are checked in the tool layer before any work. Least privilege by default: new keys get `read:search` and `read:design` only.
- Revoked keys fail on the next request.

## Secrets
- All secrets come from environment variables, validated at startup. `.env` is git-ignored; `.env.example` has no real values.
- OAuth tokens are encrypted at rest (AES-256-GCM, random 12-byte nonce per record). The encryption key never lives in the database.
- Logging redacts: `Authorization`, any field named like token, secret, password, key, cookie. A test greps log output for planted secrets.
- Error messages never include secrets, file paths, SQL, or stack traces.

## Network
- Outbound requests only to hosts declared by enabled adapters (allowlist).
- SSRF guard on every URL the server fetches: `https` only; reject credentials in URL; resolve DNS and reject private, loopback, link-local, and metadata ranges; re-check after every redirect; cap redirects at 3; cap response size and time.
- Set explicit timeouts on every outbound call.

## Input and output
- Validate every tool input with zod, including max lengths and array sizes.
- Use parameterized SQL only. Never build SQL from input.
- Sanitize every external field before storing or returning it (`Guidelines.md` section 10).
- Treat tool results as potentially read by other models: assume prompt injection is attempted.

## Dependencies
- Pin versions with a lockfile. Run `pnpm audit` in CI. No unmaintained or unofficial packages for security-sensitive work. Justify every dependency in the PR description.

## Abuse and limits
- Per-key rate limits, request size cap, tool timeout, response size cap.
- Log and count every denied request (auth, scope, rate limit).

## Data protection
- Collect the minimum: no personal data beyond what OAuth requires. Provide `disconnect` that deletes tokens and cached source data for that user.
- Back up the database; test the restore.
