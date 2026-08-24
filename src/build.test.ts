import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { substituteConfig } from "./build.js"

// Real target: quartz resolves its config relative to process.cwd(), inside its own
// installed package directory (see agents.md) — this is exactly where substituteConfig writes.
const CONFIG_DEST = path.join(process.cwd(), "node_modules/@jackyzha0/quartz/quartz.config.yaml")

test("substituteConfig writes pageTitle and baseUrl into the installed quartz package", async () => {
  process.env.QUARTZ_PAGE_TITLE = "Test Vault"
  process.env.QUARTZ_BASE_URL = "test.example.com"
  await substituteConfig()
  const written = readFileSync(CONFIG_DEST, "utf-8")
  assert.match(written, /pageTitle: Test Vault/)
  assert.match(written, /baseUrl: test\.example\.com/)
  delete process.env.QUARTZ_PAGE_TITLE
  delete process.env.QUARTZ_BASE_URL
})

test("substituteConfig throws when QUARTZ_BASE_URL is missing", async () => {
  delete process.env.QUARTZ_BASE_URL
  await assert.rejects(() => substituteConfig(), /QUARTZ_BASE_URL is required/)
})
