import { spawn } from "node:child_process"
import { existsSync, readFileSync, writeFileSync, rmSync, renameSync } from "node:fs"
import path from "node:path"

const APP_ROOT = process.cwd()
const QUARTZ_PKG_DIR = path.join(APP_ROOT, "node_modules/@jackyzha0/quartz")
const QUARTZ_BIN = path.join(APP_ROOT, "node_modules/.bin/quartz")
const CONFIG_TEMPLATE = path.join(APP_ROOT, "quartz.config.yaml")
const CONFIG_DEST = path.join(QUARTZ_PKG_DIR, "quartz.config.yaml")

const VAULT_DIR = "/vault"
const SITE_DIR = "/site"
const SITE_NEXT_DIR = "/site-next"
const SITE_OLD_DIR = "/site-old"
const BUILD_INFO_PATH = path.join(SITE_DIR, ".build-info")

interface PipedResult {
  code: number | null
  stdout: string
  stderr: string
}

function runPiped(
  cmd: string,
  args: string[],
  inputText: string,
  env: NodeJS.ProcessEnv,
): Promise<PipedResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { env, stdio: ["pipe", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => (stdout += chunk))
    child.stderr.on("data", (chunk) => (stderr += chunk))
    child.on("error", (err) => resolve({ code: 1, stdout, stderr: stderr + err.message }))
    child.on("close", (code) => resolve({ code, stdout, stderr: stderr.trim() }))
    child.stdin.write(inputText)
    child.stdin.end()
  })
}

// FR-BUILD-4: substitute ${QUARTZ_*} placeholders via envsubst, writing into the
// installed quartz package's own directory (see agents.md — quartz resolves
// quartz.config.yaml relative to process.cwd(), not its install path).
export async function substituteConfig(): Promise<void> {
  const pageTitle = process.env.QUARTZ_PAGE_TITLE || "My Vault"
  const baseUrl = process.env.QUARTZ_BASE_URL
  if (!baseUrl) {
    throw new Error("QUARTZ_BASE_URL is required")
  }
  const template = readFileSync(CONFIG_TEMPLATE, "utf-8")
  const result = await runPiped(
    "envsubst",
    ["${QUARTZ_PAGE_TITLE} ${QUARTZ_BASE_URL}"],
    template,
    { ...process.env, QUARTZ_PAGE_TITLE: pageTitle, QUARTZ_BASE_URL: baseUrl },
  )
  if (result.code !== 0) {
    throw new Error(`envsubst failed: ${result.stderr}`)
  }
  writeFileSync(CONFIG_DEST, result.stdout)
}

// FR-BUILD-1: run from inside the installed quartz package directory — quartz
// resolves its own build scripts and config relative to cwd, not install path.
export function runQuartzBuild(): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn(QUARTZ_BIN, ["build", "-d", VAULT_DIR, "--output", SITE_NEXT_DIR], {
      cwd: QUARTZ_PKG_DIR,
      stdio: ["ignore", "inherit", "inherit"],
    })
    child.on("error", () => resolve(1))
    child.on("close", (code) => resolve(code))
  })
}

// FR-BUILD-2 / RISK-6: rename(2) cannot replace a non-empty directory, so promotion
// after the first build is two renames with a brief gap, not a single atomic swap.
export function promoteSiteNext(): void {
  rmSync(SITE_OLD_DIR, { recursive: true, force: true })
  if (existsSync(SITE_DIR)) {
    renameSync(SITE_DIR, SITE_OLD_DIR)
  }
  renameSync(SITE_NEXT_DIR, SITE_DIR)
  rmSync(SITE_OLD_DIR, { recursive: true, force: true })
}

// FR-BUILD-3: on failure /site is never touched; only the failed staging dir is cleaned up.
export function discardSiteNext(): void {
  rmSync(SITE_NEXT_DIR, { recursive: true, force: true })
}

export function writeBuildInfo(sha: string): void {
  writeFileSync(BUILD_INFO_PATH, `${sha}\n${new Date().toISOString()}\n`)
}

export function readLastBuiltSha(): string | null {
  if (!existsSync(BUILD_INFO_PATH)) return null
  const [sha] = readFileSync(BUILD_INFO_PATH, "utf-8").split("\n")
  return sha || null
}
