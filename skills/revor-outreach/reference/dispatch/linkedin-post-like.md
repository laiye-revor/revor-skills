# Revor LinkedIn Post Like Reference

## 1) Purpose

Treat this reference as the **LinkedIn post-like execution layer** for Revor outreach.

Use it when the user wants to:
- like a relevant LinkedIn post from a target profile,
- do lightweight warm-up engagement before direct outreach,
- trigger Revor's LinkedIn post-like workflow.

If the task is standard message dispatch, read `reference/dispatch/dispatch.md` instead.

---

## 2) Preconditions

Before calling the post-like API, confirm all of the following:
1. `REVOR_API_KEY` is valid.
2. At least one usable LinkedIn account exists.
3. If multiple usable LinkedIn accounts exist, pass `account_id` explicitly.
4. The target `profile_url` (or equivalent accepted field) is provided.
5. At least one of `content`, `topic`, or `intent` is provided so Revor can decide what counts as relevant.

If these are not satisfied:
- do not execute the like request,
- resolve account readiness or missing input first.

For account readiness rules, read `reference/accounts.md` first.

---

## 3) API Usage — Like a Relevant LinkedIn Post

Base URL:

```txt
https://revor.ai
```

```http
POST /api/v2/outreach/linkedin/post-likes
Content-Type: application/json
Idempotency-Key: <unique-key>
Authorization: Bearer <REVOR_API_KEY>
```

Create a new idempotency key for each new like request and preserve it for an exact retry. The REST header is optional at the protocol level, but this Skill always supplies it because the action changes external state; the equivalent MCP tool requires `idempotency_key`.

Required fields:
- `profile_url` or `profileUrl`
- `content`, `topic`, or `intent`

Optional fields:
- `account_id` or `accountId`
- `post_limit` or `postLimit` (default `20`, max `50`)
- `locale` (`en` or `zh`)
- `min_channel_task_interval_seconds`

Use the same randomized interval policy as outreach dispatches for repeated LinkedIn like tasks: prefer `180..360` seconds per task, with an absolute minimum of `60` seconds.

If the user has exactly one usable LinkedIn account, `account_id` may be omitted.
If multiple usable LinkedIn accounts exist, pass `account_id`.

Payload example:

```json
{
  "account_id": "connect_account_xxx",
  "profile_url": "https://www.linkedin.com/in/test-user/",
  "content": "AI sales automation and outbound workflow",
  "post_limit": 20,
  "locale": "en"
}
```

---

## 4) Behavior

The endpoint will:
- fetch recent LinkedIn posts from the target profile,
- pick the most relevant post using the internal selector,
- like at most one post.

If no relevant post is found:
- the result may return `result.status = "skipped"`,
- this does not necessarily mean the API failed; it may simply mean no sufficiently relevant post existed.

---

## 5) Async Job Semantics and Result Checking

This endpoint is also asynchronous.
A successful create request does not mean the like action has completed.

After creation, check the job result with:

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

If the job query returns HTTP `200` but `item.status = "failed"`, treat it as execution failure.

---

## 6) Error Handling (User-Friendly)

### 401

> Revor authentication failed. Please verify the API key is present, correct, active, and not expired or revoked.

### 403

> This API key does not have sufficient permissions. Please update key permissions or create a new key.

### 404

For `account_not_found`:

> The selected LinkedIn account was not found for this Revor user. Please list accounts again and choose a current usable account.

For `external_api_job_not_found`:

> I could not find that Revor job for this API key. Please verify the job id and make sure it was created under the same Revor user.

### 409

> Revor could not proceed because of a conflict, such as a reconnect-required account, unusable sending state, or request/account mismatch.

### 429

> Revor rate limited this request. Wait for `Retry-After` if present, then retry with the same idempotency key. API and MCP calls share account-level limits, so do not switch keys or protocols to evade the limit.

### 503

> Revor accepted the request path, but the async worker queue is temporarily unavailable. Retry later.

### Job failed

When job lookup returns `item.status = "failed"`:

> Revor created the job, but the LinkedIn like task failed during execution: `<item.error.code>`.
