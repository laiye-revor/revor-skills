#!/usr/bin/env node

import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const terminalStatuses = new Set(["succeeded", "failed", "cancelled"])
const skillDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

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
  const persistent = parseEnvFile(path.join(os.homedir(), ".config", "RevorSkill", ".env"))
  const local = parseEnvFile(path.join(skillDir, ".env"))
  const apiKey = String(persistent.REVOR_API_KEY || process.env.REVOR_API_KEY || local.REVOR_API_KEY || "").trim()
  const baseUrl = String(
    persistent.REVOR_BASE_URL
      || process.env.REVOR_BASE_URL
      || local.REVOR_BASE_URL
      || "https://revor.ai",
  ).trim().replace(/\/$/, "")
  if (!/^https?:\/\/[^\s]+$/i.test(baseUrl)) throw new Error("REVOR_BASE_URL is invalid")
  return { apiKey, baseUrl }
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
  const value = Number.parseInt(one(options, name), 10)
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
}

function required(options, name) {
  const value = one(options, name)
  if (!value) throw new Error(`Missing --${name}`)
  return value
}

function customsPayload(options) {
  const role = one(options, "company-role", "importer")
  if (role !== "importer" && role !== "exporter") throw new Error("--company-role must be importer or exporter")
  return {
    company_name: required(options, "company-name"),
    company_role: role,
    start_date: required(options, "start-date"),
    end_date: required(options, "end-date"),
    page: integer(options, "page", 1, 1, 1_000),
    page_size: integer(options, "page-size", 10, 1, 20),
    period_unit: one(options, "period-unit", "months"),
    filters: {},
  }
}

function operationRequest(operation, options) {
  if (operation === "public-web") {
    const queries = many(options, "query")
    if (!queries.length || queries.length > 2) throw new Error("public-web requires one or two --query values")
    return {
      path: "/api/v2/research/public-web",
      payload: {
        queries,
        search_limit: integer(options, "search-limit", 5, 1, 10),
        ...(one(options, "category") ? { category: one(options, "category") } : {}),
        ...(one(options, "include-domains")
          ? { include_domains: one(options, "include-domains").split(",").map((item) => item.trim()).filter(Boolean) }
          : {}),
        ...(one(options, "user-location") ? { user_location: one(options, "user-location") } : {}),
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
    return {
      path: "/api/v2/customs/company-candidates",
      payload: {
        company_name: required(options, "company-name"),
        start_date: required(options, "start-date"),
        end_date: required(options, "end-date"),
        page: integer(options, "page", 1, 1, 1_000),
        page_size: integer(options, "page-size", 20, 1, 20),
        ...(one(options, "country-codes") ? { country_codes: one(options, "country-codes") } : {}),
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
  const response = await fetch(`${config.baseUrl}${apiPath}`, {
    ...init,
    signal: AbortSignal.timeout(35_000),
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  })
  const raw = await response.text()
  let body
  try {
    body = raw ? JSON.parse(raw) : null
  } catch {
    throw new Error(`Revor returned non-JSON HTTP ${response.status}`)
  }
  if (!response.ok) {
    const code = body?.error?.code || `http_${response.status}`
    throw new Error(`Revor request failed: ${code}`)
  }
  return body
}

async function runJob(config, operation, request, options) {
  const idempotencyKey = `revor-skill-${operation}-${crypto.randomUUID()}`
  const initial = await requestJson(config, request.path, {
    method: "POST",
    headers: {
      "Idempotency-Key": idempotencyKey,
      Prefer: "wait=20",
    },
    body: JSON.stringify(request.payload),
  })
  let item = initial?.item
  if (!item?.id) throw new Error("Revor response did not contain item.id")

  const pollIntervalMs = integer(options, "poll-interval-ms", 2_000, 500, 30_000)
  const pollTimeoutMs = integer(options, "poll-timeout-ms", 180_000, 5_000, 30 * 60_000)
  const deadline = Date.now() + pollTimeoutMs
  while (!terminalStatuses.has(String(item.status || "")) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
    const current = await requestJson(config, `/api/v2/jobs/${encodeURIComponent(item.id)}`)
    item = current?.item
    if (!item?.id) throw new Error("Revor job response did not contain item.id")
  }
  if (!terminalStatuses.has(String(item.status || ""))) {
    throw new Error(`Revor job timed out: ${item.id}`)
  }

  const output = {
    ok: item.status === "succeeded",
    job_id: item.id,
    action: item.action,
    status: item.status,
    result: item.result ?? null,
    error: item.error ?? null,
    billing: item.billing ?? null,
  }
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
  if (!output.ok) process.exitCode = 2
}

async function main() {
  const operation = String(process.argv[2] || "").trim()
  const options = parseOptions(process.argv.slice(3))
  const config = loadConfig()
  if (operation === "config") {
    process.stdout.write(`${JSON.stringify({
      base_url: config.baseUrl,
      api_key_configured: Boolean(config.apiKey),
      config_file: path.join(os.homedir(), ".config", "RevorSkill", ".env"),
    }, null, 2)}\n`)
    return
  }
  if (!config.apiKey) throw new Error("REVOR_API_KEY is missing; configure ~/.config/RevorSkill/.env")
  await runJob(config, operation, operationRequest(operation, options), options)
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ ok: false, error: String(error?.message || error) })}\n`)
  process.exitCode = 1
})
