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
const apiKeyManagementUrl = "https://revor.ai/zh/my-api-keys"

class RevorClientError extends Error {
  constructor(message, details = {}) {
    super(message)
    this.name = "RevorClientError"
    this.details = details
  }
}

function httpFailureDetails(status, body, response) {
  const apiCode = body?.error?.code || `http_${status}`
  // 兼容仍可能由旧部署返回的 v1 错误码。
  if (apiCode === "insufficient_credits" || apiCode === "USER_INSUFFICIENT_CREDITS") {
    return { error_kind: "insufficient_credits", api_code: apiCode, retryable: false, recommended_action: "add_credits_then_retry_failed_command" }
  }
  if (apiCode.includes("job_concurrency_limit_exceeded")) {
    return {
      error_kind: "job_concurrency_limit",
      api_code: apiCode,
      retryable: true,
      retry_after: response.headers.get("retry-after") || null,
      recommended_action: "wait_for_active_jobs_then_retry_failed_command",
    }
  }
  if (apiCode === "membership_tier_insufficient") {
    return { error_kind: "membership_tier_insufficient", api_code: apiCode, retryable: false, recommended_action: "upgrade_membership_then_retry_failed_command" }
  }
  if (status === 400 || status === 422) {
    return { error_kind: "invalid_request", api_code: apiCode, retryable: false, recommended_action: "correct_request_arguments_then_retry" }
  }
  if (status === 401) {
    return { error_kind: "authentication_failed", api_code: apiCode, retryable: false, recommended_action: "update_api_key_rerun_config_then_retry_failed_command" }
  }
  if (status === 403) {
    return { error_kind: "permission_denied", api_code: apiCode, retryable: false, recommended_action: "update_api_key_permissions_then_retry_failed_command" }
  }
  if (status === 404) {
    if (String(apiCode).includes("task_not_found")) {
      return { error_kind: "task_not_found", api_code: apiCode, retryable: false, recommended_action: "check_job_id_and_resource_owner" }
    }
    if (String(apiCode).includes("webset_not_found")) {
      return { error_kind: "webset_not_found", api_code: apiCode, retryable: false, recommended_action: "check_webset_id_and_resource_owner" }
    }
    return { error_kind: "endpoint_not_found", api_code: apiCode, retryable: false, recommended_action: "confirm_base_url_rerun_config_then_retry_failed_command" }
  }
  if (status === 408) {
    return { error_kind: "request_timeout", api_code: apiCode, retryable: true, recommended_action: "retry_same_command_once" }
  }
  if (status === 429) {
    return {
      error_kind: "rate_limited",
      api_code: apiCode,
      retryable: true,
      retry_after: response.headers.get("retry-after") || null,
      recommended_action: "wait_retry_after_then_retry_same_command_once",
    }
  }
  if (status >= 500) {
    return { error_kind: "service_unavailable", api_code: apiCode, retryable: true, recommended_action: "retry_same_command_once" }
  }
  return { error_kind: "http_error", api_code: apiCode, retryable: false, recommended_action: "report_exact_error_and_ask_user" }
}

function jobFailureDetails(item) {
  if (item.status === "cancelled") {
    return { error_kind: "job_cancelled", retryable: false, recommended_action: "report_cancellation" }
  }
  const code = String(item.error?.code || "")
  if (code === "insufficient_credits" || code === "USER_INSUFFICIENT_CREDITS") {
    return { error_kind: "insufficient_credits", retryable: false, recommended_action: "add_credits_then_retry_failed_command" }
  }
  if (
    item.error?.retryable === true
    ||
    code === "external_api_billing_retryable"
    || code === "external_api_research_provider_retryable"
    || code === "external_api_worker_unavailable"
    || code === "external_api_retry_enqueue_failed"
    || /retryable|timeout|temporar/i.test(code)
  ) {
    return { error_kind: "temporary_job_failure", retryable: true, recommended_action: "retry_same_command_once" }
  }
  return { error_kind: "job_failed", retryable: false, recommended_action: "report_exact_error_and_ask_user" }
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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    values[match[1]] = value
  }
  return values
}

function loadConfig() {
  const persistent = parseEnvFile(persistentConfigFile)
  const local = parseEnvFile(skillConfigFile)
  const firstConfigured = (entries, fallback = "") => {
    for (const [source, rawValue] of entries) {
      const value = String(rawValue || "").trim()
      if (value) return { source, value }
    }
    return { source: "default", value: fallback }
  }
  const apiKeyConfig = firstConfigured([
    ["persistent_config_file", persistent.REVOR_API_KEY],
    ["process_environment", process.env.REVOR_API_KEY],
    ["skill_env_file", local.REVOR_API_KEY],
  ])
  const baseUrlConfig = firstConfigured([
    ["persistent_config_file", persistent.REVOR_BASE_URL],
    ["process_environment", process.env.REVOR_BASE_URL],
    ["skill_env_file", local.REVOR_BASE_URL],
  ], "https://revor.ai")
  const apiKey = apiKeyConfig.value
  const baseUrl = baseUrlConfig.value.replace(/\/$/, "")
  if (!/^https?:\/\/[^\s]+$/i.test(baseUrl)) {
    throw new RevorClientError("REVOR_BASE_URL is invalid", {
      error_kind: "invalid_configuration",
      retryable: false,
      recommended_action: "correct_base_url_then_rerun_config",
    })
  }
  return {
    apiKey,
    baseUrl,
    diagnostics: {
      ready: Boolean(apiKey),
      persistentConfigFile,
      persistentConfigFileExists: fs.existsSync(persistentConfigFile),
      skillConfigFile,
      skillConfigFileExists: fs.existsSync(skillConfigFile),
      apiKeySource: apiKey ? apiKeyConfig.source : "missing",
      baseUrlSource: baseUrlConfig.source,
      usingDefaultBaseUrl: baseUrlConfig.source === "default",
    },
  }
}

function parseOptions(argv) {
  const options = new Map()
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index]
    if (!raw.startsWith("--")) throw new Error(`Unexpected argument: ${raw}`)
    const equals = raw.indexOf("=")
    const key = raw.slice(2, equals === -1 ? undefined : equals)
    const value = equals === -1 ? argv[index + 1] : raw.slice(equals + 1)
    if (!value || (equals === -1 && value.startsWith("--"))) throw new Error(`Missing value for --${key}`)
    const existing = options.get(key) || []
    existing.push(value)
    options.set(key, existing)
    if (equals === -1) index += 1
  }
  return options
}

function one(options, name, fallback = "") {
  return String(options.get(name)?.at(-1) ?? fallback).trim()
}

function many(options, name) {
  return (options.get(name) || []).map((value) => String(value).trim()).filter(Boolean)
}

function integer(options, name, fallback, min, max) {
  const raw = one(options, name)
  if (!raw) return fallback
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`--${name} must be an integer from ${min} to ${max}`)
  }
  return value
}

function boolean(options, name, fallback = false) {
  const value = one(options, name, fallback ? "true" : "false").toLowerCase()
  if (["true", "1", "yes", "y", "on"].includes(value)) return true
  if (["false", "0", "no", "n", "off"].includes(value)) return false
  throw new Error(`--${name} must be true or false`)
}

function required(options, name) {
  const value = one(options, name)
  if (!value) throw new Error(`Missing --${name}`)
  return value
}

function boundedRequired(options, name, min, max) {
  const value = required(options, name)
  if (value.length < min || value.length > max) throw new Error(`--${name} must be ${min}-${max} characters`)
  return value
}

function customsCountryCode(options, name) {
  const value = one(options, name).toUpperCase()
  if (value && !/^[A-Z]{3}$/.test(value)) throw new Error(`--${name} must be an ISO 3166-1 alpha-3 country code`)
  return value
}

function countryCodes(options) {
  const values = one(options, "country-codes")
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean)
  if (values.some((value) => !/^[A-Z]{3}$/.test(value))) {
    throw new Error("--country-codes must contain comma-separated ISO 3166-1 alpha-3 country codes")
  }
  return [...new Set(values)].join(",")
}

function customsFilters(options) {
  const originCountryCode = customsCountryCode(options, "origin-country-code")
  const destinationCountryCode = customsCountryCode(options, "destination-country-code")
  return {
    ...(one(options, "hs-code") ? { hs_code: one(options, "hs-code") } : {}),
    ...(one(options, "product-description") ? { product_description: one(options, "product-description") } : {}),
    ...(originCountryCode ? { origin_country_code: originCountryCode } : {}),
    ...(destinationCountryCode ? { destination_country_code: destinationCountryCode } : {}),
  }
}

function customsPayload(options) {
  const role = one(options, "company-role", "importer")
  if (role !== "importer" && role !== "exporter") throw new Error("--company-role must be importer or exporter")
  const catalog = one(options, "catalog", role === "exporter" ? "exports" : "imports")
  if (catalog !== "imports" && catalog !== "exports") throw new Error("--catalog must be imports or exports")
  return {
    company_name: boundedRequired(options, "company-name", 2, 300),
    company_role: role,
    catalog,
    start_date: required(options, "start-date"),
    end_date: required(options, "end-date"),
    page: integer(options, "page", 1, 1, 1_000),
    page_size: integer(options, "page-size", 10, 1, 20),
    period_unit: one(options, "period-unit", "months"),
    filters: customsFilters(options),
  }
}

export function operationRequest(operation, options) {
  if (operation === "public-web") {
    const queries = many(options, "query")
    if (!queries.length || queries.length > 2) throw new Error("public-web requires one or two --query values")
    return {
      path: "/api/v2/research/public-web",
      payload: {
        queries,
        search_limit: integer(options, "search-limit", 10, 1, 10),
        ...(one(options, "category") ? { category: one(options, "category") } : {}),
        ...(one(options, "include-domains")
          ? { include_domains: one(options, "include-domains").split(",").map((item) => item.trim()).filter(Boolean) }
          : {}),
        ...(one(options, "user-location")
          ? { user_location: (() => {
              const value = one(options, "user-location").toUpperCase()
              if (!/^[A-Z]{2}$/.test(value)) throw new Error("--user-location must be an ISO 3166-1 alpha-2 country code")
              return value
            })() }
          : {}),
      },
    }
  }
  if (operation === "contacts") {
    return {
      path: "/api/v2/research/contacts",
      payload: {
        domain: required(options, "domain"),
        ...(one(options, "positions")
          ? { positions: one(options, "positions").split("|").map((item) => item.trim()).filter(Boolean) }
          : {}),
        limit: integer(options, "limit", 20, 1, 50),
        locale: one(options, "locale", "en"),
      },
    }
  }
  if (operation === "company-candidates") {
    const role = one(options, "company-role")
    if (role && role !== "importer" && role !== "exporter") throw new Error("--company-role must be importer or exporter")
    const catalog = one(options, "catalog")
    if (catalog && catalog !== "imports" && catalog !== "exports") throw new Error("--catalog must be imports or exports")
    const compareCatalogs = boolean(options, "compare-catalogs", Boolean(role))
    if (compareCatalogs && !role) throw new Error("--compare-catalogs requires --company-role")
    const candidateCountryCodes = countryCodes(options)
    return {
      path: "/api/v2/customs/company-candidates",
      payload: {
        company_name: boundedRequired(options, "company-name", 2, 300),
        ...(role ? { company_role: role } : {}),
        ...(catalog ? { catalog } : {}),
        ...(role || options.has("compare-catalogs") ? { compare_catalogs: compareCatalogs } : {}),
        start_date: required(options, "start-date"),
        end_date: required(options, "end-date"),
        page: integer(options, "page", 1, 1, 1_000),
        page_size: integer(options, "page-size", 20, 1, 20),
        ...(candidateCountryCodes ? { country_codes: candidateCountryCodes } : {}),
        filters: customsFilters(options),
      },
    }
  }
  const customsPaths = {
    "trade-report": "/api/v2/customs/trade-reports",
    counterparties: "/api/v2/customs/counterparties",
    categories: "/api/v2/customs/categories",
    trends: "/api/v2/customs/trends",
    countries: "/api/v2/customs/countries",
  }
  if (customsPaths[operation]) return { path: customsPaths[operation], payload: customsPayload(options) }
  throw new Error(`Unknown operation: ${operation}`)
}

async function requestJson(config, apiPath, init = {}) {
  const requestUrl = `${config.baseUrl}${apiPath}`
  const requestMethod = String(init.method || "GET").toUpperCase()
  let response
  try {
    response = await fetch(requestUrl, {
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
    const reason = timedOut ? "timeout" : String(error?.message || error)
    throw new RevorClientError(`Revor connection failed: ${reason}`, {
      error_kind: timedOut ? "request_timeout" : "connection_failed",
      retryable: true,
      recommended_action: "retry_same_command_once",
      method: requestMethod,
      base_url: config.baseUrl,
      path: apiPath,
    })
  }
  const raw = await response.text()
  let body
  try {
    body = raw ? JSON.parse(raw) : null
  } catch {
    throw new RevorClientError(`Revor returned non-JSON HTTP ${response.status}`, {
      error_kind: response.status >= 500 ? "service_unavailable" : "invalid_response",
      retryable: response.status >= 500,
      recommended_action: response.status >= 500 ? "retry_same_command_once" : "report_exact_error_and_ask_user",
      http_status: response.status,
      method: requestMethod,
      base_url: config.baseUrl,
      path: apiPath,
    })
  }
  if (!response.ok) {
    const details = httpFailureDetails(response.status, body, response)
    throw new RevorClientError(`Revor request failed: ${details.api_code}`, {
      ...details,
      http_status: response.status,
      method: requestMethod,
      base_url: config.baseUrl,
      path: apiPath,
      ...(response.status === 401 || response.status === 403
        ? { api_key_url: apiKeyManagementUrl, config_file: config.diagnostics.persistentConfigFile }
        : {}),
    })
  }
  return body
}

export function assertCompanyCandidateRouting(operation, request, item, config) {
  if (operation !== "company-candidates" || item.status !== "succeeded") return null
  const expectedRole = request.payload.company_role
  const expectedCatalog = request.payload.catalog
  const compareCatalogs = request.payload.compare_catalogs === true
  if (!expectedRole || (!expectedCatalog && !compareCatalogs)) return null
  const evidence = item.result?.routing_evidence
  const catalogs = Array.isArray(evidence?.catalogs_checked) ? evidence.catalogs_checked : []
  const expectedCatalogs = compareCatalogs ? ["imports", "exports"] : [expectedCatalog]
  const routingMatches = evidence
    && typeof evidence === "object"
    && evidence.company_role === expectedRole
    && (!compareCatalogs || evidence.mode === "compare_catalogs")
    && expectedCatalogs.every((catalog) => catalogs.includes(catalog))
  if (!routingMatches) {
    throw new RevorClientError("The Revor company-candidates endpoint did not honor explicit company_role/catalog routing", {
      error_kind: "endpoint_contract_mismatch",
      retryable: false,
      recommended_action: "deploy_or_select_an_api_version_that_supports_explicit_customs_routing",
      base_url: config.baseUrl,
      path: request.path,
      expected_company_role: expectedRole,
      expected_catalog: expectedCatalogs,
    })
  }
  return null
}

function defaultIdempotencyKey(operation, payload) {
  const date = new Date().toISOString().slice(0, 10)
  const digest = crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 24)
  return `revor-${operation}-${date}-${digest}`
}

async function runJob(config, operation, request, options) {
  const idempotencyKey = one(options, "idempotency-key", defaultIdempotencyKey(operation, request.payload))
  let initial
  try {
    initial = await requestJson(config, request.path, {
      method: "POST",
      headers: {
        "Idempotency-Key": idempotencyKey,
        Prefer: "wait=20",
      },
      body: JSON.stringify(request.payload),
    })
  } catch (error) {
    if (error instanceof RevorClientError) error.details.idempotency_key = idempotencyKey
    throw error
  }
  let item = initial?.item
  if (!item?.id) throw new RevorClientError("Revor response did not contain item.id", {
    error_kind: "invalid_response",
    retryable: false,
    recommended_action: "report_exact_error_and_ask_user",
    idempotency_key: idempotencyKey,
  })

  const pollIntervalMs = integer(options, "poll-interval-ms", 2_000, 500, 30_000)
  const pollTimeoutMs = integer(options, "poll-timeout-ms", 180_000, 5_000, 30 * 60_000)
  const deadline = Date.now() + pollTimeoutMs
  while (!terminalStatuses.has(String(item.status || "")) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
    let current
    try {
      current = await requestJson(config, `/api/v2/jobs/${encodeURIComponent(item.id)}`)
    } catch (error) {
      if (error instanceof RevorClientError) error.details.idempotency_key = idempotencyKey
      throw error
    }
    item = current?.item
    if (!item?.id) throw new RevorClientError("Revor job response did not contain item.id", {
      error_kind: "invalid_response",
      retryable: false,
      recommended_action: "report_exact_error_and_ask_user",
      idempotency_key: idempotencyKey,
    })
  }
  if (!terminalStatuses.has(String(item.status || ""))) {
    throw new RevorClientError(`Revor job timed out: ${item.id}`, {
      error_kind: "job_timeout",
      retryable: true,
      recommended_action: "retry_same_command_once",
      job_id: item.id,
      idempotency_key: idempotencyKey,
    })
  }
  let warning
  try {
    warning = assertCompanyCandidateRouting(operation, request, item, config)
  } catch (error) {
    if (error instanceof RevorClientError) error.details.idempotency_key = idempotencyKey
    throw error
  }

  const output = {
    ok: item.status === "succeeded",
    idempotency_key: idempotencyKey,
    job_id: item.id,
    action: item.action,
    status: item.status,
    result: item.result ?? null,
    error: item.error ?? null,
    billing: item.billing ?? null,
    ...(warning ? { warning } : {}),
    ...(item.status === "succeeded" ? {} : jobFailureDetails(item)),
  }
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
  if (!output.ok) process.exitCode = 2
}

async function main() {
  const operation = String(process.argv[2] || "").trim()
  const options = parseOptions(process.argv.slice(3))
  const config = loadConfig()
  if (operation === "config") {
    const diagnostics = config.diagnostics
    if (!config.apiKey) {
      process.stdout.write(`${JSON.stringify({
        ok: false,
        ready: false,
        base_url: config.baseUrl,
        api_key_configured: false,
        api_key_verified: false,
        api_key_source: diagnostics.apiKeySource,
        base_url_source: diagnostics.baseUrlSource,
        using_default_base_url: diagnostics.usingDefaultBaseUrl,
        api_key_url: apiKeyManagementUrl,
        config_file: diagnostics.persistentConfigFile,
        config_file_exists: diagnostics.persistentConfigFileExists,
        skill_env_file: diagnostics.skillConfigFile,
        skill_env_file_exists: diagnostics.skillConfigFileExists,
        config_precedence: ["persistent_config_file", "process_environment", "skill_env_file", "default_base_url_only"],
        next_action: `Create an API key at ${apiKeyManagementUrl}, set REVOR_API_KEY in ${diagnostics.persistentConfigFile} or in the process environment, then run config again.`,
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
      api_key_source: diagnostics.apiKeySource,
      base_url_source: diagnostics.baseUrlSource,
      using_default_base_url: diagnostics.usingDefaultBaseUrl,
      api_key_url: apiKeyManagementUrl,
      config_file: diagnostics.persistentConfigFile,
      config_file_exists: diagnostics.persistentConfigFileExists,
      skill_env_file: diagnostics.skillConfigFile,
      skill_env_file_exists: diagnostics.skillConfigFileExists,
      config_precedence: ["persistent_config_file", "process_environment", "skill_env_file", "default_base_url_only"],
      next_action: "Configuration is verified. Use this exact base_url for all Revor calls in this task.",
    }, null, 2)}\n`)
    return
  }
  if (!config.apiKey) {
    throw new RevorClientError("REVOR_API_KEY is missing", {
      error_kind: "missing_api_key",
      retryable: false,
      recommended_action: "create_api_key_save_to_config_rerun_config_then_retry_failed_command",
      api_key_url: apiKeyManagementUrl,
      config_file: config.diagnostics.persistentConfigFile,
    })
  }
  await runJob(config, operation, operationRequest(operation, options), options)
}

function reportFatalError(error) {
  const message = String(error?.message || error)
  const commandError = /^(Missing --|Unexpected argument:|Unknown operation:)| requires | must be /i.test(message)
  const details = error?.details || {
    error_kind: commandError ? "invalid_command" : "unknown_error",
    retryable: false,
    recommended_action: commandError ? "correct_command_arguments_then_retry" : "report_exact_error_and_ask_user",
  }
  process.stderr.write(`${JSON.stringify({
    ok: false,
    error: message,
    ...details,
  }, null, 2)}\n`)
  process.exitCode = 1
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  main().catch(reportFatalError)
}
