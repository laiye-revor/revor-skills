---
name: revor-contact-search
description: Find role-focused company contacts through the Revor contacts API using a verified company domain. Use when the user asks to find employees, decision-makers, executives, procurement, supply-chain, sales, finance, or other business contacts at a company, or asks for work emails and LinkedIn profiles. Reply directly with concise contact results; do not perform outreach.
---

# Revor Contact Search

Find relevant people at one company from its official domain. This Skill searches contacts only; it does not send messages or run a full company background report.

## Choose one execution route

If `revor_find_contacts` and `revor_get_job` MCP tools are available, use them. Generate a stable `idempotency_key`, reuse it only for an exact retry, and poll the returned job to a terminal state. Skip the local configuration preflight on this route.

Otherwise resolve `scripts/revor-contacts.mjs` relative to this file. Do not recreate the API request with curl or inline code.

On the bundled-client route, run configuration preflight once:

```text
node <skill-dir>/scripts/revor-contacts.mjs config
```

Continue only when `ready` is `true`. The client shares `~/.config/RevorSkill/.env` with other Revor Skills and defaults to `https://revor.ai`.

If the key is missing or rejected:

1. Ask the user to create a key at [Revor API Keys](https://revor.ai/zh/my-api-keys).
2. Ask them to send the new key in the current private conversation. Briefly warn against sharing it in public or shared conversations.
3. Treat that reply as authorization to create the returned `config_file` and save `REVOR_API_KEY="..."`. Never repeat the key in chat or logs.
4. Rerun `config`, retry the pending search, and continue automatically. Ask the user to edit the file only if the host cannot write it.

If the user explicitly supplies `REVOR_BASE_URL`, preserve the key and update only that value. Never guess or silently switch hosts.

## Search

The API requires the company's official employee domain, not a company name, LinkedIn URL, marketplace page, or email address.

- Extract the domain from a user-supplied official website or email, removing the scheme, path, and `www.`.
- If only a company name is supplied and no reliable official domain is known, ask for the company website instead of guessing.
- Convert requested functions into a `|`-separated position list. Keep the user's terms; add close title variants only when they clearly express the same role.
- Omit `--positions` for a broad company-wide search.
- Use `--limit 20` by default; maximum 50.
- Use the user's response language for `--locale`: `zh` or `en`.

Examples:

```text
node <client> search --domain example.com --positions "CEO|Founder|Procurement|Purchasing|Supply Chain" --limit 20 --locale zh
node <client> search --domain example.com --limit 20 --locale en
```

Run one search per company. Do not submit repeated queries with minor title variations unless the user asks for a second, materially different function group.

## Handle results

- `result.status: done`: use `contacts` as the primary people list.
- `result.status: no_result`: say that no usable personal contacts were found for this domain and scope. Do not infer company size, opacity, or risk.
- Treat `nodes`, `edges`, department, and seniority as inferred organization hints, not verified reporting lines.
- Treat email `status` exactly as returned. Do not describe an email as verified unless the result does.
- Never invent names, titles, emails, LinkedIn URLs, reporting relationships, or decision authority.

For failures, follow the client's `error_kind` and `recommended_action`:

- authentication/configuration: fix the exact configuration, rerun `config`, then retry;
- permission denied: explain that the key lacks the required contact-search capability; update its permissions or use a correctly scoped key, then retry;
- membership tier insufficient: explain that the current plan does not include this capability; continue after the user upgrades;
- active-job concurrency limit: wait for the existing research task to finish, then retry the same command; do not switch keys or protocols;
- timeout, connection, rate limit, 5xx, or temporary job failure: retry the same command once, honoring `retry_after` when returned. Revor API and MCP access share account-level limits, so switching between them does not bypass a limit;
- insufficient credits: ask the user to add credits, then retry;
- invalid command/request: correct a deterministic argument error; ask only if the intended value is ambiguous;
- unknown non-retryable failure: report the exact error and ask for direction.

Do not replace a failed Revor request with unrelated contact scraping.

## Reply

Answer directly in the user's language. For multiple contacts, use:

| Name | Position | Email | Email status | LinkedIn |
| --- | --- | --- | --- | --- |

Then add no more than three short bullets:

- which contacts best match the requested function;
- important coverage limitations;
- inferred organization context only when useful and clearly labeled.

For one contact, a compact bullet is enough. Omit empty columns and do not create files, HTML, organization charts, outreach copy, or long company profiles unless the user separately requests them.
