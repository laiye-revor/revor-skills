---
name: revor-company-research
description: API-backed company research through Revor using public-web search, company contact discovery, and customs trade data. Use this skill when a user asks to research, investigate, profile, verify, or find contacts, suppliers, customers, product categories, trade trends, or source countries for a company. Return text or Markdown; do not depend on Revor's HTML dashboards or artifacts.
metadata:
  openclaw:
    requires:
      env:
        - REVOR_API_KEY
    primaryEnv: REVOR_API_KEY
    envVars:
      - name: REVOR_API_KEY
        required: true
        description: Revor API key used to run company research and read its jobs.
      - name: REVOR_BASE_URL
        required: false
        description: Optional Revor API base URL. Defaults to https://revor.ai.
    homepage: https://revor.ai
---

# Revor Company Research

## Goal

Research a company with Revor's data APIs and synthesize the returned JSON into a concise, sourced Markdown report. Use only the capabilities needed for the request:

- public company and web evidence through public-web research,
- people and contact discovery through domain-based contact research,
- customs counterparties, categories, trends, and countries through Revor Customs API.

Do not reproduce Revor's HTML dashboard, contact tree, or artifact UI. Present useful fields directly as prose and Markdown tables.

## Configuration

Resolve configuration in this order:

1. `~/.config/RevorSkill/.env`
2. platform-persistent environment configuration
3. current process environment
4. `<current-skill-dir>/.env`

OpenClaw does not automatically inject a dotenv file into every `exec` call. Before the first API request, load the selected dotenv file into the same shell process that invokes the HTTP client, or use values already present in the process environment. Never print the loaded values.

Use:

```bash
REVOR_BASE_URL="https://revor.ai"
REVOR_API_KEY=""
```

If `REVOR_API_KEY` is missing, direct the user to `https://revor.ai/my-api-keys`. When asked to configure a supplied key, store it in `~/.config/RevorSkill/.env` without printing it. Never put a real key in this skill, prompts, memory, logs, reports, or committed files. Mask keys in all output.

Normalize `REVOR_BASE_URL` by removing a trailing slash. Send the key as:

```http
Authorization: Bearer <REVOR_API_KEY>
```

Use exactly the configured `REVOR_BASE_URL`. Never guess, probe, or substitute another hostname such as `api.revor.ai`. If the configured base URL returns `404`, report that deployment mismatch instead of changing hosts.

## Choose the Smallest Useful Workflow

### General or comprehensive company research

1. Search the public web to establish the official site, domain, legal or trading names, location, products, and recent evidence.
2. Query contacts only after resolving a credible company domain.
3. Query the full customs report only when the user requests trade intelligence or a comprehensive background report and a customs-compatible company name is available.
4. Synthesize the evidence; distinguish sourced facts, API data, and inference.

### Public information only

Call only `POST /api/v2/research/public-web`.

### Contacts or organization only

Resolve the official domain if necessary, then call only `POST /api/v2/research/contacts`. Never pass a company name where a domain is required.

### Focused customs question

Use one focused endpoint instead of the full report:

| User intent | Endpoint |
| --- | --- |
| suppliers, customers, counterparties | `/api/v2/customs/counterparties` |
| products, HS codes, trade categories | `/api/v2/customs/categories` |
| volume, value, or activity over time | `/api/v2/customs/trends` |
| origin or destination countries | `/api/v2/customs/countries` |
| all four customs sections | `/api/v2/customs/trade-reports` |

Do not call the full report and its four component endpoints for the same request. That duplicates provider work and billing.

## Common Request and Job Protocol

All research and customs POST endpoints use the same job protocol. Include:

```http
Content-Type: application/json
Accept: application/json
Authorization: Bearer <REVOR_API_KEY>
Idempotency-Key: <stable-unique-key-for-this-logical-request>
Prefer: wait=20
```

Generate a unique idempotency key for a new logical request. Reuse the same key when retrying the exact same request after a network failure. Use a new key when any input changes.

Handle responses as follows:

1. On HTTP `200`, inspect `item.status`; do not assume success from HTTP alone.
2. On HTTP `202`, or whenever `item.status` is non-terminal, read `item.id`, then poll `GET /api/v2/jobs/{id}` with the same Bearer key every 2 seconds until terminal. Polling is mandatory; never present `scheduled` or `running` as the completed research result.
3. Treat `succeeded`, `failed`, and `cancelled` as terminal states.
4. Stop polling after 180 seconds and return the job ID so the user can resume later.
5. On `succeeded`, read data from `item.result` and billing from `item.billing`.
6. On `failed`, report `item.error` without fabricating a result.

The server supports short synchronous waiting, not separate `/sync` routes. A request may still return `202` after `Prefer: wait=20`.
An idempotent replay can return an older `scheduled` POST snapshot even when the job has since reached a terminal state. Treat the latest GET job response as authoritative.

## Public-Web Research

Call `POST /api/v2/research/public-web` with:

```json
{
  "queries": [
    "Acme Inc official company profile products",
    "Acme Inc recent news partnerships"
  ],
  "search_limit": 5,
  "category": "company",
  "include_domains": [],
  "user_location": "US"
}
```

Rules:

- Supply one or two distinct queries; never more than two.
- Keep `search_limit` between 1 and 10 per query. Default to 5 unless broader evidence is necessary.
- Allowed `category` values are `company`, `news`, `financial report`, `people`, and `personal site`. Omit it for mixed research.
- Supply no more than five `include_domains`.
- Use an ISO 3166-1 alpha-2 `user_location` such as `US` or `GB`; omit it when unknown.
- Cite the returned source URLs near the claims they support.
- Treat search snippets as evidence leads, not authoritative legal identity by themselves.

Expected result shape:

```text
item.result.status
item.result.queries
item.result.searched_queries
item.result.results[].query
item.result.results[].sources[].{url,title,published_date,author,highlights,text}
item.result.errors[]
```

If the status is `partial`, use successful query groups and disclose which queries failed.

## Contact Research

Call `POST /api/v2/research/contacts` with:

```json
{
  "domain": "example.com",
  "positions": ["CEO", "Procurement", "Supply Chain"],
  "limit": 20,
  "locale": "en"
}
```

Rules:

- Require a credible company or employee domain, not a company name or search-result URL.
- Normalize away scheme, path, and leading `www.` before calling.
- Supply at most 30 position filters. Omit `positions` to use the service defaults.
- Keep `limit` between 1 and 50. Default to 20.
- Use `locale: "en"` or `locale: "zh"` according to the user's language.
- Treat the returned hierarchy as inferred from titles, not a verified reporting structure.
- Never fabricate missing emails, LinkedIn URLs, titles, departments, or reporting lines.
- Do not persist or expose more personal contact data than the user needs.

Expected result shape:

```text
item.result.status
item.result.domain
item.result.company_name
item.result.contacts[].{email,status,position,first_name,last_name,full_name,linkedin_url}
item.result.nodes[].{id,kind,title,name,email,status,linkedin_url,department,seniority,sort_order}
item.result.edges[].{from,to,relation,confidence,sort_order}
item.result.note
```

`status: "no_result"` is a valid empty result, not a provider failure.

## Customs Research

All customs endpoints accept the same base payload:

```json
{
  "company_name": "ACME INC.",
  "company_role": "importer",
  "start_date": "2025-08-01",
  "end_date": "2026-07-31",
  "page": 1,
  "page_size": 5,
  "period_unit": "months",
  "filters": {}
}
```

Rules:

- Use the best-supported legal or customs trading name. Preserve punctuation when supported by evidence.
- Use `importer` for procurement, suppliers, and inbound trade. Use `exporter` for sales, customers, and outbound trade.
- If dates are unspecified, use the most recent 12 complete calendar months: start on the first day 11 months before the last completed month and end on the last day of the last completed month.
- Never request a range longer than one year.
- Keep `page_size` between 1 and 20. Use 5 for concise research and 20 only when the user requests detail.
- Use `months`, `quarters`, or `years` for `period_unit`.
- Optional filters are `hs_code`, `product_description`, `origin_country_code`, and `destination_country_code`.
- A successful empty result means no matching data for that exact name, role, date range, and filters. It does not prove that the company has no trade activity.
- If appropriate, retry once with a better-supported legal-name variant or the opposite role, but explain the changed scope. Do not silently fan out many paid queries.

Focused endpoints return:

```text
item.result.company_name
item.result.company_role
item.result.catalog
item.result.date_range
item.result.section
item.result.data.{page,items,total,page_size,returned_rows}
```

The full report returns the same company context plus:

```text
item.result.status
item.result.sections.{counterparties,categories,trend,countries}
```

## Reporting

Match the user's language. For a comprehensive report, prefer this order:

1. executive summary and confidence limits,
2. company identity and public-web evidence,
3. products, positioning, and recent developments,
4. contacts relevant to the user's goal,
5. customs counterparties, categories, trends, and countries when requested,
6. gaps, caveats, and suggested next checks,
7. API usage and charged credits when available.

Use Markdown tables for compact comparisons. Include source links from public-web results. Label contact hierarchy as inferred. Label customs values with their exact date range and importer/exporter perspective. Never claim that an empty customs result disproves company existence or operations.

## Error and Safety Rules

- `401` or `403`: stop and ask the user to verify the API key and required permissions.
- `411` or an insufficient-credit error: stop and explain that usable Revor credits are required.
- `external_api_billing_retryable`: report that Revor could not complete billing preparation or settlement, include the job ID, and state the returned billing status and charged credits. Do not describe this as an empty provider result. Retry only if the user asks or the service later becomes healthy, reusing the same idempotency key for the exact request.
- `429`: respect rate limits; retry only after the indicated delay.
- `5xx`, timeout, or network failure: retry the same logical request with the same idempotency key, then fall back to job lookup if a job ID was received.
- Never expose provider credentials, Revor keys, raw internal errors, or hidden configuration.
- Do not use contacts for harassment, phishing, impersonation, fraud, or unreviewed mass outreach.
- Do not turn research intent into permission to send messages. Use a separate outreach skill for any dispatch action.
