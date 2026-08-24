import { logError } from "./log.js"

export function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    logError(`${name} is required`)
    process.exit(1)
  }
  return value
}
