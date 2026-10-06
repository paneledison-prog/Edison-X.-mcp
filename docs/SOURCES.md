# Source register

Every source Edison X may read from has one entry here. The server refuses to load a source whose
entry is missing, has any blank or `PENDING` field, has a terms review older than 180 days, or lacks
a dated owner approval (`Guidelines.md` section 4.1, `Rules/01-sources-and-legal.md`). The server
also narrows each adapter's capabilities to what its entry grants.

To approve a source: read its current developer terms, fill every field below, set
`Terms reviewed on` to today's date and your name, record the owner approval with a date, then
restart the server. Re-review every 180 days.

Template (the parser ignores fenced blocks):

```
## <source id>
- Status: APPROVED | USER_OAUTH | OWN_LIBRARY | BLOCKED
- Access method: <official API name + version, or "owned data">
- Terms URL: <link>
- Terms reviewed on: <YYYY-MM-DD>   by: <name>
- Terms summary: <3-6 lines: what is allowed and forbidden>
- AI/ML usage rule: <quote the rule briefly or say "none found">
- Capabilities: canSearch=<bool>, canGetById=<bool>, canStoreMetadata=<bool>, canAnalyze=<bool>, canHotlink=<bool>, canProxyImage=<bool>, cacheTtlSeconds=<int>
- Attribution requirement: <exact wording required>
- Rate limits: <numbers>
- Owner approval: <name, date>
- Notes / risks: <anything else>
```

## library

- Status: OWN_LIBRARY
- Access method: Owned data. Designs live in Edison X's own database. The starter set is `library/seed-designs.json` in this repository (original structural descriptions written for this project, with no third-party images, copy or branding). More designs are added through the `submit_design` tool or `pnpm library:import`.
- Terms URL: https://github.com/paneledison-prog/Edison-X.-mcp
- Terms reviewed on: 2026-10-06 by: Claude (builder), Edison X build session
- Terms summary: No third-party terms apply to owned data. Every library item carries its own `license` and `attribution`. `submit_design` rejects items with no license or an origin on the blocked list. The owner may remove any item at any time (`pnpm design:remove`, see docs/RUNBOOK.md). Third-party images are never copied into the library; only the owner's own image URLs on hosts listed in `LIBRARY_IMAGE_HOSTS` may be returned or proxied.
- AI/ML usage rule: none found (owned data; no third-party rule applies). Analysis may run on library items.
- Capabilities: canSearch=true, canGetById=true, canStoreMetadata=true, canAnalyze=true, canHotlink=true, canProxyImage=true, cacheTtlSeconds=0
- Attribution requirement: "Via Edison X library - {creator}". Items that carry a different credit or license keep it in their own `attribution` and `license` fields.
- Rate limits: none (local database).
- Owner approval: paneledison-prog (repository owner), 2026-10-06. Granted by the owner's instruction in the build session to implement the Library source as specified in Guidelines.md section 4.2. The owner should re-confirm this line at review.
- Notes / risks: The 32 starter items are generic UI patterns, not copies of any real product. Replace or extend them with real, credited designs the owner has the right to include.

## pinterest

- Status: USER_OAUTH
- Access method: Pinterest REST API v5 (https://api.pinterest.com/v5) with OAuth 2.0 authorization-code flow, scopes `boards:read` and `pins:read`. Reads only the connecting user's own boards and pins. No scraping and no internal endpoints.
- Terms URL: https://developers.pinterest.com/terms/
- Terms reviewed on: PENDING - the review was not performed. The build environment's network blocked developers.pinterest.com and policy.pinterest.com on 2026-10-06, and the rules forbid relying on memory. Replace this line with `YYYY-MM-DD   by: <name>` after reading the current terms.
- Terms summary: PENDING - read Pinterest's current developer terms and guidelines and summarise what is allowed (display, caching, storage, attribution) and what is forbidden.
- AI/ML usage rule: PENDING - find and quote Pinterest's rule on using API data with AI or machine-learning systems. If it forbids the intended use, leave this source disabled and tell the owner.
- Capabilities: canSearch=true, canGetById=true, canStoreMetadata=false, canAnalyze=false, canHotlink=false, canProxyImage=false, cacheTtlSeconds=0
- Attribution requirement: PENDING - confirm the exact wording. Draft: "Via Pinterest - {creator}" plus a link back to the pin.
- Rate limits: PENDING - record the numbers for the access tier the owner's developer app is on (Trial or Standard).
- Owner approval: PENDING
- Notes / risks: The capability line above is deliberately the most conservative set (nothing stored, nothing hotlinked, nothing analysed). Widen it only after the terms review shows it is allowed. Until every PENDING value is replaced the registry refuses to load this source, so it cannot run by accident. API access tiers may limit what search returns; the adapter returns fewer results rather than ever scraping.
