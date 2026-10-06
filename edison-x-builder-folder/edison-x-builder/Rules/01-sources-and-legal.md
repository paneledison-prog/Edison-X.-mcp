# 01 - Sources and Legal

Read before writing or changing any source adapter.

## Allowed source types

- **OWN_LIBRARY:** content the owner created, commissioned, or has a license to use, plus open-licensed content with the license recorded per item.
- **USER_OAUTH:** a user's own data fetched through an official API using that user's authorization (for example, their own Pinterest boards).
- **APPROVED:** a third-party source with an official API or a written agreement, reviewed and approved by the owner.

## Forbidden

- Scraping, crawling, or automated extraction of pages, search results, or feeds that the source has not expressly permitted.
- Unofficial APIs and "no API key needed" scraper tools or actors.
- Using login cookies or sessions that belong to a person to read content on their behalf outside the official API.
- Bypassing rate limits, captchas, paywalls, or login walls.
- Redistributing or hosting copies of third-party images beyond what the source's terms allow.
- Training, fine-tuning, or building embeddings datasets from a source unless its terms explicitly allow it (record the clause in the register).

## Before adding any source (checklist)

1. Find the source's current developer terms and API guidelines. Do not rely on memory or on blog posts.
2. Answer in `docs/SOURCES.md`: what is allowed, what is forbidden, caching limits, attribution wording, rate limits, and any rule about AI or machine-learning use of the data.
3. Decide each capability flag from the terms, not from convenience. When unsure, set it to `false`.
4. Get owner approval, recorded with a date.
5. Re-review every 180 days. The registry refuses to load a source whose review is older.

## Copyright and credit

- Designs belong to their creators. Edison X shows references and links to originals; it does not claim them.
- Show creator name and a link wherever the source provides them.
- Analysis text describes structure and patterns. It must not reproduce a design's copy, logos, or distinctive branding wholesale.
- The `attribution_notice` reminds agents that references are for inspiration and that they should not copy a design pixel for pixel.

## Takedown

Provide a documented way for the owner to remove any design or disable any source immediately (`docs/RUNBOOK.md`), and make removal also purge cached copies and analysis.
