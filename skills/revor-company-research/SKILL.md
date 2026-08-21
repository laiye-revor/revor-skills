---
name: revor-company-research
metadata:
  openclaw:
    requires:
      env:
        - REVOR_API_KEY
      config:
        - ~/.config/RevorSkill/.env
    primaryEnv: REVOR_API_KEY
    envVars:
      - name: REVOR_API_KEY
        required: true
        description: Revor API key.
      - name: REVOR_BASE_URL
        required: false
        description: Revor API base URL. Defaults to https://revor.ai.
    homepage: https://revor.ai
description: Research a company with Revor public-web evidence, customs entity resolution and trade data, and role-focused contacts. Use for company background checks, supplier or buyer due diligence, customer research, trade intelligence, commercial assessment, risk review, meeting preparation, or finding relevant company contacts. Reply directly with a sourced, decision-oriented answer.
---

# Revor Company Research

Produce a practical company background report. Anchor it in the company's official public identity, then add customs and contact evidence when they can be matched reliably.

Keep research narration out of the final answer. Reply directly in chat with the findings; do not create a report file or artifact.

## Use the bundled client

Run the sibling script `scripts/revor-api.mjs` for every Revor data call. Resolve its path relative to this `SKILL.md`; do not rewrite its HTTP logic with inline JavaScript or curl.

## Mandatory configuration preflight

Run the following command exactly once at the start of every research task, before `public-web` or any other data command:

```text
node <skill-dir>/scripts/revor-api.mjs config
```

Do not inspect environment variables manually, search for other `.env` files, test guessed URLs with curl, or begin research before reading this JSON result.

- Continue only when `ready` is `true`.
- Use the returned `base_url` unchanged for the entire task.
- `config_file_exists: false` is not an error when `ready: true`; the key may be supplied by the host process. Use `api_key_source` and `base_url_source` to understand the effective configuration.
- When `ready` is `false`, do not make a data request yet. Tell the user that the key is missing, direct them to create one, and ask them to send the new key back in the current private conversation so you can configure it. After receiving it, write it to the exact returned `config_file`, rerun `config`, and continue the same research task from the first pending command; do not make them edit files, repeat the company, or restart the conversation.
- Never print, echo, or expose the API key.

If the user has no valid key, direct them to [Revor API Keys](https://revor.ai/zh/my-api-keys) to create one, then ask them to send the new key to you in the current private conversation. Treat sending the key with a request to continue as authorization to create the parent directory when needed and save it in the exact returned `config_file` as:

```text
REVOR_API_KEY="..."
# REVOR_BASE_URL is optional; the default is https://revor.ai
```

Configuration precedence is the persistent file, then the process environment, then a `.env` beside this Skill. `REVOR_BASE_URL` defaults to `https://revor.ai`. Test or staging hosts must be supplied explicitly by the user or their environment; never infer or guess one.

If the user explicitly supplies a key or base URL and asks you to configure/use it, that authorizes updating only `REVOR_API_KEY` and/or `REVOR_BASE_URL` in the returned persistent `config_file`. Preserve every unspecified setting, never echo the key in chat or logs, rerun `config`, retry the pending command, and continue the original task. Do not ask the user to edit the file manually unless the host cannot write that path.

## Error recovery

The client prints `error_kind`, `retryable`, and `recommended_action` for failures. Preserve the failed command and completed research state, perform the matching recovery below, then retry that command and continue with the next investigation step. Never restart the whole task or make the user repeat the company.

| Error | Required action |
| --- | --- |
| `missing_api_key`, `authentication_failed` | Direct the user to [Revor API Keys](https://revor.ai/zh/my-api-keys) and ask them to send the created/replacement key in the current private conversation. After receiving it, save it to the returned `config_file`, rerun `config`, retry the failed command, and continue. Do not guess why the key was rejected or ask the user to edit the file unless writing fails. |
| `invalid_configuration`, `endpoint_not_found` | Show the exact `base_url` and `path`. Ask the user to confirm/correct `REVOR_BASE_URL`; never guess or silently switch hosts. Then rerun `config`, retry the failed command, and continue. |
| `invalid_request`, `invalid_command` | Read the returned validation message. Correct a deterministic argument mistake and retry once. Ask the user only when their intended value is genuinely ambiguous. |
| `request_timeout`, `connection_failed`, `rate_limited`, `service_unavailable`, `temporary_job_failure` | Retry the exact same command at most once; for rate limits, honor `retry_after` when present. If the second attempt fails, report the exact error and leave the task ready to resume from that command. |
| `insufficient_credits` | Tell the user credits are insufficient. After they add credits, retry the failed command and continue. |
| `job_cancelled` | Report that the job was cancelled. Retry only if the user asks. |
| `job_failed`, `http_error`, `invalid_response`, or unknown non-retryable errors | Report the exact returned error and ask for direction. Do not reinterpret it as empty data. |

A successful command with an empty result is not an error. Continue the investigation flow, use its explicitly allowed alternate company-name lookup when applicable, and describe the data coverage limit without treating it as company risk.

Do not substitute OpenClaw `web_search`, `web_fetch`, Google, Bing, DuckDuckGo, or arbitrary scraping after a Revor failure. An API error authorizes only its recovery branch above. Never fabricate or finish a fallback report from unrelated search results.

For a missing or rejected key, keep the user response short and actionable. Include only:

1. Open `https://revor.ai/zh/my-api-keys` and create an API key.
2. Send the new key back in this private conversation and say that you will configure it for them. Briefly advise against sending it in a public or shared conversation.
3. After receiving it, save it as `REVOR_API_KEY="..."` in the exact `config_file`, rerun `config`, and continue the original research task automatically.

Do not add speculative causes, environment theories, unrelated troubleshooting, or an offer to research without Revor while the user configures the key.

## Investigation flow

### 1. Establish the official baseline

Start with `public-web` and no more than two focused queries. The first batch must contain the exact company name supplied by the user as one bare-name query. Use the second query for a supplied domain, country/native name, or official profile page when useful.

```text
node <client> public-web --query "Exact Company Name" --query "Focused identity query" --search-limit 5
```

Identify:

- official and trading names,
- official domain and best official About, Company, Profile, or History page,
- headquarters and operating markets,
- founding/start date when explicitly stated,
- business model, products, services, represented brands, and channels,
- named leadership when supported.

Prefer official pages, then government/institutional records, credible media, reputable databases, and finally social/directory sources. Reject same-name entities whose country, domain, or business does not match. Do not turn identity resolution into unnecessary legal forensics; distinguish brand, operator, parent, or predecessor only when it prevents a wrong match or changes the conclusion.

### 2. Resolve the customs-data company name

Use an explicit date range of at most one year. Unless the user specifies otherwise, use the latest rolling 12 months ending on the current date. Keep exactly the same dates throughout candidate lookup and trade analysis.

After public identity research, query the free company-candidate endpoint with the best-supported official/global name:

```text
node <client> company-candidates --company-name "Supported Company Name" --start-date YYYY-MM-DD --end-date YYYY-MM-DD --page-size 20
```

Do not pass a domain as `company-name`. Omit `--country-codes` unless the user explicitly supplied a country or region.

The result checks both the original query and provider candidates as:

- importer in import records,
- exporter in export records.

A positive count proves only that the exact returned name is queryable for that direction and period. It does not prove legal identity. Select a candidate only when public identity, country, business context, and the intended-direction count jointly support it.

If the first lookup gives no reliable match, make one more lookup using a materially different name supported by the public research or candidate results. Do not invent suffixes, punctuation, translations, abbreviations, or legal forms. If no reliable match remains, end the customs branch and state only that no reliable customs-data match was found for the tested names and scope.

### 3. Choose the trade perspective

- General background, procurement, supplier due diligence, or unspecified intent: use `company-role=importer`.
- Sales, buyer discovery, or customer due diligence: use `company-role=exporter`.

Only run a trade report when the chosen exact candidate has a positive count in that role. Copy the candidate name exactly. Run at most one full trade report for one company background check:

```text
node <client> trade-report --company-name "Exact verified candidate" --company-role importer --start-date YYYY-MM-DD --end-date YYYY-MM-DD --page-size 10
```

Do not also call counterparties, categories, trends, and countries for the same scope after a successful full report. Use those focused commands only for a narrow follow-up question.

Interpret trade data rather than listing it:

- rank counterparties by trade count, then weight, then quantity;
- translate HS/category rows into understandable product groups;
- sort periods before describing direction, volatility, peaks, or seasonality;
- explain geographic and counterparty concentration only when returned totals support it;
- treat zero/missing values and `N/A` labels as data limitations, not company risk.

In importer mode, counterparties are upstream suppliers/exporters. In exporter mode, they are downstream buyers/importers.

### 4. Research contacts once

Contact research is independent of customs matching. Use the reliable employee/contact domain established during identity research, not a company name or an assumed storefront domain.

```text
node <client> contacts --domain "example.com" --positions "CEO|Procurement|Supply Chain" --limit 20 --locale en
```

Call it once in a normal background check:

- after the trade report when a customs candidate was selected, or
- directly when customs identity remains unresolved but the official domain is reliable.

Choose positions relevant to the user's decision. Present at most five representative named contacts with title, function/seniority, and why the role matters. Treat inferred hierarchy as inferred. Empty or failed contact data is not evidence about company size, quality, or transparency.

### 5. Fill material public-information gaps

Use one further `public-web` batch of at most two separated queries for decision-relevant gaps such as:

- scale, headcount, ownership, listing status, facilities, or major corporate development;
- material news, partnerships, leadership changes, litigation, or regulatory signals from the last 24 months;
- named products, customers, channels, and market position.

Add another focused batch only when a material question remains unresolved. Do not combine unrelated goals into one bloated query. Do not claim public-web facts from an unread title or snippet when returned page text does not support them.

## Evidence rules

For every important claim, retain the source URL, date when relevant, and scope. Separate direct facts from reasonable inference and unknowns. When sources conflict, prefer the more direct, recent, and authoritative source; mention the discrepancy only when it changes interpretation.

Never:

- combine facts from similarly named companies;
- invent products, customers, exclusive rights, contacts, trade relationships, financial trends, or risks;
- infer inactivity, opacity, scale, or risk from an empty/failed customs or contact query;
- treat `external_api_billing_retryable` as an empty provider result;
- expose unnecessary personal data or turn research into unapproved outreach.

## Compose the direct response

Write in the language of the user's latest message and answer directly in chat using Markdown. Do not create `.md`, HTML, artifact, or `outputs/` files. Lead with decision-relevant findings and omit research narration.

### Presentation rules

- Prefer scan-friendly structure, but do not optimize for the number of tables. Choose one primary presentation form for each section: a table for comparison, bullets for prioritized findings, or short prose for interpretation.
- Use a Markdown table when the reader benefits from comparing several records across the same fields, such as company attributes, brands, events, contacts, counterparties, product categories, countries, or periods. Do not create a table for a few standalone metrics, a single record, or conclusions that need explanation.
- Keep interpretation outside tables concise. Tables should hold facts and comparable fields; commercial meaning, uncertainty, and overall judgment should usually be written as short prose or 3–5 prioritized bullets.
- Avoid nested bullets and long uninterrupted paragraphs.
- Put source links in the relevant table cell or immediately beside the supported claim. Do not make the reader match an unannotated source dump back to claims.
- Distinguish verified facts, evidence-based interpretations, conflicts, and unknowns. Use confidence labels only where uncertainty changes the decision; do not decorate every row.
- Omit empty sections and columns rather than filling them with guesses, `N/A`, generic industry risks, or repeated caveats.
- Do not repeat the same information in an overview table, a detail table, and a concluding table. If the detailed section already presents it clearly, summarize only the implication elsewhere.

### Standard company-report layout

Use this content order for a broad request such as “research this company.” It controls coverage, not the number of tables. Adapt labels and presentation to the user's language and the evidence available.

1. **Title and scope line** — company, research date, selected trade perspective and date window when applicable.
2. **Key judgments** — lead with no more than five short bullets explaining what matters and why. Do not duplicate them in a decision-overview table.
3. **Company profile** — normally use one compact `Attribute | Information` table for identity, country/headquarters, founded, ownership/listing, website, scale, and business model. Put contradictory scale/address values in the same row and explain the conflict.
4. **Business, products, and channels** — use a matrix such as `Business/Brand | Product or capability | Target market/channel | Evidence` when several lines can be compared. For one or two offers, use short prose instead. Separate established lines from newly announced lines.
5. **Recent developments** — use a `Date | Event | Commercial significance | Source` timeline when at least three material events exist. Otherwise integrate the developments into a short paragraph or bullets.
6. **Leadership and relevant contacts** — use `Person | Role | Function | Verified contact/profile | Why relevant` when several people were found. For one person, use a compact contact entry. Keep leadership without contact data; never invent an email.
7. **Customs and trade section** when matched reliably:
   - state the key totals and date window in one compact sentence or a few bold metrics, not a separate summary table;
   - use a counterparty table when multiple counterparties were returned: `Counterparty | Direction/Role | Country | Records | Value/Weight | Product clues`;
   - use a category table when multiple categories were returned: `HS code/Category | Plain-language product | Records | Value/Weight`;
   - add country or period tables only when there are enough rows to reveal a meaningful distribution or trend; two isolated months alone do not justify a trend table;
   - follow with one short data-coverage warning, not repeated warnings in every row.
8. **Risks and diligence gaps** — use 3–5 prioritized bullets in the form `finding → implication → next verification`. Use a matrix only when several risks genuinely need side-by-side comparison. Missing data is a diligence gap, not proof of risk.
9. **Commercial assessment** — finish with a concise synthesized judgment in prose. Do not create another dimension-by-dimension table that repeats the key judgments and risk section.
10. **Sources** — prefer inline links. Add a short source list only when provenance would otherwise be unclear; never repeat every inline URL in a separate table.

For a focused question, answer only the relevant sections and use one or two tables when there are comparable records. Do not force the complete report layout onto a narrow request.

### Quality gate before replying

Check the draft once:

- Can a reader understand the company, trade signal, contacts, and main risks by scanning headings, bullets, and genuinely useful tables?
- Were genuinely comparable API records kept structured without forcing standalone facts or judgments into tables?
- Does every judgment explain its evidence or clearly identify itself as an interpretation?
- Are trade direction, entity name, date window, units, and coverage limitations explicit?
- Did the answer avoid repeating the same fact or caveat across several sections?
- Does each table make comparison materially easier? Remove any table whose content would read more naturally as one sentence, a few metrics, or prioritized bullets.

If a report feels like a spreadsheet rather than an analysis, merge or remove redundant tables and restore concise interpretation before replying. If it reads as an essay despite having genuinely comparable records, convert only those records into tables.

Add a short charged-credit note only when returned billing data is useful to the user.

Never include configuration checks, retries, tool traces, or internal process notes in the final answer.
