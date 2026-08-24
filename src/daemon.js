import { log, logError } from "./log.js"
import { isVaultCloned, cloneVault, fetchVault, remoteHeadSha, syncToRemote } from "./git.js"
import {
  substituteConfig,
  runQuartzBuild,
  promoteSiteNext,
  discardSiteNext,
  writeBuildInfo,
  readLastBuiltSha,
} from "./build.js"

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// FR-CFG-1: required site parameters come from the environment, never baked into the image.
const repoUrl = process.env.VAULT_REPO_URL
const branch = process.env.VAULT_BRANCH || "main"
const pollIntervalSeconds = Number.parseInt(process.env.POLL_INTERVAL || "300", 10)

if (!repoUrl) {
  logError("VAULT_REPO_URL is required")
  process.exit(1)
}
if (!process.env.QUARTZ_BASE_URL) {
  logError("QUARTZ_BASE_URL is required")
  process.exit(1)
}

// FR-BUILD-2/FR-BUILD-3, G3: the last successfully built SHA persists in /site/.build-info,
// so a pod restart doesn't force a rebuild when the vault hasn't actually changed.
let lastBuiltSha = readLastBuiltSha()

async function pollOnce() {
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

async function main() {
  log(`vault-publisher starting: repo=${repoUrl} branch=${branch} pollInterval=${pollIntervalSeconds}s`)
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await pollOnce()
    } catch (err) {
      // FR-POLL-5: any unexpected failure is logged and retried, never fatal.
      logError(`Poll cycle failed, will retry next cycle: ${err.message}`)
    }
    await sleep(pollIntervalSeconds * 1000)
  }
}

main()
