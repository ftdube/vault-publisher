import { test } from "node:test"
import assert from "node:assert/strict"
import { requireEnv } from "../src/env.js"

// FR-CFG-1: site parameters SHALL be injected via environment variables.
test("FR-CFG-1: requireEnv returns the value when the env var is set", () => {
  process.env.TEST_REQUIRED_VAR = "value"
  assert.equal(requireEnv("TEST_REQUIRED_VAR"), "value")
  delete process.env.TEST_REQUIRED_VAR
})

// FR-CFG-1: a missing required parameter must fail fast at startup, not silently proceed.
test("FR-CFG-1: requireEnv logs and exits when the env var is missing", (t) => {
  delete process.env.TEST_MISSING_VAR
  const exitCalls: Array<number | undefined> = []
  t.mock.method(process, "exit", ((code?: number) => {
    exitCalls.push(code)
    throw new Error("process.exit called")
  }) as never)

  assert.throws(() => requireEnv("TEST_MISSING_VAR"), /process\.exit called/)
  assert.deepEqual(exitCalls, [1])
})
