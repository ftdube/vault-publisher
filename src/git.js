import { spawn } from "node:child_process"
import { existsSync } from "node:fs"

const VAULT_DIR = "/vault"

function run(cmd, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { ...options, stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => (stdout += chunk))
    child.stderr.on("data", (chunk) => (stderr += chunk))
    child.on("error", (err) => resolve({ code: 1, stdout, stderr: stderr + err.message }))
    child.on("close", (code) => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }))
  })
}

// FR-POLL-4: use the SSH deploy key when present, HTTPS otherwise.
function gitEnv() {
  const sshKeyPath = process.env.SSH_KEY_PATH || "/ssh/id_ed25519"
  if (existsSync(sshKeyPath)) {
    return {
      ...process.env,
      GIT_SSH_COMMAND: `ssh -i ${sshKeyPath} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new`,
    }
  }
  return process.env
}

function runVaultGit(args) {
  return run("git", ["-C", VAULT_DIR, ...args], { env: gitEnv() })
}

export function isVaultCloned() {
  return existsSync(`${VAULT_DIR}/.git`)
}

// FR-POLL-1 (clone path)
export async function cloneVault(repoUrl, branch) {
  const result = await run("git", ["clone", "--branch", branch, "--single-branch", repoUrl, VAULT_DIR], {
    env: gitEnv(),
  })
  if (result.code !== 0) {
    throw new Error(`git clone failed: ${result.stderr}`)
  }
}

// FR-POLL-1 (fetch path) / FR-POLL-5: failures are returned, never thrown, so the caller can log and retry
export async function fetchVault(branch) {
  return runVaultGit(["fetch", "--prune", "origin", branch])
}

export async function remoteHeadSha(branch) {
  const result = await runVaultGit(["rev-parse", `origin/${branch}`])
  if (result.code !== 0) {
    throw new Error(`git rev-parse failed: ${result.stderr}`)
  }
  return result.stdout
}

// Moves the vault working tree to match the fetched remote branch tip.
export async function syncToRemote(branch) {
  const checkout = await runVaultGit(["checkout", branch])
  if (checkout.code !== 0) {
    throw new Error(`git checkout failed: ${checkout.stderr}`)
  }
  const reset = await runVaultGit(["reset", "--hard", `origin/${branch}`])
  if (reset.code !== 0) {
    throw new Error(`git reset failed: ${reset.stderr}`)
  }
}
