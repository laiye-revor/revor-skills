#!/usr/bin/env node

import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const terminalStatuses = new Set(["succeeded", "failed", "cancelled"])
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
    })
  }
  return {
    apiKey: key.value,
    baseUrl,
    diagnostics: {
      ready: Boolean(key.value),
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

function payload(options) {
  const locale = option(options, "locale", "en").toLowerCase()
  if (locale !== "en" && locale !== "zh") throw new Error("--locale must be en or zh")
  const positions = option(options, "positions").split("|").map((item) => item.trim()).filter(Boolean)
  return {
    domain: required(options, "domain"),
    ...(positions.length ? { positions } : {}),
    limit: integer(options, "limit", 20, 1, 50),
    locale,
  }
}

function httpDetails(response, body) {
  const status = response.status
  const apiCode = body?.error?.code || `http_${status}`
  if (apiCode.includes("job_concurrency_limit_exceeded")) return { error_kind: "job_concurrency_limit", api_code: apiCode, retryable: true, retry_after: response.headers.get("retry-after") || null, recommended_action: "wait_for_active_jobs_then_retry_same_command" }
  if (apiCode === "membership_tier_insufficient") return { error_kind: "membership_tier_insufficient", api_code: apiCode, retryable: false, recommended_action: "upgrade_membership_then_retry" }
  if (status === 401) return { error_kind: "authentication_failed", api_code: apiCode, retryable: false, recommended_action: "update_api_key_rerun_config_then_retry" }
  if (status === 403) return { error_kind: "permission_denied", api_code: apiCode, retryable: false, recommended_action: "update_api_key_permissions_then_retry" }
  if (status === 404 && String(apiCode).includes("task_not_found")) return { error_kind: "task_not_found", api_code: apiCode, retryable: false, recommended_action: "check_job_id_and_resource_owner" }
  if (status === 404 && String(apiCode).includes("webset_not_found")) return { error_kind: "webset_not_found", api_code: apiCode, retryable: false, recommended_action: "check_webset_id_and_resource_owner" }
  if (status === 404) return { error_kind: "endpoint_not_found", api_code: apiCode, retryable: false, recommended_action: "confirm_base_url_rerun_config_then_retry" }
  if (status === 400 || status === 422) return { error_kind: "invalid_request", api_code: apiCode, retryable: false, recommended_action: "correct_request_then_retry" }
  // 兼容仍可能由旧部署返回的 v1 错误码。
  if (apiCode === "insufficient_credits" || apiCode === "USER_INSUFFICIENT_CREDITS") return { error_kind: "insufficient_credits", api_code: apiCode, retryable: false, recommended_action: "add_credits_then_retry" }
  if (status === 408 || status === 429 || status >= 500) {
    return {
      error_kind: status === 429 ? "rate_limited" : status >= 500 ? "service_unavailable" : "request_timeout",
      api_code: apiCode,
      retryable: true,
      retry_after: response.headers.get("retry-after") || null,
      recommended_action: "retry_same_command_once",
    }
  }
  return { error_kind: "http_error", api_code: apiCode, retryable: false, recommended_action: "report_exact_error_and_ask_user" }
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
      ...httpDetails(response, body),
      http_status: response.status,
      method,
      base_url: config.baseUrl,
      path: apiPath,
      ...([401, 403].includes(response.status) ? { api_key_url: apiKeyUrl, config_file: persistentConfigFile } : {}),
    })
  }
  return body
}

function failedJobDetails(item) {
  if (item.status === "cancelled") return { error_kind: "job_cancelled", retryable: false, recommended_action: "report_cancellation" }
  const code = String(item.error?.code || "")
  if (code === "insufficient_credits" || code === "USER_INSUFFICIENT_CREDITS") return { error_kind: "insufficient_credits", retryable: false, recommended_action: "add_credits_then_retry" }
  if (item.error?.retryable === true || /retryable|timeout|temporar|worker_unavailable/i.test(code)) return { error_kind: "temporary_job_failure", retryable: true, recommended_action: "retry_same_command_once" }
  return { error_kind: "job_failed", retryable: false, recommended_action: "report_exact_error_and_ask_user" }
}

async function runSearch(config, options) {
  const requestPayload = payload(options)
  const date = new Date().toISOString().slice(0, 10)
  const digest = crypto.createHash("sha256").update(JSON.stringify(requestPayload)).digest("hex").slice(0, 24)
  const idempotencyKey = option(options, "idempotency-key", `revor-contact-search-${date}-${digest}`)
  let initial
  try {
    initial = await requestJson(config, "/api/v2/research/contacts", {
      method: "POST",
      headers: {
        "Idempotency-Key": idempotencyKey,
        Prefer: "wait=20",
      },
      body: JSON.stringify(requestPayload),
    })
  } catch (error) {
    if (error instanceof ClientError) error.details.idempotency_key = idempotencyKey
    throw error
  }
  let item = initial?.item
  if (!item?.id) throw new ClientError("Revor response did not contain item.id", {
    error_kind: "invalid_response",
    retryable: false,
    recommended_action: "report_exact_error_and_ask_user",
    idempotency_key: idempotencyKey,
  })
  const deadline = Date.now() + 180_000
  while (!terminalStatuses.has(String(item.status || "")) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2_000))
    try {
      item = (await requestJson(config, `/api/v2/jobs/${encodeURIComponent(item.id)}`))?.item
    } catch (error) {
      if (error instanceof ClientError) error.details.idempotency_key = idempotencyKey
      throw error
    }
    if (!item?.id) throw new ClientError("Revor job response did not contain item.id", {
      error_kind: "invalid_response",
      retryable: false,
      recommended_action: "report_exact_error_and_ask_user",
      idempotency_key: idempotencyKey,
    })
  }
  if (!terminalStatuses.has(String(item.status || ""))) {
    throw new ClientError("Revor contact job timed out", {
      error_kind: "job_timeout",
      retryable: true,
      recommended_action: "retry_same_command_once",
      job_id: item.id,
      idempotency_key: idempotencyKey,
    })
  }
  const output = {
    ok: item.status === "succeeded",
    idempotency_key: idempotencyKey,
    job_id: item.id,
    status: item.status,
    result: item.result ?? null,
    error: item.error ?? null,
    billing: item.billing ?? null,
    ...(item.status === "succeeded" ? {} : failedJobDetails(item)),
  }
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
  if (!output.ok) process.exitCode = 2
}

async function main() {
  const operation = String(process.argv[2] || "").trim()
  const options = parseOptions(process.argv.slice(3))
  const config = loadConfig()
  if (operation === "config") {
    if (!config.apiKey) {
      process.stdout.write(`${JSON.stringify({
        ok: false,
        ready: false,
        base_url: config.baseUrl,
        api_key_configured: false,
        api_key_verified: false,
        api_key_source: config.diagnostics.apiKeySource,
        base_url_source: config.diagnostics.baseUrlSource,
        api_key_url: apiKeyUrl,
        config_file: persistentConfigFile,
        config_file_exists: config.diagnostics.persistentConfigFileExists,
        skill_env_file: skillConfigFile,
        skill_env_file_exists: config.diagnostics.skillConfigFileExists,
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
      available_credits: credits?.available_credits ?? credits?.item?.available_credits ?? null,
      api_key_source: config.diagnostics.apiKeySource,
      base_url_source: config.diagnostics.baseUrlSource,
      api_key_url: apiKeyUrl,
      config_file: persistentConfigFile,
      config_file_exists: config.diagnostics.persistentConfigFileExists,
      skill_env_file: skillConfigFile,
      skill_env_file_exists: config.diagnostics.skillConfigFileExists,
      next_action: "Configuration is verified.",
    }, null, 2)}\n`)
    return
  }
  if (operation !== "search") throw new Error("Operation must be config or search")
  if (!config.apiKey) {
    throw new ClientError("REVOR_API_KEY is missing", {
      error_kind: "missing_api_key",
      retryable: false,
      recommended_action: "create_key_send_to_agent_configure_then_retry",
      api_key_url: apiKeyUrl,
      config_file: persistentConfigFile,
    })
  }
  await runSearch(config, options)
}

main().catch((error) => {
  const message = String(error?.message || error)
  const commandError = /^(Missing --|Unexpected argument:|Operation must)| must be /i.test(message)
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
