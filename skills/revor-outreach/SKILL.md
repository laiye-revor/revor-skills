---
name: revor-outreach
description: Function-triggered outreach execution via Revor for LinkedIn, Email, and WhatsApp. Use this skill to detect outreach intent, validate sending prerequisites, draft channel-ready copy, and dispatch only after requirements are met and user confirmation is clear. If required recipient/contact data is missing, ask the user to provide it or search it first.
version: 1.0.0
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
        description: Revor API key used to read connected accounts and dispatch outreach jobs.
      - name: REVOR_BASE_URL
        required: false
        description: Optional Revor API base URL. Defaults to https://revor.ai.
    homepage: https://revor.ai
---

# Revor Outreach (Function-Triggered)

## 1) Goal

Treat this skill as an **outreach executor**, not a generic search workflow.

It should:
- detect outreach intent,
- validate Revor account/API/channel readiness,
- draft send-ready outreach copy by channel,
- dispatch via Revor API when conditions are satisfied,
- return a clear result summary (sent/failed/skipped with reasons).

If required recipient data is missing (`profile_url`, `address`, `phone`), **do not fabricate**. Ask the user to provide it or search it first.

---

## 2) File Routing by Function

Do not read every file by default. First identify the task type, then read the relevant reference.

### A. Account / readiness / sendability checks

Read:
- `reference/accounts.md`

Use this when the task is about:
- checking whether Revor is ready to send,
- validating API key health,
- checking whether a LinkedIn / Email / WhatsApp account is connected and sendable,
- explaining why sending cannot proceed yet.

### B. Outreach dispatch (LinkedIn / Email / WhatsApp)

Read in this order:
1. `reference/accounts.md`
2. `reference/dispatch/dispatch.md`

Use this when the user wants to:
- send a LinkedIn invite/message,
- send a cold email,
- send a WhatsApp intro,
- send now / proceed with sending.

### C. LinkedIn post-like warm-up

Read in this order:
1. `reference/accounts.md`
2. `reference/dispatch/linkedin-post-like.md`

Use this when the user wants to:
- like a relevant LinkedIn post,
- warm up engagement before outreach,
- use Revor's LinkedIn post-like flow.

### D. Draft-only outreach copy

If the user wants copy but does **not** clearly ask for immediate dispatch:
- gather the minimum required context,
- draft the outreach,
- do **not** send yet.

You may reference `reference/dispatch/dispatch.md` for channel constraints, but do not treat draft generation as automatic permission to dispatch.

---

## 3) Capabilities, Triggers, and Required Inputs

### Capability A — Outreach Intent Detection

**Trigger when any of these is requested:**
- “Send a LinkedIn invite/message”
- “Send a cold email”
- “Send a WhatsApp intro”
- “Use Revor to reach out”

**Required inputs:**
- at least one target contact,
- at least one target channel (LinkedIn / Email / WhatsApp).

If missing, ask for target + channel before continuing.

---

### Capability B — Pre-Send Readiness Check

**Trigger when:**
- user asks to send now / proceed with sending.

Before any actual dispatch, read:
- `reference/accounts.md`

All required conditions:
1. User has a Revor account (with usable paid access if required by Revor plan/policy).
2. User has a valid API key.
3. User has connected at least one sendable channel account (LinkedIn / Email / WhatsApp).
4. For the requested channel, a connected account exists with `status="ok"` and `can_send=true`.

If missing, guide clearly:
- Register/login: `https://revor.ai`
- API key page: `https://revor.ai/my-api-keys`
- Connect send accounts: `https://revor.ai/console/connect`

Important: preserve the reminder style and user guidance in `reference/accounts.md`. Do not reduce it to a terse rejection.

---

### Capability C — Draft Outreach Copy (No Send Required)

**Trigger when:**
- user asks for outreach copy/draft,
- user does not clearly request immediate dispatch.

**Required inputs:**
- target role/company/objective,
- channel and language preference (default to user language if unspecified).

If information is incomplete, ask only the minimum necessary questions. If still incomplete, return a “missing fields” list.

**LinkedIn note constraint:**
- When drafting a LinkedIn connection note / invite note / add-note message, keep the final copy **within 200 characters** unless the user explicitly says they do not need a connection-note-safe version.
- Prefer concise, natural wording over squeezing in extra context.

---

### Capability D — Dispatch Outreach

**Trigger when:**
- user explicitly asks to send,
- pre-send checks pass,
- channel-specific recipient fields are complete.

Read in order:
1. `reference/accounts.md`
2. `reference/dispatch/dispatch.md`

**Channel-required fields:**
- LinkedIn: `recipient.profile_url` (the contact's **personal LinkedIn profile page URL**, e.g. their public `/in/...` profile link — not a search results page or company page)
- Email: `recipient.address`
- WhatsApp: `recipient.phone`

If any required field is missing:
- do not send,
- state exactly which field is missing,
- ask user to provide it or search it first.

---

## 4) Environment & Secret Rules

Prefer persistent configuration so new windows/sessions do not require reconfiguration.

Resolve secrets in this order:
1. `~/.config/RevorSkill/.env` (OpenClaw/local persistent default)
2. Platform persistent config (e.g., Claude Desktop MCP server `env` in `claude_desktop_config.json`)
3. Process/runtime environment (session-scoped fallback)
4. `<current-skill-dir>/.env` (last fallback)

Platform examples:
- Claude Desktop + MCP: set `REVOR_API_KEY` in the MCP server `env` map (`claude_desktop_config.json`)
- Claude Code/CLI: keep `REVOR_API_KEY` in persistent shell/env tooling (avoid one-off exports when persistence is desired)

Base URL:

```txt
https://revor.ai
```

Required keys:

```bash
REVOR_BASE_URL="https://revor.ai"
REVOR_API_KEY=""
```

Rules:
- never store secret values in prompts, MEMORY.md, chat transcripts, or committed repo files,
- if `.env` is used and file does not exist, create `~/.config/RevorSkill/.env`,
- if keys are missing, add key names without overwriting existing values,
- if user provides a key in chat and asks for help, configure it directly in persistent config (default `~/.config/RevorSkill/.env`),
- verification checks are recommended but should stay lightweight and non-blocking,
- never echo full API keys in outputs; mask as `****`.

---

## 5) Required Execution Flow

The following flow is mandatory for real outreach execution.

### Flow 1 — Identify the task type

First decide whether the task is:
1. readiness check,
2. draft only,
3. dispatch,
4. LinkedIn post-like warm-up.

Then read only the relevant reference files.

### Flow 2 — Check readiness before any send

For every actual send request, readiness checks are mandatory.
Read:
- `reference/accounts.md`

Do not skip this step.

### Flow 3 — Validate channel-specific recipient fields

Before dispatch, confirm:
- LinkedIn -> `profile_url`
- Email -> `address`
- WhatsApp -> `phone`

If any required field is missing, stop and ask for it.

### Flow 4 — Draft first unless the user clearly wants immediate send

Default behavior:
- draft first,
- send after clear confirmation.

Only send immediately when the user explicitly asks to send now.

### Flow 5 — Always check the job result

A `202 Accepted` dispatch or post-like creation response means the job was created, **not** that the action is complete.

Always check the final outcome with:
- `GET /api/v1/outreach/jobs/{id}`

If the job lookup returns HTTP `200` but `item.status = "failed"`, treat it as execution failure.

---

## 6) Dispatch Policy

- Default: draft first, then send after clear user confirmation.
- Send immediately only when user explicitly requests immediate dispatch.
- Never guess private contact data.
- Prefer small, high-quality contact sets over bulk blasts.

---

## 7) Compliance Boundaries

Refuse assistance for:
- harassment,
- phishing,
- impersonation,
- fraud,
- unreviewed mass spam outreach,
- fabricated identities or contact details.

Keep outreach professional, truthful, and auditable.
