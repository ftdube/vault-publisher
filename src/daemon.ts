import { log, logError } from "./log.js"
import { requireEnv } from "./env.js"
import { readVaultCurrentRef } from "./vault.js"
import {
  substituteConfig,
  runQuartzBuild,
  promoteSiteNext,
  discardSiteNext,
  writeBuildInfo,
  readLastBuiltRef,
} from "./build.js"

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// FR-BUILD-2/FR-BUILD-3, G3: the last successfully built ref persists in
// /site/current/.build-info, so a pod restart doesn't force a rebuild when the vault hasn't
// actually changed.
let lastBuiltRef: string | null = null

// FR-BUILD-7: vault sync itself is owned by the git-sync sidecar; this only detects
// a change by reading the /vault/current symlink it maintains.
async function pollOnce(): Promise<void> {
  const currentRef = readVaultCurrentRef()
  if (currentRef === null) {
    // Distinguish "never synced yet" from "synced content vanished" (RISK-9, e.g. a
    // git-sync GC or a lost mount) — both hit the same ENOENT, but only the first is benign.
    if (lastBuiltRef === null) {
      log("Waiting for git-sync's first sync (/vault/current not present yet)")
    } else {
      logError(`/vault/current disappeared after a previous successful build (was ${lastBuiltRef}) — still serving that build, but this is not a startup state`)
    }
    return
  }

  if (currentRef === lastBuiltRef) {
    log(`Up to date (${currentRef})`)
    return
  }

  log(`Vault changed: ${lastBuiltRef ?? "(none)"} -> ${currentRef}, rebuilding`)
  await substituteConfig()
  const exitCode = await runQuartzBuild(currentRef)

  if (exitCode === 0) {
    promoteSiteNext()
    writeBuildInfo(currentRef)
    lastBuiltRef = currentRef
    log(`Build succeeded, published ${currentRef}`)
  } else {
    discardSiteNext()
    logError(`Build failed (exit ${exitCode}), /site left unchanged at ${lastBuiltRef ?? "(none)"}`)
  }
}

async function main(): Promise<void> {
  // FR-CFG-1: site parameters come from the environment, never baked into the image.
  // VAULT_REPO_URL/VAULT_BRANCH/SSH_KEY_PATH belong to the git-sync sidecar now, not this daemon.
  requireEnv("QUARTZ_BASE_URL")
  const DEFAULT_POLL_INTERVAL_SECONDS = 300
  const parsedPollInterval = Number.parseInt(process.env.POLL_INTERVAL || "", 10)
  const pollIntervalSeconds =
    Number.isFinite(parsedPollInterval) && parsedPollInterval > 0
      ? parsedPollInterval
      : DEFAULT_POLL_INTERVAL_SECONDS
  if (process.env.POLL_INTERVAL && pollIntervalSeconds !== parsedPollInterval) {
    logError(`Invalid POLL_INTERVAL "${process.env.POLL_INTERVAL}", falling back to ${DEFAULT_POLL_INTERVAL_SECONDS}s`)
  }

  lastBuiltRef = readLastBuiltRef()

  log(`vault-publisher starting: pollInterval=${pollIntervalSeconds}s`)
  for (;;) {
    try {
      await pollOnce()
    } catch (err) {
      // FR-SYNC-4-adjacent: any unexpected failure is logged and retried, never fatal.
      const message = err instanceof Error ? err.message : String(err)
      logError(`Poll cycle failed, will retry next cycle: ${message}`)
    }
    await sleep(pollIntervalSeconds * 1000)
  }
}

// Only run the loop when this file is the invoked entrypoint, not when imported (e.g. by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
