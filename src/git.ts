import { spawn } from "node:child_process"
import { existsSync } from "node:fs"

const VAULT_DIR = "/vault"

interface GitResult {
  code: number | null
  stdout: string
  stderr: string
}

function run(cmd: string, args: string[], options: { env?: NodeJS.ProcessEnv } = {}): Promise<GitResult> {
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
function gitEnv(): NodeJS.ProcessEnv {
  const sshKeyPath = process.env.SSH_KEY_PATH || "/ssh/id_ed25519"
  if (existsSync(sshKeyPath)) {
    return {
      ...process.env,
      GIT_SSH_COMMAND: `ssh -i ${sshKeyPath} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new`,
    }
  }
  return process.env
}

function runVaultGit(args: string[]): Promise<GitResult> {
  return run("git", ["-C", VAULT_DIR, ...args], { env: gitEnv() })
}

export function isVaultCloned(): boolean {
  return existsSync(`${VAULT_DIR}/.git`)
}

// FR-POLL-1 (clone path)
export async function cloneVault(repoUrl: string, branch: string): Promise<void> {
  const result = await run("git", ["clone", "--branch", branch, "--single-branch", repoUrl, VAULT_DIR], {
    env: gitEnv(),
  })
  if (result.code !== 0) {
    throw new Error(`git clone failed: ${result.stderr}`)
  }
}

// FR-POLL-1 (fetch path) / FR-POLL-5: failures are returned, never thrown, so the caller can log and retry.
// Explicit refspec (not a bare branch name) so origin/<branch> is created/updated even if it wasn't the
// branch selected at clone time — a bare `fetch origin <branch>` only updates FETCH_HEAD, not origin/<branch>.
export async function fetchVault(branch: string): Promise<GitResult> {
  return runVaultGit(["fetch", "--prune", "origin", `+refs/heads/${branch}:refs/remotes/origin/${branch}`])
}

export async function remoteHeadSha(branch: string): Promise<string> {
  const result = await runVaultGit(["rev-parse", `origin/${branch}`])
  if (result.code !== 0) {
    throw new Error(`git rev-parse failed: ${result.stderr}`)
  }
  return result.stdout
}

// Moves the vault working tree to match the fetched remote branch tip.
export async function syncToRemote(branch: string): Promise<void> {
  const checkout = await runVaultGit(["checkout", branch])
  if (checkout.code !== 0) {
    throw new Error(`git checkout failed: ${checkout.stderr}`)
  }
  const reset = await runVaultGit(["reset", "--hard", `origin/${branch}`])
  if (reset.code !== 0) {
    throw new Error(`git reset failed: ${reset.stderr}`)
  }
}
