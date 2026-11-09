export function normalizeApiBaseUrl(value: string): string {
  const parsed = new URL(value.trim())
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('API address must use HTTPS.')
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('API address cannot contain credentials, query parameters, or a fragment.')
  }
  if (parsed.protocol === 'http:' && !isLocalAddress(parsed.hostname)) {
    throw new Error('Use HTTPS for non-local API servers.')
  }
  const path = parsed.pathname.replace(/\/+$/, '')
  parsed.pathname = path.endsWith('/api/v1') ? path : `${path}/api/v1`
  return parsed.toString().replace(/\/+$/, '')
}

function isLocalAddress(hostname: string): boolean {
  const host = hostname.toLowerCase()
  if (host === 'localhost' || host === '::1' || host === '10.0.2.2') return true
  const parts = host.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false
  }
  return parts[0] === 10
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168)
}
