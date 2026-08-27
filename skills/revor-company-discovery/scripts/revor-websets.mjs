#!/usr/bin/env node

import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const terminalStatuses = new Set(["completed", "failed", "cancelled"])
const itemDetailLimits = Object.freeze({ compact: 50, standard: 25, full: 10 })
const skillDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const persistentConfigFile = path.join(os.homedir(), ".config", "RevorSkill", ".env")
const skillConfigFile = path.join(skillDir, ".env")
const apiKeyUrl = "https://revor.ai/zh/my-api-keys"

class ClientError extends Error {
  constructor(message, details = {}) {
    super(message)
    this.details = details
  }
}

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {}
  const values = {}
  for (const rawLine of fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!match) continue
    let value = match[2].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    values[match[1]] = value
  }
  return values
}

function firstConfigured(entries, fallback = "") {
  for (const [source, rawValue] of entries) {
    const value = String(rawValue || "").trim()
    if (value) return { source, value }
  }
  return { source: "default", value: fallback }
}

function loadConfig() {
  const persistent = parseEnvFile(persistentConfigFile)
  const local = parseEnvFile(skillConfigFile)
  const key = firstConfigured([
    ["persistent_config_file", persistent.REVOR_API_KEY],
    ["process_environment", process.env.REVOR_API_KEY],
    ["skill_env_file", local.REVOR_API_KEY],
  ])
  const base = firstConfigured([
    ["persistent_config_file", persistent.REVOR_BASE_URL],
    ["process_environment", process.env.REVOR_BASE_URL],
    ["skill_env_file", local.REVOR_BASE_URL],
  ], "https://revor.ai")
  const baseUrl = base.value.replace(/\/$/, "")
  if (!/^https?:\/\/[^\s]+$/i.test(baseUrl)) {
    throw new ClientError("REVOR_BASE_URL is invalid", {
      error_kind: "invalid_configuration",
      retryable: false,
      recommended_action: "correct_base_url_then_rerun_config",
      base_url: base.value,
      config_file: persistentConfigFile,
    })
  }
  return {
    apiKey: key.value,
    baseUrl,
    diagnostics: {
      apiKeySource: key.value ? key.source : "missing",
      baseUrlSource: base.source,
      persistentConfigFileExists: fs.existsSync(persistentConfigFile),
      skillConfigFileExists: fs.existsSync(skillConfigFile),
    },
  }
}

function parseOptions(argv) {
  const options = new Map()
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index]
    if (!raw.startsWith("--")) throw new Error(`Unexpected argument: ${raw}`)
    const equals = raw.indexOf("=")
    const name = raw.slice(2, equals === -1 ? undefined : equals)
    const value = equals === -1 ? argv[index + 1] : raw.slice(equals + 1)
    if (!value || (equals === -1 && value.startsWith("--"))) throw new Error(`Missing value for --${name}`)
    options.set(name, value)
    if (equals === -1) index += 1
  }
  return options
}

function option(options, name, fallback = "") {
  return String(options.get(name) ?? fallback).trim()
}

function required(options, name) {
  const value = option(options, name)
  if (!value) throw new Error(`Missing --${name}`)
  return value
}

function integer(options, name, fallback, min, max) {
  const raw = option(options, name)
  if (!raw) return fallback
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`--${name} must be an integer from ${min} to ${max}`)
  return value
}

function itemReadOptions(options) {
  const detail = option(options, "detail", "standard").toLowerCase()
  if (!(detail in itemDetailLimits)) throw new Error("--detail must be compact, standard, or full")
  return {
    detail,
    pageSize: integer(options, "page-size", 10, 1, itemDetailLimits[detail]),
  }
}

function createPayload(options) {
  const query = required(options, "query")
  if (query.length > 2_000) throw new Error("--query must be at most 2000 characters")
  const title = option(options, "title")
  if (title.length > 200) throw new Error("--title must be at most 200 characters")
  const locale = option(options, "locale", "en").toLowerCase()
  if (locale !== "en" && locale !== "zh") throw new Error("--locale must be en or zh")
  const count = integer(options, "count", 25, 25, 1_000)
  if (![25, 100, 500, 1_000].includes(count)) throw new Error("--count must be 25, 100, 500, or 1000")
  return {
    query,
    ...(title ? { title } : {}),
    count,
    target_kind: "company",
    locale,
  }
}

function defaultIdempotencyKey(payload) {
  const date = new Date().toISOString().slice(0, 10)
  const digest = crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 24)
  return `revor-company-discovery-${date}-${digest}`
}

function httpDetails(response, body, apiPath) {
  const status = response.status
  const apiCode = String(body?.error?.code || `http_${status}`)
  if (apiCode === "insufficient_credits" || apiCode === "USER_INSUFFICIENT_CREDITS") {
    return { error_kind: "insufficient_credits", api_code: apiCode, retryable: false, recommended_action: "add_credits_then_retry" }
  }
  if (apiCode.includes("job_concurrency_limit_exceeded")) {
    return { error_kind: "job_concurrency_limit", api_code: apiCode, retryable: true, retry_after: response.headers.get("retry-after") || null, recommended_action: "wait_for_active_jobs_then_retry_same_command" }
  }
  if (apiCode === "membership_tier_insufficient" || apiCode.includes("webset_count_not_available_for_tier")) {
    return { error_kind: "membership_tier_insufficient", api_code: apiCode, retryable: false, recommended_action: "choose_a_count_allowed_by_the_current_plan_or_upgrade" }
  }
  if (status === 401) return { error_kind: "authentication_failed", api_code: apiCode, retryable: false, recommended_action: "update_api_key_rerun_config_then_retry" }
  if (status === 403) return { error_kind: "permission_denied", api_code: apiCode, retryable: false, recommended_action: "update_api_key_permissions_then_retry" }
  if (status === 404 && apiCode.includes("webset_not_found")) return { error_kind: "webset_not_found", api_code: apiCode, retryable: false, recommended_action: "check_webset_id_and_resource_owner" }
  if (status === 404) return { error_kind: "endpoint_not_found", api_code: apiCode, retryable: false, recommended_action: "confirm_base_url_rerun_config_then_retry" }
  if (status === 409) return { error_kind: "webset_state_inconsistent", api_code: apiCode, retryable: false, recommended_action: "report_exact_error_and_ask_user" }
  if (status === 400 || status === 422) return { error_kind: "invalid_request", api_code: apiCode, retryable: false, recommended_action: "correct_request_then_retry" }
  if (status === 408 || status === 429 || status >= 500) {
    return {
      error_kind: status === 429 ? "rate_limited" : status >= 500 ? "service_unavailable" : "request_timeout",
      api_code: apiCode,
      retryable: true,
      retry_after: response.headers.get("retry-after") || null,
      recommended_action: "retry_same_command_once",
    }
  }
  return { error_kind: "http_error", api_code: apiCode, retryable: false, recommended_action: "report_exact_error_and_ask_user", path: apiPath }
}

async function requestJson(config, apiPath, init = {}) {
  const method = String(init.method || "GET").toUpperCase()
  let response
  try {
    response = await fetch(`${config.baseUrl}${apiPath}`, {
      ...init,
      signal: AbortSignal.timeout(35_000),
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(init.headers || {}),
      },
    })
  } catch (error) {
    const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError"
    throw new ClientError(timedOut ? "Revor request timed out" : "Revor connection failed", {
      error_kind: timedOut ? "request_timeout" : "connection_failed",
      retryable: true,
      recommended_action: "retry_same_command_once",
      method,
      base_url: config.baseUrl,
      path: apiPath,
    })
  }
  const raw = await response.text()
  let body
  try {
    body = raw ? JSON.parse(raw) : null
  } catch {
    throw new ClientError(`Revor returned non-JSON HTTP ${response.status}`, {
      error_kind: "invalid_response",
      retryable: response.status >= 500,
      recommended_action: response.status >= 500 ? "retry_same_command_once" : "report_exact_error_and_ask_user",
      http_status: response.status,
      method,
      base_url: config.baseUrl,
      path: apiPath,
    })
  }
  if (!response.ok) {
    throw new ClientError(`Revor request failed: ${body?.error?.code || `http_${response.status}`}`, {
      ...httpDetails(response, body, apiPath),
      http_status: response.status,
      method,
      base_url: config.baseUrl,
      path: apiPath,
      ...([401, 403].includes(response.status) ? { api_key_url: apiKeyUrl, config_file: persistentConfigFile } : {}),
    })
  }
  return body
}

function emitProgress(item) {
  const progress = item?.progress || {}
  process.stderr.write(`${JSON.stringify({
    event: "webset_progress",
    webset_id: item?.id || null,
    status: item?.status || null,
    stage: progress.stage || item?.status || null,
    goal: progress.goal ?? null,
    verified: progress.verified ?? null,
    qualified: progress.qualified ?? null,
    full: progress.full ?? null,
    stop_reason: progress.stop_reason ?? null,
  })}\n`)
}

function websetFailure(item) {
  const status = String(item?.status || "")
  const code = String(item?.failure?.code || "webset_failed")
  if (status === "cancelled") return { error_kind: "webset_cancelled", retryable: false, recommended_action: "report_cancellation" }
  if (/insufficient.credits/i.test(code)) return { error_kind: "insufficient_credits", retryable: false, recommended_action: "add_credits_then_retry" }
  if (/timeout|temporar|worker.unavailable|schedule.failed/i.test(code)) return { error_kind: "temporary_webset_failure", retryable: true, recommended_action: "retry_resume_once" }
  return { error_kind: "webset_failed", retryable: false, recommended_action: "report_exact_error_and_ask_user" }
}

async function readAllQualifiedItems(config, websetId, options) {
  const readOptions = itemReadOptions(options)
  const items = []
  const seenIds = new Set()
  const seenCursors = new Set()
  let cursor = ""
  while (true) {
    const search = new URLSearchParams({
      limit: String(readOptions.pageSize),
      match: "qualified",
      detail: readOptions.detail,
    })
    if (cursor) search.set("cursor", cursor)
    const body = await requestJson(config, `/api/v2/websets/${encodeURIComponent(websetId)}/items?${search}`)
    if (body?.detail !== readOptions.detail) {
      throw new ClientError("Webset items response used an unexpected detail mode", {
        error_kind: "invalid_response",
        retryable: false,
        recommended_action: "report_exact_error_and_ask_user",
        webset_id: websetId,
        expected_detail: readOptions.detail,
        actual_detail: body?.detail ?? null,
      })
    }
    for (const item of Array.isArray(body?.items) ? body.items : []) {
      const id = String(item?.id || "").trim()
      const match = String(item?.match?.status || "").trim()
      if (!id) throw new ClientError("A Webset result is missing its ID", { error_kind: "invalid_response", retryable: false, recommended_action: "report_exact_error_and_ask_user", webset_id: websetId })
      if (seenIds.has(id)) throw new ClientError("Webset pagination returned a duplicate item", { error_kind: "invalid_response", retryable: false, recommended_action: "report_exact_error_and_ask_user", webset_id: websetId, item_id: id })
      if (match !== "full" && match !== "partial") throw new ClientError("Qualified results contained an invalid match status", { error_kind: "invalid_response", retryable: false, recommended_action: "report_exact_error_and_ask_user", webset_id: websetId, item_id: id, match_status: match || null })
      if (item?.provisional !== false) throw new ClientError("Completed Webset returned a provisional result", { error_kind: "invalid_response", retryable: true, recommended_action: "retry_resume_once", webset_id: websetId, item_id: id })
      seenIds.add(id)
      items.push(item)
    }
    if (!body?.has_more) break
    const nextCursor = String(body?.next_cursor || "").trim()
    if (!nextCursor || seenCursors.has(nextCursor)) throw new ClientError("Webset pagination cursor is missing or repeated", { error_kind: "invalid_response", retryable: false, recommended_action: "report_exact_error_and_ask_user", webset_id: websetId })
    seenCursors.add(nextCursor)
    cursor = nextCursor
  }
  return { items, itemDetail: readOptions.detail, pageSize: readOptions.pageSize }
}

async function waitForWebset(config, websetId, options) {
  const pollMs = integer(options, "poll-seconds", 5, 2, 30) * 1_000
  const timeoutMs = integer(options, "timeout-minutes", 30, 1, 60) * 60_000
  const deadline = Date.now() + timeoutMs
  let lastProgress = ""
  while (Date.now() < deadline) {
    const detail = await requestJson(config, `/api/v2/websets/${encodeURIComponent(websetId)}`)
    const item = detail?.item
    if (!item?.id) throw new ClientError("Revor Webset response did not contain item.id", { error_kind: "invalid_response", retryable: false, recommended_action: "report_exact_error_and_ask_user", webset_id: websetId })
    const progressState = JSON.stringify([item.status, item.progress])
    if (progressState !== lastProgress) {
      lastProgress = progressState
      emitProgress(item)
    }
    if (item.status === "completed") {
      const itemPage = await readAllQualifiedItems(config, websetId, options)
      return { detail: item, ...itemPage }
    }
    if (terminalStatuses.has(String(item.status || ""))) {
      throw new ClientError(`Webset ended with status ${item.status}`, {
        ...websetFailure(item),
        webset_id: websetId,
        failure_code: item?.failure?.code || null,
      })
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }
  throw new ClientError("Webset polling timed out", {
    error_kind: "webset_timeout",
    retryable: true,
    recommended_action: "resume_with_webset_id",
    webset_id: websetId,
  })
}

function completedOutput(websetId, result) {
  return {
    ok: true,
    webset_id: websetId,
    status: result.detail.status,
    query: result.detail.query ?? null,
    title: result.detail.name ?? null,
    progress: result.detail.progress ?? null,
    criteria: result.detail.criteria ?? [],
    item_detail: result.itemDetail,
    page_size: result.pageSize,
    result_count: result.items.length,
    matches: {
      full: result.items.filter((item) => item?.match?.status === "full").length,
      partial: result.items.filter((item) => item?.match?.status === "partial").length,
    },
    items: result.items,
  }
}

async function runConfig(config) {
  if (!config.apiKey) {
    process.stdout.write(`${JSON.stringify({
      ok: false,
      ready: false,
      base_url: config.baseUrl,
      api_key_configured: false,
      api_key_source: "missing",
      base_url_source: config.diagnostics.baseUrlSource,
      api_key_url: apiKeyUrl,
      config_file: persistentConfigFile,
      config_file_exists: config.diagnostics.persistentConfigFileExists,
      next_action: `Create a key at ${apiKeyUrl}, send it to the agent in this private conversation, and ask the agent to save it to ${persistentConfigFile}.`,
    }, null, 2)}\n`)
    process.exitCode = 2
    return
  }
  const credits = await requestJson(config, "/api/v2/credits")
  process.stdout.write(`${JSON.stringify({
    ok: true,
    ready: true,
    base_url: config.baseUrl,
    api_key_configured: true,
    api_key_verified: true,
    api_key_source: config.diagnostics.apiKeySource,
    base_url_source: config.diagnostics.baseUrlSource,
    available_credits: credits?.available_credits ?? credits?.item?.available_credits ?? null,
    api_key_url: apiKeyUrl,
    config_file: persistentConfigFile,
    config_file_exists: config.diagnostics.persistentConfigFileExists,
    skill_env_file: skillConfigFile,
    skill_env_file_exists: config.diagnostics.skillConfigFileExists,
    next_action: "Configuration is verified. Run one search command.",
  }, null, 2)}\n`)
}

async function runSearch(config, options) {
  // 在创建计费 Webset 前验证读取参数，避免挖掘完成后才暴露确定性的 CLI 错误。
  itemReadOptions(options)
  const payload = createPayload(options)
  const idempotencyKey = option(options, "idempotency-key", defaultIdempotencyKey(payload))
  let created
  try {
    created = await requestJson(config, "/api/v2/websets", {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(payload),
    })
  } catch (error) {
    if (error instanceof ClientError) error.details.idempotency_key = idempotencyKey
    throw error
  }
  const websetId = String(created?.webset?.id || "").trim()
  if (!websetId) throw new ClientError("Revor create response did not contain webset.id", { error_kind: "invalid_response", retryable: false, recommended_action: "report_exact_error_and_ask_user" })
  process.stderr.write(`${JSON.stringify({ event: "webset_created", webset_id: websetId, status: created?.webset?.status || null })}\n`)
  const result = await waitForWebset(config, websetId, options)
  process.stdout.write(`${JSON.stringify(completedOutput(websetId, result), null, 2)}\n`)
}

async function runResume(config, options) {
  itemReadOptions(options)
  const websetId = required(options, "webset-id")
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(websetId)) throw new Error("--webset-id must be a UUID")
  const result = await waitForWebset(config, websetId, options)
  process.stdout.write(`${JSON.stringify(completedOutput(websetId, result), null, 2)}\n`)
}

async function main() {
  const operation = String(process.argv[2] || "").trim()
  const options = parseOptions(process.argv.slice(3))
  const config = loadConfig()
  if (operation === "config") return runConfig(config)
  if (!config.apiKey) {
    throw new ClientError("REVOR_API_KEY is missing", {
      error_kind: "missing_api_key",
      retryable: false,
      recommended_action: "create_key_send_to_agent_configure_then_retry",
      api_key_url: apiKeyUrl,
      config_file: persistentConfigFile,
    })
  }
  if (operation === "search") return runSearch(config, options)
  if (operation === "resume") return runResume(config, options)
  throw new Error("Operation must be config, search, or resume")
}

main().catch((error) => {
  const message = String(error?.message || error)
  const commandError = /^(Missing --|Unexpected argument:|Operation must)| must be | must be at most /i.test(message)
  process.stderr.write(`${JSON.stringify({
    ok: false,
    error: message,
    ...(error?.details || {
      error_kind: commandError ? "invalid_command" : "unknown_error",
      retryable: false,
      recommended_action: commandError ? "correct_command_then_retry" : "report_exact_error_and_ask_user",
    }),
  }, null, 2)}\n`)
  process.exitCode = 1
})
