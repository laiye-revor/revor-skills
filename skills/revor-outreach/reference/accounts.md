# Revor Outreach (Function-Triggered)

## 1) Goal

Treat this reference as the **account/readiness layer** for the Revor outreach skill.

Use it to:
- validate Revor account/API/channel readiness,
- check whether a requested channel is actually sendable,
- explain what is missing and where the user should fix it,
- identify a usable connected account before any dispatch attempt.

Do **not** use this file as the place for dispatch payload construction or LinkedIn post-like execution details. Those live under `reference/dispatch/`.

---

## 2) When to Read This File

Read this file first when the task involves any of the following:
- “Can I send from Revor yet?”
- “Check whether my LinkedIn / Email / WhatsApp account is connected.”
- “Why can’t you send this yet?”
- “Use Revor to send this now” but channel readiness has not yet been confirmed
- validating API key health before sending

This file is the required first step for all actual send flows.

---

## 3) Pre-Send Readiness Check

**Trigger when:**
- the user asks to send now / proceed with sending.

**All required conditions:**
1. User has a Revor account (with usable paid access if required by Revor plan/policy).
2. User has a valid API key.
3. User has connected at least one sendable channel account (LinkedIn / Email / WhatsApp).
4. For the requested channel, a connected account exists with `status="ok"` and `can_send=true`.

If any of these are missing:
- do not send,
- explain clearly what is missing,
- point the user to the correct place to fix it,
- offer to configure the key directly if the user wants help.

Helpful links:
- Register/login: `https://revor.ai`
- API key page: `https://revor.ai/my-api-keys`
- Connect send accounts: `https://revor.ai/console/connect`

---

## 4) Reminder Style Requirements

When readiness is missing, keep the guidance warm and practical.

- Do **not** present setup as a rigid fixed sequence unless the user explicitly asks for step-by-step instructions.
- First explain in plain language **what is missing** and **why it matters**:
  - Revor account = access to the platform
  - connected LinkedIn/Email/WhatsApp account = the actual sending channel
  - API key = the permission key that allows the agent to dispatch through Revor
- Explicitly tell the user the expected variable name: `REVOR_API_KEY`, and clearly point to persistent config locations first:
  - OpenClaw/local persistent path: `~/.config/RevorSkill/.env`
  - Claude Desktop + MCP persistent config: target MCP server `env` in `claude_desktop_config.json`
  - Claude Code/CLI: persistent shell profile/env tooling (not a one-off session export)
- If the user does not want to configure it manually, offer to configure it directly for them at the correct path.
- Avoid framing this as temporary setup unless the user explicitly asks for temporary behavior.
- Use beginner-friendly language. Assume the user may have zero prior knowledge.
- Prefer a warm checklist style over terse technical warnings.
- If the user may be missing multiple prerequisites, say that clearly without blame, e.g. "You may still be missing one or more of these: account, connected sending channel, or API key."
- If the exact missing item is unknown, say so honestly and point the user to the 3 relevant places without pretending to know which one is incomplete.
- If the user is clearly a beginner, include short clarifiers such as:
  - "If you don't have a Revor account yet, register first."
  - "If you already have one, sign in and connect the channel you want to send from."
  - "Then create or copy an API key so I can send on your behalf."
  - "If you want, send the key here and I’ll configure `REVOR_API_KEY` for you in the persistent config path."
- Avoid sounding blocking or bureaucratic. The goal is to help the user understand readiness, not just reject the action.
- Only give a numbered sequence when the user asks for "一步一步", "step by step", or seems confused after a simpler reminder.

**Suggested reminder pattern:**

> I can help send this, but I don’t have sending access yet.
> Usually that means one or more of these is still missing: Revor account, connected sending channel, or API key.
>
> The key I need is `REVOR_API_KEY`.
> Recommended persistent config locations:
> - OpenClaw/local: `~/.config/RevorSkill/.env`
> - Claude Desktop MCP: target server `env` in `claude_desktop_config.json`
> - Claude Code/CLI: persistent shell profile/env tooling
>
> If you want, send me the key and I’ll configure it for you directly in the right place so new windows/sessions don’t need reconfiguration.
> Once that’s set, I can continue immediately.

---

## 5) Environment & Secret Rules

Prefer persistent configuration so new windows/sessions do not require reconfiguration.

Base URL:

```txt
https://revor.ai
```

Resolve secrets in this order:
1. `~/.config/RevorSkill/.env` (OpenClaw/local persistent default)
2. Platform persistent config (e.g., Claude Desktop MCP server `env` in `claude_desktop_config.json`)
3. Process/runtime environment (session-scoped fallback)
4. `<current-skill-dir>/.env` (last fallback)

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

## 6) API Usage — List Connected / Sendable Accounts

### 6.1 Fast smoke test

```http
GET /api/v1/connect/accounts
Authorization: Bearer <REVOR_API_KEY>
```

Use this to quickly confirm the key works and account listing is allowed.

Expected behavior:
- `200` -> key works and account listing is allowed
- `401` -> key missing / invalid / revoked / expired
- `403` -> key does not have `connect.accounts:read`
- `429` -> key, user, or pre-auth rate limit was exceeded

---

### 6.2 List sendable accounts by channel

```http
GET /api/v1/connect/accounts?channel=<email|linkedin|whatsapp>&can_send=true
Authorization: Bearer <REVOR_API_KEY>
```

Treat an account as sendable only when:

```json
{
  "status": "ok",
  "can_send": true
}
```

Also verify that `channel` matches the requested channel.

Do not require an exact `lifecycle_status` string; use it only as diagnostic context because deployments may expose values such as:
- `active`
- `connected`
- `reconnect_required`

Example success shape:

```json
{
  "ok": true,
  "request_id": "req_xxx",
  "items": [
    {
      "account_id": "connect_account_xxx",
      "channel": "email",
      "name": "sales@example.com",
      "account_identifier": "sales@example.com",
      "status": "ok",
      "lifecycle_status": "active",
      "can_send": true,
      "can_receive": true
    }
  ]
}
```

If no matching account is found:
- do not send,
- explain that a sendable channel account is missing,
- direct the user to `https://revor.ai/console/connect`.

---

## 7) Error Handling (User-Friendly)

### 401

> Revor authentication failed. Please verify the API key is present, correct, active, and not expired or revoked.

### 403

> This API key does not have sufficient permissions to read connected accounts. Please update key permissions or create a new key.

### 404

For `account_not_found`:

> The selected sending account was not found for this Revor user. Please list Connect accounts again and choose a current sendable account.

### 409

> Revor could not proceed because of a conflict, such as an account/channel mismatch, reconnect-required account, or temporarily unusable sending account.

### 429

> Revor rate limited this request. Wait for `Retry-After` if present, then retry.

### 503

> Revor accepted the request path, but the async worker queue is temporarily unavailable. Retry later.
