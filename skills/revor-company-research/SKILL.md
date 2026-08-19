---
name: revor-company-research
description: Research and profile companies with Revor public-web evidence, contact discovery, and customs trade data. Use when a user asks for company background research, commercial due diligence, supplier or customer analysis, procurement intelligence, trade activity, key contacts, competitors, risks, or a decision-ready company report. Produce sourced Markdown rather than Revor-specific HTML artifacts.
metadata:
  openclaw:
    requires:
      env:
        - REVOR_API_KEY
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

## Mission

Turn Revor data into a decision-ready company assessment. Do not merely list API results. Establish the correct company identity, connect evidence across sources, explain what the evidence means, and make uncertainty visible.

Return concise Markdown. Do not recreate Revor's HTML report, artifact UI, or contact tree.

## Configure Revor

Read `REVOR_API_KEY` and optional `REVOR_BASE_URL` from the environment or `~/.config/RevorSkill/.env`. Default the base URL to `https://revor.ai`. Use the exact configured host; never guess another hostname. Never print or persist the key in outputs.

If the key is missing, direct the user to `https://revor.ai/my-api-keys`.

## Research Workflow

### 1. Frame the decision

Infer what the user is trying to decide, not just what data they requested. Typical goals include:

- understanding a company before outreach or a meeting,
- assessing a buyer, supplier, or competitor,
- finding relevant decision-makers,
- evaluating sourcing patterns and trade dependence,
- checking risks, inconsistencies, or recent changes.

Confirm the target company, relevant country or market, and desired depth from context. If the name is ambiguous, resolve identity before using paid endpoints.

### 2. Resolve company identity

Use public-web research first when the official domain or legal identity is uncertain. Establish:

- official and trading names,
- official domain,
- headquarters and operating markets,
- core products or services,
- whether the evidence refers to the same entity.

Do not merge similarly named companies. Prefer the company's own website and primary documents; use reputable news, registries, and industry sources for corroboration. Treat directories and search snippets as leads rather than definitive proof.

### 3. Build an evidence plan

Call only the data needed to answer the decision question:

| Need | Revor capability |
| --- | --- |
| identity, products, positioning, recent events | public-web research |
| relevant executives or functional contacts | contact research |
| suppliers, customers, or trading partners | customs counterparties |
| products and HS categories | customs categories |
| activity, growth, decline, or seasonality | customs trends |
| source or destination concentration | customs countries |
| broad trade assessment | full customs report |

Start narrow. Expand only when the first result exposes a meaningful gap. Do not call the full customs report and its component endpoints for the same scope.

### 4. Gather and interpret evidence

For every important claim, retain its source, date, and scope. Separate:

- **fact**: directly supported by returned evidence,
- **inference**: a reasonable interpretation of multiple facts,
- **unknown**: material information the available data cannot establish.

When sources conflict, show the conflict and favor the more direct, recent, and authoritative source. Do not turn absence of evidence into evidence of absence.

Interpret each dataset rather than dumping it:

- **Public web:** explain the business model, products, markets, positioning, and meaningful recent developments.
- **Contacts:** select people relevant to the user's goal; explain why each role matters. Treat title-based hierarchy as inferred, not verified.
- **Counterparties:** identify concentration, repeated relationships, and likely supplier/customer roles from the chosen importer/exporter perspective.
- **Categories:** translate HS codes and descriptions into understandable product groups; identify the commercially important mix.
- **Trends:** distinguish sustained direction from one-off spikes and note the exact period.
- **Countries:** identify geographic concentration, diversification, and possible supply-chain exposure without overstating causality.

Cross-check signals. For example, compare claimed products with customs categories, stated markets with trading countries, and the user's commercial goal with the contact functions returned.

### 5. Form conclusions

Answer the user's underlying questions explicitly:

- What does this company appear to do and where does it operate?
- What evidence suggests its scale, activity, or commercial priorities?
- What relationships or product categories matter most?
- Who appears relevant to contact, and why?
- What risks, contradictions, or data gaps could change the conclusion?
- What is the most useful next verification step?

Use confidence labels when they add value:

- **High:** direct primary evidence or consistent evidence from multiple sources.
- **Medium:** credible but indirect, dated, or only singly sourced.
- **Low:** inference from sparse, ambiguous, or conflicting evidence.

## Report Structure

Adapt the length to the request. A comprehensive report should normally contain:

1. **Executive assessment** — the most decision-relevant conclusions, not a generic summary.
2. **Company identity** — names, domain, location, business, and identity confidence.
3. **Business and recent developments** — products, markets, positioning, and notable changes with links.
4. **Commercial or trade intelligence** — only when requested or relevant; state role and date range.
5. **Relevant contacts** — role-focused shortlist with rationale; avoid unnecessary personal data.
6. **Risks and unknowns** — conflicting evidence, missing coverage, and limitations.
7. **Recommended next checks** — a short, prioritized list.

Use tables for comparisons and concentrated datasets. Put source links beside the claims they support. Add a brief API usage and charged-credit note when the API returns billing information.

Never present raw JSON as the report. Never pad an empty section; omit irrelevant sections and state meaningful gaps plainly.

## Minimal API Reference

Send `Authorization: Bearer <REVOR_API_KEY>`, JSON content, a stable `Idempotency-Key`, and `Prefer: wait=20`. A POST may return a job before completion; when it does, poll `GET /api/v2/jobs/{job_id}` until `succeeded`, `failed`, or `cancelled`. Reuse the idempotency key only for an exact retry.

### Research endpoints

```text
POST /api/v2/research/public-web
  queries: 1-2 focused searches
  search_limit: 1-10, normally 5
  optional: category, include_domains, user_location

POST /api/v2/research/contacts
  domain: confirmed company domain, not company name
  optional: positions, limit (1-50), locale (en|zh)
```

Public-web sources contain URLs, titles, dates, highlights, and text. Contact results contain company/domain context, contacts, inferred nodes, and inferred edges.

### Customs endpoints

```text
POST /api/v2/customs/trade-reports
POST /api/v2/customs/counterparties
POST /api/v2/customs/categories
POST /api/v2/customs/trends
POST /api/v2/customs/countries
```

Use `company_name`, `company_role` (`importer` or `exporter`), `start_date`, `end_date`, and a small `page_size`. If dates are unspecified, use the latest 12 complete calendar months. Do not request more than one year. Use a legal or customs trading-name variant supported by evidence.

A successful empty customs result means no match for that exact name, role, period, and filters. It does not prove the company has no trade activity. Retry a better-supported name or opposite role only when the research context justifies it, and disclose the changed scope.

## Boundaries

- Minimize paid calls and avoid duplicate scopes.
- Report failed jobs and billing status; do not fabricate partial results.
- Treat `external_api_billing_retryable` as a Revor billing preparation or settlement failure, not an empty provider result.
- Do not invent contacts, emails, reporting lines, trade relationships, or causal explanations.
- Do not expose unnecessary personal data or use contacts for harassment, phishing, impersonation, or unreviewed mass outreach.
- Research does not authorize sending messages; require a separate outreach request and workflow.
