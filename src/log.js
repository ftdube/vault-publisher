function timestamp() {
  return new Date().toISOString()
}

export function log(message) {
  console.log(`[${timestamp()}] ${message}`)
}

export function logError(message) {
  console.error(`[${timestamp()}] ${message}`)
}
