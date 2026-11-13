export const PRODUCTION_API_BASE_URL = 'https://shopflow-u5q3.onrender.com/api/v1'

const DEVELOPMENT_API_BASE_URL = 'http://127.0.0.1:8000/api/v1'

/** Build a device-reachable API URL from Expo's LAN dev-server address. */
export function apiBaseUrlFromPackagerHost(hostUri?: string | null): string | undefined {
  if (!hostUri) return undefined
  try {
    const parsed = new URL(hostUri.includes('://') ? hostUri : `http://${hostUri}`)
    if (!isLocalAddress(parsed.hostname) || parsed.hostname === '0.0.0.0') return undefined
    return normalizeApiBaseUrl(`http://${parsed.hostname}:8000`)
  } catch {
    return undefined
  }
}

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

export function defaultApiBaseUrl(isDevelopment: boolean, configuredValue?: string): string {
  const configured = configuredValue?.trim()
  const baseUrl = normalizeApiBaseUrl(
    configured || (isDevelopment ? DEVELOPMENT_API_BASE_URL : PRODUCTION_API_BASE_URL),
  )
  if (!isDevelopment && baseUrl !== PRODUCTION_API_BASE_URL) {
    throw new Error('Production builds must use the ShopFlow production API.')
  }
  return baseUrl
}

function isLocalAddress(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host === '::1' || host === '10.0.2.2' || host === '0.0.0.0') return true
  const parts = host.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false
  }
  return parts[0] === 127
    || parts[0] === 10
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168)
}
