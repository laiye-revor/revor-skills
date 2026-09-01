import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { after, before, test } from "node:test"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const repoDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const tempHome = path.join(os.tmpdir(), `revor-skills-test-${process.pid}`)
const requests = []
let server
let baseUrl

function json(response, body) {
  response.writeHead(200, { "content-type": "application/json" })
  response.end(JSON.stringify(body))
}

before(async () => {
  server = http.createServer(async (request, response) => {
    let body = ""
    for await (const chunk of request) body += chunk
    requests.push({
      method: request.method,
      url: request.url,
      idempotencyKey: request.headers["idempotency-key"] || null,
      body: body ? JSON.parse(body) : null,
    })

    if (request.url === "/api/v2/credits") return json(response, { available_credits: 123 })
    if (request.method === "POST" && request.url === "/api/v2/research/public-web") {
      return json(response, { item: { id: "job-research", action: "research.public_web", status: "succeeded", result: { status: "complete", results: [] } } })
    }
    if (request.method === "POST" && request.url === "/api/v2/research/contacts") {
      return json(response, { item: { id: "job-contacts", action: "research.contacts", status: "succeeded", result: { status: "no_result", contacts: [] } } })
    }
    if (request.method === "POST" && request.url === "/api/v2/customs/company-candidates") {
      return json(response, {
        item: {
          id: "job-candidates",
          action: "customs.trade.company_candidates",
          status: "succeeded",
          result: {
            routing_evidence: { company_role: "exporter", catalogs_checked: ["imports"] },
            candidates: [],
          },
        },
      })
    }
    if (request.method === "POST" && request.url === "/api/v2/websets") {
      return json(response, { webset: { id: "00000000-0000-4000-8000-000000000001", status: "searching" } })
    }
    if (request.url === "/api/v2/websets/00000000-0000-4000-8000-000000000001") {
      return json(response, { item: { id: "00000000-0000-4000-8000-000000000001", status: "completed", title: "Test Webset", query: "test", criteria: [], progress: {} } })
    }
    if (request.url?.startsWith("/api/v2/websets/00000000-0000-4000-8000-000000000001/items?")) {
      return json(response, { detail: "standard", items: [{ id: "item-1", match: { status: "full" } }], has_more: false, next_cursor: null })
    }
    response.writeHead(404, { "content-type": "application/json" })
    response.end(JSON.stringify({ error: { code: "endpoint_not_found" } }))
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
})

async function client(relativeScript, args) {
  const script = path.join(repoDir, relativeScript)
  const result = await execFileAsync(process.execPath, [script, ...args], {
    cwd: repoDir,
    env: {
      ...process.env,
      HOME: tempHome,
      USERPROFILE: tempHome,
      REVOR_API_KEY: "sk-revor-test",
      REVOR_BASE_URL: baseUrl,
    },
  })
  return JSON.parse(result.stdout)
}

test("research and contact config verify the key through the credits endpoint", async () => {
  const research = await client("skills/revor-company-research/scripts/revor-api.mjs", ["config"])
  const contacts = await client("skills/revor-contact-search/scripts/revor-contacts.mjs", ["config"])
  assert.equal(research.api_key_verified, true)
  assert.equal(research.available_credits, 123)
  assert.equal(contacts.api_key_verified, true)
  assert.equal(contacts.available_credits, 123)
})

test("identical research and contact commands reuse stable default idempotency keys", async () => {
  const researchArgs = ["public-web", "--query", "Example Inc"]
  const researchA = await client("skills/revor-company-research/scripts/revor-api.mjs", researchArgs)
  const researchB = await client("skills/revor-company-research/scripts/revor-api.mjs", researchArgs)
  assert.equal(researchA.idempotency_key, researchB.idempotency_key)

  const contactArgs = ["search", "--domain", "example.com"]
  const contactsA = await client("skills/revor-contact-search/scripts/revor-contacts.mjs", contactArgs)
  const contactsB = await client("skills/revor-contact-search/scripts/revor-contacts.mjs", contactArgs)
  assert.equal(contactsA.idempotency_key, contactsB.idempotency_key)

  const executing = requests.filter((request) => request.method === "POST" && request.idempotencyKey)
  assert.equal(executing[0].idempotencyKey, executing[1].idempotencyKey)
  assert.equal(executing[2].idempotencyKey, executing[3].idempotencyKey)
})

test("completed Webset items may omit provisional when none are provisional", async () => {
  const output = await client("skills/revor-company-discovery/scripts/revor-websets.mjs", [
    "search",
    "--query", "Example manufacturers",
    "--poll-seconds", "2",
  ])
  assert.equal(output.ok, true)
  assert.equal(output.title, "Test Webset")
  assert.equal(output.result_count, 1)
})

test("company-candidates validates top-level routing evidence and selects one explicit catalog", async () => {
  const output = await client("skills/revor-company-research/scripts/revor-api.mjs", [
    "company-candidates",
    "--company-name", "Example Inc",
    "--company-role", "exporter",
    "--catalog", "imports",
    "--compare-catalogs", "false",
    "--start-date", "2025-09-01",
    "--end-date", "2026-08-31",
  ])
  assert.equal(output.ok, true)
  assert.equal(output.warning, undefined)
  const request = requests.find((entry) => entry.url === "/api/v2/customs/company-candidates")
  assert.equal(request.body.compare_catalogs, false)
})
