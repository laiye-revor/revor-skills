---
name: revor-company-research
description: Research a company with Revor public-web evidence, customs entity resolution and trade data, and role-focused contacts. Use for company background checks, supplier or buyer due diligence, customer research, trade intelligence, commercial assessment, risk review, meeting preparation, or finding relevant company contacts. Produce a sourced, decision-oriented Markdown report without Revor HTML artifacts.
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
---

# Revor Company Research

Produce a practical company background report. Anchor it in the company's official public identity, then add customs and contact evidence when they can be matched reliably.

Return sourced Markdown. Do not recreate Revor's HTML report or contact-tree UI. Do not narrate the research process.

## Use the bundled client

Run the sibling script `scripts/revor-api.mjs` for every Revor data call. Resolve its path relative to this `SKILL.md`; do not rewrite its HTTP logic with inline JavaScript or curl.

The script reads `~/.config/RevorSkill/.env` before process environment values. Configure:

```text
REVOR_API_KEY="..."
REVOR_BASE_URL="https://revor.ai"
```

Use the exact configured base URL. Never guess another hostname or print the key. Check configuration with:

```text
node <skill-dir>/scripts/revor-api.mjs config
```

All commands wait for the Revor job to finish and print one compact JSON result. If a command fails, use its returned error; do not substitute OpenClaw `web_search`, `web_fetch`, Google, Bing, DuckDuckGo, or arbitrary scraping. Never fabricate a report from unrelated search results.

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

If the first lookup gives no reliable match, make one more lookup using a materially different name supported by the public research or candidate results. Do not invent suffixes, punctuation, translations, abbreviations, or legal forms. If no reliable match remains, stop the customs branch and state only that no reliable customs-data match was found for the tested names and scope.

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

## Report

Write in the language of the user's latest message. Lead with the findings that matter for the likely decision. A comprehensive report should normally cover:

1. Key judgments.
2. Company identity, business, products/services, founding date, and current headquarters when found.
3. Business scale and material corporate developments.
4. Recent news and market signals from the last 24 months.
5. Products, customers, channels, and partnerships.
6. Leadership and organization when supported.
7. Customs/trade findings, including the selected exact entity, role, and date range, when that branch succeeded.
8. Relevant contacts when returned.
9. Observed company-specific risks, separately from industry issues that still require verification.
10. Concise commercial assessment and confidence.
11. Public sources actually used.

Omit unsupported or empty sections. Do not force a fixed template, star rating, generic risk checklist, or long recommendation list. Put links beside the claims they support. Add a short charged-credit note only when returned billing data is useful to the user.
