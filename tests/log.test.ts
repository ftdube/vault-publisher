import { test } from "node:test"
import assert from "node:assert/strict"
import { log, logError } from "../src/log.js"

// BRD §13 Observability: build success/failure SHALL be logged to stdout with a timestamp.
test("§13: log writes a timestamped line to stdout", () => {
  const calls: string[] = []
  const original = console.log
  console.log = (msg: string) => calls.push(msg)
  try {
    log("hello")
  } finally {
    console.log = original
  }
  assert.equal(calls.length, 1)
  assert.match(calls[0], /^\[\d{4}-\d{2}-\d{2}T.*Z\] hello$/)
})

// BRD §13 Observability: failures SHALL be logged the same way, to stderr.
test("§13: logError writes a timestamped line to stderr", () => {
  const calls: string[] = []
  const original = console.error
  console.error = (msg: string) => calls.push(msg)
  try {
    logError("boom")
  } finally {
    console.error = original
  }
  assert.equal(calls.length, 1)
  assert.match(calls[0], /^\[\d{4}-\d{2}-\d{2}T.*Z\] boom$/)
})
