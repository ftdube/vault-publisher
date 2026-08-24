function timestamp(): string {
  return new Date().toISOString()
}

export function log(message: string): void {
  console.log(`[${timestamp()}] ${message}`)
}

export function logError(message: string): void {
  console.error(`[${timestamp()}] ${message}`)
}
