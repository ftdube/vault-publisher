import { log, logError } from "./log.js"
import { requireEnv } from "./env.js"
import { isVaultCloned, cloneVault, fetchVault, remoteHeadSha, syncToRemote } from "./git.js"
import {
  substituteConfig,
  runQuartzBuild,
  promoteSiteNext,
  discardSiteNext,
  writeBuildInfo,
  readLastBuiltSha,
} from "./build.js"

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// FR-BUILD-2/FR-BUILD-3, G3: the last successfully built SHA persists in /site/.build-info,
// so a pod restart doesn't force a rebuild when the vault hasn't actually changed.
let lastBuiltSha: string | null = null

async function pollOnce(repoUrl: string, branch: string): Promise<void> {
  if (!isVaultCloned()) {
    log(`Cloning ${repoUrl} (branch ${branch}) to /vault`)
    await cloneVault(repoUrl, branch)
  } else {
    const fetch = await fetchVault(branch)
    if (fetch.code !== 0) {
      // FR-POLL-5: log and retry next cycle, never crash the daemon.
      logError(`git fetch failed, will retry next cycle: ${fetch.stderr}`)
      return
    }
  }

  const headSha = await remoteHeadSha(branch)
  if (headSha === lastBuiltSha) {
    log(`Up to date (${headSha})`)
    return
  }

  log(`HEAD changed: ${lastBuiltSha ?? "(none)"} -> ${headSha}, rebuilding`)
  await syncToRemote(branch)
  await substituteConfig()
  const exitCode = await runQuartzBuild()

  if (exitCode === 0) {
    promoteSiteNext()
    writeBuildInfo(headSha)
    lastBuiltSha = headSha
    log(`Build succeeded, published ${headSha}`)
  } else {
    discardSiteNext()
    logError(`Build failed (exit ${exitCode}), /site left unchanged at ${lastBuiltSha ?? "(none)"}`)
  }
}

async function main(): Promise<void> {
  // FR-CFG-1: required site parameters come from the environment, never baked into the image.
  const repoUrl = requireEnv("VAULT_REPO_URL")
  requireEnv("QUARTZ_BASE_URL")
  const branch = process.env.VAULT_BRANCH || "main"
  const DEFAULT_POLL_INTERVAL_SECONDS = 300
  const parsedPollInterval = Number.parseInt(process.env.POLL_INTERVAL || "", 10)
  const pollIntervalSeconds =
    Number.isFinite(parsedPollInterval) && parsedPollInterval > 0
      ? parsedPollInterval
      : DEFAULT_POLL_INTERVAL_SECONDS
  if (process.env.POLL_INTERVAL && pollIntervalSeconds !== parsedPollInterval) {
    logError(`Invalid POLL_INTERVAL "${process.env.POLL_INTERVAL}", falling back to ${DEFAULT_POLL_INTERVAL_SECONDS}s`)
  }

  lastBuiltSha = readLastBuiltSha()

  log(`vault-publisher starting: repo=${repoUrl} branch=${branch} pollInterval=${pollIntervalSeconds}s`)
  for (;;) {
    try {
      await pollOnce(repoUrl, branch)
    } catch (err) {
      // FR-POLL-5: any unexpected failure is logged and retried, never fatal.
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
