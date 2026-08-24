import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { readVaultCurrentRef } from "../src/vault.js"

// FR-BUILD-7: the daemon reads git-sync's current symlink to detect a vault change,
// resolved to a concrete path so a build can be pinned to it (see vault.ts).
test("FR-BUILD-7: readVaultCurrentRef resolves the symlink to a concrete directory when git-sync has synced", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "vault-sync-"))
  try {
    const revDir = path.join(dir, "rev-abc123")
    mkdirSync(revDir)
    const linkPath = path.join(dir, "current")
    symlinkSync(revDir, linkPath)
    // Compare against realpathSync(revDir), not the raw string: on some platforms
    // (e.g. macOS's /var -> /private/var) the tmpdir itself resolves to a different
    // canonical path, which would make a literal-string comparison flaky.
    assert.equal(readVaultCurrentRef(linkPath), realpathSync(revDir))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// FR-BUILD-7: must never throw before git-sync's first successful sync.
test("FR-BUILD-7: readVaultCurrentRef returns null when git-sync hasn't synced yet", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "vault-sync-"))
  try {
    const linkPath = path.join(dir, "current")
    assert.equal(readVaultCurrentRef(linkPath), null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// A real misconfiguration (e.g. a bad mount) must surface as an error, not be
// mistaken for "not synced yet" (which would otherwise loop silently forever).
test("FR-BUILD-7: readVaultCurrentRef throws on failures other than ENOENT", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "vault-sync-"))
  try {
    const blocker = path.join(dir, "blocker")
    writeFileSync(blocker, "not a directory")
    // "current" nested under a plain file: resolving it fails with ENOTDIR, not ENOENT.
    const linkPath = path.join(blocker, "current")
    assert.throws(() => readVaultCurrentRef(linkPath), /ENOTDIR/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
