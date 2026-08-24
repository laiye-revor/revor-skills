---
name: revor-company-discovery
description: Discover and rank a list of companies matching a natural-language ideal customer profile through Revor Websets. Use when the user asks to find target companies, prospects, leads, suppliers, buyers, manufacturers, distributors, or other company lists by geography, industry, product, business model, or qualification criteria. Return the company list directly with evidence-based fit explanations; do not perform contact lookup or outreach.
---

# Revor Company Discovery

Turn a natural-language target profile into one Revor Webset and return its qualified companies. The current public workflow finds 25 companies per search.

## Use the bundled client

Resolve `scripts/revor-websets.mjs` relative to this file. Do not recreate the API requests with curl or inline code.

Run configuration preflight once before creating a Webset:

```text
node <skill-dir>/scripts/revor-websets.mjs config
```

The preflight verifies the API key against Revor and returns the available credits. Continue only when `ready` is `true`. The client shares `~/.config/RevorSkill/.env` with other Revor Skills and defaults to `https://revor.ai`.

If the key is missing or rejected:

1. Ask the user to create a key at [Revor API Keys](https://revor.ai/zh/my-api-keys).
2. Ask them to send the new key in the current private conversation, with a brief warning not to post it publicly.
3. Treat that reply as authorization to create the returned `config_file` and save `REVOR_API_KEY="..."`. Never repeat the key in chat or logs.
4. Rerun `config`, retry the pending search, and continue automatically. Ask the user to edit the file only if the host cannot write it.

If the user explicitly supplies `REVOR_BASE_URL`, preserve the key and update only that value. Never guess or silently switch hosts.

## Build one search

Write one compact query that preserves the user's intent. Include only supported or user-supplied constraints:

- target company type or commercial role;
- product, service, industry, or use case;
- geography;
- material size, technology, channel, or exclusion constraints.

Do not invent missing constraints or turn the request into an over-specified checklist. Revor automatically generates weighted qualification criteria from this query.

Run one search for the request:

```text
node <client> search --query "Industrial automation equipment distributors in Southeast Asia" --title "Southeast Asia automation distributors" --locale en --detail standard --page-size 10
```

Use `zh` or `en` according to the user's language. `--title` is optional. The current API fixes `count=25`, `target_kind=company`, and the Open Web source; do not promise another count or a person search. A direct request to find companies authorizes one search. Do not create multiple billable Websets for small query variations unless the user asks.

If execution is interrupted after a `webset_id` is returned, resume the existing Webset instead of creating another:

```text
node <client> resume --webset-id "uuid"
```

The client follows the Webset resource through `generating_criteria`, `searching`, and `verifying`; it does not mistake a completed preparation job for completed discovery. It also reads every qualified result page and rejects duplicate, provisional, or invalid completed results.

## Control result size

Use `--detail standard --page-size 10` for the normal Agent workflow. The client follows every cursor page, but each API response stays bounded and omits long per-criterion reasoning and reference URLs.

Choose another mode only when the task requires it:

- `compact`: core company fields plus match status/score; maximum page size 50. Use for broad lists or tight tool-output limits.
- `standard`: full public company fields, checks, and criterion status/score/weight/reference count; maximum page size 25. This is the client default.
- `full`: full criterion reasoning and reference URLs; maximum page size 10. Use sparingly because aggregating all 25 detailed results can exceed an Agent platform's tool-output window.

Do not request a page size above the mode limit. The client rejects invalid combinations instead of silently clamping them. Continue pagination until `has_more=false`; never treat one page as the complete Webset.

## Handle failures

Follow the client's `error_kind` and `recommended_action`. Preserve the `webset_id` and completed work.

- `missing_api_key`, `authentication_failed`: obtain and configure a replacement key, rerun `config`, then retry.
- `invalid_configuration`, `endpoint_not_found`: show the exact base URL and path; ask the user to correct `REVOR_BASE_URL` rather than guessing another host.
- `invalid_command`, `invalid_request`: correct a deterministic argument error; ask only when the intended value is ambiguous.
- `request_timeout`, `connection_failed`, `rate_limited`, `service_unavailable`, `temporary_webset_failure`: retry once, honoring `retry_after` when returned.
- `webset_timeout`: run `resume` with the returned `webset_id`; do not create a replacement.
- `insufficient_credits`: ask the user to add credits, then retry.
- `webset_cancelled`, `webset_not_found`, non-retryable `webset_failed`, or unknown errors: report the exact error and ask for direction.

Do not replace a failed Revor search with unrelated web scraping, and do not describe an API failure as an empty company list.

## Reply

Reply directly in the user's language. Start with one sentence describing the executed scope and the number of qualified companies. Then present the returned companies in a readable table:

| Company | Website | Industry | Match | Why it fits |
| --- | --- | --- | --- | --- |

Use the returned company fields, match status, score, and criterion results. In `standard` mode, derive a concise `Why it fits` from the Webset criterion descriptions and each item's status/score/weight; do not claim source-level evidence that was not returned. Include criterion reasoning and reference URLs only when the command used `--detail full`. Distinguish partial matches. Never invent locations, industries, emails, revenue, employee counts, or qualification evidence.

After the table, add only useful synthesis:

- two or three patterns across the list;
- material qualification or coverage limitations;
- a short suggested next step when relevant, such as researching selected companies or finding contacts with a separate Skill.

Do not create HTML, a Markdown file, outreach copy, or a full background report unless the user separately requests it. The current Skill does not support Find More, editing criteria, cancellation, deletion, export, contact search, or outreach.
