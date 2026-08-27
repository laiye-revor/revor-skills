# Revor Outreach Dispatch Reference

## 1) Purpose

Treat this reference as the **dispatch execution layer** for Revor outreach.

Use it to:
- construct channel-correct dispatch payloads,
- enforce required recipient/content fields,
- create outreach jobs,
- check job results and interpret final outcome,
- explain dispatch-specific failures.

If the task is only about account/API/channel readiness, read `reference/accounts.md` first.

---

## 2) When to Read This File

Read this file when:
- the user explicitly asks to send now,
- readiness checks already passed,
- you need Email / LinkedIn / WhatsApp payload requirements,
- you need to explain what `202 Accepted` means,
- you need to check whether a created outreach job actually succeeded.

---

## 3) Required Dispatch Preconditions

Before dispatch, all of the following must already be true:
1. `REVOR_API_KEY` is valid.
2. A sendable account exists for the requested channel.
3. A matching `account_id` has been selected.
4. Channel-required recipient data is complete.
5. The user explicitly wants the message sent now, or has clearly confirmed dispatch.

Default policy:
- draft first,
- send after clear user confirmation.

Send immediately only when the user explicitly asks for immediate dispatch.

---

## 4) Channel-Required Recipient Fields

- LinkedIn: `recipient.profile_url` (must be the contact's personal LinkedIn profile page URL, not a search page or company page)
- Email: `recipient.address`
- WhatsApp: `recipient.phone`

If any required field is missing:
- do not send,
- state exactly which field is missing,
- ask the user to provide it or search it first.

---

## 5) API Usage — Create Outreach Dispatch

Base URL:

```txt
https://revor.ai
```

```http
POST /api/v2/outreach/dispatches
Content-Type: application/json
Idempotency-Key: <unique-key>
Authorization: Bearer <REVOR_API_KEY>
```

Create a new idempotency key for each new business action and preserve it for an exact retry. The REST header is optional at the protocol level, but this Skill always supplies it because outreach has an external side effect; the equivalent MCP tool requires `idempotency_key`.

Encoding reminder:
- For Chinese or other non-ASCII message text, send the payload as valid UTF-8 JSON with `Content-Type: application/json`.
- Do not manually re-encode text, double-escape Unicode, or send form/query-encoded message bodies unless the API explicitly requires it; incorrect charset handling can cause garbled outbound messages.
- If a user reports mojibake/garbled Chinese text, first inspect payload serialization, request headers, and client default encoding before retrying the dispatch.

Required top-level fields:

| Field | Required | Notes |
| --- | --- | --- |
| `account_id` | yes | Use `items[].account_id` from a sendable account. |
| `channel` | yes | `email`, `linkedin`, or `whatsapp`. Must match the account channel. |
| `action` | yes | Always `outreach`. |
| `recipient` | yes | Channel-specific recipient data. |
| `content` | yes | Channel-specific message content. |

Optional scheduling fields:
- `min_channel_task_interval_seconds`
- `minChannelTaskIntervalSeconds`
- `min_user_task_interval_seconds`

The interval is clamped to `60..86400` seconds and applies per user + channel.
For planned or batch outreach, generate a randomized `min_channel_task_interval_seconds` for each task instead of reusing a fixed value. Use `180..360` seconds as the default recommended range unless the user gives a stricter cadence. Never send a value below `60`; Revor will clamp it to `60`.

---

## 6) Minimal Channel Payload Patterns

When generating payloads for multiple planned outreach tasks, include `min_channel_task_interval_seconds` in each payload and randomize it per task, preferably within `180..360`. The minimal examples below omit scheduling only to show the channel-specific required fields.

### Email

Email requires `recipient.address`, `content.subject`, and at least one of `content.text` / `content.html`:

```json
{
  "account_id": "connect_account_xxx",
  "channel": "email",
  "action": "outreach",
  "recipient": {
    "address": "prospect@example.com",
    "name": "Prospect Name"
  },
  "content": {
    "subject": "Quick introduction",
    "text": "Hi, this is a quick API test."
  }
}
```

### LinkedIn

LinkedIn requires `recipient.profile_url` and `content.text` or an attachment:

```json
{
  "account_id": "connect_account_xxx",
  "channel": "linkedin",
  "action": "outreach",
  "recipient": {
    "profile_url": "https://www.linkedin.com/in/test-user/"
  },
  "content": {
    "text": "Hi, this is a LinkedIn API test."
  }
}
```

LinkedIn behavior:
- already connected -> resolves to `direct_message`
- not connected or unknown -> resolves to `invitation`

LinkedIn note constraint:
- When drafting a LinkedIn connection note / invite note / add-note message, keep the final copy **within 200 characters** unless the user explicitly says they do not need a connection-note-safe version.
- Prefer concise, natural wording over squeezing in extra context.

### WhatsApp

WhatsApp requires `recipient.phone` and `content.text` or an attachment:

```json
{
  "account_id": "connect_account_xxx",
  "channel": "whatsapp",
  "action": "outreach",
  "recipient": {
    "phone": "+14155550123"
  },
  "content": {
    "text": "Hi, this is a WhatsApp API test."
  }
}
```

---

## 7) Async Job Semantics

A successful write request typically returns `202 Accepted` with a job id.
That does **not** mean the message or action has already completed.

Always check the job result with:

```http
GET /api/v2/jobs/<job_uuid>
Authorization: Bearer <REVOR_API_KEY>
```

Typical create response:

```json
{
  "ok": true,
  "request_id": "req_xxx",
  "item": {
    "id": "job_uuid",
    "status": "queued",
    "action": "outreach.dispatch",
    "channel": "email",
    "scheduled_at": "2026-05-20T10:00:00.000Z"
  }
}
```

---

## 8) Check Outreach Job

```http
GET /api/v2/jobs/<job_uuid>
Authorization: Bearer <REVOR_API_KEY>
```

Terminal statuses:
- `succeeded`
- `failed`
- `cancelled`

Non-terminal statuses:
- `queued`
- `scheduled`
- `running`
- `settling`

Successful job example:

```json
{
  "ok": true,
  "request_id": "req_xxx",
  "item": {
    "id": "job_uuid",
    "status": "succeeded",
    "action": "outreach.dispatch",
    "channel": "email",
    "attempt_count": 1,
    "result": {
      "status": "accepted",
      "message_id": "message_xxx"
    },
    "error": null
  }
}
```

Failed job example:

```json
{
  "ok": true,
  "request_id": "req_xxx",
  "item": {
    "id": "job_uuid",
    "status": "failed",
    "action": "outreach.dispatch",
    "channel": "linkedin",
    "attempt_count": 2,
    "result": null,
    "error": {
      "code": "connect_account_reconnect_required",
      "message": "connect_account_reconnect_required",
      "retryable": false
    }
  }
}
```

Important: job execution failure may still return HTTP `200` from the job query endpoint. Treat `item.status = "failed"` as the failure signal.

---

## 9) Error Handling (User-Friendly)

### 401

> Revor authentication failed. Please verify the API key is present, correct, active, and not expired or revoked.

### 403

> This API key does not have sufficient permissions. Please update key permissions or create a new key.

### 404

For `account_not_found`:

> The selected sending account was not found for this Revor user. Please list Connect accounts again and choose a current sendable account.

For `external_api_job_not_found`:

> I could not find that Revor job for this API key. Please verify the job id and make sure it was created under the same Revor user.

### 409

> Revor could not proceed because of a conflict, such as an idempotency mismatch, account/channel mismatch, reconnect-required account, or temporarily unusable sending account.

### 429

> Revor rate limited this request. Wait for `Retry-After` if present, then retry the same business action with the same `Idempotency-Key`. API and MCP calls share account-level limits, so do not switch keys or protocols to evade the limit.

### 503

> Revor accepted the request path, but the async worker queue is temporarily unavailable. Retry later with the same `Idempotency-Key`.

### Job failed

When `GET /api/v2/jobs/{id}` returns `ok: true` and `item.status = "failed"`, treat it as an execution failure, not an HTTP request failure.

> Revor created the job, but the job failed during execution: `<item.error.code>`.
