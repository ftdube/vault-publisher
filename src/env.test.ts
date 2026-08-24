import { test } from "node:test"
import assert from "node:assert/strict"
import { requireEnv } from "./env.js"

test("requireEnv returns the value when set", () => {
  process.env.TEST_REQUIRED_VAR = "value"
  assert.equal(requireEnv("TEST_REQUIRED_VAR"), "value")
  delete process.env.TEST_REQUIRED_VAR
})

test("requireEnv logs and exits when the variable is missing", (t) => {
  delete process.env.TEST_MISSING_VAR
  const exitCalls: Array<number | undefined> = []
  t.mock.method(process, "exit", ((code?: number) => {
    exitCalls.push(code)
    throw new Error("process.exit called")
  }) as never)

  assert.throws(() => requireEnv("TEST_MISSING_VAR"), /process\.exit called/)
  assert.deepEqual(exitCalls, [1])
})
