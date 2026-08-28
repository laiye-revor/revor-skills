import assert from "node:assert/strict"
import test from "node:test"

import {
  assertCompanyCandidateRouting,
  operationRequest,
} from "./revor-api.mjs"

function options(input) {
  return new Map(Object.entries(input).map(([key, value]) => [key, [String(value)]]))
}

test("company candidates forwards exact filters and opt-in catalog comparison", () => {
  const request = operationRequest("company-candidates", options({
    "company-name": "ZHENGZHOU LP INDUSTRY CO., LTD.",
    "company-role": "exporter",
    "compare-catalogs": "true",
    "hs-code": "854419",
    "origin-country-code": "chn",
    "start-date": "2025-08-28",
    "end-date": "2026-08-28",
  }))

  assert.equal(request.payload.compare_catalogs, true)
  assert.deepEqual(request.payload.filters, {
    hs_code: "854419",
    origin_country_code: "CHN",
  })
})

test("catalog comparison requires an explicit company role", () => {
  assert.throws(() => operationRequest("company-candidates", options({
    "company-name": "Example Company",
    "compare-catalogs": "true",
    "start-date": "2025-08-28",
    "end-date": "2026-08-28",
  })), /--compare-catalogs requires --company-role/)
})

test("candidate response validator accepts evidence for both catalogs", () => {
  const request = {
    path: "/api/v2/customs/company-candidates",
    payload: {
      company_role: "exporter",
      compare_catalogs: true,
    },
  }
  assert.doesNotThrow(() => assertCompanyCandidateRouting(
    "company-candidates",
    request,
    {
      status: "succeeded",
      result: {
        routing_evidence: {
          mode: "compare_catalogs",
          company_role: "exporter",
          catalogs_checked: ["imports", "exports"],
        },
        candidates: [{
          trade_counts: {
            company_role: "exporter",
            imports_as_exporter: 333,
            exports_as_exporter: 0,
          },
        }],
      },
    },
    { baseUrl: "https://revor.ai" },
  ))
})

test("candidate response validator rejects missing comparison evidence", () => {
  assert.throws(() => assertCompanyCandidateRouting(
    "company-candidates",
    {
      path: "/api/v2/customs/company-candidates",
      payload: { company_role: "exporter", compare_catalogs: true },
    },
    {
      status: "succeeded",
      result: {
        candidates: [{
          trade_counts: {
            company_role: "exporter",
            imports_as_exporter: 333,
            exports_as_exporter: null,
          },
        }],
      },
    },
    { baseUrl: "https://revor.ai" },
  ), /did not honor explicit company_role\/catalog routing/)
})
